import { createHash } from 'node:crypto';
import { isEmail } from 'class-validator';
import { notificationAudiences } from './notification-input.js';

export const EMAIL_KINDS = ['ORDER', 'STORE', 'PRODUCT', 'AFTERSALE'];
export const EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export type EmailConfig = {
  provider: 'resend' | 'mailpit';
  key: string;
  from: string;
  origin: string;
  startAt: Date;
  fingerprint: string;
};
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function emailConfig(env = process.env): EmailConfig {
  const provider = env.NOTIFICATION_EMAIL_PROVIDER,
    from = env.NOTIFICATION_EMAIL_FROM ?? '',
    key = env.NOTIFICATION_EMAIL_API_KEY ?? '';
  const origin = new URL(env.NOTIFICATION_EMAIL_WEB_ORIGIN ?? '');
  const startAt = new Date(env.NOTIFICATION_EMAIL_START_AT ?? '');
  if (
    !['resend', 'mailpit'].includes(provider ?? '') ||
    !isEmail(from) ||
    from.length > 254 ||
    origin.origin.length > 300 ||
    /[\r\n]/.test(from) ||
    !Number.isFinite(startAt.getTime()) ||
    startAt.toISOString() !== env.NOTIFICATION_EMAIL_START_AT ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(
        env.NODE_ENV !== 'production' &&
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname)
      ))
  )
    throw Error('NOTIFICATION_EMAIL_NOT_CONFIGURED');
  if (provider === 'resend' && (key.length < 20 || /[\r\n]/.test(key)))
    throw Error('NOTIFICATION_EMAIL_NOT_CONFIGURED');
  if (provider === 'mailpit') {
    const db = new URL(env.DATABASE_URL ?? '');
    if (
      env.NODE_ENV === 'production' ||
      env.NOTIFICATION_EMAIL_LOCAL_SANDBOX_ENABLED !== 'true' ||
      origin.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(origin.hostname) ||
      db.protocol !== 'postgresql:' ||
      db.hostname !== '127.0.0.1' ||
      db.port !== '5549' ||
      db.username !== 'bckl_qa_app_20261021' ||
      !/^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/.test(db.pathname) ||
      db.hash ||
      [...db.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public') ||
      db.searchParams.getAll('schema').length > 1
    )
      throw Error('NOTIFICATION_EMAIL_NOT_CONFIGURED');
  }
  return {
    provider: provider as EmailConfig['provider'],
    key,
    from,
    origin: origin.origin,
    startAt,
    fingerprint: digest([
      provider,
      from,
      origin.origin,
      provider === 'resend' ? digest(key) : 'LOCAL_NO_RELAY',
    ]),
  };
}
export function eligibleEmail(
  user: {
    isActive: boolean;
    email: string;
    emailVerifiedAt: Date | null;
    role: string;
  },
  audience: string,
) {
  return (
    user.isActive &&
    user.emailVerifiedAt !== null &&
    isEmail(user.email) &&
    !/[\r\n]/.test(user.email) &&
    notificationAudiences(user.role).some((x) => x === audience)
  );
}
export function emailPayload(
  config: Pick<EmailConfig, 'provider' | 'from' | 'origin'>,
  email: string,
  kind: string,
) {
  const title: Record<string, string> = {
    ORDER: 'Đơn hàng có cập nhật',
    STORE: 'Hồ sơ cửa hàng có cập nhật',
    PRODUCT: 'Kiểm duyệt sản phẩm có cập nhật',
    AFTERSALE: 'Yêu cầu hậu mãi có cập nhật',
  };
  if (!title[kind]) throw Error('NOTIFICATION_EMAIL_INVALID_SOURCE');
  return {
    from: config.from,
    to: [email],
    subject: `${config.provider === 'mailpit' ? '[QA LOCAL] ' : ''}BCKL — ${title[kind]}`,
    text: `${config.provider === 'mailpit' ? 'Hộp thư QA local; không gửi tới người nhận thật.\n\n' : ''}Bạn có thông báo mới trong BCKL. Đăng nhập để xem nội dung và trạng thái hiện tại:\n${config.origin}/account/notifications\nEmail này không thay thế trạng thái nghiệp vụ trong ứng dụng.`,
  };
}
export type EmailOutcome =
  | { kind: 'accepted'; id: string }
  | { kind: 'retry' | 'unknown' | 'failed'; code: string };
export function retryAllowed(
  provider: string,
  firstDispatchAt: Date | null,
  now: Date,
) {
  return (
    provider === 'resend' &&
    firstDispatchAt !== null &&
    now.getTime() >= firstDispatchAt.getTime() &&
    now.getTime() - firstDispatchAt.getTime() < EMAIL_RETRY_WINDOW_MS
  );
}
export function retryDelayMs(attempt: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}
