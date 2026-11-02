// Release QA: actual Chrome -> Nest -> isolated PostgreSQL; synthetic actors only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    "playwright-module": { type: "string" },
    "multi-sku": { type: "boolean", default: false },
  },
});
assert(values.output && values["playwright-module"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5549");
assert.equal(url.pathname, "/bckl_order_resolution_test_hardening_20261029");
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
const web = "http://127.0.0.1:5193";
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
  errors = [];
let app, vite, browser, db, api;
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  api = await app.getUrl();
  db = app.get(PrismaService);
  const [identity] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity.name, url.pathname.slice(1));
  assert(
    !identity.rolsuper && !identity.rolcreatedb && !identity.rolcreaterole,
  );
  const [m] =
    await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(m.n, 39);
  process.env.VITE_API_URL = api;
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5193, strictPort: true },
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
    p.on("pageerror", (e) => errors.push(e.message));
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
  // Product list and the add/edit form are separate screens.
  await s.getByRole("button", { name: "+ Thêm sản phẩm mới", exact: true }).click();
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
  await s.getByText("Đã tạo sản phẩm nháp.", { exact: true }).waitFor();
  // Choose the nearest product row by its edit control, independent of generated CSS.
  await s
    .getByText(marker, { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Chỉnh sửa", exact: true })
    .click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await s
    .locator("input[type=file]")
    .setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: png });
  await s.getByRole("button", { name: "Tải ảnh", exact: true }).click();
  await s.getByText("Đã tải ảnh chính.", { exact: true }).waitFor();
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
  await s.getByPlaceholder("Khối lượng (gram)").fill("100");
  await s.getByRole("button", { name: "Lưu kiện hàng", exact: true }).click();
  await s.getByText("Đã lưu kiện hàng.", { exact: true }).waitFor();
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
    await s
      .getByLabel("Chất liệu", { exact: true })
      .selectOption(String(attribute.options[0].id));
    await s.getByRole("button", { name: "Lưu Chất liệu", exact: true }).click();
    await s
      .getByText("Đã lưu thuộc tính Chất liệu.", { exact: true })
      .waitFor();
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
        .getByRole("button", { name: "Lưu vào giỏ", exact: true })
        .isDisabled(),
    );
    await b
      .getByLabel("Màu sắc muốn mua", { exact: true })
      .selectOption({ label: "Đen" });
    await b
      .getByLabel("Kích thước muốn mua", { exact: true })
      .selectOption({ label: "L" });
    await b.getByLabel("Số lượng trong giỏ", { exact: true }).fill("2");
    let puts = 0;
    b.on("request", (r) => {
      if (
        r.url() === api + `/cart/items/${variants[1].id}` &&
        r.method() === "PUT"
      )
        puts++;
    });
    await b
      .getByRole("button", { name: "Lưu vào giỏ", exact: true })
      .dblclick();
    await b.getByText("Đã lưu số lượng 2 vào giỏ.", { exact: true }).waitFor();
    assert.equal(puts, 1);
    await b
      .getByRole("link", { name: "Xem giỏ và thanh toán", exact: true })
      .click();
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
    await s.reload();
    await s.getByRole("button", { name: /^Sản phẩm \(/ }).click();
    await s
      .getByText(marker, { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Chỉnh sửa", exact: true })
      .click();
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
  }
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
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        head,
        driverSha256,
        results,
        scope: values["multi-sku"]
          ? "Real multi-SKU/required attribute/approval/Buyer COD; synthetic actors, catalog and address; no external Search in this driver"
          : "Single default variant; real Web writes, API denial probes; synthetic actors/catalog",
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await vite?.close();
  await app?.close();
}
