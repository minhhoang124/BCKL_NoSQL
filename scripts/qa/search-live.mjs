// Opt-in local integration: no mocked Search, no quality metric, no demo database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.env.QA_CHECKOUT_ROOT);
const output = path.resolve(process.env.QA_EVIDENCE_DIR);
const imagePath = path.resolve(process.env.QA_IMAGE_PATH);
const expectedHead = process.env.QA_EXPECTED_HEAD;
const imageMode = process.env.QA_IMAGE_GATEWAY === 'true';
const db = new URL(process.env.DATABASE_URL);
assert.equal(db.protocol, 'postgresql:');
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.port, '5549');
assert.match(db.pathname, /^\/bckl_order_resolution_test_search_live_[a-z0-9_]+$/);
assert.equal(db.hash, '');
assert.deepEqual([...db.searchParams], [['schema', 'public']]);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), expectedHead);
for (const key of ['SEARCH_SYNC_ENABLED', 'SEARCH_RECONCILIATION_ENABLED', 'PRODUCT_IMAGE_REPAIR_ENABLED', 'ORDER_AUTO_COMPLETE_ENABLED']) assert.equal(process.env[key], 'false');
const requireBE = createRequire(path.join(root, 'BE/package.json'));
requireBE('reflect-metadata');
const { Test } = requireBE('@nestjs/testing');
const { JwtService } = requireBE('@nestjs/jwt');
const { Prisma } = requireBE('@prisma/client');
const load = name => import(pathToFileURL(path.join(root, 'BE/dist', name)).href);
const { AppModule } = await load('app.module.js');
const { configureApp } = await load('configure-app.js');
const { PrismaService } = await load('prisma.service.js');
const { SearchOutboxService } = await load('search/search-outbox.service.js');
const { SearchSyncWorker } = await load('search/search-sync.worker.js');
const { listingInclude } = await load('product/product-public-policy.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFile(path.join(output, `${name}.json`), JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n');
const trace = [], checks = [], servers = [];
let esFault = false, aiFault = false, app;
const startedAt = new Date().toISOString();
async function listen(server, port) {
  servers.push(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}
async function proxy(port, target, kind) {
  await listen(createServer(async (req, res) => {
    if ((kind === 'es' && esFault) || (kind === 'ai' && aiFault)) { req.socket.destroy(); return; }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const upstream = httpRequest({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, response => {
        const received = [];
        response.on('data', c => received.push(Buffer.from(c)));
        response.on('end', () => {
          const raw = Buffer.concat(received);
          if (kind === 'ai') {
            const jsonRequest = String(req.headers['content-type']).includes('application/json');
            trace.push({ at: new Date().toISOString(), method: req.method, path: req.url,
              request: jsonRequest && body.length ? JSON.parse(body.toString()) : null,
              requestBytes: body.length, multipartBytesNotRetained: !jsonRequest,
              status: response.statusCode, response: raw.length ? JSON.parse(raw.toString()) : null });
          }
          res.writeHead(response.statusCode, response.headers); res.end(raw);
        });
      });
      upstream.setTimeout(15000, () => upstream.destroy(new Error('QA proxy timeout')));
      upstream.on('error', () => res.destroy()); upstream.end(body);
    } catch { res.destroy(); }
  }), port);
}
function pass(name) { checks.push(name); console.log(`PASS ${name}`); }
try {
  await proxy(19264, 19263, 'es');
  await proxy(8141, 8140, 'ai');
  const image = await readFile(imagePath);
  await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(image); }), 3362);
  app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  configureApp(app); await app.listen(3361, '127.0.0.1');
  const prisma = app.get(PrismaService), worker = app.get(SearchSyncWorker), outbox = app.get(SearchOutboxService);
  assert.equal((await prisma.$queryRaw`SELECT current_database() AS db`)[0].db, db.pathname.slice(1));
  assert.equal(await prisma.product.count(), 0);
  const health = await fetch('http://127.0.0.1:8140/health').then(r => r.json());
  assert.deepEqual(health, { status: 'ok', modelLoaded: true, indexLoaded: true, vectorCount: 0 });
  await save('initial-health', health);
  const seller = await prisma.user.create({ data: { email: 'search-live-seller@example.test', passwordHash: 'NOT_A_LOGIN_FIXTURE', role: 'SELLER' } });
  const buyer = await prisma.user.create({ data: { email: 'search-live-buyer@example.test', passwordHash: 'NOT_A_LOGIN_FIXTURE', role: 'USER' } });
  const store = await prisma.store.create({ data: { sellerId: seller.id, name: 'Synthetic Search QA', status: 'ACTIVE' } });
  const category = await prisma.category.create({ data: { name: 'Search QA', slug: 'search-live-20261023' } });
  const token = app.get(JwtService).sign({ sub: buyer.id, email: buyer.email, role: 'USER', type: 'access' }, { secret: process.env.JWT_ACCESS_SECRET, issuer: 'klcn-ecommerce-api', audience: 'klcn-ecommerce-web', expiresIn: '20m' });
  async function api(route, body, status = 200, method = 'POST', key) {
    const r = await fetch(`http://127.0.0.1:3361${route}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const value = await r.json(); assert.equal(r.status, status, `Unexpected HTTP status on ${route}`); return value;
  }
  const products = [];
  for (const label of ['A', 'B']) {
    const p = await prisma.product.create({ data: { storeId: store.id, categoryId: category.id, name: `searchqa headphones ${label}`, description: 'Synthetic integration, not quality evaluation', sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', images: { create: { url: 'http://127.0.0.1:3362/image.jpg', isPrimary: true } }, shippingProfile: { create: { packageWeightGrams: 100 } } } });
    const variants = [];
    for (const n of [1, 2]) variants.push(await prisma.productVariant.create({ data: { productId: p.id, storeId: store.id, skuCode: `search-live-${label}-${n}`, optionSignature: `${n}`, price: n * 100000, stock: 1 } }));
    products.push({ ...p, variants });
  }
  const [A, B] = products, ids = products.map(p => p.id);
  const address = await api('/me/addresses', { recipientName: 'QA Fixture', phone: '0900000000', province: 'QA', ward: 'QA', addressLine: 'Synthetic test only' }, 201);
  await save('fixture', { productIds: ids, variantIds: products.map(p => p.variants.map(v => v.id)), imageSha256: hash(image) });
  async function snapshot(name) {
    const value = await prisma.$transaction(async tx => ({
      products: await tx.product.findMany({ select: { id: true, version: true, moderationStatus: true, sellerStatus: true } }),
      variants: await tx.productVariant.findMany({ select: { id: true, productId: true, price: true, stock: true } }),
      outbox: await tx.searchOutbox.findMany({ orderBy: { id: 'asc' } }),
      movements: await tx.stockMovement.findMany({ orderBy: { id: 'asc' } }),
      orders: await tx.order.findMany({ select: { id: true, status: true, total: true } }),
      commands: await tx.orderCommand.count(), history: await tx.orderStatusHistory.count(),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    await save(name + '-db', value); return value;
  }
  async function proof(name, expected = ids) {
    const refresh = await fetch(`http://127.0.0.1:19263/${process.env.QA_ES_INDEX}/_refresh`, { method: 'POST' }); assert.equal(refresh.status, 200);
    const docs = await Promise.all(ids.map(id => fetch(`http://127.0.0.1:19263/${process.env.QA_ES_INDEX}/_doc/${id}`).then(r => r.json())));
    const hashes = {};
    for (const file of ['products.faiss', 'faiss_state.json', 'product_sync_state.json']) hashes[file] = hash(await readFile(path.join(output, 'runtime', file)));
    const faiss = JSON.parse(execFileSync(process.env.QA_PYTHON, ['-c', 'import faiss,json,sys; x=faiss.read_index(sys.argv[1]); print(json.dumps({"count":x.ntotal,"dimension":x.d,"ids":faiss.vector_to_array(x.id_map).tolist()}))', path.join(output, 'runtime/products.faiss')], { encoding: 'utf8' }));
    assert.deepEqual([...faiss.ids].sort(), [...expected].sort()); assert.equal(new Set(faiss.ids).size, faiss.count); assert.equal(faiss.dimension, 512);
    const sync = JSON.parse(await readFile(path.join(output, 'runtime/product_sync_state.json'), 'utf8'));
    const value = { docs, hashes, faiss, sync }; await save(name + '-proof', value); return value;
  }
  async function search(name) {
    const q = { query: 'searchqa headphones', filters: { inStock: true }, topK: 20, candidateK: 100 };
    const r = await fetch('http://127.0.0.1:8141/search/hybrid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) }); assert.equal(r.status, 200);
    const candidates = await r.json();
    const hydrated = await api('/search/hybrid', { query: q.query, inStock: true, topK: 20, candidateK: 100 });
    await save(name + '-search', { candidates, hydrated }); return { candidates, hydrated };
  }
  async function imageSearch(label, bytes = image, mime = 'image/jpeg', status = 200, filename = 'client-query.jpg') {
    const form = new FormData(); form.set('image', new Blob([bytes], { type: mime }), filename); form.set('topK', '10'); form.set('candidateK', '30');
    const r = await fetch('http://127.0.0.1:3361/search/image', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const value = await r.json(); assert.equal(r.status, status, `Image ${label}`); assert.equal(r.headers.get('cache-control'), 'no-store');
    await save('image-' + label, { httpStatus: r.status, body: value }); return value;
  }
  await prisma.$transaction(async tx => { const cats = await tx.category.findMany(); for (const id of ids) await outbox.writeOutboxEvent(tx, await tx.product.findUniqueOrThrow({ where: { id }, include: listingInclude }), cats, 1); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await worker.runBatch(); await proof('baseline');
  assert.equal(await prisma.searchOutbox.count({ where: { status: 'SUCCEEDED' } }), 2);
  pass('initial_outbox_to_real_dual_index');
  if (imageMode) {
    const before = await snapshot('image-before');
    const jpeg = await imageSearch('jpeg'); assert.deepEqual(jpeg.items.map(x => x.productId).sort(), [...ids].sort());
    const png = requireBE('sharp'); const pngBytes = await png(image).png().toBuffer();
    assert.equal((await imageSearch('png', pngBytes, 'image/png', 200, 'query.png')).items.length, 2);
    await imageSearch('corrupt', Buffer.from([255,216,255,224,0,1,2]), 'image/jpeg', 400);
    await imageSearch('unsupported', Buffer.from('GIF89a'), 'image/gif', 415, 'query.gif');
    aiFault = true; try { await imageSearch('ai-unavailable', image, 'image/jpeg', 503); } finally { aiFault = false; }
    assert.deepEqual(await snapshot('image-after'), before);
    pass('image_jpeg_png_corrupt_mime_unavailable_zero_business_writes');
    // Canonical DB visibility changes while FAISS is deliberately stale.
    await prisma.product.update({ where: { id: A.id }, data: { sellerStatus: 'HIDDEN' } });
    const raw = new FormData(); raw.set('image', new Blob([image], { type: 'image/jpeg' }), 'query.jpg'); raw.set('topK', '10'); raw.set('candidateK', '30');
    const response = await fetch('http://127.0.0.1:8140/search/image', { method: 'POST', body: raw }); assert.equal(response.status, 200);
    const candidates = await response.json(); assert(candidates.items.some(x => x.productId === A.id));
    const safe = await imageSearch('stale-hidden'); assert(!safe.items.some(x => x.productId === A.id)); assert(safe.items.some(x => x.productId === B.id));
    await save('image-stale-hydrate-proof', { candidates, hydrated: safe, directFixtureMutation: true });
    await prisma.product.update({ where: { id: A.id }, data: { sellerStatus: 'ACTIVE' } });
    pass('image_stale_candidate_removed_by_postgresql_hydrate');
  }
  async function purchase(p, label) {
    for (const v of p.variants) await api(`/cart/items/${v.id}`, { quantity: 1 }, 200, 'PUT');
    const body = { addressId: address.id, paymentProvider: 'COD', items: p.variants.map(v => ({ variantId: v.id, quantity: 1, expectedUnitPrice: v.price.toFixed(2) })) };
    assert.equal((await api('/checkout/preview', body)).canCheckout, true);
    const receipt = await api('/checkouts', body, 201, 'POST', `search-live-checkout-${label}`); await save(label + '-checkout', receipt); return receipt.orders[0].id;
  }
  const cancelBody = { reasonCode: 'CHANGED_MIND', reasonText: 'Synthetic integration test' };
  const orderA = await purchase(A, 'A'); await worker.runBatch();
  const sold = await proof('sold-out'); assert.equal(sold.docs[0]._source.inStock, false); assert.equal(sold.docs[0]._source.version, 2);
  assert(!(await search('sold-out')).candidates.items.some(x => x.productId === A.id));
  pass('checkout_sold_out_real_filter');
  const beforeCancel = await snapshot('before-cancel');
  const receipt = await api(`/orders/${orderA}/cancel`, cancelBody, 200, 'POST', 'search-live-cancel-A');
  const afterCancel = await snapshot('after-cancel');
  assert.deepEqual(afterCancel.variants.filter(v => v.productId === A.id).map(v => v.stock), [1, 1]);
  assert.equal(afterCancel.products.find(p => p.id === A.id).version, 3);
  assert.equal(afterCancel.outbox.length, beforeCancel.outbox.length + 1);
  const event = afterCancel.outbox.find(e => e.productId === A.id && e.version === 3);
  assert.equal(event.operation, 'UPSERT'); assert.equal(event.payload.inStock, true);
  assert(!(await search('restore-before-dispatch')).hydrated.items.some(x => x.productId === A.id));
  const replay = await api(`/orders/${orderA}/cancel`, cancelBody, 200, 'POST', 'search-live-cancel-A'); assert.deepEqual(replay, { ...receipt, replayed: true });
  assert.deepEqual(await snapshot('after-replay'), afterCancel);
  pass('cancellation_restore_replay_and_documented_index_lag');
  esFault = true; try { await worker.runBatch(); } finally { esFault = false; }
  const failed = await prisma.searchOutbox.findUniqueOrThrow({ where: { id: event.id } });
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.attemptCount, 1); assert.equal(failed.processedAt, null);
  const partialTrace = trace.filter(t => t.request?.productId === A.id && t.request?.version === 3).at(-1);
  assert.equal(partialTrace.status, 503); assert.equal(partialTrace.response.outcome, 'PARTIAL_FAILURE');
  assert.equal(partialTrace.response.indexes.faiss.status, 'SUCCEEDED'); assert.equal(partialTrace.response.indexes.elasticsearch.status, 'FAILED');
  const partial = await proof('partial'); await snapshot('partial');
  const delay = Math.max(0, failed.nextAttemptAt.getTime() - Date.now() + 100);
  console.log(`WAIT real worker backoff ${Math.ceil(delay / 1000)} seconds`);
  await new Promise(resolve => setTimeout(resolve, delay));
  await worker.runBatch();
  const retried = await prisma.searchOutbox.findUniqueOrThrow({ where: { id: event.id } });
  assert.equal(retried.status, 'SUCCEEDED'); assert.equal(retried.attemptCount, 2); assert.deepEqual(retried.payload, event.payload);
  const retryTrace = trace.filter(t => t.request?.productId === A.id && t.request?.version === 3).at(-1);
  assert.deepEqual(retryTrace.request, partialTrace.request); assert.equal(retryTrace.response.indexes.faiss.status, 'ALREADY_APPLIED'); assert.equal(retryTrace.response.indexes.elasticsearch.status, 'SUCCEEDED');
  const caught = await proof('caught-up'); assert.equal(caught.hashes['products.faiss'], partial.hashes['products.faiss']); assert.equal(caught.docs[0]._source.inStock, true);
  assert((await search('caught-up')).hydrated.items.some(x => x.productId === A.id));
  pass('real_partial_failure_backoff_immutable_retry_no_duplicate_vector');
  const orderB = await purchase(B, 'B');
  const old = await prisma.searchOutbox.findFirstOrThrow({ where: { productId: B.id, version: 2 } });
  await prisma.searchOutbox.update({ where: { id: old.id }, data: { nextAttemptAt: new Date(Date.now() + 600000) } });
  await api(`/orders/${orderB}/cancel`, cancelBody, 200, 'POST', 'search-live-cancel-B'); await worker.runBatch();
  const beforeStale = await proof('before-stale');
  await prisma.searchOutbox.update({ where: { id: old.id }, data: { nextAttemptAt: new Date() } }); await worker.runBatch();
  assert.equal(trace.filter(t => t.request?.productId === B.id && t.request?.version === 2).at(-1).response.outcome, 'STALE');
  const afterStale = await proof('after-stale'); assert.deepEqual(afterStale.hashes, beforeStale.hashes); assert.deepEqual(afterStale.docs, beforeStale.docs);
  pass('stale_event_cannot_overwrite_newer_state');
  const hiddenOrder = await purchase(A, 'hidden'); await worker.runBatch();
  await prisma.store.update({ where: { id: store.id }, data: { status: 'SUSPENDED' } });
  await api(`/orders/${hiddenOrder}/cancel`, cancelBody, 200, 'POST', 'search-live-cancel-hidden');
  const deletion = await prisma.searchOutbox.findFirstOrThrow({ where: { productId: A.id, version: 5 } }); assert.equal(deletion.operation, 'DELETE'); assert.deepEqual(deletion.payload, { productId: A.id, version: 5 });
  await worker.runBatch(); const deleted = await proof('hidden-delete', [B.id]); assert.equal(deleted.docs[0].found, false);
  assert.deepEqual((await search('hidden-delete')).hydrated.items, []);
  const staleUpsert = await fetch('http://127.0.0.1:8141/index/product', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event.payload) });
  assert.equal(staleUpsert.status, 200); assert.equal((await staleUpsert.json()).outcome, 'STALE');
  assert.deepEqual((await proof('after-tombstone-stale', [B.id])).hashes, deleted.hashes);
  pass('hidden_delete_and_tombstone_prevent_resurrection');
  await snapshot('final');
  await save('manifest', { schemaVersion: 1, purpose: 'REAL_LOCAL_SEARCH_INTEGRATION_NOT_QUALITY_EVALUATION', startedAt, endedAt: new Date().toISOString(), sourceCommit: expectedHead, imageGatewayCandidate: imageMode, database: db.pathname.slice(1), index: process.env.QA_ES_INDEX, checks, result: 'PASS', imageSha256: hash(image), driverSha256: hash(await readFile(new URL(import.meta.url))), modelRevisions: { image: process.env.QA_IMAGE_REVISION, text: process.env.QA_TEXT_REVISION }, config: { rrfK: 60, device: 'cpu', workers: 1, cron: false, topK: 20, candidateK: 100 }, scheduling: 'B v2 nextAttemptAt held before delivery; payload/status/attemptCount never reset', transportFault: 'ES TCP forwarding proxy destroys connection; no fake success', precisionRecallCalculated: false });
} finally {
  esFault = false; aiFault = false;
  await save('worker-ai-http-trace', trace);
  await save('results', { startedAt, endedAt: new Date().toISOString(), sourceCommit: expectedHead, completedChecks: checks });
  if (app) await app.close();
  for (const server of servers) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
