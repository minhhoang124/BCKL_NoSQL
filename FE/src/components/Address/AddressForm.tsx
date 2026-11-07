import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Address, AddressInput } from '../../types/address';
import styles from '../../pages/AddressBookPage.module.css';

interface Props {
  address: Address | null;
  disabled: boolean;
  saving: boolean;
  onSave: (body: AddressInput) => void;
  onCancel: () => void;
}

const fields = [
  { name: 'recipientName', label: 'Họ và tên người nhận', max: 100, required: true, autoComplete: 'name' },
  { name: 'phone', label: 'Số điện thoại', max: 20, required: true, autoComplete: 'tel' },
  { name: 'province', label: 'Tỉnh / thành phố', max: 100, required: true, autoComplete: 'address-level1' },
  { name: 'ward', label: 'Phường / xã', max: 100, required: true, autoComplete: 'address-level2' },
  { name: 'district', label: 'Quận / huyện (tùy chọn)', max: 100, required: false, autoComplete: 'off' },
  { name: 'postalCode', label: 'Mã bưu chính (tùy chọn)', max: 20, required: false, autoComplete: 'postal-code' },
  { name: 'addressLine', label: 'Địa chỉ cụ thể', max: 255, required: true, autoComplete: 'street-address' },
  { name: 'deliveryNote', label: 'Ghi chú giao hàng (tùy chọn)', max: 500, required: false, autoComplete: 'off' },
] as const;
type Field = typeof fields[number]['name'];

export function AddressForm({ address, disabled, saving, onSave, onCancel }: Props) {
  const [values, setValues] = useState<Record<Field, string>>(() => Object.fromEntries(
    fields.map(({ name }) => [name, address?.[name] ?? '']),
  ) as Record<Field, string>);
  const [isDefault, setDefault] = useState(address?.isDefault ?? false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    const nextErrors: Partial<Record<Field, string>> = {};
    for (const field of fields) {
      const value = values[field.name].trim();
      if ((field.required && !value) || (values[field.name] && !value)) {
        nextErrors[field.name] = 'Vui lòng nhập nội dung, không chỉ khoảng trắng.';
      } else if (value.length > field.max) {
        nextErrors[field.name] = `Tối đa ${field.max} ký tự.`;
      }
    }
    const phone = values.phone.trim();
    const digitCount = phone.replace(/[^0-9]/g, '').length;
    if (phone && (phone.length < 8 || phone.length > 20 || !/^[0-9+() .-]+$/.test(phone) || digitCount < 8 || digitCount > 15)) {
      nextErrors.phone = 'Nhập 8–20 ký tự, có 8–15 chữ số; có thể dùng + ( ) . - và khoảng trắng.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const body: AddressInput = {
      recipientName: values.recipientName.trim(), phone,
      province: values.province.trim(), ward: values.ward.trim(), addressLine: values.addressLine.trim(),
      district: values.district.trim() || null,
      postalCode: values.postalCode.trim() || null,
      deliveryNote: values.deliveryNote.trim() || null,
    };
    // Never unset a default: another address must be chosen instead.
    if (!address?.isDefault) body.isDefault = isDefault;
    onSave(body);
  };

  return <section className={styles.formPanel} aria-labelledby="address-form-title">
    <h2 id="address-form-title">{address ? 'Chỉnh sửa địa chỉ' : 'Thêm địa chỉ nhận hàng mới'}</h2>
    <p className={styles.hint}>Các trường có * là bắt buộc. Quận / huyện chỉ dành cho địa chỉ cũ nếu cần.</p>
    <form onSubmit={submit} noValidate aria-label="Thông tin địa chỉ">
      <fieldset disabled={disabled} className={styles.fieldset}>
        <div className={styles.formGrid}>
          {fields.map((field) => <div key={field.name} className={field.name === 'addressLine' || field.name === 'deliveryNote' ? styles.wide : undefined}>
            <label htmlFor={`address-${field.name}`}>{field.label}{field.required ? ' *' : ''}</label>
            {field.name === 'deliveryNote' ? <textarea id={`address-${field.name}`} rows={3} maxLength={field.max}
              value={values[field.name]} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `error-${field.name}` : undefined}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} /> :
              <input id={`address-${field.name}`} type={field.name === 'phone' ? 'tel' : 'text'}
                autoComplete={field.autoComplete} required={field.required} maxLength={field.max}
                value={values[field.name]} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `error-${field.name}` : undefined}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />}
            {errors[field.name] && <p id={`error-${field.name}`} className={styles.fieldError}>{errors[field.name]}</p>}
          </div>)}
        </div>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isDefault} disabled={address?.isDefault} onChange={(event) => setDefault(event.target.checked)} />
          {address?.isDefault ? 'Đây là địa chỉ mặc định' : 'Đặt làm địa chỉ mặc định'}
        </label>
        <div className={styles.actions}>
          <button type="button" onClick={onCancel}>Hủy</button>
          <button type="submit" className={styles.primary}>{saving ? 'Đang lưu...' : 'Lưu địa chỉ'}</button>
        </div>
      </fieldset>
    </form>
  </section>;
}
