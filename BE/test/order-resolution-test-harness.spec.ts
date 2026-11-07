// Harness self-tests only: fake HTTP upstream, NO Nest/Prisma/PostgreSQL.
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';
import { startOrderResolutionResponseProxy } from './helpers/order-resolution-response-proxy.js';

describe('Order resolution QA database target guard — no DB connections', () => {
  it('allows only the isolated resolution-test namespace and QA port', () => {
    expect(() => assertOrderResolutionQaTarget('postgresql://qa:secret@127.0.0.1:5549/bckl_order_resolution_test_run1?schema=public')).not.toThrow();
  });
  it.each([
    undefined, '', 'not-a-url',
    'postgresql://qa:secret@127.0.0.1:5432/bckl_order_resolution_test_a',
    'postgresql://qa:secret@127.0.0.1:5549/klcn_ecommerce',
    'postgresql://qa:secret@127.0.0.1:5549/bckl_checkout_web_20261012',
    'postgresql://qa:secret@remote.example:5549/bckl_order_resolution_test_a',
    'postgresql://qa:secret@127.0.0.1:5549/bckl_order_resolution_test_a?schema=other',
    'postgresql://qa:secret@127.0.0.1:5549/bckl_order_resolution_test_a?schema=public&schema=public',
    'postgresql://qa:secret@127.0.0.1:5549/bckl_order_resolution_test_a?options=x',
    'postgresql://qa:secret@127.0.0.1:5549/bckl_order_resolution_test_a#anything',
  ])('rejects unsafe target case %# without echoing credentials', target => {
    try { assertOrderResolutionQaTarget(target); throw new Error('should reject'); }
    catch (error) {
      expect((error as Error).message).toBe('Dedicated loopback order-resolution test database on port 5549 required');
      expect((error as Error).message).not.toContain('secret');
    }
  });
});

describe('Response-loss proxy — self-test, NOT Order commit proof', () => {
  let upstream: Server | undefined;
  let proxy: Awaited<ReturnType<typeof startOrderResolutionResponseProxy>> | undefined;
  afterEach(async () => {
    await proxy?.close(); proxy = undefined;
    if (upstream) { const closed = once(upstream, 'close'); upstream.close(); upstream.closeAllConnections(); await closed; }
    upstream = undefined;
  });
  async function start(status = 200) {
    let upstreamCalls = 0;
    upstream = createServer((req,res) => {
      req.resume(); req.once('end', () => { upstreamCalls++; res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify({ marker:'upstream-only' })); });
    });
    upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
    const address = upstream.address(); if (!address || typeof address === 'string') throw new Error('address');
    proxy = await startOrderResolutionResponseProxy(`http://127.0.0.1:${address.port}`);
    return () => upstreamCalls;
  }
  const post = (path='/seller/orders/19/resolve-command') => fetch(proxy!.origin+path, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{"command":"confirm"}', signal:AbortSignal.timeout(3000) });
  it('passes the real upstream body/status/headers without inventing a result', async () => {
    const calls = await start(); const result = await post();
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({marker:'upstream-only'});
    expect(calls()).toBe(1); expect(proxy!.stats()).toEqual({forwarded:1,discarded:0});
  });
  it('drops one completed HTTP200, does not retry, and allows an explicit later request', async () => {
    const calls = await start(); proxy!.dropNextSuccess();
    await expect(post()).rejects.toThrow(); expect(calls()).toBe(1);
    expect(proxy!.stats()).toEqual({forwarded:1,discarded:1});
    const result = await post(); expect(result.status).toBe(200); await result.json();
    expect(calls()).toBe(2); expect(proxy!.stats()).toEqual({forwarded:2,discarded:1});
  });
  it('does not discard or turn an upstream rejection into success', async () => {
    const calls = await start(409); proxy!.dropNextSuccess(); const result = await post();
    expect(result.status).toBe(409); await result.json(); expect(calls()).toBe(1);
    expect(proxy!.stats()).toEqual({forwarded:1,discarded:0});
  });
  it('blocks unexpected methods, paths and query strings before forwarding', async () => {
    const calls = await start();
    for (const path of ['/auth/login','/seller/orders/19/resolve-command?unexpected=1','/seller/orders/0/confirm']) {
      const result = await post(path); expect(result.status).toBe(404); await result.text();
    }
    const get = await fetch(proxy!.origin+'/seller/orders/19/confirm'); expect(get.status).toBe(404); await get.text();
    expect(calls()).toBe(0); expect(proxy!.stats()).toEqual({forwarded:0,discarded:0});
  });
  it.each(['http://127.0.0.1:3001','https://127.0.0.1:5200','http://remote.example:5200','http://127.0.0.1:5200/wrong'])('rejects non-QA origin case %#', async origin => {
    await expect(startOrderResolutionResponseProxy(origin)).rejects.toThrow('Ephemeral loopback QA HTTP origin required');
  });
});
