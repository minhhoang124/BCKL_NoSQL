#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import pg from 'pg';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(backendDirectory, '..');
config({ path: path.join(repositoryDirectory, '.env') });
config({ path: path.join(backendDirectory, '.env') });

function parseArguments(argv) {
  const options = {
    dryRun: false,
    createMissingBrands: false,
    backendPublicUrl:
      process.env.BACKEND_PUBLIC_URL ??
      `http://localhost:${process.env.BACKEND_PORT ?? 3001}`,
    uploadsRoot: path.resolve(
      process.env.UPLOAD_ROOT ?? path.join(repositoryDirectory, 'uploads'),
    ),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--create-missing-brands') {
      options.createMissingBrands = true;
    } else if (argument.startsWith('--')) {
      const key = argument
        .slice(2)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}`);
      }
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.input) throw new Error('--input is required');
  if (!options.storeId || !/^\d+$/.test(options.storeId)) {
    throw new Error('--store-id must be a positive integer');
  }
  options.storeId = Number(options.storeId);
  if (options.storeId < 1) throw new Error('--store-id must be positive');
  options.input = path.resolve(options.input);
  options.imagesRoot = path.resolve(
    options.imagesRoot ?? path.dirname(options.input),
  );
  options.uploadsRoot = path.resolve(options.uploadsRoot);
  if (options.mappingOutput) {
    options.mappingOutput = path.resolve(options.mappingOutput);
  }
  options.backendPublicUrl = options.backendPublicUrl.replace(/\/$/, '');
  return options;
}

async function readJsonLines(inputPath) {
  const records = [];
  const stream = createReadStream(inputPath, { encoding: 'utf8' });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (!line) continue;
    try {
      records.push({ lineNumber, value: JSON.parse(line) });
    } catch (error) {
      throw new Error(`Invalid JSON at line ${lineNumber}: ${error.message}`);
    }
  }
  return records;
}

function validateRecord(record, lineNumber) {
  const prefix = `Line ${lineNumber}`;
  if (record?.schemaVersion !== 1) {
    throw new Error(`${prefix}: schemaVersion must be 1`);
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(record?.source ?? '')) {
    throw new Error(`${prefix}: source is invalid`);
  }
  if (
    typeof record?.externalId !== 'string' ||
    !record.externalId.startsWith(`${record.source}:`) ||
    record.externalId.length <= record.source.length + 1
  ) {
    throw new Error(`${prefix}: externalId must use the source namespace`);
  }
  if (typeof record?.name !== 'string' || !record.name.trim()) {
    throw new Error(`${prefix}: name is required`);
  }
  if (
    typeof record?.normalizedCategory !== 'string' ||
    !record.normalizedCategory.trim()
  ) {
    throw new Error(`${prefix}: normalizedCategory is required for import`);
  }
  if (record.brand != null && typeof record.brand !== 'string') {
    throw new Error(`${prefix}: brand must be a string or null`);
  }
  if (record.description != null && typeof record.description !== 'string') {
    throw new Error(`${prefix}: description must be a string or null`);
  }
  if (!Array.isArray(record.images)) {
    throw new Error(`${prefix}: images must be an array`);
  }
  if (record.images.filter((image) => image?.isPrimary === true).length > 1) {
    throw new Error(`${prefix}: at most one image can be primary`);
  }
  return {
    ...record,
    name: record.name.trim(),
    description: record.description?.trim() || null,
    brand: record.brand?.trim() || null,
    normalizedCategory: record.normalizedCategory.trim(),
  };
}

function canonical(value) {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

async function buildCategoryPathMap(prisma) {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, parentId: true, name: true },
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  const activeParents = new Set(
    categories
      .map(({ parentId }) => parentId)
      .filter((parentId) => parentId !== null),
  );
  const result = new Map();
  for (const category of categories) {
    const names = [];
    const visited = new Set();
    let cursor = category;
    while (cursor) {
      if (visited.has(cursor.id))
        throw new Error('Category tree contains a cycle');
      visited.add(cursor.id);
      names.unshift(cursor.name);
      cursor = cursor.parentId === null ? null : byId.get(cursor.parentId);
      if (cursor === undefined) {
        names.length = 0;
        break;
      }
    }
    if (names.length) {
      result.set(canonical(names.join(' > ')), {
        ...category,
        isLeaf: !activeParents.has(category.id),
      });
    }
  }
  return result;
}

function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return slug.slice(0, 100);
  return `brand-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

async function resolveBrand(prisma, name, options) {
  if (!name) return null;
  const existing = await prisma.brand.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, isActive: true },
  });
  if (existing) return existing;
  if (!options.createMissingBrands) return null;
  if (options.dryRun)
    return { id: null, name, slug: slugify(name), dryRun: true };
  const baseSlug = slugify(name);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    const bySlug = await prisma.brand.findUnique({ where: { slug } });
    if (bySlug) {
      if (canonical(bySlug.name) === canonical(name)) return bySlug;
      continue;
    }
    return prisma.brand.create({ data: { name, slug } });
  }
  throw new Error(`Cannot create a unique brand slug for ${name}`);
}

function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Image path escapes the package root');
  }
}

