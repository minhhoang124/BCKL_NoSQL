import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { credentialMatches } from './credential-version.js';
import { AuthEmailDelivery } from './email-delivery.js';
import {
  emailTokenHash,
  invalidEmailToken,
  type EmailPurpose,
} from './email-recovery.input.js';
@Injectable()
export class AuthEmailRecoveryService {
  private readonly logger = new Logger(AuthEmailRecoveryService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly mail: AuthEmailDelivery,
  ) {}
  private gate(delivery = false) {
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
  async status(actor: AuthenticatedUser) {
    this.gate();
    const u = await this.db.user.findUnique({ where: { id: actor.userId } });
    if (
      !u?.isActive ||
      !credentialMatches(actor.credentialVersion, u.credentialVersion)
    )
      throw new UnauthorizedException();
    return { email: u.email, verifiedAt: u.emailVerifiedAt };
  }
  async request(
    purpose: EmailPurpose,
    email: string | null,
    ip: string,
    actor?: AuthenticatedUser,
  ) {
    const secret = this.gate(true),
      start = Date.now(),
      minimum = 350 + randomInt(51);
    if (purpose === 'VERIFY_EMAIL') {
      const own = await this.status(actor!);
      email = own.email;
    }
    const token = randomBytes(32).toString('base64url'),
      tokenHash = emailTokenHash(token);
    try {
      const issued = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          const window = new Date(
            Math.floor(clock.now.getTime() / 900000) * 900000,
          );
          const buckets = [
            {
              key: createHmac('sha256', secret)
                .update(`${purpose}:IP:${ip}`)
                .digest('hex'),
              limit: 20,
            },
            {
              key: createHmac('sha256', secret)
                .update(`${purpose}:EMAIL:${email}`)
                .digest('hex'),
              limit: 3,
            },
          ].sort((a, b) => a.key.localeCompare(b.key));
          let allowed = true;
          for (const bucket of buckets) {
            const [row] = await tx.$queryRaw<
              { count: number }[]
            >`INSERT INTO auth_email_rates (key,"windowStartedAt",count) VALUES (${bucket.key},${window},1)
            ON CONFLICT (key) DO UPDATE SET "windowStartedAt"=EXCLUDED."windowStartedAt",count=CASE WHEN auth_email_rates."windowStartedAt"=EXCLUDED."windowStartedAt" THEN LEAST(auth_email_rates.count+1,1000000) ELSE 1 END RETURNING count`;
            if (row.count > bucket.limit) allowed = false;
          }
          if (!allowed) return null;
          const snapshot = await tx.user.findUnique({
            where: actor ? { id: actor.userId } : { email: email! },
          });
          if (!snapshot) return null;
          await tx.$queryRaw`SELECT id FROM users WHERE id=${snapshot.id} FOR UPDATE`;
          const u = await tx.user.findUniqueOrThrow({
            where: { id: snapshot.id },
          });
          if (
            actor &&
            (!u.isActive ||
              !credentialMatches(actor.credentialVersion, u.credentialVersion))
          )
            throw new UnauthorizedException();
          if (
            !u.isActive ||
            u.email !== email ||
            (purpose === 'VERIFY_EMAIL' && u.emailVerifiedAt)
          )
            return null;
          return tx.authEmailToken.create({
            data: {
              userId: u.id,
              purpose,
              tokenHash,
              email: u.email,
              credentialVersion: u.credentialVersion,
              createdAt: clock.now,
              expiresAt: new Date(clock.now.getTime() + 900000),
            },
            select: { id: true, email: true },
          });
        },
        { maxWait: 2000, timeout: 5000 },
      );
      if (issued) this.mail.enqueue(issued.email, token, purpose, issued.id);
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.warn('AUTH_EMAIL_REQUEST_UNCONFIRMED'); // Never log email/IP/token/provider error body.
    }
    // Provider delivery is asynchronous: known users cannot be distinguished by waiting on its RTT.
    await pause(Math.max(0, minimum - (Date.now() - start)));
    return {
      status: 'REQUEST_ACCEPTED' as const,
      message:
        'Nếu thông tin đủ điều kiện, hệ thống sẽ gửi liên kết. Kiểm tra thư và thử lại sau nếu chưa nhận được.',
    };
  }
  async confirm(purpose: EmailPurpose, token: string, newPassword?: string) {
    this.gate();
    const tokenHash = emailTokenHash(token),
      [preClock] = await this.db.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
    const snapshot = await this.db.authEmailToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !snapshot ||
      snapshot.purpose !== purpose ||
      snapshot.usedAt ||
      snapshot.revokedAt ||
      snapshot.expiresAt <= preClock.now ||
      !snapshot.user.isActive ||
      snapshot.email !== snapshot.user.email ||
      snapshot.credentialVersion !== snapshot.user.credentialVersion
    )
      throw invalidEmailToken();
    // Only a currently valid high-entropy token may reach bcrypt. No bcrypt under the User lock.
    let nextHash: string | undefined;
    if (purpose === 'RESET_PASSWORD') {
      if (!newPassword) throw invalidEmailToken();
      if (await compare(newPassword, snapshot.user.passwordHash))
        throw new BadRequestException({ code: 'PASSWORD_UNCHANGED' });
      nextHash = await hash(newPassword, 12);
    }
    try {
      await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
          await tx.$queryRaw`SELECT id FROM users WHERE id=${snapshot.userId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM auth_email_tokens WHERE id=${snapshot.id}::uuid FOR UPDATE`;
          const u = await tx.user.findUniqueOrThrow({
              where: { id: snapshot.userId },
            }),
            current = await tx.authEmailToken.findUniqueOrThrow({
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
            current.purpose !== purpose ||
            current.usedAt ||
            current.revokedAt ||
            current.expiresAt <= clock.now
          )
            throw invalidEmailToken();
          await tx.authEmailToken.update({
            where: { id: current.id },
            data: { usedAt: clock.now },
          });
          if (purpose === 'VERIFY_EMAIL') {
            await tx.user.update({
              where: { id: u.id },
              data: { emailVerifiedAt: u.emailVerifiedAt ?? clock.now },
            });
            await tx.authEmailToken.updateMany({
              where: { userId: u.id, purpose, usedAt: null, revokedAt: null },
              data: { revokedAt: clock.now },
            });
          } else {
            if (u.credentialVersion === 2147483647)
              throw new ServiceUnavailableException({
                code: 'AUTH_VERSION_EXHAUSTED',
              });
            await tx.user.update({
              where: { id: u.id },
              data: {
                passwordHash: nextHash!,
                credentialVersion: { increment: 1 },
              },
            });
            await tx.refreshToken.updateMany({
              where: { userId: u.id, revokedAt: null },
              data: { revokedAt: clock.now },
            });
            await tx.authEmailToken.updateMany({
              where: { userId: u.id, usedAt: null, revokedAt: null },
              data: { revokedAt: clock.now },
            });
            await tx.accountSecurityEvent.create({
              data: {
                userId: u.id,
                event: 'PASSWORD_RESET',
                fromVersion: u.credentialVersion,
                toVersion: u.credentialVersion + 1,
              },
            });
          }
        },
        { maxWait: 3000, timeout: 7000 },
      );
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException({
        code: 'AUTH_EMAIL_CONFIRM_UNCERTAIN',
        message:
          'Chưa rõ kết quả. Hãy kiểm tra trạng thái hoặc đăng nhập lại; không tự gửi lại thao tác.',
      });
    }
    return purpose === 'RESET_PASSWORD'
      ? {
          status: 'PASSWORD_RESET' as const,
          reauthenticationRequired: true as const,
        }
      : { status: 'EMAIL_VERIFIED' as const };
  }
}
