// Real HTTP COD + Seller command -> business queue -> Mailpit -> Chrome inbox.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    "playwright-module": { type: "string" },
  },
});
assert(values.output && values["playwright-module"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5549");
assert.equal(
  url.pathname,
  "/bckl_order_resolution_test_attributes_20261019_v973",
);
assert.equal(url.username, "bckl_qa_app_20261021");
assert(
  !url.hash &&
    url.searchParams.getAll("schema").length <= 1 &&
    [...url.searchParams].every(([k, v]) => k === "schema" && v === "public"),
);
for (const f of [".env", "BE/.env", "FE/.env", "FE/.env.local"])
  try {
    await access(path.join(root, f));
    throw Error("Refusing dotenv");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
for (const f of [
  "SEARCH_SYNC_ENABLED",
  "SEARCH_RECONCILIATION_ENABLED",
  "PRODUCT_IMAGE_REPAIR_ENABLED",
  "ORDER_AUTO_COMPLETE_ENABLED",
  "NOTIFICATIONS_WORKER_ENABLED",
  "NOTIFICATION_EMAIL_WORKER_ENABLED",
])
  assert.equal(process.env[f], "false");
const api = "http://127.0.0.1:3393",
  web = "http://127.0.0.1:5193";
Object.assign(process.env, {
  FRONTEND_URL: web,
  NOTIFICATIONS_ENABLED: "true",
  NOTIFICATION_EMAIL_ENABLED: "true",
  NOTIFICATION_EMAIL_PROVIDER: "mailpit",
  NOTIFICATION_EMAIL_FROM: "business-qa@example.invalid",
  NOTIFICATION_EMAIL_WEB_ORIGIN: web,
  NOTIFICATION_EMAIL_LOCAL_SANDBOX_ENABLED: "true",
  NOTIFICATION_EMAIL_START_AT: new Date(Date.now() - 5000).toISOString(),
});
delete process.env.NOTIFICATION_EMAIL_API_KEY;
const output = path.resolve(values.output);
await assert.rejects(access(output));
await mkdir(output, { recursive: true });
const rb = createRequire(path.join(root, "BE/package.json")),
  rf = createRequire(path.join(root, "FE/package.json"));
rb("reflect-metadata");
const { Test } = rb("@nestjs/testing"),
  { hash } = rb("bcryptjs");
const load = (f) => import(pathToFileURL(path.join(root, "BE/dist", f)).href);
const { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js"),
  { NotificationEmailWorker } = await load(
    "notification/notification-email-worker.js",
  ),
  { NotificationEmailTransport } = await load(
    "notification/notification-email-transport.js",
  ),
  { NotificationProjector } = await load(
    "notification/notification-projector.js",
  );
const { createServer } = await import(pathToFileURL(rf.resolve("vite")).href),
  { default: react } = await import(
    pathToFileURL(rf.resolve("@vitejs/plugin-react")).href
  ),
  pw = await import(
    pathToFileURL(path.resolve(values["playwright-module"])).href
  );
const files = [
  "BE/src/notification/notification-email-policy.ts",
  "BE/src/notification/notification-email-worker.ts",
  "BE/src/notification/notification-email-transport.ts",
  "BE/prisma/migrations/20261028100000_notification_email/migration.sql",
  "scripts/test-notification-email-local.mjs",
];
const hashes = async () =>
    Object.fromEntries(
      await Promise.all(
        files.map(async (f) => [
          f,
          createHash("sha256")
            .update(await readFile(path.join(root, f)))
            .digest("hex"),
        ]),
      ),
    ),
  sourceHashes = await hashes(),
  results = [];
let app, vite, browser;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(3393, "127.0.0.1");
  const db = app.get(PrismaService),
    worker = app.get(NotificationEmailWorker);
  const [role] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.name, url.pathname.slice(1));
  assert(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole);
  const [migrations] =
    await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(migrations.n, 37);
  async function http(route, token, method = "GET", body, key) {
    const r = await fetch(api + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = r.status === 204 ? null : await r.json();
    assert(r.ok, `QA HTTP failed: ${route} status ${r.status}`);
    return data;
  }
  const marker = randomUUID(),
    password = "Qa-" + randomBytes(20).toString("hex"),
    buyerEmail = `buyer-${marker}@example.invalid`;
  const buyerSession = await http("/auth/register", null, "POST", {
      email: buyerEmail,
      password,
      accountType: "USER",
      fullName: "Buyer email QA",
    }),
    buyer = await db.user.findUniqueOrThrow({ where: { email: buyerEmail } });
  // Explicit QA preparation only: this is not a claim of real email verification.
  await db.user.update({
    where: { id: buyer.id },
    data: { emailVerifiedAt: new Date() },
  });
  const seller = await db.user.create({
      data: {
        email: `seller-${marker}@example.invalid`,
        passwordHash: await hash(password, 4),
        role: "SELLER",
      },
    }),
    sellerSession = await http("/auth/login", null, "POST", {
      email: seller.email,
      password,
    });
  const store = await db.store.create({
      data: {
        sellerId: seller.id,
        name: "Synthetic email QA Shop",
        status: "ACTIVE",
      },
    }),
    category = await db.category.create({
      data: { name: "Email QA category", slug: marker },
    });
  const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "Synthetic email QA item",
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: { create: { url: "/uploads/email-qa.svg", isPrimary: true } },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    }),
    variant = await db.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        skuCode: marker,
        optionSignature: "[]",
        price: "10000",
        stock: 5,
      },
    });
  const address = await http(
    "/me/addresses",
    buyerSession.accessToken,
    "POST",
    {
      recipientName: "PRIVATE_QA_RECIPIENT",
      phone: "0900000000",
      province: "QA province",
      ward: "QA ward",
      addressLine: "PRIVATE_QA_ADDRESS",
    },
  );
  await http(`/cart/items/${variant.id}`, buyerSession.accessToken, "PUT", {
    quantity: 2,
  });
  const receipt = await http(
      "/checkouts",
      buyerSession.accessToken,
      "POST",
      {
        addressId: address.id,
        paymentProvider: "COD",
        items: [
          { variantId: variant.id, quantity: 2, expectedUnitPrice: "10000" },
        ],
      },
      randomUUID(),
    ),
    orderId = receipt.orders[0].id;
  await http(
    `/seller/orders/${orderId}/confirm`,
    sellerSession.accessToken,
    "POST",
    {},
    randomUUID(),
  );
  const core = async () =>
    JSON.stringify(
      {
        order: await db.order.findUnique({
          where: { id: orderId },
          include: { payment: true, items: true, statusHistory: true },
        }),
        variant: await db.productVariant.findUnique({
          where: { id: variant.id },
        }),
        stock: await db.stockMovement.findMany({
          where: { variantId: variant.id },
          orderBy: { id: "asc" },
        }),
        search: await db.searchOutbox.findMany({
          where: { productId: product.id },
          orderBy: { id: "asc" },
        }),
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    );
  async function mails() {
    const r = await fetch(
      "http://127.0.0.1:8025/api/v1/search?query=" +
        encodeURIComponent("to:" + buyerEmail),
      { redirect: "error", signal: AbortSignal.timeout(3000) },
    );
    assert(r.ok);
    return (await r.json()).messages ?? [];
  }
  const before = await core();
  await worker.cycle(buyer.id);
  let list = await mails();
  assert.equal(list.length, 1);
  const notification = await db.notification.findFirstOrThrow({
      where: { recipientId: buyer.id, sourceKind: "ORDER" },
      orderBy: { id: "desc" },
    }),
    job = await db.notificationEmailJob.findUniqueOrThrow({
      where: { notificationId: notification.id },
    });
  assert.equal(job.status, "ACCEPTED_BY_PROVIDER");
  const body = await (
    await fetch(
      "http://127.0.0.1:8025/api/v1/message/" + encodeURIComponent(list[0].ID),
    )
  ).json();
  assert.equal(body.To[0].Address, buyerEmail);
  assert(body.Subject.includes("[QA LOCAL]"));
  assert(body.Text.includes(web + "/account/notifications"));
  assert(!/PRIVATE_QA|0900000000|20000|reason|token=/i.test(body.Text));
  assert.equal(await core(), before);
  results.push(
    "Actual COD HTTP checkout + Seller confirmation committed before one Mailpit email; Order/Payment/Stock/Search unchanged by delivery",
  );
  await worker.cycle(buyer.id);
  await new NotificationEmailWorker(
    db,
    app.get(NotificationProjector),
    app.get(NotificationEmailTransport),
  ).cycle(buyer.id);
  assert.equal((await mails()).length, 1);
  results.push(
    "Repeated cycle and reconstructed worker keep one accepted email",
  );
  await http(
    `/seller/orders/${orderId}/start-packing`,
    sellerSession.accessToken,
    "POST",
    {},
    randomUUID(),
  );
  const beforeLoss = await core(),
    originalFetch = globalThis.fetch;
  let dropped = false;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]) === "http://127.0.0.1:8025/api/v1/send" && !dropped) {
      dropped = true;
      await response.body?.cancel();
      throw Error("Controlled response loss after Mailpit acceptance");
    }
    return response;
  };
  try {
    await worker.cycle(buyer.id);
  } catch (error) {
    if (browser)
      for (const [i, context] of browser.contexts().entries())
        for (const [j, page] of context.pages().entries()) {
          await page
            .screenshot({
              path: path.join(output, `failure-${i}-${j}.png`),
              fullPage: true,
            })
            .catch(() => {});
          await writeFile(
            path.join(output, `failure-${i}-${j}.txt`),
            await page
              .locator("body")
              .innerText()
              .catch(() => ""),
          );
        }
    await writeFile(
      path.join(output, "failure.json"),
      JSON.stringify({ results, message: error.message }, null, 2),
    );
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(dropped);
  assert.equal((await mails()).length, 2);
  const uncertain = await db.notification.findFirstOrThrow({
    where: { recipientId: buyer.id, sourceKind: "ORDER" },
    orderBy: { id: "desc" },
  });
  assert.equal(
    (
      await db.notificationEmailJob.findUniqueOrThrow({
        where: { notificationId: uncertain.id },
      })
    ).status,
    "UNKNOWN",
  );
  await new NotificationEmailWorker(
    db,
    app.get(NotificationProjector),
    app.get(NotificationEmailTransport),
  ).cycle(buyer.id);
  assert.equal((await mails()).length, 2);
  assert.equal(await core(), beforeLoss);
  results.push(
    "Controlled lost response after real Mailpit acceptance -> UNKNOWN; restart never resends; committed packing/payment/inventory unaffected",
  );
  const apiInbox = await http(
    "/account/notifications",
    buyerSession.accessToken,
  );
  assert(apiInbox.items.some((n) => n.title === "Đơn hàng có cập nhật"));
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(api),
      "import.meta.env.VITE_NOTIFICATIONS_ENABLED": JSON.stringify("true"),
    },
    server: { host: "127.0.0.1", port: 5193, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
        viewport,
        colorScheme: "light",
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname === "/account/notifications") {
        const body = await response.json().catch(() => null);
        await writeFile(
          path.join(output, `notification-response-${name}-${Date.now()}.json`),
          JSON.stringify({ status: response.status(), body }, null, 2),
        );
      }
    });
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname === "/account/notifications" && request.failure()?.errorText !== "net::ERR_ABORTED")
        errors.push("NOTIFICATION_READ_FAILED:" + request.failure()?.errorText);
    });
    await page.goto(web + "/login");
    await page.getByLabel("Email", { exact: true }).fill(buyerEmail);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL(web + "/");
    await page.goto(web + "/account/notifications");
    await page
      .getByRole("heading", { name: "Thông báo", exact: true })
      .waitFor();
    await page
      .getByText("Đơn hàng có cập nhật", { exact: true })
      .first()
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(output, `web-inbox-${name}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
    results.push(
      `Chrome ${name}: authenticated generic email destination shows own inbox, no overflow/pageerror`,
    );
  }
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  await page.goto("http://127.0.0.1:8025");
  await page
    .getByText("[QA LOCAL] BCKL — Đơn hàng có cập nhật", { exact: true })
    .first()
    .waitFor();
  await page.screenshot({
    path: path.join(output, "mailpit-local-inbox.png"),
    fullPage: true,
  });
  await context.close();
  assert.deepEqual(await hashes(), sourceHashes);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        results,
        database: url.pathname.slice(1),
        migrations: 37,
        sourceHashes,
        acceptedEmails: 1,
        uncertainEmails: 1,
        duplicateEmails: 0,
        orderId,
        limits:
          "Actual local Mailpit HTTP + inbox readback and Chrome, no relay/Gmail/provider acceptance. Catalog/actors/address and verified email are explicit synthetic QA setup; COD checkout and Seller commands use real HTTP. Response loss controlled after upstream acceptance. No secret or password in artifacts.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      groups: results.length,
      output,
      demoTouched: false,
    }),
  );
} catch (error) {
  if (browser)
    for (const [i, context] of browser.contexts().entries())
      for (const [j, page] of context.pages().entries()) {
        await page
          .screenshot({
            path: path.join(output, `failure-${i}-${j}.png`),
            fullPage: true,
          })
          .catch(() => {});
        await writeFile(
          path.join(output, `failure-${i}-${j}.txt`),
          await page
            .locator("body")
            .innerText()
            .catch(() => ""),
        );
      }
  await writeFile(
    path.join(output, "failure.json"),
    JSON.stringify({ results, message: error.message }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
}
