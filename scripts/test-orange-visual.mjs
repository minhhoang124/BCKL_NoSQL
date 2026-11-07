// Visual-only Order fixture renderer. Never adds production routes or claims live Order QA.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { output: { type: 'string' }, reference: { type: 'string' }, runtime: { type: 'string' }, 'playwright-module': { type: 'string' } } });
assert(values.output && values.reference && values['playwright-module']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'FE/package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { chromium } = await import(pathToFileURL(values['playwright-module']).href);
const output = path.resolve(values.output); await mkdir(output, { recursive: true });
const vite = await createServer({ root: path.join(root, 'FE'), server: { host: '127.0.0.1', port: 5189, strictPort: true }, plugins: [{ name: 'qa-only-order', configureServer(server) {
  server.middlewares.use('/__qa/order', (_, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
      </script><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      const { createRoot } = ReactDOM;
      import '/src/index.css'; import '/src/styles/marketplace.css';
      import '/node_modules/@fontsource/inter/400.css'; import '/node_modules/@fontsource/inter/600.css'; import '/node_modules/@fontsource/inter/700.css';
      import { OrderListPanel, OrderDetailPanel } from '/src/features/order-readiness/OrderPanels.tsx';
      import { detailFixture, buyer } from '/src/features/order-readiness/testFixtures.ts';
      const order = detailFixture(); const mode = new URLSearchParams(location.search).get('mode');
      const context = { scope:'buyer',user:buyer,fresh:true,busy:false,outcomeUnknown:false };
      createRoot(document.getElementById('root')).render(React.createElement(mode === 'detail' ? OrderDetailPanel : OrderListPanel,
        mode === 'detail' ? {state:{status:'ready',data:order},source:'fixture',context,readKey:'qa-only'} :
        {state:{status:'ready',data:{items:[order],nextCursor:null}},source:'fixture',scope:'buyer',onSelect:()=>{}}));
    </script>`);
  });
} }] });
let browser;
try {
  await vite.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  for (const mode of ['list', 'detail']) {
    await page.goto(`http://127.0.0.1:5189/__qa/order?mode=${mode}`);
    await page.getByRole('heading', { level: 1 }).waitFor(); await page.evaluate(() => document.fonts.ready);
    assert(await page.getByText('DỮ LIỆU MẪU — chưa tích hợp giao dịch thật.', { exact: true }).isVisible());
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `order-${mode}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
  }
  assert.deepEqual(errors, []);
  const pairs = [['login', '16-login.png', 'auth/desktop-light-01-login.png'], ['checkout', '04-checkout.png', 'checkout/desktop-light-02-preview.png'], ['order-list', '05-orders.png', values.runtime ? path.resolve(values.runtime, 'desktop-light-01-buyer-list.png') : 'order-list-1440.png'], ['order-detail', '06-order-detail.png', values.runtime ? path.resolve(values.runtime, 'desktop-light-04-buyer-detail.png') : 'order-detail-1440.png']];
  const data = async p => 'data:image/png;base64,' + (await readFile(p)).toString('base64');
  for (const [name, ref, actual] of pairs) {
    await page.setViewportSize({ width: 1440, height: 620 });
    await page.setContent(`<style>body{margin:0;font:14px Arial}main{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%}h2{font-size:16px;margin:8px}</style><main><section><h2>Reference — ${name}</h2><img src="${await data(path.join(values.reference, 'previews', ref))}"></section><section><h2>Implementation — ${name}${name.startsWith('order')?(values.runtime?' (real API QA)':' (fixture, panel only)'):''}</h2><img src="${await data(path.isAbsolute(actual) ? actual : path.join(output, actual))}"></section></main>`);
    await page.screenshot({ path: path.join(output, `compare-${name}.png`), fullPage: true });
  }
  await writeFile(path.join(output, 'visual-results.json'), JSON.stringify({ order: 'fixtures only, no live API', viewports: [1440, 768, 390], consoleErrors: errors, comparisons: pairs.map(p=>p[0]) }, null, 2));
  console.log('Order fixture rendering and comparison captures PASS; visual judgment still required.');
} finally { await browser?.close(); await vite.close(); }
