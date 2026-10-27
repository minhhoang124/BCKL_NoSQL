import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { GoogleOAuthGuard } from '../src/auth/google-oauth.controller.js';
import {
  GoogleOAuthProvider,
  oauthDigest,
  type GoogleProfile,
} from '../src/auth/google-oauth.provider.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
describe('Google OAuth HTTP/PostgreSQL — local fake provider, not live Google acceptance', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    passwordHash: string;
  const old = { ...process.env },
    origin = 'http://localhost:5173',
    password = 'Synthetic-google-local-password-2026';
  const codes = new Map<string, GoogleProfile>(),
    nonces = new Map<string, string>();
  const exchange = vi.fn(
    async (code: string, _verifier: string, nonceHash: string) => {
      if (!nonces.has(nonceHash) || !codes.has(code))
        throw Error('Invalid synthetic exchange');
      return codes.get(code)!;
    },
  );
  const authorization = vi.fn(
    (state: string, nonce: string, challenge: string) => {
      nonces.set(oauthDigest(nonce), nonce);
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}&code_challenge=${challenge}&code_challenge_method=S256&response_type=code`;
    },
  );
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    Object.assign(process.env, {
      AUTH_GOOGLE_ENABLED: 'true',
      GOOGLE_OAUTH_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-google-client-secret',
      GOOGLE_OAUTH_STATE_SECRET: 'synthetic-google-state-key-at-least-32-bytes',
      GOOGLE_OAUTH_CALLBACK_URL: 'http://localhost:3001/auth/google/callback',
      GOOGLE_OAUTH_WEB_ORIGIN: origin,
    });
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(GoogleOAuthProvider)
        .useValue({ exchange, authorization })
        .overrideGuard(GoogleOAuthGuard)
        .useValue({ canActivate: () => true })
        .compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    for (const k of [
      'AUTH_GOOGLE_ENABLED',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_OAUTH_STATE_SECRET',
      'GOOGLE_OAUTH_CALLBACK_URL',
      'GOOGLE_OAUTH_WEB_ORIGIN',
    ]) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  });
  const profile = (extra: Partial<GoogleProfile> = {}): GoogleProfile => ({
    subject: randomUUID(),
    email: `google-${randomUUID()}@example.invalid`,
    authoritative: false,
    fullName: 'Synthetic Google User',
    ...extra,
  });
  async function start() {
    const r = await http()
      .post('/auth/google/start')
      .set('Origin', origin)
      .send({ confirmed: true })
      .expect(200);
    return flow(r);
  }
  function flow(r: request.Response) {
    const u = new URL(r.body.authorizationUrl);
    const cookie = (r.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('bcklGoogleProof='))!
      .split(';')[0]!;
    return { state: u.searchParams.get('state')!, cookie, url: u };
  }
  async function actor() {
    const user = await db.user.create({
        data: { email: `local-${randomUUID()}@example.invalid`, passwordHash },
      }),
      session = await auth.login({ email: user.email, password });
    return { ...user, ...session };
  }
  async function linkStart(u: Awaited<ReturnType<typeof actor>>) {
    const r = await http()
      .post('/auth/google/link')
      .auth(u.accessToken, { type: 'bearer' })
      .set('Origin', origin)
      .set('Cookie', `refreshToken=${u.refreshToken}`)
      .send({ confirmed: true, currentPassword: password })
      .expect(200);
    return flow(r);
  }
  const callback = (
    f: { state: string; cookie: string },
    p: GoogleProfile,
    refresh?: string,
  ) => {
    const code = randomUUID();
    codes.set(code, p);
    return http()
      .get('/auth/google/callback')
      .query({ state: f.state, code })
      .set('Cookie', [
        f.cookie,
        ...(refresh ? [`refreshToken=${refresh}`] : []),
      ]);
  };
  it('uses a restricted app role without superuser or role creation', async () => {
    if (process.env.GITHUB_ACTIONS === 'true') return;
    const [r] = await db.$queryRaw<
      { rolsuper: boolean; rolcreaterole: boolean }[]
    >`SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    expect(r).toEqual({ rolsuper: false, rolcreaterole: false });
  });
  it('creates a USER and identity atomically, returns only a standard refresh cookie and fixed redirect', async () => {
    const f = await start(),
      p = profile({ authoritative: true });
    const r = await callback(f, p).expect(303);
    expect(r.headers.location).toBe(origin + '/account');
    expect(r.headers['cache-control']).toBe('no-store');
    const user = await db.user.findUniqueOrThrow({ where: { email: p.email } });
    expect(user.role).toBe('USER');
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(
      await db.googleIdentity.count({
        where: { userId: user.id, subject: p.subject },
      }),
    ).toBe(1);
    expect(await db.store.count({ where: { sellerId: user.id } })).toBe(0);
    const cookie = (r.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/auth');
    expect(r.headers.location).not.toMatch(/token|code|state/);
  });
  it('does not infer current mailbox verification for a non-authoritative third-party email', async () => {
    const p = profile();
    await callback(await start(), p).expect(303);
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: p.email } }))
        .emailVerifiedAt,
    ).toBeNull();
  });
  it('rejects a duplicate callback and never exchanges the same state twice', async () => {
    const f = await start(),
      p = profile(),
      before = exchange.mock.calls.length;
    await callback(f, p).expect(303);
    const r = await callback(f, p).expect(303);
    expect(r.headers.location).toBe(origin + '/login?google=failed');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(exchange.mock.calls.length - before).toBe(1);
  });
  it('serializes concurrent callbacks before network exchange and account mutation', async () => {
    const f = await start(),
      p = profile(),
      before = exchange.mock.calls.length;
    const r = await Promise.all([callback(f, p), callback(f, p)]);
    expect(r.map((x) => x.headers.location).sort()).toEqual(
      [origin + '/account', origin + '/login?google=failed'].sort(),
    );
    expect(exchange.mock.calls.length - before).toBe(1);
    expect(await db.user.count({ where: { email: p.email } })).toBe(1);
  });
  it('wrong browser cookie does not burn the rightful challenge', async () => {
    const f = await start(),
      p = profile(),
      r = await callback(
        {
          ...f,
          cookie: 'bcklGoogleProof=' + randomBytes(32).toString('base64url'),
        },
        p,
      );
    expect(r.headers.location).toBe(origin + '/login?google=failed');
    expect(
      (
        await db.googleOAuthChallenge.findUniqueOrThrow({
          where: { stateHash: oauthDigest(f.state) },
        })
      ).claimedAt,
    ).toBeNull();
    expect((await callback(f, p)).headers.location).toBe(origin + '/account');
  });
  it('email collision never auto-links or logs into the existing account', async () => {
    const u = await actor(),
      p = profile({ email: u.user.email, authoritative: true }),
      r = await callback(await start(), p);
    expect(r.headers.location).toBe(origin + '/login?google=collision');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(
      await db.googleIdentity.count({ where: { userId: u.user.id } }),
    ).toBe(0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).role,
    ).toBe('USER');
  });
  it('a returning sub retains its own User even if Google email changes to another User email', async () => {
    const p = profile();
    await callback(await start(), p);
    const first = await db.googleIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'GOOGLE', subject: p.subject } },
    });
    const other = await actor();
    const r = await callback(await start(), { ...p, email: other.user.email });
    expect(r.headers.location).toBe(origin + '/account');
    expect(
      (await db.googleIdentity.findUniqueOrThrow({ where: { id: first.id } }))
        .userId,
    ).toBe(first.userId);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: first.userId } })).email,
    ).toBe(p.email);
  });
  it('blocks a disabled Google identity without minting another refresh session', async () => {
    const p = profile();
    await callback(await start(), p);
    const u = await db.user.update({
      where: { email: p.email },
      data: { isActive: false },
    });
    const before = await db.refreshToken.count({ where: { userId: u.id } });
    expect((await callback(await start(), p)).headers.location).toBe(
      origin + '/login?google=failed',
    );
    expect(await db.refreshToken.count({ where: { userId: u.id } })).toBe(
      before,
    );
  });
  it('explicit LINK keeps email/role, increments CV, revokes all sessions and audits once', async () => {
    const u = await actor(),
      f = await linkStart(u),
      p = profile();
    const r = await callback(f, p, u.refreshToken);
    expect(r.headers.location).toBe(origin + '/login?google=linked');
    expect(r.headers['set-cookie']).toBeUndefined();
    const after = await db.user.findUniqueOrThrow({ where: { id: u.user.id } });
    expect(after.email).toBe(u.user.email);
    expect(after.role).toBe('USER');
    expect(after.credentialVersion).toBe(u.credentialVersion + 1);
    expect(after.emailVerifiedAt).toBeNull();
    expect(
      await db.refreshToken.count({
        where: { userId: after.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await db.accountSecurityEvent.count({
        where: { userId: after.id, event: 'GOOGLE_LINKED' },
      }),
    ).toBe(1);
    await expect(auth.refresh(u.refreshToken)).rejects.toThrow();
  });
  it('logout before LINK callback prevents linking even when access JWT is not expired', async () => {
    const u = await actor(),
      f = await linkStart(u);
    await auth.logout(u.refreshToken);
    expect(
      (await callback(f, profile(), u.refreshToken)).headers.location,
    ).toBe(origin + '/login?google=failed');
    expect(
      await db.googleIdentity.count({ where: { userId: u.user.id } }),
    ).toBe(0);
  });
  it('password/CV change or switched session before LINK callback prevents linking', async () => {
    const u = await actor(),
      f = await linkStart(u);
    await db.user.update({
      where: { id: u.user.id },
      data: { credentialVersion: { increment: 1 } },
    });
    expect(
      (await callback(f, profile(), u.refreshToken)).headers.location,
    ).toBe(origin + '/login?google=failed');
    const v = await actor(),
      g = await linkStart(v),
      w = await actor();
    expect(
      (await callback(g, profile(), w.refreshToken)).headers.location,
    ).toBe(origin + '/login?google=failed');
  });
  it('requires password, consent and live refresh session for LINK initiation', async () => {
    const u = await actor();
    for (const body of [
      { confirmed: false, currentPassword: password },
      { confirmed: true, currentPassword: 'wrong' },
      { confirmed: true, currentPassword: password, role: 'ADMIN' },
    ]) {
      const r = await http()
        .post('/auth/google/link')
        .auth(u.accessToken, { type: 'bearer' })
        .set('Cookie', `refreshToken=${u.refreshToken}`)
        .send(body);
      expect([400, 401]).toContain(r.status);
    }
    await http()
      .post('/auth/google/link')
      .auth(u.accessToken, { type: 'bearer' })
      .send({ confirmed: true, currentPassword: password })
      .expect(401);
  });
  it('provider failure burns only its challenge and never creates identity/session', async () => {
    const f = await start();
    exchange.mockRejectedValueOnce(Error('Synthetic provider outage'));
    expect((await callback(f, profile())).headers.location).toBe(
      origin + '/login?google=failed',
    );
    expect(
      (
        await db.googleOAuthChallenge.findUniqueOrThrow({
          where: { stateHash: oauthDigest(f.state) },
        })
      ).completedAt,
    ).toBeNull();
    expect((await callback(f, profile())).headers.location).toBe(
      origin + '/login?google=failed',
    );
  });
  it('session creation failure rolls back new User and identity together', async () => {
    const p = profile(),
      f = await start();
    vi.spyOn(auth, 'createFederatedSession').mockRejectedValueOnce(
      Error('Synthetic session failure'),
    );
    expect((await callback(f, p)).headers.location).toBe(
      origin + '/login?google=failed',
    );
    expect(await db.user.count({ where: { email: p.email } })).toBe(0);
    expect(
      await db.googleIdentity.count({ where: { subject: p.subject } }),
    ).toBe(0);
  });
  it('rejects duplicate query fields, cancellation and arbitrary redirect parameters without leaking input', async () => {
    const f = await start();
    for (const suffix of [
      `state=${f.state}&state=${f.state}&code=fake`,
      `state=${f.state}&code=fake&returnTo=https://evil.invalid`,
    ]) {
      const r = await http()
        .get('/auth/google/callback?' + suffix)
        .set('Cookie', f.cookie);
      expect(r.headers.location).toBe(origin + '/login?google=failed');
    }
    const r = await http()
      .get('/auth/google/callback')
      .query({ state: f.state, error: 'access_denied' })
      .set('Cookie', f.cookie);
    expect(r.headers.location).toBe(origin + '/login?google=failed');
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('rejects LOGIN if another account signed in while the browser was at Google', async () => {
    const f=await start(),other=await actor(),p=profile();
    expect((await callback(f,p,other.refreshToken)).headers.location).toBe(origin+'/login?google=failed');
    expect(await db.googleIdentity.count({where:{subject:p.subject}})).toBe(0);
    expect((await db.googleOAuthChallenge.findUniqueOrThrow({where:{stateHash:oauthDigest(f.state)}})).claimedAt).toBeNull();
  });
  it('rejects an expired challenge using database time before contacting the provider',async()=>{
    const state=randomBytes(32).toString('base64url'),proof=randomBytes(32).toString('base64url');
    await db.googleOAuthChallenge.create({data:{id:randomUUID(),stateHash:oauthDigest(state),proofHash:oauthDigest(proof),nonceHash:oauthDigest('expired'),purpose:'LOGIN',sessionHash:oauthDigest(''),createdAt:new Date(Date.now()-1200000),expiresAt:new Date(Date.now()-600000)}});
    const before=exchange.mock.calls.length;
    expect((await callback({state,cookie:'bcklGoogleProof='+proof},profile())).headers.location).toBe(origin+'/login?google=failed');
    expect(exchange.mock.calls.length).toBe(before);
  });
  it('real HTTP guard enforces Origin/query/body boundaries, independent of the business-suite override',async()=>{
    const real=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(GoogleOAuthProvider).useValue({exchange,authorization}).compile()).createNestApplication();
    configureApp(real);await real.init();const call=()=>request(real.getHttpServer());
    try{
      await call().post('/auth/google/start').set('Origin','https://evil.invalid').send({confirmed:true}).expect(400);
      await call().post('/auth/google/start').send({confirmed:true}).expect(400);
      await call().post('/auth/google/start?extra=1').set('Origin',origin).send({confirmed:true}).expect(400);
      await call().get('/auth/google/callback').send({extra:'body'}).expect(400);
      await call().post('/auth/google/start').set('Origin',origin).send({confirmed:true}).expect(200).expect('Cache-Control','no-store').expect('Referrer-Policy','no-referrer');
    }finally{await real.close();}
  });
  it('rejects rewriting identity ownership or reopening a consumed challenge', async () => {
    const p = profile(),
      f = await start();
    await callback(f, p);
    const i = await db.googleIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'GOOGLE', subject: p.subject } },
    });
    const other = await actor();
    await expect(
      db.googleIdentity.update({
        where: { id: i.id },
        data: { userId: other.user.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.googleOAuthChallenge.update({
        where: { stateHash: oauthDigest(f.state) },
        data: { claimedAt: null },
      }),
    ).rejects.toThrow();
  });
});
