// Real Chrome / Nest / PostgreSQL. Synthetic data only, no dotenv/reset/demo.
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
assert.equal(
  url.pathname,
  "/bckl_order_resolution_test_attributes_20261019_v955",
);
assert.equal(url.username, "bckl_qa_app_20261021");
assert(
  !url.hash &&
    [...url.searchParams].every(([k, v]) => k === "schema" && v === "public") &&
    url.searchParams.getAll("schema").length <= 1,
);
for (const f of [".env", "BE/.env", "FE/.env", "FE/.env.local"])
  try {
    await access(path.join(root, f));
    throw Error("Refusing dotenv checkout");
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
process.env.PRODUCT_REVIEWS_ENABLED = "true";
process.env.ACCOUNT_BUYER_ACCESS_ENABLED = "true";
process.env.REVIEW_WINDOW_DAYS = "30";
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
  ),
  pw = await import(
    pathToFileURL(path.resolve(values["playwright-module"])).href
  );
const api = "http://127.0.0.1:3388",
  web = "http://127.0.0.1:5188";
process.env.FRONTEND_URL = web;
const files = [
  "FE/src/features/product-reviews/reviewClient.ts",
  "FE/src/features/product-reviews/ReviewPage.tsx",
  "FE/src/features/product-reviews/PublicProductReviews.tsx",
  "FE/src/features/product-reviews/ReviewPage.module.css",
  "FE/src/features/order-readiness/OrderPanels.tsx",
  "FE/src/pages/ProductDetailPage.tsx",
  "FE/src/pages/AdminDashboardPage.tsx",
  "FE/src/pages/SellerDashboardPage.tsx",
  "FE/src/routes/AppRouter.tsx",
  "BE/src/review/review.service.ts",
  "BE/src/review/review.controller.ts",
  "BE/src/review/review-input.ts",
  "scripts/test-product-review-browser.mjs",
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
  await app.listen(3388, "127.0.0.1");
  const db = app.get(PrismaService);
  const [role] =
    await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.name, url.pathname.slice(1));
  assert(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole);
  const [m] =
    await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(m.n, 29);
  const password = randomBytes(20).toString("hex"),
    passwordHash = await hash(password, 4),
    marker = randomUUID();
  async function actor(name, role) {
    return db.user.create({
      data: {
        email: `review-${name.toLowerCase()}-${marker}@example.invalid`,
        passwordHash,
        role,
        fullName: `Synthetic QA ${name}`,
      },
    });
  }
  const buyer = await actor("Buyer", "USER"),
    seller = await actor("Seller", "SELLER"),
    admin = await actor("Admin", "ADMIN"),
    other = await actor("Other", "USER");
  const store = await db.store.create({
      data: {
        sellerId: seller.id,
        name: "Synthetic Review QA Store",
        status: "ACTIVE",
      },
    }),
    category = await db.category.create({
      data: { name: "Review QA " + marker, slug: "review-qa-" + marker },
    });
  const product = await db.product.create({
    data: {
      storeId: store.id,
      categoryId: category.id,
      name: "Synthetic Review QA Product " + marker.slice(0, 6),
      description: "Synthetic completed-order review QA only",
      sellerStatus: "ACTIVE",
      moderationStatus: "APPROVED",
      images: {
        create: { url: "/uploads/synthetic-review.jpg", isPrimary: true },
      },
      shippingProfile: { create: { packageWeightGrams: 500 } },
    },
  });
  const variant = await db.productVariant.create({
    data: {
      storeId: store.id,
      productId: product.id,
      skuCode: "review-" + marker,
      optionSignature: "[]",
      price: "50000.00",
      stock: 5,
    },
  });
  async function order(age) {
    const completedAt = new Date(Date.now() - age * 86400000),
      checkout = await db.checkout.create({
        data: {
          buyerId: buyer.id,
          idempotencyKey: randomUUID(),
          requestHash: "synthetic-review-browser",
        },
      });
    return db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store.id,
        orderNumber: "review-" + randomUUID(),
        status: "COMPLETED",
        completedAt,
        deliveredAt: completedAt,
        recipientNameSnapshot: "Synthetic Buyer",
        phoneSnapshot: "0000000000",
        provinceSnapshot: "QA",
        wardSnapshot: "QA",
        addressLineSnapshot: "Synthetic QA address only",
        subtotal: "100000.00",
        shippingFee: "20000.00",
        total: "120000.00",
        payment: {
          create: {
            provider: "COD",
            status: "PAID",
            amount: "120000.00",
            paidAt: completedAt,
          },
        },
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            quantity: 2,
            unitPrice: "50000.00",
            lineTotal: "100000.00",
            productNameSnapshot: product.name,
            skuSnapshot: variant.skuCode,
            optionSnapshot: [],
          },
        },
      },
      include: { items: true },
    });
  }
  const completed = await order(1),
    expired = await order(31),
    itemId = completed.items[0].id;
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
  async function financial() {
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
  const beforeFinancial = await financial();
  vite = await createServer({
    root: path.join(root, "FE"),
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(api),
      "import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED": JSON.stringify("true"),
      "import.meta.env.VITE_ACCOUNT_BUYER_ACCESS_ENABLED":
        JSON.stringify("true"),
      "import.meta.env.VITE_BUYER_ORDER_COMMANDS_ENABLED":
        JSON.stringify("false"),
      "import.meta.env.VITE_SELLER_ORDER_COMMANDS_ENABLED":
        JSON.stringify("false"),
    },
    server: { host: "127.0.0.1", port: 5188, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({
    channel: "chrome",
    headless: true,
  });
  async function page(name) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
    });
    contexts.push(ctx);
    await ctx.route("**/*", (route) =>
      [api, web].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort(),
    );
    const p = await ctx.newPage();
    p.setDefaultTimeout(20000);
    p.on("pageerror", (e) =>
      pageErrors.push({ page: name, message: e.message }),
    );
    pages[name] = p;
    return p;
  }
  async function login(p, email, target) {
    await p.goto(web + "/login");
    await p.waitForFunction(async () => {
      const m = await import("/src/services/apiClient.ts");
      return m.getAuthSessionVersion() > 0;
    });
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.waitForURL((u) => u.pathname !== "/login");
    await p.goto(web + target);
  }
  const b = await page("BUYER"),
    s = await page("SELLER"),
    a = await page("ADMIN"),
    p = await page("PUBLIC");
  await login(b, buyer.email, `/account/orders/${completed.id}`);
  await b
    .getByRole("link", { name: "Đánh giá mặt hàng này", exact: true })
    .click();
  await b
    .getByLabel("Nhận xét của bạn", { exact: true })
    .fill("Synthetic Buyer review original");
  await b
    .getByRole("checkbox", {
      name: "Tôi xác nhận nội dung và thao tác đang chọn.",
      exact: true,
    })
    .check();
  let creates = 0,
    drop = true;
  await b.route(
    api + `/account/order-items/${itemId}/review/create`,
    async (route) => {
      creates++;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      if (drop) {
        drop = false;
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  const failed = b.waitForEvent("requestfailed", {
    predicate: (r) =>
      r.url() === api + `/account/order-items/${itemId}/review/create`,
  });
  await b
    .getByRole("button", { name: "Gửi đánh giá", exact: true })
    .evaluate((el) => {
      el.click();
      el.click();
    });
  await failed;
  await b
    .getByLabel("Yêu cầu đánh giá chờ đối chiếu", { exact: true })
    .waitFor();
  assert.equal(creates, 1);
  const journal = await b.evaluate(
    (id) => sessionStorage.getItem(`product-review-pending:v1:${id}`),
    buyer.id,
  );
  assert(journal);
  assert(!journal.includes("Synthetic Buyer review original"));
  assert.equal(
    await db.productReview.count({ where: { orderItemId: itemId } }),
    1,
  );
  await b.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await b.waitForURL((u) => u.pathname === "/login" || u.pathname === "/");
  await login(b, other.email, `/account/reviews?itemId=${itemId}`);
  await b.getByRole("alert").waitFor();
  assert.equal(
    await b
      .getByLabel("Yêu cầu đánh giá chờ đối chiếu", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await b.evaluate(
      (id) => sessionStorage.getItem(`product-review-pending:v1:${id}`),
      buyer.id,
    ),
    journal,
  );
  await b.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await b.waitForURL((u) => u.pathname === "/login" || u.pathname === "/");
  await login(b, buyer.email, `/account/reviews?itemId=${itemId}`);
  await b
    .getByLabel("Yêu cầu đánh giá chờ đối chiếu", { exact: true })
    .waitFor();
  await b.reload();
  await b
    .getByLabel("Yêu cầu đánh giá chờ đối chiếu", { exact: true })
    .waitFor();
  await b
    .getByRole("checkbox", { name: /Tôi đồng ý kiểm tra kết quả/ })
    .check();
  await b
    .getByRole("button", { name: "Đối chiếu yêu cầu cũ", exact: true })
    .click();
  await b
    .getByRole("status")
    .filter({ hasText: "Server đã xử lý yêu cầu trước đó" })
    .waitFor();
  assert.equal(creates, 1);
  assert.equal(
    await b.evaluate(
      (id) => sessionStorage.getItem(`product-review-pending:v1:${id}`),
      buyer.id,
    ),
    null,
  );
  results.push({
    check:
      "real_OrderItem_entry_same_tick_single_POST_postcommit_abort_logout_account_switch_reload_reconcile",
    pass: true,
    creates,
    limits: "Controlled abort after upstream200, not physical packet loss.",
  });
  await b.getByLabel("Điểm đánh giá", { exact: true }).selectOption("4");
  await b
    .getByLabel("Nhận xét của bạn", { exact: true })
    .fill("Synthetic Buyer edited review");
  await b
    .getByRole("checkbox", {
      name: "Tôi xác nhận nội dung và thao tác đang chọn.",
      exact: true,
    })
    .check();
  await b
    .getByRole("button", { name: "Lưu chỉnh sửa đánh giá", exact: true })
    .click();
  await b.getByText("4/5 · phiên bản 2", { exact: true }).waitFor();
  await login(s, seller.email, "/seller/reviews");
  await s.getByRole("button", { name: new RegExp(product.name) }).click();
  await s
    .getByLabel("Phản hồi của cửa hàng", { exact: true })
    .fill("Synthetic Seller thanks the Buyer");
  await s
    .getByRole("checkbox", {
      name: "Tôi xác nhận nội dung và thao tác đang chọn.",
      exact: true,
    })
    .check();
  await s.getByRole("button", { name: "Gửi phản hồi", exact: true }).click();
  await s
    .getByText("Cửa hàng đã có phản hồi cho đánh giá này.", { exact: true })
    .waitFor();
  await p.goto(web + `/products/${product.id}`);
  await p.getByText("4/5 từ 1 đánh giá", { exact: true }).waitFor();
  await p
    .getByText("Synthetic Seller thanks the Buyer", { exact: true })
    .waitFor();
  results.push({
    check: "Buyer_edit_Seller_single_reply_public_rating4_count1_and_reply",
    pass: true,
  });
  await login(a, admin.email, "/admin/reviews");
  await a.getByRole("button", { name: new RegExp(product.name) }).click();
  await a
    .getByLabel("Lý do ẩn (chỉ Admin)", { exact: true })
    .fill("INTERNAL_MODERATION_ONLY synthetic moderation reason");
  await a
    .getByRole("checkbox", {
      name: "Tôi xác nhận nội dung và thao tác đang chọn.",
      exact: true,
    })
    .check();
  let hides = 0;
  await a.route(api + `/admin/reviews/${itemId}/hide`, async (route) => {
    hides++;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort("failed");
  });
  const hideFailed = a.waitForEvent("requestfailed", {
    predicate: (r) => r.url() === api + `/admin/reviews/${itemId}/hide`,
  });
  await a.getByRole("button", { name: "Ẩn đánh giá", exact: true }).click();
  await hideFailed;
  await a.reload();
  await a
    .getByLabel("Yêu cầu đánh giá chờ đối chiếu", { exact: true })
    .waitFor();
  await a
    .getByRole("checkbox", { name: /Tôi đồng ý kiểm tra kết quả/ })
    .check();
  await a
    .getByRole("button", { name: "Đối chiếu yêu cầu cũ", exact: true })
    .click();
  await a
    .getByText("INTERNAL_MODERATION_ONLY synthetic moderation reason", {
      exact: true,
    })
    .waitFor();
  assert.equal(hides, 1);
  await p.reload();
  await p.getByText("Chưa có đánh giá", { exact: true }).waitFor();
  assert.equal(
    await p.getByText("Synthetic Buyer edited review", { exact: true }).count(),
    0,
  );
  assert.equal(
    await p
      .getByText("Synthetic Seller thanks the Buyer", { exact: true })
      .count(),
    0,
  );
  await b.reload();
  await b.getByLabel("Nhận xét của bạn", { exact: true }).waitFor();
  assert(
    !(await b.locator("body").innerText()).includes("INTERNAL_MODERATION_ONLY"),
  );
  await b.getByLabel("Điểm đánh giá", { exact: true }).selectOption("3");
  await b
    .getByLabel("Nhận xét của bạn", { exact: true })
    .fill("Synthetic Buyer edits a hidden review");
  await b
    .getByRole("checkbox", {
      name: "Tôi xác nhận nội dung và thao tác đang chọn.",
      exact: true,
    })
    .check();
  await b
    .getByRole("button", { name: "Lưu chỉnh sửa đánh giá", exact: true })
    .click();
  await b.getByText("3/5 · phiên bản 5", { exact: true }).waitFor();
  await p.reload();
  await p.getByText("Chưa có đánh giá", { exact: true }).waitFor();
  results.push({
    check:
      "Admin_hide_postcommit_abort_recovery_private_reason_public_exclusion_Buyer_edit_stays_hidden",
    pass: true,
    hides,
  });
  await b.goto(web + `/account/reviews?itemId=${expired.items[0].id}`);
  await b
    .getByText(
      "Mặt hàng này chưa đủ điều kiện hoặc đã hết hạn tạo/sửa đánh giá.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await b.getByRole("button", { name: "Gửi đánh giá", exact: true }).count(),
    0,
  );
  results.push({
    check: "expired_completed_OrderItem_disables_Buyer_review",
    pass: true,
  });
  await b.goto(web + `/account/reviews?itemId=${itemId}`);
  await b.getByText("3/5 · phiên bản 5", { exact: true }).waitFor();
  for (const [name, page] of Object.entries(pages))
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      const region = page.getByRole("region", {
        name:
          name === "BUYER"
            ? "Đánh giá mặt hàng đã mua"
            : name === "SELLER"
              ? "Phản hồi đánh giá"
              : name === "ADMIN"
                ? "Kiểm duyệt đánh giá"
                : "Đánh giá sản phẩm",
        exact: true,
      });
      assert(await region.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
      await page.screenshot({
        path: path.join(output, `${name.toLowerCase()}-${size}-light.png`),
        fullPage: true,
      });
      results.push({
        check: `${name}_${size}_light_no_form_region_overflow`,
        pass: true,
      });
    }
  const stored = await db.productReview.findUniqueOrThrow({
    where: { orderItemId: itemId },
    include: { reply: true, audits: true },
  });
  assert.equal(stored.revision, 5);
  assert.equal(stored.hidden, true);
  assert.equal(stored.audits.length, 5);
  assert(stored.reply);
  assert.equal(
    await db.productReviewCommand.count({ where: { orderItemId: itemId } }),
    5,
  );
  assert.equal(
    await db.productReview.count({
      where: { orderItemId: expired.items[0].id },
    }),
    0,
  );
  assert.deepEqual(await financial(), beforeFinancial);
  assert.deepEqual(await hashes(), sourceHashes);
  assert.deepEqual(pageErrors, []);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        results,
        database: url.pathname.slice(1),
        migrations: 29,
        appRole: "non-superuser/no-CREATEDB/no-CREATEROLE",
        itemId,
        reviewId: stored.id,
        revision: 5,
        financialCoreUnchanged: true,
        sourceHashes,
        limits:
          "Synthetic completed COD fixtures, not full COD delivery acceptance. Controlled response abort after upstream200, not physical loss. Browser flows sequential; races separately HTTP/PG. Desktop/mobile light only; not dark acceptance. No dotenv/reset/demo or real identity/payment. Data retained.",
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
  for (const [name, p] of Object.entries(pages)) {
    await p
      .screenshot({
        path: path.join(output, `${name.toLowerCase()}-failure.png`),
        fullPage: true,
      })
      .catch(() => {});
    await writeFile(
      path.join(output, `${name.toLowerCase()}-failure.txt`),
      await p.locator("body").innerText(),
    ).catch(() => {});
  }
  throw error;
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close()));
  await browser?.close();
  await vite?.close();
  await app?.close();
}
