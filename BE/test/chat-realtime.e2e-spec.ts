import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { ChatService } from '../src/chat/chat.service.js';

type Ack = {
  ok: boolean;
  data?: {
    message?: { id: number; sequence: number };
    replay?: boolean;
    lastReadSequence?: number;
  };
  error?: { status: number; code: string };
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function event(socket: Socket, name: string, timeout = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(Error('Missing socket event: ' + name));
    }, timeout);
    const listener = (data: unknown) => {
      clearTimeout(timer);
      socket.off(name, listener);
      resolve(data);
    };
    socket.once(name, listener);
  });
}
describe('Chat realtime: actual sockets + HTTP + PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, chat: ChatService, url: string;
  const sockets: Socket[] = [];
  const oldFlag = process.env.CHAT_TEXT_ENABLED;
  async function actor(role: Role, expiresIn = 600) {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role,
      },
    });
    const config = app.get(ConfigService);
    const token = app.get(JwtService).sign(
      { sub: user.id, type: 'access', cv: 1, role, email: user.email },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn,
      },
    );
    return { id: user.id, token };
  }
  async function fixture() {
    const buyer = await actor(Role.USER),
      seller = await actor(Role.SELLER);
    const store = await db.store.create({
      data: { sellerId: seller.id, name: 'Realtime QA', status: 'ACTIVE' },
    });
    const conversation = await chat.open(buyer.id, store.id);
    return { buyer, seller, conversationId: conversation.id };
  }
  async function connect(token: string) {
    const socket = io(`${url}/chat`, {
      transports: ['websocket'],
      auth: { token },
      autoConnect: false,
      reconnection: false,
    });
    sockets.push(socket);
    const ready = event(socket, 'chat:ready');
    socket.connect();
    await ready;
    return socket;
  }
  const ack = (socket: Socket, name: string, body: unknown): Promise<Ack> =>
    socket.timeout(5000).emitWithAck(name, body);
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (
      process.env.GITHUB_ACTIONS !== 'true' &&
      (target.hostname !== '127.0.0.1' ||
        target.port !== '5549' ||
        ![
          '/bckl_order_resolution_test_chat_text_20261023_v941',
          '/bckl_order_resolution_test_attributes_20261019_v943',
          '/bckl_order_resolution_test_attributes_20261019_v944',
          '/bckl_order_resolution_test_attributes_20261019_v947',
          '/bckl_order_resolution_test_attributes_20261019_v945',
          '/bckl_order_resolution_test_attributes_20261019_v948',
          '/bckl_order_resolution_test_attributes_20261019_v949',
          '/bckl_order_resolution_test_attributes_20261019_v950',
        ].includes(target.pathname))
    )
      throw Error('Realtime requires exact isolated QA target');
    process.env.CHAT_TEXT_ENABLED = 'true';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    chat = app.get(ChatService);
    url = await app.getUrl();
  });
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });
  afterAll(async () => {
    if (oldFlag === undefined) delete process.env.CHAT_TEXT_ENABLED;
    else process.env.CHAT_TEXT_ENABLED = oldFlag;
    await app?.close();
  });
  it('persists before broadcast; same-key HTTP/socket replay never re-emits or duplicates', async () => {
    const { buyer, seller, conversationId } = await fixture();
    const a = await connect(buyer.token),
      b = await connect(seller.token);
    expect((await ack(a, 'conversation:join', { conversationId })).ok).toBe(
      true,
    );
    expect((await ack(b, 'conversation:join', { conversationId })).ok).toBe(
      true,
    );
    let delivered = 0;
    b.on('message:created', () => delivered++);
    const received = event(b, 'message:created');
    const message = {
      clientMessageId: randomUUID(),
      type: 'TEXT',
      content: 'Persisted before push',
    };
    const result = await ack(a, 'message:send', { conversationId, message });
    expect(result.ok).toBe(true);
    const pushed = (await received) as { id: number; content: string };
    expect(
      await db.chatMessage.findUnique({ where: { id: pushed.id } }),
    ).toMatchObject({ content: message.content });
    const retry = await request(app.getHttpServer())
      .post(`/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send(message)
      .expect(201);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.message.id).toBe(pushed.id);
    await wait(100);
    expect(delivered).toBe(1);
    expect(await db.chatMessage.count({ where: { conversationId } })).toBe(1);
    const read = await ack(b, 'conversation:read', {
      conversationId,
      lastReadMessageId: pushed.id,
    });
    expect(read.data?.lastReadSequence).toBe(1);
  });
  it('HTTP new message also broadcasts to an authenticated joined recipient', async () => {
    const { buyer, seller, conversationId } = await fixture();
    const b = await connect(seller.token);
    await ack(b, 'conversation:join', { conversationId });
    const received = event(b, 'message:created');
    await request(app.getHttpServer())
      .post(`/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        clientMessageId: randomUUID(),
        type: 'TEXT',
        content: 'REST delivery',
      })
      .expect(201);
    expect(await received).toMatchObject({
      conversationId,
      content: 'REST delivery',
    });
  });
  it('denies foreign join/send/read and validates unknown fields without writing', async () => {
    const { conversationId } = await fixture(),
      outsider = await actor(Role.USER);
    const socket = await connect(outsider.token);
    for (const [name, body] of [
      ['conversation:join', { conversationId }],
      [
        'message:send',
        {
          conversationId,
          message: { clientMessageId: 'foreign', type: 'TEXT', content: 'No' },
        },
      ],
      ['conversation:read', { conversationId, lastReadMessageId: 1 }],
    ] as const) {
      expect((await ack(socket, name, body)).error?.status).toBe(404);
    }
    expect(
      (
        await ack(socket, 'conversation:join', {
          conversationId,
          buyerId: outsider.id,
        })
      ).error?.status,
    ).toBe(400);
    expect(
      (
        await ack(socket, 'message:send', {
          conversationId,
          message: { clientMessageId: 'invalid', type: 'TEXT', content: ' ' },
        })
      ).error?.status,
    ).toBe(400);
    expect(await db.chatMessage.count({ where: { conversationId } })).toBe(0);
  });
  it('revokes a joined recipient before delivering private payload when account is locked', async () => {
    const { buyer, seller, conversationId } = await fixture();
    const b = await connect(seller.token);
    await ack(b, 'conversation:join', { conversationId });
    let leaked = 0;
    b.on('message:created', () => leaked++);
    const disconnected = event(b, 'disconnect');
    await db.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    // Buyer cannot SEND when Store owner is locked, so explicitly publish a persisted earlier event.
    const message = await db.chatMessage.create({
      data: {
        conversationId,
        sequence: 1,
        senderId: buyer.id,
        senderType: 'BUYER',
        clientMessageId: randomUUID(),
        content: 'QA prior committed event',
        payloadHash: 'a'.repeat(64),
      },
    });
    app
      .get((await import('../src/chat/chat-events.js')).ChatEvents)
      .publish({ conversationId, message });
    await disconnected;
    expect(leaked).toBe(0);
  });
  it('token expiry disconnects an authenticated socket without further user action', async () => {
    const short = await actor(Role.USER, 2);
    const socket = await connect(short.token);
    await event(socket, 'disconnect', 4000);
    expect(socket.connected).toBe(false);
  });
  it('revokes credential-version and Store-role recipients before push', async () => {
    for (const mode of ['credential', 'role']) {
      const { buyer, seller, conversationId } = await fixture();
      const socket = await connect(seller.token);
      await ack(socket, 'conversation:join', { conversationId });
      let leaked = 0;
      socket.on('message:created', () => leaked++);
      const disconnected = event(socket, 'disconnect');
      await db.user.update({
        where: { id: seller.id },
        data:
          mode === 'credential'
            ? { credentialVersion: 2 }
            : { role: Role.USER },
      });
      await chat.send(buyer.id, conversationId, {
        clientMessageId: randomUUID(),
        type: 'TEXT',
        content: 'Do not deliver after revoke',
      });
      await disconnected;
      expect(leaked).toBe(0);
    }
  });
  it('rejects an untrusted Origin and token in URL query', async () => {
    const buyer = await actor(Role.USER);
    const foreign = io(`${url}/chat`, {
      transports: ['websocket'],
      auth: { token: buyer.token },
      extraHeaders: { Origin: 'https://untrusted.invalid' },
      autoConnect: false,
      reconnection: false,
    });
    sockets.push(foreign);
    const denied = event(foreign, 'connect_error');
    foreign.connect();
    await denied;
    expect(foreign.connected).toBe(false);
    const query = io(`${url}/chat`, {
      transports: ['websocket'],
      auth: { token: buyer.token },
      query: { token: buyer.token },
      autoConnect: false,
      reconnection: false,
    });
    sockets.push(query);
    const disconnected = event(query, 'disconnect');
    query.connect();
    await disconnected;
    expect(query.connected).toBe(false);
  });
  it('Admin and invalid token never receive authenticated ready or join access', async () => {
    for (const token of [(await actor(Role.ADMIN)).token, 'invalid']) {
      const socket = io(`${url}/chat`, {
        transports: ['websocket'],
        auth: { token },
        autoConnect: false,
        reconnection: false,
      });
      sockets.push(socket);
      let ready = false;
      socket.on('chat:ready', () => {
        ready = true;
      });
      const disconnected = event(socket, 'disconnect');
      socket.connect();
      await disconnected;
      expect(ready).toBe(false);
    }
  });
  it('reconnect catch-up recovers a message missed offline with its original sequence', async () => {
    const { buyer, seller, conversationId } = await fixture();
    const before = await connect(buyer.token);
    await ack(before, 'conversation:join', { conversationId });
    before.disconnect();
    const saved = await chat.send(seller.id, conversationId, {
      clientMessageId: randomUUID(),
      type: 'TEXT',
      content: 'Offline delivery',
    });
    const after = await connect(buyer.token);
    await ack(after, 'conversation:join', { conversationId });
    const response = await request(app.getHttpServer())
      .get(`/chat/conversations/${conversationId}/messages?afterSequence=0`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .expect(200);
    expect(response.body.items.map((m: { id: number }) => m.id)).toEqual([
      saved.message.id,
    ]);
    expect(response.body.items[0].sequence).toBe(1);
  });
  it('shares REST/socket send quota rather than permitting transport bypass', async () => {
    const { buyer, conversationId } = await fixture();
    const socket = await connect(buyer.token);
    for (let n = 0; n < 20; n++)
      expect(
        (
          await ack(socket, 'message:send', {
            conversationId,
            message: {
              clientMessageId: `quota-${n}`,
              type: 'TEXT',
              content: ' ',
            },
          })
        ).error?.status,
      ).toBe(400);
    await request(app.getHttpServer())
      .post(`/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ clientMessageId: 'quota-final', type: 'TEXT', content: 'No' })
      .expect(429);
    expect(await db.chatMessage.count({ where: { conversationId } })).toBe(0);
  });
  it('recipient authorization expires while waiting for a real DB lock without enqueuing payload', async () => {
    const { buyer, conversationId } = await fixture();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>((done) => {
        release = done;
      }),
      acquired = new Promise<void>((done) => {
        locked = done;
      });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${buyer.id} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 5000 },
    );
    await acquired;
    let enqueued = 0;
    const delivery = chat.authorizeDelivery(
      buyer.id,
      conversationId,
      1,
      Date.now() + 100,
      () => {
        enqueued++;
      },
    );
    // Attach the rejection assertion before releasing the holder, avoiding an unhandled rejection.
    const denied = expect(delivery).rejects.toMatchObject({ status: 401 });
    await wait(160);
    release();
    await holder;
    await denied;
    expect(enqueued).toBe(0);
  });
});
