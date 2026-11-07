// Real Chrome -> Nest -> private PostgreSQL. Delivered orders are synthetic fixtures.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
assert.equal(url.username, "bckl_local_app");
assert.match(url.pathname, /^\/bckl_order_resolution_test_aftersales_20261031_[0-9]{13}$/);
assert(url.pathname.slice(1).length <= 63);
assert(
  !url.hash &&
    [...url.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    url.searchParams.getAll("schema").length <= 1,
);
for (const f of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, f));
    throw Error("Refusing dotenv");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
for (const f of [
  "SEARCH_SYNC_ENABLED",
  "SEARCH_RECONCILIATION_ENABLED",
  "PRODUCT_IMAGE_REPAIR_ENABLED",
  "ORDER_AUTO_COMPLETE_ENABLED",
])
  assert.equal(process.env[f], "false");
process.env.AFTERSALE_REQUEST_WINDOW_DAYS = "7";
Object.assign(process.env, {
  NODE_ENV: "test", AUTH_EMAIL_ENABLED: "false", AUTH_GOOGLE_ENABLED: "false",
  AUTH_PHONE_OTP_SANDBOX_ENABLED: "false", VNPAY_SANDBOX_ENABLED: "false",
  NOTIFICATION_EMAIL_ENABLED: "false", NOTIFICATION_EMAIL_WORKER_ENABLED: "false",
  EMAIL_NOTIFICATION_WORKER_ENABLED: "false", VITE_AUTH_EMAIL_ENABLED: "false",
  VITE_AUTH_GOOGLE_ENABLED: "false", VITE_VNPAY_SANDBOX_ENABLED: "false",
});
const output = path.resolve(values.output);
assert(output.toLowerCase() !== root.toLowerCase() &&
  !output.toLowerCase().startsWith(root.toLowerCase() + path.sep),
  "Private output must be outside checkout");
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
  { PrismaService } = await load("prisma.service.js"),
  { AuthService } = await load("auth/auth.service.js");
const { createServer } = await import(pathToFileURL(rf.resolve("vite")).href),
  { default: react } = await import(
    pathToFileURL(rf.resolve("@vitejs/plugin-react")).href
  );
const pw = await import(
  pathToFileURL(path.resolve(values["playwright-module"])).href
);
const api = "http://127.0.0.1:3386",
  web = "http://127.0.0.1:5186";
process.env.FRONTEND_URL = web;
async function sourceTree(relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceTree(path.join(relative, entry.name))
    : path.join(relative, entry.name)))).flat();
}
const migrationNames = (await readdir(path.join(root, "BE/prisma/migrations"), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const sourceFiles = [...new Set([...(await sourceTree("FE/src")), ...(await sourceTree("BE/src")),
  "FE/src/features/aftersales/aftersaleIntent.ts",
  "FE/src/features/aftersales/aftersaleApi.ts",
  "FE/src/features/aftersales/AftersalesPage.tsx",
  "FE/src/features/aftersales/AftersalesPage.module.css",
  "FE/src/routes/AppRouter.tsx",
  "FE/src/pages/AdminDashboardPage.tsx",
  "FE/src/pages/SellerDashboardPage.tsx",
  "FE/src/features/order-readiness/OrderPanels.tsx",
  "scripts/test-final-aftersales-browser.mjs",
])].sort();
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (f) => [
        f,
        createHash("sha256")
          .update(await readFile(path.join(root, f)))
          .digest("hex"),
      ]),
    ),
  );
