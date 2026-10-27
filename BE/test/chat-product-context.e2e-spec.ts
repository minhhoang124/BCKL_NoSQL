import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { ChatService } from '../src/chat/chat.service.js';

describe('Product context: real HTTP/PostgreSQL, no snapshot of private Product', () => {
  let app: INestApplication, db: PrismaService, chat: ChatService;
  let buyer: { id: number; token: string },
    seller: { id: number; token: string },
    stranger: { id: number; token: string };
  let storeId: number,
    conversationId: number,
    productId: number,
    otherProductId: number;
  const marker = randomUUID(),
    old = process.env.CHAT_PRODUCT_CONTEXT_ENABLED,
    oldChat = process.env.CHAT_TEXT_ENABLED;
  const body = (key: string, id = productId) => ({
    type: 'PRODUCT_CONTEXT',
    clientMessageId: key,
    contextProductId: id,
  });
  const http = () => request(app.getHttpServer());
  const endpoint = () => `/chat/conversations/${conversationId}/messages`;
  const post = (key: string, id = productId, token = buyer.token) =>
    http().post(endpoint()).set('Authorization', token).send(body(key, id));
  async function actor(role: Role) {
    const row = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role,
      },
    });
    const config = app.get(ConfigService);
    return {
      id: row.id,
      token:
        'Bearer ' +
        app.get(JwtService).sign(
          { sub: row.id, email: row.email, role, type: 'access', cv: 1 },
          {
            secret: config.getOrThrow('JWT_ACCESS_SECRET'),
            issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
            audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
            expiresIn: '10m',
          },
        ),
    };
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (
      process.env.GITHUB_ACTIONS !== 'true' &&
      (url.hostname !== '127.0.0.1' ||
        url.port !== '5549' ||
        ![
          '/bckl_order_resolution_test_attributes_20261019_v944',
          '/bckl_order_resolution_test_attributes_20261019_v945',
          '/bckl_order_resolution_test_attributes_20261019_v947',
          '/bckl_order_resolution_test_attributes_20261019_v948',
          '/bckl_order_resolution_test_attributes_20261019_v949',
          '/bckl_order_resolution_test_attributes_20261019_v950',
          '/bckl_order_resolution_test_attributes_20261019_v951',
          '/bckl_order_resolution_test_attributes_20261019_v953', '/bckl_order_resolution_test_attributes_20261019_v955', '/bckl_order_resolution_test_attributes_20261019_v957', '/bckl_order_resolution_test_attributes_20261019_v959', '/bckl_order_resolution_test_attributes_20261019_v961',
        ].includes(url.pathname))
    )
      throw Error('Exact Product context QA required');
    process.env.CHAT_TEXT_ENABLED = 'true';
    process.env.CHAT_PRODUCT_CONTEXT_ENABLED = 'true';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    chat = app.get(ChatService);
    buyer = await actor(Role.USER);
    seller = await actor(Role.SELLER);
    stranger = await actor(Role.USER);
    storeId = (
      await db.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    const category = await db.category.create({
      data: { name: marker, slug: marker, isActive: true },
    });
    const product = await db.product.create({
      data: {
        storeId,
        categoryId: category.id,
        name: 'Public product only',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: { url: '/uploads/products/qa-image.png', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: marker,
            optionSignature: 'default',
            price: '10000',
            stock: 2,
          },
        },
      },
    });
    productId = product.id;
    const foreignSeller = await actor(Role.SELLER);
    const store = await db.store.create({
      data: {
        sellerId: foreignSeller.id,
        name: 'Other store',
        status: 'ACTIVE',
      },
    });
    otherProductId = (
      await db.product.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name: 'PRIVATE WRONG STORE',
        },
      })
    ).id;
    conversationId = (await chat.open(buyer.id, storeId)).id;
  });
  afterAll(async () => {
    if (old === undefined) delete process.env.CHAT_PRODUCT_CONTEXT_ENABLED;
    else process.env.CHAT_PRODUCT_CONTEXT_ENABLED = old;
    if (oldChat === undefined) delete process.env.CHAT_TEXT_ENABLED;
    else process.env.CHAT_TEXT_ENABLED = oldChat;
    await app?.close(); // Preserve immutable scoped QA history.
  });
  it('persists a typed reference, not a name/image/price snapshot', async () => {
    const result = await post(marker + '-first').expect(201);
    expect(result.body.message.productContext).toEqual({ productId, storeId });
    expect(result.body.message.content).toBe('Đã chia sẻ sản phẩm');
    expect(JSON.stringify(result.body)).not.toContain('Public product only');
    const stored = await db.chatMessage.findUniqueOrThrow({
      where: { id: result.body.message.id },
    });
    expect(stored.contextProductId).toBe(productId);
    expect(stored.content).not.toContain('10000');
  });
  it('concurrent same-key sends create exactly one sequence and unread message', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const key = marker + '-concurrent';
    const receipts = await Promise.all([
      chat.send(buyer.id, conversationId, body(key)),
      chat.send(buyer.id, conversationId, body(key)),
    ]);
    expect(receipts[0].message.id).toBe(receipts[1].message.id);
    expect(
      await db.chatMessage.count({
        where: { conversationId, clientMessageId: key },
      }),
    ).toBe(1);
    expect(
      (
        await db.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
        })
      ).lastSequence,
    ).toBe(before.lastSequence + 1);
  });
  it('blocks outsiders, foreign Store products and nonexistent products without append', async () => {
    const count = await db.chatMessage.count({ where: { conversationId } });
    await post(marker + '-outsider', productId, stranger.token).expect(404);
    await post(marker + '-foreign', otherProductId).expect(404);
    await post(marker + '-absent', 2147483647).expect(404);
    expect(await db.chatMessage.count({ where: { conversationId } })).toBe(
      count,
    );
  });
  it('does not permit changing payload/type on an already committed key', async () => {
    await post(marker + '-first', otherProductId).expect(409);
    await http()
      .post(endpoint())
      .set('Authorization', buyer.token)
      .send({
        type: 'TEXT',
        content: 'Đã chia sẻ sản phẩm',
        clientMessageId: marker + '-first',
      })
      .expect(409);
  });
  it('hidden Product keeps reference history and safe replay, public detail redacts it', async () => {
    await db.product.update({
      where: { id: productId },
      data: { sellerStatus: 'HIDDEN', name: 'PRIVATE DRAFT CONTENT' },
    });
    await post(marker + '-hidden').expect(404);
    const replay = await post(marker + '-first').expect(201);
    expect(replay.body.replay).toBe(true);
    await http().get(`/products/${productId}`).expect(404);
    const history = await http()
      .get(endpoint())
      .set('Authorization', buyer.token)
      .expect(200);
    expect(
      history.body.items.some(
        (m: { productContext?: unknown }) => !!m.productContext,
      ),
    ).toBe(true);
    expect(JSON.stringify(history.body)).not.toContain('PRIVATE DRAFT CONTENT');
    const inbox = await http()
      .get('/chat/conversations')
      .set('Authorization', buyer.token)
      .expect(200);
    expect(JSON.stringify(inbox.body)).not.toContain('PRIVATE DRAFT CONTENT');
  });
  it('hard-deleted Product does not delete history or break replay', async () => {
    await db.product.delete({ where: { id: productId } });
    const replay = await post(marker + '-first').expect(201);
    expect(replay.body.message.productContext).toEqual({ productId, storeId });
    expect(replay.body.replay).toBe(true);
    await http().get(`/products/${productId}`).expect(404);
  });
  it('a stored receipt cannot restore send rights after Store owner is locked', async () => {
    await db.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    try {
      await post(marker + '-first').expect(409);
    } finally {
      await db.user.update({
        where: { id: seller.id },
        data: { isActive: true },
      });
    }
  });
  it('kill-switch blocks new shares but allows replay of a committed receipt', async () => {
    process.env.CHAT_PRODUCT_CONTEXT_ENABLED = 'false';
    try {
      const replay = await post(marker + '-first').expect(201);
      expect(replay.body.replay).toBe(true);
      await post(marker + '-disabled-new').expect(400);
    } finally {
      process.env.CHAT_PRODUCT_CONTEXT_ENABLED = 'true';
    }
  });
  it('failed insert rolls back the parent counter and cannot mutate a persisted reference', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    await expect(
      db.chatMessage.create({
        data: {
          conversationId,
          sequence: before.lastSequence + 1,
          senderId: buyer.id,
          senderType: 'BUYER',
          clientMessageId: randomUUID(),
          payloadHash: 'a'.repeat(64),
          content: 'WRONG SNAPSHOT',
          contextProductId: productId,
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
        })
      ).lastSequence,
    ).toBe(before.lastSequence);
    const message = await db.chatMessage.findFirstOrThrow({
      where: { conversationId },
    });
    await expect(
      db.chatMessage.update({
        where: { id: message.id },
        data: { contextProductId: otherProductId },
      }),
    ).rejects.toThrow();
  });
});
