import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';
import {
  applicationHash,
  applicationInput,
} from '../src/store/application-input.js';
const profile = {
  name: 'Synthetic onboarding Store',
  description: 'Synthetic QA only',
  contactName: 'Synthetic Owner',
  contactPhone: '+84901234567',
  pickupAddress: 'Synthetic pickup address 01',
  returnAddress: 'Synthetic return address 02',
};
const command = (extra: object = {}) => ({
  commandId: randomUUID(),
  confirmed: true,
  reason: 'QA explicit Store application decision',
  ...extra,
});
describe('Store application real HTTP/PG, grant and recovery', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    passwordHash: string;
  const password = 'Synthetic-onboarding-only-2026';
  const oldFlags = {
    onboarding: process.env.SELLER_ONBOARDING_ENABLED,
    buyer: process.env.ACCOUNT_BUYER_ACCESS_ENABLED,
  };
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL ?? '');
    const local =
      u.hostname === '127.0.0.1' &&
      u.port === '5549' &&
      ['/bckl_order_resolution_test_attributes_20261019_v953','/bckl_order_resolution_test_attributes_20261019_v955'].includes(u.pathname);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(u.hostname) &&
      ((u.pathname === '/klcn_ecommerce' && ['', '5432'].includes(u.port)) ||
        (u.pathname === '/bckl_order_resolution_test_attributes_20261019' &&
          u.port === '5549'));
    if (!local && !ci) throw Error('Exact isolated onboarding QA required');
    process.env.SELLER_ONBOARDING_ENABLED = 'true';
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    for (const [key, value] of [
      ['SELLER_ONBOARDING_ENABLED', oldFlags.onboarding],
      ['ACCOUNT_BUYER_ACCESS_ENABLED', oldFlags.buyer],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  async function actor(role: Role = 'USER') {
    const user = await db.user.create({
      data: {
        email: 'onboarding-' + randomUUID() + '@example.invalid',
        passwordHash,
        role,
      },
    });
    const session = await auth.login({ email: user.email, password });
    return { ...user, token: session.accessToken };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function submit(owner: Actor) {
    const body = command(profile),
      r = await http()
        .post('/account/store-application')
        .auth(owner.token, { type: 'bearer' })
        .send(body)
        .expect(200)
        .expect('Cache-Control', 'no-store');
    return { body, result: r.body, id: r.body.receipt.storeId as number };
  }
  const review = (admin: Actor, id: number, body: object) =>
    http()
      .post(`/admin/store-applications/${id}/review`)
      .auth(admin.token, { type: 'bearer' })
      .send(body);
  async function fixture() {
    const owner = await actor(),
      admin = await actor('ADMIN'),
      s = await submit(owner);
    return { owner, admin, ...s };
  }
  const proof = (
    scope: 'OWNER' | 'ADMIN',
    action: 'submit' | 'edit' | 'resubmit' | 'review',
    target: number,
    body: object,
  ) => ({
    commandId: (body as { commandId: string }).commandId,
    requestHash: applicationHash(
      scope,
      action,
      target,
      applicationInput(scope, action, body).body,
    ),
    confirmed: true,
  });
  it('records real non-superuser app-role with no database/role creation privilege', async () => {
    const rows = await db.$queryRaw<
      Array<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>
    >`SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    if (process.env.GITHUB_ACTIONS === 'true') return; // CI provisioning role differs; local runtime proves restricted app privileges.
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolcreaterole).toBe(false);
    if (process.env.QA_ONBOARDING_REQUIRE_APP_ROLE === 'true')
      expect(rows[0]).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
  });
  it('public accountType SELLER remains USER in onboarding mode', async () => {
    const r = await http()
      .post('/auth/register')
      .send({
        email: 'signup-' + randomUUID() + '@example.invalid',
        password,
        fullName: 'Synthetic Applicant',
        accountType: 'SELLER',
      })
      .expect(201);
    expect(r.body.user.role).toBe('USER');
    expect(await db.store.count({ where: { sellerId: r.body.user.id } })).toBe(
      0,
    );
  });
  it('rejects guest, Admin as Owner and User as Admin; failures are no-store', async () => {
    const user = await actor(),
      admin = await actor('ADMIN');
    await http()
      .get('/account/store-application')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await http()
      .get('/account/store-application')
      .auth(admin.token, { type: 'bearer' })
      .expect(403);
    await http()
      .get('/admin/store-applications')
      .auth(user.token, { type: 'bearer' })
      .expect(403);
  });
  it('submits PENDING without granting Seller, lists private profile/history only to owner/Admin', async () => {
    const f = await fixture();
    expect(f.result.receipt).toMatchObject({
      ownerId: f.owner.id,
      revision: 1,
      status: 'PENDING',
      grantCreated: false,
      reauthenticationRequired: false,
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).role,
    ).toBe('USER');
    const r = await http()
      .get('/account/store-application')
      .auth(f.owner.token, { type: 'bearer' })
      .expect(200);
    expect(r.body.application.profile.contactPhone).toBe(profile.contactPhone);
    expect(r.body.application.history).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toMatch(
      /passwordHash|refreshToken|credentialVersion/,
    );
    await http()
      .get(`/admin/store-applications/${f.id}`)
      .auth(f.owner.token, { type: 'bearer' })
      .expect(403);
  });
  it('no Store is explicit JSON application:null, not an empty successful HTTP body', async () => {
    const owner = await actor();
    const r = await http()
      .get('/account/store-application')
      .auth(owner.token, { type: 'bearer' })
      .expect(200)
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'no-store');
    expect(r.body).toEqual({ application: null });
    expect(r.text).toBe('{"application":null}');
  });
  it('same-key submit replay and explicit reconciliation do not create a second Store/audit', async () => {
    const f = await fixture();
    const replay = await http()
      .post('/account/store-application')
      .auth(f.owner.token, { type: 'bearer' })
      .send(f.body)
      .expect(200);
    expect(replay.body).toEqual(f.result);
    const r = await http()
      .post(
        `/account/store-application/commands/submit/${f.owner.id}/reconcile`,
      )
      .auth(f.owner.token, { type: 'bearer' })
      .send(proof('OWNER', 'submit', f.owner.id, f.body))
      .expect(200);
    expect(r.body).toEqual(f.result);
    expect(await db.store.count({ where: { sellerId: f.owner.id } })).toBe(1);
    expect(
      await db.storeApplicationAudit.count({ where: { storeId: f.id } }),
    ).toBe(1);
  });
  it('different UUID cannot create another Store and old UUID cannot change its payload', async () => {
    const f = await fixture();
    await http()
      .post('/account/store-application')
      .auth(f.owner.token, { type: 'bearer' })
      .send(command(profile))
      .expect(409);
    await http()
      .post('/account/store-application')
      .auth(f.owner.token, { type: 'bearer' })
      .send({ ...f.body, name: 'Other Store name' })
      .expect(409);
  });
  it('closed unused submit key fences a late writer without creating Store/grant/history', async () => {
    const owner = await actor(),
      body = command(profile),
      metadata = proof('OWNER', 'submit', owner.id, body);
    const r = await http()
      .post(`/account/store-application/commands/submit/${owner.id}/reconcile`)
      .auth(owner.token, { type: 'bearer' })
      .send(metadata)
      .expect(200);
    expect(r.body).toEqual({
      commandId: body.commandId,
      outcome: 'CLOSED',
      receipt: null,
    });
    await http()
      .post('/account/store-application')
      .auth(owner.token, { type: 'bearer' })
      .send(body)
      .expect(409);
    expect(await db.store.count({ where: { sellerId: owner.id } })).toBe(0);
  });
  it('Admin approval atomically grants Seller, rotates sessions and preserves Buyer access after login', async () => {
    const f = await fixture(),
      body = command({ expectedRevision: 1, status: 'ACTIVE' });
    const r = await review(f.admin, f.id, body).expect(200);
    expect(r.body.receipt).toMatchObject({
      status: 'ACTIVE',
      revision: 2,
      grantCreated: true,
      reauthenticationRequired: true,
    });
    const owner = await db.user.findUniqueOrThrow({
      where: { id: f.owner.id },
    });
    expect(owner).toMatchObject({ role: 'SELLER', credentialVersion: 2 });
    expect(
      await db.refreshToken.count({
        where: { userId: owner.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await db.accountSecurityEvent.count({
        where: { userId: owner.id, event: 'SELLER_GRANTED' },
      }),
    ).toBe(1);
    await http()
      .get('/account/store-application')
      .auth(f.owner.token, { type: 'bearer' })
      .expect(401);
    const session = await auth.login({ email: owner.email, password });
    await http()
      .get('/account/store-application')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(200);
    await http()
      .get('/me/addresses')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(200);
    expect(
      await db.storeSellerGrant.count({
        where: { storeId: f.id, ownerId: owner.id },
      }),
    ).toBe(1);
    expect(
      await db.searchReconciliationJob.count({
        where: { scope: 'STORE', scopeId: f.id },
      }),
    ).toBe(1);
  });
  it('owner submit receipt remains recoverable after promotion and fresh login; role/cv not in hash', async () => {
    const f = await fixture();
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 1, status: 'ACTIVE' }),
    ).expect(200);
    const session = await auth.login({ email: f.owner.email, password });
    const r = await http()
      .post(
        `/account/store-application/commands/submit/${f.owner.id}/reconcile`,
      )
      .auth(session.accessToken, { type: 'bearer' })
      .send(proof('OWNER', 'submit', f.owner.id, f.body))
      .expect(200);
    expect(r.body).toEqual(f.result);
  });
  it('concurrent Admin approve/reject commands have one winner, one history revision and no duplicate grant', async () => {
    const f = await fixture(),
      second = await actor('ADMIN');
    const results = await Promise.all([
      review(f.admin, f.id, command({ expectedRevision: 1, status: 'ACTIVE' })),
      review(
        second,
        f.id,
        command({ expectedRevision: 1, status: 'REJECTED' }),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const store = await db.store.findUniqueOrThrow({
      where: { id: f.id },
      include: { application: true },
    });
    expect(store.application!.revision).toBe(2);
    expect(
      await db.storeApplicationAudit.count({ where: { storeId: f.id } }),
    ).toBe(2);
    expect(await db.storeSellerGrant.count({ where: { storeId: f.id } })).toBe(
      store.status === 'ACTIVE' ? 1 : 0,
    );
  });
  it('concurrent first submits with different keys serialize on the existing User row', async () => {
    const owner = await actor();
    const results = await Promise.all(
      [command(profile), command(profile)].map((body) =>
        http()
          .post('/account/store-application')
          .auth(owner.token, { type: 'bearer' })
          .send(body),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.store.count({ where: { sellerId: owner.id } })).toBe(1);
  });
  it('rejection edit/resubmit reuses Store and requires fresh revision each step', async () => {
    const f = await fixture();
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 1, status: 'REJECTED' }),
    ).expect(200);
    await http()
      .post(`/account/store-application/${f.id}/resubmit`)
      .auth(f.owner.token, { type: 'bearer' })
      .send(command({ expectedRevision: 1 }))
      .expect(409);
    await http()
      .post(`/account/store-application/${f.id}/edit`)
      .auth(f.owner.token, { type: 'bearer' })
      .send(
        command({
          ...profile,
          name: 'Corrected Store profile',
          expectedRevision: 2,
        }),
      )
      .expect(200);
    await http()
      .post(`/account/store-application/${f.id}/resubmit`)
      .auth(f.owner.token, { type: 'bearer' })
      .send(command({ expectedRevision: 3 }))
      .expect(200);
    expect(
      await db.store.findUniqueOrThrow({
        where: { id: f.id },
        include: { application: true },
      }),
    ).toMatchObject({ status: 'PENDING', application: { revision: 4 } });
    expect(await db.store.count({ where: { sellerId: f.owner.id } })).toBe(1);
  });
  it('suspension blocks owner edits/resubmit; Admin restore keeps original grant/cv', async () => {
    const f = await fixture();
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 1, status: 'ACTIVE' }),
    ).expect(200);
    const session = await auth.login({ email: f.owner.email, password });
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 2, status: 'SUSPENDED' }),
    ).expect(200);
    for (const action of ['edit', 'resubmit'])
      await http()
        .post(`/account/store-application/${f.id}/${action}`)
        .auth(session.accessToken, { type: 'bearer' })
        .send(
          command({
            ...(action === 'edit' ? profile : {}),
            expectedRevision: 3,
          }),
        )
        .expect(403);
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 3, status: 'ACTIVE' }),
    ).expect(200);
    expect(await db.storeSellerGrant.count({ where: { storeId: f.id } })).toBe(
      1,
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: f.owner.id } }))
        .credentialVersion,
    ).toBe(2);
  });
  it('new application cannot use legacy Store update/resubmit/Admin review endpoints, even with rollout off', async () => {
    const f = await fixture();
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 1, status: 'ACTIVE' }),
    ).expect(200);
    const session = await auth.login({ email: f.owner.email, password });
    process.env.SELLER_ONBOARDING_ENABLED = 'false';
    try {
      await http()
        .patch('/seller/store')
        .auth(session.accessToken, { type: 'bearer' })
        .send({ name: 'Bypass change' })
        .expect(409);
      await http()
        .post('/seller/store/resubmit')
        .auth(session.accessToken, { type: 'bearer' })
        .expect(409);
      await http()
        .patch(`/admin/stores/${f.id}/status`)
        .auth(f.admin.token, { type: 'bearer' })
        .send({ status: 'SUSPENDED', reason: 'QA legacy bypass must fail' })
        .expect(409);
    } finally {
      process.env.SELLER_ONBOARDING_ENABLED = 'true';
    }
    expect(
      (await db.store.findUniqueOrThrow({ where: { id: f.id } })).status,
    ).toBe('ACTIVE');
  });
  it('legacy Seller without Store can apply, approval does not rotate an already Seller account', async () => {
    const seller = await actor('SELLER'),
      admin = await actor('ADMIN'),
      s = await submit(seller);
    const r = await review(
      admin,
      s.id,
      command({ expectedRevision: 1, status: 'ACTIVE' }),
    ).expect(200);
    expect(r.body.receipt).toMatchObject({
      grantCreated: true,
      reauthenticationRequired: false,
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: seller.id } }))
        .credentialVersion,
    ).toBe(1);
  });
  it('legacy profile PATCH cannot race first application submit and bypass its audit/revision', async () => {
    const seller = await actor('SELLER');
    let release!: () => void, reached!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const original = db.store.updateMany.bind(db.store);
    const spy = vi.spyOn(db.store, 'updateMany').mockImplementation((args) => {
      const deferred = (async () => {
        reached();
        await barrier;
        return original(args);
      })();
      return deferred as ReturnType<typeof original>;
    });
    try {
      const legacy = http()
        .patch('/seller/store')
        .auth(seller.token, { type: 'bearer' })
        .send({ name: 'Un-audited legacy change' })
        .then((reply) => ({ kind: 'reply' as const, reply }));
      const first = await Promise.race([
        legacy,
        entered.then(() => ({ kind: 'barrier' as const })),
      ]);
      const created = await submit(seller);
      release();
      const result = first.kind === 'reply' ? first : await legacy;
      expect([404, 409]).toContain(result.reply.status);
      const stored = await db.store.findUniqueOrThrow({
        where: { id: created.id },
        include: { application: true },
      });
      expect(stored.name).toBe(profile.name);
      expect(stored.application!.revision).toBe(1);
      expect(
        await db.storeApplicationAudit.count({
          where: { storeId: created.id },
        }),
      ).toBe(1);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it('legacy Store keeps legacy management and is not silently enrolled or granted', async () => {
    const seller = await actor('SELLER'),
      admin = await actor('ADMIN'),
      store = await db.store.create({
        data: {
          sellerId: seller.id,
          name: 'Synthetic legacy Store',
          status: 'PENDING',
        },
      });
    await http()
      .get('/account/store-application')
      .auth(seller.token, { type: 'bearer' })
      .expect(409);
    await http()
      .patch(`/admin/stores/${store.id}/status`)
      .auth(admin.token, { type: 'bearer' })
      .send({ status: 'ACTIVE', reason: 'QA legacy path remains available' })
      .expect(200);
    expect(
      await db.storeApplication.count({ where: { storeId: store.id } }),
    ).toBe(0);
    expect(
      await db.storeSellerGrant.count({ where: { storeId: store.id } }),
    ).toBe(0);
  });
  it('approval fails closed when Buyer capability flag is not enabled', async () => {
    const f = await fixture();
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'false';
    try {
      await review(
        f.admin,
        f.id,
        command({ expectedRevision: 1, status: 'ACTIVE' }),
      ).expect(409);
    } finally {
      process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
    }
    expect(
      (await db.store.findUniqueOrThrow({ where: { id: f.id } })).status,
    ).toBe('PENDING');
    expect(await db.storeSellerGrant.count({ where: { storeId: f.id } })).toBe(
      0,
    );
  });
  it('Search enqueue failure rolls back promotion, grant, histories, revision, sessions and receipt', async () => {
    const f = await fixture(),
      body = command({ expectedRevision: 1, status: 'ACTIVE' });
    const enqueue = vi
      .spyOn(app.get(SearchReconciliationService), 'enqueueStore')
      .mockRejectedValueOnce(new Error('Synthetic QA enqueue failure'));
    try {
      await review(f.admin, f.id, body).expect(503);
    } finally {
      enqueue.mockRestore();
    }
    expect(
      await db.user.findUniqueOrThrow({ where: { id: f.owner.id } }),
    ).toMatchObject({ role: 'USER', credentialVersion: 1 });
    expect(
      await db.store.findUniqueOrThrow({
        where: { id: f.id },
        include: { application: true },
      }),
    ).toMatchObject({ status: 'PENDING', application: { revision: 1 } });
    expect(await db.storeSellerGrant.count({ where: { storeId: f.id } })).toBe(
      0,
    );
    expect(
      await db.storeApplicationAudit.count({ where: { storeId: f.id } }),
    ).toBe(1);
    expect(
      await db.storeApplicationCommand.count({
        where: { actorId: f.admin.id, commandId: body.commandId },
      }),
    ).toBe(0);
    expect(
      await db.refreshToken.count({
        where: { userId: f.owner.id, revokedAt: null },
      }),
    ).toBe(1);
  });
  it('DB rejects audit/grant/command updates, owner swaps, skipped revisions and status without matching audit', async () => {
    const f = await fixture();
    await review(
      f.admin,
      f.id,
      command({ expectedRevision: 1, status: 'ACTIVE' }),
    ).expect(200);
    const other = await actor();
    for (const sql of [
      `UPDATE store_application_audits SET reason='Changed audit reason' WHERE "storeId"=${f.id}`,
      `DELETE FROM store_seller_grants WHERE "storeId"=${f.id}`,
      `UPDATE store_application_commands SET outcome='CLOSED' WHERE "storeId"=${f.id}`,
      `UPDATE stores SET "sellerId"=${other.id} WHERE id=${f.id}`,
      `UPDATE store_applications SET revision=revision+2 WHERE "storeId"=${f.id}`,
      `UPDATE stores SET status='SUSPENDED' WHERE id=${f.id}`,
    ])
      await expect(db.$executeRawUnsafe(sql)).rejects.toThrow();
  });
  it('strict query/body boundaries and owner IDOR never create commands', async () => {
    const f = await fixture(),
      other = await actor();
    await http()
      .get('/admin/store-applications?limit=01')
      .auth(f.admin.token, { type: 'bearer' })
      .expect(400);
    await http()
      .get('/admin/store-applications?limit=1&limit=2')
      .auth(f.admin.token, { type: 'bearer' })
      .expect(400);
    await http()
      .get('/account/store-application')
      .auth(f.owner.token, { type: 'bearer' })
      .send({ secret: 'not accepted' })
      .expect(400);
    await review(f.admin, f.id, {
      ...command({ expectedRevision: 1, status: 'ACTIVE' }),
      sellerId: other.id,
    }).expect(400);
    await http()
      .post(`/account/store-application/${f.id}/edit`)
      .auth(other.token, { type: 'bearer' })
      .send(command({ ...profile, expectedRevision: 1 }))
      .expect(403);
    await http()
      .post(
        `/account/store-application/commands/submit/${f.owner.id}/reconcile`,
      )
      .auth(other.token, { type: 'bearer' })
      .send(proof('OWNER', 'submit', f.owner.id, f.body))
      .expect(403);
  });
});
