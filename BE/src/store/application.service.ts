import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type StoreStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { credentialMatches } from '../auth/credential-version.js';
import { isAccountStatusConflict } from '../auth/account-status-sql.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';
import { SearchReconciliationService } from '../search/search-reconciliation.service.js';
import {
  applicationHash,
  applicationInput,
  applicationQuery,
  onboardingEnabled,
  positive,
  reconcileInput,
  validAction,
  type ApplicationAction,
  type ApplicationBody,
  type ApplicationScope,
} from './application-input.js';

const conflict = (code: string): never => {
  throw new ConflictException({ code });
};
const include = {
  application: true,
  sellerGrant: true,
} satisfies Prisma.StoreInclude;
type ApplicationStore = Prisma.StoreGetPayload<{ include: typeof include }>;
type Transaction = Prisma.TransactionClient;
const ownerRole = (role: string) => role === 'USER' || role === 'SELLER';

@Injectable()
export class StoreApplicationService {
  constructor(
    private readonly db: PrismaService,
    private readonly search: SearchReconciliationService,
  ) {}
  private gate() {
    if (!onboardingEnabled())
      throw new ServiceUnavailableException({
        code: 'STORE_ONBOARDING_DISABLED',
      });
  }
  private async actor(
    tx: Transaction,
    actor: AuthenticatedUser,
    scope: ApplicationScope,
  ) {
    const current = await tx.user.findUnique({ where: { id: actor.userId } });
    if (
      !current?.isActive ||
      !credentialMatches(actor.credentialVersion, current.credentialVersion)
    )
      throw new UnauthorizedException();
    if (scope === 'ADMIN' ? current.role !== 'ADMIN' : !ownerRole(current.role))
      throw new ForbiddenException();
    return current;
  }
  private async view(tx: Transaction, store: ApplicationStore, url: string) {
    const app = store.application;
    if (!app) return conflict('LEGACY_STORE_WORKFLOW_REQUIRED');
    const { limit, cursor } = applicationQuery(url, 'beforeRevision');
    const rows = await tx.storeApplicationAudit.findMany({
      where: {
        storeId: store.id,
        ...(cursor ? { toRevision: { lt: cursor } } : {}),
      },
      orderBy: { toRevision: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      store: {
        id: store.id,
        name: store.name,
        description: store.description,
        status: store.status,
      },
      ownerId: store.sellerId,
      revision: app.revision,
      profile: {
        contactName: app.contactName,
        contactPhone: app.contactPhone,
        pickupAddress: app.pickupAddress,
        returnAddress: app.returnAddress,
      },
      grant: store.sellerGrant
        ? {
            adminId: store.sellerGrant.adminId,
            createdAt: store.sellerGrant.createdAt,
          }
        : null,
      history: page.map((a) => ({
        id: a.id.toString(),
        actorId: a.actorId,
        action: a.action,
        fromRevision: a.fromRevision,
        toRevision: a.toRevision,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      nextBeforeRevision: rows.length > limit ? page.at(-1)!.toRevision : null,
    };
  }
  async mine(actor: AuthenticatedUser, url: string) {
    this.gate();
    applicationQuery(url, 'beforeRevision');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await this.actor(tx, actor, 'OWNER');
        const store = await tx.store.findUnique({
          where: { sellerId: actor.userId },
          include,
        });
        // Explicit JSON envelope: Nest may serialize a bare null as an empty body.
        return { application: store ? await this.view(tx, store, url) : null };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async list(actor: AuthenticatedUser, url: string) {
    this.gate();
    const { limit, cursor } = applicationQuery(url);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await this.actor(tx, actor, 'ADMIN');
        const rows = await tx.store.findMany({
          where: {
            application: { isNot: null },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          include: { application: true },
          orderBy: { id: 'asc' },
          take: limit + 1,
        });
        const page = rows.slice(0, limit);
        return {
          items: page.map((s) => ({
            id: s.id,
            ownerId: s.sellerId,
            name: s.name,
            status: s.status,
            revision: s.application!.revision,
          })),
          nextAfterId: rows.length > limit ? page.at(-1)!.id : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(actor: AuthenticatedUser, id: number, url: string) {
    this.gate();
    positive(id);
    applicationQuery(url, 'beforeRevision');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await this.actor(tx, actor, 'ADMIN');
        const store = await tx.store.findUnique({ where: { id }, include });
        if (!store) throw new NotFoundException();
        return this.view(tx, store, url);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async execute(
    actor: AuthenticatedUser,
    scope: ApplicationScope,
    action: ApplicationAction,
    targetId: number,
    raw: unknown,
    reconcile = false,
  ) {
    this.gate();
    positive(targetId);
    validAction(scope, action);
    const command = reconcile ? null : applicationInput(scope, action, raw);
    const resolution = reconcile ? reconcileInput(raw) : null;
    const commandId = (command ?? resolution)!.commandId;
    const hash = command
      ? applicationHash(scope, action, targetId, command.body)
      : resolution!.requestHash;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
            // Find only an immutable ownership hint; recheck after User -> Store locks.
            const hint =
              scope === 'ADMIN'
                ? await tx.store.findUnique({
                    where: { id: targetId },
                    select: { sellerId: true },
                  })
                : null;
            const ownerId = scope === 'OWNER' ? actor.userId : hint?.sellerId;
            if (!ownerId) throw new NotFoundException();
            if (action === 'submit' && targetId !== actor.userId)
              throw new ForbiddenException();
            await tx.$queryRaw`SELECT id FROM users WHERE id IN (${actor.userId},${ownerId}) ORDER BY id FOR UPDATE`;
            await this.actor(tx, actor, scope);
            const owner = await tx.user.findUnique({ where: { id: ownerId } });
            if (!owner || !ownerRole(owner.role))
              throw new ForbiddenException();
            let store = await tx.store.findUnique({
              where:
                action === 'submit' ? { sellerId: ownerId } : { id: targetId },
              include,
            });
            if (store) {
              if (store.sellerId !== ownerId) throw new ForbiddenException();
              await tx.$queryRaw`SELECT id FROM stores WHERE id=${store.id} FOR UPDATE`;
              store = await tx.store.findUniqueOrThrow({
                where: { id: store.id },
                include,
              });
              if (store.sellerId !== ownerId)
                return conflict('STORE_OWNER_CHANGED');
            } else if (action !== 'submit') throw new NotFoundException();
            const prior = await tx.storeApplicationCommand.findUnique({
              where: {
                actorId_commandId: { actorId: actor.userId, commandId },
              },
            });
            if (prior) {
              if (
                prior.scope !== scope ||
                prior.action !== action ||
                prior.targetId !== targetId ||
                prior.requestHash !== hash
              )
                return conflict('STORE_COMMAND_ID_REUSED');
              if (prior.outcome === 'CLOSED' && !reconcile)
                return conflict('STORE_COMMAND_CLOSED');
              if (prior.outcome === 'APPLIED')
                await this.verifyReceipt(tx, prior);
              return {
                commandId,
                outcome: prior.outcome,
                receipt: prior.receipt,
              };
            }
            if (store && !store.application)
              return conflict('LEGACY_STORE_WORKFLOW_REQUIRED');
            const recent = await tx.storeApplicationCommand.count({
              where: {
                actorId: actor.userId,
                createdAt: { gte: new Date(Date.now() - 60000) },
              },
            });
            if (recent >= 30)
              throw new HttpException(
                { code: 'STORE_COMMAND_RATE_LIMIT' },
                429,
              );
            const metadata = {
              actorId: actor.userId,
              commandId,
              scope,
              action,
              targetId,
              requestHash: hash,
            };
            if (reconcile) {
              await tx.storeApplicationCommand.create({
                data: { ...metadata, outcome: 'CLOSED' },
              });
              return { commandId, outcome: 'CLOSED', receipt: null };
            }
            const body = command!.body;
            if (action === 'submit' && store)
              return conflict('STORE_ALREADY_EXISTS');
            const beforeStatus = store?.status ?? null,
              fromRevision = store?.application?.revision ?? 0;
            if (action !== 'submit' && body.expectedRevision !== fromRevision)
              return conflict('STORE_APPLICATION_REVISION_CONFLICT');
            if (fromRevision === 2147483647)
              return conflict('STORE_APPLICATION_VERSION_EXHAUSTED');
            if (
              scope === 'OWNER' &&
              store &&
              !['PENDING', 'REJECTED', 'ACTIVE'].includes(store.status)
            )
              throw new ForbiddenException({
                code: 'STORE_OWNER_WRITE_BLOCKED',
              });
            let nextStatus: StoreStatus = beforeStatus ?? 'PENDING';
            if (action === 'resubmit') {
              if (beforeStatus !== 'REJECTED')
                return conflict('STORE_APPLICATION_INVALID_TRANSITION');
              nextStatus = 'PENDING';
            }
            if (action === 'review') {
              nextStatus = body.status as StoreStatus;
              if (!(
                (beforeStatus === 'PENDING' &&
                  ['ACTIVE', 'REJECTED'].includes(nextStatus)) ||
                (beforeStatus === 'ACTIVE' && nextStatus === 'SUSPENDED') ||
                (beforeStatus === 'SUSPENDED' && nextStatus === 'ACTIVE')
              ))
                return conflict('STORE_APPLICATION_INVALID_TRANSITION');
              if (
                nextStatus === 'ACTIVE' &&
                (!owner.isActive ||
                  process.env.ACCOUNT_BUYER_ACCESS_ENABLED !== 'true')
              )
                return conflict('STORE_BUYER_ACCESS_OR_OWNER_NOT_READY');
              if (beforeStatus !== 'PENDING' && !store?.sellerGrant)
                return conflict('STORE_SELLER_GRANT_MISSING');
            }
            if (action === 'submit') {
              store = await tx.store.create({
                data: {
                  sellerId: ownerId,
                  name: body.name as string,
                  description: (body.description as string) || null,
                  status: 'PENDING',
                  application: { create: this.profile(body) },
                },
                include,
              });
            } else {
              await tx.storeApplication.update({
                where: { storeId: store!.id },
                data: {
                  revision: fromRevision + 1,
                  ...(action === 'edit' ? this.profile(body) : {}),
                },
              });
              await tx.store.update({
                where: { id: store!.id },
                data: {
                  status: nextStatus,
                  ...(action === 'edit'
                    ? {
                        name: body.name as string,
                        description: (body.description as string) || null,
                      }
                    : {}),
                },
              });
            }
            const storeId = store!.id;
            const audit = await tx.storeApplicationAudit.create({
              data: {
                storeId,
                actorId: actor.userId,
                action,
                fromRevision,
                toRevision: fromRevision + 1,
                fromStatus: beforeStatus,
                toStatus: nextStatus,
                reason: body.reason as string,
              },
            });
            if (action !== 'edit')
              await tx.storeStatusHistory.create({
                data: {
                  storeId,
                  actorId: actor.userId,
                  fromStatus: beforeStatus,
                  toStatus: nextStatus,
                  reason: body.reason as string,
                },
              });
            let grantCreated = false,
              reauthenticationRequired = false;
            if (
              action === 'review' &&
              beforeStatus === 'PENDING' &&
              nextStatus === 'ACTIVE'
            ) {
              if (store!.sellerGrant)
                return conflict('STORE_SELLER_GRANT_ALREADY_EXISTS');
              reauthenticationRequired = owner.role === 'USER';
              if (reauthenticationRequired) {
                if (owner.credentialVersion === 2147483647)
                  return conflict('STORE_CREDENTIAL_VERSION_EXHAUSTED');
                await tx.user.update({
                  where: { id: ownerId },
                  data: { role: 'SELLER', credentialVersion: { increment: 1 } },
                });
                await tx.refreshToken.updateMany({
                  where: { userId: ownerId, revokedAt: null },
                  data: { revokedAt: new Date() },
                });
                await tx.accountSecurityEvent.create({
                  data: {
                    userId: ownerId,
                    event: 'SELLER_GRANTED',
                    fromVersion: owner.credentialVersion,
                    toVersion: owner.credentialVersion + 1,
                  },
                });
              }
              await tx.storeSellerGrant.create({
                data: {
                  storeId,
                  ownerId,
                  adminId: actor.userId,
                  auditId: audit.id,
                  promoted: reauthenticationRequired,
                },
              });
              grantCreated = true;
            }
            if (
              beforeStatus !== nextStatus &&
              (beforeStatus === 'ACTIVE' || nextStatus === 'ACTIVE')
            )
              await this.search.enqueueStore(tx, storeId);
            const receipt = {
              storeId,
              ownerId,
              revision: fromRevision + 1,
              status: nextStatus,
              auditId: audit.id.toString(),
              grantCreated,
              reauthenticationRequired,
            };
            await tx.storeApplicationCommand.create({
              data: {
                ...metadata,
                outcome: 'APPLIED',
                storeId,
                auditId: audit.id,
                receipt,
              },
            });
            return { commandId, outcome: 'APPLIED', receipt };
          },
          { isolationLevel: 'Serializable', maxWait: 2000, timeout: 7000 },
        );
      } catch (error) {
        if (isAccountStatusConflict(error) && attempt < 2) {
          await waitForTransactionRetry(attempt);
          continue;
        }
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException({
          code: 'STORE_APPLICATION_RESULT_UNKNOWN',
          message:
            'Chưa rõ kết quả. Giữ mã yêu cầu và đối chiếu, không tự gửi lại.',
        });
      }
    }
    throw new ServiceUnavailableException({
      code: 'STORE_APPLICATION_RETRY_EXHAUSTED',
    });
  }
  private profile(body: ApplicationBody) {
    return {
      contactName: body.contactName as string,
      contactPhone: body.contactPhone as string,
      pickupAddress: body.pickupAddress as string,
      returnAddress: body.returnAddress as string,
    };
  }
  private async verifyReceipt(
    tx: Transaction,
    command: Prisma.StoreApplicationCommandGetPayload<object>,
  ) {
    const audit = command.auditId
      ? await tx.storeApplicationAudit.findUnique({
          where: { id: command.auditId },
        })
      : null;
    const grant = audit
      ? await tx.storeSellerGrant.findUnique({ where: { auditId: audit.id } })
      : null;
    const receipt = command.receipt as Record<string, Prisma.JsonValue> | null;
    if (
      !audit ||
      !receipt ||
      Array.isArray(receipt) ||
      audit.actorId !== command.actorId ||
      audit.action !== command.action ||
      audit.storeId !== command.storeId ||
      receipt.auditId !== audit.id.toString() ||
      receipt.storeId !== audit.storeId ||
      receipt.revision !== audit.toRevision ||
      receipt.status !== audit.toStatus ||
      receipt.grantCreated !== !!grant ||
      receipt.reauthenticationRequired !== (grant?.promoted ?? false)
    )
      throw new ServiceUnavailableException({
        code: 'STORE_COMMAND_RECEIPT_INVALID',
      });
    const store = await tx.store.findUnique({
      where: { id: audit.storeId },
      select: { sellerId: true },
    });
    if (
      receipt.ownerId !== store?.sellerId ||
      (command.action === 'submit' ? store?.sellerId : audit.storeId) !==
        command.targetId
    )
      throw new ServiceUnavailableException({
        code: 'STORE_COMMAND_RECEIPT_INVALID',
      });
  }
}
