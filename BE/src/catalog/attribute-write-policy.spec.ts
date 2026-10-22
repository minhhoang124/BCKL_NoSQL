import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_INT_MAX,
  AttributePolicyError,
  normalizedAttributeKey,
  parseAttributeWrite,
  planDefinitionCreate,
  planDefinitionPatch,
  planOptionCreate,
  planOptionPatch,
  type DefinitionState,
} from './attribute-write-policy.js';

const definition = Object.freeze({
  name: 'Kết nối',
  slug: 'ket-noi',
  dataType: 'SINGLE_SELECT' as const,
  isRequired: false,
  isFilterable: false,
  allowsCustom: true,
  sortOrder: 0,
  isActive: true,
  revision: 3,
});
const option = Object.freeze({
  value: 'Đen',
  slug: 'den',
  sortOrder: 0,
  isActive: true,
});
const usage = {
  referencedProductCount: 0,
  optionCount: 0,
  activeOptionCount: 0,
  categoryProductCount: 0,
};
const policy = {
  confirmPolicyChange: true,
  reason: '  Cập nhật quy tắc ngành hàng  ',
};
const create = (body = {}) =>
  parseAttributeWrite(
    { name: 'Kết nối', slug: 'ket-noi', dataType: 'TEXT', ...body },
    'definition',
    'create',
  );
const patch = (body = {}) =>
  parseAttributeWrite({ expectedRevision: 3, ...body }, 'definition', 'patch');
const optionPatch = (body = {}) =>
  parseAttributeWrite({ expectedRevision: 3, ...body }, 'option', 'patch');
function error(run: () => unknown, code: string, status = 400) {
  try {
    run();
    throw new Error('Expected policy rejection');
  } catch (caught) {
    expect(caught).toBeInstanceOf(AttributePolicyError);
    expect(caught).toMatchObject({ code, status });
  }
}

