/**
 * Schema-independent preparation for contract #65. NOT wired to controllers.
 * Callers must eventually read state/usage under the shared DB lock protocol,
 * then persist metadata/revision/audit/durable work atomically. These pure
 * checks are not a uniqueness constraint, authorization check or transaction.
 */
export const ATTRIBUTE_INT_MAX = 2_147_483_647;
const dataTypes = ['TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT'] as const;
export type AttributeDataType = (typeof dataTypes)[number];
export type DefinitionState = Readonly<{
  name: string;
  slug: string;
  dataType: AttributeDataType;
  isRequired: boolean;
  isFilterable: boolean;
  allowsCustom: boolean;
  sortOrder: number;
  isActive: boolean;
}>;
export type OptionState = Readonly<{
  value: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}>;
const validatedMutation = Symbol('validated-attribute-mutation');
type Mutation<T> = Readonly<{
  [validatedMutation]: true;
  entity: 'definition' | 'option';
  operation: 'create' | 'patch';
  values: Readonly<Partial<T>>;
  expectedRevision?: number;
  confirmPolicyChange: boolean;
  reason?: string;
}>;
export type DefinitionUsage = Readonly<{
  referencedProductCount: number;
  optionCount: number;
  activeOptionCount: number;
  categoryProductCount: number;
}>;
export class AttributePolicyError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(code);
    this.name = 'AttributePolicyError';
  }
}
const fail = (code = 'VALIDATION_ERROR', status: 400 | 409 = 400): never => {
  throw new AttributePolicyError(code, status);
};
const own = (body: object, key: string) => Object.hasOwn(body, key);
const fields = [
  'name',
  'slug',
  'dataType',
  'isRequired',
  'isFilterable',
  'allowsCustom',
  'sortOrder',
  'isActive',
] as const;
const optionFields = ['value', 'slug', 'sortOrder', 'isActive'] as const;

function integer(value: unknown, min: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > ATTRIBUTE_INT_MAX
  )
    fail();
  return value as number;
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') fail();
  const normalized = (value as string)
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ');
  const length = [...normalized].length;
  if (length < min || length > max) fail();
  return normalized;
}
/** Retains Vietnamese accents; DB normalized uniqueness must use the same rule. */
export function normalizedAttributeKey(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('vi-VN');
}
function slug(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 140 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  )
    fail();
  return value as string;
}
function reason(value: unknown): string {
  if (typeof value !== 'string') fail('ATTRIBUTE_POLICY_REASON_INVALID');
  if (
    [...(value as string)].some((char) => {
      const cp = char.codePointAt(0)!;
      return (cp < 32 && cp !== 9 && cp !== 10) || (cp >= 127 && cp <= 159);
    })
  )
    fail('ATTRIBUTE_POLICY_REASON_INVALID');
  const normalized = (value as string).normalize('NFC').trim();
  if ([...normalized].length < 10 || [...normalized].length > 500)
    fail('ATTRIBUTE_POLICY_REASON_INVALID');
  return normalized;
}

