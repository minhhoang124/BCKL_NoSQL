import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto, UpdateAddressDto } from './address.dto.js';
import { AddressIdPipe } from './address-http.js';

const valid = {
  recipientName: 'Buyer',
  phone: '0901234567',
  province: 'HCM',
  ward: 'Ward',
  addressLine: '12 Street',
};

describe('Address validation', () => {
  it('trims strings and permits omitted or null optional fields', async () => {
    const dto = plainToInstance(CreateAddressDto, {
      ...valid,
      recipientName: ' Buyer ',
      district: null,
      postalCode: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.recipientName).toBe('Buyer');
  });

  it.each([
    'recipientName',
    'phone',
    'province',
    'ward',
    'addressLine',
    'isDefault',
  ])('rejects mandatory/type-sensitive %s=null on PATCH', async (field) => {
    expect(
      (await validate(plainToInstance(UpdateAddressDto, { [field]: null })))
        .length,
    ).toBeGreaterThan(0);
  });

  it.each([
    'recipientName',
    'phone',
    'province',
    'ward',
    'addressLine',
    'district',
    'postalCode',
    'deliveryNote',
  ])('rejects whitespace %s', async (field) => {
    expect(
      (await validate(plainToInstance(UpdateAddressDto, { [field]: '  ' })))
        .length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['recipientName', 100],
    ['province', 100],
    ['ward', 100],
    ['district', 100],
    ['addressLine', 255],
    ['postalCode', 20],
    ['deliveryNote', 500],
  ] as const)('checks %s length boundary', async (field, max) => {
    expect(
      await validate(
        plainToInstance(UpdateAddressDto, { [field]: 'a'.repeat(max) }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateAddressDto, { [field]: 'a'.repeat(max + 1) }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it.each(['12345678', '+1 (234) 567-8901', '123456789012345'])(
    'accepts phone %s',
    async (phone) => {
      expect(
        await validate(plainToInstance(CreateAddressDto, { ...valid, phone })),
      ).toHaveLength(0);
    },
  );
  it.each([
    '1234567',
    '1234567890123456',
    '٠٩٠١٢٣٤٥٦٧',
    '090abc1234567',
    '+'.repeat(21),
    'true',
  ])('rejects phone %s', async (phone) => {
    expect(
      (await validate(plainToInstance(CreateAddressDto, { ...valid, phone })))
        .length,
    ).toBeGreaterThan(0);
  });

  it('rejects unknown fields and wrong primitive types through real ValidationPipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    for (const payload of [
      { ...valid, userId: 123 },
      { ...valid, isDefault: 'false' },
      { ...valid, phone: 901234567 },
    ])
      await expect(
        pipe.transform(payload, { type: 'body', metatype: CreateAddressDto }),
      ).rejects.toThrow();
  });

  it.each(['0', '-1', '1.5', '1e2', '2147483648', 'abc', ''])(
    'rejects ID %s',
    (id) => {
      expect(() => new AddressIdPipe().transform(id)).toThrow();
    },
  );
});
