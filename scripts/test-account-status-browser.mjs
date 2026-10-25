// Actual Chrome -> Nest -> isolated PostgreSQL; faults are explicitly injected.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  "/bckl_order_resolution_test_attributes_20261019_v949",
);
assert(
  !url.hash &&
    [...url.searchParams].every(
      ([key, value]) => key === "schema" && value === "public",
    ),
);
assert(url.searchParams.getAll("schema").length <= 1);
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
const api = "http://127.0.0.1:3384",
  web = "http://127.0.0.1:5184";
process.env.FRONTEND_URL = web;
const load = (name) =>
  import(pathToFileURL(path.join(root, "BE/dist", name)).href);
const { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js"),
  { AuthService } = await load("auth/auth.service.js");
const { Test } = rb("@nestjs/testing"),
  { hash } = rb("bcryptjs");
const { createServer } = await import(pathToFileURL(rf.resolve("vite")).href),
  { default: react } = await import(
    pathToFileURL(rf.resolve("@vitejs/plugin-react")).href
  );
const pw = await import(
  pathToFileURL(path.resolve(values["playwright-module"])).href
);
const sourceFiles = [
  "BE/src/auth/account-status-command.ts",
  "BE/src/auth/account-status-recovery.service.ts",
  "BE/src/auth/auth.service.ts",
  "BE/src/auth/account-status.input.ts",
  "BE/src/auth/admin-account.controller.ts",
  "BE/prisma/migrations/20261025150000_account_status_command_receipts/migration.sql",
  "FE/src/features/admin-accounts/accountStatusApi.ts",
  "FE/src/features/admin-accounts/accountStatusPending.ts",
  "FE/src/features/admin-accounts/AdminAccountStatusWorkspace.tsx",
  "FE/src/features/admin-accounts/AdminAccountsReader.tsx",
  "FE/src/pages/AdminDashboardPage.tsx",
  "BE/prisma/schema.prisma",
  "BE/src/auth/admin-account-list.ts",
  "BE/src/auth/auth.module.ts",
  "FE/src/features/admin-accounts/AdminAccountsLayout.module.css",
  "scripts/test-account-status-browser.mjs",
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
const initialHashes = await hashes(),
  results = [];
let app, vite, browser;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication();
  configureApp(app);
  await app.listen(3384, "127.0.0.1");
  const db = app.get(PrismaService),
    auth = app.get(AuthService);
  const [identity] =
    await db.$queryRaw`SELECT current_database() AS name, rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity.name, url.pathname.slice(1));
  assert(
    !identity.rolsuper && !identity.rolcreatedb && !identity.rolcreaterole,
  );
  const [migrations] =
    await db.$queryRaw`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(migrations.n, 25);
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_ADMIN_ACCOUNT_STATUS_ENABLED":
        JSON.stringify("true"),
      "import.meta.env.VITE_API_URL": JSON.stringify(api),
    },
    server: { host: "127.0.0.1", port: 5184, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  for (const [name, width, height, colorScheme] of [
    ["desktop-light", 1440, 1000, "light"],
    ["desktop-dark", 1440, 1000, "dark"],
    ["mobile-light", 390, 844, "light"],
    ["mobile-dark", 390, 844, "dark"],
  ]) {
    const password = randomBytes(18).toString("hex"),
      passwordHash = await hash(password, 4),
      marker = randomUUID();
    const admin = await db.user.create({
      data: {
        email: `qa-status-admin-${marker}@example.invalid`,
        passwordHash,
        role: "ADMIN",
      },
    });
    const otherAdmin = await db.user.create({
      data: {
        email: `qa-status-other-${marker}@example.invalid`,
        passwordHash,
        role: "ADMIN",
      },
    });
    const target = await db.user.create({
      data: {
        email: `qa-status-seller-${marker}@example.invalid`,
        passwordHash,
        role: "SELLER",
        store: {
          create: { name: "QA Status Suspended Store", status: "SUSPENDED" },
        },
      },
    });
    const targetSession = await auth.login({ email: target.email, password }),
      adminSession = await auth.login({ email: admin.email, password });
    const context = await browser.newContext({
        viewport: { width, height },
        colorScheme,
      }),
      page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    let patches = 0,
      resolves = 0;
    const endpoint = `${api}/admin/accounts/${target.id}/status`;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (req.url() === endpoint && req.method() === "PATCH") patches++;
      if (req.url() === endpoint + "/reconcile" && req.method() === "POST")
        resolves++;
    });
    const login = async (email) => {
      await page.goto(web + "/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Đăng nhập", exact: true })
        .click();
      await page.waitForURL(url => url.pathname !== '/login');
      await page.goto(web + "/admin/users");
      await page
        .getByRole("heading", { name: "Quản lý tài khoản", exact: true })
        .waitFor();
    };
    const openTarget = async () => {
      await page
        .getByRole("searchbox", { name: "Tìm theo tên hoặc email" })
        .fill(target.email);
      await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
      await page
        .getByRole("button", {
          name: `Quản lý tài khoản #${target.id}`,
          exact: true,
        })
        .click();
      await page.getByRole("dialog").waitFor();
      await page
        .getByRole("button", { name: "Đọc lại trạng thái và lịch sử" })
        .waitFor();
      await page.waitForFunction(() => {
        const dialog = document.querySelector("dialog");
        return (
          dialog &&
          ![...dialog.querySelectorAll("button")].find(
            (b) => b.textContent === "Đọc lại trạng thái và lịch sử",
          )?.disabled
        );
      });
    };
    const confirm = async (active, reason) => {
      await page
        .getByLabel(`Lý do ${active ? "khóa" : "mở khóa"}`, { exact: true })
        .fill(reason);
      await page
        .getByLabel(
          `Tôi xác nhận ${active ? "khóa" : "mở khóa"} tài khoản #${target.id}`,
          { exact: true },
        )
        .check();
    };
    const resolve = async () => {
      await page
        .getByRole("button", {
          name: "Đối chiếu yêu cầu đang chờ",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Đối chiếu kết quả", exact: true })
        .click();
      await page.waitForFunction(
        (actorId) =>
          sessionStorage.getItem(`admin-status-pending:v1:${actorId}`) === null,
        admin.id,
      );
    };
    await login(admin.email);
    await openTarget();
    await confirm(true, "QA Chrome explicit account lock decision");
    await page
      .getByRole("button", { name: "Khóa tài khoản", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page
      .getByRole("dialog")
      .getByText("Đã khóa", { exact: true })
      .waitFor();
    assert.equal(patches, 1);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: target.id } }))
        .statusRevision,
      2,
    );
    assert.equal(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
      1,
    );
    assert.equal(
      (
        await fetch(api + "/auth/me", {
          headers: { Authorization: `Bearer ${targetSession.accessToken}` },
        })
      ).status,
      401,
    );
    await page.screenshot({
      path: path.join(output, `${name}-locked.png`),
      fullPage: false,
    });
    let drop = true;
    await page.route(endpoint, async (route) => {
      if (drop && route.request().method() === "PATCH") {
        drop = false;
        const upstream = await route.fetch();
        assert.equal(upstream.status(), 200);
        await route.abort("failed");
      } else await route.continue();
    });
    await confirm(false, "QA Chrome explicit unlock lost response");
    await page
      .getByRole("button", { name: "Mở khóa tài khoản", exact: true })
      .click();
    await page
      .getByText(
        "Chưa xác định kết quả. Hãy đối chiếu yêu cầu đang chờ; không gửi lại.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: target.id } }))
        .statusRevision,
      3,
    );
    const pendingRaw = await page.evaluate(
      (actorId) => sessionStorage.getItem(`admin-status-pending:v1:${actorId}`),
      admin.id,
    );
    assert(pendingRaw && !pendingRaw.includes("QA Chrome explicit unlock"));
    await page.screenshot({
      path: path.join(output, `${name}-unknown.png`),
      fullPage: false,
    });
    const beforeReload = patches;
    await page.reload();
    await resolve();
    assert.equal(patches, beforeReload);
    assert.equal(resolves, 1);
    assert.equal(
      (
        await fetch(api + "/auth/me", {
          headers: { Authorization: `Bearer ${targetSession.accessToken}` },
        })
      ).status,
      401,
    );
    await auth.login({ email: target.email, password });
    await page
      .getByRole("dialog")
      .getByText("Đang hoạt động", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    const delayed = await page.evaluate(
      async ({ actorId, targetId }) => {
        const journal =
          await import("/src/features/admin-accounts/accountStatusPending.ts");
        const candidate = await journal.prepareStatusPending(
          actorId,
          { id: targetId, isActive: true, statusRevision: 3 },
          false,
          "QA Chrome delayed delivery closed first",
        );
        return { value: candidate.value, reason: candidate.reason };
      },
      { actorId: admin.id, targetId: target.id },
    );
    await page.reload();
    await resolve();
    const late = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSession.accessToken}`,
      },
      body: JSON.stringify({
        commandId: delayed.value.commandId,
        expectedRevision: 3,
        isActive: false,
        reason: delayed.reason,
      }),
    });
    assert.equal(late.status, 409);
    assert.equal((await late.json()).code, "ACCOUNT_COMMAND_CLOSED");
    assert.equal(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
      2,
    );
    await page.screenshot({
      path: path.join(output, `${name}-closed.png`),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await page.evaluate(
      async ({ actorId, targetId }) => {
        const journal =
          await import("/src/features/admin-accounts/accountStatusPending.ts");
        await journal.prepareStatusPending(
          actorId,
          { id: targetId, isActive: true, statusRevision: 3 },
          false,
          "QA Chrome original actor pending before session switch",
        );
      },
      { actorId: admin.id, targetId: target.id },
    );
    await context.clearCookies();
    await login(otherAdmin.email);
    assert.equal(
      await page
        .getByRole("button", {
          name: "Đối chiếu yêu cầu đang chờ",
          exact: true,
        })
        .count(),
      0,
    );
    assert(
      await page.evaluate(
        (actorId) =>
          sessionStorage.getItem(`admin-status-pending:v1:${actorId}`) !== null,
        admin.id,
      ),
    );
    await page.screenshot({
      path: path.join(output, `${name}-other-admin.png`),
      fullPage: false,
    });
    await context.clearCookies();
    await login(admin.email);
    await resolve();
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await openTarget();
    await confirm(
      true,
      "QA Chrome stale revision should require a new decision",
    );
    const b = await auth.login({ email: otherAdmin.email, password });
    const external = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${b.accessToken}`,
      },
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedRevision: 3,
        isActive: false,
        reason: "QA other Admin wins the current revision",
      }),
    });
    assert.equal(external.status, 200);
    await page
      .getByRole("button", { name: "Khóa tài khoản", exact: true })
      .click();
    await page
      .getByText(
        "Chưa xác định kết quả. Hãy đối chiếu yêu cầu đang chờ; không gửi lại.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Đối chiếu kết quả", exact: true })
      .click();
    await page.waitForFunction(
      (actorId) =>
        sessionStorage.getItem(`admin-status-pending:v1:${actorId}`) === null,
      admin.id,
    );
    await page.getByLabel("Lý do mở khóa", { exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    assert.equal(
      await page.getByLabel("Lý do mở khóa", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
      3,
    );
    assert.equal(
      await db.accountStatusCommand.count({ where: { targetId: target.id } }),
      6,
    );
    assert.equal(
      (await db.store.findUniqueOrThrow({ where: { sellerId: target.id } }))
        .status,
      "SUSPENDED",
    );
    assert.equal(patches, 3);
    assert.equal(errors.length, 0, errors.join("; "));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false);
    await page.screenshot({
      path: path.join(output, `${name}-concurrent.png`),
      fullPage: false,
    });
    results.push({
      name,
      result: "PASS",
      doubleClick: true,
      lostReal200AfterCommit: true,
      reloadNoPatchReplay: true,
      closedBeforeLatePatch: true,
      actorJournalIsolation: true,
      twoAdminConflict: true,
      auditRows: 3,
      commandRows: 6,
      storeStatusPreserved: true,
      overflow: false,
    });
    await context.close();
  }
  assert.deepEqual(
    await hashes(),
    initialHashes,
    "Source changed during Chrome QA",
  );
} finally {
  const browserVersion = browser?.version();
  await browser?.close();
  await vite?.close();
  await app?.close();
  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        sourceHashes: initialHashes,
        dirtySource:
          execFileSync(
            "git",
            ["status", "--porcelain", "--untracked-files=no"],
            { cwd: root, encoding: "utf8" },
          ).trim().length > 0,
        browserVersion,
        database: url.pathname.slice(1),
        result: results.length === 4 ? "PASS" : "INCOMPLETE",
        results,
        limitations:
          "Controlled route.abort after real upstream200, not physical packet loss. Cookie clearing/login tests actor isolation, not logout revocation. No live AI/index or multi-process crash/load proof. Synthetic QA fixtures retained with immutable audit.",
      },
      null,
      2,
    ),
  );
}