export function parseAttributeWrite(
  raw: unknown,
  entity: 'definition',
  operation: 'create' | 'patch',
): Mutation<DefinitionState>;
export function parseAttributeWrite(
  raw: unknown,
  entity: 'option',
  operation: 'create' | 'patch',
): Mutation<OptionState>;
export function parseAttributeWrite(
  raw: unknown,
  entity: 'definition' | 'option',
  operation: 'create' | 'patch',
): Mutation<DefinitionState & OptionState> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    fail();
  const body = raw as Record<string, unknown>;
  const metadata: readonly string[] =
    entity === 'definition' ? fields : optionFields;
  // Option create does not accept policy reason/confirmation in contract #65.
  const policyFields =
    entity === 'option' && operation === 'create'
      ? []
      : ['confirmPolicyChange', 'reason'];
  const revisionRequired = entity === 'option' || operation === 'patch';
  const allowed = [
    ...metadata,
    ...policyFields,
    ...(revisionRequired ? ['expectedRevision'] : []),
  ];
  if (
    Reflect.ownKeys(body).some(
      (key) => typeof key !== 'string' || !allowed.includes(key),
    )
  )
    fail();
  const values: Record<string, unknown> = {};
  for (const key of metadata) {
    if (!own(body, key)) continue;
    const value = body[key];
    if (key === 'name' || key === 'value') values[key] = text(value, 2, 120);
    else if (key === 'slug') values[key] = slug(value);
    else if (key === 'sortOrder') values[key] = integer(value, 0);
    else if (key === 'dataType') {
      if (!dataTypes.includes(value as AttributeDataType)) fail();
      values[key] = value;
    } else {
      if (typeof value !== 'boolean') fail();
      values[key] = value;
    }
  }
  if (operation === 'patch' && !Object.keys(values).length)
    fail('ATTRIBUTE_PATCH_EMPTY');
  if (operation === 'create') {
    const required =
      entity === 'definition'
        ? ['name', 'slug', 'dataType']
        : ['value', 'slug'];
    if (required.some((key) => !own(values, key))) fail();
    values.isActive ??= true;
    values.sortOrder ??= 0;
    if (entity === 'definition') {
      values.isRequired ??= false;
      values.isFilterable ??= false;
      values.allowsCustom ??= true;
    }
  }
  if (
    own(body, 'confirmPolicyChange') &&
    typeof body.confirmPolicyChange !== 'boolean'
  )
    fail();
  return Object.freeze({
    [validatedMutation]: true as const,
    entity,
    operation,
    values: Object.freeze(values),
    ...(revisionRequired
      ? { expectedRevision: integer(body.expectedRevision, 1) }
      : {}),
    confirmPolicyChange: body.confirmPolicyChange === true,
    ...(own(body, 'reason') ? { reason: reason(body.reason) } : {}),
  });
}

function confirm(mutation: { confirmPolicyChange: boolean; reason?: string }) {
  if (!mutation.confirmPolicyChange)
    fail('ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED', 409);
  if (mutation.reason === undefined) fail('ATTRIBUTE_POLICY_REASON_REQUIRED');
}
function revision(
  actual: number,
  expected: number | undefined,
  changed: boolean,
) {
  integer(actual, 1);
  if (actual !== expected) fail('ATTRIBUTE_REVISION_CONFLICT', 409);
  if (changed && actual === ATTRIBUTE_INT_MAX)
    fail('ATTRIBUTE_REVISION_EXHAUSTED', 409);
}
function validRequiredSelect(next: DefinitionState, activeOptions: number) {
  if (
    next.isActive &&
    next.isRequired &&
    next.dataType === 'SINGLE_SELECT' &&
    !next.allowsCustom &&
    activeOptions === 0
  )
    fail('ATTRIBUTE_REQUIRED_OPTIONS_EMPTY', 409);
}
function count(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid canonical usage count');
}

function assertMutation(
  input: Mutation<unknown>,
  entity: 'definition' | 'option',
  operation: 'create' | 'patch',
) {
  if (
    input[validatedMutation] !== true ||
    input.entity !== entity ||
    input.operation !== operation
  )
    throw new Error('Attribute planner requires matching parsed mutation');
}

export function planDefinitionCreate(
  input: Mutation<DefinitionState>,
  categoryProductCount: number,
) {
  assertMutation(input, 'definition', 'create');
  count(categoryProductCount);
  // Input must come from parseAttributeWrite(create), not the HTTP body directly.
  const next = input.values as DefinitionState;
  validRequiredSelect(next, 0);
  if (next.isRequired && next.isActive) confirm(input);
  return Object.freeze({
    next,
    changed: true,
    searchMayBeAffected:
      next.isRequired && next.isActive && categoryProductCount > 0,
  });
}

