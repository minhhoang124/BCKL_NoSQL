// Real Chrome -> production Admin route -> Nest -> isolated PostgreSQL.
// The private upstream is an explicit HTTP503 fault fixture, NOT live FastAPI.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    output: { type: "string" },
  },
});
assert(values.output && values["playwright-module"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new URL(process.env.DATABASE_URL ?? "");
assert.equal(db.protocol, "postgresql:");
assert.equal(db.hostname, "127.0.0.1");
assert.equal(db.port, "5549");
assert.equal(
  db.pathname,
  "/bckl_order_resolution_test_health_ui_20261023_v918",
);
assert(
  !db.hash &&
    [...db.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    db.searchParams.getAll("schema").length <= 1,
);
for (const file of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, file));
    throw Error("Refuse local dotenv override");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const reqBE = createRequire(path.join(root, "BE/package.json"));
const reqFE = createRequire(path.join(root, "FE/package.json"));
reqBE("reflect-metadata");
const { Test } = reqBE("@nestjs/testing");
const load = (name) =>
  import(pathToFileURL(path.join(root, "BE/dist", name)).href);
const { AppModule } = await load("app.module.js");
const { configureApp } = await load("configure-app.js");
const { PrismaService } = await load("prisma.service.js");
const { chromium } = reqBE(path.resolve(values["playwright-module"]));
const { createServer } = await import(
  pathToFileURL(reqFE.resolve("vite")).href
);
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const marker = `health-web-${randomUUID().slice(0, 12)}`;
const password = `Qa-${randomUUID()}!`,
  internalToken = randomUUID();
const frontend = "http://127.0.0.1:5196";
const results = [],
  screenshots = [];
let app,
  vite,
  browser,
  p,
  api,
  activePage,
  browserVersion,
  upstreamRequests = 0;
const upstream = httpServer((request, response) => {
  upstreamRequests++;
  assert.equal(request.url, "/internal/health/search");
  assert.equal(request.headers["x-internal-health-token"], internalToken);
  response.writeHead(503, { "Content-Type": "application/json" });
  response.end('{"error":"explicit QA unavailable fixture"}');
});
async function businessSnapshot() {
  return Object.fromEntries(
    await Promise.all(
      [
        "product",
        "order",
        "searchOutbox",
        "searchReconciliationJob",
        "categoryAttributeAudit",
        "stockMovement",
        "orderCommand",
        "orderCommandResolution",
      ].map(async (model) => [model, await p[model].count()]),
    ),
  );
}
async function login(page, user) {
  await page.goto(frontend + "/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page
    .getByRole("button", { name: "Đăng xuất", exact: true })
    .first()
    .waitFor();
}
async function open(user, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const requests = [],
    errors = [];
  page.on("request", (request) => {
    if (request.url() === api + "/admin/system-health")
      requests.push(request.method());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  activePage = page;
  if (user) await login(page, user);
  return { context, page, requests, errors };
}
async function health(page) {
  await page.goto(frontend + "/admin/system-health");
  const region = page.getByRole("region", {
    name: "Sức khỏe hệ thống",
    exact: true,
  });
  await region.getByText("Nguồn dữ liệu nghiệp vụ", { exact: true }).waitFor();
  assert.equal(await region.getByText("Sẵn sàng", { exact: true }).count(), 1);
  assert.equal(
    await region.getByText("Chưa xác định", { exact: true }).count(),
    1,
  );
  await region
    .getByText("Không kết nối được AI service", { exact: true })
    .waitFor();
  await region
    .getByText(
      "Chưa có snapshot AI hợp lệ; không suy đoán trạng thái từng nhánh.",
      { exact: true },
    )
    .waitFor();
  return region;
}
async function record(name, session, extra = {}) {
  assert.deepEqual(session.errors, []);
  const bounds = await session.page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(bounds.scroll <= bounds.width, `Horizontal overflow: ${name}`);
  const filename = name + ".png";
  await session.page.screenshot({
    path: path.join(output, filename),
    fullPage: true,
  });
  screenshots.push(filename);
  results.push({
    name,
    result: "PASS",
    requests: [...session.requests],
    bounds,
    ...extra,
  });
  console.log(`PASS ${name}`);
}
try {
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  Object.assign(process.env, {
    FRONTEND_URL: frontend,
    AI_SERVICE_URL: `http://127.0.0.1:${upstream.address().port}`,
    SEARCH_INTERNAL_HEALTH_TOKEN: internalToken,
    SEARCH_SYNC_ENABLED: "false",
    SEARCH_RECONCILIATION_ENABLED: "false",
    PRODUCT_IMAGE_REPAIR_ENABLED: "false",
    ORDER_AUTO_COMPLETE_ENABLED: "false",
  });
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  api = await app.getUrl();
  p = app.get(PrismaService);
  const target = await p.$queryRawUnsafe(
    "SELECT current_database() AS name, current_user AS actor",
  );
  assert.equal(target[0].name, db.pathname.slice(1));
  assert.equal(target[0].actor, decodeURIComponent(db.username));
  const passwordHash = await reqBE("bcryptjs").hash(password, 10);
  const actor = (role, suffix) =>
    p.user.create({
      data: {
        role,
        email: `${marker}-${suffix}@example.test`,
        passwordHash,
      },
    });
  const admin = await actor("ADMIN", "admin"),
    buyer = await actor("USER", "buyer");
  const before = await businessSnapshot();
  process.env.VITE_API_URL = api;
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5196, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  browserVersion = browser.version();
  for (const mobile of [false, true])
    for (const colorScheme of ["light", "dark"]) {
      const session = await open(admin, {
        colorScheme,
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
      });
      const region = await health(session.page);
      const response = session.page.waitForResponse(
        api + "/admin/system-health",
      );
      await region
        .getByRole("button", { name: "Cập nhật ngay", exact: true })
        .click();
      assert.equal((await response).status(), 200);
      await region
        .getByRole("button", { name: "Cập nhật ngay", exact: true })
        .waitFor();
      await record(
        `${mobile ? "mobile" : "desktop"}-${colorScheme}-real-503-upstream`,
        session,
      );
      await session.context.close();
    }
  for (const [user, name] of [
    [null, "guest"],
    [buyer, "buyer"],
  ]) {
    const session = await open(user);
    await session.page.goto(frontend + "/admin/system-health");
    await session.page.waitForURL((url) => !url.pathname.startsWith("/admin"));
    assert.equal(
      await session.page
        .getByRole("region", { name: "Sức khỏe hệ thống", exact: true })
        .count(),
      0,
    );
    assert.equal(session.requests.length, 0);
    await record(`${name}-no-admin-health-request`, session);
    await session.context.close();
  }
  // Test real 401 and 403 independently, across an actual production 30s poll period.
  const revoked = [];
  for (const status of [401, 403]) {
    const user = await actor("ADMIN", `revoke-${status}`),
      session = await open(user);
    const region = await health(session.page);
    await p.user.update({
      where: { id: user.id },
      data: status === 401 ? { isActive: false } : { role: "USER" },
    });
    const response = session.page.waitForResponse(api + "/admin/system-health");
    await region
      .getByRole("button", { name: "Cập nhật ngay", exact: true })
      .click();
    assert.equal((await response).status(), status);
    await region.getByRole("alert").waitFor();
    assert(await region.getByRole("button").isDisabled());
    assert.equal(
      await region
        .getByText("Nguồn dữ liệu nghiệp vụ", { exact: true })
        .count(),
      0,
    );
    revoked.push({
      status,
      session,
      at: Date.now(),
      count: session.requests.length,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 31500));
  for (const { status, session, at, count } of revoked) {
    assert.equal(
      session.requests.length,
      count,
      "Auth error must latch polling off",
    );
    await record(`real-${status}-poll-latched`, session, {
      observedStoppedMs: Date.now() - at,
    });
    await session.context.close();
  }
  {
    const session = await open(admin);
    await health(session.page);
    let release, reached;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      reached = resolve;
    });
    await session.page.route(api + "/admin/system-health", async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      reached();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* logout aborted this response */
      }
    });
    await session.page
      .getByRole("button", { name: "Cập nhật ngay", exact: true })
      .click();
    await started;
    await session.page
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .first()
      .click();
    await session.page.waitForURL("**/login");
    await login(session.page, buyer);
    release();
    await session.page.goto(frontend + "/admin/system-health");
    await session.page.waitForURL((url) => !url.pathname.startsWith("/admin"));
    assert.equal(
      await session.page
        .getByRole("region", { name: "Sức khỏe hệ thống", exact: true })
        .count(),
      0,
    );
    await record("held-real-response-logout-buyer", session);
    await session.context.close();
  }
  {
    const session = await open(admin);
    await session.page.route(api + "/admin/system-health", async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.fulfill({
        response,
        json: { ...(await response.json()), extra: true },
      });
    });
    await session.page.goto(frontend + "/admin/system-health");
    const region = session.page.getByRole("region", {
      name: "Sức khỏe hệ thống",
      exact: true,
    });
    await region
      .getByRole("alert")
      .filter({ hasText: "không đúng contract" })
      .waitFor();
    assert.equal(
      await region
        .getByText("Nguồn dữ liệu nghiệp vụ", { exact: true })
        .count(),
      0,
    );
    await record("malformed-real-200-rejected", session);
    await session.context.close();
  }
  assert(upstreamRequests > 0);
  assert.deepEqual(
    await businessSnapshot(),
    before,
    "Health GET must not mutate business data",
  );
  assert.equal(results.length, 10);
  console.log("ADMIN HEALTH PRODUCTION CHROME 10/10 PASS");
} catch (error) {
  results.push({ name: "run", result: "FAIL", message: error.message });
  if (activePage && !activePage.isClosed())
    await activePage
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  const evidence = {
    marker,
    browserVersion,
    headless: true,
    results,
    screenshots,
    upstreamRequests,
    limitations: [
      "Synthetic actors on isolated QA DB; no demo data",
      "Real Backend and PostgreSQL; HTTP503 upstream fault fixture, NOT live FastAPI or loaded ES/FAISS",
      "Mobile viewport emulation, not physical phone",
      "Dark OS with intentional light Admin theme",
      "Snapshot expiry covered by unit tests; no browser claim of a loaded READY AI snapshot",
      "Fixtures retained; no passwords/tokens/cookies saved",
    ],
  };
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(evidence, null, 2),
  );
  const escape = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  await writeFile(
    path.join(output, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>Admin health — real Chrome QA</title><style>body{font:16px system-ui;max-width:1000px;margin:auto;padding:24px}img{max-width:100%}pre{white-space:pre-wrap}</style><h1>Admin health — isolated real Chrome/Nest/PostgreSQL</h1><pre>${escape(JSON.stringify(evidence, null, 2))}</pre>${screenshots.map((name) => `<h2>${escape(name)}</h2><img src="${escape(name)}" alt="${escape(name)}">`).join("")}`,
  );
  await browser?.close();
  await vite?.close();
  await app?.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
