import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma.service.js';
import { publicUserSelect } from './auth.service.js';
import type { AuthenticatedUser } from './auth.types.js';

@Injectable()
export class AccountSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(
    actor: AuthenticatedUser,
    input: { fullName: string; expectedFullName: string | null },
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.userId} FOR UPDATE`;
          const current = await tx.user.findUnique({
            where: { id: actor.userId },
          });
          if (
            !current?.isActive ||
            current.credentialVersion !== (actor.credentialVersion ?? 1)
          )
            throw new UnauthorizedException();
          if (current.fullName !== input.expectedFullName)
            throw new ConflictException(
              'Hồ sơ đã thay đổi. Hãy tải lại và đối chiếu.',
            );
          if (current.fullName === input.fullName)
            return tx.user.findUniqueOrThrow({
              where: { id: current.id },
              select: publicUserSelect,
            });
          return tx.user.update({
            where: { id: current.id },
            data: { fullName: input.fullName },
            select: publicUserSelect,
          });
        },
        { maxWait: 3000, timeout: 7000 },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Không thể cập nhật hồ sơ. Chưa rõ kết quả; hãy đọc lại dữ liệu, không tự gửi lại.',
      );
    }
  }

  async changePassword(
    actor: AuthenticatedUser,
    input: { currentPassword: string; newPassword: string },
  ) {
    const snapshot = await this.prisma.user.findUnique({
      where: { id: actor.userId },
    });
    if (
      !snapshot?.isActive ||
      snapshot.credentialVersion !== (actor.credentialVersion ?? 1)
    )
      throw new UnauthorizedException();
    if (!(await compare(input.currentPassword, snapshot.passwordHash)))
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    if (await compare(input.newPassword, snapshot.passwordHash))
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    const nextHash = await hash(input.newPassword, 12);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.userId} FOR UPDATE`;
          const current = await tx.user.findUnique({
            where: { id: actor.userId },
          });
          if (
            !current?.isActive ||
            current.passwordHash !== snapshot.passwordHash ||
            current.credentialVersion !== snapshot.credentialVersion
          )
            throw new UnauthorizedException('Thông tin xác thực đã thay đổi');
          if (current.credentialVersion === 2147483647)
            throw new ConflictException('Không thể tăng phiên bản xác thực');
          await tx.user.update({
            where: { id: current.id },
            data: {
              passwordHash: nextHash,
              credentialVersion: { increment: 1 },
            },
          });
          await tx.refreshToken.updateMany({
            where: { userId: current.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.accountSecurityEvent.create({
            data: {
              userId: current.id,
              event: 'PASSWORD_CHANGED',
              fromVersion: current.credentialVersion,
              toVersion: current.credentialVersion + 1,
            },
          });
        },
        { maxWait: 3000, timeout: 7000 },
      );
      return {
        status: 'PASSWORD_CHANGED' as const,
        reauthenticationRequired: true as const,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Chưa rõ kết quả đổi mật khẩu. Hãy đăng nhập lại; không tự gửi lại yêu cầu.',
      );
    }
  }
}
