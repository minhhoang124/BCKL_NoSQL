import { normalizedAttributeNameKey } from './attribute-name-key.js';

describe('Attribute normalized identity from contract #65', () => {
  it.each([
    ['  Kết\t nối  ', 'kết nối'],
    ['\ufeffMÀU\u00a0  SẮC\u3000', 'màu sắc'],
    ['Màu sắc', 'màu sắc'],
    ['Mau sac', 'mau sac'],
    ['😀 ABC 𐐀', '😀 abc 𐐨'],
    ['Ａ A', 'ａ a'],
    ['A\u0085B', 'a\u0085b'],
    ['A\u200bB', 'a\u200bb'],
  ])(
    'normalizes %j without accent or compatibility folding',
    (input, expected) => {
      expect(normalizedAttributeNameKey(input)).toBe(expected);
      expect(normalizedAttributeNameKey(expected)).toBe(expected);
    },
  );
});
