import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
const bad = (): never => {
  throw new BadRequestException({ code: 'VNPAY_INVALID_INPUT' });
};
export function vnpayOrderId(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !/^[1-9][0-9]{0,9}$/.test(raw) ||
    Number(raw) > 2147483647
  )
    return bad();
  return Number(raw);
}
export function vnpayConsent(raw: unknown) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== 1 ||
    !Object.hasOwn(raw, 'confirmed') ||
    (raw as { confirmed?: unknown }).confirmed !== true
  )
    return bad();
}
export function vnpayAmount(raw: string) {
  if (!/^[1-9][0-9]{0,9}\.00$/.test(raw)) return bad();
  const n = BigInt(raw.slice(0, -3));
  if (n > 9999999999n) return bad();
  return { vnd: Number(n), minor: (n * 100n).toString() };
}
const allowed = new Set([
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_BankTranNo',
  'vnp_CardType',
  'vnp_PayDate',
  'vnp_OrderInfo',
  'vnp_TransactionNo',
  'vnp_ResponseCode',
  'vnp_TransactionStatus',
  'vnp_TxnRef',
  'vnp_TmnCode',
  'vnp_SecureHash',
]);
export function vnpayQuery(originalUrl: string) {
  if (originalUrl.length > 8192 || !originalUrl.includes('?')) return bad();
  const raw = originalUrl.slice(originalUrl.indexOf('?') + 1);
  if (/%(?![0-9a-f]{2})/i.test(raw)) return bad();
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    if (
      !allowed.has(k) ||
      Object.hasOwn(out, k) ||
      (!v &&
        ![
          'vnp_BankTranNo',
          'vnp_CardType',
          'vnp_PayDate',
          'vnp_BankCode',
        ].includes(k)) ||
      v.length > 255 ||
      // oxlint-disable-next-line no-control-regex -- Reject protocol control characters in signed provider fields.
      /[\u0000-\u001f\u007f\ufffd]/u.test(v)
    )
      return bad();
    out[k] = v;
  }
  for (const k of [
    'vnp_Amount',
    'vnp_TxnRef',
    'vnp_TmnCode',
    'vnp_TransactionNo',
    'vnp_ResponseCode',
    'vnp_TransactionStatus',
    'vnp_SecureHash',
  ])
    if (!out[k]) return bad();
  if (
    !/^[1-9][0-9]{0,11}$/.test(out.vnp_Amount!) ||
    !/^[a-f0-9]{32}$/.test(out.vnp_TxnRef!) ||
    !/^[A-Z0-9]{8}$/.test(out.vnp_TmnCode!) ||
    !/^[0-9]{1,15}$/.test(out.vnp_TransactionNo!) ||
    !/^[0-9]{2}$/.test(out.vnp_ResponseCode!) ||
    !/^[0-9]{2}$/.test(out.vnp_TransactionStatus!) ||
    !/^[a-f0-9]{128}$/i.test(out.vnp_SecureHash!)
  )
    return bad();
  if (out.vnp_PayDate && !/^[0-9]{14}$/.test(out.vnp_PayDate)) return bad();
  return out;
}
export function vnpayDate(d: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/[^0-9]/g, '');
}
export function vnpayPaidAt(s: string | undefined) {
  if (!s || !/^[0-9]{14}$/.test(s)) return null;
  const d = new Date(
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+07:00`,
  );
  return Number.isFinite(d.getTime()) && vnpayDate(d) === s ? d : null;
}
export function notificationDigest(q: Record<string, string>) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(q)
          .filter(([k]) => k !== 'vnp_SecureHash')
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex');
}
