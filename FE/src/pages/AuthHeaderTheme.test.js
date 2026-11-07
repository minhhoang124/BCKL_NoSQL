import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const auth = readFileSync(new URL('./AuthForm.module.css', import.meta.url), 'utf8');
const header = readFileSync(new URL('../components/Header/Header.module.css', import.meta.url), 'utf8');
function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  expect(match).not.toBeNull(); return match[1];
}
function lum(hex) {
  const rgb = hex.match(/[0-9a-f]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
describe('Auth/Header explicit light surfaces under either system preference', () => {
  it('pins the auth surface/control scheme', () => {
    expect(rule(auth, '.container')).toContain('color-scheme: light;');
    expect(rule(auth, '.container')).toContain('color: #20242b;');
    expect(rule(auth, '.container')).toContain('background-color: #fff;');
  });
  // Header is a solid brand bar (white on #d63b0b, contrast pair checked below).
  it('pins the header bar colors explicitly', () => {
    expect(rule(header, '.header')).toContain('color-scheme: light;');
    expect(rule(header, '.header')).toContain('color: #fff;');
    expect(rule(header, '.header')).toContain('background-color: var(--market-brand);');
  });
  it('does not inherit near-white global dark h1 color', () => expect(rule(auth, '.title')).toContain('color: #20242b;'));
  it.each([[auth, '.form input, .form select'], [header, '.search input']])('sets foreground and background of native inputs', (css, selector) => {
    expect(rule(css, selector)).toContain('color: #20242b;');
    expect(rule(css, selector)).toContain('background-color: #fff;');
  });
  it.each([[auth, '.form input::placeholder'], [header, '.search input::placeholder']])('keeps placeholder opaque and readable', (css, selector) => {
    expect(rule(css, selector)).toContain('color: #596170;'); expect(rule(css, selector)).toContain('opacity: 1;');
  });
  it.each([['#20242b', '#ffffff'], ['#596170', '#ffffff'], ['#ffffff', '#d63b0b'], ['#d63b0b', '#ffffff']])('color pair %s/%s meets 4.5:1', (fg, bg) => {
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps an explicit focus indicator', () => {
    expect(rule(auth, '.form input:focus, .form select:focus')).toContain('outline: 2px solid var(--market-brand);');
    expect(rule(header, '.header :focus-visible')).toContain('outline: 2px solid #fff;');
  });
  it('uses the selected orange token for primary controls, not previous blue', () => {
    const tokens = readFileSync(new URL('../styles/marketplace.css', import.meta.url), 'utf8');
    expect(tokens).toContain('--market-brand: #d63b0b;');
    expect(tokens).toContain("--market-font: 'Inter', system-ui, sans-serif;");
    expect(rule(header, '.search button')).toContain('background-color: var(--market-brand);');
    expect(tokens).toContain('.market-button:disabled');
  });
});
