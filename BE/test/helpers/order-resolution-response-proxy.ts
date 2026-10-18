import { createServer, request, type ClientRequest } from 'node:http';
import { once } from 'node:events';

/** TEST ONLY: drops a successful upstream response after consuming it completely.
 * No retries, no synthetic business result, no request/header/key/body logging.
 * An upstream HTTP200 is NOT DB commit proof; tests must separately inspect DB.
 */
export async function startOrderResolutionResponseProxy(upstreamOrigin: string) {
  const upstream = new URL(upstreamOrigin);
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' ||
      !upstream.port || Number(upstream.port) < 1024 ||
      ['3000', '3001', '3011', '5432', '5549'].includes(upstream.port) ||
      upstream.username || upstream.password || upstream.pathname !== '/' ||
      upstream.search || upstream.hash)
    throw new Error('Ephemeral loopback QA HTTP origin required');
  let armed = false, forwarded = 0, discarded = 0;
  const inFlight = new Set<ClientRequest>();
  const server = createServer((incoming, outgoing) => {
    // Strict path/method allowlist; never proxy catalog/Auth/admin/demo traffic.
    if (incoming.method !== 'POST' ||
        !/^\/seller\/orders\/[1-9][0-9]*\/(confirm|start-packing|ready-to-ship|resolve-command)$/.test(incoming.url ?? '')) {
      incoming.resume(); outgoing.writeHead(404); outgoing.end(); return;
    }
    forwarded++;
    const relay = request(new URL(incoming.url!, upstream), {
      method: 'POST', headers: { ...incoming.headers, host: upstream.host }, agent: false,
    }, response => {
      // Capture intent to discard at response start; only one response per arm.
      const drop = armed && response.statusCode === 200;
      if (drop) armed = false;
      if (!drop) {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      } else {
        response.resume();
        response.once('end', () => { discarded++; outgoing.destroy(); });
      }
      response.once('error', () => outgoing.destroy());
    });
    inFlight.add(relay);
    relay.once('close', () => inFlight.delete(relay));
    relay.setTimeout(35000, () => relay.destroy(new Error('QA proxy deadline')));
    relay.once('error', () => outgoing.destroy());
    incoming.once('error', () => relay.destroy());
    incoming.pipe(relay);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('QA proxy address unavailable');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    dropNextSuccess: () => { armed = true; },
    stats: () => ({ forwarded, discarded }),
    close: async () => {
      const closed = once(server, 'close'); server.close(); server.closeAllConnections();
      for (const relay of inFlight) relay.destroy();
      await closed;
    },
  };
}
