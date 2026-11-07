import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { credentialMatches } from '../auth/credential-version.js';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { isAccountStatusConflict } from '../auth/account-status-sql.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';
import {
  isPublicListing,
  listingInclude,
} from '../product/product-public-policy.js';
import {
  digest,
  input,
  page,
  positive,
  proof,
  validAction,
  windowDays,
  type ReviewAction,
  type ReviewScope,
} from './review-input.js';
type Tx = Prisma.TransactionClient;
const conflict = (code: string): never => {
  throw new ConflictException({ code });
};
const include = {
  reply: true,
  orderItem: {
    include: {
      order: { include: { store: true } },
      refund: { select: { id: true } },
    },
  },
} satisfies Prisma.ProductReviewInclude;
type Row = Prisma.ProductReviewGetPayload<{ include: typeof include }>;
@Injectable()
export class ReviewService {
  constructor(private readonly db: PrismaService) {}
  private gate() {
    if (process.env.PRODUCT_REVIEWS_ENABLED !== 'true')
      throw new ServiceUnavailableException({
        code: 'PRODUCT_REVIEWS_DISABLED',
      });
  }
  private async actor(tx: Tx, actor: AuthenticatedUser, scope: ReviewScope) {
    const u = await tx.user.findUnique({ where: { id: actor.userId } });
    if (
      !u?.isActive ||
      !credentialMatches(actor.credentialVersion, u.credentialVersion)
    )
      throw new UnauthorizedException();
    // Ownership authorizes historical reads/receipts for a Seller's Buyer context.
    if (
      scope === 'ADMIN'
        ? u.role !== 'ADMIN'
        : scope === 'SELLER'
          ? u.role !== 'SELLER'
          : !['USER', 'SELLER'].includes(u.role)
    )
      throw new ForbiddenException();
    return u;
  }
  private async target(
    tx: Tx,
    itemId: number,
    actorId: number,
    scope: ReviewScope,
  ) {
    const item = await tx.orderItem.findUnique({
      where: { id: itemId },
      include: { order: { include: { store: true } } },
    });
    if (
      !item ||
      (scope === 'BUYER' && item.order.buyerId !== actorId) ||
      (scope === 'SELLER' && item.order.store.sellerId !== actorId)
    )
      throw new NotFoundException();
    return item;
  }
  private async eligibility(tx: Tx, completedAt: Date | null, status: string) {
    const days = windowDays();
    const [clock] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT statement_timestamp() AS now`;
    const deadline = completedAt
      ? new Date(completedAt.getTime() + days * 86400000)
      : null;
    return {
      deadline,
      eligible:
        status === 'COMPLETED' &&
        !!completedAt &&
        completedAt.getTime() <= clock.now.getTime() + 1000 &&
        !!deadline &&
        clock.now <= deadline,
    };
  }
  private view(r: Row) {
    return {
      id: r.id,
      orderItemId: r.orderItemId,
      productId: r.orderItem.productId,
      storeId: r.orderItem.storeId,
      revision: r.revision,
      rating: r.rating,
      body: r.body,
      hidden: r.hidden,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      reply: r.reply
        ? { body: r.reply.body, createdAt: r.reply.createdAt }
        : null,
      isRefunded: !!r.orderItem.refund,
    };
  }
  async mine(
    actor: AuthenticatedUser,
    itemId: number,
    url: string,
    scope: 'BUYER' | 'ADMIN' = 'BUYER',
  ) {
    this.gate();
    page(url, false);
    return this.db.$transaction(
      async (tx) => {
        const u = await this.actor(tx, actor, scope),
          item = await this.target(tx, itemId, u.id, scope);
        const rule = await this.eligibility(
          tx,
          item.order.completedAt,
          item.order.status,
        );
        const review = await tx.productReview.findUnique({
          where: { orderItemId: itemId },
          include,
        });
        const audits = review
          ? await tx.productReviewAudit.findMany({
              where: { reviewId: review.id },
              orderBy: { revision: 'desc' },
              take: 51,
            })
          : [];
        const permitted =
          canActAsBuyer(u.role) &&
          item.order.store.sellerId !== u.id &&
          rule.eligible;
        return {
          orderItemId: itemId,
          productName: item.productNameSnapshot,
          deadline: rule.deadline,
          canCreate: scope === 'BUYER' && permitted && !review,
          canEdit: scope === 'BUYER' && permitted && !!review,
          review: review ? this.view(review) : null,
          historyTruncated: audits.length > 50,
          history: audits.slice(0, 50).map((a) => ({
            revision: a.revision,
            action: a.action,
            rating: a.rating,
            body: a.body,
            hidden: a.hidden,
            replyBody: a.replyBody,
            ...(scope === 'ADMIN' ? { reason: a.reason } : {}),
            createdAt: a.createdAt,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async list(actor: AuthenticatedUser, scope: 'SELLER' | 'ADMIN', url: string) {
    this.gate();
    const q = page(url);
    return this.db.$transaction(
      async (tx) => {
        await this.actor(tx, actor, scope);
        const rows = await tx.productReview.findMany({
          where: {
            ...(scope === 'SELLER'
              ? { orderItem: { order: { store: { sellerId: actor.userId } } } }
              : {}),
            ...(q.beforeId ? { id: { lt: q.beforeId } } : {}),
          },
          include,
          orderBy: { id: 'desc' },
          take: q.limit + 1,
        });
        return {
          items: rows.slice(0, q.limit).map((r) => ({
            ...this.view(r),
            productName: r.orderItem.productNameSnapshot,
          })),
          nextBeforeId: rows.length > q.limit ? rows[q.limit - 1].id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async publicList(productId: number, url: string) {
    this.gate();
    const q = page(url);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const product = await tx.product.findUnique({
          where: { id: productId },
          include: listingInclude,
        });
        const cats = await tx.category.findMany({
          select: { id: true, parentId: true, isActive: true },
        });
        if (!product || !isPublicListing(product, cats))
          throw new NotFoundException();
        const where = { hidden: false, orderItem: { productId } };
        const groups = await tx.productReview.groupBy({
          by: ['rating'],
          where,
          _count: { _all: true },
        });
        const counts: Record<string, number> = {
          '1': 0,
          '2': 0,
          '3': 0,
          '4': 0,
          '5': 0,
        };
        let count = 0,
          sum = 0;
        for (const g of groups) {
          counts[String(g.rating)] = g._count._all;
          count += g._count._all;
          sum += g.rating * g._count._all;
        }
        const rows = await tx.productReview.findMany({
          where: {
            ...where,
            ...(q.beforeId ? { id: { lt: q.beforeId } } : {}),
          },
          include: {
            reply: true,
            orderItem: { select: { refund: { select: { id: true } } } },
          },
          orderBy: { id: 'desc' },
          take: q.limit + 1,
        });
        return {
          productId,
          count,
          average: count ? Math.round((sum / count) * 10) / 10 : null,
          counts,
          items: rows.slice(0, q.limit).map((r) => ({
            id: r.id,
            rating: r.rating,
            body: r.body,
            author: 'Người mua đã xác minh',
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            reply: r.reply
              ? { body: r.reply.body, createdAt: r.reply.createdAt }
              : null,
            isRefunded: !!r.orderItem.refund,
          })),
          nextBeforeId: rows.length > q.limit ? rows[q.limit - 1].id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async execute(
    actor: AuthenticatedUser,
    scope: ReviewScope,
    action: ReviewAction,
    itemId: number,
    raw: unknown,
    reconcile = false,
  ) {
    this.gate();
    validAction(scope, action);
    positive(itemId);
    const body = reconcile ? null : input(scope, action, raw),
      p = reconcile
        ? proof(raw)
        : {
            commandId: body!.commandId,
            requestHash: digest(scope, action, itemId, body!),
          };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.userId} FOR UPDATE`;
            const u = await this.actor(tx, actor, scope);
            const ref = await this.target(tx, itemId, u.id, scope);
            await tx.$queryRaw`SELECT id FROM stores WHERE id=${ref.storeId} FOR SHARE`;
            await tx.$queryRaw`SELECT id FROM orders WHERE id=${ref.orderId} FOR UPDATE`;
            const item = await this.target(tx, itemId, u.id, scope);
            let review = await tx.productReview.findUnique({
              where: { orderItemId: itemId },
              include,
            });
            if (review) {
              await tx.$queryRaw`SELECT id FROM product_reviews WHERE id=${review.id} FOR UPDATE`;
              review = await tx.productReview.findUniqueOrThrow({
                where: { id: review.id },
                include,
              });
            }
            const old = await tx.productReviewCommand.findUnique({
              where: {
                actorId_commandId: { actorId: u.id, commandId: p.commandId },
              },
            });
            if (old) {
              if (
                old.scope !== scope ||
                old.action !== action ||
                old.orderItemId !== itemId ||
                old.requestHash !== p.requestHash
              )
                return conflict('REVIEW_COMMAND_ID_REUSED');
              if (old.outcome === 'CLOSED') {
                if (!reconcile) return conflict('REVIEW_COMMAND_CLOSED');
                return {
                  commandId: p.commandId,
                  outcome: 'CLOSED',
                  receipt: null,
                };
              }
              await this.verify(tx, old);
              return {
                commandId: p.commandId,
                outcome: 'APPLIED',
                receipt: old.receipt,
              };
            }
            const identity = {
              actorId: u.id,
              commandId: p.commandId,
              scope,
              action,
              orderItemId: itemId,
              requestHash: p.requestHash,
            };
            if (reconcile) {
              await tx.productReviewCommand.create({
                data: { ...identity, outcome: 'CLOSED' },
              });
              return {
                commandId: p.commandId,
                outcome: 'CLOSED',
                receipt: null,
              };
            }
            if (scope === 'BUYER') {
              if (!canActAsBuyer(u.role) || item.order.store.sellerId === u.id)
                throw new ForbiddenException();
              if (
                !(
                  await this.eligibility(
                    tx,
                    item.order.completedAt,
                    item.order.status,
                  )
                ).eligible
              )
                return conflict('REVIEW_WINDOW_CLOSED');
            }
            if (scope === 'SELLER' && item.order.store.status === 'CLOSED')
              throw new ForbiddenException();
            if (action === 'create' && review)
              return conflict('REVIEW_ALREADY_EXISTS');
            if (action !== 'create' && !review) throw new NotFoundException();
            if (action === 'reply' && review?.reply)
              return conflict('REVIEW_REPLY_EXISTS');
            if (action === 'hide' && review?.hidden)
              return conflict('REVIEW_ALREADY_HIDDEN');
            if (review && body!.expectedRevision !== review.revision)
              return conflict('REVIEW_REVISION_CONFLICT');
            if (action === 'create') {
              review = await tx.productReview.create({
                data: {
                  orderItemId: itemId,
                  rating: body!.rating!,
                  body: body!.body!,
                },
                include,
              });
            } else {
              review = await tx.productReview.update({
                where: { id: review!.id },
                data: {
                  revision: { increment: 1 },
                  ...(action === 'edit'
                    ? { rating: body!.rating!, body: body!.body! }
                    : action === 'hide'
                      ? { hidden: true }
                      : {}),
                },
                include,
              });
            }
            if (action === 'reply')
              await tx.productReviewReply.create({
                data: { reviewId: review.id, actorId: u.id, body: body!.body! },
              });
            const audit = await tx.productReviewAudit.create({
              data: {
                reviewId: review.id,
                actorId: u.id,
                revision: review.revision,
                action,
                rating: review.rating,
                body: review.body,
                hidden: review.hidden,
                ...(action === 'reply' ? { replyBody: body!.body! } : {}),
                ...(action === 'hide' ? { reason: body!.reason! } : {}),
              },
            });
            const receipt = {
              orderItemId: itemId,
              reviewId: review.id,
              revision: review.revision,
              rating: review.rating,
              hidden: review.hidden,
              action,
              auditId: audit.id.toString(),
            };
            await tx.productReviewCommand.create({
              data: {
                ...identity,
                outcome: 'APPLIED',
                auditId: audit.id,
                receipt,
              },
            });
            return { commandId: p.commandId, outcome: 'APPLIED', receipt };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 2000,
            timeout: 5000,
          },
        );
      } catch (error) {
        if (isAccountStatusConflict(error)) {
          await waitForTransactionRetry(attempt);
          continue;
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException({ code: 'REVIEW_RETRY_EXHAUSTED' });
  }
  private async verify(
    tx: Tx,
    c: Prisma.ProductReviewCommandGetPayload<object>,
  ) {
    const a = c.auditId
      ? await tx.productReviewAudit.findUnique({
          where: { id: c.auditId },
          include: {
            review: { select: { orderItemId: true } },
            command: { select: { id: true } },
          },
        })
      : null;
    const r = c.receipt as Record<string, Prisma.JsonValue> | null;
    if (
      !a ||
      !r ||
      Array.isArray(r) ||
      a.actorId !== c.actorId ||
      a.action !== c.action ||
      a.review.orderItemId !== c.orderItemId ||
      r.orderItemId !== c.orderItemId ||
      r.reviewId !== a.reviewId ||
      r.revision !== a.revision ||
      r.rating !== a.rating ||
      r.hidden !== a.hidden ||
      r.action !== a.action ||
      r.auditId !== a.id.toString() ||
      Object.keys(r).length !== 7
    )
      throw new ServiceUnavailableException({ code: 'REVIEW_RECEIPT_INVALID' });
    if (a.action === 'reply') {
      const reply = await tx.productReviewReply.findUnique({
        where: { reviewId: a.reviewId },
      });
      if (!reply || reply.actorId !== a.actorId || reply.body !== a.replyBody)
        throw new ServiceUnavailableException({
          code: 'REVIEW_RECEIPT_INVALID',
        });
    }
  }
}
