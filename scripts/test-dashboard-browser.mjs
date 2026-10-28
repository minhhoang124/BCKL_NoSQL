// Chrome -> real Nest -> restricted QA PostgreSQL. No dotenv or demo target.
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
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5549");
assert(["/bckl_order_resolution_test_attributes_20261019_v951", "/bckl_order_resolution_test_attributes_20261019_v971"].includes(url.pathname));
assert.equal(url.username, "bckl_qa_app_20261021");
assert(!url.hash);
assert(
  [...url.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    url.searchParams.getAll("schema").length <= 1,
);
for (const file of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, file));
    throw Error("Refusing local dotenv");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
for (const flag of [
  "SEARCH_SYNC_ENABLED",
  "SEARCH_RECONCILIATION_ENABLED",
  "PRODUCT_IMAGE_REPAIR_ENABLED",
  "ORDER_AUTO_COMPLETE_ENABLED",
])
  assert.equal(process.env[flag], "false");
const output = path.resolve(values.output);
await assert.rejects(access(output));
await mkdir(output, { recursive: true });
const rb = createRequire(path.join(root, "BE/package.json")),
  rf = createRequire(path.join(root, "FE/package.json"));
rb("reflect-metadata");
const { Test } = rb("@nestjs/testing"),
  { hash } = rb("bcryptjs");
const load = (name) =>
  import(pathToFileURL(path.join(root, "BE/dist", name)).href);
const { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js");
const { createServer } = await import(pathToFileURL(rf.resolve("vite")).href),
  { default: react } = await import(
    pathToFileURL(rf.resolve("@vitejs/plugin-react")).href
  );
const pw = await import(
  pathToFileURL(path.resolve(values["playwright-module"])).href
);
const files = [
  "FE/src/features/dashboard/Dashboard.tsx",
  "FE/src/features/dashboard/dashboardApi.ts",
  "FE/src/features/dashboard/Dashboard.module.css",
  "FE/src/pages/AdminDashboardPage.tsx",
  "FE/src/pages/SellerDashboardPage.tsx",
  "BE/src/dashboard/dashboard.service.ts",
  "BE/src/dashboard/dashboard-financial-query.ts",
  "scripts/test-dashboard-browser.mjs",
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
  );
const beforeSource = await hashes(),
  results = [];
const api = "http://127.0.0.1:3385",
  web = "http://127.0.0.1:5185";
process.env.FRONTEND_URL = web;
let app, vite, browser;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication();
  configureApp(app);
  await app.listen(3385, "127.0.0.1");
  const db = app.get(PrismaService);
  const [identity] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity.name, url.pathname.slice(1));
  assert(
    !identity.rolsuper && !identity.rolcreatedb && !identity.rolcreaterole,
  );
  const [migrations] =
    await db.$queryRaw`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(migrations.n, url.pathname.endsWith("_v971") ? 36 : 27);
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(api) },
    server: { host: "127.0.0.1", port: 5185, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const password = randomBytes(20).toString("hex"),
    passwordHash = await hash(password, 4),
    marker = randomUUID();
  const createUser = (role) =>
    db.user.create({
      data: {
        email: `qa-dashboard-${role.toLowerCase()}-${marker}@example.invalid`,
        passwordHash,
        role,
        fullName: "Synthetic Dashboard QA",
      },
    });
  const admin = await createUser("ADMIN"),
    seller = await createUser("SELLER"),
    buyer = await createUser("USER");
  const store = await db.store.create({
    data: {
      sellerId: seller.id,
      name: "Synthetic Closed Store",
      status: "CLOSED",
    },
  });
  const category = await db.category.create({
    data: { name: marker, slug: marker },
  });
  const product = await db.product.create({
    data: {
      storeId: store.id,
      categoryId: category.id,
      name: "Synthetic Dashboard item",
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      storeId: store.id,
      skuCode: marker,
      optionSignature: "[]",
      price: "100000.00",
      stock: 10,
    },
  });
  async function fixture(broken = false) {
    const checkout = await db.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: randomUUID(),
        requestHash: "synthetic-dashboard-browser",
      },
    });
    const completedAt = new Date("2026-01-31T16:59:59.999Z");
    const order = await db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store.id,
        orderNumber: randomUUID(),
        status: "COMPLETED",
        deliveredAt: new Date("2026-01-15T00:00:00Z"),
        completedAt,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        recipientNameSnapshot: "Private QA",
        phoneSnapshot: "0000000000",
        provinceSnapshot: "QA",
        wardSnapshot: "QA",
        addressLineSnapshot: "QA only",
        subtotal: "100000.00",
        total: "120000.00",
        shippingFee: "20000.00",
        payment: {
          create: {
            provider: "COD",
            status: "PAID",
            amount: "120000.00",
            paidAt: new Date("2026-01-15T00:00:00Z"),
          },
        },
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            quantity: 1,
            unitPrice: "100000.00",
            lineTotal: "100000.00",
            productNameSnapshot: "Synthetic old purchase",
            skuSnapshot: marker,
            optionSnapshot: {},
          },
        },
      },
      include: { items: true, payment: true },
    });
    const succeededAt = new Date("2026-02-03T00:00:00Z");
    const q = await db.aftersaleRequest.create({
      data: {
        orderItemId: order.items[0].id,
        kind: "REFUND_ONLY",
        state: "REFUNDED",
        reasonCode: "DAMAGED",
        description: "Synthetic historical QA",
        deadlineAt: succeededAt,
        createdAt: succeededAt,
      },
    });
    const refund = await db.refundRecord.create({
      data: {
        requestId: q.id,
        orderItemId: order.items[0].id,
        paymentId: order.payment.id,
        amount: "100000.00",
        succeededAt,
      },
    });
    if (!broken)
      await db.revenueAdjustment.create({
        data: {
          refundId: refund.id,
          amount: "-100000.00",
          effectiveAt: succeededAt,
        },
      });
    return order.id;
  }
  await fixture();
  const invalidOrderId = await fixture(true);
  const snapshot = async () => ({
    orders: await db.order.findMany({
      where: { storeId: store.id },
      orderBy: { id: "asc" },
    }),
    payments: await db.payment.findMany({
      where: { order: { storeId: store.id } },
      orderBy: { id: "asc" },
    }),
    refunds: await db.refundRecord.findMany({
      where: { item: { storeId: store.id } },
      orderBy: { id: "asc" },
    }),
    adjustments: await db.revenueAdjustment.findMany({
      where: { refund: { item: { storeId: store.id } } },
      orderBy: { id: "asc" },
    }),
    variant: await db.productVariant.findUnique({ where: { id: variant.id } }),
    audit: await db.aftersaleHistory.count(),
    stock: await db.stockMovement.count(),
    outbox: await db.searchOutbox.count(),
    jobs: await db.searchReconciliationJob.count(),
  });
  const before = await snapshot();
  for (const [name, width, height, colorScheme] of [
    ["desktop-light", 1440, 1000, "light"],
    ["desktop-dark", 1440, 1000, "dark"],
    ["mobile-light", 390, 844, "light"],
    ["mobile-dark", 390, 844, "dark"],
  ]) {
    for (const [scope, user] of [
      ["ADMIN", admin],
      ["SELLER", seller],
    ]) {
      const context = await browser.newContext({
          viewport: { width, height },
          colorScheme,
        }),
        page = await context.newPage();
      page.setDefaultTimeout(20000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((theme) => {
        localStorage.setItem("bckl-theme", theme);
        const apply = () => {
          document.documentElement.dataset.theme = theme;
        };
        if (document.documentElement) apply();
        else
          document.addEventListener("DOMContentLoaded", apply, { once: true });
      }, colorScheme);
      await page.goto(web + "/login");
      await page.getByLabel("Email", { exact: true }).fill(user.email);
      await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Đăng nhập", exact: true })
        .click();
      await page.waitForURL((u) => u.pathname !== "/login");
      await page.goto(web + (scope === "ADMIN" ? "/admin" : "/seller"));
      if (scope === "SELLER")
        await page
          .getByRole("button", { name: "Thống kê", exact: true })
          .click();
      const dashboard = page.getByRole("region", {
        name: "Thống kê doanh thu và hoàn tiền",
      });
      await dashboard.getByRole("table").waitFor();
      const query = async (from, to, bucket = "day") => {
        await dashboard.getByLabel("Từ ngày", { exact: true }).fill(from);
        await dashboard.getByLabel("Đến trước ngày", { exact: true }).fill(to);
        await dashboard.getByLabel("Nhóm theo").selectOption(bucket);
        await dashboard
          .getByRole("button", { name: "Xem thống kê", exact: true })
          .click();
        await dashboard.getByRole("table").waitFor();
      };
      await query("2026-01-01", "2026-02-01", "month");
      if (scope === "SELLER")
        assert.equal(
          await dashboard
            .locator("article")
            .filter({
              has: page.getByText("Doanh thu hàng hóa", { exact: true }),
            })
            .locator("strong")
            .innerText(),
          "100.000 ₫",
        );
      await dashboard
        .getByRole("button", { name: "Xem đơn cần đối chiếu", exact: true })
        .click();
      await dashboard
        .getByText("Danh sách được đọc riêng lúc", { exact: false })
        .waitFor();
      if (scope === "SELLER")
        await dashboard
          .getByText(`Đơn #${invalidOrderId}`, { exact: false })
          .waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `${scope.toLowerCase()}-${name}-january.png`),
        fullPage: true,
      });
      await query("2026-02-01", "2026-03-01", "quarter");
      if (scope === "SELLER")
        assert.equal(
          await dashboard
            .locator("article")
            .filter({ has: page.getByText("Doanh thu thuần", { exact: true }) })
            .locator("strong")
            .innerText(),
          "−100.000 ₫",
        );
      const overflow = await dashboard.evaluate(
        (e) => e.scrollWidth > e.clientWidth + 1,
      );
      assert.equal(overflow, false);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `${scope.toLowerCase()}-${name}-february.png`),
        fullPage: true,
      });
      if (scope === "ADMIN" && name === "desktop-light") {
        const pattern = `${api}/admin/dashboard?**`;
        await page.route(pattern, (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ code: "DASHBOARD_UNAVAILABLE" }),
          }),
        );
        await dashboard
          .getByRole("button", { name: "Xem thống kê", exact: true })
          .click();
        await dashboard.getByRole("alert").waitFor();
        assert.equal(await dashboard.getByRole("table").count(), 0);
        await page.unroute(pattern);
        await dashboard
          .getByRole("button", { name: "Xem thống kê", exact: true })
          .click();
        await dashboard.getByRole("table").waitFor();
        results.push({
          check: "HTTP503_clear_stale_money_and_read_retry",
          pass: true,
          fault: "Controlled HTTP response injection",
        });
      }
      assert.deepEqual(errors, []);
      results.push({ check: `${scope}-${name}`, pass: true });
      await context.close();
    }
  }
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await hashes(), beforeSource);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        results,
        sourceHashes: beforeSource,
        database: url.pathname.slice(1),
        identity: "non-superuser app role",
        monetarySourceUnchanged: true,
        limits:
          "Synthetic historical fixtures retained; real Chrome/HTTP/PG reads. HTTP503 controlled injection, no real network outage or write concurrency simulated. No claim of aftersales UI completion.",
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
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
}
