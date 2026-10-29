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
  ["/bckl_order_resolution_test_attributes_20261019_v977"].includes(
    url.pathname,
  ),
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
  "BE/src/search/search-analytics.service.ts",
  "FE/src/services/searchAnalyticsClient.ts",
  "FE/src/services/searchTelemetry.tsx",
  "FE/src/features/SearchAnalytics.tsx",
  "scripts/test-search-analytics-browser.mjs",
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
let app, vite, browser, lastPage;
const { createServer: makeHttpServer } = await import("node:http");
let hitIds = [];
const fakeAi = makeHttpServer(async (req, res) => {
  let input = "";
  for await (const part of req) {
    input += part;
    if (input.length > 6 * 1024 * 1024) {
      res.writeHead(413);
      res.end();
      return;
    }
  }
  res.setHeader("Content-Type", "application/json");
  const image = req.url === "/search/image";
  res.end(
    JSON.stringify({
      query: image
        ? { type: "image", topK: 24, candidateK: 100 }
        : { type: "hybrid_text", text: JSON.parse(input).query },
      items: hitIds.map((productId, i) => ({
        productId,
        rank: i + 1,
        score: 1,
      })),
      responseTimeMs: 1,
    }),
  );
});
await new Promise((resolve, reject) => {
  fakeAi.once("error", reject);
  fakeAi.listen(3398, "127.0.0.1", resolve);
});
process.env.AI_SERVICE_URL = "http://127.0.0.1:3398";
process.env.SEARCH_ANALYTICS_ENABLED = "true";
process.env.SEARCH_ANALYTICS_START_AT = "2026-01-01T00:00:00.000Z";
process.env.SEARCH_ANALYTICS_RETENTION_ENABLED = "false";
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
  assert.equal(migrations.n, 38);
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(api),
      "import.meta.env.VITE_IMAGE_SEARCH_ENABLED": JSON.stringify("true"),
    },
    server: { host: "127.0.0.1", port: 5189, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const marker = randomUUID(),
    password = "Synthetic-analytics-Chrome-QA-2026",
    passwordHash = await hash(password, 4);
  async function owner(role = "SELLER") {
    const user = await db.user.create({
      data: {
        email: "analytics-chrome-" + randomUUID() + "@example.invalid",
        passwordHash,
        role,
      },
    });
    if (role === "ADMIN") return { user };
    const store = await db.store.create({
      data: {
        sellerId: user.id,
        name: "QA · Gian hàng tìm kiếm",
        status: "ACTIVE",
      },
    });
    const category = await db.category.create({
      data: { name: "QA Audio", slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "Tai nghe QA " + user.id,
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: {
          create: { url: "/uploads/analytics-fixture.svg", isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: randomUUID(),
            optionSignature: "[]",
            price: "20000.00",
            stock: 5,
          },
        },
      },
    });
    return { user, store, product };
  }
  const a = await owner(),
    b = await owner(),
    admin = await owner("ADMIN");
  hitIds = [a.product.id, b.product.id];
  const businessBefore = [
    await db.order.count(),
    await db.stockMovement.count(),
    await db.searchOutbox.count(),
  ];
  async function waitFor(check) {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Bounded analytics acknowledgement wait failed");
  }
  const shots = [];
  for (const [name, viewport, colorScheme] of [
    ["desktop-light", { width: 1440, height: 1000 }, "light"],
    ["mobile-dark", { width: 390, height: 844 }, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport,
      colorScheme,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    lastPage = page;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/uploads/analytics-fixture.svg", (r) =>
      r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#eef2ff"/><text x="140" y="130" fill="#b54114" font-size="30">QA Audio</text></svg>',
      }),
    );
    const searchResponses = [];
    page.on("response", (response) => {
      if (
        response.url() === api + "/search/hybrid" &&
        response.request().method() === "POST"
      )
        searchResponses.push(
          response
            .json()
            .then((body) => (response.ok() ? body : null))
            .catch(() => null),
        );
    });
    const impressionRequest = page.waitForRequest((request) => {
      if (
        request.url() !== api + "/search/events" ||
        request.method() !== "POST"
      )
        return false;
      const body = request.postDataJSON();
      return body?.event === "IMPRESSION" && body.productId === a.product.id;
    });
    await page.goto(web + "/?q=QA");
    const card = page
      .getByRole("link", { name: a.product.name, exact: true })
      .last();
    await card.scrollIntoViewIfNeeded();
    // StrictMode can dispatch two initial searches; only the last result is
    // rendered. Correlate the real viewport acknowledgement with its response,
    // rather than waiting on an abandoned first response's unused capability.
    const displayedToken = (await impressionRequest).postDataJSON().token;
    assert.match(displayedToken, /^[A-Za-z0-9_-]{43}$/);
    await waitFor(async () => {
      for (const captured of searchResponses) {
        const body = await captured;
        if (
          body?.analytics?.token === displayedToken &&
          Array.isArray(body.items) &&
          body.items.some((item) => item.productId === a.product.id)
        )
          return true;
      }
      return false;
    });
    const tokenHash = createHash("sha256").update(displayedToken).digest("hex");
    const row = await db.searchLog.findUniqueOrThrow({ where: { tokenHash } });
    await waitFor(async () =>
      Boolean(
        (
          await db.searchResultLog.findUnique({
            where: {
              searchId_productId: { searchId: row.id, productId: a.product.id },
            },
          })
        )?.impressionAt,
      ),
    );
    const shot = name + "-search.png";
    await page.screenshot({ path: path.join(output, shot), fullPage: true });
    shots.push(shot);
    await card.click();
    await page.waitForURL("**/products/" + a.product.id);
    await waitFor(async () =>
      Boolean(
        await db.clickLog.findUnique({
          where: {
            searchId_productId: { searchId: row.id, productId: a.product.id },
          },
        }),
      ),
    );
    results.push({
      scenario: name + " real viewport → click → PostgreSQL",
      result: "PASS",
    });
    // Actual upload/decode/hydrate and cookie binding; AI retrieval is deliberately synthetic.
    await page.goto(web + "/search/image");
    // Use sharp to generate a valid local query rather than relying on a truncated sample.
    const png = await rb("sharp")({
      create: { width: 4, height: 4, channels: 3, background: "#c95a18" },
    })
      .png()
      .toBuffer();
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: "synthetic-query.png",
        mimeType: "image/png",
        buffer: png,
      });
    const imageResponse = page.waitForResponse(
      (r) =>
        r.url() === api + "/search/image" && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Tìm bằng ảnh", exact: true })
      .click();
    const imageResult = await (await imageResponse).json();
    assert(imageResult.analytics?.token);
    const imageLog = await db.searchLog.findUniqueOrThrow({
      where: {
        tokenHash: createHash("sha256")
          .update(imageResult.analytics.token)
          .digest("hex"),
      },
    });
    const imageCard = page
      .getByRole("link", { name: a.product.name, exact: true })
      .last();
    await imageCard.scrollIntoViewIfNeeded();
    await imageCard.click();
    await waitFor(async () =>
      Boolean(
        await db.clickLog.findUnique({
          where: {
            searchId_productId: {
              searchId: imageLog.id,
              productId: a.product.id,
            },
          },
        }),
      ),
    );
    results.push({
      scenario:
        name + " image upload → synthetic AI → canonical Product → click",
      result: "PASS",
    });
    await page.goto(web + "/login");
    await page.getByLabel("Email", { exact: true }).fill(a.user.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL(web + "/");
    await page.goto(web + "/seller");
    await page.getByRole("button", { name: "Thống kê", exact: true }).click();
    await page
      .getByRole("button", { name: "Xem thống kê tìm kiếm", exact: true })
      .click();
    await page.getByRole("cell", { name: "Bằng ảnh", exact: true }).waitFor();
    const section = page.getByRole("region", { name: "Thống kê tìm kiếm" });
    await section
      .getByText("Chỉ thống kê sản phẩm của cửa hàng bạn.", { exact: false })
      .waitFor();
    const reportShot = name + "-seller-analytics.png";
    await page.screenshot({
      path: path.join(output, reportShot),
      fullPage: true,
    });
    shots.push(reportShot);
    assert.deepEqual(errors, []);
    results.push({
      scenario: name + " password login → own Store analytics reader",
      result: "PASS",
    });
    await context.close();
  }
  assert.deepEqual(
    [
      await db.order.count(),
      await db.stockMovement.count(),
      await db.searchOutbox.count(),
    ],
    businessBefore,
  );
  assert.deepEqual(await hashes(), beforeSource);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        date: "2026-10-28",
        sourceHashes: beforeSource,
        results,
        shots,
        limits: [
          "AI retrieval uses local synthetic provider, not loaded model/index or ranking-quality proof",
          "Seeds are synthetic QA users/catalog; actual HTTP Search/hydrate and viewport/click handling",
          "No external provider, no demo DB, no secret persisted",
        ],
        businessUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      groups: results.length,
      screenshots: shots.length,
      report: path.join(output, "report.json"),
    }),
  );
} catch (e) {
  if (lastPage) {
    await lastPage
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, "failure.txt"),
      String(e.message) +
        "\n" +
        (await lastPage
          .locator("body")
          .innerText()
          .catch(() => "")),
    );
  }
  throw e;
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
  await new Promise((resolve) => fakeAi.close(resolve));
}