const initialHashes = await hashes(),
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
  await app.listen(3386, "127.0.0.1");
  const db = app.get(PrismaService),
    auth = app.get(AuthService);
  const [role] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.name, url.pathname.slice(1));
  assert(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole);
  const [runtimeRole] = await db.$queryRaw`SELECT current_user AS name, has_schema_privilege(current_user, 'public', 'CREATE') AS ddl`;
  assert.equal(runtimeRole.name, "bckl_local_app");
  assert.equal(runtimeRole.ddl, false);
  const appliedMigrations = await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(appliedMigrations.map(row => row.migration_name), migrationNames);
  assert.equal(await db.user.count(), 0, "Fresh isolated QA database required");
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(api),
      "import.meta.env.VITE_AFTERSALES_ENABLED": JSON.stringify("true"),
    },
    server: { host: "127.0.0.1", port: 5186, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const password = randomBytes(20).toString("hex"),
    passwordHash = await hash(password, 4),
    marker = randomUUID();
  const actor = (role) =>
    db.user.create({
      data: {
        email: `qa-af-${role.toLowerCase()}-${randomUUID()}@example.invalid`,
        passwordHash,
        role,
        fullName: "Synthetic Aftersales QA",
      },
    });
  const buyer = await actor("USER"),
    seller = await actor("SELLER"),
    admin = await actor("ADMIN"),
    peer = await actor("ADMIN");
  const store = await db.store.create({
    data: {
      sellerId: seller.id,
      name: "Synthetic Aftersales Store",
      status: "SUSPENDED",
    },
  });
  const category = await db.category.create({
    data: { name: marker, slug: marker },
  });
  async function fixture(label) {
    const sku = randomUUID(),
      product = await db.product.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name: `QA ${label}`,
        },
      });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        skuCode: sku,
        optionSignature: "[]",
        price: "50000.00",
        stock: 5,
      },
    });
    const checkout = await db.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: randomUUID(),
        requestHash: "synthetic-af-browser",
      },
    });
    const deliveredAt = new Date(Date.now() - 86400000),
      createdAt = new Date(Date.now() - 2 * 86400000);
    const order = await db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store.id,
        orderNumber: randomUUID(),
        status: "DELIVERED",
        deliveredAt,
        createdAt,
        recipientNameSnapshot: "Private QA recipient",
        phoneSnapshot: "0000000000",
        provinceSnapshot: "QA",
        wardSnapshot: "QA",
        addressLineSnapshot: "QA only",
        subtotal: "100000.00",
        shippingFee: "20000.00",
        total: "120000.00",
        payment: {
          create: {
            provider: "COD",
            status: "PAID",
            amount: "120000.00",
            paidAt: deliveredAt,
          },
        },
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            quantity: 2,
            unitPrice: "50000.00",
            lineTotal: "100000.00",
            productNameSnapshot: `QA ${label}`,
            skuSnapshot: sku,
            optionSnapshot: [],
          },
        },
      },
      include: { items: true },
    });
    // Legacy-shaped synthetic snapshot; do not impersonate an authenticated shipping command.
    await db.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: "SHIPPING",
        toStatus: "DELIVERED",
        actorType: null,
        actorId: null,
        reason:
          "Synthetic legacy delivered snapshot, not a shipping command receipt",
        createdAt: deliveredAt,
      },
    });
    await db.stockMovement.create({
      data: {
        variantId: variant.id,
        orderItemId: order.items[0].id,
        type: "CHECKOUT_DECREMENT",
        quantityDelta: -2,
        balanceAfter: 5,
        idempotencyKey: randomUUID(),
      },
    });
    return { order, item: order.items[0], variant, product };
  }
  const a = await fixture("refund only"),
    b = await fixture("return restockable"),
    c = await fixture("return non-restockable");
  async function login(page, user, route) {
    await page.goto(web + "/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL((u) => u.pathname !== "/login");
    await page.goto(web + route);
  }
  for (const [scope, user, route] of [
    ["BUYER", buyer, "/account/aftersales"],
    ["SELLER", seller, "/seller/aftersales"],
    ["ADMIN", admin, "/admin/returns"],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => pageErrors.push(e.message));
    pages[scope] = page;
    await login(page, user, route);
  }
  async function create(f, kind) {
    const page = pages.BUYER;
    await page.goto(`${web}/account/orders/${f.order.id}`);
    await page
      .getByRole("link", {
        name: "Yêu cầu hỗ trợ cho mặt hàng này",
        exact: true,
      })
      .click();
    const region = page.getByRole("region", { name: "Tạo yêu cầu hậu mãi" });
    await region.getByLabel("Phương án").selectOption(kind);
    await region
      .getByLabel("Mô tả", { exact: true })
      .fill("QA hàng đã nhận bị hỏng, cần phương án hậu mãi phù hợp");
    await region.getByRole("checkbox").check();
    await region.locator("form").evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page
      .getByText("Đã ghi nhận thao tác cho yêu cầu #", { exact: false })
      .waitFor();
    const requests = await db.aftersaleRequest.findMany({
      where: { orderItemId: f.item.id },
    });
    assert.equal(requests.length, 1);
    return requests[0].id;
  }
  async function open(page, scope, id) {
    await page.goto(
      web +
        (scope === "BUYER"
          ? "/account/aftersales"
          : scope === "SELLER"
            ? "/seller/aftersales"
            : "/admin/returns"),
    );
    await page
      .getByRole("button", { name: `Xem yêu cầu #${id}`, exact: true })
      .click();
    await page
      .getByRole("heading", { name: `Yêu cầu #${id} ·`, exact: false })
      .waitFor();
  }
  async function decision(page, action, restock) {
    await page.getByRole("button", { name: action, exact: true }).click();
    const form = page.getByRole("form", { name: "Xác nhận xử lý hậu mãi" });
    await form
      .getByLabel("Lý do quyết định", { exact: true })
      .fill("QA quyết định sau khi kiểm tra yêu cầu và hàng thực tế");
    if (restock !== undefined)
      await form
        .getByLabel("Khả năng nhập lại kho")
        .selectOption(restock ? "yes" : "no");
    await form.getByRole("checkbox").check();
    return form;
  }
  async function submit(form) {
    await form.getByRole("button", { name: /^Xác nhận / }).click();
  }
  async function recover(page) {
    const region = page.getByRole("region", {
      name: "Khôi phục yêu cầu hậu mãi",
    });
    await region.waitFor();
    assert.equal(await region.getByRole("checkbox").isChecked(), false);
    await region.getByRole("checkbox").check();
    await region
      .getByRole("button", { name: "Đối chiếu mã cũ", exact: true })
      .click();
    await region.waitFor({ state: "hidden" });
  }
  const idA = await create(a, "REFUND_ONLY");
  await open(pages.SELLER, "SELLER", idA);
  const approveEndpoint = `${api}/seller/aftersales/requests/${idA}/approve`;
  let approveCount = 0;
  pages.SELLER.on("request", (r) => {
    if (r.url() === approveEndpoint && r.method() === "POST") approveCount++;
  });
  await pages.SELLER.route(approveEndpoint, async (route) => {
    const upstream = await route.fetch();
    assert.equal(upstream.status(), 200);
    await route.abort("connectionfailed");
  });
  await submit(await decision(pages.SELLER, "Chấp thuận"));
  await pages.SELLER.getByRole("region", {
    name: "Khôi phục yêu cầu hậu mãi",
  }).waitFor();
  await pages.SELLER.reload();
  await recover(pages.SELLER);
  await pages.SELLER.getByText(`Đã ghi nhận thao tác cho yêu cầu #${idA}.`, {
    exact: false,
  }).waitFor();
  await pages.SELLER.unroute(approveEndpoint);
  assert.equal(approveCount, 1);
  assert.equal(await db.refundRecord.count({ where: { requestId: idA } }), 1);
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: a.variant.id } }))
      .stock,
    5,
  );
  assert.equal(
    await db.stockMovement.count({
      where: { orderItemId: a.item.id, type: "RETURN_RESTORE" },
    }),
    0,
  );
  let adjustment = await db.revenueAdjustment.findFirstOrThrow({
    where: { refund: { requestId: idA } },
  });
  assert.equal(adjustment.effectiveAt, null);
  const buyerToken = (await auth.login({ email: buyer.email, password }))
    .accessToken;
  const complete = await fetch(`${api}/orders/${a.order.id}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${buyerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: "{}",
  });
  assert.equal(complete.status, 200);
  adjustment = await db.revenueAdjustment.findFirstOrThrow({
    where: { refund: { requestId: idA } },
  });
  assert(adjustment.effectiveAt);
  assert.equal(
    (await db.payment.findUniqueOrThrow({ where: { orderId: a.order.id } }))
      .status,
    "PAID",
  );
  await pages.SELLER.goto(web + "/seller");
  await pages.SELLER.getByRole("button", {
    name: "Thống kê",
    exact: true,
  }).click();
  const finance = pages.SELLER.getByRole("region", {
    name: "Thống kê doanh thu và hoàn tiền",
  });
  await finance.getByRole("table").waitFor();
  const card = (label) =>
    finance
      .locator("article")
      .filter({ has: pages.SELLER.getByText(label, { exact: true }) })
      .locator("strong");
  assert.equal(await card("Doanh thu hàng hóa").innerText(), "100.000 ₫");
  assert.equal(
    await card("Hoàn tiền có hiệu lực trong kỳ").innerText(),
    "100.000 ₫",
  );
  assert.equal(await card("Doanh thu thuần").innerText(), "0 ₫");
  assert.equal(
    await card("Khoản hoàn chờ ghi nhận · toàn thời gian").innerText(),
    "0 ₫",
  );
  results.push({
    check:
      "refund_only_lost_response_reload_explicit_same_key_recovery_then_completion_activation",
    pass: true,
    approvePosts: approveCount,
    fault: "Controlled abort AFTER real upstream200, not physical packet loss",
  });
  const idB = await create(b, "RETURN_AND_REFUND");
  await open(pages.SELLER, "SELLER", idB);
  await submit(await decision(pages.SELLER, "Từ chối"));
  await pages.SELLER.getByText(`Đã ghi nhận thao tác cho yêu cầu #${idB}.`, {
    exact: false,
  }).waitFor();
  await open(pages.BUYER, "BUYER", idB);
  await submit(await decision(pages.BUYER, "Nhờ Admin giải quyết"));
  await pages.BUYER.getByText(`Đã ghi nhận thao tác cho yêu cầu #${idB}.`, {
    exact: false,
  }).waitFor();
  await open(pages.ADMIN, "ADMIN", idB);
  await submit(await decision(pages.ADMIN, "Chấp thuận"));
  await pages.ADMIN.getByText(`Đã ghi nhận thao tác cho yêu cầu #${idB}.`, {
    exact: false,
  }).waitFor();
  assert.equal(
    (await db.aftersaleRequest.findUniqueOrThrow({ where: { id: idB } })).state,
    "AWAITING_RETURN",
  );
  assert.equal(await db.refundRecord.count({ where: { requestId: idB } }), 0);
  const receiveForm = await decision(
      pages.ADMIN,
      "Xác nhận đã nhận lại hàng",
      true,
    ),
    revision = (
      await db.aftersaleRequest.findUniqueOrThrow({ where: { id: idB } })
    ).revision;
  const peerToken = (await auth.login({ email: peer.email, password }))
    .accessToken;
  const [, rival] = await Promise.all([
    submit(receiveForm),
    fetch(`${api}/admin/aftersales/requests/${idB}/receive`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${peerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedRevision: revision,
        reason: "QA thao tác song song của Admin khác khi kiểm hàng",
        restockable: true,
      }),
    }),
  ]);
  assert([200, 409].includes(rival.status));
  await pages.ADMIN.waitForFunction((id) => {
    const known = [...document.querySelectorAll('[role="status"]')].some((e) =>
      e.textContent.includes(`Đã ghi nhận thao tác cho yêu cầu #${id}.`),
    );
    const recovery = document.querySelector(
      '[aria-label="Khôi phục yêu cầu hậu mãi"] input[type="checkbox"]',
    );
    return known || (recovery && !recovery.disabled);
  }, idB);
  if (
    await pages.ADMIN.getByRole("region", {
      name: "Khôi phục yêu cầu hậu mãi",
    }).count()
  )
    await recover(pages.ADMIN);
  assert.equal(await db.refundRecord.count({ where: { requestId: idB } }), 1);
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: b.variant.id } }))
      .stock,
    7,
  );
  assert.equal(
    await db.stockMovement.count({
      where: { orderItemId: b.item.id, type: "RETURN_RESTORE" },
    }),
    1,
  );
  assert.equal(
    await db.searchOutbox.count({ where: { productId: b.product.id } }),
    1,
  );
  assert.equal(
    await db.aftersaleHistory.count({ where: { requestId: idB } }),
    5,
  );
  results.push({
    check:
      "reject_dispute_Admin_return_approval_parallel_receive_single_refund_and_restock",
    pass: true,
    rivalHttpStatus: rival.status,
  });
  const idC = await create(c, "RETURN_AND_REFUND");
  await open(pages.SELLER, "SELLER", idC);
  await submit(await decision(pages.SELLER, "Chấp thuận"));
  await pages.SELLER.getByText(`Đã ghi nhận thao tác cho yêu cầu #${idC}.`, {
    exact: false,
  }).waitFor();
  await submit(
    await decision(pages.SELLER, "Xác nhận đã nhận lại hàng", false),
  );
  await pages.SELLER.getByText(`Đã ghi nhận thao tác cho yêu cầu #${idC}.`, {
    exact: false,
  }).waitFor();
  assert.equal(await db.refundRecord.count({ where: { requestId: idC } }), 1);
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: c.variant.id } }))
      .stock,
    5,
  );
  assert.equal(
    await db.stockMovement.count({
      where: { orderItemId: c.item.id, type: "RETURN_RESTORE" },
    }),
    0,
  );
  assert.equal(
    await db.searchOutbox.count({ where: { productId: c.product.id } }),
    0,
  );
  results.push({
    check:
      "received_non_restockable_refund_without_inventory_or_Search_mutation",
    pass: true,
  });
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    for (const [scope, id] of [
      ["BUYER", idA],
      ["SELLER", idC],
      ["ADMIN", idB],
    ]) {
      const page = pages[scope];
      await page.setViewportSize({ width, height });
      await open(page, scope, id);
      await page
        .getByText("Biên nhận hoàn tiền mô phỏng #", { exact: false })
        .waitFor();
      const region = page.getByRole("region", { name: "Hậu mãi", exact: true });
      assert.equal(
        await region.evaluate((e) => e.scrollWidth > e.clientWidth + 1),
        false,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `${scope.toLowerCase()}-${name}.png`),
        fullPage: true,
      });
      results.push({
        check: `${scope}_${name}_real_history_and_simulated_refund_receipt`,
        pass: true,
      });
    }
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(await hashes(), initialHashes);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        results,
        sourceHashes: initialHashes,
        database: url.pathname.slice(1),
        migrations: migrationNames.length,
        migrationNames,
        appRole: "non-superuser/no-CREATEDB/no-CREATEROLE",
        requestIds: [idA, idB, idC],
        limits:
          "Delivered snapshot fixtures are synthetic, not proof of checkout/COD. Real browser writes except peer/Buyer-completion HTTP probes. Parallel requests do not assert measured lock overlap; Backend runtime E2E separately covers concurrency. Controlled post-commit response abort, not physical network failure. Data retained; no reset/demo access.",
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
} catch (failure) {
  for (const [scope, page] of Object.entries(pages)) {
    await page.screenshot({ path: path.join(output, `${scope.toLowerCase()}-failure.png`), fullPage: true }).catch(() => {});
    await writeFile(path.join(output, `${scope.toLowerCase()}-failure.txt`), await page.locator('body').innerText()).catch(() => {});
  }
  throw failure;
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser?.close();
  await vite?.close();
  await app?.close();
}
