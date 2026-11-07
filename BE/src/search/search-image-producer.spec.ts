import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingProduct } from '../product/product-public-policy.js';
import { buildUpsertPayload, SearchOutboxService } from './search-outbox.service.js';

function listing(urls: string[]): ListingProduct {
  return {
    id: 123, version: 2, name: 'Synthetic product', categoryId: 1,
    store: { id: 9, name: 'Synthetic store' },
    category: { id: 1, name: 'Test', slug: 'test' }, brand: null,
    attributeValues: [], optionGroups: [],
    variants: [{ isActive: true, price: new Prisma.Decimal('10000'), stock: 1, optionValueLinks: [] }],
    images: urls.map((url, index) => ({ id: index + 1, url, sortOrder: index, isPrimary: index === 1 })),
  } as unknown as ListingProduct;
}
afterEach(() => vi.unstubAllEnvs());
describe('Search producer media boundary', () => {
  it('keeps primary image first and max10, resolves only new payload, leaves source URLs unchanged', () => {
    const urls = Array.from({ length: 12 }, (_, index) => `/uploads/${index}.png`);
    const product = listing(urls), before = product.images.map(image => image.url);
    const payload = buildUpsertPayload(product, [{ id: 1, parentId: null, isActive: true }], 'https://media.example.test') as Record<string, unknown>;
    expect(payload.imageUrls).toEqual([1, 0, 2, 3, 4, 5, 6, 7, 8, 9].map(id => `https://media.example.test/uploads/${id}.png`));
    expect(product.images.map(image => image.url)).toEqual(before);
  });
  it('returns safe product/image context for invalid catalog data without URL or credential leak', () => {
    try {
      buildUpsertPayload(listing(['/uploads/ok.png', 'http://private-user:private-password@media.example.test/bad.png']), [{ id: 1, parentId: null, isActive: true }], 'https://media.example.test');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse();
      expect(body).toMatchObject({ code: 'SEARCH_IMAGE_URL_INVALID', productId: 123, imageIndex: 0 });
      expect(JSON.stringify(body)).not.toMatch(/private-user|private-password|media\.example/);
    }
  });
  it('fails server startup for invalid media configuration and accepts explicit production origin', () => {
    const service = new SearchOutboxService({} as never);
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BACKEND_PUBLIC_URL', undefined);
    expect(() => service.onModuleInit()).toThrow(InternalServerErrorException);
    vi.stubEnv('BACKEND_PUBLIC_URL', 'https://media.example.test');
    expect(() => service.onModuleInit()).not.toThrow();
  });
  it('does not misclassify configuration failure as a bad catalog URL', () => {
    expect(() => buildUpsertPayload(listing(['/uploads/ok.png']), [{ id: 1, parentId: null, isActive: true }], '')).toThrow(InternalServerErrorException);
  });
});