async function validateImage(imagesRootReal, image) {
  if (typeof image?.sourcePath !== 'string' || !image.sourcePath.trim()) {
    throw new Error('image.sourcePath is required');
  }
  if (path.isAbsolute(image.sourcePath)) {
    throw new Error('Absolute image paths are forbidden');
  }
  const candidate = path.resolve(imagesRootReal, image.sourcePath);
  assertInsideRoot(imagesRootReal, candidate);
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error('Image symlinks are forbidden');
  const resolved = await realpath(candidate);
  assertInsideRoot(imagesRootReal, resolved);
  const buffer = await readFile(resolved);
  let metadata;
  try {
    const decoded = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 25_000_000,
      sequentialRead: true,
    });
    metadata = await decoded.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Image has no dimensions');
    }
    await decoded.stats();
  } catch {
    throw new Error('Image content is not a valid JPEG, PNG or WebP');
  }
  const extension =
    metadata.format === 'jpeg'
      ? 'jpg'
      : metadata.format === 'png' || metadata.format === 'webp'
        ? metadata.format
        : null;
  if (!extension) {
    throw new Error('Image content is not a valid JPEG, PNG or WebP');
  }
  return {
    sourcePath: resolved,
    extension,
    hash: createHash('sha256').update(buffer).digest('hex'),
    sortOrder:
      Number.isInteger(image.sortOrder) && image.sortOrder >= 0
        ? image.sortOrder
        : 0,
    isPrimary: image.isPrimary === true,
  };
}

async function stageImage(productId, image, options) {
  const relative = path.join(
    'products',
    String(productId),
    `${image.hash}.${image.extension}`,
  );
  const destination = path.join(options.uploadsRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(image.sourcePath, destination);
  return `${options.backendPublicUrl}/uploads/${relative.split(path.sep).join('/')}`;
}

async function importRecord(prisma, prepared, options) {
  let product = await prisma.product.findUnique({
    where: { externalId: prepared.record.externalId },
  });
  let created = false;
  if (!product) {
    try {
      product = await prisma.product.create({
        data: {
          externalId: prepared.record.externalId,
          storeId: options.storeId,
          categoryId: prepared.category.id,
          brandId: prepared.brand?.id ?? null,
          name: prepared.record.name,
          description: prepared.record.description,
        },
      });
      created = true;
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      product = await prisma.product.findUniqueOrThrow({
        where: { externalId: prepared.record.externalId },
      });
    }
  }

  const canResumeImages =
    created ||
    (product.version === 1 &&
      product.sellerStatus === 'DRAFT' &&
      product.moderationStatus === 'NOT_SUBMITTED');
  if (canResumeImages) {
    for (const image of prepared.images) {
      const url = await stageImage(product.id, image, options);
      const existing = await prisma.productImage.findUnique({
        where: { productId_url: { productId: product.id, url } },
      });
      if (existing) continue;
      const primaryCount = await prisma.productImage.count({
        where: { productId: product.id, isPrimary: true },
      });
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary ? primaryCount === 0 : false,
        },
      });
    }
  }
  return {
    externalId: prepared.record.externalId,
    productId: product.id,
    created,
  };
}

async function writeMapping(outputPath, mappings) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  const content = `${mappings
    .sort((left, right) => left.externalId.localeCompare(right.externalId))
    .map(({ externalId, productId }) =>
      JSON.stringify({ externalId, productId }),
    )
    .join('\n')}\n`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, outputPath);
}

export async function runImport(options) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const { Pool } = pg;
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const summary = {
    total: 0,
    valid: 0,
    created: 0,
    existing: 0,
    errors: [],
    mappings: [],
  };
  try {
    const store = await prisma.store.findUnique({
      where: { id: options.storeId },
    });
    if (!store) throw new Error(`Store ${options.storeId} does not exist`);
    if (store.status !== 'ACTIVE') {
      throw new Error(`Store ${options.storeId} is not ACTIVE`);
    }
    const categoryPaths = await buildCategoryPathMap(prisma);
    const imagesRootReal = await realpath(options.imagesRoot);
    const lines = await readJsonLines(options.input);
    summary.total = lines.length;
    const seenExternalIds = new Set();

    for (const { lineNumber, value } of lines) {
      const externalId = value?.externalId ?? `line:${lineNumber}`;
      try {
        const record = validateRecord(value, lineNumber);
        if (seenExternalIds.has(record.externalId)) {
          throw new Error('Duplicate externalId in input');
        }
        seenExternalIds.add(record.externalId);
        const category = categoryPaths.get(
          canonical(record.normalizedCategory),
        );
        if (!category) {
          throw new Error(
            `Category path not found: ${record.normalizedCategory}`,
          );
        }
        if (!category.isLeaf) {
          throw new Error(
            `Category is not a leaf: ${record.normalizedCategory}`,
          );
        }
        const brand = await resolveBrand(prisma, record.brand, options);
        if (record.brand && !brand) {
          throw new Error(
            `Brand not found: ${record.brand}; use --create-missing-brands after review`,
          );
        }
        const images = [];
        for (const image of record.images) {
          images.push(await validateImage(imagesRootReal, image));
        }
        summary.valid += 1;
        if (options.dryRun) continue;
        const mapping = await importRecord(
          prisma,
          { record, category, brand, images },
          options,
        );
        summary.mappings.push(mapping);
        if (mapping.created) summary.created += 1;
        else summary.existing += 1;
      } catch (error) {
        summary.errors.push({
          externalId,
          lineNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!options.dryRun && summary.errors.length === 0) {
      await writeMapping(options.mappingOutput, summary.mappings);
    }
    return summary;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const summary = await runImport(options);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
