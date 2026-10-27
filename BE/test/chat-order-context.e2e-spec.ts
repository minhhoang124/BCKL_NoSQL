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
import { ChatEvents } from '../src/chat/chat-events.js';

describe('Order sharing: canonical Buyer–Store, real HTTP Checkout/PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, chat: ChatService;
  type Actor = { id: number; token: string };
  let buyer: Actor,
    seller: Actor,
    other: Actor,
    admin: Actor,
    foreignSeller: Actor;
  let storeId: number,
    foreignStore: number,
    conversationId: number,
    otherConversation: number;
  let orderId: number,
    otherOrder: number,
    wrongStoreOrder: number,
    productId: number,
    variantId: number;
  let receiptId: number;
  const marker = randomUUID(),
    old = {
      chat: process.env.CHAT_TEXT_ENABLED,
      order: process.env.CHAT_ORDER_CONTEXT_ENABLED,
    };
  const http = () => request(app.getHttpServer());
  const endpoint = () => `/chat/conversations/${conversationId}/messages`;
  const body = (key: string, id = orderId) => ({
    type: 'ORDER_CONTEXT',
    clientMessageId: key,
    contextOrderId: id,
  });
  const post = (key: string, id = orderId, token?: string) =>
    http()
      .post(endpoint())
      .set('Authorization', token ?? buyer.token)
      .send(body(key, id));
  const card = (token?: string, messageId = receiptId, conv = conversationId) =>
    http()
      .get(`/chat/conversations/${conv}/messages/${messageId}/order-context`)
      .set('Authorization', token ?? buyer.token);
  async function actor(role: Role): Promise<Actor> {
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
  async function legacyOrder(owner: Actor, store: number) {
    const checkout = await db.checkout.create({
      data: {
        buyerId: owner.id,
        idempotencyKey: randomUUID(),
        requestHash: 'fixture-legacy',
      },
    });
    return (
      await db.order.create({
        data: {
          checkoutId: checkout.id,
          buyerId: owner.id,
          storeId: store,
          orderNumber: randomUUID(),
          recipientNameSnapshot: 'PRIVATE RECIPIENT',
          phoneSnapshot: '0901234567',
          provinceSnapshot: 'P',
          wardSnapshot: 'W',
          addressLineSnapshot: 'PRIVATE ADDRESS',
          subtotal: '10000',
          shippingFee: '0',
          total: '10000',
        },
      })
    ).id;
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (
      process.env.GITHUB_ACTIONS !== 'true' &&
      (url.hostname !== '127.0.0.1' ||
        url.port !== '5549' ||
        ![
          '/bckl_order_resolution_test_attributes_20261019_v945',
          '/bckl_order_resolution_test_attributes_20261019_v948',
          '/bckl_order_resolution_test_attributes_20261019_v949',
          '/bckl_order_resolution_test_attributes_20261019_v950',
          '/bckl_order_resolution_test_attributes_20261019_v951',
          '/bckl_order_resolution_test_attributes_20261019_v953', '/bckl_order_resolution_test_attributes_20261019_v955', '/bckl_order_resolution_test_attributes_20261019_v957', '/bckl_order_resolution_test_attributes_20261019_v959', '/bckl_order_resolution_test_attributes_20261019_v961',
        ].includes(url.pathname))
    )
      throw Error('Exact Order context QA required');
    process.env.CHAT_TEXT_ENABLED = 'true';
    process.env.CHAT_ORDER_CONTEXT_ENABLED = 'true';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    chat = app.get(ChatService);
    buyer = await actor(Role.USER);
    seller = await actor(Role.SELLER);
    other = await actor(Role.USER);
    admin = await actor(Role.ADMIN);
    foreignSeller = await actor(Role.SELLER);
    storeId = (
      await db.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    foreignStore = (
      await db.store.create({
        data: {
          sellerId: foreignSeller.id,
          name: marker + '-other',
          status: 'ACTIVE',
        },
      })
    ).id;
    const category = await db.category.create({
      data: { name: marker, slug: marker },
    });
    const product = await db.product.create({
      data: {
        storeId,
        categoryId: category.id,
        name: 'Purchased snapshot',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: {
            url: '/uploads/products/chat-order-qa.png',
            isPrimary: true,
          },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: marker,
            optionSignature: 'default',
            price: '10000',
            stock: 10,
          },
        },
      },
      include: { variants: true },
    });
    productId = product.id;
    variantId = product.variants[0].id;
    const address = await db.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'PRIVATE RECIPIENT',
        phone: '0901234567',
        province: 'P',
        ward: 'W',
        addressLine: 'PRIVATE ADDRESS',
      },
    });
    const cartRow = await db.cart.create({ data: { userId: buyer.id } });
    await db.cartItem.create({
      data: { cartId: cartRow.id, variantId, quantity: 2 },
    });
    const checkout = await http()
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', marker)
      .send({
        addressId: address.id,
        paymentProvider: 'COD',
        items: [{ variantId, quantity: 2, expectedUnitPrice: '10000' }],
      })
      .expect(201);
    orderId = checkout.body.orders[0].id;
    otherOrder = await legacyOrder(other, storeId);
    wrongStoreOrder = await legacyOrder(buyer, foreignStore);
    conversationId = (await chat.open(buyer.id, storeId)).id;
    otherConversation = (await chat.open(other.id, storeId)).id;
  });
  afterAll(async () => {
    for (const [key, value] of [
      ['CHAT_TEXT_ENABLED', old.chat],
      ['CHAT_ORDER_CONTEXT_ENABLED', old.order],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await app?.close();
  });
  it('opens the same pair for Buyer and Seller, but never auto-sends', async () => {
    const count = await db.chatMessage.count({ where: { conversationId } });
    for (const [token, viewer] of [
      [buyer.token, 'BUYER'],
      [seller.token, 'SELLER'],
    ]) {
      const result = await http()
        .post('/chat/conversations/order')
        .set('Authorization', token)
        .send({ orderId })
        .expect(201);
      expect(result.body).toMatchObject({
        id: conversationId,
        buyerId: buyer.id,
        storeId,
        orderId,
        viewer,
      });
    }
    expect(await db.chatMessage.count({ where: { conversationId } })).toBe(
      count,
    );
  });
  it('foreign and nonexistent Order openings have identical 404, Admin forbidden', async () => {
    const a = await http()
      .post('/chat/conversations/order')
      .set('Authorization', other.token)
      .send({ orderId })
      .expect(404);
    const b = await http()
      .post('/chat/conversations/order')
      .set('Authorization', other.token)
      .send({ orderId: 2147483647 })
      .expect(404);
    expect(a.body).toEqual(b.body);
    await http()
      .post('/chat/conversations/order')
      .set('Authorization', admin.token)
      .send({ orderId })
      .expect(403);
  });
  it('persists only a typed reference and publishes once after concurrent same-key sends', async () => {
    const events: unknown[] = [],
      unsubscribe = app.get(ChatEvents).subscribe((event) => {
        if (event.conversationId === conversationId) events.push(event);
      });
    try {
      const result = await Promise.all([
        chat.send(buyer.id, conversationId, body(marker)),
        chat.send(buyer.id, conversationId, body(marker)),
      ]);
      receiptId = result[0].message.id;
      expect(result[1].message.id).toBe(receiptId);
      expect(events).toHaveLength(1);
      expect(result[0].message).toMatchObject({
        content: 'Đã chia sẻ đơn hàng',
        orderContext: { orderId, storeId },
      });
      const stored = await db.chatMessage.findUniqueOrThrow({
        where: { id: receiptId },
      });
      expect(stored.contextOrderId).toBe(orderId);
      expect(stored.contextProductId).toBeNull();
    } finally {
      unsubscribe();
    }
  });
  it('Seller cannot share another buyer Order, either participant cannot share a foreign Store Order', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    await post(marker + '-foreign-buyer', otherOrder, seller.token).expect(404);
    await post(marker + '-foreign-store', wrongStoreOrder).expect(404);
    await post(marker + '-stranger', orderId, other.token).expect(404);
    await post(marker + '-foreign-seller', orderId, foreignSeller.token).expect(
      404,
    );
    expect(
      await db.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
      }),
    ).toEqual(before);
  });
  it('key cannot be reused with different Order or TEXT, malformed bodies rejected', async () => {
    await post(marker, otherOrder).expect(409);
    await http()
      .post(endpoint())
      .set('Authorization', buyer.token)
      .send({
        type: 'TEXT',
        clientMessageId: marker,
        content: 'Đã chia sẻ đơn hàng',
      })
      .expect(409);
    for (const extra of [
      { contextProductId: productId },
      { senderId: seller.id },
      { content: 'PRIVATE' },
      { contextOrderId: 0 },
    ]) {
      await http()
        .post(endpoint())
        .set('Authorization', buyer.token)
        .send({ ...body(randomUUID()), ...extra })
        .expect(400);
    }
  });
  it('minimal card uses purchase snapshot, never Product draft/address/payment; GET does not mutate business or read state', async () => {
    await db.product.update({
      where: { id: productId },
      data: {
        name: 'PRIVATE NEW DRAFT',
        sellerStatus: 'DRAFT',
        moderationStatus: 'NOT_SUBMITTED',
      },
    });
    const before = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: true,
        payment: true,
        statusHistory: true,
        commands: true,
      },
    });
    const stock = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    const outbox = await db.searchOutbox.count({ where: { productId } });
    for (const [token, viewer] of [
      [buyer.token, 'BUYER'],
      [seller.token, 'SELLER'],
    ]) {
      const result = await card(token).expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(Object.keys(result.body).sort()).toEqual(
        [
          'orderId',
          'storeId',
          'orderNumber',
          'status',
          'total',
          'currency',
          'createdAt',
          'viewer',
          'lineCount',
          'items',
        ].sort(),
      );
      expect(result.body).toMatchObject({
        orderId,
        storeId,
        total: '20000.00',
        viewer,
        items: [{ name: 'Purchased snapshot', quantity: 2 }],
      });
      expect(JSON.stringify(result.body)).not.toMatch(
        /PRIVATE|0901234567|requestHash|payment|recipient|address/i,
      );
    }
    expect(
      await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: true,
          payment: true,
          statusHistory: true,
          commands: true,
        },
      }),
    ).toEqual(before);
    expect(
      await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }),
    ).toEqual(stock);
    expect(await db.searchOutbox.count({ where: { productId } })).toBe(outbox);
    expect(await db.chatReadState.count({ where: { conversationId } })).toBe(0);
  });
  it('card cannot be fetched by outsider, Admin, foreign message pairing or before an Order was shared', async () => {
    await card(other.token).expect(404);
    await card(admin.token).expect(403);
    await card(seller.token, receiptId, otherConversation).expect(404);
    const text = await chat.send(buyer.id, conversationId, {
      type: 'TEXT',
      clientMessageId: randomUUID(),
      content: 'Ordinary text',
    });
    await card(buyer.token, text.message.id).expect(404);
    await http()
      .get(
        `/chat/conversations/${conversationId}/messages/${receiptId}/order-context?buyerId=${buyer.id}`,
      )
      .set('Authorization', buyer.token)
      .expect(400);
  });
  it('kill switch stops new append, not committed replay or authorized historical card', async () => {
    process.env.CHAT_ORDER_CONTEXT_ENABLED = 'false';
    try {
      expect((await post(marker).expect(201)).body.replay).toBe(true);
      await post(marker + '-off').expect(400);
      await card().expect(200);
    } finally {
      process.env.CHAT_ORDER_CONTEXT_ENABLED = 'true';
    }
  });
  it('locked owner blocks append/replay, but active Buyer still reads their minimal history', async () => {
    await db.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    try {
      await post(marker).expect(409);
      await card().expect(200);
      await card(seller.token).expect(401);
    } finally {
      await db.user.update({
        where: { id: seller.id },
        data: { isActive: true },
      });
    }
  });
  it('SUSPENDED supports old purchase opening/sharing; later Order cannot use an unrelated old purchase as proof', async () => {
    const suspensionTime = new Date();
    await db.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    await db.storeStatusHistory.create({
      data: {
        storeId,
        actorId: admin.id,
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        createdAt: suspensionTime,
      },
    });
    try {
      await http()
        .post('/chat/conversations/order')
        .set('Authorization', buyer.token)
        .send({ orderId })
        .expect(201);
      await post(marker + '-old').expect(201);
      const newer = await legacyOrder(buyer, storeId);
      await post(marker + '-new', newer).expect(409);
      await http()
        .post('/chat/conversations/order')
        .set('Authorization', buyer.token)
        .send({ orderId: newer })
        .expect(201); // Existing conversation remains readable; sharing above is denied.
    } finally {
      await db.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
    }
  });
  it('CLOSED keeps existing conversation/card readable but cannot append or open a new pair', async () => {
    await db.store.update({
      where: { id: storeId },
      data: { status: 'CLOSED' },
    });
    try {
      await http()
        .post('/chat/conversations/order')
        .set('Authorization', buyer.token)
        .send({ orderId })
        .expect(201);
      await card().expect(200);
      await post(randomUUID()).expect(409);
      const freshBuyer = await actor(Role.USER),
        freshOrder = await legacyOrder(freshBuyer, storeId);
      await http()
        .post('/chat/conversations/order')
        .set('Authorization', freshBuyer.token)
        .send({ orderId: freshOrder })
        .expect(409);
      expect(
        await db.chatConversation.count({
          where: { buyerId: freshBuyer.id, storeId },
        }),
      ).toBe(0);
    } finally {
      await db.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
    }
  });
  it('fresh actor state rejects locked Buyer and demoted Seller despite old JWT', async () => {
    await db.user.update({
      where: { id: buyer.id },
      data: { isActive: false },
    });
    try {
      await card().expect(401);
      await post(randomUUID()).expect(401);
    } finally {
      await db.user.update({
        where: { id: buyer.id },
        data: { isActive: true },
      });
    }
    await db.user.update({ where: { id: seller.id }, data: { role: 'USER' } });
    try {
      await card(seller.token).expect(404);
      await post(randomUUID(), orderId, seller.token).expect(404);
    } finally {
      await db.user.update({
        where: { id: seller.id },
        data: { role: 'SELLER' },
      });
    }
  });
  it('DB rejects both contexts/wrong placeholder and rolls parent counter back; persisted reference immutable', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    for (const extra of [
      { contextProductId: productId },
      { content: 'WRONG SNAPSHOT' },
      { contextOrderId: 0 },
    ]) {
      await expect(
        db.chatMessage.create({
          data: {
            conversationId,
            sequence: before.lastSequence + 1,
            senderId: buyer.id,
            senderType: 'BUYER',
            clientMessageId: randomUUID(),
            payloadHash: 'a'.repeat(64),
            content: 'Đã chia sẻ đơn hàng',
            contextOrderId: orderId,
            ...extra,
          },
        }),
      ).rejects.toThrow();
    }
    expect(
      await db.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
      }),
    ).toEqual(before);
    await expect(
      db.chatMessage.update({
        where: { id: receiptId },
        data: { contextOrderId: otherOrder },
      }),
    ).rejects.toThrow();
  });
});
