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
assert(
  [
    "/bckl_order_resolution_test_attributes_20261019_v951",
    "/bckl_order_resolution_test_attributes_20261019_v971",
  ].includes(url.pathname),
);
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
  "BE/src/store/public-store.controller.ts",
  "FE/src/features/public-store/PublicStorePage.tsx",
  "FE/src/features/public-store/publicStoreApi.ts",
  "scripts/test-public-store-browser.mjs",
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
const api = "http://127.0.0.1:3389",
  web = "http://127.0.0.1:5189";
process.env.FRONTEND_URL = web;
let app, vite, browser;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication();
  configureApp(app);
  await app.listen(3389, "127.0.0.1");
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
    server: { host: "127.0.0.1", port: 5189, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const marker = randomUUID();
  const seller = await db.user.create({
    data: {
      email: `public-store-${marker}@example.invalid`,
      passwordHash: "NO_LOGIN_QA",
      role: "SELLER",
    },
  });
  const store = await db.store.create({
    data: {
      sellerId: seller.id,
      name: "BCKL · Cửa hàng trải nghiệm QA",
      description:
        "Sản phẩm minh họa cho kiểm thử cửa hàng công khai.\nThông tin được đọc trực tiếp từ PostgreSQL QA.",
      status: "ACTIVE",
    },
  });
  const emptySeller = await db.user.create({
    data: {
      email: `public-empty-${marker}@example.invalid`,
      passwordHash: "NO_LOGIN_QA",
      role: "SELLER",
    },
  });
  const empty = await db.store.create({
    data: {
      sellerId: emptySeller.id,
      name: "Cửa hàng QA chưa có sản phẩm",
      status: "ACTIVE",
    },
  });
  const category = await db.category.create({
    data: { name: "Đồ dùng QA", slug: marker },
  });
  for (let i = 0; i < 26; i++) {
    const p = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: `Sản phẩm QA ${String(i + 1).padStart(2, "0")}`,
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    await db.productVariant.create({
      data: {
        productId: p.id,
        storeId: store.id,
        skuCode: randomUUID(),
        optionSignature: "[]",
        price: "10000",
        stock: i === 0 ? 0 : 2,
      },
    });
    // A tiny local vector fixture served only to this Chrome context. No external image/network.
    await db.productImage.create({
      data: {
        productId: p.id,
        url: "/uploads/public-store-qa.svg",
        isPrimary: true,
      },
    });
  }
  const counts = async () => [
    await db.order.count(),
    await db.stockMovement.count(),
    await db.searchOutbox.count(),
    await db.searchReconciliationJob.count(),
  ];
  const baseline = await counts();
  for (const [name, viewport, colorScheme] of [
    ["desktop-light", { width: 1440, height: 1000 }, "light"],
    ["desktop-dark", { width: 1440, height: 1000 }, "dark"],
    ["mobile-light", { width: 390, height: 844 }, "light"],
    ["mobile-dark", { width: 390, height: 844 }, "dark"],
  ]) {
    const context = await browser.newContext({ viewport, colorScheme });
    const page = await context.newPage(),
      errors = [],
      writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        r.url().startsWith(api) &&
        r.method() !== "GET" &&
        r.method() !== "OPTIONS" &&
        new URL(r.url()).pathname !== "/auth/refresh"
      )
        writes.push({ method: r.method(), path: new URL(r.url()).pathname });
    });
    await page.route("**/uploads/public-store-qa.svg", (r) =>
      r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#edf4fc"/><rect x="140" y="55" width="120" height="150" rx="18" fill="#c84916"/><text x="200" y="140" text-anchor="middle" fill="white" font-size="22">QA</text></svg>',
      }),
    );
    await page.goto(`${web}/stores/${store.id}`);
    await page
      .getByRole("heading", { name: store.name, exact: true })
      .waitFor();
    await page.locator("article").first().waitFor();
    assert.equal(await page.locator("article").count(), 24);
    assert.equal(await page.getByText("Hết hàng", { exact: true }).count(), 1);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(output, `${name}-profile.png`),
      fullPage: false,
    });
    await page
      .getByRole("button", { name: "Tải thêm sản phẩm", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll("article").length === 26,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Tải thêm sản phẩm", exact: true })
        .count(),
      0,
    );
    if (name === "desktop-light") {
      await page.goto(`${web}/stores/${empty.id}`);
      await page
        .getByText("Cửa hàng chưa có sản phẩm đang bán công khai.", {
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: path.join(output, "empty-shop.png"),
        fullPage: true,
      });
      await db.store.update({
        where: { id: empty.id },
        data: { status: "SUSPENDED" },
      });
      await page.reload();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.getByRole("heading", { name: empty.name }).count(),
        0,
      );
      await page.screenshot({
        path: path.join(output, "hidden-shop.png"),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    results.push({
      check: name,
      pass: true,
      initialProducts: 24,
      finalProducts: 26,
      noOverflow: true,
      noBrowserWrites: true,
    });
    await context.close();
  }
  assert.deepEqual(await counts(), baseline);
  assert.deepEqual(await hashes(), beforeSource);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        results,
        sourceHashes: beforeSource,
        database: url.pathname.slice(1),
        limits:
          "Synthetic catalog on restricted PostgreSQL QA; real Chrome/HTTP. Image is a controlled SVG fixture. Store suspension is explicit QA setup. No real seller/customer data or provider acceptance.",
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
