import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { chatSqlState } from './chat-sql-state.js';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { inboxCursor, type ChatInboxPage } from './chat-inbox-page.js';
import { ChatEvents } from './chat-events.js';
import { credentialMatches } from '../auth/credential-version.js';
import {
  isPublicListing,
  listingInclude,
} from '../product/product-public-policy.js';
import {
  assertCanOpenChat,
  assertCanReadChat,
  assertCanSendChat,
  ChatPolicyError,
} from './chat-policy.js';
import {
  assertChatReplayMatches,
  ChatMessageRequestError,
  prepareChatMessage,
} from './chat-message-request.js';

type Tx = Prisma.TransactionClient;
const fail = (status: number, code: string): never => {
  throw new HttpException({ statusCode: status, code, message: code }, status);
};
const selectMessage = {
  id: true,
  conversationId: true,
  sequence: true,
  senderId: true,
  senderType: true,
  content: true,
  contextProductId: true,
  createdAt: true,
} as const;

function presentMessage<T extends { contextProductId: number | null }>(
  row: T,
  storeId: number,
) {
  const { contextProductId, ...message } = row;
  return contextProductId === null
    ? message
    : {
        ...message,
        productContext: { productId: contextProductId, storeId },
      };
}

@Injectable()
export class ChatService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: ChatEvents,
  ) {}

  private async transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
            return run(tx);
          },
          { isolationLevel: 'Serializable', timeout: 10000 },
        );
      } catch (error) {
        if (
          error instanceof ChatPolicyError ||
          error instanceof ChatMessageRequestError
        )
          return fail(error.status, error.code);
        const code = (error as { code?: string }).code;
        const sqlState = chatSqlState(error);
        if (
          code === 'P2034' ||
          code === 'P2002' ||
          ['40001', '40P01'].includes(sqlState)
        ) {
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 10 * (attempt + 1)),
            );
            continue;
          }
          return fail(503, 'CHAT_RETRY_LATER');
        }
        if (['55P03', '57014'].includes(sqlState))
          return fail(503, 'CHAT_RETRY_LATER');
        throw error;
      }
    }
    return fail(503, 'CHAT_RETRY_LATER');
  }

  private async actor(tx: Tx, actorId: number) {
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, isActive: true },
    });
    if (!actor || !actor.isActive) return fail(401, 'UNAUTHORIZED');
    if (actor.role === 'ADMIN') return fail(403, 'FORBIDDEN');
    return actor;
  }

  private async context(tx: Tx, actorId: number, id: number) {
    const rawActor = await this.actor(tx, actorId);
    // Parent lock serializes send/read/replay; no process-local correctness lock.
    await tx.$queryRaw`SELECT id FROM chat_conversations WHERE id=${id} FOR UPDATE`;
    const conversation = await tx.chatConversation.findUnique({
      where: { id },
      include: {
        store: { include: { seller: { select: { isActive: true } } } },
      },
    });
    if (!conversation) return fail(404, 'CONVERSATION_NOT_FOUND');
    const store = {
      id: conversation.store.id,
      sellerId: conversation.store.sellerId,
      status: conversation.store.status,
      ownerIsActive: conversation.store.seller.isActive,
    };
    // BUYER context only, matching #106 opt-in; never changes User/JWT role.
    const actor =
      rawActor.id !== store.sellerId && canActAsBuyer(rawActor.role)
        ? { ...rawActor, role: 'USER' as const }
        : rawActor;
    assertCanReadChat(actor, store, conversation);
    return { actor, conversation, store };
  }

  inbox(actorId: number, page: ChatInboxPage) {
    return this.transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const actor = await this.actor(tx, actorId);
      // Both contexts use current canonical ownership. A cursor is never an authorization claim.
      const membership: Prisma.ChatConversationWhereInput[] = [];
      if (canActAsBuyer(actor.role))
        membership.push({
          buyerId: actorId,
          store: { sellerId: { not: actorId } },
        });
      if (actor.role === 'SELLER')
        membership.push({
          buyerId: { not: actorId },
          store: { sellerId: actorId },
        });
      const cursor = page.cursor;
      const boundary: Prisma.ChatConversationWhereInput = !cursor
        ? {}
        : cursor.lastMessageAt === null
          ? { lastMessageAt: null, id: { lt: cursor.id } }
          : {
              OR: [
                { lastMessageAt: { lt: cursor.lastMessageAt } },
                { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
                { lastMessageAt: null },
              ],
            };
      const rows = await tx.chatConversation.findMany({
        where: { AND: [{ OR: membership }, boundary] },
        orderBy: [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
        take: page.limit + 1,
        select: {
          id: true,
          buyerId: true,
          storeId: true,
          lastSequence: true,
          lastMessageAt: true,
          store: { select: { id: true, name: true } },
          buyer: { select: { fullName: true } },
          readStates: {
            where: { userId: actorId },
            select: { lastReadSequence: true },
          },
          messages: {
            orderBy: { sequence: 'desc' },
            take: 1,
            select: selectMessage,
          },
        },
      });
      const selected = rows.slice(0, page.limit);
      const counts = selected.length
        ? await tx.chatMessage.groupBy({
            by: ['conversationId'],
            where: {
              senderId: { not: actorId },
              OR: selected.map((row) => ({
                conversationId: row.id,
                sequence: { gt: row.readStates[0]?.lastReadSequence ?? 0 },
              })),
            },
            _count: { _all: true },
          })
        : [];
      const unread = new Map(
        counts.map((row) => [row.conversationId, row._count._all]),
      );
      const last = selected.at(-1);
      return {
        items: selected.map((row) => ({
          id: row.id,
          context:
            row.buyerId === actorId ? ('BUYER' as const) : ('SELLER' as const),
          store: row.store,
          buyer: { id: row.buyerId, fullName: row.buyer.fullName },
          lastSequence: row.lastSequence,
          lastMessageAt: row.lastMessageAt,
          lastMessage: row.messages[0]
            ? presentMessage(row.messages[0], row.storeId)
            : null,
          lastReadSequence: row.readStates[0]?.lastReadSequence ?? 0,
          unreadCount: unread.get(row.id) ?? 0,
        })),
        nextCursor: rows.length > page.limit && last ? inboxCursor(last) : null,
      };
    });
  }

  /** A short read authorization fence, not the Message write transaction.
   * Locks prevent a credential/owner change committing between the final
   * authorization snapshot and the synchronous socket enqueue. No network await. */
  authorizeDelivery(
    actorId: number,
    conversationId: number,
    credentialVersion: number,
    expires: number,
    enqueue: () => void,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`;
        await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
        await tx.$queryRaw`SELECT s.id FROM stores s JOIN chat_conversations c ON c."storeId"=s.id WHERE c.id=${conversationId} FOR SHARE OF s`;
        await this.context(tx, actorId, conversationId);
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { credentialVersion: true },
        });
        if (
          !actor ||
          !credentialMatches(credentialVersion, actor.credentialVersion) ||
          expires <= Date.now()
        )
          return fail(401, 'UNAUTHORIZED');
        enqueue();
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 4000 },
    );
  }

  open(actorId: number, storeId: number) {
    return this.transaction(async (tx) => {
      const rawActor = await this.actor(tx, actorId);
      const row = await tx.store.findUnique({
        where: { id: storeId },
        include: { seller: { select: { isActive: true } } },
      });
      if (!row) return fail(404, 'STORE_NOT_FOUND');
      const actor =
        rawActor.id !== row.sellerId && canActAsBuyer(rawActor.role)
          ? { ...rawActor, role: 'USER' as const }
          : rawActor;
      assertCanOpenChat(actor, { ...row, ownerIsActive: row.seller.isActive });
      const rowSelect = {
        id: true,
        buyerId: true,
        storeId: true,
        lastSequence: true,
        lastMessageAt: true,
        createdAt: true,
      } as const;
      const existing = await tx.chatConversation.findUnique({
        where: { buyerId_storeId: { buyerId: actorId, storeId } },
        select: rowSelect,
      });
      return (
        existing ??
        tx.chatConversation.create({
          data: { buyerId: actorId, storeId },
          select: rowSelect,
        })
      );
    });
  }

  detail(actorId: number, id: number) {
    return this.transaction(async (tx) => {
      const { conversation } = await this.context(tx, actorId, id);
      const state = await tx.chatReadState.findUnique({
        where: {
          conversationId_userId: { conversationId: id, userId: actorId },
        },
      });
      const unreadCount = await tx.chatMessage.count({
        where: {
          conversationId: id,
          senderId: { not: actorId },
          sequence: { gt: state?.lastReadSequence ?? 0 },
        },
      });
      return {
        id,
        buyerId: conversation.buyerId,
        storeId: conversation.storeId,
        lastSequence: conversation.lastSequence,
        lastMessageAt: conversation.lastMessageAt,
        lastReadSequence: state?.lastReadSequence ?? 0,
        unreadCount,
      };
    });
  }

  send(actorId: number, id: number, body: unknown) {
    const input = prepareChatMessage(id, actorId, body);
    const contextProductId =
      input.payload.type === 'PRODUCT_CONTEXT'
        ? input.payload.contextProductId
        : null;
    const content =
      input.payload.type === 'TEXT'
        ? input.payload.content
        : 'Đã chia sẻ sản phẩm';
    return this.transaction(async (tx) => {
      const { actor, conversation, store } = await this.context(
        tx,
        actorId,
        id,
      );
      let prior = false;
      if (store.status === 'SUSPENDED') {
        const suspension = await tx.storeStatusHistory.findFirst({
          where: { storeId: store.id, toStatus: 'SUSPENDED' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        prior =
          !!suspension &&
          !!(await tx.order.findFirst({
            where: {
              buyerId: conversation.buyerId,
              storeId: store.id,
              createdAt: { lt: suspension.createdAt },
            },
            select: { id: true },
          }));
      }
      // Permission/state checks precede replay; a stored receipt cannot restore revoked send rights.
      assertCanSendChat(actor, store, conversation, prior);
      const existing = await tx.chatMessage.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId: id,
            senderId: actorId,
            clientMessageId: input.clientMessageId,
          },
        },
      });
      if (existing) {
        if (existing.hashVersion !== 1)
          return fail(500, 'CHAT_RECEIPT_INVALID');
        assertChatReplayMatches({ ...existing, hashVersion: 1 }, input);
        const message = await tx.chatMessage.findUniqueOrThrow({
          where: { id: existing.id },
          select: selectMessage,
        });
        return { message: presentMessage(message, store.id), replay: true };
      }
      if (contextProductId !== null) {
        // Kill-switch stops new shares, never prevents recovery of an existing receipt.
        if (process.env.CHAT_PRODUCT_CONTEXT_ENABLED !== 'true')
          return fail(400, 'CHAT_VALIDATION_ERROR');
        const product = await tx.product.findUnique({
          where: { id: contextProductId },
          include: listingInclude,
        });
        const categories = await tx.category.findMany({
          select: { id: true, parentId: true, isActive: true },
        });
        if (
          !product ||
          product.storeId !== store.id ||
          !isPublicListing(product, categories)
        )
          return fail(404, 'CHAT_PRODUCT_UNAVAILABLE');
      }
      if (conversation.lastSequence === 2147483647)
        return fail(409, 'CHAT_SEQUENCE_EXHAUSTED');
      const message = await tx.chatMessage.create({
        data: {
          conversationId: id,
          sequence: conversation.lastSequence + 1,
          senderId: actorId,
          senderType: actor.role === 'USER' ? 'BUYER' : 'SELLER',
          content,
          contextProductId,
          clientMessageId: input.clientMessageId,
          payloadHash: input.payloadHash,
          hashVersion: 1,
        },
        select: selectMessage,
      });
      return { message: presentMessage(message, store.id), replay: false };
    }).then((result) => {
      if (!result.replay)
        this.events.publish({ conversationId: id, message: result.message });
      return result;
    });
  }

  history(
    actorId: number,
    id: number,
    page: { limit: number; beforeSequence?: number; afterSequence?: number },
  ) {
    return this.transaction(async (tx) => {
      const { conversation } = await this.context(tx, actorId, id);
      const forward = page.afterSequence !== undefined;
      const rows = await tx.chatMessage.findMany({
        where: {
          conversationId: id,
          sequence: {
            ...(forward
              ? { gt: page.afterSequence }
              : page.beforeSequence !== undefined
                ? { lt: page.beforeSequence }
                : {}),
            lte: conversation.lastSequence,
          },
        },
        orderBy: { sequence: forward ? 'asc' : 'desc' },
        take: page.limit + 1,
        select: selectMessage,
      });
      const hasMore = rows.length > page.limit;
      const selected = rows.slice(0, page.limit);
      const cursor = selected.at(-1)?.sequence ?? null;
      return {
        items: (forward ? selected : selected.reverse()).map((row) =>
          presentMessage(row, conversation.storeId),
        ),
        highWatermark: conversation.lastSequence,
        hasMore,
        nextBeforeSequence: !forward && hasMore ? cursor : null,
        nextAfterSequence: forward && hasMore ? cursor : null,
      };
    });
  }

  read(actorId: number, id: number, messageId: number) {
    return this.transaction(async (tx) => {
      await this.context(tx, actorId, id);
      const message = await tx.chatMessage.findFirst({
        where: { id: messageId, conversationId: id },
        select: { id: true, sequence: true },
      });
      if (!message) return fail(404, 'MESSAGE_NOT_FOUND');
      const key = {
        conversationId_userId: { conversationId: id, userId: actorId },
      };
      const state = await tx.chatReadState.findUnique({ where: key });
      if (state && state.lastReadSequence >= message.sequence)
        return {
          lastReadMessageId: state.lastReadMessageId,
          lastReadSequence: state.lastReadSequence,
        };
      const saved = await tx.chatReadState.upsert({
        where: key,
        create: {
          conversationId: id,
          userId: actorId,
          lastReadMessageId: message.id,
          lastReadSequence: message.sequence,
        },
        update: {
          lastReadMessageId: message.id,
          lastReadSequence: message.sequence,
          updatedAt: new Date(),
        },
      });
      return {
        lastReadMessageId: saved.lastReadMessageId,
        lastReadSequence: saved.lastReadSequence,
      };
    }).then((result) => {
      this.events.publish({ conversationId: id });
      return result;
    });
  }
}
