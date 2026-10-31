// Isolated real Checkout/Seller HTTP setup -> native Python Chrome Admin/Buyer -> PG ledger.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: { output: { type: "string" }, python: { type: "string" } },
});
assert(values.output && values.python);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  out = path.resolve(values.output);
assert(!fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const u = new URL(process.env.DATABASE_URL ?? "");
assert.equal(u.protocol, "postgresql:");
assert.equal(u.hostname, "127.0.0.1");
assert.equal(u.port, "5549");
assert.equal(u.pathname, "/bckl_order_resolution_test_hardening_20261029");
assert.equal(u.username, "bckl_local_app");
assert(
  !u.hash &&
    [...u.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    u.searchParams.getAll("schema").length <= 1,
);
for (const f of [".env", "BE/.env", "FE/.env", "FE/.env.local"])
  assert(!fs.existsSync(path.join(root, f)));
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
// Six synthetic fixture checkouts are prepared together; quota correctness is
// covered by dedicated suites, not inferred from this accelerated UI run.
const web = "http://127.0.0.1:5197";
Object.assign(process.env, {
  FRONTEND_URL: web,
  CHECKOUT_CREATE_INTENTS_PER_MINUTE: "60",
  ORDER_COMMAND_RATE_PER_MINUTE: "200",
  SEARCH_SYNC_ENABLED: "false",
  SEARCH_RECONCILIATION_ENABLED: "false",
  PRODUCT_IMAGE_REPAIR_ENABLED: "false",
  ORDER_AUTO_COMPLETE_ENABLED: "false",
  EMAIL_NOTIFICATION_WORKER_ENABLED: "false",
  AUTH_GOOGLE_ENABLED: "false",
  AUTH_EMAIL_ENABLED: "false",
});
const req = createRequire(path.join(root, "BE/package.json")),
  rf = createRequire(path.join(root, "FE/package.json"));
req("reflect-metadata");
const load = (p) => import(pathToFileURL(path.join(root, "BE/dist", p)).href);
const { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js"),
  { Test } = req("@nestjs/testing");
let app, vite;
const marker = "fulfil-" + randomUUID().slice(0, 8),
  password = "Qa-" + randomUUID() + "!";
const sourceFiles = [
  "BE/src/order/admin-fulfilment.controller.ts",
  "BE/src/order/order.module.ts",
  "FE/src/features/admin-fulfilment/AdminFulfilment.tsx",
  "FE/src/features/admin-fulfilment/fulfilmentClient.ts",
  "FE/src/features/admin-fulfilment/AdminFulfilment.module.css",
  "FE/src/pages/AdminDashboardPage.tsx",
  "scripts/test-admin-fulfilment-browser.mjs",
  "scripts/test-admin-fulfilment-browser.py",
];
const sourceHashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
const sourceBefore = sourceHashes();
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  const api = await app.getUrl(),
    db = app.get(PrismaService);
  const [role] =
    await db.$queryRaw`SELECT current_user name,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super,has_schema_privilege(current_user,'public','CREATE') ddl`;
  assert.equal(role.name, "bckl_local_app");
  assert(!role.super && !role.ddl);
  const applied =
    await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied[0].n, 39);
  const http = async (endpoint, token, method = "GET", body, key) => {
    const r = await fetch(api + endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: web,
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert(r.ok, "Fixture HTTP " + r.status + " " + endpoint);
    return r.json();
  };
  const hash = await req("bcryptjs").hash(password, 10);
  const actors = {};
  for (const role of ["ADMIN", "SELLER", "USER"]) {
    const a = await db.user.create({
      data: {
        email: marker + "-" + role.toLowerCase() + "@example.test",
        passwordHash: hash,
        role,
      },
    });
    const s = await http("/auth/login", null, "POST", {
      email: a.email,
      password,
    });
    actors[role] = { id: a.id, email: a.email, password, token: s.accessToken };
  }
  const store = await db.store.create({
      data: {
        sellerId: actors.SELLER.id,
        name: "QA Admin fulfilment",
        status: "ACTIVE",
      },
    }),
    category = await db.category.create({
      data: { slug: marker, name: "QA fulfilment" },
    });
  const buyer = actors.USER;
  await http("/me/addresses", buyer.token, "POST", {
    recipientName: "QA synthetic",
    phone: "0901234567",
    province: "QA",
    district: "QA",
    ward: "QA",
    addressLine: "Synthetic fixture only",
    postalCode: null,
    deliveryNote: null,
    isDefault: true,
  });
  const address = await db.userAddress.findFirstOrThrow({
    where: { userId: buyer.id },
  });
  const orders = [];
  for (const name of [
    "success",
    "retry",
    "restock",
    "damaged",
    "lost",
    "attempt-limit",
    "return-race",
    "buyer-cancel",
  ]) {
    const p = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "QA " + name,
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: { create: { url: "/uploads/qa-only.jpg", isPrimary: true } },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const v = await db.productVariant.create({
      data: {
        productId: p.id,
        storeId: store.id,
        skuCode: marker + "-" + name,
        optionSignature: "default",
        price: "10000.00",
        stock: 5,
      },
    });
    await http("/cart/items/" + v.id, buyer.token, "PUT", { quantity: 2 });
    const receipt = await http(
      "/checkouts",
      buyer.token,
      "POST",
      {
        addressId: address.id,
        paymentProvider: "COD",
        items: [
          { variantId: v.id, quantity: 2, expectedUnitPrice: "10000.00" },
        ],
      },
      randomUUID(),
    );
    const id = receipt.orders[0].id;
    for (const cmd of ["confirm", "start-packing", "ready-to-ship"])
      if (name !== "buyer-cancel")
        await http(
          `/seller/orders/${id}/${cmd}`,
          actors.SELLER.token,
          "POST",
          {},
          randomUUID(),
        );
    orders.push({
      name,
      id,
      variantId: v.id,
      productId: p.id,
      tracking: "QA-" + name + "-" + id,
    });
  }
  for (const roleName of ["USER", "SELLER"]) {
    const r = await fetch(api + "/admin/fulfilment/orders", {
      headers: { Authorization: "Bearer " + actors[roleName].token },
    });
    assert.equal(r.status, 403);
  }
  const noStore = await fetch(
    api + "/admin/fulfilment/orders/" + orders[0].id,
    { headers: { Authorization: "Bearer " + actors.ADMIN.token } },
  );
  assert.equal(noStore.status, 200);
  assert.equal(noStore.headers.get("cache-control"), "no-store");
  const projection = await noStore.json();
  assert.equal(projection.total, "20000.00");
  assert.equal(projection.payment.amount, "20000.00");
  assert.deepEqual(
    Object.keys(projection).sort(),
    [
      "id",
      "orderNumber",
      "status",
      "total",
      "currentDeliveryAttempt",
      "retryCount",
      "currentAttempt",
      "payment",
    ].sort(),
  );
  assert(
    !/phone|address|buyerId|reasonText|passwordHash|idempotencyKey/.test(
      JSON.stringify(projection),
    ),
  );
  // Canonical credential version is checked again inside the read transaction.
  const old = actors.ADMIN.token;
  await db.user.update({
    where: { id: actors.ADMIN.id },
    data: { credentialVersion: { increment: 1 } },
  });
  assert.equal(
    (
      await fetch(api + "/admin/fulfilment/orders", {
        headers: { Authorization: "Bearer " + old },
      })
    ).status,
    401,
  );
  const fresh = await http("/auth/login", null, "POST", {
    email: actors.ADMIN.email,
    password,
  });
  actors.ADMIN.token = fresh.accessToken;
  process.env.VITE_API_URL = api;
  const { createServer } = await import(pathToFileURL(rf.resolve("vite")).href);
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5197, strictPort: true },
  });
  await vite.listen();
  const fixture = path.join(out, "fixture.private.json");
  fs.writeFileSync(fixture, JSON.stringify({ api, web, actors, orders }));
  const code = await new Promise((resolve, reject) => {
    const c = spawn(
      values.python,
      [
        path.join(root, "scripts/test-admin-fulfilment-browser.py"),
        "--fixture",
        fixture,
        "--output",
        out,
      ],
      { cwd: root, env: process.env, windowsHide: true, stdio: "inherit" },
    );
    c.on("error", reject);
    c.on("exit", resolve);
  });
  assert.equal(code, 0, "Native Chrome acceptance failed");
  const successful = orders.find((o) => o.name === "success");
  const originalShip = await db.orderCommand.findFirstOrThrow({
    where: {
      orderId: successful.id,
      command: "ship",
      actorId: actors.ADMIN.id,
    },
  });
  const historical = await http(
    `/admin/orders/${successful.id}/ship`,
    actors.ADMIN.token,
    "POST",
    { trackingReference: successful.tracking },
    originalShip.idempotencyKey,
  );
  assert.equal(historical.replayed, true);
  assert.equal(historical.result.status, "SHIPPING");
  const race = orders.find((o) => o.name === "return-race");
  await http(
    `/admin/orders/${race.id}/ship`,
    actors.ADMIN.token,
    "POST",
    { trackingReference: race.tracking },
    randomUUID(),
  );
  await http(
    `/admin/orders/${race.id}/delivery-failed`,
    actors.ADMIN.token,
    "POST",
    {
      trackingReference: race.tracking,
      deliveryAttempt: 1,
      reasonCode: "CUSTOMER_REFUSED",
      reasonText: "QA return race",
    },
    randomUUID(),
  );
  const otherAdmin = await db.user.create({
    data: {
      email: marker + "-other-admin@example.test",
      passwordHash: hash,
      role: "ADMIN",
    },
  });
  const otherSession = await http("/auth/login", null, "POST", {
    email: otherAdmin.email,
    password,
  });
  const raceBody = {
    reasonCode: "RETURN_RECEIVED",
    reasonText: "QA concurrent return",
    restockable: true,
    receiptReference: "QA-RACE-" + race.id,
  };
  const raceResponses = await Promise.all(
    [actors.ADMIN.token, otherSession.accessToken].map((token) =>
      fetch(api + `/admin/orders/${race.id}/confirm-returned`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify(raceBody),
      }),
    ),
  );
  assert.deepEqual(raceResponses.map((r) => r.status).sort(), [200, 409]);
  const ledger = [];
  for (const o of orders) {
    const row = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { payment: true, items: true, currentAttempt: true },
    });
    const stock = (
      await db.productVariant.findUniqueOrThrow({ where: { id: o.variantId } })
    ).stock;
    const movements = await db.stockMovement.findMany({
        where: { orderItemId: row.items[0].id },
      }),
      count = await db.orderCommand.count({ where: { orderId: o.id } }),
      histories = await db.orderStatusHistory.count({
        where: { orderId: o.id },
      }),
      attempts = await db.deliveryAttempt.count({ where: { orderId: o.id } });
    const completed = ["success", "retry"].includes(o.name),
      limit = o.name === "attempt-limit",
      restock = ["restock", "return-race", "buyer-cancel"].includes(o.name);
    assert.equal(
      row.status,
      completed ? "COMPLETED" : limit ? "DELIVERY_FAILED" : "CANCELLED",
    );
    assert.equal(
      row.payment.status,
      completed ? "PAID" : limit ? "UNPAID" : "CANCELLED",
    );
    assert.equal(row.payment.amount.toFixed(2), "20000.00");
    assert.equal(stock, restock ? 5 : 3);
    assert.equal(movements.length, restock ? 2 : 1);
    assert.equal(movements[0].quantityDelta, -2);
    if (restock) assert.equal(movements[1].quantityDelta, 2);
    assert.equal(
      count,
      o.name === "buyer-cancel" ? 1 : limit ? 11 : o.name === "retry" ? 8 : 6,
    );
    assert.equal(histories, count + 1);
    assert.equal(
      attempts,
      o.name === "buyer-cancel" ? 0 : limit ? 4 : o.name === "retry" ? 2 : 1,
    );
    if (restock) assert.equal(movements[1].type, "CANCELLATION_RESTORE");
    ledger.push({
      name: o.name,
      orderId: o.id,
      status: row.status,
      payment: row.payment.status,
      stock,
      movements: movements.length,
      commands: count,
      histories,
      attempts,
    });
  }
  const result = {
    result: "PASS",
    scope: "REAL_CHROME_HTTP_PG_ADMIN_SIMULATION",
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    driverSha256: createHash("sha256")
      .update(fs.readFileSync(fileURLToPath(import.meta.url)))
      .digest("hex"),
    readerRolesAndProjection: "PASS",
    sourceHashes: sourceBefore,
    historicalReplayAfterCompletion: "PASS",
    concurrentAdminsReturn: "200/409; ledger checked below",
    ledger,
    limits: [
      "Catalog is synthetic; Checkout and Seller preparation use actual HTTP, not Seller UI",
      "No external courier, money or production workload",
      "Accelerated QA fixture quota checkout60/command200; no production quota acceptance claim",
      "Pending journal is metadata-only; uncertain requests require same-payload explicit replay; no abandon/close UI",
    ],
  };
  assert.deepEqual(
    sourceHashes(),
    sourceBefore,
    "Source changed while browser QA was running",
  );
  fs.writeFileSync(
    path.join(out, "ledger-report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ result: "PASS", orders: orders.length, out }));
} finally {
  await vite?.close();
  await app?.close();
}
