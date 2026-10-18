import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { PrismaService } from '../src/prisma.service.js';

// Real PostgreSQL constraints, not HTTP/state-machine acceptance tests.
describe('Order command and audit foundation (PostgreSQL)', () => {
  const marker = `order-command-${randomUUID()}`;
  let prisma: PrismaService;
  let pool: Pool;
  let actors: { buyer: number; seller: number; admin: number; store: number };
  let fixture: { orderIds: number[]; checkoutIds: number[] } | undefined;
  const createdAt = new Date('2026-10-01T00:00:00.000Z');
  const completedAt = new Date('2026-10-01T00:00:01.000Z');

  interface Claim {
    orderId: number;
    actorScope: string;
    actorType: string;
    actorId: number | null;
    key: string;
    command: string;
    hash: string;
    hashVersion: number;
    status: string;
    responseStatus: number | null;
    resultSnapshot?: unknown;
    completedAt: Date | null;
  }

  function claim(overrides: Partial<Claim> = {}): Claim {
    if (!fixture) throw new Error('Order fixture is unavailable');
    return {
      orderId: fixture.orderIds[0]!,
      actorScope: `USER:${actors.seller}`,
      actorType: 'SELLER',
      actorId: actors.seller,
      key: randomUUID(),
      command: 'confirm',
      hash: 'a'.repeat(64),
      hashVersion: 1,
      status: 'SUCCEEDED',
      responseStatus: 200,
      resultSnapshot: { status: 'CONFIRMED' },
      completedAt,
      ...overrides,
    };
  }

  async function insertCommand(
    c: Claim,
    client: Pool | PoolClient = pool,
  ): Promise<number> {
    if (client === pool) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await insertCommand(c, connection);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    }
    const result = await client.query<{ id: number }>(
      `INSERT INTO order_commands
        ("orderId", "actorScope", "actorType", "actorId", "idempotencyKey",
         command, "requestHash", "hashVersion", status, "responseStatus",
         "resultSnapshot", "createdAt", "completedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        c.orderId,
        c.actorScope,
        c.actorType,
        c.actorId,
        c.key,
        c.command,
        c.hash,
        c.hashVersion,
        c.status,
        c.responseStatus,
        c.resultSnapshot === undefined
          ? null
          : JSON.stringify(c.resultSnapshot),
        createdAt,
        c.completedAt,
      ],
    );
    return result.rows[0]!.id;
  }

  function insertHistory(commandId: number, orderId = fixture!.orderIds[0]!) {
    return prisma.orderStatusHistory.create({
      data: {
        orderId,
        commandId,
        actorId: actors.seller,
        actorType: 'SELLER',
        fromStatus: 'PENDING_CONFIRMATION',
        toStatus: 'CONFIRMED',
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    await prisma.$connect();
    actors = await prisma.$transaction(async (tx) => {
      const buyer = await tx.user.create({
        data: {
          email: `${marker}-buyer@example.test`,
          passwordHash: 'fixture',
          role: 'USER',
        },
      });
      const seller = await tx.user.create({
        data: {
          email: `${marker}-seller@example.test`,
          passwordHash: 'fixture',
          role: 'SELLER',
        },
      });
      const admin = await tx.user.create({
        data: {
          email: `${marker}-admin@example.test`,
          passwordHash: 'fixture',
          role: 'ADMIN',
        },
      });
      const store = await tx.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      });
      return {
        buyer: buyer.id,
        seller: seller.id,
        admin: admin.id,
        store: store.id,
      };
    });
  });

  beforeEach(async () => {
    fixture = await prisma.$transaction(async (tx) => {
      const orderIds: number[] = [];
      const checkoutIds: number[] = [];
      for (let index = 0; index < 2; index++) {
        const checkout = await tx.checkout.create({
          data: {
            buyerId: actors.buyer,
            idempotencyKey: randomUUID(),
            requestHash: 'legacy-fixture',
          },
        });
        checkoutIds.push(checkout.id);
        const order = await tx.order.create({
          data: {
            orderNumber: `${marker}-${randomUUID()}`,
            checkoutId: checkout.id,
            buyerId: actors.buyer,
            storeId: actors.store,
            recipientNameSnapshot: 'Fixture Buyer',
            phoneSnapshot: '0900000000',
            provinceSnapshot: 'Test Province',
            districtSnapshot: null,
            wardSnapshot: 'Test Ward',
            addressLineSnapshot: 'Fixture address',
            subtotal: 10000,
            shippingFee: 0,
            total: 10000,
          },
        });
        orderIds.push(order.id);
      }
      return { orderIds, checkoutIds };
    });
  });

  afterEach(async () => {
    if (!fixture) return;
    const { orderIds, checkoutIds } = fixture;
    await prisma.$transaction(async (tx) => {
      await tx.orderStatusHistory.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await tx.orderCommand.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      await tx.checkout.deleteMany({ where: { id: { in: checkoutIds } } });
    });
    fixture = undefined;
  });

  afterAll(async () => {
    try {
      if (actors) {
        await prisma.store.delete({ where: { id: actors.store } });
        await prisma.user.deleteMany({
          where: { id: { in: [actors.buyer, actors.seller, actors.admin] } },
        });
      }
    } finally {
      if (pool) await pool.end();
      if (prisma) await prisma.$disconnect();
    }
  });

  it('retains legacy history and permits typed initial checkout history without a command', async () => {
    const legacy = await prisma.orderStatusHistory.create({
      data: {
        orderId: fixture!.orderIds[0]!,
        actorId: actors.buyer,
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        reason: 'Original free text',
      },
    });
    expect(legacy.actorType).toBeNull();
    expect(legacy.reasonCode).toBeNull();
    expect(legacy.reason).toBe('Original free text');
    const typed = await prisma.orderStatusHistory.create({
      data: {
        orderId: fixture!.orderIds[1]!,
        actorId: actors.buyer,
        actorType: 'BUYER',
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
      },
    });
    expect(typed.commandId).toBeNull();
  });

  it('binds a history row to the same order as its command and limits it to one per command', async () => {
    const id = await insertCommand(claim());
    await expect(
      insertHistory(id, fixture!.orderIds[1]!),
    ).rejects.toMatchObject({ code: 'P2003' });
    await insertHistory(id);
    await expect(insertHistory(id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a typed transition without its command', async () => {
    await expect(
      pool.query(
        `INSERT INTO order_status_history ("orderId", "actorId", "actorType", "fromStatus", "toStatus")
       VALUES ($1,$2,'SELLER','PENDING_CONFIRMATION','CONFIRMED')`,
        [fixture!.orderIds[0], actors.seller],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_history_audit_shape_check',
    });
  });

  it('rejects an orphan PROCESSING claim at commit', async () => {
    const c = claim({
      status: 'PROCESSING',
      responseStatus: null,
      resultSnapshot: undefined,
      completedAt: null,
    });
    await expect(insertCommand(c)).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_completed_at_commit_check',
    });
    expect(
      await prisma.orderCommand.count({ where: { idempotencyKey: c.key } }),
    ).toBe(0);
  });

  it('allows claim, history and completion in one transaction, checking the final row', async () => {
    const client = await pool.connect();
    const c = claim({
      status: 'PROCESSING',
      responseStatus: null,
      resultSnapshot: undefined,
      completedAt: null,
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const id = await insertCommand(c, client);
      await client.query(
        `INSERT INTO order_status_history
        ("orderId", "commandId", "actorId", "actorType", "fromStatus", "toStatus")
        VALUES ($1,$2,$3,'SELLER','PENDING_CONFIRMATION','CONFIRMED')`,
        [c.orderId, id, actors.seller],
      );
      await client.query(
        `UPDATE order_commands SET status='SUCCEEDED', "responseStatus"=200,
        "resultSnapshot"='{"status":"CONFIRMED"}', "completedAt"=$2 WHERE id=$1`,
        [id, completedAt],
      );
      await client.query('COMMIT');
      const saved = await prisma.orderCommand.findUniqueOrThrow({
        where: { id },
        include: { history: true },
      });
      expect(saved.status).toBe('SUCCEEDED');
      expect(saved.history).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rolls back both history and receipt when commit finds an unfinished claim', async () => {
    const client = await pool.connect();
    const c = claim({
      status: 'PROCESSING',
      responseStatus: null,
      resultSnapshot: undefined,
      completedAt: null,
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const id = await insertCommand(c, client);
      await client.query(
        `INSERT INTO order_status_history
        ("orderId", "commandId", "actorId", "actorType", "fromStatus", "toStatus")
        VALUES ($1,$2,$3,'SELLER','PENDING_CONFIRMATION','CONFIRMED')`,
        [c.orderId, id, actors.seller],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
      });
      expect(await prisma.orderCommand.count({ where: { id } })).toBe(0);
      expect(
        await prisma.orderStatusHistory.count({ where: { commandId: id } }),
      ).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('serializes a same-key claim across independent connections', async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    const c = claim();
    try {
      await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await insertCommand(c, a);
      // Attach the rejection handler immediately while connection B waits on A.
      const competing = insertCommand(c, b).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
      await a.query('COMMIT');
      expect((await competing).error).toMatchObject({
        code: '23505',
        constraint: 'order_commands_actorScope_idempotencyKey_key',
      });
      expect(
        await prisma.orderCommand.count({
          where: { actorScope: c.actorScope, idempotencyKey: c.key },
        }),
      ).toBe(1);
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      a.release();
      b.release();
    }
  });

  it('shares the key namespace across commands/orders but allows independent actors', async () => {
    const c = claim();
    await insertCommand(c);
    await expect(
      insertCommand({
        ...c,
        orderId: fixture!.orderIds[1]!,
        command: 'cancel',
        hash: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertCommand({
        ...c,
        actorScope: `USER:${actors.buyer}`,
        actorType: 'BUYER',
        actorId: actors.buyer,
        command: 'cancel',
      }),
    ).resolves.toBeTypeOf('number');
  });

  it.each([
    { key: 'short' },
    { key: 'invalid key with spaces' },
    { hash: 'bad-hash' },
    { hash: 'A'.repeat(64) },
    { hashVersion: 0 },
  ])('rejects invalid key/hash identity %j', async (overrides) => {
    await expect(insertCommand(claim(overrides))).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_key_hash_check',
    });
  });

  it.each([
    { actorScope: 'USER:999999999' },
    { actorId: null },
    {
      actorType: 'SYSTEM',
      actorScope: 'SYSTEM:ORDER_AUTO_COMPLETE',
      command: 'complete',
    },
    {
      actorType: 'SYSTEM',
      actorScope: 'SYSTEM:UNTRUSTED',
      actorId: null,
      command: 'complete',
    },
    {
      actorType: 'SYSTEM',
      actorScope: 'SYSTEM:ORDER_AUTO_COMPLETE',
      actorId: null,
      command: 'cancel',
    },
  ])('rejects inconsistent actor scope %j', async (overrides) => {
    await expect(insertCommand(claim(overrides))).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_actor_scope_check',
    });
  });

  it('allows the D07 SYSTEM scope without inventing a User', async () => {
    await expect(
      insertCommand(
        claim({
          actorType: 'SYSTEM',
          actorId: null,
          actorScope: 'SYSTEM:ORDER_AUTO_COMPLETE',
          command: 'complete',
        }),
      ),
    ).resolves.toBeTypeOf('number');
  });

  it.each([
    { responseStatus: null },
    { responseStatus: 201 },
    { resultSnapshot: undefined },
    { resultSnapshot: null },
    { resultSnapshot: [] },
    { completedAt: null },
    { completedAt: new Date('2026-09-30T00:00:00Z') },
  ])('rejects incomplete successful receipt %j', async (overrides) => {
    await expect(insertCommand(claim(overrides))).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_receipt_check',
    });
  });

  it('rejects commands outside the approved command set', async () => {
    await expect(
      insertCommand(claim({ command: 'set-arbitrary-status' })),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_command_check',
    });
  });

  it('keeps completed receipts immutable when current Order data changes', async () => {
    const id = await insertCommand(claim());
    const before = await prisma.orderCommand.findUniqueOrThrow({
      where: { id },
    });
    await prisma.order.update({
      where: { id: fixture!.orderIds[0]! },
      data: { status: 'PACKING' },
    });
    await expect(
      pool.query(
        `UPDATE order_commands SET "resultSnapshot"='{"status":"PACKING"}' WHERE id=$1`,
        [id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_receipt_immutable_check',
    });
    await expect(
      pool.query(`UPDATE order_commands SET "requestHash"=$2 WHERE id=$1`, [
        id,
        'b'.repeat(64),
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_identity_immutable',
    });
    expect(
      await prisma.orderCommand.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
  });

  it('requires complete cancellation audit without changing legacy cancellation', async () => {
    const orderId = fixture!.orderIds[0]!;
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'Unclassified legacy reason',
        cancelledAt: completedAt,
      },
    });
    await expect(
      pool.query(`UPDATE orders SET "cancelledById"=$2 WHERE id=$1`, [
        orderId,
        actors.buyer,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'orders_cancellation_audit_check',
    });
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        cancelledById: actors.buyer,
        cancelledByType: 'BUYER',
        cancellationReasonCode: 'CHANGED_MIND',
        cancellationReasonText: 'Buyer requested cancellation',
      },
    });
    expect(updated.cancellationReason).toBe('Unclassified legacy reason');
    expect(updated.cancellationReasonCode).toBe('CHANGED_MIND');
  });

  it('preserves history actor identity if the account role changes or deletion is attempted', async () => {
    const id = await insertCommand(
      claim({
        actorId: actors.admin,
        actorType: 'ADMIN',
        actorScope: `USER:${actors.admin}`,
        command: 'ship',
      }),
    );
    const history = await prisma.orderStatusHistory.create({
      data: {
        orderId: fixture!.orderIds[0]!,
        commandId: id,
        actorId: actors.admin,
        actorType: 'ADMIN',
        fromStatus: 'READY_TO_SHIP',
        toStatus: 'SHIPPING',
      },
    });
    await prisma.user.update({
      where: { id: actors.admin },
      data: { role: 'USER' },
    });
    expect(
      (
        await prisma.orderStatusHistory.findUniqueOrThrow({
          where: { id: history.id },
        })
      ).actorType,
    ).toBe('ADMIN');
    await expect(
      prisma.user.delete({ where: { id: actors.admin } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it.each([0, 5])(
    'rejects a history delivery attempt outside 1..4: %i',
    async (attempt) => {
      const id = await insertCommand(
        claim({
          command: 'delivery-failed',
          actorType: 'ADMIN',
          actorId: actors.admin,
          actorScope: `USER:${actors.admin}`,
        }),
      );
      await expect(
        pool.query(
          `INSERT INTO order_status_history
      ("orderId", "commandId", "actorId", "actorType", "fromStatus", "toStatus", "reasonCode", "reasonText", "deliveryAttempt")
      VALUES ($1,$2,$3,'ADMIN','SHIPPING','DELIVERY_FAILED','OTHER','Could not deliver',$4)`,
          [fixture!.orderIds[0], id, actors.admin, attempt],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'order_history_delivery_fields_check',
      });
    },
  );

  it('requires a structured reason for new cancellation history', async () => {
    const id = await insertCommand(claim({ command: 'cancel' }));
    await expect(
      pool.query(
        `INSERT INTO order_status_history
      ("orderId", "commandId", "actorId", "actorType", "fromStatus", "toStatus")
      VALUES ($1,$2,$3,'SELLER','CONFIRMED','CANCELLED')`,
        [fixture!.orderIds[0], id, actors.seller],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_history_required_reason_check',
    });
  });

  it('stores false restockable as a decision, not a missing value', async () => {
    const id = await insertCommand(claim({ command: 'confirm-returned' }));
    const saved = await prisma.orderStatusHistory.create({
      data: {
        orderId: fixture!.orderIds[0]!,
        commandId: id,
        actorId: actors.seller,
        actorType: 'SELLER',
        fromStatus: 'DELIVERY_FAILED',
        toStatus: 'CANCELLED',
        reasonCode: 'DAMAGED',
        reasonText: 'Returned package is damaged',
        restockable: false,
        receiptReference: 'fixture-receipt',
      },
    });
    expect(saved.restockable).toBe(false);
  });
});
