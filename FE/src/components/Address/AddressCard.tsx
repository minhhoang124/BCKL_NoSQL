import type { Address } from '../../types/address';
import styles from '../../pages/AddressBookPage.module.css';

interface Props {
  address: Address;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDefault: () => void;
}

export function AddressCard({ address, disabled, onEdit, onDelete, onDefault }: Props) {
  return <article className={styles.card} aria-label={`Địa chỉ của ${address.recipientName}`}>
    <div className={styles.cardHeading}>
      <h2>{address.recipientName}</h2>
      {address.isDefault && <span className={styles.badge}>Mặc định</span>}
    </div>
    <p className={styles.phone}>{address.phone}</p>
    <p>{[address.addressLine, address.ward, address.district, address.province].filter(Boolean).join(', ')}</p>
    {address.postalCode && <p>Mã bưu chính: {address.postalCode}</p>}
    {address.deliveryNote && <p className={styles.note}>Ghi chú: {address.deliveryNote}</p>}
    <div className={styles.actions}>
      {!address.isDefault && <button type="button" disabled={disabled} onClick={onDefault}>Đặt làm mặc định</button>}
      <button type="button" disabled={disabled} onClick={onEdit}>Chỉnh sửa</button>
      <button type="button" className={styles.danger} disabled={disabled} onClick={onDelete}>Xóa</button>
    </div>
  </article>;
}
