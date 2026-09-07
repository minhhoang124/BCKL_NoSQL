import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma.service.js';
import { vi } from 'vitest';

describe('AppController', () => {
  let appController: AppController;

  const mockPrismaService = {
    user: {
      count: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "BCKL Backend is running!"', () => {
      expect(appController.getHello()).toBe('BCKL Backend is running!');
    });
  });

  describe('health', () => {
    it('should return connected status if database is up', async () => {
      mockPrismaService.user.count.mockResolvedValue(1);

      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
        database: 'connected',
      });
    });

    it('should throw HttpException with 503 if database is down', async () => {
      mockPrismaService.user.count.mockRejectedValue(new Error('Connection error'));

      await expect(appController.getHealth()).rejects.toMatchObject({
        status: 503,
        response: {
          status: 'error',
          database: 'disconnected',
        },
      });
    });
  });
});
