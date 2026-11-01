import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { MailPurpose } from './email-recovery.input.js';
@Injectable()
export class AuthEmailDelivery implements OnModuleDestroy {
  private readonly pending = new Set<Promise<void>>();
  private readonly logger = new Logger(AuthEmailDelivery.name);
  configured() {
    const key = process.env.AUTH_EMAIL_API_KEY ?? '',
      from = process.env.AUTH_EMAIL_FROM ?? '',
      origin = process.env.AUTH_EMAIL_WEB_ORIGIN ?? '';
    try {
      const u = new URL(origin);
      if (
        !isEmail(from) ||
        /[\r\n]/.test(from) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== '/' ||
        (u.protocol !== 'https:' &&
          !(
            process.env.NODE_ENV !== 'production' &&
            u.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(u.hostname)
          ))
      )
        throw Error();
      if (process.env.AUTH_EMAIL_PROVIDER === 'mailpit') {
        const db = new URL(process.env.DATABASE_URL ?? '');
        if (
          process.env.NODE_ENV === 'production' ||
          process.env.AUTH_EMAIL_LOCAL_SANDBOX_ENABLED !== 'true' ||
          (process.env.AUTH_EMAIL_MAILPIT_ORIGIN ?? 'http://127.0.0.1:8025') !==
            'http://127.0.0.1:8025' ||
          u.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost'].includes(u.hostname) ||
          db.protocol !== 'postgresql:' ||
          db.hostname !== '127.0.0.1' ||
          db.port !== '5549' ||
          db.username !== 'bckl_qa_app_20261021' ||
          !/^\/bckl_order_resolution_test_[a-z0-9_]+$/.test(db.pathname) ||
          db.hash ||
          [...db.searchParams].some(
            ([k, v]) => k !== 'schema' || v !== 'public',
          ) ||
          db.searchParams.getAll('schema').length > 1
        )
          throw Error();
        return {
          provider: 'mailpit' as const,
          key: '',
          from,
          origin: u.origin,
        };
      }
      if (process.env.AUTH_EMAIL_PROVIDER !== 'resend' || key.length < 20)
        throw Error();
      return { provider: 'resend' as const, key, from, origin: u.origin };
    } catch {
      throw new ServiceUnavailableException({
        code: 'AUTH_EMAIL_NOT_CONFIGURED',
      });
    }
  }
  enqueue(email: string, token: string, purpose: MailPurpose, id: string) {
    // No token in DB outbox or logs. Delivery is best effort after commit, never inside the User lock.
    // A restart can lose an in-memory send; request again after cooldown. No automatic token rotation.
    const job = Promise.resolve()
      .then(() => this.send(email, token, purpose, id))
      .catch(() => {
        this.logger.warn('AUTH_EMAIL_DELIVERY_UNCONFIRMED');
      });
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }
  async send(email: string, token: string, purpose: MailPurpose, id: string) {
    const config = this.configured();
    const [path, label] = {
      RESET_PASSWORD: ['reset-password', 'Đặt lại mật khẩu'],
      VERIFY_EMAIL: ['verify-email', 'Xác minh email'],
      // Fragment only: a mail scanner's GET never reaches the API with the token.
      CHANGE_PASSWORD: ['account/change-password', 'Xác nhận đổi mật khẩu'],
    }[purpose];
    const link = `${config.origin}/${path}#token=${token}`;
    const subject = `BCKL — ${label}`;
    const text =
      purpose === 'CHANGE_PASSWORD'
        ? `${label} bằng liên kết một lần, hiệu lực 15 phút:\n${link}\nMở liên kết trên đúng trình duyệt đã gửi yêu cầu. Nếu bạn không yêu cầu, hãy bỏ qua thư này và đổi mật khẩu ngay. Không chia sẻ liên kết.`
        : `${label} bằng liên kết một lần, hiệu lực 15 phút:\n${link}\nNếu bạn không yêu cầu, hãy bỏ qua thư này. Không chia sẻ liên kết.`;
    if (config.provider === 'mailpit') {
      const response = await fetch('http://127.0.0.1:8025/api/v1/send', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: config.from },
          To: [{ Email: email }],
          Subject: `[QA LOCAL] ${subject}`,
          Text: `Hộp thư thử nghiệm local; không gửi tới Gmail hoặc người nhận thật.\n\n${text}`,
        }),
      });
      await response.body?.cancel();
      if (!response.ok) throw Error('Local email capture unconfirmed');
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `auth-email-${id}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject,
        text,
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw Error('Email delivery unconfirmed');
  }
  async onModuleDestroy() {
    await Promise.allSettled(this.pending);
  }
}
