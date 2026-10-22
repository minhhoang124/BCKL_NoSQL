import {
  ConflictException,
  Injectable,
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

const publicUserSelect = {
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
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await hash(dto.password, 12),
          fullName: dto.fullName?.trim(),
          role:
            dto.accountType === PublicAccountType.SELLER
              ? Role.SELLER
              : Role.USER,
        },
        select: publicUserSelect,
      });
      return this.createSession(user);
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
    const {
      passwordHash: _passwordHash,
      updatedAt: _updatedAt,
      ...publicUser
    } = user;
    return this.createSession(publicUser);
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
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: publicUserSelect,
    });
    if (!user?.isActive)
      throw new UnauthorizedException('Tài khoản không hoạt động');

    const next = await this.signTokens(user);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          tokenHash: this.hashToken(next.refreshToken),
          userId: user.id,
          expiresAt: this.refreshExpiry(),
        },
      });
      return true;
    });
    if (!rotated)
      throw new UnauthorizedException(
        'Refresh token đã hết hạn hoặc bị thu hồi',
      );
    return { user, ...next };
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

  async updateAccountStatus(userId: number, isActive: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      });
      if (existing.isActive === isActive) {
        return { ...existing, searchReconciliation: null };
      }
      const user = await tx.user.update({
        where: { id: userId },
        data: { isActive },
        select: publicUserSelect,
      });
      // Ownership is canonical even if the account's current role changed.
      const ownedStore = await tx.store.findUnique({
        where: { sellerId: userId },
        select: { id: true },
      });
      const job = ownedStore
        ? await this.searchReconciliation.enqueueSeller(tx, userId)
        : null;
      return {
        ...user,
        searchReconciliation: job
          ? { jobId: job.id.toString(), status: job.status }
          : null,
      };
    });
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

  private async createSession(user: PublicUser) {
    const tokens = await this.signTokens(user);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(tokens.refreshToken),
        userId: user.id,
        expiresAt: this.refreshExpiry(),
      },
    });
    return { user, ...tokens };
  }

  private async signTokens(user: Pick<PublicUser, 'id' | 'email' | 'role'>) {
    const base = { sub: user.id, email: user.email, role: user.role };
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
