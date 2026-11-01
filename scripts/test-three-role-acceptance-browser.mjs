// Same-order three-role acceptance: actual Chrome -> Nest -> fresh DML-only QA.
// No demo writes, external providers, real delivery/payment/refund or Search model claims.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    "playwright-module": { type: "string" },
    "multi-sku": { type: "boolean", default: true },
  },
});
assert(values.output && values["playwright-module"]);
assert(values["multi-sku"], "The acceptance journey requires the four-SKU scenario");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5549");
assert.match(url.pathname, /^\/bckl_order_resolution_test_acceptance_20261031_[0-9]{13}$/);
assert.equal(url.username, "bckl_local_app");
assert(
  !url.hash &&
    [...url.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    url.searchParams.getAll("schema").length <= 1,
);
for (const f of [".env", "BE/.env", "FE/.env", "FE/.env.local"])
  try {
    await access(path.join(root, f));
    throw Error("Refusing dotenv");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET, "Explicit synthetic QA secrets required");
Object.assign(process.env, {
  NODE_ENV: "test",
  AUTH_EMAIL_ENABLED: "false", VITE_AUTH_EMAIL_ENABLED: "false",
  AUTH_GOOGLE_ENABLED: "false", VITE_AUTH_GOOGLE_ENABLED: "false",
  AUTH_PHONE_OTP_SANDBOX_ENABLED: "false", VITE_AUTH_PHONE_OTP_SANDBOX_ENABLED: "false",
  VNPAY_SANDBOX_ENABLED: "false", VITE_VNPAY_SANDBOX_ENABLED: "false",
  NOTIFICATION_EMAIL_ENABLED: "false", NOTIFICATION_EMAIL_WORKER_ENABLED: "false",
  EMAIL_NOTIFICATION_WORKER_ENABLED: "false", NOTIFICATIONS_WORKER_ENABLED: "false",
  NOTIFICATIONS_ENABLED: "true", VITE_NOTIFICATIONS_ENABLED: "true",
  SEARCH_SYNC_ENABLED: "false", SEARCH_RECONCILIATION_ENABLED: "false",
  SEARCH_ANALYTICS_ENABLED: "false", SEARCH_ANALYTICS_RETENTION_ENABLED: "false",
  PRODUCT_IMAGE_REPAIR_ENABLED: "false", ORDER_AUTO_COMPLETE_ENABLED: "false",
  CHAT_TEXT_ENABLED: "true", CHAT_ORDER_CONTEXT_ENABLED: "true",
  VITE_CHAT_ENABLED: "true", VITE_CHAT_ORDER_CONTEXT_ENABLED: "true",
  PRODUCT_REVIEWS_ENABLED: "true", VITE_PRODUCT_REVIEWS_ENABLED: "true",
  VITE_AFTERSALES_ENABLED: "true", VITE_SELLER_ORDER_COMMANDS_ENABLED: "true",
  VITE_BUYER_ORDER_COMMANDS_ENABLED: "true", VITE_ACCOUNT_BUYER_ACCESS_ENABLED: "false",
  AUTH_LOGIN_IP_PER_MINUTE: "10000", AUTH_LOGIN_ACCOUNT_PER_MINUTE: "10000",
  AUTH_SESSION_IP_PER_MINUTE: "10000", CHECKOUT_CREATE_INTENTS_PER_MINUTE: "60",
  ORDER_COMMAND_RATE_PER_MINUTE: "200",
});
for (const flag of [
  "SEARCH_SYNC_ENABLED",
  "SEARCH_RECONCILIATION_ENABLED",
  "PRODUCT_IMAGE_REPAIR_ENABLED",
  "ORDER_AUTO_COMPLETE_ENABLED",
])
  assert.equal(process.env[flag], "false");
const output = path.resolve(values.output);
const relativeOutput = path.relative(root, output);
assert(relativeOutput && (relativeOutput.startsWith(".." + path.sep) || path.isAbsolute(relativeOutput)), "Output must be outside the checkout");
await assert.rejects(access(output));
await mkdir(output, { recursive: true });
process.env.UPLOAD_ROOT = path.join(output, "uploads");
async function sourceFingerprints() {
  const hashes = {};
  async function visit(directory) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) hashes[file] = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
    }
  }
  await visit("FE/src"); await visit("BE/src");
  return hashes;
}
const sourceBefore = await sourceFingerprints();
const requireBE = createRequire(path.join(root, "BE/package.json")),
  requireFE = createRequire(path.join(root, "FE/package.json"));