describe('Attribute write policy — unmounted contract preparation', () => {
  it('normalizes NFC/case/whitespace while preserving Vietnamese accents', () => {
    expect(normalizedAttributeKey('  MA\u0300U\t SẮC  ')).toBe('màu sắc');
    expect(normalizedAttributeKey('màu')).not.toBe(
      normalizedAttributeKey('mau'),
    );
  });
  it('normalizes display text but does not lowercase display or silently rewrite slug', () => {
    expect(create({ name: '  KÊ\u0301T\t nối  ' }).values.name).toBe('KẾT nối');
    error(() => create({ slug: ' ket-noi ' }), 'VALIDATION_ERROR');
  });
  it('uses compatible create defaults and does not mutate input', () => {
    const raw = Object.freeze({ name: 'Tên', slug: 'ten', dataType: 'TEXT' });
    const parsed = parseAttributeWrite(raw, 'definition', 'create');
    expect(parsed.values).toEqual({
      ...raw,
      isRequired: false,
      isFilterable: false,
      allowsCustom: true,
      sortOrder: 0,
      isActive: true,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.values)).toBe(true);
    expect(raw).not.toHaveProperty('isActive');
  });
  it.each([null, [], 'body', 1, true, new Date()])(
    'rejects non-record body: %j',
    (raw) => {
      error(
        () => parseAttributeWrite(raw, 'definition', 'create'),
        'VALIDATION_ERROR',
      );
    },
  );
  it.each([
    'actorId',
    'categoryId',
    'attributeDefinitionId',
    'correlationId',
    'createdAt',
    'revision',
    '__proto__',
  ])('rejects client override %s', (key) => {
    error(() => create({ [key]: 1 }), 'VALIDATION_ERROR');
  });
  it.each([null, undefined, 0, 'true', [], {}])(
    'does not coerce optional boolean %j',
    (value) => {
      error(() => create({ isRequired: value }), 'VALIDATION_ERROR');
    },
  );
  it.each([-1, 0.5, '0', null, Infinity, NaN, ATTRIBUTE_INT_MAX + 1])(
    'rejects invalid order %j',
    (value) => {
      error(() => create({ sortOrder: value }), 'VALIDATION_ERROR');
    },
  );
  it.each([0, -1, 0.5, '3', null, undefined, Infinity, ATTRIBUTE_INT_MAX + 1])(
    'rejects invalid revision %j',
    (value) => {
      error(
        () => patch({ name: 'Tên', expectedRevision: value }),
        'VALIDATION_ERROR',
      );
    },
  );
  it.each(['x', 'UPPER', 'two--parts', '-name', 'name-', 'a'.repeat(141)])(
    'rejects invalid slug %s',
    (value) => {
      error(() => create({ slug: value }), 'VALIDATION_ERROR');
    },
  );
  it.each(['', 'x', 'a'.repeat(121)])('rejects out-of-range label', (value) => {
    error(() => create({ name: value }), 'VALIDATION_ERROR');
  });
  it('measures labels and reasons in code points, not UTF-16 units', () => {
    expect(create({ name: '😀'.repeat(120) }).values.name).toHaveLength(240);
    expect(
      patch({ name: 'Tên', reason: '😀'.repeat(500) }).reason,
    ).toHaveLength(1000);
  });
  it.each(['MULTI_SELECT', 'text', null, 1])(
    'rejects unsupported type %j',
    (dataType) => {
      error(() => create({ dataType }), 'VALIDATION_ERROR');
    },
  );
  it.each(['name', 'slug', 'dataType'])(
    'requires create field %s',
    (missing) => {
      const raw: Record<string, unknown> = {
        name: 'Tên',
        slug: 'ten',
        dataType: 'TEXT',
      };
      delete raw[missing];
      error(
        () => parseAttributeWrite(raw, 'definition', 'create'),
        'VALIDATION_ERROR',
      );
    },
  );
  it('rejects policy-only/empty PATCH and revision on create', () => {
    error(() => patch(), 'ATTRIBUTE_PATCH_EMPTY');
    error(() => patch(policy), 'ATTRIBUTE_PATCH_EMPTY');
    error(() => create({ expectedRevision: 3 }), 'VALIDATION_ERROR');
  });
  it.each([
    null,
    '',
    ' '.repeat(20),
    'short',
    'x'.repeat(501),
    '\u000bValid reason long',
    'Valid reason\u007f',
    'Valid\u0085reason long',
  ])('rejects bad reason even on harmless edit', (value) => {
    error(
      () => patch({ sortOrder: 1, reason: value }),
      'ATTRIBUTE_POLICY_REASON_INVALID',
    );
  });
  it('keeps allowed newline/tab, trims and NFC-normalizes reason', () => {
    expect(
      patch({ name: 'Tên', reason: '  Ly\u0301 do\n\tđổi cấu hình  ' }).reason,
    ).toBe('Lý do\n\tđổi cấu hình');
  });
  it('rejects malformed confirmation instead of coercion', () => {
    error(
      () => patch({ isRequired: true, confirmPolicyChange: 'true' }),
      'VALIDATION_ERROR',
    );
  });
  it('requires confirmation AND reason for active required create even with zero Products', () => {
    error(
      () => planDefinitionCreate(create({ isRequired: true }), 0),
      'ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED',
      409,
    );
    error(
      () =>
        planDefinitionCreate(
          create({ isRequired: true, confirmPolicyChange: true }),
          0,
        ),
      'ATTRIBUTE_POLICY_REASON_REQUIRED',
    );
    expect(
      planDefinitionCreate(create({ isRequired: true, ...policy }), 1)
        .searchMayBeAffected,
    ).toBe(true);
    expect(
      planDefinitionCreate(create({ isRequired: true, ...policy }), 0)
        .searchMayBeAffected,
    ).toBe(false);
  });
  it('does not enqueue optional or inactive-required create', () => {
    expect(planDefinitionCreate(create(), 20).searchMayBeAffected).toBe(false);
    expect(
      planDefinitionCreate(create({ isRequired: true, isActive: false }), 20)
        .searchMayBeAffected,
    ).toBe(false);
  });
  it('rejects active required SELECT without active options/custom, but allows inactive setup', () => {
    error(
      () =>
        planDefinitionCreate(
          create({
            dataType: 'SINGLE_SELECT',
            isRequired: true,
            allowsCustom: false,
            ...policy,
          }),
          0,
        ),
      'ATTRIBUTE_REQUIRED_OPTIONS_EMPTY',
      409,
    );
    expect(
      planDefinitionCreate(
        create({
          dataType: 'SINGLE_SELECT',
          isRequired: true,
          allowsCustom: false,
          isActive: false,
        }),
        0,
      ).next.isActive,
    ).toBe(false);
  });
  it('checks stale revision before no-op or usage gates', () => {
    error(
      () =>
        planDefinitionPatch(
          definition,
          patch({ expectedRevision: 2, name: definition.name }),
          usage,
        ),
      'ATTRIBUTE_REVISION_CONFLICT',
      409,
    );
  });
  it('keeps no-op unchanged, including max revision and legacy invalid config', () => {
    const before = {
      ...definition,
      revision: ATTRIBUTE_INT_MAX,
      isRequired: true,
      allowsCustom: false,
    };
    const plan = planDefinitionPatch(
      before,
      patch({ expectedRevision: ATTRIBUTE_INT_MAX, name: before.name }),
      usage,
    );
    expect(plan).toMatchObject({ changed: false, searchMayBeAffected: false });
    expect(plan.next).not.toHaveProperty('revision');
  });
  it('rejects revision exhaustion only for actual mutations', () => {
    error(
      () =>
        planDefinitionPatch(
          { ...definition, revision: ATTRIBUTE_INT_MAX },
          patch({ expectedRevision: ATTRIBUTE_INT_MAX, sortOrder: 1 }),
          usage,
        ),
      'ATTRIBUTE_REVISION_EXHAUSTED',
      409,
    );
  });
  it('rejects type/slug edits with ANY ProductValue, not only public ones', () => {
    const used = { ...usage, referencedProductCount: 1 };
    error(
      () =>
        planDefinitionPatch(definition, patch({ dataType: 'NUMBER' }), used),
      'ATTRIBUTE_TYPE_IN_USE',
      409,
    );
    error(
      () =>
        planDefinitionPatch(definition, patch({ slug: 'ket-noi-moi' }), used),
      'ATTRIBUTE_SLUG_IN_USE',
      409,
    );
  });
  it('rejects leaving SELECT while inactive options still exist', () => {
    error(
      () =>
        planDefinitionPatch(definition, patch({ dataType: 'TEXT' }), {
          ...usage,
          optionCount: 1,
        }),
      'ATTRIBUTE_OPTIONS_EXIST',
      409,
    );
  });
  it('allows unused type change without converting any ProductValue', () => {
    const plan = planDefinitionPatch(
      definition,
      patch({ dataType: 'NUMBER' }),
      usage,
    );
    expect(plan.next.dataType).toBe('NUMBER');
    expect(plan.searchMayBeAffected).toBe(false);
  });
  it.each(['isRequired', 'isActive', 'allowsCustom'] as const)(
    'requires policy consent for real %s edit',
    (field) => {
      const change = { [field]: !definition[field] };
      error(
        () => planDefinitionPatch(definition, patch(change), usage),
        'ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED',
        409,
      );
      error(
        () =>
          planDefinitionPatch(
            definition,
            patch({ ...change, confirmPolicyChange: true }),
            usage,
          ),
        'ATTRIBUTE_POLICY_REASON_REQUIRED',
      );
      expect(
        planDefinitionPatch(definition, patch({ ...change, ...policy }), {
          ...usage,
          categoryProductCount: 1,
        }).searchMayBeAffected,
      ).toBe(true);
    },
  );
  it('requires an active option before enabling required SELECT without custom', () => {
    error(
      () =>
        planDefinitionPatch(
          definition,
          patch({ isRequired: true, allowsCustom: false, ...policy }),
          usage,
        ),
      'ATTRIBUTE_REQUIRED_OPTIONS_EMPTY',
      409,
    );
    expect(
      planDefinitionPatch(
        definition,
        patch({ isRequired: true, allowsCustom: false, ...policy }),
        { ...usage, optionCount: 1, activeOptionCount: 1 },
      ).changed,
    ).toBe(true);
  });
  it('keeps ordering/filter-only edits free of Search fan-out', () => {
    expect(
      planDefinitionPatch(
        definition,
        patch({ sortOrder: 1, isFilterable: true }),
        { ...usage, categoryProductCount: 100, referencedProductCount: 100 },
      ).searchMayBeAffected,
    ).toBe(false);
  });
  it('name edit only potentially affects Search when values reference it', () => {
    expect(
      planDefinitionPatch(definition, patch({ name: 'Kết nối mới' }), usage)
        .searchMayBeAffected,
    ).toBe(false);
    expect(
      planDefinitionPatch(definition, patch({ name: 'Kết nối mới' }), {
        ...usage,
        referencedProductCount: 1,
      }).searchMayBeAffected,
    ).toBe(true);
  });
  it('option create requires parent revision, SELECT and no policy extras', () => {
    const raw = { expectedRevision: 3, value: 'Đen', slug: 'den' };
    const input = parseAttributeWrite(raw, 'option', 'create');
    expect(planOptionCreate(definition, input)).toMatchObject({
      changed: true,
      searchMayBeAffected: false,
      next: option,
    });
    error(
      () =>
        parseAttributeWrite(
          { ...raw, reason: 'Lý do thay đổi' },
          'option',
          'create',
        ),
      'VALIDATION_ERROR',
    );
    error(
      () => planOptionCreate({ ...definition, dataType: 'TEXT' }, input),
      'ATTRIBUTE_OPTIONS_NOT_SUPPORTED',
    );
    error(
      () => planOptionCreate({ ...definition, revision: 4 }, input),
      'ATTRIBUTE_REVISION_CONFLICT',
      409,
    );
  });
  it.each(['value', 'slug'] as const)(
    'blocks used option semantic edit %s even with reason',
    (field) => {
      error(
        () =>
          planOptionPatch(
            definition,
            option,
            optionPatch({ [field]: 'khac', ...policy }),
            1,
          ),
        'ATTRIBUTE_OPTION_IN_USE',
        409,
      );
    },
  );
  it('requires confirmation/reason to disable or reactivate a used option', () => {
    const used = 1;
    error(
      () =>
        planOptionPatch(
          definition,
          option,
          optionPatch({ isActive: false }),
          used,
        ),
      'ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED',
      409,
    );
    expect(
      planOptionPatch(
        definition,
        option,
        optionPatch({ isActive: false, ...policy }),
        used,
      ).searchMayBeAffected,
    ).toBe(true);
    expect(
      planOptionPatch(
        definition,
        { ...option, isActive: false },
        optionPatch({ isActive: true, ...policy }),
        used,
      ).searchMayBeAffected,
    ).toBe(true);
  });
  it('AT16 permits disabling the last used option with consent; canonical listing must be rechecked later', () => {
    expect(
      planOptionPatch(
        { ...definition, isRequired: true, allowsCustom: false },
        option,
        optionPatch({ isActive: false, ...policy }),
        1,
      ),
    ).toMatchObject({ changed: true, searchMayBeAffected: true });
  });
  it('option no-op and ordering do not increase logical mutation or Search', () => {
    expect(
      planOptionPatch(definition, option, optionPatch({ value: 'Đen' }), 1),
    ).toMatchObject({ changed: false, searchMayBeAffected: false });
    expect(
      planOptionPatch(definition, option, optionPatch({ sortOrder: 10 }), 1),
    ).toMatchObject({ changed: true, searchMayBeAffected: false });
  });
  it('fails on impossible canonical usage instead of silently permitting writes', () => {
    expect(() =>
      planDefinitionPatch(definition, patch({ name: 'Tên mới' }), {
        ...usage,
        optionCount: -1,
      }),
    ).toThrow('Invalid canonical usage count');
  });
  it('does not mutate canonical definition/option or incoming patch', () => {
    const before: DefinitionState & { revision: number } = definition;
    const input = patch({ sortOrder: 1 });
    const plan = planDefinitionPatch(before, input, usage);
    expect(before.sortOrder).toBe(0);
    expect(input.values.sortOrder).toBe(1);
    expect(Object.isFrozen(plan.next)).toBe(true);
    expect(before).toBe(definition);
  });
  it('returns metadata allowlist, not database identity/usage/audit fields', () => {
    const before = {
      ...definition,
      id: 31,
      categoryId: 12,
      createdAt: new Date(),
      privateField: 'hidden',
    };
    const plan = planDefinitionPatch(before, patch({ sortOrder: 1 }), usage);
    expect(Object.keys(plan.next).sort()).toEqual(
      [
        'name',
        'slug',
        'dataType',
        'isRequired',
        'isFilterable',
        'allowsCustom',
        'sortOrder',
        'isActive',
      ].sort(),
    );
    expect(
      Object.keys(
        planOptionPatch(
          definition,
          { ...option, id: 2 } as typeof option,
          optionPatch({ sortOrder: 1 }),
          0,
        ).next,
      ).sort(),
    ).toEqual(['value', 'slug', 'sortOrder', 'isActive'].sort());
  });
  it('does not let an incomplete patch masquerade as a create payload', () => {
    expect(() => planDefinitionCreate(patch({ name: 'Tên mới' }), 0)).toThrow(
      'matching parsed mutation',
    );
    expect(() => planDefinitionPatch(definition, create(), usage)).toThrow(
      'matching parsed mutation',
    );
    expect(() =>
      planOptionCreate(definition, optionPatch({ value: 'Đen' })),
    ).toThrow('matching parsed mutation');
  });
});
