import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, describe, it } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { configureApp } from '../configure-app.js';
import { AdminAttributeReadController } from './admin-attribute-read.controller.js';
import { AdminAttributeReadService } from './admin-attribute-read.service.js';

// Real Nest routing/controller/configureApp; fake authentication and read service.
// This checks header coverage before guards, NOT JWT/DB or production authorization.
describe('Admin attribute no-store HTTP routing boundary (isolated)', () => {
  let app: INestApplication;
  const read = (categoryId: number) => {
    if (categoryId === 2147483647) throw new NotFoundException();
    return { items: [], nextCursor: null };
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminAttributeReadController],
      providers: [
        RolesGuard,
        {
          provide: AdminAttributeReadService,
          useValue: { list: read, detail: read, options: read },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context
            .switchToHttp()
            .getRequest<{
              headers: { authorization?: string };
              user?: { role: Role };
            }>();
          const token = req.headers.authorization;
          if (token !== 'qa-admin' && token !== 'qa-buyer')
            throw new UnauthorizedException();
          req.user = { role: token === 'qa-admin' ? Role.ADMIN : Role.USER };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it.each([
    ['get', 'lowercase'],
    ['head', 'lowercase'],
    ['get', 'uppercase'],
    ['head', 'uppercase'],
    ['get', 'mixed'],
    ['head', 'mixed'],
  ] as const)(
    'does not cache %s %s route responses including failures',
    async (method, casing) => {
      const variant = (path: string) =>
        casing === 'uppercase'
          ? path.toUpperCase()
          : casing === 'mixed'
            ? path
                .replace('/admin/', '/AdMiN/')
                .replace('/attributes', '/AtTrIbUtEs')
            : path;
      for (const suffix of ['', '/1', '/1/options']) {
        const path = variant(`/admin/categories/1/attributes${suffix}`);
        await request(app.getHttpServer())
          [method](path)
          .expect('Cache-Control', 'no-store')
          .expect(401);
        await request(app.getHttpServer())
          [method](path)
          .set('Authorization', 'qa-buyer')
          .expect('Cache-Control', 'no-store')
          .expect(403);
        await request(app.getHttpServer())
          [method](path)
          .set('Authorization', 'qa-admin')
          .expect('Cache-Control', 'no-store')
          .expect(200);
        await request(app.getHttpServer())
          [method](`${path}?unexpected=1`)
          .set('Authorization', 'qa-admin')
          .expect('Cache-Control', 'no-store')
          .expect(400);
      }
      await request(app.getHttpServer())
        [method](variant('/admin/categories/2147483647/attributes/1'))
        .set('Authorization', 'qa-admin')
        .expect('Cache-Control', 'no-store')
        .expect(404);
    },
  );
});
