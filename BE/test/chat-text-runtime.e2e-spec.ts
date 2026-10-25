import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { ChatService } from '../src/chat/chat.service.js';
import { inboxCursor } from '../src/chat/chat-inbox-page.js';

describe('Chat TEXT runtime: actual HTTP and PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, chat: ChatService;
  let buyer: { id: number; token: string },
    seller: { id: number; token: string },
    outsider: { id: number; token: string },
    admin: { id: number; token: string };
  let storeId: number, conversationId: number;
  const marker = randomUUID();
  const oldFlag = process.env.CHAT_TEXT_ENABLED;
  const http = () => request(app.getHttpServer());
  const base = () => `/chat/conversations/${conversationId}`;
  const auth = (token: string) => ({ Authorization: token });
  const send = (token: string, key: string, content: string) =>
    http()
      .post(base() + '/messages')
      .set(auth(token))
      .send({ type: 'TEXT', clientMessageId: key, content });
  async function actor(role: Role) {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role,
      },
    });
    const config = app.get(ConfigService);
    const token = app.get(JwtService).sign(
      { sub: user.id, email: user.email, role, type: 'access', cv: 1 },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { id: user.id, token: `Bearer ${token}` };
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (
      process.env.GITHUB_ACTIONS !== 'true' &&
      (url.hostname !== '127.0.0.1' ||
        url.port !== '5549' ||
        ![
          '/bckl_order_resolution_test_chat_text_20261023_v941',
          '/bckl_order_resolution_test_attributes_20261019_v943',
          '/bckl_order_resolution_test_attributes_20261019_v944',
          '/bckl_order_resolution_test_attributes_20261019_v945',
        ].includes(url.pathname))
    )
      throw Error('Chat requires exact isolated QA target');
    process.env.CHAT_TEXT_ENABLED = 'true';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    chat = app.get(ChatService);
    buyer = await actor(Role.USER);
    seller = await actor(Role.SELLER);
    outsider = await actor(Role.USER);
    admin = await actor(Role.ADMIN);
    storeId = (
      await db.store.create({
        data: {
          sellerId: seller.id,
          status: 'ACTIVE',
          name: `Chat QA ${marker}`,
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (oldFlag === undefined) delete process.env.CHAT_TEXT_ENABLED;
    else process.env.CHAT_TEXT_ENABLED = oldFlag;
    // Immutable history intentionally retained in exact isolated QA DB; no broad cleanup/delete.
    await app?.close();
  });

  it('opens concurrently as one pair without creating messages', async () => {
    const results = await Promise.all([
      chat.open(buyer.id, storeId),
      chat.open(buyer.id, storeId),
    ]);
    expect(results[0].id).toBe(results[1].id);
    conversationId = results[0].id;
    expect(await db.chatMessage.count({ where: { conversationId } })).toBe(0);
    await http()
      .post('/chat/conversations')
      .set(auth(buyer.token))
      .send({ storeId })
      .expect(201)
      .expect((r) => expect(r.body.id).toBe(conversationId));
  });
  it('protects guest, Admin and foreign membership with no-store', async () => {
    await http().get(base()).expect(401).expect('Cache-Control', 'no-store');
    await http().get(base()).set(auth(admin.token)).expect(403);
    await http().get(base()).set(auth(outsider.token)).expect(404);
    await http()
      .post('/chat/conversations')
      .set(auth(seller.token))
      .send({ storeId })
      .expect(403);
    await http()
      .post('/chat/conversations')
      .set(auth(buyer.token))
      .send({ storeId, senderId: buyer.id })
      .expect(400);
  });
  it('persists TEXT and returns only public message fields', async () => {
    const response = await send(
      buyer.token,
      `${marker}-text`,
      '  Xin chào <script>plain text</script>  ',
    ).expect(201);
    expect(response.body.replay).toBe(false);
    expect(response.body.message.sequence).toBe(1);
    expect(response.body.message.content).toBe(
      'Xin chào <script>plain text</script>',
    );
    expect(Object.keys(response.body.message).sort()).toEqual(
      [
        'id',
        'conversationId',
        'sequence',
        'senderId',
        'senderType',
        'content',
        'createdAt',
      ].sort(),
    );
    const replay = await send(
      buyer.token,
      `${marker}-text`,
      'Xin chào <script>plain text</script>',
    ).expect(201);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.message.id).toBe(response.body.message.id);
    await send(buyer.token, `${marker}-text`, 'different')
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('MESSAGE_IDEMPOTENCY_CONFLICT'));
    expect(
      (
        await db.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
        })
      ).lastSequence,
    ).toBe(1);
  });
  it('serializes competing senders and same-key duplicate delivery', async () => {
    const responses = await Promise.all([
      send(buyer.token, `${marker}-parallel`, 'A'),
      send(seller.token, `${marker}-parallel`, 'B'),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const duplicate = await Promise.all([
      send(buyer.token, `${marker}-duplicate`, 'same'),
      send(buyer.token, `${marker}-duplicate`, 'same'),
    ]);
    expect(duplicate.map((r) => r.status)).toEqual([201, 201]);
    expect(duplicate[0].body.message.id).toBe(duplicate[1].body.message.id);
    const rows = await db.chatMessage.findMany({
      where: { conversationId },
      orderBy: { sequence: 'asc' },
    });
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
  });
  it('paginates by commit sequence and advances read cursor monotonically', async () => {
    const first = await http()
      .get(base() + '/messages?limit=2')
      .set(auth(buyer.token))
      .expect(200);
    expect(
      first.body.items.map((m: { sequence: number }) => m.sequence),
    ).toEqual([3, 4]);
    const second = await http()
      .get(
        base() +
          `/messages?limit=2&beforeSequence=${first.body.nextBeforeSequence}`,
      )
      .set(auth(buyer.token))
      .expect(200);
    expect(
      second.body.items.map((m: { sequence: number }) => m.sequence),
    ).toEqual([1, 2]);
    const catchup = await http()
      .get(base() + '/messages?afterSequence=2&limit=2')
      .set(auth(buyer.token))
      .expect(200);
    expect(
      catchup.body.items.map((m: { sequence: number }) => m.sequence),
    ).toEqual([3, 4]);
    const latest = first.body.items[1];
    await http()
      .post(base() + '/read')
      .set(auth(buyer.token))
      .send({ lastReadMessageId: latest.id })
      .expect(201);
    await http()
      .post(base() + '/read')
      .set(auth(buyer.token))
      .send({ lastReadMessageId: second.body.items[0].id })
      .expect(201)
      .expect((r) => expect(r.body.lastReadSequence).toBe(4));
    await http()
      .get(base())
      .set(auth(buyer.token))
      .expect(200)
      .expect((r) => expect(r.body.unreadCount).toBe(0));
  });
  it('rejects malformed queries/body, forged sender and cross-conversation read', async () => {
    for (const query of [
      'limit=2&limit=3',
      'afterSequence=01',
      'beforeSequence=1&afterSequence=1',
      'q=x',
    ])
      await http()
        .get(base() + '/messages?' + query)
        .set(auth(buyer.token))
        .expect(400);
    await send(buyer.token, `${marker}-empty`, '   ').expect(400);
    await http()
      .post(base() + '/messages')
      .set(auth(buyer.token))
      .send({
        clientMessageId: 'bad',
        type: 'TEXT',
        content: 'text',
        senderId: seller.id,
      })
      .expect(400);
    const other = await chat.open(outsider.id, storeId);
    const message = await chat.send(outsider.id, other.id, {
      clientMessageId: 'other',
      type: 'TEXT',
      content: 'private',
    });
    await http()
      .post(base() + '/read')
      .set(auth(buyer.token))
      .send({ lastReadMessageId: message.message.id })
      .expect(404);
    await http()
      .get(`/chat/conversations/${other.id}/messages`)
      .set(auth(buyer.token))
      .expect(404);
  });
  it('rolls back parent sequence if message insertion fails after trigger', async () => {
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
          clientMessageId: `${marker}-invalid`,
          content: 'rollback',
          payloadHash: 'invalid',
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
  });
  it('prevents rewriting immutable history and rewinding read state in SQL', async () => {
    await expect(
      db.chatMessage.updateMany({
        where: { conversationId },
        data: { content: 'rewritten' },
      }),
    ).rejects.toThrow();
    const oldest = await db.chatMessage.findFirstOrThrow({
      where: { conversationId },
      orderBy: { sequence: 'asc' },
    });
    await expect(
      db.chatReadState.update({
        where: { conversationId_userId: { conversationId, userId: buyer.id } },
        data: {
          lastReadSequence: oldest.sequence,
          lastReadMessageId: oldest.id,
        },
      }),
    ).rejects.toThrow();
  });
  it('prevents counter rewind, counter-only advance and participant replacement', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    await expect(
      db.chatConversation.update({
        where: { id: conversationId },
        data: { lastSequence: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      db.chatConversation.update({
        where: { id: conversationId },
        data: { lastSequence: before.lastSequence + 1 },
      }),
    ).rejects.toThrow();
    await expect(
      db.chatConversation.update({
        where: { id: conversationId },
        data: { buyerId: outsider.id },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
        })
      ).lastSequence,
    ).toBe(before.lastSequence);
  });
  it('fails closed on suspension without verified prior transaction and locked owner replay', async () => {
    await db.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    await send(buyer.token, `${marker}-suspended`, 'no proof').expect(409);
    await db.store.update({
      where: { id: storeId },
      data: { status: 'ACTIVE' },
    });
    await db.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    await send(
      buyer.token,
      `${marker}-text`,
      'Xin chào <script>plain text</script>',
    ).expect(409);
    await http()
      .get(base() + '/messages')
      .set(auth(buyer.token))
      .expect(200);
    await http().get(base()).set(auth(seller.token)).expect(401);
  });
  it('allows suspended-store support only for the pair with a real prior Checkout', async () => {
    const customer = await actor(Role.USER),
      merchant = await actor(Role.SELLER);
    const shop = await db.store.create({
      data: {
        sellerId: merchant.id,
        status: 'ACTIVE',
        name: `${marker}-prior-shop`,
      },
    });
    const category = await db.category.create({
      data: { name: 'Chat support QA', slug: `${marker}-chat-support` },
    });
    const product = await db.product.create({
      data: {
        storeId: shop.id,
        categoryId: category.id,
        name: 'Support fixture',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: { url: '/uploads/chat-qa-only.jpg', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        storeId: shop.id,
        skuCode: `${marker}-support-sku`,
        optionSignature: 'default',
        price: '10000',
        stock: 2,
      },
    });
    const address = await db.userAddress.create({
      data: {
        userId: customer.id,
        recipientName: 'QA Buyer',
        phone: '0901234567',
        province: 'QA Province',
        ward: 'QA Ward',
        addressLine: 'QA Address',
      },
    });
    await db.cart.create({
      data: {
        userId: customer.id,
        items: { create: { variantId: variant.id, quantity: 1 } },
      },
    });
    const conversation = await chat.open(customer.id, shop.id);
    const foreign = await chat.open(outsider.id, shop.id);
    await http()
      .post('/checkouts')
      .set(auth(customer.token))
      .set('Idempotency-Key', `${marker}-prior-checkout`)
      .send({
        addressId: address.id,
        paymentProvider: 'COD',
        items: [
          { variantId: variant.id, quantity: 1, expectedUnitPrice: '10000' },
        ],
      })
      .expect(201);
    const order = await db.order.findFirstOrThrow({
      where: { buyerId: customer.id, storeId: shop.id },
    });
    await db.store.update({
      where: { id: shop.id },
      data: { status: 'SUSPENDED' },
    });
    await db.storeStatusHistory.create({
      data: {
        storeId: shop.id,
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        actorId: admin.id,
        reason: 'Synthetic QA suspension',
        createdAt: new Date(order.createdAt.getTime() + 1),
      },
    });
    const result = await chat.send(customer.id, conversation.id, {
      type: 'TEXT',
      clientMessageId: `${marker}-prior-order-support`,
      content: 'Hỗ trợ đơn đã mua',
    });
    expect(result.message.sequence).toBe(1);
    await expect(
      chat.send(outsider.id, foreign.id, {
        type: 'TEXT',
        clientMessageId: `${marker}-foreign-prior`,
        content: 'No prior order',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('retains history across a Nest application restart', async () => {
    const count = await db.chatMessage.count({ where: { conversationId } });
    await app.close();
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    chat = app.get(ChatService);
    await http()
      .get(base() + '/messages')
      .set(auth(buyer.token))
      .expect(200)
      .expect((r) => expect(r.body.items).toHaveLength(count));
  });
  it('bounds actor send quota and emits Retry-After', async () => {
    const limited = await actor(Role.USER);
    for (let n = 0; n < 20; n++)
      await send(
        limited.token,
        `${marker}-limited-${n}`,
        'unauthorized',
      ).expect(404);
    await send(limited.token, `${marker}-limited-end`, 'unauthorized')
      .expect(429)
      .expect('Retry-After', '60');
  });
  it('keeps opted-in Seller buying history without granting self-chat', async () => {
    const customer = await actor(Role.USER);
    // Another active store: the main Seller was disabled in the revocation test.
    const merchant = await actor(Role.SELLER);
    const shop = await db.store.create({
      data: { sellerId: merchant.id, status: 'ACTIVE', name: 'Capability QA' },
    });
    const conversation = await chat.open(customer.id, shop.id);
    await db.user.update({
      where: { id: customer.id },
      data: { role: 'SELLER' },
    });
    const old = process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
    try {
      process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'false';
      await expect(
        chat.detail(customer.id, conversation.id),
      ).rejects.toMatchObject({ status: 404 });
      process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
      expect((await chat.detail(customer.id, conversation.id)).buyerId).toBe(
        customer.id,
      );
      const result = await chat.send(customer.id, conversation.id, {
        clientMessageId: 'capability',
        type: 'TEXT',
        content: 'Buyer context',
      });
      expect(result.message.senderType).toBe('BUYER');
      await expect(chat.open(merchant.id, shop.id)).rejects.toMatchObject({
        status: 403,
      });
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: customer.id } })).role,
      ).toBe('SELLER');
    } finally {
      if (old === undefined) delete process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
      else process.env.ACCOUNT_BUYER_ACCESS_ENABLED = old;
    }
  });
  it('publishes authenticated Swagger request shapes for manual QA', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const open = document.paths['/chat/conversations'].post!;
    expect(open.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/chat/conversations'].get!.security).toEqual([
      { bearer: [] },
    ]);
    expect(open.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { additionalProperties: false, required: ['storeId'] },
        },
      },
    });
    expect(
      document.paths['/chat/conversations/{id}/messages'].post!.requestBody,
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['clientMessageId', 'type'],
            oneOf: [
              {
                required: ['contextOrderId'],
                properties: { type: { enum: ['ORDER_CONTEXT'] } },
              },
              {
                required: ['content'],
                properties: { type: { enum: ['TEXT'] } },
              },
              {
                required: ['contextProductId'],
                properties: { type: { enum: ['PRODUCT_CONTEXT'] } },
              },
            ],
          },
        },
      },
    });
  });
  describe('Inbox: real read-only query, live activity keyset and ownership', () => {
    let customer: Awaited<ReturnType<typeof actor>>,
      merchant: Awaited<ReturnType<typeof actor>>;
    let peer: Awaited<ReturnType<typeof actor>>,
      third: Awaited<ReturnType<typeof actor>>;
    let shop: number,
      otherShop: number,
      own: number,
      empty: number,
      foreign: number,
      last: number;
    const inbox = (token: string, query = '') =>
      http()
        .get('/chat/conversations' + query)
        .set(auth(token));
    beforeAll(async () => {
      customer = await actor(Role.USER);
      merchant = await actor(Role.SELLER);
      peer = await actor(Role.USER);
      third = await actor(Role.USER);
      const otherMerchant = await actor(Role.SELLER);
      shop = (
        await db.store.create({
          data: { sellerId: merchant.id, name: 'Inbox shop', status: 'ACTIVE' },
        })
      ).id;
      otherShop = (
        await db.store.create({
          data: {
            sellerId: otherMerchant.id,
            name: 'Other inbox shop',
            status: 'ACTIVE',
          },
        })
      ).id;
      own = (await chat.open(customer.id, shop)).id;
      empty = (await chat.open(customer.id, otherShop)).id;
      foreign = (await chat.open(peer.id, shop)).id;
      last = (await chat.open(third.id, shop)).id;
      // Synthetic equal-time fixture tests the ID tie-breaker, not wall-clock timing.
      for (const [conversation, sender] of [
        [own, customer.id],
        [foreign, peer.id],
        [last, third.id],
      ]) {
        await db.chatMessage.create({
          data: {
            conversationId: conversation,
            sequence: 1,
            senderId: sender,
            senderType: 'BUYER',
            clientMessageId: randomUUID(),
            content: 'Inbox fixture',
            payloadHash: 'a'.repeat(64),
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        });
      }
    });
    it('returns only Buyer membership with minimal response, last message and no read mutation', async () => {
      const before = await db.chatConversation.findMany({
        where: { id: { in: [own, empty] } },
        include: { readStates: true },
      });
      const response = await inbox(customer.token)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(response.body.items.map((row: { id: number }) => row.id)).toEqual([
        own,
        empty,
      ]);
      expect(response.body.nextCursor).toBeNull();
      const item = response.body.items[0];
      expect(Object.keys(item).sort()).toEqual(
        [
          'id',
          'context',
          'store',
          'buyer',
          'lastSequence',
          'lastMessageAt',
          'lastMessage',
          'lastReadSequence',
          'unreadCount',
        ].sort(),
      );
      expect(Object.keys(item.store).sort()).toEqual(['id', 'name']);
      expect(Object.keys(item.buyer).sort()).toEqual(['fullName', 'id']);
      expect(item.context).toBe('BUYER');
      expect(item.unreadCount).toBe(0);
      expect(item.lastMessage.content).toBe('Inbox fixture');
      expect(item.lastMessage).not.toHaveProperty('clientMessageId');
      expect(item.lastMessage).not.toHaveProperty('payloadHash');
      expect(response.body.items[1].lastMessage).toBeNull();
      const first = await inbox(customer.token, '?limit=1').expect(200);
      const second = await inbox(
        customer.token,
        '?limit=1&cursor=' + first.body.nextCursor,
      ).expect(200);
      expect(second.body.items.map((row: { id: number }) => row.id)).toEqual([
        empty,
      ]);
      expect(second.body.nextCursor).toBeNull();
      const nullBoundary = inboxCursor({ lastMessageAt: null, id: 2147483647 });
      const onlyEmpty = await inbox(
        customer.token,
        '?cursor=' + nullBoundary,
      ).expect(200);
      expect(onlyEmpty.body.items.map((row: { id: number }) => row.id)).toEqual(
        [empty],
      );
      expect(
        await db.chatConversation.findMany({
          where: { id: { in: [own, empty] } },
          include: { readStates: true },
        }),
      ).toEqual(before);
    });
    it('paginates equal timestamps by ID, excluding another Store even with a forged cursor', async () => {
      const ids: number[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        const response: Awaited<ReturnType<typeof inbox>> = await inbox(
          merchant.token,
          '?limit=1' + (cursor ? '&cursor=' + cursor : ''),
        ).expect(200);
        expect(response.body.items).toHaveLength(1);
        expect(response.body.items[0].context).toBe('SELLER');
        ids.push(response.body.items[0].id);
        cursor = response.body.nextCursor;
      }
      expect(ids).toEqual([last, foreign, own]);
      expect(cursor).toBeNull();
      const forged = inboxCursor({
        id: 2147483647,
        lastMessageAt: new Date('2099-01-01T00:00:00.000Z'),
      });
      const response = await inbox(merchant.token, '?cursor=' + forged).expect(
        200,
      );
      expect(response.body.items.map((row: { id: number }) => row.id)).toEqual([
        last,
        foreign,
        own,
      ]);
    });
    it('counts only peer messages after the read cursor and retains history for suspended Store', async () => {
      const result = await chat.send(merchant.id, own, {
        clientMessageId: randomUUID(),
        type: 'TEXT',
        content: 'Reply',
      });
      let response = await inbox(customer.token).expect(200);
      expect(
        response.body.items.find((row: { id: number }) => row.id === own)
          .unreadCount,
      ).toBe(1);
      await chat.read(customer.id, own, result.message.id);
      response = await inbox(customer.token).expect(200);
      expect(
        response.body.items.find((row: { id: number }) => row.id === own)
          .unreadCount,
      ).toBe(0);
      await db.store.update({
        where: { id: shop },
        data: { status: 'SUSPENDED' },
      });
      await inbox(merchant.token)
        .expect(200)
        .expect((r) => expect(r.body.items).toHaveLength(3));
    });
    it('lets refresh recover a conversation moving above a live pagination cursor', async () => {
      const first = await inbox(customer.token, '?limit=1').expect(200);
      expect(first.body.items[0].id).toBe(own);
      await chat.send(customer.id, empty, {
        clientMessageId: randomUUID(),
        type: 'TEXT',
        content: 'New activity',
      });
      const second = await inbox(
        customer.token,
        '?limit=1&cursor=' + first.body.nextCursor,
      ).expect(200);
      expect(second.body.items).toEqual([]);
      const refreshed = await inbox(customer.token).expect(200);
      expect(
        refreshed.body.items.map((row: { id: number }) => row.id).sort(),
      ).toEqual([own, empty].sort());
    });
    it('rejects invalid query, body, Admin and stale privileges; empty inbox is explicit', async () => {
      await http()
        .get('/chat/conversations')
        .expect(401)
        .expect('Cache-Control', 'no-store');
      await inbox(admin.token).expect(403).expect('Cache-Control', 'no-store');
      for (const query of [
        '?limit=01',
        '?limit=101',
        '?limit=1&limit=2',
        '?buyerId=1',
        '?cursor=bad',
      ])
        await inbox(customer.token, query).expect(400);
      await http()
        .get('/chat/conversations')
        .set(auth(customer.token))
        .send({ buyerId: peer.id })
        .expect(400);
      const nobody = await actor(Role.USER);
      await inbox(nobody.token)
        .expect(200)
        .expect((r) => expect(r.body).toEqual({ items: [], nextCursor: null }));
      await db.user.update({
        where: { id: nobody.id },
        data: { role: 'ADMIN' },
      });
      await inbox(nobody.token).expect(403);
      await db.user.update({
        where: { id: nobody.id },
        data: { isActive: false },
      });
      await inbox(nobody.token).expect(401);
    });
    it('keeps Seller owner and opt-in Buyer contexts separate in the same inbox', async () => {
      const old = process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
      try {
        await db.user.update({
          where: { id: customer.id },
          data: { role: 'SELLER' },
        });
        const customerShop = await db.store.create({
          data: {
            sellerId: customer.id,
            name: 'Dual context',
            status: 'ACTIVE',
          },
        });
        const received = await chat.open(third.id, customerShop.id);
        process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'false';
        const ownerOnly = await inbox(customer.token).expect(200);
        expect(
          ownerOnly.body.items.map((row: { id: number }) => row.id),
        ).toEqual([received.id]);
        process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
        const both = await inbox(customer.token).expect(200);
        expect(
          both.body.items.map((row: { id: number }) => row.id).sort(),
        ).toEqual([received.id, own, empty].sort());
        expect(
          both.body.items.find((row: { id: number }) => row.id === received.id)
            .context,
        ).toBe('SELLER');
        expect(
          both.body.items.find((row: { id: number }) => row.id === own).context,
        ).toBe('BUYER');
      } finally {
        if (old === undefined) delete process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
        else process.env.ACCOUNT_BUYER_ACCESS_ENABLED = old;
      }
    });
  });
  it('is not available until opt-in is enabled', async () => {
    process.env.CHAT_TEXT_ENABLED = 'false';
    await http().get(base()).set(auth(buyer.token)).expect(404);
    process.env.CHAT_TEXT_ENABLED = 'true';
  });
});
