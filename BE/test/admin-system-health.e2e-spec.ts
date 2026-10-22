import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';
import type { SearchHealthSnapshot } from '../src/health/search-health-contract.js';

describe('Admin health HTTP + PostgreSQL with an isolated fixture upstream (not live FastAPI)', () => {
  let app: INestApplication, pool: Pool;
  const ids: number[] = [];
  const marker = randomUUID();
  let admin: number, buyer: number, seller: number;
  let mode = 'normal',
    calls = 0;
  let held: ServerResponse | null = null;
  let observedRequest: (() => void) | null = null;
  const upstream = createServer((req, res) => {
    calls++;
    if (
      req.url !== '/internal/health/search' ||
      req.headers['x-internal-health-token'] !== 'qa-internal-health-only'
    ) {
      res.writeHead(401).end();
      return;
    }
    if (mode === 'hold') {
      held = res;
      observedRequest?.();
      return;
    }
    if (mode === 'stall') return;
    const snapshot = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          '../docs/api/examples/search-health-proposed-v1.json',
        ),
        'utf8',
      ),
    ) as SearchHealthSnapshot;
    const offset = Date.now() - Date.parse(snapshot.generatedAt);
    snapshot.generatedAt = new Date(
      Date.parse(snapshot.generatedAt) + offset,
    ).toISOString();
    for (const component of Object.values(snapshot.components))
      for (const key of ['checkedAt', 'expiresAt', 'lastSuccessAt'] as const) {
        if (component[key])
          component[key] = new Date(
            Date.parse(component[key]) + offset,
          ).toISOString();
      }
    res.setHeader('content-type', 'application/json');
    res.end(
      mode === 'oversize'
        ? 'x'.repeat(32769)
        : JSON.stringify(
            mode === 'extra'
              ? { ...snapshot, secretPath: '/private' }
              : snapshot,
          ),
    );
  });
  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    for (const role of ['ADMIN', 'USER', 'SELLER']) {
      const row = await pool.query(
        `INSERT INTO users (email,"passwordHash",role,"updatedAt")
        VALUES ($1,'fixture-only',$2,NOW()) RETURNING id`,
        [`health-${marker}-${role}@example.test`, role],
      );
      ids.push(row.rows[0].id);
    }
    [admin, buyer, seller] = ids;
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  });
  beforeEach(async () => {
    mode = 'normal';
    calls = 0;
    held = null;
    observedRequest = null;
    await pool.query(
      `UPDATE users SET "isActive"=true WHERE id=ANY($1::int[])`,
      [ids],
    );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    const address = upstream.address();
    if (!address || typeof address === 'string')
      throw new Error('Fixture server missing');
    app
      .get(ConfigService)
      .set('AI_SERVICE_URL', `http://127.0.0.1:${address.port}`);
    app
      .get(ConfigService)
      .set('SEARCH_INTERNAL_HEALTH_TOKEN', 'qa-internal-health-only');
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    held?.destroy();
    await app?.close();
  });
  afterAll(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    if (ids.length)
      await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [ids]);
    await pool?.end();
  });
  function token(id = admin, role = 'ADMIN') {
    const config = app.get(ConfigService);
    return (
      'Bearer ' +
      app.get(JwtService).sign(
        { sub: id, role, email: 'fixture@example.test', type: 'access' },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      )
    );
  }
  const get = () =>
    request(app.getHttpServer())
      .get('/admin/system-health')
      .set('Authorization', token());
  it('returns real HTTP snapshot, cached without mutation or secret disclosure', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS n FROM search_outbox',
    );
    const first = await get().expect(200).expect('Cache-Control', 'no-store');
    expect(first.body.search.status).toBe('DEGRADED');
    expect(first.body.search.snapshot.capabilities.hybridText.status).toBe(
      'UNAVAILABLE',
    );
    expect(first.body.postgresql.status).toBe('READY');
    const second = await get().expect(200);
    expect(calls).toBe(1);
    expect(second.body.collectedAt).toBe(first.body.collectedAt);
    expect(JSON.stringify(first.body)).not.toMatch(
      /qa-internal-health-only|passwordHash|example\.test|127\.0\.0\.1/,
    );
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM search_outbox')).rows,
    ).toEqual(before.rows);
  });
  it('guest and current non-Admin cannot read, even with a forged ADMIN role claim', async () => {
    await request(app.getHttpServer())
      .get('/admin/system-health')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    for (const id of [buyer, seller])
      await request(app.getHttpServer())
        .get('/admin/system-health')
        .set('Authorization', token(id))
        .expect(403);
    expect(calls).toBe(0);
  });
  it('inactive Admin is denied before network', async () => {
    await pool.query('UPDATE users SET "isActive"=false WHERE id=$1', [admin]);
    await get().expect(401).expect('Cache-Control', 'no-store');
    expect(calls).toBe(0);
  });
  it('revocation while upstream is in-flight blocks the result', async () => {
    mode = 'hold';
    const observed = new Promise<void>((done) => {
      observedRequest = done;
    });
    const result = get().then((response) => response);
    await observed;
    await pool.query('UPDATE users SET "isActive"=false WHERE id=$1', [admin]);
    held!.setHeader('content-type', 'application/json');
    held!.end('{}');
    expect((await result).status).toBe(401);
  });
  it.each(['extra', 'oversize'])(
    'malformed HTTP200 is UNKNOWN, not healthy: %s',
    async (value) => {
      mode = value;
      const response = await get().expect(200);
      expect(response.body.search).toMatchObject({
        status: 'UNKNOWN',
        errorCode: 'AI_INVALID_RESPONSE',
        snapshot: null,
      });
      expect(JSON.stringify(response.body)).not.toContain('/private');
    },
  );
  it('stalled upstream has a bounded real socket deadline and no retry', async () => {
    mode = 'stall';
    const start = performance.now();
    const response = await get().expect(200);
    expect(response.body.search.errorCode).toBe('AI_TIMEOUT');
    expect(performance.now() - start).toBeLessThan(5000);
    expect(calls).toBe(1);
  });
  it('rejects query/body before parsing or dispatch and covers HEAD/case/trailing slash', async () => {
    await request(app.getHttpServer())
      .get('/ADMIN/SYSTEM-HEALTH/?url=private')
      .expect(400)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .get('/admin/system-health')
      .set('Authorization', token())
      .send({ force: true })
      .expect(400);
    await request(app.getHttpServer())
      .head('/ADMIN/SYSTEM-HEALTH/')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    expect(calls).toBe(0);
  });
});
