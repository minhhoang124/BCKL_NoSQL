import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

// A real FastAPI process from this checkout; no model downloads or shared indices.
describe.skipIf(process.env.RUN_LIVE_SEARCH_HEALTH !== 'true')(
  'Admin → real FastAPI cached readiness (models deliberately not loaded)',
  () => {
    let child: ChildProcess | undefined,
      app: INestApplication | undefined,
      prisma: PrismaService | undefined;
    let actorId: number | undefined, port: number;
    const secret = randomUUID();
    beforeAll(async () => {
      assertAttributeReadQaTarget(process.env.DATABASE_URL);
      const executable = process.env.PYTHON_HEALTH_QA_EXECUTABLE;
      if (!executable)
        throw new Error('Explicit QA Python executable required');
      const socket = createServer();
      await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
      const address = socket.address();
      if (!address || typeof address === 'string')
        throw new Error('No QA port');
      port = address.port;
      await new Promise<void>((done) => socket.close(() => done()));
      child = spawn(
        executable,
        [
          '-m',
          'uvicorn',
          'app.main:app',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        {
          cwd: resolve(process.cwd(), '../AI_CLIP'),
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            AI_LOAD_RUNTIME_ON_STARTUP: 'false',
            AI_INTERNAL_HEALTH_TOKEN: secret,
            AI_ELASTICSEARCH_URL: 'http://127.0.0.1:9',
            AI_ELASTICSEARCH_INDEX_NAME: `health-qa-${randomUUID()}`,
            AI_PRODUCT_SYNC_STATE_PATH: resolve(
              tmpdir(),
              `health-qa-${randomUUID()}`,
              'state.json',
            ),
            HF_HUB_OFFLINE: '1',
            TRANSFORMERS_OFFLINE: '1',
          },
        },
      );
      let started = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        if (child.exitCode !== null)
          throw new Error('Isolated FastAPI exited before readiness');
        try {
          const response = await fetch(
            `http://127.0.0.1:${port}/internal/health/search`,
            { signal: AbortSignal.timeout(300) },
          );
          if (response.status === 401) {
            started = true;
            break;
          }
        } catch {
          /* bounded startup polling, no writes or authenticated deep probe */
        }
        await delay(100);
      }
      if (!started)
        throw new Error('Isolated FastAPI startup deadline exceeded');
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication();
      app.get(ConfigService).set('AI_SERVICE_URL', `http://127.0.0.1:${port}`);
      app.get(ConfigService).set('SEARCH_INTERNAL_HEALTH_TOKEN', secret);
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      const database = app.get<PrismaService>(PrismaService);
      prisma = database;
      actorId = (
        await database.user.create({
          data: {
            email: `health-live-${randomUUID()}@example.test`,
            passwordHash: 'fixture-no-login',
            role: 'ADMIN',
          },
        })
      ).id;
    }, 15000);
    afterAll(async () => {
      try {
        if (prisma && actorId)
          await prisma.user.delete({ where: { id: actorId } });
      } finally {
        await app?.close();
        if (child && child.exitCode === null) {
          child.kill();
          await Promise.race([
            new Promise<void>((done) => child!.once('exit', () => done())),
            delay(2000),
          ]);
        }
      }
    });
    it('accepts the canonical live response without HTTP mocks or fake healthy components', async () => {
      if (!app || !prisma || !actorId)
        throw new Error('QA bootstrap incomplete');
      const before = await prisma.searchOutbox.count();
      const config = app.get(ConfigService);
      const token = app.get(JwtService).sign(
        {
          sub: actorId,
          role: 'ADMIN',
          email: 'fixture@example.test',
          type: 'access',
        },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      );
      const response = await request(app.getHttpServer())
        .get('/admin/system-health')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.search.errorCode).toBeNull();
      expect(response.body.search.snapshot.schemaVersion).toBe(1);
      expect(
        Object.keys(response.body.search.snapshot.components).sort(),
      ).toEqual(['clipImage', 'clipText', 'elasticsearch', 'faiss']);
      expect(['UNKNOWN', 'UNAVAILABLE']).toContain(response.body.search.status);
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(await prisma.searchOutbox.count()).toBe(before);
    });
  },
);
