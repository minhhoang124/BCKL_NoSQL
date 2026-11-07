import request from 'supertest';
import { configureApp } from '../src/configure-app.js';
import * as emailPolicy from '../src/notification/notification-email-policy.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { NotificationProjector } from '../src/notification/notification-projector.js';
import { NotificationEmailWorker } from '../src/notification/notification-email-worker.js';
import { NotificationEmailTransport } from '../src/notification/notification-email-transport.js';
import {
  emailConfig,
  digest,
  type EmailConfig,
} from '../src/notification/notification-email-policy.js';

describe('Business email PostgreSQL queue — synthetic transport, no external mail', () => {
  let app: INestApplication,
    db: PrismaService,
    worker: NotificationEmailWorker,
    transport: NotificationEmailTransport,
    projector: NotificationProjector;
  beforeAll(async () => {
    for (const [k, v] of Object.entries({
      NOTIFICATIONS_ENABLED: 'true',
      NOTIFICATIONS_WORKER_ENABLED: 'false',
      NOTIFICATION_EMAIL_ENABLED: 'true',
      NOTIFICATION_EMAIL_WORKER_ENABLED: 'false',
      NOTIFICATION_EMAIL_PROVIDER: 'resend',
      NOTIFICATION_EMAIL_API_KEY: 'synthetic-email-key-never-send-externally',
      NOTIFICATION_EMAIL_FROM: 'notice@example.invalid',
      NOTIFICATION_EMAIL_WEB_ORIGIN: 'http://localhost:5173',
      NOTIFICATION_EMAIL_START_AT: '2026-10-28T00:00:00.000Z',
    }))
      vi.stubEnv(k, v);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    worker = app.get(NotificationEmailWorker);
    transport = app.get(NotificationEmailTransport);
    projector = app.get(NotificationProjector);
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(projector, 'project').mockResolvedValue({ syncPending: false });
    vi.spyOn(transport, 'send').mockResolvedValue({
      kind: 'accepted',
      id: 'synthetic-provider-id',
    });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    vi.unstubAllEnvs();
  });
  async function fixture(audience = 'BUYER', kind = 'ORDER') {
    const u = await db.user.create({
      data: {
        email: `email-${randomUUID()}@example.invalid`,
        passwordHash: 'NO_LOGIN_QA',
        emailVerifiedAt: new Date(),
        role: 'USER',
      },
    });
    const n = await db.notification.create({
      data: {
        recipientId: u.id,
        audience,
        sourceKind: kind,
        sourceId: 1n,
        title: 'Synthetic queue boundary fixture',
        text: 'Private source reason MUST NOT be copied',
        link: '/account/aftersales',
        eventAt: new Date(),
      },
    });
    return { u, n };
  }
  const job = (id: bigint) =>
    db.notificationEmailJob.findUniqueOrThrow({
      where: { notificationId: id },
    });
  const expire = (id: bigint) =>
    db.$executeRaw`UPDATE notification_email_jobs SET "leaseUntil"=CURRENT_TIMESTAMP-interval '1 second' WHERE "notificationId"=${id}`;
  it('disabled worker does not create or send jobs', async () => {
    vi.stubEnv('NOTIFICATION_EMAIL_ENABLED', 'false');
    const before = await db.notificationEmailJob.count();
    await worker.cycle();
    expect(await db.notificationEmailJob.count()).toBe(before);
    expect(transport.send).not.toHaveBeenCalled();
    vi.stubEnv('NOTIFICATION_EMAIL_ENABLED', 'true');
  });
  it('projects a committed Store history into one generic email, isolated from Store state', async () => {
    vi.mocked(projector.project).mockRestore();
    const u = await db.user.create({
        data: {
          email: `owner-${randomUUID()}@example.invalid`,
          passwordHash: 'NO_LOGIN_QA',
          emailVerifiedAt: new Date(),
        },
      }),
      admin = await db.user.create({
        data: {
          email: `admin-${randomUUID()}@example.invalid`,
          passwordHash: 'NO_LOGIN_QA',
          role: 'ADMIN',
        },
      });
    const store = await db.store.create({
      data: { sellerId: u.id, name: 'Private Store name', status: 'REJECTED' },
    });
    const h = await db.storeStatusHistory.create({
      data: {
        storeId: store.id,
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
        actorId: admin.id,
        reason: 'Private rejection evidence',
      },
    });
    const before = await db.store.findUnique({ where: { id: store.id } });
    await worker.cycle(u.id);
    await worker.cycle(u.id);
    const n = await db.notification.findUniqueOrThrow({
      where: {
        recipientId_sourceKind_sourceId_channel: {
          recipientId: u.id,
          sourceKind: 'STORE',
          sourceId: BigInt(h.id),
          channel: 'IN_APP',
        },
      },
    });
    expect((await job(n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
    expect(transport.send).toHaveBeenCalledTimes(1);
    const p = vi.mocked(transport.send).mock.calls[0][1];
    expect(p.text).not.toMatch(/Private|rejection|Store name/);
    expect(await db.store.findUnique({ where: { id: store.id } })).toEqual(
      before,
    );
  });
  it('rollback of a source transaction cannot enqueue an email', async () => {
    const before = await db.notification.count();
    await expect(
      db.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: `rollback-${randomUUID()}@example.invalid`,
            passwordHash: 'NO_LOGIN_QA',
          },
        });
        await tx.notification.create({
          data: {
            recipientId: u.id,
            audience: 'ACCOUNT',
            sourceKind: 'STORE',
            sourceId: 1n,
            title: 'Rollback only',
            text: 'must rollback',
            link: '/account/store-application',
            eventAt: new Date(),
          },
        });
        throw Error('controlled rollback');
      }),
    ).rejects.toThrow('controlled rollback');
    expect(await db.notification.count()).toBe(before);
  });
  it('two concurrent enqueuers and workers retain one job and dispatch', async () => {
    const f = await fixture();
    await Promise.all([
      worker.enqueue(emailConfig(), f.u.id),
      worker.enqueue(emailConfig(), f.u.id),
    ]);
    expect(
      await db.notificationEmailJob.count({
        where: { notificationId: f.n.id },
      }),
    ).toBe(1);
    await Promise.all([
      worker.cycle(f.u.id),
      new NotificationEmailWorker(db, projector, transport).cycle(f.u.id),
    ]);
    expect((await job(f.n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it('a smaller notification ID committed later is not lost by a high-water checkpoint', async () => {
    const f = await fixture();
    let release!: () => void;
    let made!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (made = r));
    let low = 0n;
    const first = db.$transaction(
      async (tx) => {
        const n = await tx.notification.create({
          data: {
            recipientId: f.u.id,
            audience: 'BUYER',
            sourceKind: 'ORDER',
            sourceId: 2n,
            title: 'Late low ID',
            text: 'fixture',
            link: '/account/aftersales',
            eventAt: new Date(),
          },
        });
        low = n.id;
        made();
        await barrier;
      },
      { timeout: 10000 },
    );
    await started;
    const high = await db.notification.create({
      data: {
        recipientId: f.u.id,
        audience: 'BUYER',
        sourceKind: 'ORDER',
        sourceId: 3n,
        title: 'Early high ID',
        text: 'fixture',
        link: '/account/aftersales',
        eventAt: new Date(),
      },
    });
    try {
      await worker.cycle(f.u.id);
      expect((await job(high.id)).status).toBe('ACCEPTED_BY_PROVIDER');
    } finally {
      release();
      await first;
    }
    await worker.cycle(f.u.id);
    expect((await job(low)).status).toBe('ACCEPTED_BY_PROVIDER');
  });
  it.each([
    'inactive',
    'unverified',
    'demoted',
    'changed-email',
    'changed-config',
  ])(
    'suppresses %s before network and does not retarget a retry',
    async (mode) => {
      const f = await fixture(mode === 'demoted' ? 'SELLER' : 'BUYER');
      if (mode === 'demoted')
        await db.user.update({
          where: { id: f.u.id },
          data: { role: 'SELLER' },
        });
      await worker.enqueue(emailConfig(), f.u.id);
      const key = process.env.NOTIFICATION_EMAIL_API_KEY!;
      if (mode === 'inactive')
        await db.user.update({
          where: { id: f.u.id },
          data: { isActive: false },
        });
      if (mode === 'unverified')
        await db.user.update({
          where: { id: f.u.id },
          data: { emailVerifiedAt: null },
        });
      if (mode === 'demoted')
        await db.user.update({ where: { id: f.u.id }, data: { role: 'USER' } });
      if (mode === 'changed-email')
        await db.user.update({
          where: { id: f.u.id },
          data: { email: `other-${randomUUID()}@example.invalid` },
        });
      if (mode === 'changed-config')
        vi.stubEnv(
          'NOTIFICATION_EMAIL_API_KEY',
          'rotated-synthetic-email-api-key',
        );
      try {
        await worker.cycle(f.u.id);
        expect((await job(f.n.id)).status).toBe('SUPPRESSED');
        expect(transport.send).not.toHaveBeenCalled();
        await worker.enqueue(emailConfig(), f.u.id);
        expect((await job(f.n.id)).status).toBe('SUPPRESSED');
      } finally {
        vi.stubEnv('NOTIFICATION_EMAIL_API_KEY', key);
      }
    },
  );
  it('retries Resend uncertain delivery with exactly the same persisted payload and key', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    vi.mocked(transport.send)
      .mockResolvedValueOnce({
        kind: 'unknown',
        code: 'EMAIL_TRANSPORT_UNCONFIRMED',
      })
      .mockResolvedValue({ kind: 'accepted', id: 'synthetic-replay' });
    await worker.enqueue(emailConfig(), f.u.id);
    const first = await worker['claim'](f.u.id);
    await worker['deliver'](first!, emailConfig());
    expect((await job(f.n.id)).status).toBe('RETRY_WAIT');
    await worker.cycle(f.u.id);
    const calls = vi.mocked(transport.send).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(calls[1][2]).toBe(calls[0][2]);
    expect((await job(f.n.id)).attempts).toBe(2);
  });
  it('crash after durable dispatch marker recovers Resend within window on a new worker', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    await worker.enqueue(emailConfig(), f.u.id);
    const c = await worker['claim'](f.u.id);
    expect(c?.notificationId).toBe(f.n.id);
    vi.mocked(transport.send).mockRejectedValueOnce(
      Error('controlled process crash'),
    );
    await expect(worker['deliver'](c!, emailConfig())).rejects.toThrow(
      'controlled process crash',
    );
    expect((await job(f.n.id)).attemptStartedAt).not.toBeNull();
    await expire(f.n.id);
    await new NotificationEmailWorker(db, projector, transport).cycle(f.u.id);
    expect((await job(f.n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
  });
  it('Mailpit ambiguous send/crash becomes UNKNOWN and never automatically resends', async () => {
    const f = await fixture(),
      config: EmailConfig = {
        ...emailConfig(),
        provider: 'mailpit',
        fingerprint: digest('synthetic-local-transport-config'),
      };
    await worker.enqueue(config, f.u.id);
    const c = await worker['claim'](f.u.id);
    vi.mocked(transport.send).mockRejectedValueOnce(
      Error('controlled local crash'),
    );
    await expect(worker['deliver'](c!, config)).rejects.toThrow();
    await expire(f.n.id);
    expect(await worker['claim'](f.u.id)).toBeNull();
    expect((await job(f.n.id)).status).toBe('UNKNOWN');
    expect(transport.send).toHaveBeenCalledTimes(1);
    await worker.enqueue(config, f.u.id);
    expect(await worker['claim'](f.u.id)).toBeNull();
  });
  it('expired pre-dispatch lease gets a new token; old worker cannot dispatch/finalize', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    await worker.enqueue(emailConfig(), f.u.id);
    const old = await worker['claim'](f.u.id);
    await expire(f.n.id);
    const current = await worker['claim'](f.u.id);
    expect(current?.leaseId).not.toBe(old?.leaseId);
    await worker['deliver'](old!, emailConfig());
    expect(transport.send).not.toHaveBeenCalled();
    await worker['deliver'](current!, emailConfig());
    expect((await job(f.n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
  });
  it('does not hold a User/Order lock while the provider is slow', async () => {
    const f = await fixture();
    let release!: () => void, made!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (made = r));
    vi.mocked(transport.send).mockImplementationOnce(async () => {
      made();
      await barrier;
      return { kind: 'accepted', id: 'slow-qa' };
    });
    const cycle = worker.cycle(f.u.id);
    await started;
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout='250ms'`;
        await tx.user.update({
          where: { id: f.u.id },
          data: { fullName: 'updated while sending' },
        });
      });
    } finally {
      release();
      await cycle;
    }
    expect((await job(f.n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
  });
  it('terminal evidence and payload cannot be edited or deleted directly', async () => {
    const f = await fixture();
    await worker.cycle(f.u.id);
    await expect(
      db.notificationEmailJob.update({
        where: { notificationId: f.n.id },
        data: { status: 'QUEUED' },
      }),
    ).rejects.toThrow();
    await expect(
      db.notificationEmailJob.delete({ where: { notificationId: f.n.id } }),
    ).rejects.toThrow();
    await expect(
      db.notificationEmailJob.update({
        where: { notificationId: f.n.id },
        data: { toEmail: 'other@example.invalid' },
      }),
    ).rejects.toThrow();
  });
  it('only configured event kinds and cutoff enter email, without changing in-app read state', async () => {
    const f = await fixture('BUYER', 'CHAT');
    await worker.cycle(f.u.id);
    expect(
      await db.notificationEmailJob.findUnique({
        where: { notificationId: f.n.id },
      }),
    ).toBeNull();
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: f.n.id } }))
        .readAt,
    ).toBeNull();
    expect(transport.send).not.toHaveBeenCalled();
  });
  it.each([-365, 365])(
    'uses database time for accepted receipt even with host clock skew %i days',
    async (days) => {
      const f = await fixture();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + days * 86400000));
      try {
        await worker.cycle(f.u.id);
        expect((await job(f.n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
        expect(transport.send).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('later rejection cannot erase an earlier uncertain send', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    vi.mocked(transport.send)
      .mockResolvedValueOnce({
        kind: 'unknown',
        code: 'EMAIL_TRANSPORT_UNCONFIRMED',
      })
      .mockResolvedValue({ kind: 'failed', code: 'EMAIL_PROVIDER_REJECTED' });
    await worker.cycle(f.u.id);
    expect((await job(f.n.id)).status).toBe('UNKNOWN');
    expect(transport.send).toHaveBeenCalledTimes(2);
    await worker.cycle(f.u.id);
    expect(transport.send).toHaveBeenCalledTimes(2);
  });
  it('caps retries at five without rotating identity or misreporting prior uncertainty', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    vi.mocked(transport.send)
      .mockResolvedValueOnce({
        kind: 'unknown',
        code: 'EMAIL_TRANSPORT_UNCONFIRMED',
      })
      .mockResolvedValue({ kind: 'retry', code: 'EMAIL_RATE_LIMITED' });
    await worker.cycle(f.u.id);
    const j = await job(f.n.id);
    expect(j.status).toBe('UNKNOWN');
    expect(j.attempts).toBe(5);
    expect(transport.send).toHaveBeenCalledTimes(5);
    expect(
      new Set(vi.mocked(transport.send).mock.calls.map((c) => c[2])).size,
    ).toBe(1);
    expect(
      new Set(
        vi.mocked(transport.send).mock.calls.map((c) => JSON.stringify(c[1])),
      ).size,
    ).toBe(1);
  });
  it('stale 23h resend window closes before any network send', async () => {
    const f = await fixture();
    await worker.enqueue(emailConfig(), f.u.id);
    await worker['claim'](f.u.id);
    await db.$executeRaw`UPDATE notification_email_jobs SET attempts=1,"firstDispatchAt"=CURRENT_TIMESTAMP-interval '24 hours',"attemptStartedAt"=CURRENT_TIMESTAMP-interval '24 hours' WHERE "notificationId"=${f.n.id}`;
    await expire(f.n.id);
    await worker.cycle(f.u.id);
    expect((await job(f.n.id)).status).toBe('UNKNOWN');
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('recovery after an in-flight Resend crash observes bounded backoff', async () => {
    const f = await fixture();
    await worker.enqueue(emailConfig(), f.u.id);
    const c = await worker['claim'](f.u.id);
    vi.mocked(transport.send).mockRejectedValueOnce(Error('controlled crash'));
    await expect(worker['deliver'](c!, emailConfig())).rejects.toThrow();
    await expire(f.n.id);
    expect(await worker['claim'](f.u.id)).toBeNull();
    const j = await job(f.n.id),
      [clock] = await db.$queryRaw<
        Array<{ now: Date }>
      >`SELECT CURRENT_TIMESTAMP AS now`;
    expect(j.status).toBe('RETRY_WAIT');
    expect(j.nextAttemptAt.getTime()).toBeGreaterThan(
      clock.now.getTime() + 20000,
    );
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it('does not retry a Mailpit rejection without provider idempotency', async () => {
    const f = await fixture(),
      config: EmailConfig = {
        ...emailConfig(),
        provider: 'mailpit',
        fingerprint: digest('synthetic-local-rate-limit'),
      };
    await worker.enqueue(config, f.u.id);
    const c = await worker['claim'](f.u.id);
    vi.mocked(transport.send).mockResolvedValue({
      kind: 'retry',
      code: 'EMAIL_RATE_LIMITED',
    });
    await worker['deliver'](c!, config);
    expect((await job(f.n.id)).status).toBe('FAILED');
    expect(await worker['claim'](f.u.id)).toBeNull();
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it('legacy malformed long recipient cannot poison the whole enqueue batch', async () => {
    const f = await fixture();
    await db.user.update({
      where: { id: f.u.id },
      data: { email: 'x'.repeat(300) + randomUUID() + '@example.invalid' },
    });
    await worker.cycle(f.u.id);
    const j = await job(f.n.id);
    expect(j.status).toBe('SUPPRESSED');
    expect(j.toEmail).toBe('');
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('cutoff excludes historical email without deleting the in-app event', async () => {
    const f = await fixture(),
      n = await db.notification.create({
        data: {
          recipientId: f.u.id,
          audience: 'BUYER',
          sourceKind: 'ORDER',
          sourceId: 2n,
          title: 'Old retained event',
          text: 'Historical evidence',
          link: '/account/aftersales',
          eventAt: new Date('2020-01-01T00:00:00Z'),
        },
      });
    await worker.cycle(f.u.id);
    expect(
      await db.notificationEmailJob.findUnique({
        where: { notificationId: n.id },
      }),
    ).toBeNull();
    expect(
      await db.notification.findUnique({ where: { id: n.id } }),
    ).not.toBeNull();
  });
  it('recipient change after a prior uncertain dispatch stays UNKNOWN, never false SUPPRESSED', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    await worker.enqueue(emailConfig(), f.u.id);
    const first = await worker['claim'](f.u.id);
    vi.mocked(transport.send).mockResolvedValueOnce({
      kind: 'unknown',
      code: 'EMAIL_TRANSPORT_UNCONFIRMED',
    });
    await worker['deliver'](first!, emailConfig());
    await db.user.update({
      where: { id: f.u.id },
      data: { email: `rotated-${randomUUID()}@example.invalid` },
    });
    await worker.cycle(f.u.id);
    expect((await job(f.n.id)).status).toBe('UNKNOWN');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it('pre-dispatch crash also waits before another claim without incrementing send attempts', async () => {
    const f = await fixture();
    await worker.enqueue(emailConfig(), f.u.id);
    await worker['claim'](f.u.id);
    await expire(f.n.id);
    expect(await worker['claim'](f.u.id)).toBeNull();
    const j = await job(f.n.id),
      [clock] = await db.$queryRaw<
        Array<{ now: Date }>
      >`SELECT CURRENT_TIMESTAMP AS now`;
    expect(j.status).toBe('RETRY_WAIT');
    expect(j.attempts).toBe(0);
    expect(j.nextAttemptAt.getTime()).toBeGreaterThan(
      clock.now.getTime() + 20000,
    );
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('post-network stale worker cannot overwrite a replacement lease or receipt', async () => {
    const f = await fixture();
    vi.spyOn(emailPolicy, 'retryDelayMs').mockReturnValue(0);
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      sending = new Promise<void>((r) => (started = r));
    vi.mocked(transport.send)
      .mockImplementationOnce(async () => {
        started();
        await barrier;
        return { kind: 'accepted', id: 'same-provider-idempotency-receipt' };
      })
      .mockResolvedValue({
        kind: 'accepted',
        id: 'same-provider-idempotency-receipt',
      });
    const old = worker.cycle(f.u.id);
    await sending;
    let replacement: Awaited<ReturnType<(typeof worker)['claim']>> = null;
    try {
      await expire(f.n.id);
      replacement = await worker['claim'](f.u.id);
      expect(replacement).not.toBeNull();
    } finally {
      release();
      await old;
    }
    expect((await job(f.n.id)).leaseId).toBe(replacement!.leaseId);
    expect((await job(f.n.id)).status).toBe('LEASED');
    await worker['deliver'](replacement!, emailConfig());
    expect((await job(f.n.id)).status).toBe('ACCEPTED_BY_PROVIDER');
    const calls = vi.mocked(transport.send).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toBe(calls[1][2]);
    expect(calls[0][1]).toEqual(calls[1][1]);
  });
  it('browser notification preflight accepts query without executing a business action', async () => {
    const before = [
      await db.notification.count(),
      await db.notificationEmailJob.count(),
    ];
    const response = await request(app.getHttpServer())
      .options('/account/notifications?limit=20')
      .set('Origin', process.env.FRONTEND_URL || 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-origin']).toBe(
      process.env.FRONTEND_URL || 'http://localhost:5173',
    );
    await request(app.getHttpServer())
      .get('/account/notifications?limit=20')
      .expect(401);
    expect([
      await db.notification.count(),
      await db.notificationEmailJob.count(),
    ]).toEqual(before);
  });
});
