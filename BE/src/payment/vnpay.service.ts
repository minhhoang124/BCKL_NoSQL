import {
  Injectable,
  HttpException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type PaymentTransaction } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { credentialMatches } from '../auth/credential-version.js';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { vnpayConfig } from './vnpay-config.js';
import { vnpayAmount, notificationDigest, vnpayPaidAt } from './vnpay-input.js';
import { VnpayGateway } from './vnpay-gateway.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
type Tx = Prisma.TransactionClient;
type Outcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVIEW_REQUIRED';
const ack = (RspCode: string, Message: string) => ({ RspCode, Message });
function retryable(e: unknown, depth = 0): boolean {
  if (isTransactionConflict(e)) return true;
  if (!e || typeof e !== 'object' || depth > 4) return false;
  const x = e as Record<string, unknown>;
  if (
    ['40001', '40P01', 'P2002', 'P2034'].includes(
      String(x.code ?? x.originalCode ?? ''),
    )
  )
    return true;
  return ['cause', 'meta', 'driverAdapterError'].some((k) =>
    retryable(x[k], depth + 1),
  );
}
@Injectable()
export class VnpayService {
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: VnpayGateway,
  ) {}
  private async transaction<T>(work: (tx: Tx) => Promise<T>) {
    for (let n = 0; n < 3; n++)
      try {
        return await this.db.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: 3000,
          timeout: 7000,
        });
      } catch (e) {
        if (retryable(e) && n < 2) {
          await waitForTransactionRetry(n);
          continue;
        }
        if (e instanceof HttpException) throw e;
        throw new ServiceUnavailableException({ code: 'VNPAY_UNCONFIRMED' });
      }
    throw new ServiceUnavailableException();
  }
  private async now(tx: Tx) {
    return (
      await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp()::timestamp(3) now`
    )[0]!.now;
  }
  private async actor(tx: Tx, a: AuthenticatedUser, lock = false) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM users WHERE id=${a.userId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: a.userId } });
    if (
      !u?.isActive ||
      !credentialMatches(a.credentialVersion, u.credentialVersion)
    )
      throw new UnauthorizedException();
    if (!canActAsBuyer(u.role)) throw new ForbiddenException();
  }
  private async own(
    tx: Tx,
    a: AuthenticatedUser,
    orderId: number,
    lock = false,
  ) {
    await this.actor(tx, a, lock);
    const o = await tx.order.findFirst({
      where: { id: orderId, buyerId: a.userId },
      select: { id: true },
    });
    if (!o) throw new NotFoundException();
    if (lock)
      await tx.$queryRaw`SELECT id FROM orders WHERE id=${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: { include: { transaction: true } } },
    });
    if (!order.payment || order.payment.provider !== 'VNPAY')
      throw new ConflictException({ code: 'VNPAY_PAYMENT_MISMATCH' });
    if (lock)
      await tx.$queryRaw`SELECT id FROM payments WHERE id=${order.payment.id} FOR UPDATE`;
    return order;
  }
  private view(
    row: PaymentTransaction | null,
    now: Date,
    orderId: number,
    paymentStatus: string,
    orderStatus: string,
  ) {
    return {
      orderId,
      provider: 'VNPAY' as const,
      mode: 'SANDBOX' as const,
      paymentStatus,
      canStart:
        process.env.VNPAY_SANDBOX_ENABLED === 'true' &&
        !row &&
        orderStatus === 'PENDING_CONFIRMATION' &&
        paymentStatus === 'UNPAID',
      transaction: row
        ? {
            reference: row.reference,
            status: row.status,
            amount: row.amount.toFixed(2),
            currency: row.currency,
            expiresAt: row.expiresAt.toISOString(),
            expired: now >= row.expiresAt,
            needsReview: row.status === 'REVIEW_REQUIRED',
            paymentUrl:
              orderStatus === 'PENDING_CONFIRMATION' &&
              row.status === 'PENDING' &&
              paymentStatus === 'PENDING' &&
              now < row.expiresAt
                ? this.gateway.build(row)
                : null,
          }
        : null,
    };
  }
  async read(a: AuthenticatedUser, orderId: number) {
    vnpayConfig(false);
    return this.transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const o = await this.own(tx, a, orderId);
      return this.view(
        o.payment!.transaction,
        await this.now(tx),
        orderId,
        o.payment!.status,
        o.status,
      );
    });
  }
  async start(a: AuthenticatedUser, orderId: number, ipAddress: string) {
    const config = vnpayConfig();
    return this.transaction(async (tx) => {
      const o = await this.own(tx, a, orderId, true),
        p = o.payment!,
        now = await this.now(tx);
      if (p.transaction)
        return this.view(p.transaction, now, orderId, p.status, o.status);
      if (
        o.status !== 'PENDING_CONFIRMATION' ||
        p.status !== 'UNPAID' ||
        p.paidAt ||
        p.currency !== 'VND' ||
        !p.amount.eq(o.total)
      )
        throw new ConflictException({ code: 'VNPAY_PAYMENT_STATE_CONFLICT' });
      vnpayAmount(p.amount.toFixed(2));
      const row = await tx.paymentTransaction.create({
        data: {
          id: randomUUID(),
          paymentId: p.id,
          reference: randomUUID().replaceAll('-', ''),
          tmnCode: config.tmnCode,
          amount: p.amount,
          ipAddress,
          returnUrl: config.returnUrl,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 900000),
        },
      });
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'PENDING' },
      });
      return this.view(row, now, orderId, 'PENDING', o.status);
    });
  }
  async ipn(q: Record<string, string>) {
    const c = vnpayConfig(false);
    if (q.vnp_TmnCode !== c.tmnCode || !this.gateway.verified(q))
      return ack('97', 'Invalid signature');
    try {
      return await this.transaction(async (tx) => {
        const ref = await tx.paymentTransaction.findUnique({
          where: { reference: q.vnp_TxnRef! },
          include: { payment: { select: { orderId: true } } },
        });
        if (!ref) return ack('01', 'Order not found');
        await tx.$queryRaw`SELECT id FROM orders WHERE id=${ref.payment.orderId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM payments WHERE id=${ref.paymentId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM payment_transactions WHERE id=${ref.id}::uuid FOR UPDATE`;
        const row = await tx.paymentTransaction.findUniqueOrThrow({
            where: { id: ref.id },
            include: { payment: { include: { order: true } } },
          }),
          p = row.payment,
          o = p.order,
          now = await this.now(tx);
        if (
          row.tmnCode !== q.vnp_TmnCode ||
          p.provider !== 'VNPAY' ||
          p.currency !== 'VND' ||
          !p.amount.eq(row.amount) ||
          !p.amount.eq(o.total) ||
          vnpayAmount(row.amount.toFixed(2)).minor !== q.vnp_Amount
        )
          return ack('04', 'Invalid amount');
        const digest = notificationDigest(q);
        if (await tx.paymentNotification.findUnique({ where: { digest } }))
          return ack('02', 'Order already confirmed');
        const response = q.vnp_ResponseCode!,
          state = q.vnp_TransactionStatus!,
          number = q.vnp_TransactionNo!,
          paidAt = vnpayPaidAt(q.vnp_PayDate);
        const cleanSuccess =
          response === '00' &&
          state === '00' &&
          /^[1-9][0-9]{0,14}$/.test(number) &&
          paidAt !== null &&
          paidAt.getTime() >=
            Math.floor(row.createdAt.getTime() / 1000) * 1000 &&
          paidAt <= row.expiresAt &&
          paidAt.getTime() <= now.getTime() + 120000;
        let outcome: Outcome = cleanSuccess
          ? 'SUCCEEDED'
          : response === '24'
            ? 'CANCELLED'
            : 'FAILED';
        const ambiguous =
          ![
            '09',
            '10',
            '11',
            '12',
            '13',
            '24',
            '51',
            '65',
            '75',
            '79',
            '99',
          ].includes(response) ||
          !['01', '02'].includes(state) ||
          response === '00' ||
          response === '07' ||
          ['00', '04', '05', '06', '07', '09'].includes(state);
        if (!cleanSuccess && ambiguous) outcome = 'REVIEW_REQUIRED';
        const sameTerminal =
          row.status !== 'PENDING' &&
          row.status === outcome &&
          row.responseCode === response &&
          row.transactionStatus === state &&
          (outcome !== 'SUCCEEDED' || row.providerTransactionNo === number);
        if (
          row.status === 'REVIEW_REQUIRED' ||
          (row.status !== 'PENDING' && !sameTerminal) ||
          (o.status === 'CANCELLED' && (cleanSuccess || ambiguous)) ||
          (!sameTerminal &&
            o.status !== 'CANCELLED' &&
            !['UNPAID', 'PENDING'].includes(p.status))
        )
          outcome = 'REVIEW_REQUIRED';
        const collision =
          cleanSuccess &&
          (await tx.paymentTransaction.findFirst({
            where: {
              provider: 'VNPAY',
              providerTransactionNo: number,
              id: { not: row.id },
            },
          }));
        if (collision) outcome = 'REVIEW_REQUIRED';
        await tx.paymentNotification.create({
          data: {
            transactionId: row.id,
            digest,
            responseCode: response,
            transactionStatus: state,
            providerTransactionNo: number,
            outcome,
            receivedAt: now,
          },
        });
        if (!sameTerminal && row.status !== 'REVIEW_REQUIRED') {
          await tx.paymentTransaction.update({
            where: { id: row.id },
            data: {
              status: outcome,
              settledAt: now,
              responseCode: response,
              transactionStatus: state,
              ...(cleanSuccess &&
              !collision &&
              row.providerTransactionNo === null
                ? { providerTransactionNo: number }
                : {}),
            },
          });
          if (outcome === 'SUCCEEDED')
            await tx.payment.update({
              where: { id: p.id },
              data: { status: 'PAID', paidAt: paidAt! },
            });
          else if (outcome === 'REVIEW_REQUIRED')
            await tx.payment.update({
              where: { id: p.id },
              data: { status: 'REVIEW_REQUIRED' },
            });
          else if (o.status !== 'CANCELLED')
            await tx.payment.update({
              where: { id: p.id },
              data: {
                status: outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
              },
            });
        }
        return ack(
          sameTerminal ? '02' : '00',
          sameTerminal ? 'Order already confirmed' : 'Confirm Success',
        );
      });
    } catch {
      return ack('99', 'Unconfirmed transaction');
    }
  }
  async returnOrder(q: Record<string, string>) {
    const c = vnpayConfig(false);
    if (q.vnp_TmnCode !== c.tmnCode || !this.gateway.verified(q))
      throw new ForbiddenException({ code: 'VNPAY_INVALID_SIGNATURE' });
    return this.transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const row = await tx.paymentTransaction.findUnique({
        where: { reference: q.vnp_TxnRef! },
        include: { payment: { select: { orderId: true } } },
      });
      if (
        !row ||
        row.tmnCode !== q.vnp_TmnCode ||
        vnpayAmount(row.amount.toFixed(2)).minor !== q.vnp_Amount
      )
        throw new NotFoundException();
      return (
        c.webOrigin +
        '/account/orders/' +
        row.payment.orderId +
        '?paymentReturn=received'
      );
    });
  }
}
