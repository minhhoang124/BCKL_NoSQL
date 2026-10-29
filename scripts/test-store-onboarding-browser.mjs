// Real Chrome/Nest/PostgreSQL onboarding. Synthetic identity/contact data only.
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
const integratedQa = url.pathname === "/bckl_order_resolution_test_hardening_20261029" && url.username === "bckl_local_app";
assert(integratedQa || (url.pathname === "/bckl_order_resolution_test_attributes_20261019_v953" && url.username === "bckl_qa_app_20261021"));
assert(
  !url.hash &&
    [...url.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    url.searchParams.getAll("schema").length <= 1,
);
for (const file of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, file));
    throw Error("Refusing dotenv checkout");
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
process.env.SELLER_ONBOARDING_ENABLED = "true";
process.env.ACCOUNT_BUYER_ACCESS_ENABLED = "true";
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
const api = "http://127.0.0.1:3387",
  web = "http://127.0.0.1:5187";
process.env.FRONTEND_URL = web;
const files = [
  "FE/src/features/seller-onboarding/applicationClient.ts",
  "FE/src/features/seller-onboarding/StoreApplicationPage.tsx",
  "FE/src/features/seller-onboarding/StoreApplicationPage.module.css",
  "FE/src/pages/RegisterPage.tsx",
  "FE/src/components/Header/Header.tsx",
  "FE/src/pages/AdminDashboardPage.tsx",
  "FE/src/pages/SellerDashboardPage.tsx",
  "FE/src/routes/AppRouter.tsx",
  "BE/src/store/application.service.ts",
  "BE/src/store/application-input.ts",
  "BE/src/store/store.service.ts",
  "BE/src/auth/auth.service.ts",
  "BE/prisma/migrations/20261026120000_seller_onboarding/migration.sql",
  "scripts/test-store-onboarding-browser.mjs",
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
const sourceHashes = await hashes(),
  results = [],
  contexts = [],
  pages = {},
  pageErrors = [];
let app, vite, browser;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication();
  configureApp(app);
  await app.listen(3387, "127.0.0.1");
  const db = app.get(PrismaService);
  const [role] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.name, url.pathname.slice(1));
  assert(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole);
  const [migrations] =
    await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(migrations.n, integratedQa ? 39 : 28);
  const coreTables = [
    "orders",
    "order_items",
    "payments",
    "refund_records",
    "revenue_adjustments",
    "product_variants",
    "stock_movements",
    "search_outbox",
  ];
  async function financialDigest() {
    return Object.fromEntries(
      await Promise.all(
        coreTables.map(async (table) => {
          const [r] = await db.$queryRawUnsafe(
            `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text AS data FROM ${table} t`,
          );
          return [table, createHash("sha256").update(r.data).digest("hex")];
        }),
      ),
    );
  }
  const beforeFinancial = await financialDigest();
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(api),
      "import.meta.env.VITE_SELLER_ONBOARDING_ENABLED": JSON.stringify("true"),
      "import.meta.env.VITE_ACCOUNT_BUYER_ACCESS_ENABLED":
        JSON.stringify("true"),
    },
    server: { host: "127.0.0.1", port: 5187, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const password = randomBytes(20).toString("hex"),
    passwordHash = await hash(password, 4),
    marker = randomUUID();
  const admin = await db.user.create({
    data: {
      email: `onboard-admin-${marker}@example.invalid`,
      passwordHash,
      role: "ADMIN",
      fullName: "Synthetic QA Admin",
    },
  });
  const ownerEmail = `onboard-owner-${marker}@example.invalid`;
  async function newPage(name) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
    });
    contexts.push(ctx);
    await ctx.route("**/*", (route) => {
      const origin = new URL(route.request().url()).origin;
      return [api, web].includes(origin) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) =>
      pageErrors.push({ page: name, message: e.message }),
    );
    pages[name] = page;
    return page;
  }
  async function bootstrap(page, route) {
    await page.goto(web + route);
    await page.waitForFunction(async () => {
      const m = await import("/src/services/apiClient.ts");
      return m.getAuthSessionVersion() > 0;
    });
  }
  async function login(page, email, route) {
    await bootstrap(page, "/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL((u) => u.pathname !== "/login");
    await page.goto(web + route);
  }
  const ownerPage = await newPage("OWNER"),
    adminPage = await newPage("ADMIN");
  await bootstrap(ownerPage, "/register");
  await ownerPage
    .getByLabel("Họ và tên", { exact: true })
    .fill("Synthetic QA Owner");
  await ownerPage.getByLabel("Email", { exact: true }).fill(ownerEmail);
  await ownerPage.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await ownerPage
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await ownerPage.waitForURL((u) => u.pathname !== "/register");
  const owner = await db.user.findUniqueOrThrow({
    where: { email: ownerEmail },
  });
  assert.equal(owner.role, "USER");
  assert.equal(await db.store.count({ where: { sellerId: owner.id } }), 0);
  await ownerPage.getByRole("link", { name: "Mở Store", exact: true }).click();
  await ownerPage.getByLabel("Tên Store", { exact: true }).waitFor();
  const profile = {
    "Tên Store": `Synthetic Store ${marker.slice(0, 8)}`,
    "Mô tả Store": "Synthetic browser QA Store",
    "Người liên hệ": "Synthetic QA Owner",
    "Số điện thoại liên hệ": "+84901234567",
    "Địa chỉ lấy hàng": "Synthetic pickup address 01",
    "Địa chỉ nhận hàng trả": "Synthetic return address 02",
  };
  for (const [label, value] of Object.entries(profile))
    await ownerPage.getByLabel(label, { exact: true }).fill(value);
  await ownerPage
    .getByLabel("Lý do / nội dung gửi duyệt", { exact: true })
    .fill("Synthetic QA submits a Store application");
  await ownerPage
    .getByRole("checkbox", {
      name: "Tôi xác nhận thông tin và thao tác đang chọn",
      exact: true,
    })
    .check();
  let submitPosts = 0,
    dropSubmit = true,
    storeId;
  await ownerPage.route(api + "/account/store-application", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submitPosts++;
    const upstream = await route.fetch();
    assert.equal(upstream.status(), 200);
    const response = await upstream.json();
    storeId = response.receipt.storeId;
    if (dropSubmit) {
      dropSubmit = false;
      await route.abort("failed");
    } else await route.fulfill({ response: upstream });
  });
  const lostSubmitResponse=ownerPage.waitForEvent('requestfailed',{predicate:r=>r.url()===api+'/account/store-application'&&r.method()==='POST'});
  await ownerPage
    .getByRole("button", { name: "Gửi hồ sơ", exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await lostSubmitResponse;
  await ownerPage
    .getByRole("complementary", { name: "Phục hồi yêu cầu Store", exact: true })
    .waitFor();
  assert.equal(submitPosts, 1);
  assert(Number.isInteger(storeId));
  const pendingOwner = await ownerPage.evaluate(
    (id) =>
      JSON.parse(sessionStorage.getItem(`store-application-pending:v1:${id}`)),
    owner.id,
  );
  assert.equal(pendingOwner.scope, "OWNER");
  assert.equal(pendingOwner.action, "submit");
  assert(
    !JSON.stringify(pendingOwner).includes(profile["Số điện thoại liên hệ"]),
  );
  await ownerPage.reload();
  await ownerPage
    .getByRole("checkbox", {
      name: "Tôi đồng ý đối chiếu mã đã lưu",
      exact: true,
    })
    .check();
  await ownerPage
    .getByRole("button", { name: "Đối chiếu yêu cầu", exact: true })
    .click();
  await ownerPage
    .getByText("Server đã xác nhận thao tác và ghi lịch sử.", { exact: true })
    .waitFor();
  assert.equal(
    await ownerPage.evaluate(
      (id) => sessionStorage.getItem(`store-application-pending:v1:${id}`),
      owner.id,
    ),
    null,
  );
  assert.equal(submitPosts, 1);
  assert.equal(await db.storeApplicationAudit.count({ where: { storeId } }), 1);
  results.push({
    check:
      "real_registration_USER_and_same_tick_submit_postcommit_abort_reload_reconcile_no_duplicate",
    pass: true,
    submitPosts,
    fault: "Controlled abort AFTER real upstream200, not physical packet loss",
  });
  async function version(page, n) {
    await page
      .getByText(`Store #${storeId} · phiên bản ${n}`, { exact: true })
      .waitFor();
  }
  async function decide(page, operation, reason) {
    await page.getByRole('combobox',{name:'Thao tác',exact:true}).selectOption(operation);
    await page
      .getByLabel("Lý do / nội dung gửi duyệt", { exact: true })
      .fill(reason);
    await page
      .getByRole("checkbox", {
        name: "Tôi xác nhận thông tin và thao tác đang chọn",
        exact: true,
      })
      .check();
  }
  await login(
    adminPage,
    admin.email,
    `/admin/store-applications?storeId=${storeId}`,
  );
  await version(adminPage, 1);
  await decide(
    adminPage,
    "REJECTED",
    "Synthetic QA requests corrected return contact",
  );
  await adminPage
    .getByRole("button", { name: "Ghi nhận quyết định", exact: true })
    .click();
  await version(adminPage, 2);
  await ownerPage.reload();
  await version(ownerPage, 2);
  await ownerPage
    .getByLabel("Địa chỉ nhận hàng trả", { exact: true })
    .fill("Corrected synthetic return address 03");
  await decide(
    ownerPage,
    "edit",
    "Synthetic QA corrects the declared return address",
  );
  await ownerPage
    .getByRole("button", { name: "Xác nhận thao tác", exact: true })
    .click();
  await version(ownerPage, 3);
  await decide(
    ownerPage,
    "resubmit",
    "Synthetic QA resubmits the saved corrected Store",
  );
  await ownerPage
    .getByRole("button", { name: "Xác nhận thao tác", exact: true })
    .click();
  await version(ownerPage, 4);
  assert.equal(await db.store.count({ where: { sellerId: owner.id } }), 1);
  assert.equal(await db.storeSellerGrant.count({ where: { storeId } }), 0);
  results.push({
    check: "Admin_reject_Owner_edit_resubmit_same_Store_revision_1_to_4",
    pass: true,
  });
  await adminPage.reload();
  await version(adminPage, 4);
  let approvePosts = 0,
    dropApprove = true;
  await adminPage.route(
    api + `/admin/store-applications/${storeId}/review`,
    async (route) => {
      const body = route.request().postDataJSON();
      if (body.status !== "ACTIVE" || !dropApprove) return route.continue();
      approvePosts++;
      const upstream = await route.fetch();
      assert.equal(upstream.status(), 200);
      const result = await upstream.json();
      assert.equal(result.receipt.reauthenticationRequired, true);
      dropApprove = false;
      await route.abort("failed");
    },
  );
  await decide(
    adminPage,
    "ACTIVE",
    "Synthetic QA approves this complete Store profile",
  );
  const lostApproveResponse=adminPage.waitForEvent('requestfailed',{predicate:r=>r.url()===api+`/admin/store-applications/${storeId}/review`&&r.method()==='POST'});
  await adminPage
    .getByRole("button", { name: "Ghi nhận quyết định", exact: true })
    .click();
  await lostApproveResponse;
  await adminPage
    .getByRole("complementary", { name: "Phục hồi yêu cầu Store", exact: true })
    .waitFor();
  assert.equal(approvePosts, 1);
  await adminPage.reload();
  await version(adminPage, 5);
  await adminPage
    .getByRole("checkbox", {
      name: "Tôi đồng ý đối chiếu mã đã lưu",
      exact: true,
    })
    .check();
  await adminPage
    .getByRole("button", { name: "Đối chiếu yêu cầu", exact: true })
    .click();
  await adminPage
    .getByText(
      "Đã duyệt và cấp quyền bán. Chủ tài khoản cần đăng nhập lại để tiếp tục.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await db.storeSellerGrant.count({ where: { storeId } }), 1);
  assert.equal(
    await db.accountSecurityEvent.count({
      where: { userId: owner.id, event: "SELLER_GRANTED" },
    }),
    1,
  );
  assert.equal(
    await db.refreshToken.count({
      where: { userId: owner.id, revokedAt: null },
    }),
    0,
  );
  results.push({
    check:
      "Admin_approve_postcommit_abort_reload_explicit_receipt_single_grant_and_session_rotation",
    pass: true,
    approvePosts,
  });
  await login(ownerPage, owner.email, "/account/store-application");
  await version(ownerPage, 5);
  await ownerPage
    .getByRole("link", { name: "Kênh người bán", exact: true })
    .waitFor();
  await ownerPage
    .getByRole("link", { name: "Giỏ hàng", exact: true })
    .waitFor();
  await ownerPage
    .getByRole("link", { name: "Kênh người bán", exact: true })
    .click();
  await ownerPage
    .getByRole("link", { name: "Mở hồ sơ Store", exact: true })
    .waitFor();
  const cartRead = ownerPage.waitForResponse(
    (r) =>
      r.url().startsWith(api + "/cart") && r.request().method() === "GET",
  );
  await ownerPage.getByRole("link", { name: "Giỏ hàng", exact: true }).click();
  assert.equal((await cartRead).status(), 200);
  results.push({
    check: "fresh_login_SELLER_portal_and_Buyer_cart_remain_accessible",
    pass: true,
    limits: "Cart read only; not checkout/COD proof",
  });
  await decide(
    adminPage,
    "SUSPENDED",
    "Synthetic QA temporarily suspends the Store",
  );
  await adminPage
    .getByRole("button", { name: "Ghi nhận quyết định", exact: true })
    .click();
  await version(adminPage, 6);
  await ownerPage.goto(web + "/account/store-application");
  await version(ownerPage, 6);
  assert(await ownerPage.getByLabel("Tên Store", { exact: true }).isDisabled());
  await decide(
    adminPage,
    "ACTIVE",
    "Synthetic QA restores the previously granted Store",
  );
  await adminPage
    .getByRole("button", { name: "Ghi nhận quyết định", exact: true })
    .click();
  await version(adminPage, 7);
  await ownerPage.reload();
  await version(ownerPage, 7);
  assert.equal(await db.storeSellerGrant.count({ where: { storeId } }), 1);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
      .credentialVersion,
    2,
  );
  assert.equal(await db.storeApplicationAudit.count({ where: { storeId } }), 7);
  assert.equal(await db.storeStatusHistory.count({ where: { storeId } }), 6);
  assert.equal(
    await db.searchReconciliationJob.count({
      where: { scope: "STORE", scopeId: storeId },
    }),
    3,
  );
  results.push({
    check:
      "suspension_owner_write_block_and_Admin_restore_no_duplicate_grant_or_session_rotation",
    pass: true,
  });
  for (const [name, page] of Object.entries(pages))
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      const section = page.getByRole("region", {
        name: name === "OWNER" ? "Đăng ký và hồ sơ Store" : "Duyệt hồ sơ Store",
        exact: true,
      });
      assert(await section.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
      await page.screenshot({
        path: path.join(output, `${name.toLowerCase()}-${size}-light.png`),
        fullPage: true,
      });
      results.push({
        check: `${name}_${size}_light_profile_history_no_region_overflow`,
        pass: true,
      });
    }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(await financialDigest(), beforeFinancial);
  assert.deepEqual(await hashes(), sourceHashes);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        results,
        database: url.pathname.slice(1),
        migrations: integratedQa ? 39 : 28,
        appRole: "non-superuser/no-CREATEDB/no-CREATEROLE",
        storeId,
        sourceHashes,
        financialCoreUnchanged: true,
        limits:
          "Synthetic accounts/contact data. Controlled response abort after real upstream200, not physical network loss. Browser Admin flows sequential; concurrency tested separately on HTTP/PostgreSQL. Cart read is not checkout/COD. Light desktop/mobile, no dark acceptance. Data retained; no demo/reset or real identity verification.",
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
  for (const [name, page] of Object.entries(pages)) {
    await page
      .screenshot({
        path: path.join(output, `${name.toLowerCase()}-failure.png`),
        fullPage: true,
      })
      .catch(() => {});
    await writeFile(
      path.join(output, `${name.toLowerCase()}-failure.txt`),
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
  throw error;
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close()));
  await browser?.close();
  await vite?.close();
  await app?.close();
}
