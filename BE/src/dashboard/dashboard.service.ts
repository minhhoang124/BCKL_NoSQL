import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Prisma,
  OrderStatus,
  ProductModerationStatus,
  ProductSellerStatus,
  Role,
  StoreStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  bucketWindows,
  countNumber,
  parseDashboardQuery,
} from './dashboard-input.js';
import {
  financialOrders,
  financialSummary,
} from './dashboard-financial-query.js';
type Scope = 'ADMIN' | 'SELLER';
type RawMoney = {
  gross: string;
  refund: string;
  net: string;
  shipping: string;
  completed: string;
};
type Summary = {
  totals: RawMoney;
  buckets: (RawMoney & { period: string })[];
  pending: string;
  invalidCount: string;
};
const zeros = (keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, 0]));
function money(value: string, signed = false) {
  if (
    typeof value !== 'string' ||
    !(signed ? /^-?(0|[1-9][0-9]*)\.\d{2}$/ : /^(0|[1-9][0-9]*)\.\d{2}$/).test(
      value,
    )
  )
    throw new ServiceUnavailableException({
      code: 'DASHBOARD_INVALID_PROJECTION',
    });
  return value;
}
function monetary(row: RawMoney) {
  return {
    completedOrderCount: countNumber(row.completed),
    grossMerchandise: money(row.gross),
    effectiveRefundMerchandise: money(row.refund),
    netMerchandise: money(row.net, true),
    completedShipping: money(row.shipping),
  };
}
@Injectable()
export class DashboardService {
  constructor(private readonly db: PrismaService) {}
  private async read<T>(
    actor: AuthenticatedUser,
    scope: Scope,
    fn: (
      tx: Prisma.TransactionClient,
      store: { id: number; name: string; status: StoreStatus } | null,
      asOf: Date,
    ) => Promise<T>,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
          const current = await tx.user.findUnique({
            where: { id: actor.userId },
            select: { isActive: true, role: true, credentialVersion: true },
          });
          if (
            !current?.isActive ||
            current.credentialVersion !== actor.credentialVersion
          )
            throw new UnauthorizedException();
          if (current.role !== scope) throw new ForbiddenException();
          const store =
            scope === 'SELLER'
              ? await tx.store.findUnique({
                  where: { sellerId: actor.userId },
                  select: { id: true, name: true, status: true },
                })
              : null;
          if (scope === 'SELLER' && !store)
            throw new NotFoundException({ code: 'STORE_NOT_FOUND' });
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT CURRENT_TIMESTAMP::timestamp(3) AS now`;
          return fn(tx, store, clock!.now);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 15000,
          maxWait: 2000,
        },
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException({ code: 'DASHBOARD_UNAVAILABLE' });
    }
  }
  summary(actor: AuthenticatedUser, scope: Scope, url: string) {
    const range = parseDashboardQuery(url);
    return this.read(actor, scope, async (tx, store, asOf) => {
      const [row] = await tx.$queryRaw<{ data: Summary }[]>(
        financialSummary(store?.id ?? null, range, asOf),
      );
      if (!row?.data)
        throw new ServiceUnavailableException({
          code: 'DASHBOARD_INVALID_PROJECTION',
        });
      const groups = new Map(
        row.data.buckets.map((value) => [value.period, monetary(value)]),
      );
      const empty = monetary({
        gross: '0.00',
        refund: '0.00',
        net: '0.00',
        shipping: '0.00',
        completed: '0',
      });
      const orderCounts = zeros(Object.values(OrderStatus));
      const orderGroups = await tx.$queryRaw<
        { status: OrderStatus; n: string }[]
      >`SELECT status,count(*)::text AS n FROM orders WHERE ${store ? Prisma.sql`"storeId"=${store.id}` : Prisma.sql`TRUE`} AND "createdAt">=${range.from} AND "createdAt"<${range.to} GROUP BY status`;
      for (const value of orderGroups)
        orderCounts[value.status] = countNumber(value.n);
      const sellerCounts = zeros(Object.values(ProductSellerStatus)),
        moderationCounts = zeros(Object.values(ProductModerationStatus));
      const productGroups = await tx.$queryRaw<
        {
          sellerStatus: ProductSellerStatus;
          moderationStatus: ProductModerationStatus;
          n: string;
        }[]
      >`SELECT "sellerStatus","moderationStatus",count(*)::text AS n FROM products WHERE ${store ? Prisma.sql`"storeId"=${store.id}` : Prisma.sql`TRUE`} GROUP BY "sellerStatus","moderationStatus"`;
      for (const value of productGroups) {
        const n = countNumber(value.n);
        sellerCounts[value.sellerStatus] = countNumber(
          BigInt(sellerCounts[value.sellerStatus]!) + BigInt(n),
        );
        moderationCounts[value.moderationStatus] = countNumber(
          BigInt(moderationCounts[value.moderationStatus]!) + BigInt(n),
        );
      }
      let adminCounts: Record<string, unknown> = {};
      if (scope === 'ADMIN') {
        const users = Object.fromEntries(
          Object.values(Role).map((role) => [role, { active: 0, inactive: 0 }]),
        );
        for (const value of await tx.$queryRaw<
          { role: Role; isActive: boolean; n: string }[]
        >`SELECT role,"isActive",count(*)::text AS n FROM users GROUP BY role,"isActive"`)
          users[value.role][value.isActive ? 'active' : 'inactive'] =
            countNumber(value.n);
        const stores = zeros(Object.values(StoreStatus));
        for (const value of await tx.$queryRaw<
          { status: StoreStatus; n: string }[]
        >`SELECT status,count(*)::text AS n FROM stores GROUP BY status`)
          stores[value.status] = countNumber(value.n);
        adminCounts = {
          currentUserCountsByRoleAndActive: users,
          currentStoreCountsByStatus: stores,
        };
      }
      return {
        scope,
        store,
        asOf: asOf.toISOString(),
        timezone: range.timezone,
        currency: 'VND',
        range: {
          from: range.localFrom,
          to: range.localTo,
          fromUtc: range.from.toISOString(),
          toUtc: range.to.toISOString(),
        },
        bucket: range.bucket,
        totals: monetary(row.data.totals),
        buckets: bucketWindows(range).map((window) => ({
          ...window,
          ...(groups.get(window.periodStart) ?? empty),
        })),
        pendingRefundMerchandise: money(row.data.pending),
        pendingRefundScope: 'LIFETIME_AS_OF',
        dataQuality: {
          invalidSnapshotOrderCount: countNumber(row.data.invalidCount),
        },
        createdOrderCountsByCurrentStatus: orderCounts,
        currentProductCountsByStatus: {
          bySellerStatus: sellerCounts,
          byModerationStatus: moderationCounts,
        },
        ...adminCounts,
      };
    });
  }
  quality(actor: AuthenticatedUser, scope: Scope, url: string) {
    const range = parseDashboardQuery(url, true);
    return this.read(actor, scope, async (tx, store, asOf) => {
      const rows = await tx.$queryRaw<
        { id: number; storeId: number; issues: string[] }[]
      >(
        Prisma.sql`${financialOrders(store?.id ?? null, range, asOf)} SELECT id,"storeId",issues FROM financial_orders WHERE NOT valid ${range.beforeId ? Prisma.sql`AND id<${range.beforeId}` : Prisma.empty} ORDER BY id DESC LIMIT ${range.limit + 1}`,
      );
      return {
        scope,
        store,
        asOf: asOf.toISOString(),
        timezone: range.timezone,
        range: { from: range.localFrom, to: range.localTo },
        items: rows.slice(0, range.limit).map((value) => ({
          orderId: value.id,
          storeId: value.storeId,
          issues: value.issues,
        })),
        nextBeforeId:
          rows.length > range.limit ? rows[range.limit - 1]!.id : null,
      };
    });
  }
}
