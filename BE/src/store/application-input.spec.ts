import { randomUUID, createHash } from 'node:crypto';
import {
  applicationHash,
  applicationInput,
  applicationQuery,
  reconcileInput,
} from './application-input.js';
const profile = {
  name: 'QA Store',
  description: '',
  contactName: 'QA Owner',
  contactPhone: '+84901234567',
  pickupAddress: 'Synthetic pickup address 01',
  returnAddress: 'Synthetic return address 01',
};
const submit = () => ({
  commandId: randomUUID(),
  confirmed: true,
  reason: 'QA explicitly submits Store profile',
  ...profile,
});
describe('Store onboarding canonical boundary', () => {
  it('normalizes NFC and trim before the stable fingerprint, excludes account role/cv', () => {
    const body = { ...submit(), name: '  Nguye\u0302\u0303n Store  ' };
    const result = applicationInput('OWNER', 'submit', body);
    expect(result.body.name).toBe('Nguyễn Store');
    expect(applicationHash('OWNER', 'submit', 7, result.body)).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            schemaVersion: 1,
            scope: 'OWNER',
            action: 'submit',
            targetId: 7,
            body: result.body,
          }),
        )
        .digest('hex'),
    );
    expect(result.body).not.toHaveProperty('role');
    expect(result.body).not.toHaveProperty('cv');
  });
  it.each([
    { confirmed: false },
    { confirmed: 'true' },
    { reason: 'short' },
    { reason: 'reason\nwith control' },
    { name: '\ud800' },
    { contactPhone: '0901 234 567' },
    { contactPhone: 901234567 },
    { pickupAddress: 'short' },
    { returnAddress: 'x'.repeat(501) },
    { contactName: 'a' },
    { description: 'x'.repeat(1001) },
    { sellerId: 22 },
    { role: 'ADMIN' },
    { extra: true },
    { commandId: 'not-a-uuid' },
  ])('rejects malformed profile or extra fields %j', (patch) =>
    expect(() =>
      applicationInput('OWNER', 'submit', { ...submit(), ...patch }),
    ).toThrow(),
  );
  it.each([0, -1, 1.5, '2', 2147483648, NaN])(
    'rejects revision %s',
    (expectedRevision) =>
      expect(() =>
        applicationInput('ADMIN', 'review', {
          commandId: randomUUID(),
          confirmed: true,
          reason: 'QA explicit decision',
          expectedRevision,
          status: 'ACTIVE',
        }),
      ).toThrow(),
  );
  it.each([['ACTIVE'], { value: 'ACTIVE' }, null, 'CLOSED', 'PENDING'])(
    'rejects nonliteral/disallowed review status %j',
    (status) =>
      expect(() =>
        applicationInput('ADMIN', 'review', {
          commandId: randomUUID(),
          confirmed: true,
          reason: 'QA explicit decision',
          expectedRevision: 1,
          status,
        }),
      ).toThrow(),
  );
  it('separates scope, action and target in hashes', () => {
    const { body } = applicationInput('OWNER', 'submit', submit());
    const hash = applicationHash('OWNER', 'submit', 7, body);
    expect(applicationHash('OWNER', 'edit', 7, body)).not.toBe(hash);
    expect(applicationHash('ADMIN', 'review', 7, body)).not.toBe(hash);
    expect(applicationHash('OWNER', 'submit', 8, body)).not.toBe(hash);
  });
  it.each([
    'limit=0',
    'limit=01',
    'limit=51',
    'afterId=2147483648',
    'afterId=2&afterId=3',
    'limit[]=1',
    'passwordHash=x',
    'afterId=1.0',
  ])('rejects query %s', (q) =>
    expect(() => applicationQuery('/admin/store-applications?' + q)).toThrow(),
  );
  it('parses bounded history and list cursors separately', () => {
    expect(
      applicationQuery('/admin/store-applications?limit=50&afterId=3'),
    ).toEqual({ limit: 50, cursor: 3 });
    expect(
      applicationQuery(
        '/account/store-application?beforeRevision=8',
        'beforeRevision',
      ),
    ).toEqual({ limit: 20, cursor: 8 });
    expect(() =>
      applicationQuery(
        '/account/store-application?afterId=2',
        'beforeRevision',
      ),
    ).toThrow();
  });
  it('requires explicit reconcile consent and lowercase SHA256, never accepts body profile', () => {
    const input = {
      commandId: randomUUID(),
      requestHash: 'a'.repeat(64),
      confirmed: true,
    };
    expect(reconcileInput(input)).toEqual({
      commandId: input.commandId,
      requestHash: input.requestHash,
    });
    for (const patch of [
      { confirmed: false },
      { requestHash: 'A'.repeat(64) },
      { reason: 'not accepted' },
    ])
      expect(() => reconcileInput({ ...input, ...patch })).toThrow();
  });
});
