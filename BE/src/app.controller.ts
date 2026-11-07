import { Controller, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getHello(): string {
    return 'BCKL Backend is running!';
  }

  @Get('health')
  async getHealth() {
    try {
      await this.prisma.user.count();
      return {
        status: 'ok',
        database: 'connected',
      };
    } catch (error: unknown) {
      this.logger.error('Database connection failed in health check', error instanceof Error ? error.stack : error);
      throw new HttpException(
        {
          status: 'error',
          database: 'disconnected',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
