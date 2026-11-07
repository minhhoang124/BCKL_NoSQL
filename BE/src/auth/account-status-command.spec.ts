import { randomUUID } from 'node:crypto';
import { accountStatusInput } from './account-status.input.js';
import {
  reasonDigest,
  statusIntent,
  statusIntentData,
} from './account-status-command.js';
import { accountHistoryQuery } from './account-status-recovery.service.js';

const body = {
  commandId: randomUUID(),
  expectedRevision: 1,
  isActive: false,
  reasonDigest: 'a'.repeat(64),
};
it('keeps exact legacy body compatibility; durable commands require canonical UUIDv4', () => {
  const input = {
    isActive: false,
    expectedRevision: 1,
    reason: 'QA account decision reason',
  };
  expect(accountStatusInput(input)).toEqual(input);
  expect(
    accountStatusInput({ ...input, commandId: body.commandId }).commandId,
  ).toBe(body.commandId);
  expect(() =>
    accountStatusInput({ ...input, commandId: 'not-uuid' }),
  ).toThrow();
});
it.each([
  null,
  {},
  { ...body, reason: 'private' },
  { ...body, commandId: 'x' },
  { ...body, expectedRevision: 0 },
  { ...body, isActive: 'false' },
  { ...body, reasonDigest: 'Z'.repeat(64) },
])('rejects malformed reconciliation input %#', (value) =>
  expect(() => statusIntent(value)).toThrow(),
);
it('hashes normalized reason and binds target, revision, desired state, digest', () => {
  expect(reasonDigest('  Nguye\u0302\u0303n yêu cầu khóa  ')).toBe(
    reasonDigest('Nguyễn yêu cầu khóa'),
  );
  const baseline = statusIntentData(1, 2, body).requestHash;
  for (const data of [
    statusIntentData(1, 3, body),
    statusIntentData(1, 2, { ...body, expectedRevision: 2 }),
    statusIntentData(1, 2, { ...body, isActive: true }),
    statusIntentData(1, 2, { ...body, reasonDigest: 'b'.repeat(64) }),
  ])
    expect(data.requestHash).not.toBe(baseline);
});
it.each([
  '?limit=0',
  '?limit=51',
  '?limit=1&limit=2',
  '?beforeRevision=01',
  '?q=x',
  '?beforeRevision[]=2',
  '?beforeRevision=2147483648',
])('rejects unsafe audit query %s', (query) =>
  expect(() => accountHistoryQuery('/' + query)).toThrow(),
);
it('default audit page includes maximum revision and explicit cursor is exclusive', () => {
  expect(accountHistoryQuery('/')).toEqual({ limit: 20 });
  expect(accountHistoryQuery('/?limit=1&beforeRevision=2147483647')).toEqual({
    limit: 1,
    beforeRevision: 2147483647,
  });
});
