import { describe, expect, it } from 'vitest';
import {
  parseAttributeWrite,
  planDefinitionPatch,
  planOptionPatch,
  type DefinitionState,
} from './attribute-write-policy.js';

// Pure planning only: these assertions do not prove actual enqueue/HTTP/DB.
const definition: DefinitionState & { revision: number } = {
  name: 'Màu sắc',
  slug: 'mau-sac',
  dataType: 'SINGLE_SELECT',
  isRequired: false,
  isFilterable: false,
  allowsCustom: true,
  sortOrder: 0,
  isActive: true,
  revision: 1,
};
const consent = {
  confirmPolicyChange: true,
  reason: 'Thay đổi cấu hình có xác nhận',
};
describe('Attribute mutation effect matrix — preparation only', () => {
  it.each([
    ['name used', { name: 'Màu hiển thị' }, 2, 3, true],
    ['name unused', { name: 'Màu hiển thị' }, 0, 3, false],
    ['required populated category', { isRequired: true }, 0, 3, true],
    ['required empty category', { isRequired: true }, 0, 0, false],
    ['disable populated category', { isActive: false }, 0, 3, true],
    ['disable empty category', { isActive: false }, 0, 0, false],
    ['custom rule', { allowsCustom: false }, 1, 3, true],
    ['ordering only', { sortOrder: 9 }, 2, 3, false],
    ['filter UI metadata only', { isFilterable: true }, 2, 3, false],
    ['no-op name', { name: 'Màu sắc' }, 2, 3, false],
    ['normalized no-op name', { name: '  Ma\u0300u   sắc ' }, 2, 3, false],
  ] as const)(
    '%s requests only the necessary coarse Search work',
    (_name, values, referencedProductCount, categoryProductCount, affected) => {
      const input = parseAttributeWrite(
        { expectedRevision: 1, ...values, ...consent },
        'definition',
        'patch',
      );
      const plan = planDefinitionPatch(definition, input, {
        referencedProductCount,
        categoryProductCount,
        optionCount: 2,
        activeOptionCount: 2,
      });
      expect(plan.searchMayBeAffected).toBe(affected);
      if (_name.includes('no-op')) expect(plan.changed).toBe(false);
    },
  );
  it.each([
    ['disable used', { isActive: false }, 2, true],
    ['disable unused', { isActive: false }, 0, false],
    ['ordering used', { sortOrder: 5 }, 2, false],
    ['rename unused', { value: 'Trắng' }, 0, false],
    ['normalized no-op used', { value: '  Đen ' }, 2, false],
  ] as const)(
    '%s option preserves precise Search planning',
    (_name, values, count, affected) => {
      const input = parseAttributeWrite(
        { expectedRevision: 1, ...values, ...consent },
        'option',
        'patch',
      );
      const plan = planOptionPatch(
        definition,
        { value: 'Đen', slug: 'den', sortOrder: 0, isActive: true },
        input,
        count,
      );
      expect(plan.searchMayBeAffected).toBe(affected);
      if (_name.includes('no-op')) expect(plan.changed).toBe(false);
    },
  );
});
