import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  SearchReconciliationStatus,
  type AccountStatusCommand,
  type Prisma,
} from '@prisma/client';
import { accountCommandId } from './account-status.input.js';

export const reasonDigest = (reason: string) =>
  createHash('sha256')
    .update(reason.normalize('NFC').trim(), 'utf8')
    .digest('hex');
export type StatusIntent = {
  commandId: string;
  expectedRevision: number;
  isActive: boolean;
  reasonDigest: string;
};
export type StatusReceipt = {
  account: { id: number; isActive: boolean; statusRevision: number };
  auditId: string | null;
  searchReconciliation: {
    jobId: string;
    status: SearchReconciliationStatus;
  } | null;
};
export function statusIntent(raw: unknown): StatusIntent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('Mã đối chiếu không hợp lệ');
  const row = raw as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !==
      'commandId,expectedRevision,isActive,reasonDigest' ||
    !accountCommandId(row.commandId) ||
    !Number.isInteger(row.expectedRevision) ||
    Number(row.expectedRevision) < 1 ||
    Number(row.expectedRevision) > 2147483647 ||
    typeof row.isActive !== 'boolean' ||
    typeof row.reasonDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.reasonDigest)
  )
    throw new BadRequestException('Mã đối chiếu không hợp lệ');
  return {
    commandId: row.commandId,
    expectedRevision: row.expectedRevision as number,
    isActive: row.isActive,
    reasonDigest: row.reasonDigest,
  };
}
export function statusIntentData(
  actorId: number,
  targetId: number,
  input: StatusIntent,
) {
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        targetId,
        expectedRevision: input.expectedRevision,
        isActive: input.isActive,
        reasonDigest: input.reasonDigest,
      }),
      'utf8',
    )
    .digest('hex');
  return {
    actorId,
    commandId: input.commandId,
    targetId,
    expectedRevision: input.expectedRevision,
    desiredActive: input.isActive,
    reasonDigest: input.reasonDigest,
    requestHash,
  };
}
export function matchStatusIntent(
  row: AccountStatusCommand,
  data: ReturnType<typeof statusIntentData>,
) {
  if (
    row.actorId !== data.actorId ||
    row.commandId !== data.commandId ||
    row.targetId !== data.targetId ||
    row.requestHash !== data.requestHash ||
    row.expectedRevision !== data.expectedRevision ||
    row.desiredActive !== data.desiredActive ||
    row.reasonDigest !== data.reasonDigest
  )
    throw new ConflictException({
      statusCode: 409,
      code: 'ACCOUNT_COMMAND_MISMATCH',
    });
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (row: Record<string, unknown>, keys: string) =>
  Object.keys(row).sort().join(',') === keys;
export async function statusReceipt(
  tx: Prisma.TransactionClient,
  row: AccountStatusCommand,
): Promise<StatusReceipt | null> {
  const invalid = (): never => {
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'ACCOUNT_COMMAND_RECEIPT_INVALID',
    });
  };
  if (row.outcome === 'CLOSED') {
    if (row.receipt !== null || row.auditId !== null) invalid();
    return null;
  }
  const raw = row.receipt;
  if (
    !object(raw) ||
    !exact(raw, 'account,auditId,searchReconciliation') ||
    !object(raw.account) ||
    !exact(raw.account, 'id,isActive,statusRevision')
  )
    return invalid();
  const account = raw.account;
  if (
    account.id !== row.targetId ||
    account.isActive !== row.desiredActive ||
    account.statusRevision !==
      row.expectedRevision + (row.outcome === 'APPLIED' ? 1 : 0)
  )
    return invalid();
  if (row.outcome === 'NOOP') {
    if (
      raw.auditId !== null ||
      row.auditId !== null ||
      raw.searchReconciliation !== null
    )
      return invalid();
  } else if (row.outcome === 'APPLIED') {
    if (row.auditId === null || raw.auditId !== row.auditId.toString())
      return invalid();
    const audit = await tx.accountStatusHistory.findUnique({
      where: { id: row.auditId },
    });
    if (
      !audit ||
      audit.actorId !== row.actorId ||
      audit.targetId !== row.targetId ||
      audit.fromRevision !== row.expectedRevision ||
      audit.toRevision !== account.statusRevision ||
      audit.afterActive !== row.desiredActive ||
      reasonDigest(audit.reason) !== row.reasonDigest
    )
      return invalid();
  } else return invalid();
  const job = raw.searchReconciliation;
  if (
    job !== null &&
    (!object(job) ||
      !exact(job, 'jobId,status') ||
      typeof job.jobId !== 'string' ||
      !/^[1-9][0-9]*$/.test(job.jobId) ||
      !Object.values(SearchReconciliationStatus).includes(
        job.status as SearchReconciliationStatus,
      ))
  )
    return invalid();
  if (job !== null) {
    if (
      (job as Record<string, unknown>).jobId!.toString().length > 19 ||
      BigInt((job as Record<string, unknown>).jobId as string) >
        9223372036854775807n
    )
      return invalid();
    const storedJob = await tx.searchReconciliationJob.findUnique({
      where: { id: BigInt((job as Record<string, unknown>).jobId as string) },
      select: { scope: true, scopeId: true },
    });
    if (
      !storedJob ||
      storedJob.scope !== 'SELLER' ||
      storedJob.scopeId !== row.targetId
    )
      return invalid();
  }
  return {
    account: {
      id: row.targetId,
      isActive: row.desiredActive,
      statusRevision: Number(account.statusRevision),
    },
    auditId: raw.auditId as string | null,
    searchReconciliation:
      job === null
        ? null
        : {
            jobId: (job as Record<string, unknown>).jobId as string,
            status: (job as Record<string, unknown>)
              .status as SearchReconciliationStatus,
          },
  };
}
