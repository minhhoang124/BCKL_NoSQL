import { Injectable } from '@nestjs/common';
import type { EmailConfig, EmailOutcome } from './notification-email-policy.js';
export type EmailPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};
@Injectable()
export class NotificationEmailTransport {
  async send(
    config: EmailConfig,
    payload: EmailPayload,
    key: string,
  ): Promise<EmailOutcome> {
    try {
      const local = config.provider === 'mailpit';
      const response = await fetch(
        local
          ? 'http://127.0.0.1:8025/api/v1/send'
          : 'https://api.resend.com/emails',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          headers: local
            ? { 'Content-Type': 'application/json' }
            : {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.key}`,
                'Idempotency-Key': key,
              },
          body: JSON.stringify(
            local
              ? {
                  From: { Email: payload.from },
                  To: payload.to.map((Email) => ({ Email })),
                  Subject: payload.subject,
                  Text: payload.text,
                }
              : payload,
          ),
        },
      );
      if (response.ok) {
        // Cap response bytes before decoding; no arbitrary provider response in DB/logs.
        const reader = response.body?.getReader();
        let raw = '',
          size = 0;
        if (!reader) return { kind: 'unknown', code: 'EMAIL_RESPONSE_INVALID' };
        try {
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            size += r.value.length;
            if (size > 8192)
              return { kind: 'unknown', code: 'EMAIL_RESPONSE_INVALID' };
            raw += new TextDecoder().decode(r.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          return { kind: 'unknown', code: 'EMAIL_RESPONSE_INVALID' };
        }
        const id =
          data && typeof data === 'object'
            ? (data as Record<string, unknown>)[local ? 'ID' : 'id']
            : null;
        return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
          ? { kind: 'accepted', id }
          : { kind: 'unknown', code: 'EMAIL_RESPONSE_INVALID' };
      }
      await response.body?.cancel();
      if (response.status === 429)
        return { kind: 'retry', code: 'EMAIL_RATE_LIMITED' };
      if (
        response.status === 408 ||
        response.status >= 500 ||
        response.status === 409
      )
        return { kind: 'unknown', code: 'EMAIL_PROVIDER_UNCONFIRMED' };
      return { kind: 'failed', code: 'EMAIL_PROVIDER_REJECTED' };
    } catch {
      return { kind: 'unknown', code: 'EMAIL_TRANSPORT_UNCONFIRMED' };
    }
  }
}
