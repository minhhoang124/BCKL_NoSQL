import { Prisma } from '@prisma/client';
import {
  PROVINCE_CODE,
  PROVINCE_KINDS,
  WARD_CODE,
  WARD_KINDS,
} from './location-catalog.js';

/** Counts fixed by QĐ 19/2025/QĐ-TTg. Required for an official import. */
export const OFFICIAL_PROVINCE_COUNT = 34;
export const OFFICIAL_WARD_COUNT = 3321;

export type CatalogInput = {
  sourceRef: string;
  effectiveDate: string; // YYYY-MM-DD
  sourceSha256: string; // SHA256 of the original official file
  provinces: { code: string; name: string; kind: string }[];
  wards: { code: string; name: string; kind: string; provinceCode: string }[];
};

export type CatalogExpectation = { provinces: number; wards: number };

const cleanName = (value: unknown) =>
  typeof value === 'string' ? value.normalize('NFC').trim() : '';

/**
 * Pure validation of a normalized catalogue. Throws with every problem found
 * (bounded) so an operator can fix the source conversion; never guesses.
 */
export function validateCatalog(
  input: CatalogInput,
  expected: CatalogExpectation,
): CatalogInput {
  const problems: string[] = [];
  const add = (message: string) => {
    if (problems.length < 50) problems.push(message);
  };
  if (!input || typeof input !== 'object') throw new Error('Catalog: invalid');
  const sourceRef = cleanName(input.sourceRef);
  if (!sourceRef || sourceRef.length > 200) add('sourceRef');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate ?? '') ||
    Number.isNaN(Date.parse(input.effectiveDate + 'T00:00:00Z'))
  )
    add('effectiveDate');
  if (!/^[0-9a-f]{64}$/.test(input.sourceSha256 ?? '')) add('sourceSha256');
  if (!Array.isArray(input.provinces) || !Array.isArray(input.wards))
    throw new Error('Catalog: provinces/wards must be arrays');
  const provinces = input.provinces.map((p) => ({
    code: p?.code,
    name: cleanName(p?.name),
    kind: p?.kind,
  }));
  const wards = input.wards.map((w) => ({
    code: w?.code,
    name: cleanName(w?.name),
    kind: w?.kind,
    provinceCode: w?.provinceCode,
  }));
  const provinceCodes = new Set<string>();
  for (const p of provinces) {
    if (typeof p.code !== 'string' || !PROVINCE_CODE.test(p.code))
      add(`province code ${String(p.code)}`);
    else if (provinceCodes.has(p.code)) add(`duplicate province ${p.code}`);
    else provinceCodes.add(p.code);
    if (!p.name || p.name.length > 100) add(`province name ${String(p.code)}`);
    if (!(PROVINCE_KINDS as readonly string[]).includes(p.kind as string))
      add(`province kind ${String(p.code)}`);
  }
  const wardCodes = new Set<string>();
  const usedProvinces = new Set<string>();
  for (const w of wards) {
    if (typeof w.code !== 'string' || !WARD_CODE.test(w.code))
      add(`ward code ${String(w.code)}`);
    else if (wardCodes.has(w.code)) add(`duplicate ward ${w.code}`);
    else wardCodes.add(w.code);
    if (!w.name || w.name.length > 100) add(`ward name ${String(w.code)}`);
    if (!(WARD_KINDS as readonly string[]).includes(w.kind as string))
      add(`ward kind ${String(w.code)}`);
    if (typeof w.provinceCode !== 'string' || !provinceCodes.has(w.provinceCode))
      add(`ward ${String(w.code)} unknown province ${String(w.provinceCode)}`);
    else usedProvinces.add(w.provinceCode);
  }
  for (const code of provinceCodes)
    if (!usedProvinces.has(code)) add(`province ${code} has no ward`);
  if (provinces.length !== expected.provinces)
    add(`province count ${provinces.length} != ${expected.provinces}`);
  if (wards.length !== expected.wards)
    add(`ward count ${wards.length} != ${expected.wards}`);
  if (problems.length)
    throw new Error('Catalog validation failed: ' + problems.join('; '));
  return {
    sourceRef,
    effectiveDate: input.effectiveDate,
    sourceSha256: input.sourceSha256,
    provinces: provinces as CatalogInput['provinces'],
    wards: wards as CatalogInput['wards'],
  };
}

/**
 * Insert a validated catalogue as a NEW version and make it the only active
 * one, atomically. Never edits user addresses or Order snapshots; addresses
 * bound to an older version become "OUTDATED" for the owner to re-select.
 */
export async function importCatalog(
  tx: Prisma.TransactionClient,
  input: CatalogInput,
  expected: CatalogExpectation,
): Promise<{ versionId: number }> {
  const catalog = validateCatalog(input, expected);
  const version = await tx.adminDivisionVersion.create({
    data: {
      sourceRef: catalog.sourceRef,
      effectiveDate: new Date(catalog.effectiveDate + 'T00:00:00Z'),
      sourceSha256: catalog.sourceSha256,
      provinceCount: catalog.provinces.length,
      wardCount: catalog.wards.length,
      isActive: false,
    },
    select: { id: true },
  });
  await tx.adminProvince.createMany({
    data: catalog.provinces.map((p) => ({ ...p, versionId: version.id })),
  });
  for (let i = 0; i < catalog.wards.length; i += 1000)
    await tx.adminWard.createMany({
      data: catalog.wards
        .slice(i, i + 1000)
        .map((w) => ({ ...w, versionId: version.id })),
    });
  await tx.adminDivisionVersion.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });
  await tx.adminDivisionVersion.update({
    where: { id: version.id },
    data: { isActive: true },
  });
  return { versionId: version.id };
}
