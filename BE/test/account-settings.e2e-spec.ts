import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { App } from './http-test-types.js';

describe('Account profile/password runtime, isolated PostgreSQL', () => {
  let app: INestApplication<App>,
    other: INestApplication<App>,
    prisma: PrismaService;
  const beforeFlag = process.env.ACCOUNT_SETTINGS_WRITE_ENABLED;
  const password = 'CurrentPassword123!';
  let sequence = 0;
  beforeAll(async () => {
    process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = 'true';
    const create = async () => {
      const app: INestApplication<App> = (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication();
      configureApp(app);
      await app.init();
      return app;
    };
    app = await create();
    other = await create();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await other?.close();
    await app?.close();
    if (beforeFlag === undefined)
      delete process.env.ACCOUNT_SETTINGS_WRITE_ENABLED;
    else process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = beforeFlag;
  });
  async function fixture(role: 'USER' | 'SELLER' = 'USER') {
    const email = `settings-${Date.now()}-${++sequence}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, accountType: role, fullName: 'Original Name' })
      .expect(201);
    return {
      email,
      id: response.body.user.id as number,
      token: response.body.accessToken as string,
      cookie: response.headers['set-cookie'][0].split(';')[0] as string,
    };
  }
  const patch = (token: string, body: object) =>
    request(app.getHttpServer())
      .patch('/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const change = (token: string, next = 'NewPassword123!') =>
    request(app.getHttpServer())
      .post('/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: next });
  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

  it('401/invalid parser responses are no-store, body bounded and query rejected', async () => {
    await request(app.getHttpServer())
      .patch('/auth/profile')
      .send({ fullName: 'AA', expectedFullName: null })
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .post('/auth/password?x=1')
      .send({})
      .expect(400)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .post('/auth/password')
      .send({ currentPassword: 'x'.repeat(9000) })
      .expect(413);
  });
  it('profile uses own identity, normalizes NFC, no-op is zero-write; no secrets/version exposed', async () => {
    const actor = await fixture('SELLER');
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    const response = await patch(actor.token, {
      fullName: '  Te\u0302n Mo\u031b\u0301i ',
      expectedFullName: 'Original Name',
    }).expect(200);
    expect(response.body.fullName).toBe('Tên Mới');
    expect(Object.keys(response.body).sort()).toEqual(
      ['id', 'email', 'fullName', 'role', 'isActive', 'createdAt'].sort(),
    );
    const saved = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    await patch(actor.token, {
      fullName: 'Tên Mới',
      expectedFullName: 'Tên Mới',
    }).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }))
        .updatedAt,
    ).toEqual(saved.updatedAt);
    expect(saved.passwordHash).toBe(before.passwordHash);
    expect(saved.credentialVersion).toBe(1);
    await patch(actor.token, {
      fullName: 'Wrong Target',
      expectedFullName: 'Tên Mới',
      userId: actor.id + 1,
    }).expect(400);
  });
  it('two profile writers with same snapshot have only one winner', async () => {
    const actor = await fixture();
    const replies = await Promise.all(
      ['Name Alpha', 'Name Beta'].map((fullName) =>
        patch(actor.token, { fullName, expectedFullName: 'Original Name' }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('wrong/same password and byte truncation attempts do not change credentials', async () => {
    const actor = await fixture();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    await request(app.getHttpServer())
      .post('/auth/password')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ currentPassword: 'wrong', newPassword: 'NewPassword123!' })
      .expect(400);
    await change(actor.token, password).expect(400);
    await change(actor.token, 'é'.repeat(37)).expect(400);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    ).toEqual(before);
  });
  it('changes once, revokes all sessions, old access/refresh fail across apps, new login works', async () => {
    const actor = await fixture();
    const second = await request(other.getHttpServer())
      .post('/auth/login')
      .send({ email: actor.email, password })
      .expect(200);
    const count = await prisma.searchOutbox.count();
    const jobs = await prisma.searchReconciliationJob.count();
    const reply = await change(actor.token).expect(200);
    expect(reply.body).toEqual({
      status: 'PASSWORD_CHANGED',
      reauthenticationRequired: true,
    });
    expect(reply.headers['set-cookie']).toBeUndefined();
    await me(actor.token).expect(401);
    await request(other.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .expect(401);
    await request(other.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', actor.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', second.headers['set-cookie'][0].split(';')[0])
      .expect(401);
    await change(actor.token).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: actor.email, password })
      .expect(401);
    const next = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: actor.email, password: 'NewPassword123!' })
      .expect(200);
    expect(next.body.user.credentialVersion).toBeUndefined();
    await me(next.body.accessToken).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }))
        .credentialVersion,
    ).toBe(2);
    expect(
      await prisma.refreshToken.count({
        where: { userId: actor.id, revokedAt: null },
      }),
    ).toBe(1);
    expect(await prisma.searchOutbox.count()).toBe(count);
    expect(await prisma.searchReconciliationJob.count()).toBe(jobs);
    expect(
      await prisma.accountSecurityEvent.findMany({
        where: { userId: actor.id },
        select: { event: true, fromVersion: true, toVersion: true },
      }),
    ).toEqual([{ event: 'PASSWORD_CHANGED', fromVersion: 1, toVersion: 2 }]);
  });
  it('legacy access accepted only at version1; malformed cv is rejected', async () => {
    const actor = await fixture();
    const jwt = app.get(JwtService);
    const token = (cv?: unknown) =>
      jwt.sign(
        {
          sub: actor.id,
          email: actor.email,
          role: 'USER',
          type: 'access',
          ...(cv !== undefined ? { cv } : {}),
        },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          issuer: 'klcn-ecommerce-api',
          audience: 'klcn-ecommerce-web',
          expiresIn: 60,
        },
      );
    const legacy = token();
    await me(legacy).expect(200);
    await me(token('1')).expect(401);
    await change(actor.token).expect(200);
    await me(legacy).expect(401);
  });
  it('simultaneous password changes across apps produce one new version', async () => {
    const actor = await fixture();
    const replies = await Promise.all(
      [app, other].map((instance) =>
        request(instance.getHttpServer())
          .post('/auth/password')
          .set('Authorization', `Bearer ${actor.token}`)
          .send({
            currentPassword: password,
            newPassword: 'WinnerPassword123!',
          }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 401]);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(current.credentialVersion).toBe(2);
    expect(await compare('WinnerPassword123!', current.passwordHash)).toBe(
      true,
    );
  });
  it('refresh racing change cannot leave a usable old-version session', async () => {
    const actor = await fixture();
    const [rotated, changed] = await Promise.all([
      request(other.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', actor.cookie),
      change(actor.token),
    ]);
    expect(changed.status).toBe(200);
    expect([200, 401]).toContain(rotated.status);
    if (rotated.status === 200) {
      await me(rotated.body.accessToken).expect(401);
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', rotated.headers['set-cookie'][0].split(';')[0])
        .expect(401);
    }
    expect(
      await prisma.refreshToken.count({
        where: { userId: actor.id, revokedAt: null },
      }),
    ).toBe(0);
  });
  it('failure revoking refresh tokens rolls back hash and version together', async () => {
    const actor = await fixture();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION settings_fault_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."userId" = ${actor.id} THEN RAISE EXCEPTION 'QA fixture failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER settings_fault_revoke BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION settings_fault_revoke()',
    );
    try {
      await change(actor.token).expect(503);
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
      ).toEqual(before);
      await me(actor.token).expect(200);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER settings_fault_revoke ON refresh_tokens',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION settings_fault_revoke()');
    }
  });
  it('login which verified old password cannot mint a new-version token', async () => {
    const actor = await fixture();
    const snapshot = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    await change(actor.token).expect(200);
    // Exact delayed-login session step, after bcrypt verification but before User lock.
    const auth = app.get(AuthService) as unknown as {
      createSession: (
        identity: { id: number },
        expectedHash: string,
      ) => Promise<unknown>;
    };
    await expect(
      auth.createSession({ id: actor.id }, snapshot.passwordHash),
    ).rejects.toThrow('Thông tin đăng nhập đã thay đổi');
  });
  it('audit insertion failure rolls back credentials and refresh revocations', async () => {
    const actor = await fixture();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION settings_fault_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = ${actor.id} THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER settings_fault_audit BEFORE INSERT ON account_security_events FOR EACH ROW EXECUTE FUNCTION settings_fault_audit()',
    );
    try {
      await change(actor.token).expect(503);
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
      ).toEqual(before);
      expect(
        await prisma.accountSecurityEvent.count({
          where: { userId: actor.id },
        }),
      ).toBe(0);
      expect(
        await prisma.refreshToken.count({
          where: { userId: actor.id, revokedAt: null },
        }),
      ).toBe(1);
      await me(actor.token).expect(200);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER settings_fault_audit ON account_security_events',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION settings_fault_audit()');
    }
  });
  it('locked account denied; credential max never wraps; default-off gate', async () => {
    const actor = await fixture();
    await prisma.user.update({
      where: { id: actor.id },
      data: { isActive: false },
    });
    await change(actor.token).expect(401);
    const max = await fixture();
    await prisma.user.update({
      where: { id: max.id },
      data: { credentialVersion: 2147483647 },
    });
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: max.email, password })
      .expect(200);
    await change(session.body.accessToken).expect(409);
    process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = 'false';
    try {
      await patch(session.body.accessToken, {
        fullName: 'Blocked',
        expectedFullName: 'Original Name',
      }).expect(503);
    } finally {
      process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = 'true';
    }
  });
});
