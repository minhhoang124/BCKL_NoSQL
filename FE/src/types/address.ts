export interface Address {
  id: number;
  recipientName: string;
  phone: string;
  province: string;
  district: string | null;
  ward: string;
  addressLine: string;
  postalCode: string | null;
  deliveryNote: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AddressInput = Pick<Address, 'recipientName' | 'phone' | 'province' | 'ward' | 'addressLine'> &
  Partial<Pick<Address, 'district' | 'postalCode' | 'deliveryNote' | 'isDefault'>>;

export interface AddressList { items: Address[] }
