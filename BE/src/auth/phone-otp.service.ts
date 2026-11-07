import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { PhoneOtpChallenge, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { credentialMatches } from './credential-version.js';
import { phoneOtpConfig } from './phone-otp.config.js';
import type {
  phoneOtpConfirmation,
  phoneOtpRequest,
} from './phone-otp.input.js';
type Tx = Prisma.TransactionClient;
const digest = (key: string, ...parts: (string | number)[]) =>
  createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex');
export const phoneCodeDigest = (
  key: string,
  c: Pick<
    PhoneOtpChallenge,
    'id' | 'userId' | 'phoneNumber' | 'credentialVersion'
  >,
  code: string,
) =>
  digest(
    key,
    'phone-otp-code-v1',
    c.id,
    c.userId,
    c.phoneNumber,
    c.credentialVersion,
    code,
  );
@Injectable()
export class PhoneOtpSandboxDelivery {
  async deliver(code: string) {
    phoneOtpConfig();
    return {
      channel: 'SANDBOX' as const,
      demoCode: code,
      smsSent: false as const,
    };
  }
}
@Injectable()
export class PhoneOtpService {
  private async transaction<T>(
    work: (tx: Tx) => Promise<T>,
    options: {
      maxWait: number;
      timeout: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T> {
    try {
      return await this.db.$transaction(work, options);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Never log provider/Prisma bodies: these may contain phone numbers.
      throw new ServiceUnavailableException({ code: 'PHONE_OTP_UNCONFIRMED' });
    }
  }
  constructor(
    private readonly db: PrismaService,
    private readonly delivery: PhoneOtpSandboxDelivery,
  ) {}
  private async now(tx: Tx) {
    return (
      await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp()::timestamp(3) AS now`
    )[0]!.now;
  }
  private async actor(tx: Tx, actor: AuthenticatedUser, lock = false) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.userId } });
    if (
      !user?.isActive ||
      !credentialMatches(actor.credentialVersion, user.credentialVersion)
    )
      throw new UnauthorizedException();
    return user;
  }
  private limit(seconds: number): never {
    throw new HttpException(
      { code: 'PHONE_OTP_RATE_LIMITED', retryAfter: Math.max(1, seconds) },
      429,
    );
  }
  async request(
    actor: AuthenticatedUser,
    input: ReturnType<typeof phoneOtpRequest>,
  ) {
    const { key } = phoneOtpConfig(),
      keys = [
        digest(key, 'phone-account-v1', actor.userId),
        digest(key, 'phone-recipient-v1', input.phoneNumber),
      ].sort();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const result = await this.transaction(
      async (tx) => {
        // Shared rate rows serialize across app instances and across accounts
        // using the same destination. Lock sorted rate keys BEFORE User/Challenge.
        const initial = await this.now(tx);
        for (const k of keys)
          await tx.$executeRaw`INSERT INTO phone_otp_rates (key,"windowStartedAt",count) VALUES (${k},${initial},0) ON CONFLICT(key) DO NOTHING`;
        await tx.$queryRaw`SELECT key FROM phone_otp_rates WHERE key IN (${keys[0]!},${keys[1]!}) ORDER BY key FOR UPDATE`;
        const user = await this.actor(tx, actor, true),
          now = await this.now(tx),
          contact = await tx.userPhoneContact.findUnique({
            where: { userId: user.id },
          }),
          version = contact?.version ?? 0;
        if (version !== input.expectedVersion)
          throw new ConflictException({
            code: 'PHONE_CONTACT_VERSION_CONFLICT',
          });
        if (version === 2147483647)
          throw new ConflictException({
            code: 'PHONE_CONTACT_VERSION_EXHAUSTED',
          });
        const last = await tx.phoneOtpChallenge.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });
        if (last && now.getTime() - last.createdAt.getTime() < 60000)
          this.limit(
            Math.ceil(
              (60000 - now.getTime() + last.createdAt.getTime()) / 1000,
            ),
          );
        for (const k of keys) {
          const bucket = await tx.phoneOtpRate.findUniqueOrThrow({
              where: { key: k },
            }),
            reset = now.getTime() - bucket.windowStartedAt.getTime() >= 900000;
          if (!reset && bucket.count >= 3)
            this.limit(
              Math.ceil(
                (900000 - now.getTime() + bucket.windowStartedAt.getTime()) /
                  1000,
              ),
            );
          await tx.phoneOtpRate.update({
            where: { key: k },
            data: reset
              ? { count: 1, windowStartedAt: now }
              : { count: { increment: 1 } },
          });
        }
        await tx.phoneOtpChallenge.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
            revokedAt: null,
            exhaustedAt: null,
          },
          data: { revokedAt: now },
        });
        const c = {
          id: randomUUID(),
          userId: user.id,
          phoneNumber: input.phoneNumber,
          credentialVersion: user.credentialVersion,
        };
        const row = await tx.phoneOtpChallenge.create({
          data: {
            ...c,
            codeHash: phoneCodeDigest(key, c, code),
            baseVersion: version,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 300000),
          },
        });
        return {
          challengeId: row.id,
          phoneNumber: row.phoneNumber,
          expiresAt: row.expiresAt,
          resendAfter: new Date(now.getTime() + 60000),
        };
      },
      { maxWait: 3000, timeout: 7000 },
    );
    return {
      ...result,
      ...(await this.delivery.deliver(code)),
      ownershipVerified: false as const,
    };
  }
  private async receipt(tx: Tx, c: PhoneOtpChallenge) {
    const current = await tx.userPhoneContact.findUnique({
      where: { userId: c.userId },
    });
    return {
      outcome: 'APPLIED' as const,
      challengeId: c.id,
      phoneNumber: c.phoneNumber,
      version: c.appliedVersion!,
      sandboxConfirmedAt: c.usedAt!,
      channel: 'SANDBOX' as const,
      ownershipVerified: false as const,
      isCurrentContact: current?.lastChallengeId === c.id,
    };
  }
  async confirm(
    actor: AuthenticatedUser,
    input: ReturnType<typeof phoneOtpConfirmation>,
  ) {
    const { key } = phoneOtpConfig();
    const result = await this.transaction(
      async (tx) => {
        const user = await this.actor(tx, actor, true);
        await tx.$queryRaw`SELECT id FROM phone_otp_challenges WHERE id=${input.challengeId}::uuid AND "userId"=${user.id} FOR UPDATE`;
        const c = await tx.phoneOtpChallenge.findFirst({
            where: { id: input.challengeId, userId: user.id },
          }),
          now = await this.now(tx);
        if (!c) return { rejected: true as const };
        if (c.usedAt) {
          const matches = timingSafeEqual(
            Buffer.from(c.codeHash, 'hex'),
            Buffer.from(phoneCodeDigest(key, c, input.code), 'hex'),
          );
          return matches && c.credentialVersion === user.credentialVersion
            ? { receipt: await this.receipt(tx, c) }
            : { rejected: true as const };
        }
        if (
          c.credentialVersion !== user.credentialVersion ||
          c.revokedAt ||
          c.exhaustedAt ||
          c.expiresAt <= now
        )
          return { rejected: true as const };
        const contact = await tx.userPhoneContact.findUnique({
          where: { userId: user.id },
        });
        if ((contact?.version ?? 0) !== c.baseVersion) {
          await tx.phoneOtpChallenge.update({
            where: { id: c.id },
            data: { revokedAt: now },
          });
          return { rejected: true as const };
        }
        if (
          !timingSafeEqual(
            Buffer.from(c.codeHash, 'hex'),
            Buffer.from(phoneCodeDigest(key, c, input.code), 'hex'),
          )
        ) {
          const attempts = c.attempts + 1;
          await tx.phoneOtpChallenge.update({
            where: { id: c.id },
            data: { attempts, ...(attempts === 5 ? { exhaustedAt: now } : {}) },
          });
          // Return the error marker: throwing here would roll back the failed
          // attempt counter and permit an unlimited online guessing attack.
          return { rejected: true as const };
        }
        const consumed = await tx.phoneOtpChallenge.update({
          where: { id: c.id },
          data: { usedAt: now, appliedVersion: c.baseVersion + 1 },
        });
        const data = {
          phoneNumber: c.phoneNumber,
          channel: 'SANDBOX',
          version: c.baseVersion + 1,
          lastChallengeId: c.id,
          sandboxConfirmedAt: now,
        };
        // User lock serializes the choice. Native INSERT ... ON CONFLICT runs
        // BEFORE INSERT triggers even for an UPDATE and would violate the
        // initial-version guard when replacing an existing contact.
        if (contact)
          await tx.userPhoneContact.update({
            where: { userId: user.id },
            data,
          });
        else
          await tx.userPhoneContact.create({
            data: { userId: user.id, ...data },
          });
        return { receipt: await this.receipt(tx, consumed) };
      },
      { maxWait: 3000, timeout: 7000 },
    );
    if ('rejected' in result)
      throw new BadRequestException({ code: 'PHONE_OTP_INVALID_OR_EXPIRED' });
    return result.receipt;
  }
  async status(actor: AuthenticatedUser) {
    phoneOtpConfig();
    return this.transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const user = await this.actor(tx, actor),
          now = await this.now(tx),
          contact = await tx.userPhoneContact.findUnique({
            where: { userId: user.id },
          });
        const pending = await tx.phoneOtpChallenge.findFirst({
          where: {
            userId: user.id,
            credentialVersion: user.credentialVersion,
            usedAt: null,
            revokedAt: null,
            exhaustedAt: null,
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
        });
        const latest = await tx.phoneOtpChallenge.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });
        return {
          channel: 'SANDBOX' as const,
          ownershipVerified: false as const,
          version: contact?.version ?? 0,
          contact: contact
            ? {
                phoneNumber: contact.phoneNumber,
                sandboxConfirmedAt: contact.sandboxConfirmedAt,
                lastChallengeId: contact.lastChallengeId,
              }
            : null,
          pending: pending
            ? {
                challengeId: pending.id,
                phoneNumber: pending.phoneNumber,
                expiresAt: pending.expiresAt,
                attemptsRemaining: 5 - pending.attempts,
              }
            : null,
          resendAfter: latest
            ? new Date(
                Math.max(now.getTime(), latest.createdAt.getTime() + 60000),
              )
            : now,
        };
      },
      { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 },
    );
  }
  async reconcile(actor: AuthenticatedUser, id: string) {
    phoneOtpConfig();
    return this.transaction(
      async (tx) => {
        await this.actor(tx, actor, true);
        await tx.$queryRaw`SELECT id FROM phone_otp_challenges WHERE id=${id}::uuid AND "userId"=${actor.userId} FOR UPDATE`;
        const c = await tx.phoneOtpChallenge.findFirst({
          where: { id, userId: actor.userId },
        });
        if (!c)
          throw new NotFoundException({ code: 'PHONE_OTP_RECEIPT_NOT_FOUND' });
        if (c.usedAt) return this.receipt(tx, c);
        if (!c.revokedAt && !c.exhaustedAt)
          await tx.phoneOtpChallenge.update({
            where: { id },
            data: { revokedAt: await this.now(tx) },
          });
        return {
          outcome: 'CLOSED' as const,
          challengeId: id,
          channel: 'SANDBOX' as const,
          ownershipVerified: false as const,
        };
      },
      { maxWait: 3000, timeout: 7000 },
    );
  }
  async readReceipt(actor: AuthenticatedUser, id: string) {
    phoneOtpConfig();
    return this.transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await this.actor(tx, actor);
        const c = await tx.phoneOtpChallenge.findFirst({
          where: { id, userId: actor.userId },
        });
        if (!c)
          throw new NotFoundException({ code: 'PHONE_OTP_RECEIPT_NOT_FOUND' });
        if (c.usedAt) return this.receipt(tx, c);
        return {
          outcome: 'NOT_APPLIED' as const,
          challengeId: c.id,
          channel: 'SANDBOX' as const,
          ownershipVerified: false as const,
        };
      },
      { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 },
    );
  }
}
