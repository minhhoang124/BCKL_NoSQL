import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthEmailToken, Prisma, User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { credentialMatches } from './credential-version.js';
import { AuthEmailDelivery } from './email-delivery.js';
import { emailTokenHash, invalidEmailToken } from './email-recovery.input.js';
import { bindingHash, passwordChangeMode } from './password-change-email.input.js';

const PURPOSE = 'CHANGE_PASSWORD';
const TTL_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const USER_LIMIT = 3;
const IP_LIMIT = 20;

const otherDevice = () =>
  new ConflictException({
    code: 'PASSWORD_CHANGE_OTHER_BROWSER',
    message:
      'Hãy mở liên kết trên đúng trình duyệt đã gửi yêu cầu, hoặc gửi yêu cầu mới từ trình duyệt này.',
  });

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name!.slice(0, 2)}***@${domain}`;
}

/**
 * Email-confirmed password change for a signed-in user. Steps:
 * 1. request: current password re-authentication + verified email; issues a
 *    one-time CHANGE_PASSWORD token (hash only, 15 min) bound to the user,
 *    credential version, email and a browser-held binding secret.
 * 2. verify: non-consuming check so the UI only opens the form for a live link.
 * 3. confirm: everything re-checked under the User/token locks; password,
 *    credential version, refresh tokens, other email tokens and audit change
 *    atomically. GET never consumes or changes anything.
 */
@Injectable()
export class PasswordChangeEmailService {
  private readonly logger = new Logger(PasswordChangeEmailService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly mail: AuthEmailDelivery,
  ) {}

  private gate(delivery = false) {
    if (passwordChangeMode() !== 'EMAIL')
      throw new ServiceUnavailableException({
        code: 'PASSWORD_CHANGE_EMAIL_DISABLED',
        message: 'Đổi mật khẩu qua email chưa được bật.',
      });
    const secret = process.env.AUTH_EMAIL_HMAC_SECRET ?? '';
    if (process.env.AUTH_EMAIL_ENABLED !== 'true')
      throw new ServiceUnavailableException({ code: 'AUTH_EMAIL_DISABLED' });
    if (Buffer.byteLength(secret) < 32)
      throw new ServiceUnavailableException({
        code: 'AUTH_EMAIL_NOT_CONFIGURED',
      });
    if (delivery) this.mail.configured();
    return secret;
  }

  private assertActor(actor: AuthenticatedUser, user: User | null): User {
    if (
      !user?.isActive ||
      !credentialMatches(actor.credentialVersion, user.credentialVersion)
    )
      throw new UnauthorizedException();
    return user;
  }

  private async consumeRate(
    tx: Prisma.TransactionClient,
    secret: string,
    userId: number,
    ip: string,
    now: Date,
  ) {
    const window = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
    const buckets = [
      { key: `${PURPOSE}:USER:${userId}`, limit: USER_LIMIT },
      { key: `${PURPOSE}:IP:${ip}`, limit: IP_LIMIT },
    ]
      .map((b) => ({
        key: createHmac('sha256', secret).update(b.key).digest('hex'),
        limit: b.limit,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    let allowed = true;
    for (const bucket of buckets) {
      const [row] = await tx.$queryRaw<{ count: number }[]>`
        INSERT INTO auth_email_rates (key,"windowStartedAt",count) VALUES (${bucket.key},${window},1)
        ON CONFLICT (key) DO UPDATE SET "windowStartedAt"=EXCLUDED."windowStartedAt",
          count=CASE WHEN auth_email_rates."windowStartedAt"=EXCLUDED."windowStartedAt"
            THEN LEAST(auth_email_rates.count+1,1000000) ELSE 1 END
        RETURNING count`;
      if (row!.count > bucket.limit) allowed = false;
    }
    return allowed;
  }

  async request(actor: AuthenticatedUser, currentPassword: string, ip: string) {
    const secret = this.gate(true);
    const snapshot = this.assertActor(
      actor,
      await this.db.user.findUnique({ where: { id: actor.userId } }),
    );
    if (!snapshot.emailVerifiedAt)
      throw new ConflictException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Hãy xác minh email trước khi đổi mật khẩu qua email.',
      });
    // Rate limit BEFORE bcrypt so the endpoint cannot be used to guess passwords.
    const allowed = await this.db.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      return this.consumeRate(tx, secret, snapshot.id, ip, clock!.now);
    });
    if (!allowed)
      throw new HttpException(
        {
          code: 'PASSWORD_CHANGE_RATE_LIMITED',
          message: 'Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau 15 phút.',
        },
        429,
      );
    if (!(await compare(currentPassword, snapshot.passwordHash)))
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INVALID',
        message:
          'Mật khẩu hiện tại không đúng. Tài khoản chỉ đăng nhập bằng Google hãy dùng “Quên mật khẩu” để đặt mật khẩu.',
      });
    const token = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    let issued: { id: string; email: string; expiresAt: Date };
    try {
      issued = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
          await tx.$queryRaw`SELECT id FROM users WHERE id=${snapshot.id} FOR UPDATE`;
          const u = this.assertActor(
            actor,
            await tx.user.findUnique({ where: { id: snapshot.id } }),
          );
          if (
            u.passwordHash !== snapshot.passwordHash ||
            u.email !== snapshot.email ||
            !u.emailVerifiedAt
          )
            throw new UnauthorizedException();
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          // Only the newest change link stays usable.
          await tx.authEmailToken.updateMany({
            where: {
              userId: u.id,
              purpose: PURPOSE,
              usedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: clock!.now },
          });
          return tx.authEmailToken.create({
            data: {
              userId: u.id,
              purpose: PURPOSE,
              tokenHash: emailTokenHash(token),
              bindingHash: bindingHash(binding),
              email: u.email,
              credentialVersion: u.credentialVersion,
              createdAt: clock!.now,
              expiresAt: new Date(clock!.now.getTime() + TTL_MS),
            },
            select: { id: true, email: true, expiresAt: true },
          });
        },
        { maxWait: 2000, timeout: 5000 },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: 'PASSWORD_CHANGE_REQUEST_UNCERTAIN',
        message: 'Chưa gửi được yêu cầu. Vui lòng thử lại.',
      });
    }
    // After commit, never inside the lock; token is never logged or stored raw.
    this.mail.enqueue(issued.email, token, PURPOSE, issued.id);
    return {
      status: 'CHANGE_EMAIL_SENT' as const,
      email: maskEmail(issued.email),
      expiresAt: issued.expiresAt.toISOString(),
      // Keep only in this browser (e.g. sessionStorage); required to confirm.
      bindingSecret: binding,
    };
  }

  /** Shared pre-lock validation; never consumes. */
  private async precheck(
    actor: AuthenticatedUser,
    token: string,
    binding: string,
  ) {
    const [clock] = await this.db.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    const row = await this.db.authEmailToken.findUnique({
      where: { tokenHash: emailTokenHash(token) },
      include: { user: true },
    });
    if (
      !row ||
      row.purpose !== PURPOSE ||
      row.userId !== actor.userId ||
      row.usedAt ||
      row.revokedAt ||
      row.expiresAt <= clock!.now ||
      !row.user.isActive ||
      row.email !== row.user.email ||
      row.credentialVersion !== row.user.credentialVersion ||
      !credentialMatches(actor.credentialVersion, row.user.credentialVersion)
    )
      throw invalidEmailToken();
    if (row.bindingHash !== bindingHash(binding)) throw otherDevice();
    return row as AuthEmailToken & { user: User };
  }

  async verify(actor: AuthenticatedUser, token: string, binding: string) {
    this.gate();
    const row = await this.precheck(actor, token, binding);
    return { status: 'VALID' as const, expiresAt: row.expiresAt.toISOString() };
  }

  async confirm(
    actor: AuthenticatedUser,
    token: string,
    binding: string,
    newPassword: string,
  ) {
    this.gate();
    const snapshot = await this.precheck(actor, token, binding);
    // bcrypt only after a live, bound token; never under the User lock.
    if (await compare(newPassword, snapshot.user.passwordHash))
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
      });
    const nextHash = await hash(newPassword, 12);
    try {
      await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
          await tx.$queryRaw`SELECT id FROM users WHERE id=${snapshot.userId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM auth_email_tokens WHERE id=${snapshot.id}::uuid FOR UPDATE`;
          const u = await tx.user.findUniqueOrThrow({
            where: { id: snapshot.userId },
          });
          const current = await tx.authEmailToken.findUniqueOrThrow({
            where: { id: snapshot.id },
          });
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          if (
            !u.isActive ||
            u.email !== current.email ||
            u.credentialVersion !== current.credentialVersion ||
            u.passwordHash !== snapshot.user.passwordHash ||
            !credentialMatches(actor.credentialVersion, u.credentialVersion) ||
            current.purpose !== PURPOSE ||
            current.userId !== actor.userId ||
            current.bindingHash !== bindingHash(binding) ||
            current.usedAt ||
            current.revokedAt ||
            current.expiresAt <= clock!.now
          )
            throw invalidEmailToken();
          if (u.credentialVersion === 2147483647)
            throw new ServiceUnavailableException({
              code: 'AUTH_VERSION_EXHAUSTED',
            });
          await tx.authEmailToken.update({
            where: { id: current.id },
            data: { usedAt: clock!.now },
          });
          await tx.user.update({
            where: { id: u.id },
            data: { passwordHash: nextHash, credentialVersion: { increment: 1 } },
          });
          await tx.refreshToken.updateMany({
            where: { userId: u.id, revokedAt: null },
            data: { revokedAt: clock!.now },
          });
          await tx.authEmailToken.updateMany({
            where: { userId: u.id, usedAt: null, revokedAt: null },
            data: { revokedAt: clock!.now },
          });
          await tx.accountSecurityEvent.create({
            data: {
              userId: u.id,
              event: 'PASSWORD_CHANGED',
              fromVersion: u.credentialVersion,
              toVersion: u.credentialVersion + 1,
            },
          });
        },
        { maxWait: 3000, timeout: 7000 },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn('PASSWORD_CHANGE_CONFIRM_UNCERTAIN');
      throw new ServiceUnavailableException({
        code: 'AUTH_EMAIL_CONFIRM_UNCERTAIN',
        message:
          'Chưa rõ kết quả. Hãy thử đăng nhập bằng mật khẩu mới; không tự gửi lại thao tác.',
      });
    }
    return {
      status: 'PASSWORD_CHANGED' as const,
      reauthenticationRequired: true as const,
    };
  }
}
