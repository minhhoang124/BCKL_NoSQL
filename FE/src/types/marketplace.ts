export type StoreStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'CLOSED';

export interface Store {
  id: number;
  name: string;
  description: string | null;
  status: StoreStatus;
  application?: { revision: number } | null;
  seller?: { id: number; email: string; fullName: string | null };
  statusHistory?: Array<{ id: number; toStatus: StoreStatus; reason: string | null; createdAt: string }>;
}

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  isLeaf: boolean;
  children: Category[];
}

export interface Brand { id: number; name: string; slug: string }
export interface ProductImage { id: number; url: string; isPrimary: boolean; sortOrder: number }
export interface ProductVariant {
  id: number;
  price: string;
  stock?: number;
  inStock?: boolean;
  sellerSku?: string | null;
  optionValueIds?: number[];
  optionSignature?: string;
  skuCode?: string;
  isActive?: boolean;
}

export interface ProductOptionGroup { id: number; name: string; position: number; values: Array<{ id: number; value: string; position: number }> }
export interface ProductAttributeValue { attributeDefinitionId: number; optionId: number | null; textValue: string | null; numberValue: string | null; booleanValue: boolean | null }
export interface AttributeDefinition {
  id: number; name: string; dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT'; isRequired: boolean; allowsCustom: boolean;
  options: Array<{ id: number; value: string }>;
}
export interface AttributeInput { optionId?: number; textValue?: string; numberValue?: string; booleanValue?: boolean }

export interface Product {
  id: number;
  name: string;
  description: string | null;
  version?: number;
  sellerStatus?: 'DRAFT' | 'ACTIVE' | 'HIDDEN';
  moderationStatus?: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'FROZEN';
  rejectionReason?: string | null;
  store?: { id: number; name: string };
  category: { id: number; name: string; slug: string };
  brand: Brand | null;
  images: ProductImage[];
  variants: ProductVariant[];
  optionGroups?: ProductOptionGroup[];
  attributeValues?: ProductAttributeValue[];
  minPrice?: string | null;
  maxPrice?: string | null;
  inStock?: boolean;
  attributes?: Array<{ id: number; name: string; value: string | number | boolean | null }>;
  shippingProfile?: { packageWeightGrams: number } | null;
}

export interface Page<T> { items: T[]; nextCursor: number | null }
export interface SearchItem { productId: number; rank: number; score: number; product: Product }
export interface SearchResponse { items: SearchItem[]; responseTimeMs: number; analytics?: {token:string} }
