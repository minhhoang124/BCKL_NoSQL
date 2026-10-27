import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { googleConfig } from './google-oauth.config.js';
import { GoogleOAuthProvider, oauthDigest } from './google-oauth.provider.js';
const invalid = (): never => {
  throw new UnauthorizedException({ code: 'GOOGLE_OAUTH_INVALID' });
};
const random = () => randomBytes(32).toString('base64url');
export const validOAuthRandom = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9_-]{43}$/.test(v) &&
  Buffer.from(v, 'base64url').toString('base64url') === v;
const pkce = (state: string, proof: string) =>
  createHmac('sha256', googleConfig().stateSecret)
    .update('pkce\0' + state + '\0' + proof)
    .digest('base64url');
@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly provider: GoogleOAuthProvider,
  ) {}
  private async now(tx: Prisma.TransactionClient) {
    return (
      await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp()::timestamp(3) AS now`
    )[0]!.now;
  }
  private async linkActor(
    tx: Prisma.TransactionClient,
    actorId: number,
    cv: number,
    sessionHash: string,
  ) {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actorId } });
    if (!user?.isActive || user.credentialVersion !== cv) return invalid();
    await tx.$queryRaw`SELECT id FROM refresh_tokens WHERE "tokenHash"=${sessionHash} FOR UPDATE`;
    if (
      !(await tx.refreshToken.findFirst({
        where: {
          userId: actorId,
          tokenHash: sessionHash,
          revokedAt: null,
          expiresAt: { gt: await this.now(tx) },
        },
      }))
    )
      return invalid();
    return user;
  }
  async start(actor?: AuthenticatedUser, password?: string, refresh?: string) {
    googleConfig();
    // Password hashing is outside User/refresh locks; rechecked after locking.
    const candidate = actor
      ? await this.db.user.findUnique({ where: { id: actor.userId } })
      : null;
    if (
      actor &&
      (!candidate?.isActive ||
        !password ||
        !refresh ||
        !(await compare(password, candidate.passwordHash)))
    )
      return invalid();
    const state = random(),
      proof = random(),
      nonce = random();
    const sessionHash = oauthDigest(refresh ?? '');
    await this.db.$transaction(
      async (tx) => {
        const now = await this.now(tx);
        if (actor) {
          const user = await this.linkActor(
            tx,
            actor.userId,
            actor.credentialVersion!,
            sessionHash!,
          );
          if (user.passwordHash !== candidate!.passwordHash) return invalid();
          if (
            await tx.googleIdentity.findUnique({ where: { userId: user.id } })
          )
            throw new ConflictException({ code: 'GOOGLE_ALREADY_LINKED' });
        }
        await tx.googleOAuthChallenge.create({
          data: {
            id: randomUUID(),
            stateHash: oauthDigest(state),
            proofHash: oauthDigest(proof),
            nonceHash: oauthDigest(nonce),
            purpose: actor ? 'LINK' : 'LOGIN',
            actorId: actor?.userId,
            credentialVersion: actor?.credentialVersion,
            sessionHash,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 600000),
          },
        });
      },
      { timeout: 5000, maxWait: 2000 },
    );
    const challenge = createHash('sha256')
      .update(pkce(state, proof))
      .digest('base64url');
    return { proof, url: this.provider.authorization(state, nonce, challenge) };
  }
  async finish(
    state: unknown,
    proof: unknown,
    code: unknown,
    refresh?: string,
  ) {
    googleConfig();
    if (!validOAuthRandom(state) || !validOAuthRandom(proof)) return invalid();
    // Browser proof is verified BEFORE claim, preventing arbitrary callback
    // requests from consuming someone else's legitimate pending challenge.
    const claim = await this.db.$transaction(
      async (tx) => {
        const now = await this.now(tx),
          row = await tx.googleOAuthChallenge.findUnique({
            where: { stateHash: oauthDigest(state) },
          });
        if (
          !row ||
          row.proofHash !== oauthDigest(proof) ||
          row.expiresAt <= now ||
          row.claimedAt ||
          row.sessionHash !== oauthDigest(refresh ?? '')
        )
          return invalid();
        const n = await tx.googleOAuthChallenge.updateMany({
          where: { id: row.id, claimedAt: null, expiresAt: { gt: now } },
          data: { claimedAt: now },
        });
        if (n.count !== 1) return invalid();
        return row;
      },
      { timeout: 5000, maxWait: 2000 },
    );
    if (
      typeof code !== 'string' ||
      code.length < 1 ||
      code.length > 4096 ||
      // oxlint-disable-next-line no-control-regex -- Authorization codes must not contain controls or whitespace.
      /[\u0000-\u0020\u007f]/.test(code)
    )
      return invalid();
    // Network exchange is outside database transactions/locks. Never persist
    // Google access, refresh, ID tokens, authorization code or raw browser proof.
    const profile = await this.provider.exchange(
      code,
      pkce(state, proof),
      claim.nonceHash,
    );
    const dummyPassword =
      claim.purpose === 'LOGIN' ? await hash(random(), 12) : null;
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
          const now = await this.now(tx);
          const challenge = await tx.googleOAuthChallenge.findUniqueOrThrow({
            where: { id: claim.id },
          });
          if (
            !challenge.claimedAt ||
            challenge.completedAt ||
            challenge.expiresAt <= now
          )
            return invalid();
          let session: Awaited<
            ReturnType<AuthService['createFederatedSession']>
          > | null = null;
          if (claim.purpose === 'LINK') {
            const user = await this.linkActor(
              tx,
              claim.actorId!,
              claim.credentialVersion!,
              claim.sessionHash!,
            );
            if (user.credentialVersion === 2147483647)
              throw new ConflictException({
                code: 'CREDENTIAL_VERSION_EXHAUSTED',
              });
            if (
              await tx.googleIdentity.findFirst({
                where: {
                  OR: [
                    { userId: user.id },
                    { provider: 'GOOGLE', subject: profile.subject },
                  ],
                },
              })
            )
              throw new ConflictException({ code: 'GOOGLE_ALREADY_LINKED' });
            await tx.googleIdentity.create({
              data: {
                userId: user.id,
                provider: 'GOOGLE',
                subject: profile.subject,
                emailSnapshot: profile.email,
              },
            });
            await tx.user.update({
              where: { id: user.id },
              data: { credentialVersion: { increment: 1 } },
            });
            await tx.refreshToken.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: now },
            });
            await tx.accountSecurityEvent.create({
              data: {
                userId: user.id,
                event: 'GOOGLE_LINKED',
                fromVersion: user.credentialVersion,
                toVersion: user.credentialVersion + 1,
              },
            });
          } else {
            let identity = await tx.googleIdentity.findUnique({
              where: {
                provider_subject: {
                  provider: 'GOOGLE',
                  subject: profile.subject,
                },
              },
            });
            let user;
            if (identity) {
              await tx.$queryRaw`SELECT id FROM users WHERE id=${identity.userId} FOR UPDATE`;
              user = await tx.user.findUniqueOrThrow({
                where: { id: identity.userId },
              });
            } else {
              // Existing email is NOT proof of identity ownership, even when Google
              // signs that email. Linking requires a separate password/session flow.
              if (await tx.user.findUnique({ where: { email: profile.email } }))
                throw new ConflictException({
                  code: 'ACCOUNT_COLLISION_LINK_REQUIRED',
                });
              user = await tx.user.create({
                data: {
                  email: profile.email,
                  passwordHash: dummyPassword!,
                  fullName: profile.fullName,
                  role: 'USER',
                  emailVerifiedAt: profile.authoritative ? now : null,
                },
              });
              identity = await tx.googleIdentity.create({
                data: {
                  userId: user.id,
                  provider: 'GOOGLE',
                  subject: profile.subject,
                  emailSnapshot: profile.email,
                },
              });
            }
            session = await this.auth.createFederatedSession(
              tx,
              user.id,
              user.credentialVersion,
            );
          }
          const completedAt = await this.now(tx);
          if (challenge.expiresAt <= completedAt) return invalid();
          await tx.googleOAuthChallenge.update({
            where: { id: claim.id },
            data: { completedAt },
          });
          return { purpose: claim.purpose, session };
        },
        { timeout: 7000, maxWait: 2000 },
      );
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002')
        throw new ConflictException({ code: 'GOOGLE_IDENTITY_CONFLICT' });
      throw e;
    }
  }
  async status(actor: AuthenticatedUser) {
    googleConfig();
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: actor.userId } });
      if (!user?.isActive || user.credentialVersion !== actor.credentialVersion)
        return invalid();
      const identity = await tx.googleIdentity.findUnique({
        where: { userId: user.id },
      });
      return { linked: !!identity, email: identity?.emailSnapshot ?? null };
    });
  }
}
