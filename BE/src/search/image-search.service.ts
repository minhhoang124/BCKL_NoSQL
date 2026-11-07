import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { UploadedImage } from '../product/product-image-storage.service.js';
import { SearchService } from './search.service.js';

export const IMAGE_SEARCH_MAX_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
export type ImageSearchOptions = { topK: number; candidateK: number };
type ImageHits = {
  query: { type: 'image'; topK: number; candidateK: number };
  items: { productId: number; rank: number; score: number }[];
  responseTimeMs: number;
};

export function parseImageSearchOptions(raw: unknown): ImageSearchOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('Invalid image search fields');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['topK', 'candidateK'].includes(key)))
    throw new BadRequestException('Unknown image search field');
  const integer = (key: string, fallback: number, maximum: number) => {
    const value = record[key];
    if (value === undefined) return fallback;
    // Multer fields are strings. Do not coerce arrays, blanks or duplicate fields.
    if (
      typeof value !== 'string' ||
      !/^[1-9]\d{0,2}$/.test(value) ||
      Number(value) > maximum
    )
      throw new BadRequestException(`Invalid ${key}`);
    return Number(value);
  };
  const topK = integer('topK', 10, 50);
  const candidateK = integer(
    'candidateK',
    Math.min(Math.max(topK * 3, 30), 150),
    150,
  );
  if (candidateK < topK)
    throw new BadRequestException('candidateK must be >= topK');
  return { topK, candidateK };
}

function object(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadGatewayException('Invalid image search response');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new BadGatewayException('Invalid image search response fields');
  return value;
}

/** Matches the actual /search/image exclude-none wire, not the hybrid envelope.
 * The gateway deliberately rejects extras even where Pydantic ignores input extras.
 */
export function validateImageSearchResponse(
  raw: unknown,
  expected: ImageSearchOptions,
): ImageHits {
  const value = object(raw, ['query', 'items', 'responseTimeMs']);
  const query = object(value.query, ['type', 'topK', 'candidateK']);
  if (
    query.type !== 'image' ||
    query.topK !== expected.topK ||
    query.candidateK !== expected.candidateK ||
    typeof value.responseTimeMs !== 'number' ||
    !Number.isFinite(value.responseTimeMs) ||
    value.responseTimeMs < 0 ||
    !Array.isArray(value.items) ||
    value.items.length > expected.topK
  )
    throw new BadGatewayException('Invalid image search response');
  for (const row of value.items) {
    const item = object(row, ['productId', 'rank', 'score']);
    if (
      typeof item.productId !== 'number' ||
      !Number.isSafeInteger(item.productId) ||
      item.productId < 1 ||
      item.productId > 2147483647 ||
      typeof item.rank !== 'number' ||
      !Number.isSafeInteger(item.rank) ||
      item.rank < 1 ||
      item.rank > expected.topK ||
      typeof item.score !== 'number' ||
      !Number.isFinite(item.score)
    )
      throw new BadGatewayException('Invalid image search item');
  }
  return raw as ImageHits;
}

@Injectable()
export class ImageSearchService {
  private readonly url: string;
  private readonly timeoutMs: number;
  constructor(
    config: ConfigService,
    private readonly search: SearchService,
  ) {
    this.url =
      (config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000').replace(
        /\/$/,
        '',
      ) + '/search/image';
    const timeout = Number(config.get<string>('AI_SEARCH_TIMEOUT_MS') ?? 10000);
    this.timeoutMs =
      Number.isFinite(timeout) && timeout > 0 && timeout <= 30000
        ? timeout
        : 10000;
  }

  async image(file: UploadedImage | undefined, raw: unknown) {
    const options = parseImageSearchOptions(raw);
    if (!file?.buffer?.length)
      throw new BadRequestException('Image is required');
    if (file.buffer.length > IMAGE_SEARCH_MAX_BYTES)
      throw new PayloadTooLargeException('Image exceeds 5 MiB');
    const format = file.buffer
      .subarray(0, 3)
      .equals(Buffer.from([255, 216, 255]))
      ? 'jpeg'
      : file.buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : null;
    if (!format || file.mimetype !== `image/${format}`)
      throw new UnsupportedMediaTypeException(
        'Only JPEG or PNG images are supported',
      );
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const image = sharp(file.buffer, {
        failOn: 'error',
        limitInputPixels: 25000000,
        sequentialRead: true,
      }).timeout({ seconds: 2 });
      const metadata = await image.metadata();
      if (
        metadata.format !== format ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error('Invalid image');
      await image.stats();
    } catch {
      throw new BadRequestException('Invalid or oversized image dimensions');
    }
    const form = new FormData();
    // Never forward a client filename or write a query image to uploads/disk/logs.
    form.set(
      'image',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      `query.${format}`,
    );
    form.set('topK', String(options.topK));
    form.set('candidateK', String(options.candidateK));
    let rawResponse: unknown;
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        body: form,
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ServiceUnavailableException(
          'Image search is temporarily unavailable',
        );
      }
      if (
        response.headers
          .get('content-type')
          ?.toLowerCase()
          .split(';')[0]
          .trim() !== 'application/json' ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new BadGatewayException('Invalid image search response');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_RESPONSE_BYTES)
            throw new BadGatewayException('Image search response too large');
          chunks.push(next.value);
        }
        rawResponse = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        if (signal.aborted)
          throw new ServiceUnavailableException('Image search timed out');
        if (error instanceof BadGatewayException) throw error;
        throw new BadGatewayException('Invalid image search JSON');
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        'Image search is temporarily unavailable',
      );
    }
    const response = validateImageSearchResponse(rawResponse, options);
    return this.search.hydrate(response, { topK: options.topK });
  }
}
