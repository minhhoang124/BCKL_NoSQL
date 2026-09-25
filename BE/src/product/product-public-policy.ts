import { Prisma } from '@prisma/client';

// Shared by moderation, visibility and both public read endpoints.
export const listingInclude = {
  store: { include: { seller: { select: { isActive: true } } } },
  category: {
    include: {
      attributeDefinitions: { where: { isActive: true, isRequired: true } },
    },
  },
  brand: { select: { id: true, name: true, slug: true, isActive: true } },
  images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  shippingProfile: true,
  attributeValues: { include: { option: true, attributeDefinition: true } },
  optionGroups: {
    orderBy: { position: 'asc' },
    include: { values: { orderBy: { position: 'asc' } } },
  },
  variants: { orderBy: { id: 'asc' }, include: { optionValueLinks: true } },
} satisfies Prisma.ProductInclude;

export type ListingProduct = Prisma.ProductGetPayload<{
  include: typeof listingInclude;
}>;
export type CategoryNode = {
  id: number;
  parentId: number | null;
  isActive: boolean;
};

function displayVariants(product: ListingProduct) {
  return product.variants.filter(
    (variant) =>
      variant.isActive &&
      variant.price.gt(0) &&
      variant.optionValueLinks.length === product.optionGroups.length &&
      product.optionGroups.every((group) =>
        variant.optionValueLinks.some(
          (link) =>
            link.optionGroupId === group.id &&
            group.values.some((value) => value.id === link.optionValueId),
        ),
      ),
  );
}

export function listingProblems(
  product: ListingProduct,
  categories: CategoryNode[],
): string[] {
  const problems: string[] = [];
  if (product.store.status !== 'ACTIVE' || !product.store.seller.isActive)
    problems.push('Store/tài khoản không hoạt động');
  const nodes = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<number>();
  let id: number | null = product.categoryId;
  while (id !== null) {
    const node = nodes.get(id);
    if (!node?.isActive || seen.has(id)) {
      problems.push('Danh mục hoặc tổ tiên không hợp lệ');
      break;
    }
    seen.add(id);
    id = node.parentId;
  }
  if (
    categories.some(
      (category) =>
        category.parentId === product.categoryId && category.isActive,
    )
  )
    problems.push('Danh mục không phải lá');
  if (product.brand && !product.brand.isActive)
    problems.push('Thương hiệu không hoạt động');
  if (product.name.trim().length < 3)
    problems.push('Tên sản phẩm không hợp lệ');
  if (!product.images.some((image) => image.isPrimary))
    problems.push('Thiếu ảnh chính');
  if (!displayVariants(product).length)
    problems.push('Thiếu variant hoạt động có giá hợp lệ');
  if (!(
    product.shippingProfile &&
    (product.shippingProfile.packageWeightGrams ?? 0) > 0
  ))
    problems.push('Thiếu khối lượng kiện hàng');
  for (const definition of product.category.attributeDefinitions) {
    const value = product.attributeValues.find(
      (item) => item.attributeDefinitionId === definition.id,
    );
    let valid = false;
    if (value) {
      switch (definition.dataType) {
        case 'TEXT':
          valid = Boolean(value.textValue?.trim());
          break;
        case 'NUMBER':
          valid = value.numberValue !== null;
          break;
        case 'BOOLEAN':
          valid = value.booleanValue !== null;
          break;
        case 'SINGLE_SELECT':
          valid = Boolean(
            (value.option?.isActive &&
              value.option.attributeDefinitionId === definition.id) ||
            (definition.allowsCustom && value.textValue?.trim()),
          );
          break;
      }
    }
    if (!valid) problems.push(`Thiếu thuộc tính bắt buộc: ${definition.name}`);
  }
  return problems;
}

export function isPublicListing(
  product: ListingProduct,
  categories: CategoryNode[],
) {
  return (
    product.sellerStatus === 'ACTIVE' &&
    product.moderationStatus === 'APPROVED' &&
    listingProblems(product, categories).length === 0
  );
}

// Explicit allowlist: never return externalId, sellerId, source metadata, review
// reasons, internal SKU, private account fields or inactive variants to guests.
export function publicProduct(product: ListingProduct) {
  const variants = displayVariants(product);
  const prices = variants
    .map((variant) => variant.price)
    .sort((a, b) => a.comparedTo(b));
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    store: { id: product.store.id, name: product.store.name },
    category: {
      id: product.category.id,
      name: product.category.name,
      slug: product.category.slug,
    },
    brand: product.brand
      ? {
          id: product.brand.id,
          name: product.brand.name,
          slug: product.brand.slug,
        }
      : null,
    images: product.images.map(
      ({ id, url, sortOrder, isPrimary, productOptionValueId }) => ({
        id,
        url,
        sortOrder,
        isPrimary,
        productOptionValueId,
      }),
    ),
    attributes: product.attributeValues
      .filter(
        (value) =>
          value.attributeDefinition.isActive &&
          value.attributeDefinition.categoryId === product.categoryId,
      )
      .map((value) => ({
        id: value.attributeDefinitionId,
        name: value.attributeDefinition.name,
        value: value.option?.isActive
          ? value.option.value
          : (value.textValue ??
            value.numberValue?.toString() ??
            value.booleanValue),
      })),
    optionGroups: product.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      values: group.values.map(({ id, value }) => ({ id, value })),
    })),
    variants: variants.map((variant) => ({
      id: variant.id,
      price: variant.price.toString(),
      inStock: variant.stock > 0,
      optionValueIds: variant.optionValueLinks.map(
        (link) => link.optionValueId,
      ),
    })),
    minPrice: prices[0]?.toString() ?? null,
    maxPrice: prices.at(-1)?.toString() ?? null,
    inStock: variants.some((variant) => variant.stock > 0),
  };
}