export function planDefinitionPatch(
  before: DefinitionState & { revision: number },
  input: Mutation<DefinitionState>,
  usage: DefinitionUsage,
) {
  assertMutation(input, 'definition', 'patch');
  Object.values(usage).forEach(count);
  const changedFields = fields.filter(
    (key) => own(input.values, key) && before[key] !== input.values[key],
  );
  revision(before.revision, input.expectedRevision, changedFields.length > 0);
  const next = Object.freeze(
    Object.fromEntries(
      fields.map((key) => [
        key,
        own(input.values, key) ? input.values[key] : before[key],
      ]),
    ),
  ) as DefinitionState;
  if (changedFields.includes('dataType')) {
    if (usage.referencedProductCount > 0) fail('ATTRIBUTE_TYPE_IN_USE', 409);
    if (before.dataType === 'SINGLE_SELECT' && usage.optionCount > 0)
      fail('ATTRIBUTE_OPTIONS_EXIST', 409);
  }
  if (changedFields.includes('slug') && usage.referencedProductCount > 0)
    fail('ATTRIBUTE_SLUG_IN_USE', 409);
  // No-op must not be blocked by a pre-existing invalid configuration.
  if (
    changedFields.some((key) =>
      ['dataType', 'isActive', 'isRequired', 'allowsCustom'].includes(key),
    )
  )
    validRequiredSelect(next, usage.activeOptionCount);
  const policyChanged = changedFields.some((key) =>
    ['isRequired', 'isActive', 'allowsCustom'].includes(key),
  );
  if (policyChanged) confirm(input);
  const payloadChanged = changedFields.some((key) =>
    ['name', 'slug', 'dataType'].includes(key),
  );
  return Object.freeze({
    next,
    changed: changedFields.length > 0,
    // This only requests a coarse durable job. Worker must still skip unchanged Products.
    searchMayBeAffected:
      (policyChanged && usage.categoryProductCount > 0) ||
      (payloadChanged && usage.referencedProductCount > 0),
  });
}

export function planOptionCreate(
  definition: DefinitionState & { revision: number },
  input: Mutation<OptionState>,
) {
  assertMutation(input, 'option', 'create');
  revision(definition.revision, input.expectedRevision, true);
  if (definition.dataType !== 'SINGLE_SELECT')
    fail('ATTRIBUTE_OPTIONS_NOT_SUPPORTED');
  return Object.freeze({
    next: input.values as OptionState,
    changed: true,
    searchMayBeAffected: false,
  });
}

export function planOptionPatch(
  definition: DefinitionState & { revision: number },
  before: OptionState,
  input: Mutation<OptionState>,
  referencedProductCount: number,
) {
  assertMutation(input, 'option', 'patch');
  count(referencedProductCount);
  const changedFields = optionFields.filter(
    (key) => own(input.values, key) && before[key] !== input.values[key],
  );
  revision(
    definition.revision,
    input.expectedRevision,
    changedFields.length > 0,
  );
  if (definition.dataType !== 'SINGLE_SELECT')
    fail('ATTRIBUTE_OPTIONS_NOT_SUPPORTED');
  if (
    referencedProductCount > 0 &&
    changedFields.some((key) => key === 'value' || key === 'slug')
  )
    fail('ATTRIBUTE_OPTION_IN_USE', 409);
  const activeChanged = changedFields.includes('isActive');
  const next = Object.freeze(
    Object.fromEntries(
      optionFields.map((key) => [
        key,
        own(input.values, key) ? input.values[key] : before[key],
      ]),
    ),
  ) as OptionState;
  // Contract AT16 permits disabling a used option (even the last one) with
  // consent: affected required listings then fail the canonical public rule.
  if (activeChanged && referencedProductCount > 0) confirm(input);
  return Object.freeze({
    next,
    changed: changedFields.length > 0,
    searchMayBeAffected: activeChanged && referencedProductCount > 0,
  });
}
