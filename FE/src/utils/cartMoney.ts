// Keep the Backend's decimal string exact when summing selected Cart rows.
export function parseCartMoney(value: string): bigint | null {
  if (!/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

export function formatCartMoney(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return `${new Intl.NumberFormat('vi-VN').format(whole)}${fraction ? `,${fraction.toString().padStart(2, '0')}` : ''} ₫`;
}
