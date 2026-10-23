import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import type { App } from './http-test-types.js';

describe('Adversarial account settings, real locks and authority changes', () => {
  let app: INestApplication<App>,
    peer: INestApplication<App>,
    prisma: PrismaService;
  const oldFlag = process.env.ACCOUNT_SETTINGS_WRITE_ENABLED;
  const password = 'AdversarialOriginal123!';
  let number = 0;
  beforeAll(async () => {
    process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = 'true';
    const create = async () => {
      const instance: INestApplication<App> = (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication();
      configureApp(instance);
      await instance.init();
      return instance;
    };
    app = await create();
    peer = await create();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await peer?.close();
    await app?.close();
    if (oldFlag === undefined)
      delete process.env.ACCOUNT_SETTINGS_WRITE_ENABLED;
    else process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = oldFlag;
  });
  async function fixture() {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `settings-probe-${Date.now()}-${++number}@example.test`,
        password,
        fullName: 'Original Name',
      })
      .expect(201);
    return {
      id: response.body.user.id as number,
      token: response.body.accessToken as string,
    };
  }
  const change = (token: string, currentPassword = password) =>
    request(app.getHttpServer())
      .post('/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword: 'AdversarialNew123!' });
  async function hold(id: number) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
    return client;
  }
  it('real lock timeout is sanitized503, all credentials/tokens/audit remain unchanged', async () => {
    const actor = await fixture();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    const client = await hold(actor.id);
    try {
      const response = await change(actor.token).expect(503);
      expect(JSON.stringify(response.body)).not.toMatch(
        /passwordHash|postgresql|SQLSTATE|SELECT|AdversarialOriginal/,
      );
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
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);
  });
  it('account lock commits AFTER JWT/current-password verification but BEFORE write: deny401', async () => {
    const actor = await fixture();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    const client = await hold(actor.id);
    let flight: Promise<request.Response> | undefined;
    try {
      await client.query('UPDATE users SET "isActive"=false WHERE id=$1', [
        actor.id,
      ]);
      flight = change(actor.token).then((response) => response);
      // Observe the real User FOR UPDATE wait; no sleep-only ordering assumption.
      let observed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const rows = await prisma.$queryRaw<
          Array<{ count: number }>
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM users WHERE id = $1 FOR UPDATE%'`;
        if (rows[0].count > 0) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(observed).toBe(true);
      await client.query('COMMIT');
      const response = await flight;
      expect(response.status).toBe(401);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
      });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.credentialVersion).toBe(before.credentialVersion);
      expect(after.isActive).toBe(false);
      expect(
        await prisma.accountSecurityEvent.count({
          where: { userId: actor.id },
        }),
      ).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
      await flight?.catch(() => undefined);
    }
  });
  it('sixth bad-password request is429 before further bcrypt/write, with bounded Retry-After', async () => {
    const actor = await fixture();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    for (let attempt = 0; attempt < 5; attempt++)
      await change(actor.token, 'WrongPassword123!').expect(400);
    const blocked = await change(actor.token).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    ).toEqual(before);
    expect(
      await prisma.accountSecurityEvent.count({ where: { userId: actor.id } }),
    ).toBe(0);
  });
  it('profile/password across two apps cannot write a stale authenticated profile after revocation', async () => {
    const actor = await fixture();
    const [changed, profile] = await Promise.all([
      change(actor.token),
      request(peer.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({
          fullName: 'Concurrent Name',
          expectedFullName: 'Original Name',
        }),
    ]);
    expect(changed.status).toBe(200);
    expect([200, 401]).toContain(profile.status);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(current.credentialVersion).toBe(2);
    expect(current.fullName).toBe(
      profile.status === 200 ? 'Concurrent Name' : 'Original Name',
    );
    expect(
      await prisma.accountSecurityEvent.count({
        where: { userId: actor.id, toVersion: 2 },
      }),
    ).toBe(1);
    await request(peer.getHttpServer())
      .patch('/auth/profile')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ fullName: 'Too Late', expectedFullName: current.fullName })
      .expect(401);
  });
});