requireBE("reflect-metadata");
const { Test } = requireBE("@nestjs/testing");
const load = (f) => import(pathToFileURL(path.join(root, "BE/dist", f)).href);
const { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js");
const { createServer } = await import(
    pathToFileURL(requireFE.resolve("vite")).href
  ),
  pw = await import(pathToFileURL(values["playwright-module"]).href);
const web = "http://127.0.0.1:5194";
process.env.FRONTEND_URL = web;
const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  driverSha256 = createHash("sha256")
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex");
const results = [],
  pages = [],
  errors = [],
  screenshots = [],
  journeyLedger = [],
  uxResults = [];
let appliedMigrationNames = [], sourceStable = false;
const startedAt = new Date().toISOString();
let app, vite, browser, db, api;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  api = await app.getUrl();
  process.env.BACKEND_PUBLIC_URL = api;
  db = app.get(PrismaService);
  const [identity] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity.name, url.pathname.slice(1));
  assert(
    !identity.rolsuper && !identity.rolcreatedb && !identity.rolcreaterole,
  );
  const [privileges] = await db.$queryRaw`SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS ddl`;
  assert.equal(privileges.ddl, false, "Runtime must not have schema CREATE");
  const expectedMigrationNames = (await readdir(path.join(root, "BE/prisma/migrations"), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  const applied = await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  appliedMigrationNames = applied.map(row => row.migration_name);
  assert.deepEqual(appliedMigrationNames, expectedMigrationNames, "All source migrations must match exactly");
  assert.equal(await db.order.count(), 0, "A fresh acceptance database is required");
  assert.equal(await db.user.count(), 0, "No preexisting actors may be reused");
  process.env.VITE_API_URL = api;
  process.env.BACKEND_PUBLIC_URL = api;
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5194, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const marker = "listing-" + randomUUID(),
    password = "Qa-" + randomUUID() + "!",
    passwordHash = await requireBE("bcryptjs").hash(password, 10);
  const actor = (role) =>
    db.user.create({
      data: {
        role,
        email: "qa-" + randomUUID() + "@example.test",
        passwordHash,
      },
    });
  const seller = await actor("SELLER"),
    foreign = await actor("SELLER"),
    buyer = await actor("USER"),
    admin = await actor("ADMIN");
  const store = await db.store.create({
    data: { name: marker, sellerId: seller.id, status: "ACTIVE" },
  });
  await db.store.create({
    data: { name: marker + "other", sellerId: foreign.id, status: "ACTIVE" },
  });
  const category = await db.category.create({
    data: { name: marker, slug: marker },
  });
  const baseline = {
    orders: await db.order.count(),
    stock: await db.stockMovement.count(),
  };
  let attribute;
  if (values["multi-sku"])
    attribute = await db.categoryAttributeDefinition.create({
      data: {
        categoryId: category.id,
        name: "Chất liệu",
        slug: "material",
        dataType: "SINGLE_SELECT",
        isRequired: true,
        allowsCustom: false,
        options: { create: { value: "Cotton", slug: "cotton" } },
      },
      include: { options: true },
    });
  async function page(email, target) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const p = await context.newPage();
    pages.push(p);
    p.setDefaultTimeout(20000);
    p.on("pageerror", (e) => errors.push({ lane: target.startsWith("/admin") ? "ADMIN" : target.startsWith("/seller") ? "SELLER" : "BUYER", message: e.message }));
    await p.goto(web + "/login");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.waitForURL((u) => u.pathname !== "/login");
    await p.goto(web + target);
    return p;
  }
  const s = await page(seller.email, "/seller");
  await s.getByRole("button", { name: /^Sản phẩm \(/ }).click();
  const form = s.getByRole("form", { name: "Sản phẩm" });
  await form.getByLabel("Tên", { exact: true }).fill(marker);
  await form
    .locator('select[name="categoryId"]')
    .selectOption(String(category.id));
  const created = s.waitForResponse(
    (r) =>
      r.url() === api + "/seller/products" && r.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Lưu sản phẩm", exact: true }).click();
  const cr = await created;
  assert.equal(cr.status(), 201);
  const product = await cr.json();
  // Guided wizard (FE orange G4): creating the draft selects it and opens step 2.
  await s.getByText(/^Đã tạo sản phẩm nháp/).waitFor();
  await s.getByRole("heading", { name: "2. Ảnh đại diện sản phẩm" }).waitFor();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await s
    .locator("input[type=file]")
    .setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: png });
  await s.getByRole("button", { name: "Tải ảnh & tiếp tục", exact: true }).click();
  await s.getByText(/^Đã tải ảnh chính/).waitFor();
  await s.getByRole("heading", { name: /^3\. Phân loại/ }).waitFor();
  if (values["multi-sku"]) {
    for (const [name, options] of [
      ["Màu sắc", ["Đen", "Trắng"]],
      ["Kích thước", ["M", "L"]],
    ]) {
      await s.getByLabel("Tên nhóm phân loại", { exact: true }).fill(name);
      await s
        .getByRole("button", { name: "Thêm nhóm phân loại", exact: true })
        .click();
      await s
        .getByRole("form", { name: `Giá trị ${name}`, exact: true })
        .waitFor();
      for (const option of options) {
        await s
          .getByLabel(`Giá trị mới cho ${name}`, { exact: true })
          .fill(option);
        await s
          .getByRole("button", { name: `Thêm giá trị ${name}`, exact: true })
          .click();
        await s
          .getByLabel(`Giá trị mới cho ${name}`, { exact: true })
          .waitFor({ state: "visible" });
        await s
          .getByRole("button", { name: `Thêm giá trị ${name}`, exact: true })
          .waitFor();
        await s.waitForFunction(
          () => !document.querySelector("input[name=value]:disabled"),
        );
      }
    }
    for (const [color, size, price, stock] of [
      ["Đen", "M", "25000", "7"],
      ["Đen", "L", "30000", "3"],
      ["Trắng", "M", "35000", "0"],
      ["Trắng", "L", "40000", "2"],
    ]) {
      await s
        .getByLabel("Màu sắc cho SKU", { exact: true })
        .selectOption({ label: color });
      await s
        .getByLabel("Kích thước cho SKU", { exact: true })
        .selectOption({ label: size });
      await s.getByPlaceholder("Giá, ví dụ 199000").fill(price);
      await s.getByPlaceholder("Tồn kho", { exact: true }).fill(stock);
      const response = s.waitForResponse(
        (r) =>
          r.url() === api + `/seller/products/${product.id}/variants` &&
          r.request().method() === "POST",
      );
      await s
        .getByRole("button", { name: "Thêm phiên bản", exact: true })
        .dblclick();
      assert.equal((await response).status(), 201);
      await s
        .getByRole("button", { name: "Thêm phiên bản", exact: true })
        .waitFor({ state: "visible" });
      await s.waitForFunction(
        () => !document.querySelector("input[name=price]:disabled"),
      );
    }
    assert.equal(
      await db.productVariant.count({ where: { productId: product.id } }),
      4,
    );
  } else {
    await s.getByPlaceholder("Giá, ví dụ 199000").fill("25000");
    await s.getByPlaceholder("Tồn kho", { exact: true }).fill("7");
    await s
      .getByRole("button", { name: "Thêm phiên bản", exact: true })
      .click();
    await s.getByText("Đã thêm phiên bản bán.", { exact: true }).waitFor();
  }
  await s.getByRole("button", { name: "Tiếp tục sang bước Kiện hàng ›", exact: true }).click();
  await s.getByLabel(/Khối lượng kiện hàng/).fill("100");
  await s.getByRole("button", { name: "Lưu kiện hàng", exact: true }).click();
  await s.getByText("Đã lưu kiện hàng.", { exact: true }).waitFor();
  await s.getByRole("button", { name: "Tiếp tục sang bước Kiểm tra & Gửi duyệt ›", exact: true }).click();
  if (attribute) {
    const denied = s.waitForResponse(
      (r) => r.url() === api + `/seller/products/${product.id}/submit`,
    );
    await s.getByRole("button", { name: "Gửi duyệt", exact: true }).click();
    assert.equal((await denied).status(), 400);
    assert.equal(
      (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
        .moderationStatus,
      "NOT_SUBMITTED",
    );
    // Required attributes live in step 3 of the wizard.
    await s.getByRole("button", { name: "3. Phân loại & Giá/Kho", exact: true }).click();
    await s
      .getByLabel("Chất liệu", { exact: true })
      .selectOption(String(attribute.options[0].id));
    await s.getByRole("button", { name: "Lưu Chất liệu", exact: true }).click();
    await s
      .getByText("Đã lưu thuộc tính Chất liệu.", { exact: true })
      .waitFor();
    await s.getByRole("button", { name: "5. Gửi duyệt", exact: true }).click();
    results.push({
      name: "required_attribute_blocks_submit_then_single_select_saved",
      result: "PASS",
    });
  }
  assert.equal((await fetch(api + "/products/" + product.id)).status, 404);
  await s.screenshot({
    path: path.join(output, "01-seller-draft.png"),
    fullPage: true,
  });
  const pending = s.waitForResponse(
    (r) => r.url() === api + `/seller/products/${product.id}/submit`,
  );
  await s.getByRole("button", { name: "Gửi duyệt", exact: true }).click();
  assert.equal((await pending).status(), 200);
  const a = await page(admin.email, "/admin/products/" + product.id);
  a.on("dialog", (d) => d.accept());
  const approved = a.waitForResponse(
    (r) =>
      r.url() === api + `/admin/products/${product.id}/approve` &&
      r.request().method() === "POST",
  );
  await a
    .getByRole("button", { name: "✓　Duyệt sản phẩm", exact: true })
    .click();
  assert.equal((await approved).status(), 200);
  const publicResponse = await fetch(api + "/products/" + product.id);
  assert.equal(publicResponse.status, 200);
  const published = await publicResponse.json();
  assert.equal(published.store.id, store.id);
  assert.equal(published.variants.length, values["multi-sku"] ? 4 : 1);
  assert.equal(Number(published.variants[0].price), 25000);
  assert.equal(published.variants[0].inStock, true);
  assert.equal(
    (
      await db.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      })
    ).stock,
    7,
  );
  await a.screenshot({
    path: path.join(output, "02-admin-approved.png"),
    fullPage: true,
  });
  results.push({
    name: "real_web_draft_upload_variant_shipping_submit_admin_approve",
    result: "PASS",
    productId: product.id,
  });
  const before = JSON.stringify(
    await db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { variants: true, statusHistory: true },
    }),
  );
  const login = async (email) => {
    const r = await fetch(api + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: web },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(r.status, 200);
    return (await r.json()).accessToken;
  };
  const foreignToken = await login(foreign.email),
    buyerToken = await login(buyer.email);
  const probes = [
    [
      "other-seller-update",
      foreignToken,
      "PATCH",
      `/seller/products/${product.id}`,
      { name: "forged name" },
    ],
    [
      "buyer-approve",
      buyerToken,
      "POST",
      `/admin/products/${product.id}/approve`,
      { version: published.version },
    ],
    [
      "seller-approve",
      foreignToken,
      "POST",
      `/admin/products/${product.id}/approve`,
      { version: published.version },
    ],
  ];
  for (const [name, token, method, route, body] of probes) {
    const response = await fetch(api + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    assert([403, 404].includes(response.status), name + " " + response.status);
    results.push({ name, result: "PASS", status: response.status });
  }
  assert.equal(
    JSON.stringify(
      await db.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { variants: true, statusHistory: true },
      }),
    ),
    before,
  );
  assert.equal(await db.order.count(), baseline.orders);
  assert.equal(await db.stockMovement.count(), baseline.stock);
  if (values["multi-sku"]) {
    const variants = await db.productVariant.findMany({
      where: { productId: product.id },
      orderBy: { id: "asc" },
    });
    await db.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: "QA Buyer",
        phone: "0900000000",
        province: "QA",
        ward: "QA",
        addressLine: "QA simulated address",
        isDefault: true,
      },
    });
    const b = await page(buyer.email, `/products/${product.id}`);
    await b
      .getByLabel("Màu sắc muốn mua", { exact: true })
      .selectOption({ label: "Trắng" });
    await b
      .getByLabel("Kích thước muốn mua", { exact: true })
      .selectOption({ label: "M" });
    assert(
      await b
        .getByRole("button", { name: "Thêm vào giỏ hàng", exact: true })
        .isDisabled(),
    );
    await b
      .getByLabel("Màu sắc muốn mua", { exact: true })
      .selectOption({ label: "Đen" });
    await b
      .getByLabel("Kích thước muốn mua", { exact: true })
      .selectOption({ label: "L" });
    await b.getByLabel("Số lượng", { exact: true }).fill("2");
    let puts = 0;
    b.on("request", (r) => {
      if (
        r.url() === api + `/cart/items/${variants[1].id}` &&
        r.method() === "PUT"
      )
        puts++;
    });
    await b
      .getByRole("button", { name: "Thêm vào giỏ hàng", exact: true })
      .dblclick();
    await b.getByText("Đã lưu số lượng 2 vào giỏ.", { exact: true }).waitFor();
    assert.equal(puts, 1);
    // PDP no longer shows a cart link after saving; open the cart directly.
    await b.goto(web + "/cart");
    await b
      .getByLabel(`Chọn biến thể ${variants[1].id}`, { exact: true })
      .check();
    await b
      .getByRole("link", { name: "Tiếp tục thanh toán", exact: true })
      .click();
    const checkout = b.waitForResponse(
      (r) => r.url() === api + "/checkouts" && r.request().method() === "POST",
    );
    await b
      .getByRole("button", { name: "Đặt hàng COD", exact: true })
      .dblclick();
    assert.equal((await checkout).status(), 201);
    await b
      .getByRole("heading", { name: "Đã ghi nhận đặt hàng COD", exact: true })
      .waitFor();
    const orders = await db.order.findMany({
      where: { buyerId: buyer.id },
      include: { items: true },
    });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].items.length, 1);
    assert.equal(orders[0].items[0].variantId, variants[1].id);
    assert.equal(orders[0].items[0].quantity, 2);
    assert.equal(orders[0].items[0].unitPrice.toString(), "30000");
    assert.equal(orders[0].items[0].lineTotal.toString(), "60000");
    const stocks = await db.productVariant.findMany({
      where: { productId: product.id },
      orderBy: { id: "asc" },
      select: { stock: true },
    });
    assert.deepEqual(
      stocks.map((x) => x.stock),
      [7, 1, 0, 2],
    );
    assert.equal(
      await db.stockMovement.count({
        where: { orderItemId: orders[0].items[0].id, quantityDelta: -2 },
      }),
      1,
    );
    await b.screenshot({
      path: path.join(output, "03-buyer-multi-sku-cod.png"),
      fullPage: true,
    });
    results.push({
      name: "buyer_selected_sku_out_of_stock_guard_single_put_single_order_correct_stock",
      result: "PASS",
      orderId: orders[0].id,
    });
    // Continue the exact Order created above; no delivered/completed fixture state.
    const orderId = orders[0].id, itemId = orders[0].items[0].id;
    const selectedVariantId = variants[1].id;
    async function evidence(target, lane, stage) {
      for (const [device, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
        await target.setViewportSize({ width, height });
        const file = `${lane.toLowerCase()}-${stage}-${device}.png`;
        await target.screenshot({ path: path.join(output, file), fullPage: true });
        const size = await target.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert(size.content <= size.viewport + 1, `${lane}/${stage}/${device} horizontal overflow ${JSON.stringify(size)}`);
        screenshots.push({ lane, stage, device, file, orderId });
      }
      await target.setViewportSize({ width: 1440, height: 1000 });
    }
    async function ledger(stage, expectedStatus, expectedPayment, expectedCommands) {
      const row = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payment: true } });
      const stock = await db.productVariant.findUniqueOrThrow({ where: { id: selectedVariantId } });
      const movements = await db.stockMovement.findMany({ where: { orderItemId: itemId }, orderBy: { id: "asc" } });
      assert.equal(row.buyerId, buyer.id); assert.equal(row.storeId, store.id);
      assert.equal(row.status, expectedStatus); assert.equal(row.payment.status, expectedPayment);
      assert.equal(row.total.toFixed(2), "60000.00"); assert.equal(row.payment.amount.toFixed(2), "60000.00");
      assert.equal(row.payment.provider, "COD"); assert.equal(row.items.length, 1);
      assert.equal(row.items[0].id, itemId); assert.equal(row.items[0].variantId, selectedVariantId);
      assert.equal(row.items[0].quantity, 2); assert.equal(row.items[0].unitPrice.toFixed(2), "30000.00");
      assert.equal(row.items[0].lineTotal.toFixed(2), "60000.00"); assert.equal(stock.stock, 1);
      assert.equal(movements.length, 1); assert.equal(movements[0].type, "CHECKOUT_DECREMENT");
      assert.equal(movements[0].quantityDelta, -2);
      assert.equal(await db.order.count(), baseline.orders + 1);
      assert.equal(await db.payment.count({ where: { orderId } }), 1);
      assert.equal(await db.orderCommand.count({ where: { orderId } }), expectedCommands);
      journeyLedger.push({ stage, orderId, itemId, status: row.status, payment: row.payment.status, total: row.total.toFixed(2), stock: stock.stock, stockMovements: movements.length, commands: expectedCommands });
    }
    await evidence(b, "BUYER", "01-checkout-confirmed");
    await ledger("checkout", "PENDING_CONFIRMATION", "UNPAID", 0);
    await s.goto(web + `/seller/orders/${orderId}`);
    for (const [label, command, nextStatus, count] of [
      ["Xác nhận đơn", "confirm", "CONFIRMED", 1],
      ["Bắt đầu đóng gói", "start-packing", "PACKING", 2],
      ["Sẵn sàng bàn giao", "ready-to-ship", "READY_TO_SHIP", 3],
    ]) {
      const action = s.getByRole("button", { name: label, exact: true });
      await action.waitFor();
      await s.waitForFunction(name => [...document.querySelectorAll("button")].some(button => button.textContent.trim() === name && !button.disabled), label);
      await action.click();
      const review = s.getByRole("region", { name: label, exact: true });
      await review.getByRole("checkbox").check();
      const response = s.waitForResponse(r => r.url() === api + `/seller/orders/${orderId}/${command}` && r.request().method() === "POST");
      await review.getByRole("button", { name: "Xác nhận thao tác", exact: true }).dblclick();
      assert.equal((await response).status(), 200);
      await s.getByText("Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng.", { exact: true }).waitFor();
      await ledger(command, nextStatus, "UNPAID", count);
    }
    await evidence(s, "SELLER", "02-ready-to-ship");
    results.push({ name: "same_order_seller_confirm_pack_handoff_UI", result: "PASS", orderId });

    await a.goto(web + "/admin/fulfilment");
    await a.getByRole("heading", { name: "Giao hàng mô phỏng", exact: true }).waitFor();
    const trackingReference = "QA-ACCEPTANCE-" + randomUUID().slice(0, 16);
    for (const [command, status, payment, count] of [
      ["ship", "SHIPPING", "UNPAID", 4], ["mark-delivered", "DELIVERED", "PAID", 5],
    ]) {
      await a.getByLabel("Mã nội bộ của đơn", { exact: true }).fill(String(orderId));
      await a.getByRole("button", { name: "Tải đơn", exact: true }).click();
      await a.getByRole("heading", { name: "Đơn " + orders[0].orderNumber, exact: true }).waitFor();
      const select = a.getByLabel("Thao tác", { exact: true });
      await select.waitFor();
      if (await select.isEnabled()) await select.selectOption(command);
      assert.equal(await select.inputValue(), command);
      await a.getByLabel("Mã vận đơn", { exact: true }).fill(trackingReference);
      if (command === "mark-delivered") await a.getByLabel("Lần giao", { exact: true }).fill("1");
      await a.getByRole("checkbox", { name: /Tôi đã kiểm tra đúng đơn/ }).check();
      const response = a.waitForResponse(r => r.url() === api + `/admin/orders/${orderId}/${command}` && r.request().method() === "POST");
      await a.getByRole("button", { name: "Xác nhận mô phỏng", exact: true }).dblclick();
      assert.equal((await response).status(), 200);
      await a.getByText("Đã xác minh biên nhận.", { exact: false }).waitFor();
      await a.getByRole("button", { name: "Tải đơn", exact: true }).click();
      await a.getByRole("heading", { name: "Đơn " + orders[0].orderNumber, exact: true }).waitFor();
      await ledger(command, status, payment, count);
      await evidence(a, "ADMIN", "03-" + command);
    }
    assert.equal(await db.deliveryAttempt.count({ where: { orderId } }), 1);
    results.push({ name: "same_order_admin_ship_deliver_UI_COD_paid", result: "PASS", orderId });

    await b.goto(web + `/account/orders/${orderId}`);
    await b.getByRole("button", { name: "Xác nhận đã nhận hàng", exact: true }).click();
    const complete = b.getByRole("region", { name: "Xác nhận đã nhận hàng", exact: true });
    await complete.getByRole("checkbox").check();
    const completeResponse = b.waitForResponse(r => r.url() === api + `/orders/${orderId}/complete` && r.request().method() === "POST");
    await complete.getByRole("button", { name: "Xác nhận hoàn tất đơn", exact: true }).dblclick();
    assert.equal((await completeResponse).status(), 200);
    await b.getByText("Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.", { exact: true }).waitFor();
    await ledger("buyer-complete", "COMPLETED", "PAID", 6);
    await evidence(b, "BUYER", "04-completed");
    results.push({ name: "same_order_buyer_complete_UI_one_stock_effect", result: "PASS", orderId });

    // Verify a completed-purchase review through the actual Buyer entry point.
    await b.getByRole("link", { name: "Đánh giá mặt hàng này", exact: true }).click();
    await b.getByLabel("Điểm đánh giá", { exact: true }).selectOption("5");
    const reviewText = "Sản phẩm đúng phân loại đã chọn, đóng gói cẩn thận. Mình rất hài lòng.";
    await b.getByLabel("Nhận xét của bạn", { exact: true }).fill(reviewText);
    await b.getByRole("checkbox", { name: "Tôi xác nhận nội dung và thao tác đang chọn.", exact: true }).check();
    const reviewResponse = b.waitForResponse(r => r.url() === api + `/account/order-items/${itemId}/review/create` && r.request().method() === "POST");
    await b.getByRole("button", { name: "Gửi đánh giá", exact: true }).dblclick();
    assert.equal((await reviewResponse).status(), 200);
    await b.getByRole("paragraph").filter({ hasText: reviewText }).waitFor();
    assert.equal(await db.productReview.count({ where: { orderItemId: itemId } }), 1);
    await evidence(b, "BUYER", "05-purchased-review");
    await ledger("review-no-financial-mutation", "COMPLETED", "PAID", 6);
    results.push({ name: "same_order_verified_purchase_review_UI", result: "PASS", orderId, itemId });

    await b.goto(web + `/account/orders/${orderId}`);
    await b.getByRole("link", { name: "Trao đổi về đơn hàng", exact: true }).click();
    await b.getByRole("button", { name: `Mở trao đổi về đơn #${orderId}`, exact: true }).click();
    await b.waitForURL(u => /^\/messages\/\d+$/.test(u.pathname));
    const conversationId = Number(new URL(b.url()).pathname.split("/").at(-1));
    assert(Number.isInteger(conversationId) && conversationId > 0);
    await s.goto(web + `/messages/${conversationId}`);
    await s.getByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.", { exact: true }).waitFor();
    await b.getByRole("button", { name: `Chia sẻ đơn hàng #${orderId}`, exact: true }).dblclick();
    await b.getByRole("article", { name: `Đơn hàng ${orderId}`, exact: true }).waitFor();
    await s.getByRole("article", { name: `Đơn hàng ${orderId}`, exact: true }).waitFor();
    assert.equal(await db.chatMessage.count({ where: { conversationId, contextOrderId: orderId } }), 1);
    const messageText = "Mình đã nhận đủ sản phẩm, cảm ơn cửa hàng.";
    await b.getByLabel("Nội dung tin nhắn", { exact: true }).fill(messageText);
    const messageResponse = b.waitForResponse(r => r.url().includes(`/chat/conversations/${conversationId}/messages`) && r.request().method() === "POST");
    await b.getByRole("button", { name: "Gửi tin nhắn", exact: true }).dblclick();
    assert.equal((await messageResponse).status(), 201);
    await s.getByRole("region", { name: `Hội thoại ${conversationId}`, exact: true }).getByText(messageText, { exact: true }).waitFor();
    assert.equal(await db.chatMessage.count({ where: { conversationId } }), 2);
    await evidence(b, "BUYER", "06-order-chat"); await evidence(s, "SELLER", "06-order-chat");
    await ledger("chat-no-financial-mutation", "COMPLETED", "PAID", 6);
    results.push({ name: "same_order_buyer_seller_chat_order_card_and_text_UI", result: "PASS", orderId, conversationId });

    // Cross-role route checks use the same authenticated contexts, without writes.
    await b.goto(web + "/admin/fulfilment"); await b.waitForURL(web + "/");
    assert.equal(await b.getByRole("heading", { name: "Giao hàng mô phỏng", exact: true }).count(), 0);
    await s.goto(web + "/admin/fulfilment"); await s.waitForURL(web + "/");
    assert.equal(await s.getByRole("heading", { name: "Giao hàng mô phỏng", exact: true }).count(), 0);
    await ledger("denied-routes-no-mutation", "COMPLETED", "PAID", 6);
    results.push({ name: "buyer_seller_Admin_fulfilment_route_denial", result: "PASS", orderId });
    // Finish restoring the cookie-backed session before navigating again;
    // aborting a rotating refresh between two full navigations loses its response.
    const sellerRefresh = s.waitForResponse(r => r.url() === api + "/auth/refresh" && r.request().method() === "POST");
    await s.reload();
    assert.equal((await sellerRefresh).status(), 200);
    await s.getByRole("link", { name: /^Tài khoản \(/ }).waitFor();
    await s.goto(web + "/seller");
    await s.getByRole("button", { name: /^Sản phẩm \(/ }).click();
    await s
      .getByText(marker, { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Chỉnh sửa", exact: true })
      .click();
    // Wizard opens on step 1; the SKU editor is step 3.
    await s.getByRole("button", { name: "3. Phân loại & Giá/Kho", exact: true }).click();
    await s.getByLabel("Màu sắc cho SKU", { exact: true }).waitFor();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ]) {
      await s.setViewportSize(viewport);
      await s.screenshot({
        path: path.join(output, `seller-${viewport.width}.png`),
        fullPage: true,
      });
      assert(
        await s.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
    }
    // Bounded UX checks report separately and never interrupt the business journey.
    async function uxProbe(name, run) {
      try { uxResults.push({ name, ...(await run()) }); }
      catch (error) { uxResults.push({ name, result: "BLOCKED", message: error.message }); }
    }
    async function guestLogin(target) {
      await target.getByLabel("Email", { exact: true }).fill(buyer.email);
      await target.getByLabel("Mật khẩu", { exact: true }).fill(password);
      await target.getByRole("button", { name: "Đăng nhập", exact: true }).click();
      await target.waitForURL(u => u.pathname !== "/login");
      await target.waitForLoadState("networkidle");
    }
    await uxProbe("guest_store_chat_login_retains_store_context", async () => {
      const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const target = await guest.newPage(); pages.push(target);
        target.on("pageerror", error => errors.push({ lane: "GUEST_STORE_CHAT", message: error.message }));
        await target.goto(web + `/stores/${store.id}`);
        await target.getByRole("link", { name: "Chat với cửa hàng", exact: true }).click();
        await target.waitForURL(u => u.pathname === "/login");
        await guestLogin(target);
        const actual = new URL(target.url());
        const passed = actual.pathname === "/messages" && actual.searchParams.get("storeId") === String(store.id);
        const file = "ux-guest-store-chat-after-login.png";
        await target.screenshot({ path: path.join(output, file), fullPage: true });
        screenshots.push({ lane: "GUEST_BUYER", stage: "store-chat-login-return", device: "mobile", file });
        return { result: passed ? "PASS" : "FAIL", confidence: "observed", expected: `/messages?storeId=${store.id}`, actual: actual.pathname + actual.search, screenshot: file };
      } finally { await guest.close(); }
    });
    await uxProbe("guest_product_login_returns_to_same_product", async () => {
      const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const target = await guest.newPage(); pages.push(target);
        target.on("pageerror", error => errors.push({ lane: "GUEST_PRODUCT", message: error.message }));
        await target.goto(web + `/products/${product.id}`);
        await target.getByRole("link", { name: "Đăng nhập để chọn mua", exact: true }).click();
        await target.waitForURL(u => u.pathname === "/login");
        await guestLogin(target);
        const actual = new URL(target.url());
        const file = "ux-guest-product-after-login.png";
        await target.screenshot({ path: path.join(output, file), fullPage: true });
        screenshots.push({ lane: "GUEST_BUYER", stage: "product-login-return", device: "mobile", file });
        return { result: actual.pathname === `/products/${product.id}` ? "PASS" : "FAIL", confidence: "observed", expected: `/products/${product.id}`, actual: actual.pathname + actual.search, screenshot: file };
      } finally { await guest.close(); }
    });
    await uxProbe("admin_notification_bell_has_a_visible_action", async () => {
      await a.goto(web + "/admin"); await a.waitForLoadState("networkidle");
      const bell = a.getByRole("button", { name: "Thông báo", exact: true });
      await bell.waitFor();
      await bell.click();
      await a.waitForURL(u => u.pathname === "/account/notifications", { timeout: 10000 });
      await a.getByRole("heading", { name: "Thông báo", exact: true }).waitFor();
      await a.getByText(/^\d+ thông báo chưa đọc$/, { exact: true }).waitFor();
      assert.equal(await a.getByRole("alert").count(), 0);
      await a.waitForLoadState("networkidle");
      const actual = new URL(a.url());
      const changed = actual.pathname === "/account/notifications";
      const file = "ux-admin-notification-bell.png";
      await a.screenshot({ path: path.join(output, file), fullPage: true });
      screenshots.push({ lane: "ADMIN", stage: "notification-bell", device: "desktop", file });
      return { result: changed ? "PASS" : "FAIL", confidence: "observed", expected: "/account/notifications with notification inbox heading", actual: actual.pathname, screenshot: file };
    });
  }
  assert.deepEqual(await sourceFingerprints(), sourceBefore, "Source changed during browser acceptance");
  sourceStable = true;
  assert.deepEqual(errors, []);
} catch (e) {
  results.push({ name: "run", result: "FAIL", message: e.message });
  for (let i = 0; i < pages.length; i++) {
    await pages[i]
      .screenshot({
        path: path.join(output, `failure-${i}.png`),
        fullPage: true,
      })
      .catch(() => {});
    await writeFile(
      path.join(output, `failure-${i}.txt`),
      await pages[i].locator("body").innerText(),
    ).catch(() => {});
  }
  throw e;
} finally {
  const sourceAfter = await sourceFingerprints();
  sourceStable = JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        head,
        startedAt,
        finishedAt: new Date().toISOString(),
        driverSha256,
        sourceBefore,
        sourceAfter,
        sourceStable,
        database: url.pathname.slice(1),
        runtimeRole: url.username,
        appliedMigrationNames,
        screenshots,
        journeyLedger,
        pageErrors: errors,
        uxResults,
        result: results.some(row => row.result === "FAIL") || !sourceStable || errors.length ? "FAIL" : uxResults.some(row => row.result === "FAIL") ? "FAIL_UX" : uxResults.some(row => row.result === "BLOCKED") ? "INCOMPLETE_UX" : "PASS",
        businessJourneyResult: results.some(row => row.result === "FAIL") || !sourceStable || errors.length ? "FAIL" : "PASS",
        results,
        scope: "Same real UI-created multi-SKU COD Order: Seller listing, Admin approval, Buyer purchase, Seller prepare, Admin simulated ship/deliver, Buyer complete, Review and Chat. Fresh synthetic actors/catalog/address, DML-only runtime; no actual provider/payment/courier/refund, Search model, email/Google or production capacity acceptance.",
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await vite?.close();
  await app?.close();
  if (uxResults.some(row => row.result !== "PASS")) process.exitCode = 1;
}
