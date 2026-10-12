export type CartUnavailableReason =
  | 'PRODUCT_UNAVAILABLE'
  | 'VARIANT_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_STOCK';

export interface CartItem {
  variantId: number;
  quantity: number;
  available: boolean;
  unavailableReason: CartUnavailableReason | null;
  productId?: number;
  productName?: string;
  imageUrl?: string;
  optionValues?: string[];
  currentUnitPrice?: string;
  stock?: number;
}

export interface CartGroup {
  store: { id: number; name: string };
  items: CartItem[];
  purchasableSubtotal: string;
}

export interface CartResponse {
  groups: CartGroup[];
  unavailableItems: CartItem[];
  lineCount: number;
  totalQuantity: number;
  purchasableSubtotal: string;
}
