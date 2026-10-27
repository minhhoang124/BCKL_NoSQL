import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import { SearchReconciliationService } from '../search/search-reconciliation.service.js';
import type {
  AuthenticatedUser,
  JwtPayload,
  PublicUser,
} from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { PublicAccountType, RegisterDto } from './dto/register.dto.js';
import { credentialMatches } from './credential-version.js';
import { onboardingEnabled } from '../store/application-input.js';
import {
  accountStatusInput,
  type AccountStatusInput,
} from './account-status.input.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';
import { isAccountStatusConflict } from './account-status-sql.js';
import {
  matchStatusIntent,
  reasonDigest,
  statusIntentData,
  statusReceipt,
} from './account-status-command.js';

export const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly searchReconciliation: SearchReconciliationService,
  ) {
    this.accessTtl = this.readPositiveInteger('JWT_ACCESS_TTL_SECONDS', 900);
    this.refreshTtl = this.readPositiveInteger(
      'JWT_REFRESH_TTL_SECONDS',
      604800,
    );
    this.issuer = config.get<string>('JWT_ISSUER', 'klcn-ecommerce-api');
    this.audience = config.get<string>('JWT_AUDIENCE', 'klcn-ecommerce-web');
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await hash(dto.password, 12);
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName?.trim(),
          role:
            !onboardingEnabled() && dto.accountType === PublicAccountType.SELLER
              ? Role.SELLER
              : Role.USER,
        },
        select: publicUserSelect,
      });
      return this.createSession(user, passwordHash);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email đã được sử dụng');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    if (!user.isActive)
      throw new UnauthorizedException('Tài khoản không hoạt động');
    return this.createSession(user, user.passwordHash);
  }

  async refresh(token: string | undefined) {
    if (!token) throw new UnauthorizedException('Thiếu refresh token');
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        issuer: this.issuer,
        audience: this.audience,
      });
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }
    if (payload.type !== 'refresh')
      throw new UnauthorizedException('Refresh token không hợp lệ');

    const tokenHash = this.hashToken(token);
    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${payload.sub} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: payload.sub } });
      if (
        !current?.isActive ||
        !credentialMatches(payload.cv, current.credentialVersion)
      )
        throw new UnauthorizedException('Phiên đăng nhập đã hết hiệu lực');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: current.id },
        select: publicUserSelect,
      });
      const next = await this.signTokens(user, current.credentialVersion);
      const result = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) return null;
      await tx.refreshToken.create({
        data: {
          tokenHash: this.hashToken(next.refreshToken),
          userId: user.id,
          expiresAt: this.refreshExpiry(),
        },
      });
      return { user, ...next };
    });
    if (!rotated)
      throw new UnauthorizedException(
        'Refresh token đã hết hạn hoặc bị thu hồi',
      );
    return rotated;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(authUser: AuthenticatedUser): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      select: publicUserSelect,
    });
    if (!user?.isActive) throw new UnauthorizedException();
    return user;
  }

  private async statusActor(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
  ) {
    const current = await tx.user.findUnique({ where: { id: actor.userId } });
    if (
      !current?.isActive ||
      current.credentialVersion !== actor.credentialVersion
    )
      throw new UnauthorizedException('Phiên quản trị không còn hiệu lực');
    if (current.role !== Role.ADMIN) throw new ForbiddenException();
  }

  async getAccountStatus(actor: AuthenticatedUser, userId: number) {
    if (!Number.isInteger(userId) || userId < 1 || userId > 2147483647)
      throw new BadRequestException('ID không hợp lệ');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        await this.statusActor(tx, actor);
        const account = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, isActive: true, statusRevision: true },
        });
        if (!account) throw new NotFoundException();
        return account;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2000,
        timeout: 7000,
      },
    );
  }

  async updateAccountStatus(
    actor: AuthenticatedUser,
    userId: number,
    raw: AccountStatusInput,
  ) {
    if (!Number.isInteger(userId) || userId < 1 || userId > 2147483647)
      throw new BadRequestException('ID không hợp lệ');
    const input = accountStatusInput(raw);
    const command = input.commandId
      ? statusIntentData(actor.userId, userId, {
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          isActive: input.isActive,
          reasonDigest: reasonDigest(input.reason),
        })
      : null;
    const conflict = (code: string) =>
      new ConflictException({ statusCode: 409, code, message: code });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
            // One DB-scoped gate shared by all supported status writers. No RAM lock.
            // SELECT only an integer: the pg adapter cannot deserialize PostgreSQL void.
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(190311, 1)`;
            await tx.$queryRaw`SELECT id FROM users WHERE id IN (${actor.userId}, ${userId}) ORDER BY id FOR UPDATE`;
            await this.statusActor(tx, actor);
            const existing = await tx.user.findUnique({
              where: { id: userId },
            });
            if (!existing) throw new NotFoundException();
            if (command) {
              const recorded = await tx.accountStatusCommand.findUnique({
                where: {
                  actorId_commandId: {
                    actorId: actor.userId,
                    commandId: command.commandId,
                  },
                },
              });
              if (recorded) {
                matchStatusIntent(recorded, command);
                const receipt = await statusReceipt(tx, recorded);
                if (!receipt) throw conflict('ACCOUNT_COMMAND_CLOSED');
                return { commandId: command.commandId, ...receipt };
              }
            }
            if (existing.statusRevision !== input.expectedRevision)
              throw conflict('ACCOUNT_REVISION_CONFLICT');
            const view = {
              id: existing.id,
              isActive: existing.isActive,
              statusRevision: existing.statusRevision,
            };
            if (existing.isActive === input.isActive) {
              const receipt = {
                account: view,
                auditId: null,
                searchReconciliation: null,
              };
              if (command)
                await tx.accountStatusCommand.create({
                  data: { ...command, outcome: 'NOOP', receipt },
                });
              return {
                ...receipt,
                ...(command ? { commandId: command.commandId } : {}),
              };
            }
            if (!input.isActive && actor.userId === userId)
              throw conflict('ACCOUNT_SELF_LOCK_FORBIDDEN');
            if (
              !input.isActive &&
              existing.role === Role.ADMIN &&
              (await tx.user.count({
                where: { role: Role.ADMIN, isActive: true },
              })) <= 1
            )
              throw conflict('LAST_ACTIVE_ADMIN');
            if (
              existing.statusRevision === 2147483647 ||
              existing.credentialVersion === 2147483647
            )
              throw conflict('ACCOUNT_VERSION_EXHAUSTED');
            // Rotate on BOTH transitions: unlock also revokes legacy inactive sessions.
            const updated = await tx.user.update({
              where: { id: userId },
              data: {
                isActive: input.isActive,
                statusRevision: { increment: 1 },
                credentialVersion: { increment: 1 },
              },
              select: { id: true, isActive: true, statusRevision: true },
            });
            await tx.refreshToken.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
            const audit = await tx.accountStatusHistory.create({
              data: {
                actorId: actor.userId,
                targetId: userId,
                beforeActive: existing.isActive,
                afterActive: input.isActive,
                fromRevision: existing.statusRevision,
                toRevision: updated.statusRevision,
                fromCredentialVersion: existing.credentialVersion,
                toCredentialVersion: existing.credentialVersion + 1,
                reason: input.reason,
              },
              select: { id: true },
            });
            const ownedStore = await tx.store.findUnique({
              where: { sellerId: userId },
              select: { id: true },
            });
            const job = ownedStore
              ? await this.searchReconciliation.enqueueSeller(tx, userId)
              : null;
            const receipt = {
              account: updated,
              auditId: audit.id.toString(),
              searchReconciliation: job
                ? { jobId: job.id.toString(), status: job.status }
                : null,
            };
            if (command)
              await tx.accountStatusCommand.create({
                data: {
                  ...command,
                  outcome: 'APPLIED',
                  auditId: audit.id,
                  receipt,
                },
              });
            return {
              ...receipt,
              ...(command ? { commandId: command.commandId } : {}),
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 3000,
            timeout: 8000,
          },
        );
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (isAccountStatusConflict(error)) {
          if (attempt < 2) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          throw conflict('ACCOUNT_STATUS_IN_PROGRESS');
        }
        throw new ServiceUnavailableException({
          statusCode: 503,
          code: 'ACCOUNT_STATUS_UNAVAILABLE',
          message:
            'Chưa rõ kết quả. Đọc lại trạng thái và lịch sử, không tự gửi lại.',
        });
      }
    }
    throw conflict('ACCOUNT_STATUS_IN_PROGRESS');
  }

  getRefreshCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/auth',
      maxAge: this.refreshTtl * 1000,
    };
  }

  // Internal federation entry point, not an HTTP API. Caller has validated the
  // provider identity and holds this User lock in the same transaction.
  async createFederatedSession(tx: Prisma.TransactionClient, userId: number, expectedVersion: number) {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const current=await tx.user.findUnique({where:{id:userId}});
    if(!current?.isActive || current.credentialVersion!==expectedVersion) throw new UnauthorizedException();
    const user=await tx.user.findUniqueOrThrow({where:{id:userId},select:publicUserSelect});
    const tokens=await this.signTokens(user,current.credentialVersion);
    await tx.refreshToken.create({data:{tokenHash:this.hashToken(tokens.refreshToken),userId,expiresAt:this.refreshExpiry()}});
    return {user,...tokens};
  }

  private async createSession(
    identity: Pick<PublicUser, 'id'>,
    expectedPasswordHash: string,
  ) {
    // Same User lock as refresh/password change. A login which read the old hash
    // must not mint a new-version session after another request changes it.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${identity.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: identity.id } });
      if (!current?.isActive || current.passwordHash !== expectedPasswordHash)
        throw new UnauthorizedException('Thông tin đăng nhập đã thay đổi');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: current.id },
        select: publicUserSelect,
      });
      const tokens = await this.signTokens(user, current.credentialVersion);
      await tx.refreshToken.create({
        data: {
          tokenHash: this.hashToken(tokens.refreshToken),
          userId: user.id,
          expiresAt: this.refreshExpiry(),
        },
      });
      return { user, ...tokens };
    });
  }

  private async signTokens(
    user: Pick<PublicUser, 'id' | 'email' | 'role'>,
    cv: number,
  ) {
    const base = { sub: user.id, email: user.email, role: user.role, cv };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...base, type: 'access' } satisfies JwtPayload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.accessTtl,
        issuer: this.issuer,
        audience: this.audience,
      }),
      this.jwt.signAsync(
        { ...base, type: 'refresh', jti: randomUUID() } satisfies JwtPayload,
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.refreshTtl,
          issuer: this.issuer,
          audience: this.audience,
        },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtl * 1000);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private readPositiveInteger(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key, String(fallback)));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
