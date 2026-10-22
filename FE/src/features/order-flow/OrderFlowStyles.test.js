import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./OrderFlow.module.css', import.meta.url), 'utf8');
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  expect(match).not.toBeNull();
  return match[1];
}
function luminance(hex) {
  const rgb = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
describe('Checkout local color pairs (CSS regression, not browser QA)', () => {
  it('sets local foreground/background and light native controls', () => {
    expect(rule('.page')).toContain('color: #20242b;');
    expect(rule('.page')).toContain('background: var(--market-bg);');
    expect(rule('.page')).toContain('color-scheme: light;');
  });
  it('overrides global dark heading color explicitly', () => {
    expect(rule('.page h1, .page h2')).toContain('color: #20242b;');
  });
  it('gives native form controls explicit readable colors', () => {
    const control = rule('.page input, .page select, .page textarea');
    expect(control).toContain('color: #20242b;');
    expect(control).toContain('background: #fff;');
  });
  it.each([
    ['text', '#20242b', '#ffffff'], ['link', '#bb350d', '#ffffff'],
    ['button', '#ffffff', '#d63b0b'], ['error', '#20242b', '#fff0ec'],
  ])('%s color pair meets 4.5:1', (_, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
