// Production Buyer Order route, isolated real Chrome -> Nest HTTP -> PostgreSQL.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    output: { type: "string" },
    "seller-as-buyer": { type: "boolean", default: false },
  },
});
assert(values.output && values["playwright-module"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new URL(process.env.DATABASE_URL ?? "");
assert.equal(db.hostname, "127.0.0.1");
assert.equal(db.port, "5549");
assert.equal(
  db.pathname,
  values['seller-as-buyer']
    ? "/bckl_order_resolution_test_attributes_20261019_v931"
    : "/bckl_order_resolution_test_buyer_web_20261023_v916",
);
assert(
  !db.hash &&
    [...db.searchParams].every(
      ([key, value]) => key === "schema" && value === "public",
    ) &&
    db.searchParams.getAll("schema").length <= 1,
);
for (const f of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, f));
    throw Error(`Refuse local dotenv override ${f}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const frontend = "http://127.0.0.1:5194";
Object.assign(process.env, {
  FRONTEND_URL: frontend,
  SEARCH_SYNC_ENABLED: "false",
  SEARCH_RECONCILIATION_ENABLED: "false",
  PRODUCT_IMAGE_REPAIR_ENABLED: "false",
  ORDER_AUTO_COMPLETE_ENABLED: "false",
  ...(values['seller-as-buyer'] ? {
    ACCOUNT_BUYER_ACCESS_ENABLED: 'true',
    VITE_ACCOUNT_BUYER_ACCESS_ENABLED: 'true',
  } : {}),
});
const reqBE = createRequire(path.join(root, "BE/package.json"));
const reqFE = createRequire(path.join(root, "FE/package.json"));
reqBE("reflect-metadata");
const { Test } = reqBE("@nestjs/testing");
const load = (n) => import(pathToFileURL(path.join(root, "BE/dist", n)).href);
const { AppModule } = await load("app.module.js");
const { configureApp } = await load("configure-app.js");
const { PrismaService } = await load("prisma.service.js");
const { chromium } = reqBE(path.resolve(values["playwright-module"]));
const { createServer } = await import(
  pathToFileURL(reqFE.resolve("vite")).href
);
const marker = `buyer-web-${randomUUID().slice(0, 12)}`,
  password = `Qa-${randomUUID()}!`;
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const pageErrors = new WeakMap();
const results = [],
  screenshots = [],
  fixtures = [];
let app, vite, browser, p, api, activePage, browserVersion;
async function http(endpoint, token, method = "GET", body, key) {
  const response = await fetch(api + endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `${endpoint} HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function snapshot(f) {
  const order = await p.order.findUniqueOrThrow({ where: { id: f.orderId } });
  const product = await p.product.findUniqueOrThrow({
    where: { id: f.productId },
  });
  const payment = await p.payment.findUniqueOrThrow({
    where: { orderId: f.orderId },
  });
  return {
    status: order.status,
    payment: payment.status,
    total: order.total.toFixed(2),
    amount: payment.amount.toFixed(2),
    stock: (
      await p.productVariant.findMany({
        where: { productId: f.productId },
        orderBy: { id: "asc" },
      })
    ).map((v) => v.stock),
    version: product.version,
    outbox: await p.searchOutbox.count({ where: { productId: f.productId } }),
    history: await p.orderStatusHistory.count({
      where: { orderId: f.orderId },
    }),
    restores: await p.stockMovement.count({
      where: {
        type: "CANCELLATION_RESTORE",
        orderItem: { orderId: f.orderId },
      },
    }),
    commands: await p.orderCommand.count({
      where: { orderId: f.orderId, actorType: "BUYER" },
    }),
    fences: await p.orderCommandResolution.count({
      where: { orderId: f.orderId, actorType: "BUYER" },
    }),
  };
}
async function verify(f, outcome = "COMMITTED") {
  const after = await snapshot(f),
    before = f.before;
  const cancel = f.command === "cancel",
    committed = outcome === "COMMITTED";
  assert.deepEqual(after, {
    ...before,
    status: committed ? (cancel ? "CANCELLED" : "COMPLETED") : before.status,
    payment: committed && cancel ? "CANCELLED" : before.payment,
    stock: committed && cancel ? [2, 2] : before.stock,
    version: before.version + (committed && cancel ? 1 : 0),
    outbox: before.outbox + (committed && cancel ? 1 : 0),
    history: before.history + (committed ? 1 : 0),
    restores: before.restores + (committed && cancel ? 2 : 0),
    commands: before.commands + (committed ? 1 : 0),
    fences: before.fences + (outcome === "CLOSED_WITHOUT_EXECUTION" ? 1 : 0),
  });
  return after;
}
async function screenshot(page, name) {
  const workspace = page.getByRole("region", {
    name: "Xử lý đơn Buyer",
    exact: true,
  });
  if (await workspace.count()) {
    const heights = await workspace
      .locator("button")
      .evaluateAll((buttons) =>
        buttons
          .map((button) => button.getBoundingClientRect().height)
          .filter((height) => height > 0),
      );
    assert(
      heights.every((height) => height >= 44),
      "Buyer workspace controls need 44px tap targets",
    );
  }
  await page.evaluate(() => {
    scrollTo(0, 0);
    return new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  });
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
  screenshots.push(name + ".png");
}
const label = (f) =>
  f.command === "cancel" ? "Xác nhận hủy đơn" : "Xác nhận hoàn tất đơn";
async function login(page, email) {
  await page.goto(frontend + "/login");
  await page.getByRole("heading", { name: "Đăng nhập", exact: true }).waitFor();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).waitFor();
}
async function open(f, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    ...options,
  });
  const page = await context.newPage();
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  activePage = page;
  page.setDefaultTimeout(15000);
  const posts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/orders\/\d+\/(cancel|complete|resolve-command)$/.test(
        new URL(request.url()).pathname,
      )
    )
      posts.push({
        path: new URL(request.url()).pathname,
        key: request.headers()["idempotency-key"] ?? null,
      });
  });
  await login(page, f.buyer.user.email);
  await page.goto(`${frontend}/account/orders/${f.orderId}`);
  await page
    .getByRole("button", {
      name: f.command === "cancel" ? "Hủy đơn" : "Xác nhận đã nhận hàng",
      exact: true,
    })
    .waitFor();
  assert.equal(posts.length, 0, "Mount must not execute/resolve automatically");
  return { context, page, posts };
}
async function consent(page, f) {
  await page
    .getByRole("button", {
      name: f.command === "cancel" ? "Hủy đơn" : "Xác nhận đã nhận hàng",
      exact: true,
    })
    .click();
  const submit = page.getByRole("button", { name: label(f), exact: true });
  assert(await submit.isDisabled());
  if (f.command === "cancel") {
    await page.getByLabel("Lý do hủy", { exact: true }).selectOption("OTHER");
    await page
      .getByLabel("Mô tả lý do hủy", { exact: true })
      .fill("QA — mua nhầm phân loại");
  }
  await page.getByRole("checkbox").check();
  if (f.command === "cancel") {
    await page
      .getByLabel("Mô tả lý do hủy", { exact: true })
      .fill("QA — đổi ý sau khi kiểm tra");
    assert(await submit.isDisabled(), "Editing reason must invalidate consent");
    await page.getByRole("checkbox").check();
  }
  assert(await submit.isEnabled());
}
async function submitTwice(page, f) {
  await page
    .getByRole("button", { name: label(f), exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
}
const pending = (page, f) =>
  page.evaluate(
    (id) =>
      JSON.parse(sessionStorage.getItem(`bckl-order-command-journal-v1:${id}`)),
    f.buyer.user.id,
  );
async function unknown(page, timeout = 15000) {
  await page
    .getByRole("region", { name: "Đối chiếu yêu cầu người mua", exact: true })
    .waitFor({ timeout });
}
async function resolve(page) {
  const display = await page
    .getByRole("region", { name: "Đối chiếu yêu cầu người mua", exact: true })
    .getByRole("checkbox")
    .evaluate((box) => {
      const style = getComputedStyle(box.closest("label"));
      return [style.display, style.flexWrap];
    });
  assert.deepEqual(
    display,
    ["flex", "nowrap"],
    "Recovery consent must keep checkbox beside wrapping text on mobile",
  );
  const button = page.getByRole("button", {
    name: "Đối chiếu / dừng yêu cầu cũ",
    exact: true,
  });
  assert(await button.isDisabled());
  await page
    .getByRole("region", { name: "Đối chiếu yêu cầu người mua", exact: true })
    .getByRole("checkbox")
    .check();
  await button.click();
}
async function known(page, status) {
  await page
    .getByRole("status")
    .filter({ hasText: "Đã xác minh biên nhận và tải lại đơn." })
    .waitFor();
  await page
    .getByText(
      `${status === "CANCELLED" ? "Đã hủy" : "Hoàn tất"} · QA Buyer Browser Shop`,
      { exact: true },
    )
    .waitFor();
}
async function record(name, f, page, posts, outcome = "COMMITTED") {
  assert.deepEqual(pageErrors.get(page), [], "Uncaught browser script error");
  const after = await verify(f, outcome);
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(bounds.scroll <= bounds.width, `Horizontal overflow ${name}`);
  await screenshot(page, name);
  results.push({
    name,
    result: "PASS",
    orderId: f.orderId,
    before: f.before,
    after,
    requests: posts,
    bounds,
  });
  console.log(`PASS ${name}`);
}
try {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  api = await app.getUrl();
  p = app.get(PrismaService);
  process.env.VITE_API_URL = api;
  // Vite must not silently load .env.development[.local] over the explicit QA API.
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5194, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  browserVersion = browser.version();
  const passwordHash = await reqBE("bcryptjs").hash(password, 10);
  async function actor(role, suffix) {
    const user = await p.user.create({
      data: { email: `${marker}-${suffix}@example.test`, passwordHash, role },
    });
    const auth = await http("/auth/login", null, "POST", {
      email: user.email,
      password,
    });
    return { user, token: auth.accessToken };
  }
  const seller = await actor("SELLER", "seller"),
    admin = await actor("ADMIN", "admin"),
    other = await actor("USER", "other");
  const store = await p.store.create({
    data: {
      sellerId: seller.user.id,
      name: "QA Buyer Browser Shop",
      status: "ACTIVE",
    },
  });
  const category = await p.category.create({
    data: { name: "QA Browser Leaf", slug: marker },
  });
  async function fixture(command, name) {
    const buyer = await actor(values['seller-as-buyer'] ? "SELLER" : "USER", name);
    if (values['seller-as-buyer']) {
      await p.store.create({ data: { sellerId: buyer.user.id, name: `${marker}-${name}-own-store`, status: 'SUSPENDED' } });
    }
    const product = await p.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "QA Buyer Product",
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: {
          create: {
            url: "/uploads/qa-browser-metadata-only.jpg",
            isPrimary: true,
          },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const group = await p.productOptionGroup.create({
      data: { productId: product.id, name: "Màu sắc" },
    });
    const variants = [];
    for (const color of ["Cam", "Trắng"]) {
      const option = await p.productOptionValue.create({
        data: { groupId: group.id, productId: product.id, value: color },
      });
      const variant = await p.productVariant.create({
        data: {
          productId: product.id,
          storeId: store.id,
          skuCode: randomUUID(),
          optionSignature: String(option.id),
          price: "10000.00",
          stock: 2,
        },
      });
      await p.productVariantOptionValue.create({
        data: {
          variantId: variant.id,
          productId: product.id,
          optionGroupId: group.id,
          optionValueId: option.id,
        },
      });
      variants.push(variant);
    }
    const address = await http("/me/addresses", buyer.token, "POST", {
      recipientName: "Buyer QA",
      phone: "0901234567",
      province: "QA",
      ward: "QA",
      addressLine: "QA riêng, không phải địa chỉ giao thật",
      isDefault: true,
    });
    for (const v of variants)
      await http(`/cart/items/${v.id}`, buyer.token, "PUT", { quantity: 2 });
    const checkout = await http(
      "/checkouts",
      buyer.token,
      "POST",
      {
        addressId: address.id,
        paymentProvider: "COD",
        items: variants.map((v) => ({
          variantId: v.id,
          quantity: 2,
          expectedUnitPrice: "10000.00",
        })),
      },
      randomUUID(),
    );
    const f = {
      command,
      buyer,
      productId: product.id,
      orderId: checkout.orders[0].id,
    };
    if (command === "complete") {
      for (const step of ["confirm", "start-packing", "ready-to-ship"])
        await http(
          `/seller/orders/${f.orderId}/${step}`,
          seller.token,
          "POST",
          {},
          randomUUID(),
        );
      const trackingReference = `QA-${f.orderId}`;
      await http(
        `/admin/orders/${f.orderId}/ship`,
        admin.token,
        "POST",
        { trackingReference },
        randomUUID(),
      );
      await http(
        `/admin/orders/${f.orderId}/mark-delivered`,
        admin.token,
        "POST",
        { trackingReference, deliveryAttempt: 1 },
        randomUUID(),
      );
    }
    f.before = await snapshot(f);
    fixtures.push({ name, orderId: f.orderId, productId: f.productId });
    return f;
  }
  for (const [device, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ])
    for (const colorScheme of ["light", "dark"])
      for (const command of ["cancel", "complete"]) {
        const name = `${device}-${colorScheme}-${command}`,
          f = await fixture(command, name);
        const { page, context, posts } = await open(f, {
          viewport: { width, height },
          colorScheme,
        });
        await consent(page, f);
        await screenshot(page, name + "-confirm");
        await submitTwice(page, f);
        await known(page, command === "cancel" ? "CANCELLED" : "COMPLETED");
        assert.equal(posts.length, 1);
        assert.equal(await pending(page, f), null);
        await record(name, f, page, posts);
        await context.close();
      }
  for (const command of ["cancel", "complete"]) {
    const name = `lost-response-reload-${command}`,
      f = await fixture(command, name),
      { page, context, posts } = await open(
        f,
        command === "cancel"
          ? { viewport: { width: 390, height: 844 }, colorScheme: "dark" }
          : {},
      );
    await page.route(api + `/orders/${f.orderId}/${command}`, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    });
    await consent(page, f);
    await submitTwice(page, f);
    await unknown(page);
    const original = await pending(page, f);
    assert(original);
    await verify(f);
    await screenshot(page, name + "-pending");
    await page.reload();
    await unknown(page);
    assert.equal(
      (await pending(page, f)).idempotencyKey,
      original.idempotencyKey,
    );
    assert.equal(posts.length, 1, "Reload must not re-execute or auto-resolve");
    await resolve(page);
    await known(page, command === "cancel" ? "CANCELLED" : "COMPLETED");
    assert.equal(await pending(page, f), null);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].key, original.idempotencyKey);
    await record(name, f, page, posts);
    await context.close();
  }
  for (const command of ["cancel", "complete"]) {
    const name = `committed-get-failure-${command}`,
      f = await fixture(command, name),
      { page, context, posts } = await open(
        f,
        command === "cancel"
          ? { viewport: { width: 390, height: 844 }, colorScheme: "dark" }
          : {},
      );
    await consent(page, f);
    await page.route(api + `/orders/${f.orderId}`, (route) =>
      route.abort("failed"),
    );
    await submitTwice(page, f);
    await page
      .getByRole("button", { name: "Tải lại đơn", exact: true })
      .waitFor();
    assert.equal(await pending(page, f), null);
    assert.equal(posts.length, 1);
    await screenshot(page, name + "-error");
    assert.equal(
      await page.getByRole("button", { name: label(f), exact: true }).count(),
      0,
    );
    await page.unroute(api + `/orders/${f.orderId}`);
    await page
      .getByRole("button", { name: "Tải lại đơn", exact: true })
      .click();
    await known(page, command === "cancel" ? "CANCELLED" : "COMPLETED");
    assert.equal(posts.length, 1);
    await record(name, f, page, posts);
    await context.close();
  }
  {
    const name = "closed-without-execution",
      f = await fixture("cancel", name),
      { page, context, posts } = await open(f);
    await page.route(api + `/orders/${f.orderId}/cancel`, (route) =>
      route.abort("failed"),
    );
    await consent(page, f);
    await submitTwice(page, f);
    await unknown(page);
    await resolve(page);
    await page
      .getByRole("status")
      .filter({ hasText: "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn." })
      .waitFor();
    assert.equal(await pending(page, f), null);
    assert.equal(posts.length, 2);
    await record(name, f, page, posts, "CLOSED_WITHOUT_EXECUTION");
    const oldKey = posts[0].key;
    f.before = await snapshot(f);
    await page.unroute(api + `/orders/${f.orderId}/cancel`);
    await consent(page, f);
    await submitTwice(page, f);
    await known(page, "CANCELLED");
    assert.equal(posts.length, 3);
    assert.notEqual(posts[2].key, oldKey);
    await record("closed-then-separate-new-intent", f, page, posts);
    await context.close();
  }
  {
    const name = "account-switch-held-committed",
      f = await fixture("cancel", name),
      { page, context, posts } = await open(f);
    let release, reached;
    const gate = new Promise((r) => {
        release = r;
      }),
      started = new Promise((r) => {
        reached = r;
      });
    await page.route(api + `/orders/${f.orderId}/cancel`, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      reached();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* Detached old session. */
      }
    });
    await consent(page, f);
    await submitTwice(page, f);
    await started;
    const original = await pending(page, f);
    assert(original);
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await login(page, other.user.email);
    await page.goto(`${frontend}/account/orders/${f.orderId}`);
    release();
    await page
      .getByRole("alert")
      .filter({
        hasText: "Chưa tải được đơn hoặc bạn không có quyền truy cập.",
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("region", { name: "Chi tiết đơn hàng", exact: true })
        .count(),
      0,
    );
    assert.equal(
      (await pending(page, f)).idempotencyKey,
      original.idempotencyKey,
    );
    await screenshot(page, name + "-other-user");
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await login(page, f.buyer.user.email);
    await page.goto(`${frontend}/account/orders/${f.orderId}`);
    await unknown(page);
    await resolve(page);
    await known(page, "CANCELLED");
    assert.equal(await pending(page, f), null);
    assert.equal(posts.length, 2);
    await record(name, f, page, posts);
    await context.close();
  }
  {
    const name = "seller-confirms-after-buyer-read",
      f = await fixture("cancel", name),
      { page, context, posts } = await open(f);
    await consent(page, f);
    await http(
      `/seller/orders/${f.orderId}/confirm`,
      seller.token,
      "POST",
      {},
      randomUUID(),
    );
    f.before = await snapshot(f);
    assert.equal(f.before.status, "CONFIRMED");
    await submitTwice(page, f);
    await unknown(page);
    assert(await pending(page, f));
    await resolve(page);
    await page
      .getByRole("status")
      .filter({ hasText: "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn." })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Hủy đơn", exact: true }).count(),
      0,
    );
    assert.equal(posts.length, 2);
    await record(name, f, page, posts, "CLOSED_WITHOUT_EXECUTION");
    await context.close();
  }
  {
    const name = "storage-quota-before-post",
      f = await fixture("cancel", name),
      { page, context, posts } = await open(f);
    await consent(page, f);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (
          this === window.sessionStorage &&
          key.startsWith("bckl-order-command-journal-")
        )
          throw new DOMException("QA write denied", "QuotaExceededError");
        return Reflect.apply(original, this, [key, value]);
      };
    });
    await submitTwice(page, f);
    await page
      .getByRole("alert")
      .filter({ hasText: "Không thể xác minh phiên hoặc bộ nhớ yêu cầu." })
      .waitFor();
    assert.equal(posts.length, 0);
    assert.equal(await pending(page, f), null);
    await record(name, f, page, posts, "NO_EXECUTION");
    await context.close();
  }
  {
    const name = "malformed-real-http200-after-commit",
      f = await fixture("cancel", name),
      { page, context, posts } = await open(f);
    await page.route(api + `/orders/${f.orderId}/cancel`, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.fulfill({
        response,
        json: { ...(await response.json()), injected: true },
      });
    });
    await consent(page, f);
    await submitTwice(page, f);
    await unknown(page);
    const original = await pending(page, f);
    assert(original);
    await resolve(page);
    await known(page, "CANCELLED");
    assert.equal(posts.length, 2);
    await record(name, f, page, posts);
    await context.close();
  }
  {
    const name = "actual-30s-timeout-after-commit",
      f = await fixture("cancel", name),
      { page, context, posts } = await open(f);
    let release, reached;
    const gate = new Promise((r) => {
        release = r;
      }),
      started = new Promise((r) => {
        reached = r;
      });
    await page.route(api + `/orders/${f.orderId}/cancel`, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      reached();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* Actual browser deadline aborted the response. */
      }
    });
    await consent(page, f);
    const began = Date.now();
    await submitTwice(page, f);
    await started;
    await unknown(page, 45000);
    const elapsed = Date.now() - began;
    assert(elapsed >= 29000 && elapsed < 45000);
    const original = await pending(page, f);
    assert(original);
    await verify(f);
    release();
    await resolve(page);
    await known(page, "CANCELLED");
    assert.equal(posts.length, 2);
    await record(name, f, page, posts);
    results[results.length - 1].observedTimeoutMs = elapsed;
    await context.close();
  }
  console.log(`BUYER PRODUCTION ROUTE CHROME QA ${results.length}/19 PASS`);
} catch (error) {
  results.push({ name: "run", result: "FAIL", message: error.message });
  if (activePage && !activePage.isClosed())
    await screenshot(activePage, "failure").catch(() => {});
  throw error;
} finally {
  const evidence = {
    marker,
    layer: "REAL_CHROME_HTTP_POSTGRES",
    buyerAccountRole: values['seller-as-buyer'] ? 'SELLER' : 'USER',
    browserVersion,
    headless: true,
    results,
    screenshots,
    fixtures,
    limitations: [
      "Actual /account/orders/:id production route, isolated QA Backend/data only",
      "Chrome desktop and mobile viewport emulation, not physical phone",
      "Dark OS tested with intentional light storefront; no full dark theme claim",
      "Catalog/actors are synthetic DB fixtures; Checkout and Order commands are real HTTP",
      "No Search worker dispatch/ES/FAISS tested",
      "Session journal survives reload, not tab closure",
      "Fixtures retained on isolated QA DB; no credentials or cookies saved",
    ],
  };
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(evidence, null, 2),
  );
  const escape = (text) =>
    String(text).replace(
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
    `<!doctype html><meta charset="utf-8"><title>Buyer Order Web — Chrome QA</title><style>body{font:16px system-ui;max-width:1000px;margin:auto;padding:24px;background:#f6f7f8;color:#20242b}img{max-width:100%;border:1px solid #ccc}article{margin:24px 0}pre{white-space:pre-wrap}</style><h1>Buyer production Order route — isolated QA data</h1><p>Actual Chrome ${escape(browserVersion)} · /account/orders/:id with real Auth/Nest/PostgreSQL. Not full marketplace acceptance.</p><pre>${escape(JSON.stringify(evidence, null, 2))}</pre>${screenshots.map((s) => `<article><h2>${escape(s)}</h2><img src="${escape(s)}" alt="${escape(s)}"></article>`).join("")}`,
  );
  await browser?.close();
  await vite?.close();
  await app?.close();
}
