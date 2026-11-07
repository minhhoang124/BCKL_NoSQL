import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Admin Accounts read HTTP + PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const marker = `accounts-read-${Date.now()}`;
  const ids: number[] = [];
  let serial = 0;
  let admin: { id: number; token: string };
  let buyer: { id: number; token: string };
  let seller: { id: number; token: string };
  let inactive: { id: number; token: string };
  let otherAdmin: { id: number; token: string };
  const http = () => request(app.getHttpServer());
  const get = (query = '', token = admin.token) =>
    http().get(`/admin/accounts${query}`).set('Authorization', token);

  async function actor(role: Role, isActive = true) {
    const row = await prisma.user.create({
      data: {
        email: `${marker}-${serial++}@example.com`,
        passwordHash: 'PRIVATE_HASH',
        fullName: `${marker} Display ${serial}`,
        role,
        isActive,
      },
    });
    ids.push(row.id);
    const config = app.get(ConfigService);
    return {
      id: row.id,
      token: `Bearer ${app.get(JwtService).sign(
        {
          sub: row.id,
          email: row.email,
          role,
          type: 'access',
        },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      )}`,
    };
  }

  beforeAll(async () => {
    // Fail before connecting if a local invocation targets any shared/demo DB.
    const url = new URL(process.env.DATABASE_URL!);
    if (
      process.env.GITHUB_ACTIONS !== 'true' &&
      (!['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '5549' ||
        !url.pathname.startsWith('/bckl_order_resolution_test_'))
    )
      throw new Error('Accounts E2E requires isolated QA database on 5549');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    admin = await actor(Role.ADMIN);
    otherAdmin = await actor(Role.ADMIN);
    buyer = await actor(Role.USER);
    seller = await actor(Role.SELLER);
    inactive = await actor(Role.ADMIN, false);
    await prisma.store.create({
      data: {
        sellerId: seller.id,
        name: `${marker} Store`,
        status: 'SUSPENDED',
      },
    });
  });
  afterAll(async () => {
    if (prisma && ids.length) {
      await prisma.store.deleteMany({ where: { sellerId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  it('rejects guests, Buyer/Seller and inactive Admin with no-store', async () => {
    const guest = await http().get('/admin/accounts').expect(401);
    expect(guest.headers['cache-control']).toBe('no-store');
    for (const [actor, status] of [
      [buyer, 403],
      [seller, 403],
      [inactive, 401],
    ] as const) {
      const response = await get('', actor.token).expect(status);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
  it('returns only explicit public-to-Admin fields and Store summary', async () => {
    const response = await get(`?q=${marker}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body).sort()).toEqual(['items', 'nextCursor']);
    expect(response.body.items).toHaveLength(5);
    for (const item of response.body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'email',
        'fullName',
        'id',
        'isActive',
        'role',
        'store',
        'updatedAt',
      ]);
      expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
    }
    const store = response.body.items.find(
      (item: { id: number }) => item.id === seller.id,
    ).store;
    expect(Object.keys(store).sort()).toEqual(['id', 'name', 'status']);
    expect(store.status).toBe('SUSPENDED');
    expect(
      response.body.items.find((item: { id: number }) => item.id === buyer.id)
        .store,
    ).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_HASH');
  });
  it('paginates by ascending ID, with no duplicates and null final cursor', async () => {
    const seen: number[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 4; page++) {
      const response: request.Response = await get(
        `?q=${marker}&limit=2${cursor ? `&afterId=${cursor}` : ''}`,
      ).expect(200);
      seen.push(...response.body.items.map((item: { id: number }) => item.id));
      cursor = response.body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([...ids].sort((a, b) => a - b));
    expect(cursor).toBeNull();
    expect((await get('?afterId=2147483647').expect(200)).body).toEqual({
      items: [],
      nextCursor: null,
    });
  });
  it('combines filters and finds email/fullName case-insensitively', async () => {
    expect(
      (
        await get(
          `?q=${marker.toUpperCase()}&role=ADMIN&isActive=false`,
        ).expect(200)
      ).body.items.map((row: { id: number }) => row.id),
    ).toEqual([inactive.id]);
    expect(
      (
        await get(
          `?q=${encodeURIComponent(`${marker} Display`)}&role=SELLER`,
        ).expect(200)
      ).body.items.map((row: { id: number }) => row.id),
    ).toEqual([seller.id]);
  });
  it.each([
    'limit=101',
    'limit=1&limit=2',
    'q=x&q=y',
    'q[]=x',
    'isActive=1',
    'passwordHash=x',
    'afterId=2147483648',
  ])('rejects invalid query %s', async (query) => {
    const result = await get(`?${query}`).expect(400);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('does not interpret SQL wildcard or injection text as a broad filter', async () => {
    const original = await prisma.user.findUniqueOrThrow({
      where: { id: buyer.id },
    });
    await prisma.user.update({
      where: { id: buyer.id },
      data: { fullName: `${marker} % _ \\ ' OR 1=1 --` },
    });
    try {
      for (const text of ['%', '_', "' OR 1=1 --", '\\']) {
        const response = await get(
          `?afterId=${buyer.id - 1}&q=${encodeURIComponent(text)}`,
        ).expect(200);
        expect(
          response.body.items.map((row: { id: number }) => row.id),
        ).toEqual([buyer.id]);
      }
    } finally {
      await prisma.user.update({
        where: { id: buyer.id },
        data: { fullName: original.fullName },
      });
    }
  });
  it('covers HEAD, case variants, errors and unsupported bodies', async () => {
    expect(
      (
        await http()
          .head('/ADMIN/ACCOUNTS/')
          .set('Authorization', admin.token)
          .expect(200)
      ).headers['cache-control'],
    ).toBe('no-store');
    expect((await get().send({}).expect(400)).headers['cache-control']).toBe(
      'no-store',
    );
    expect(
      (await http().get('/ADMIN/ACCOUNTS').expect(401)).headers[
        'cache-control'
      ],
    ).toBe('no-store');
  });
  it('rechecks current role/state instead of trusting JWT role', async () => {
    await prisma.user.update({
      where: { id: otherAdmin.id },
      data: { role: Role.USER },
    });
    await get('', otherAdmin.token).expect(403);
    await prisma.user.update({
      where: { id: otherAdmin.id },
      data: { role: Role.ADMIN, isActive: false },
    });
    await get('', otherAdmin.token).expect(401);
  });
  it('does not mutate users or create reconciliation/outbox work', async () => {
    const before = await prisma.user.findMany({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    const jobs = await prisma.searchReconciliationJob.count();
    const outbox = await prisma.searchOutbox.count();
    await get(`?q=${marker}`).expect(200);
    expect(
      await prisma.user.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(await prisma.searchReconciliationJob.count()).toBe(jobs);
    expect(await prisma.searchOutbox.count()).toBe(outbox);
  });
});
