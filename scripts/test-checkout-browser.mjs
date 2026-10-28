// Real Chromium -> real Nest HTTP -> isolated PostgreSQL; not demo/production.
// Requires BE build and provisioned QA migrations. No application source is changed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    channel: { type: "string", default: "chrome" },
    "integrated-aftersales": { type: "boolean", default: false },
    output: { type: "string", default: "artifacts/checkout-browser" },
    "evidence-output": { type: "string" },
  },
});
const db = new URL(process.env.DATABASE_URL ?? "");
assert.equal(db.protocol, "postgresql:");
assert.equal(db.username, "bckl_qa_app_20261021");
assert.equal(db.hostname, "127.0.0.1");
assert.equal(db.port, "5549");
assert(["/bckl_order_resolution_test_cod_journey_20261023_v924", "/bckl_order_resolution_test_attributes_20261019_v971"].includes(db.pathname));
assert(
  [...db.searchParams].every(([k, v]) => k === "schema" && v === "public"),
);
assert(!db.hash);
assert(
  process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET,
  "Explicit QA secrets required",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provenance = {
  checkoutHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  driverSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
};
for (const file of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, file));
    throw Error("Refuse local dotenv override");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const requireBE = createRequire(path.join(root, "BE/package.json"));
const requireFE = createRequire(path.join(root, "FE/package.json"));
requireBE("reflect-metadata");
const { Test } = requireBE("@nestjs/testing");
const loadBE = (name) =>
  import(pathToFileURL(path.join(root, "BE/dist", name)).href);
const { AppModule } = await loadBE("app.module.js");
const { configureApp } = await loadBE("configure-app.js");
const { PrismaService } = await loadBE("prisma.service.js");
const { createServer } = await import(
  pathToFileURL(requireFE.resolve("vite")).href
);
assert(values["playwright-module"]);
const { chromium } = requireBE(path.resolve(values["playwright-module"]));
await mkdir(values.output, { recursive: true });
if (values["evidence-output"])
  await mkdir(values["evidence-output"], { recursive: true });
const frontend = "http://127.0.0.1:5186";
process.env.FRONTEND_URL = frontend;
process.env.SEARCH_SYNC_ENABLED = "false";
process.env.SEARCH_RECONCILIATION_ENABLED = "false";
process.env.PRODUCT_IMAGE_REPAIR_ENABLED = "false";
process.env.ORDER_AUTO_COMPLETE_ENABLED = "false";
delete process.env.VITE_SELLER_ORDER_COMMANDS_ENABLED;
delete process.env.VITE_BUYER_ORDER_COMMANDS_ENABLED;
let app, vite, browser;
const results = [];
const marker = `browserqa-${randomUUID().slice(0, 18)}`;
const password = `Qa-only-${randomUUID()}!`;
try {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  const api = await app.getUrl();
  const prisma = app.get(PrismaService);
  const [qaRole] = await prisma.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert(!qaRole.rolsuper && !qaRole.rolcreatedb && !qaRole.rolcreaterole);
  if (db.pathname.endsWith("_v971")) {
    const [migrations] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    assert.equal(migrations.n,36);
  }
  process.env.VITE_API_URL = api;
  if (values["integrated-aftersales"]) { process.env.VITE_AFTERSALES_ENABLED="true";  }
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5186, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: values.channel });
  const passwordHash = await requireBE("bcryptjs").hash(password, 10);
  const seller = await prisma.user.create({
    data: {
      email: `${marker}-seller@example.test`,
      passwordHash,
      role: "SELLER",
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `${marker}-admin@example.test`,
      passwordHash,
      role: "ADMIN",
    },
  });
  const store = await prisma.store.create({
    data: {
      sellerId: seller.id,
      name: "QA — Cửa hàng kiểm thử",
      status: "ACTIVE",
    },
  });
  const category = await prisma.category.create({
    data: { name: "QA browser leaf", slug: marker },
  });
  async function http(endpoint, token, method = "GET", body, key) {
    const response = await fetch(api + endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = response.status === 204 ? null : await response.json();
    assert(response.ok, JSON.stringify(data));
    return data;
  }
  const cases = [
    ["desktop-light", 1440, 1080, "light", "success"],
    ["desktop-dark", 1440, 1080, "dark", "lost-response"],
    ["mobile-light", 390, 844, "light", "price"],
    ["mobile-dark", 390, 844, "dark", "stock"],
  ];
  for (const [name, width, height, colorScheme, scenario] of cases) {
    const email = `${marker}-${name}@example.test`;
    const session = await http("/auth/register", null, "POST", {
      email,
      password,
      accountType: "USER",
    });
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "QA — Tai nghe kiểm thử trình duyệt",
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: {
          create: { url: "/uploads/qa-browser-only.jpg", isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        skuCode: `${marker}-${name}`,
        optionSignature: "default",
        price: "10000.00",
        stock: 5,
      },
    });
    const untouched = await prisma.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        skuCode: `${marker}-${name}-other`,
        optionSignature: "other",
        price: "15000.00",
        stock: 5,
      },
    });
    await http(`/cart/items/${variant.id}`, session.accessToken, "PUT", {
      quantity: 2,
    });
    await http(`/cart/items/${untouched.id}`, session.accessToken, "PUT", {
      quantity: 1,
    });
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme,
    });
    const page = await context.newPage();
    assert.equal(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches), colorScheme === "dark");
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const shot = async (step) => {
      const filename = `${name}-${step}.png`;
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      await page.screenshot({
        path: path.join(values.output, filename),
        fullPage: true,
      });
      if (
        values["evidence-output"] &&
        [
          "mobile-dark-01-checkout.png",
          "mobile-light-03-rejected.png",
          "desktop-dark-03-pending.png",
          "mobile-dark-04-receipt.png",
        ].includes(filename)
      ) {
        // Only synthetic QA Checkout content; omit header/email/session surfaces.
        await page
          .locator("main h1")
          .locator("..")
          .screenshot({
            path: path.join(values["evidence-output"], filename),
            style: "header { visibility: hidden !important; }",
          });
      }
      return filename;
    };
    // Real login and refresh cookie, no injected AuthContext/access token.
    await page.goto(frontend + "/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL(frontend + "/");
    assert(
      (await context.cookies()).length > 0,
      "Real session cookie required",
    );
    await page.goto(frontend + "/account/addresses");
    await page.getByRole("button", { name: "+ Thêm địa chỉ mới" }).click();
    for (const [label, value] of [
      ["Họ và tên người nhận", "Người nhận QA"],
      ["Số điện thoại", "0901234567"],
      ["Tỉnh / thành phố", "Thành phố QA"],
      ["Phường / xã", "Phường QA"],
      ["Địa chỉ cụ thể", "10 Đường kiểm thử QA"],
    ])
      await page.getByLabel(new RegExp(label)).fill(value);
    await page
      .getByRole("button", { name: "Lưu địa chỉ", exact: true })
      .click();
    await page.getByText("Đã thêm địa chỉ.", { exact: true }).waitFor();
    await page.goto(frontend + "/cart");
    const selected = page.getByLabel(`Chọn biến thể ${variant.id}`, {
      exact: true,
    });
    await selected.check();
    await page
      .getByLabel(`Chọn biến thể ${untouched.id}`, { exact: true })
      .uncheck();
    await page.getByRole("link", { name: "Tiếp tục thanh toán" }).click();
    await page.getByRole("heading", { name: "Xác nhận mua hàng" }).waitFor();
    const preview = page.getByRole("button", { name: "Kiểm tra giá và kho" });
    await preview.waitFor();
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find(
          (b) => b.textContent === "Kiểm tra giá và kho",
        )?.disabled,
    );
    const screens = [await shot("01-checkout")];
    const measurements = await page
      .getByRole("heading", { name: "Xác nhận mua hàng" })
      .evaluate((h) => {
        const p = h.parentElement,
          hs = getComputedStyle(h),
          ps = getComputedStyle(p);
        const select = getComputedStyle(p.querySelector("select"));
        return {
          heading: hs.color,
          surface: ps.backgroundColor,
          text: ps.color,
          selectText: select.color,
          selectBackground: select.backgroundColor,
          pageWidth: p.scrollWidth,
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
    assert.equal(measurements.heading, "rgb(32, 36, 43)");
    assert.equal(measurements.surface, "rgb(246, 247, 248)");
    assert.equal(measurements.selectText, "rgb(32, 36, 43)");
    assert.equal(measurements.selectBackground, "rgb(255, 255, 255)");
    assert(
      measurements.documentWidth <= width,
      `${name} horizontal overflow ${JSON.stringify(measurements)}`,
    );
    await page.keyboard.press("Tab"); // Enter keyboard modality before checking :focus-visible.
    await preview.focus();
    assert.equal(
      await preview.evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
    await preview.press("Enter");
    const place = page.getByRole("button", {
      name: "Đặt hàng COD",
      exact: true,
    });
    await place.waitFor();
    screens.push(await shot("02-preview"));
    if (scenario === "price" || scenario === "stock") {
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: scenario === "price" ? { price: "12000.00" } : { stock: 1 },
      });
      await place.click();
      await page.getByRole("alert").first().waitFor();
      screens.push(await shot("03-rejected"));
      assert.equal(
        await prisma.order.count({ where: { buyerId: session.user.id } }),
        0,
      );
      assert.equal(
        await prisma.stockMovement.count({ where: { variantId: variant.id } }),
        0,
      );
      assert.equal(
        await prisma.searchOutbox.count({ where: { productId: product.id } }),
        0,
      );
      assert.equal(
        await prisma.cartItem.count({ where: { variantId: variant.id } }),
        1,
      );
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { price: "10000.00", stock: 5 },
      });
      await page.getByRole("button", { name: "Tải lại giỏ và giá" }).click();
      await preview.click();
      await place.waitFor();
    }
    const posts = [];
    if (scenario === "lost-response") {
      let lost = false;
      await page.route(api + "/checkouts", async (route) => {
        const request = route.request();
        if (request.method() !== "POST") return route.continue();
        posts.push({
          key: request.headers()["idempotency-key"],
          body: request.postData(),
        });
        if (lost) return route.continue();
        lost = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await response.body();
        await route.abort("failed");
      });
    }
    await place.click();
    if (scenario === "lost-response") {
      const retry = page.getByRole("button", { name: "Gửi lại cùng yêu cầu" });
      await retry.waitFor();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll("button")].find(
            (b) => b.textContent === "Gửi lại cùng yêu cầu",
          )?.disabled,
      );
      screens.push(await shot("03-pending"));
      await page.reload();
      await retry.waitFor();
      await retry.click();
    }
    await page
      .getByRole("heading", { name: "Đã ghi nhận đặt hàng COD" })
      .waitFor();
    screens.push(await shot("04-receipt"));
    const orders = await prisma.order.findMany({
      where: { buyerId: session.user.id },
      include: { items: true, payment: true },
    });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].total.toFixed(2), "20000.00");
    assert.equal(orders[0].status, "PENDING_CONFIRMATION");
    assert.equal(orders[0].payment.status, "UNPAID");
    assert.equal(orders[0].items.length, 1);
    assert.equal(orders[0].addressLineSnapshot, "10 Đường kiểm thử QA");
    assert.equal(
      (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id: variant.id },
        })
      ).stock,
      3,
    );
    assert.equal(
      (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id: untouched.id },
        })
      ).stock,
      5,
    );
    assert.equal(
      await prisma.stockMovement.count({ where: { variantId: variant.id } }),
      1,
    );
    assert.equal(
      await prisma.searchOutbox.count({ where: { productId: product.id } }),
      1,
    );
    assert.equal(
      await prisma.cartItem.count({ where: { variantId: variant.id } }),
      0,
    );
    assert.equal(
      await prisma.cartItem.count({ where: { variantId: untouched.id } }),
      1,
    );
    if (scenario === "lost-response") {
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[0], posts[1]);
    }
    // Extend only the success and lost-response journeys. Catalog/cart setup is
    // synthetic; Address, Cart selection, Checkout and the following Buyer/Seller
    // interactions use actual production pages and HTTP/PostgreSQL.
    if (scenario === "success" || scenario === "lost-response") {
      const id = orders[0].id;
      const version = (
        await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      ).version;
      await page
        .getByRole("link", {
          name: `Theo dõi đơn ${orders[0].orderNumber}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("region", { name: "Xử lý đơn Buyer", exact: true })
        .waitFor();
      if (scenario === "success") {
        const sellerContext = await browser.newContext({
          viewport: { width, height },
          colorScheme,
        });
        const sellerPage = await sellerContext.newPage();
        sellerPage.on("pageerror", (error) => pageErrors.push(error.message));
        await sellerPage.goto(frontend + "/login");
        await sellerPage
          .getByLabel("Email", { exact: true })
          .fill(seller.email);
        await sellerPage.getByLabel("Mật khẩu", { exact: true }).fill(password);
        await sellerPage
          .getByRole("button", { name: "Đăng nhập", exact: true })
          .click();
        await sellerPage
          .getByRole("button", { name: "Đăng xuất", exact: true })
          .waitFor();
        await sellerPage.goto(frontend + `/seller/orders/${id}`);
        for (const label of [
          "Xác nhận đơn",
          "Bắt đầu đóng gói",
          "Sẵn sàng bàn giao",
        ]) {
          const action = sellerPage.getByRole("button", {
            name: label,
            exact: true,
          });
          await action.waitFor();
          await sellerPage.waitForFunction(
            (name) =>
              [...document.querySelectorAll("button")].some(
                (b) => b.textContent.trim() === name && !b.disabled,
              ),
            label,
          );
          await action.click();
          await sellerPage.getByRole("checkbox").check();
          await sellerPage
            .getByRole("button", { name: "Xác nhận thao tác", exact: true })
            .evaluate((b) => {
              b.click();
              b.click();
            });
          await sellerPage
            .getByText(
              "Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng.",
              { exact: true },
            )
            .waitFor();
        }
        assert.equal(
          (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
          "READY_TO_SHIP",
        );
        await page.reload();
        await page
          .getByRole("region", { name: "Xử lý đơn Buyer", exact: true })
          .waitFor();
        await page
          .getByText("Chờ bàn giao vận chuyển", { exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Hủy đơn", exact: true })
            .count(),
          0,
        );
        screens.push(await shot("08-seller-prepared-buyer-view"));
        // Delivery remains the approved Admin simulation API, NOT an Admin UI.
        const adminSession = await http("/auth/login", null, "POST", {
          email: admin.email,
          password,
        });
        const trackingReference = `QA-${randomUUID()}`;
        await http(
          `/admin/orders/${id}/ship`,
          adminSession.accessToken,
          "POST",
          { trackingReference },
          randomUUID(),
        );
        await http(
          `/admin/orders/${id}/mark-delivered`,
          adminSession.accessToken,
          "POST",
          { trackingReference, deliveryAttempt: 1 },
          randomUUID(),
        );
        await page.reload();
        const complete = page.getByRole("button", {
          name: "Xác nhận đã nhận hàng",
          exact: true,
        });
        await complete.waitFor();
        await complete.click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Xác nhận hoàn tất đơn", exact: true })
          .evaluate((b) => {
            b.click();
            b.click();
          });
        await page
          .getByText(
            "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
            { exact: true },
          )
          .waitFor();
        assert.equal(
          (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
          "COMPLETED",
        );
        assert.equal(
          (await prisma.payment.findUniqueOrThrow({ where: { orderId: id } }))
            .status,
          "PAID",
        );
        assert.equal(
          await prisma.orderCommand.count({ where: { orderId: id } }),
          6,
        );
        assert.equal(
          await prisma.orderStatusHistory.count({ where: { orderId: id } }),
          7,
        );
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: variant.id },
            })
          ).stock,
          3,
        );
        assert.equal(
          await prisma.stockMovement.count({
            where: { variantId: variant.id },
          }),
          1,
        );
        assert.equal(
          await prisma.searchOutbox.count({ where: { productId: product.id } }),
          1,
        );
        assert.equal(
          (
            await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
            })
          ).version,
          version,
        );
        screens.push(await shot("09-completed"));
        if (values["integrated-aftersales"]) {
          // Same real COD Order, not a manufactured DELIVERED/COMPLETED fixture.
          const sellerSession = await http("/auth/login", null, "POST", {email:seller.email,password});
          const item = await prisma.orderItem.findFirstOrThrow({where:{orderId:id}});
          const [dbClock] = await prisma.$queryRaw`SELECT clock_timestamp() AS now`;
          const local = new Date(new Date(dbClock.now).getTime()+7*3600000).toISOString().slice(0,10);
          const end = new Date(Date.parse(local+"T00:00:00Z")+86400000).toISOString().slice(0,10);
          const summaryPath=`/seller/dashboard?from=${local}&to=${end}&bucket=day`;
          const beforeRevenue=await http(summaryPath,sellerSession.accessToken);
          assert.equal(beforeRevenue.totals.grossMerchandise,item.lineTotal.toFixed(2));
          assert.equal(beforeRevenue.totals.effectiveRefundMerchandise,"0.00");
          assert.equal(beforeRevenue.totals.netMerchandise,item.lineTotal.toFixed(2));
          let aftersaleCreates=0;
          const createEndpoint=api+`/aftersales/items/${item.id}/requests`;
          const countCreates=r=>{if(r.method()==="POST"&&r.url()===createEndpoint)aftersaleCreates++;};
          page.on("request",countCreates);
          await page.getByRole("link",{name:"Yêu cầu hỗ trợ cho mặt hàng này",exact:true}).click();
          const createForm=page.getByRole("region",{name:"Tạo yêu cầu hậu mãi"});
          await createForm.getByLabel("Phương án").selectOption("REFUND_ONLY");
          await createForm.getByLabel("Mô tả",{exact:true}).fill("QA sau COD thực tế: hàng nhận không đúng mô tả, kiểm hoàn tiền mô phỏng");
          await createForm.getByRole("checkbox").check();
          await createForm.locator("form").evaluate(form=>{form.requestSubmit();form.requestSubmit();});
          await page.getByText("Đã ghi nhận thao tác cho yêu cầu #",{exact:false}).waitFor();
          const requests=await prisma.aftersaleRequest.findMany({where:{orderItemId:item.id}});
          assert.equal(requests.length,1); assert.equal(aftersaleCreates,1); const requestId=requests[0].id;
          const aftersaleShot=await shot("10-aftersales-request-after-real-cod");
          await sellerPage.goto(frontend+"/seller/aftersales");
          await sellerPage.getByRole("button",{name:`Xem yêu cầu #${requestId}`,exact:true}).click();
          await sellerPage.getByRole("button",{name:"Chấp thuận",exact:true}).click();
          const decision=sellerPage.getByRole("form",{name:"Xác nhận xử lý hậu mãi"});
          await decision.getByLabel("Lý do quyết định",{exact:true}).fill("QA đã đối chiếu hàng nhận và yêu cầu hoàn tiền mô phỏng");
          await decision.getByRole("checkbox").check();
          const approvalEndpoint=`${api}/seller/aftersales/requests/${requestId}/approve`;
          const approvalPending=sellerPage.waitForRequest(r=>r.url()===approvalEndpoint&&r.method()==="POST");
          await decision.getByRole("button",{name:/^Xác nhận /}).click();
          const approvalRequest=await approvalPending, approvalBody=approvalRequest.postDataJSON();
          await sellerPage.getByText("Đã ghi nhận thao tác cho yêu cầu #",{exact:false}).waitFor();
          const replay=await http(`/seller/aftersales/requests/${requestId}/approve`,sellerSession.accessToken,"POST",approvalBody);
          assert.equal(replay.outcome,"APPLIED");
          assert.equal(await prisma.refundRecord.count({where:{requestId}}),1);
          const refund=await prisma.refundRecord.findFirstOrThrow({where:{requestId}});
          assert.equal(refund.amount.toFixed(2),item.lineTotal.toFixed(2));
          assert.equal(await prisma.revenueAdjustment.count({where:{refundId:refund.id}}),1);
          assert.equal((await prisma.productVariant.findUniqueOrThrow({where:{id:variant.id}})).stock,3);
          assert.equal(await prisma.stockMovement.count({where:{variantId:variant.id}}),1);
          assert.equal(await prisma.searchOutbox.count({where:{productId:product.id}}),1);
          const afterRevenue=await http(summaryPath,sellerSession.accessToken);
          assert.equal(afterRevenue.totals.grossMerchandise,item.lineTotal.toFixed(2));
          assert.equal(afterRevenue.totals.effectiveRefundMerchandise,item.lineTotal.toFixed(2));
          assert.equal(afterRevenue.totals.netMerchandise,"0.00");
          assert.equal(afterRevenue.pendingRefundMerchandise,"0.00");
          assert.equal(afterRevenue.dataQuality.invalidSnapshotOrderCount,0);
          // Seller dashboard UI must read the same committed ledger, no mocked response.
          await sellerPage.goto(frontend+"/seller");
          await sellerPage.getByRole("button",{name:"Thống kê",exact:true}).click();
          const dashboard=sellerPage.getByRole("region",{name:"Thống kê doanh thu và hoàn tiền"});
          await dashboard.getByRole("table").waitFor();
          await dashboard.getByLabel("Từ ngày",{exact:true}).fill(local);
          await dashboard.getByLabel("Đến trước ngày",{exact:true}).fill(end);
          await dashboard.getByLabel("Nhóm theo").selectOption("day");
          const filteredPending=sellerPage.waitForResponse(r=>{
            const u=new URL(r.url());return u.origin===api&&u.pathname==="/seller/dashboard"&&u.searchParams.get("from")===local&&u.searchParams.get("to")===end&&u.searchParams.get("bucket")==="day"&&r.request().method()==="GET"&&r.status()===200;
          });
          await dashboard.getByRole("button",{name:"Xem thống kê",exact:true}).click();
          const filtered=await (await filteredPending).json();
          assert.equal(filtered.totals.grossMerchandise,item.lineTotal.toFixed(2));
          assert.equal(filtered.totals.effectiveRefundMerchandise,item.lineTotal.toFixed(2));
          const normalizeMoney=x=>x.replace(/[\u00a0\u202f]/g," ");
          const expectedMoney=normalizeMoney(new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0}).format(Number(item.lineTotal.toString())));
          for(const [label,expected] of [["Doanh thu hàng hóa",expectedMoney],["Hoàn tiền có hiệu lực trong kỳ",expectedMoney],["Doanh thu thuần","0 ₫"]]){
            const card=dashboard.locator("article").filter({has:sellerPage.getByText(label,{exact:true})});
            await card.getByText(expected,{exact:true}).waitFor();
            assert.equal(normalizeMoney(await card.locator("strong").innerText()),expected);
          }
          const dashboardShot=`${name}-11-dashboard-after-real-refund.png`;
          await sellerPage.screenshot({path:path.join(values.output,dashboardShot),fullPage:true});
          assert.equal((await prisma.order.findUniqueOrThrow({where:{id}})).status,"COMPLETED");
          assert.equal((await prisma.payment.findUniqueOrThrow({where:{orderId:id}})).status,"PAID");
          // Projection reads/replayed command must not add ledger rows or stock effects.
          assert.equal(await prisma.refundRecord.count({where:{requestId}}),1);
          assert.equal(await prisma.revenueAdjustment.count({where:{refundId:refund.id}}),1);
          assert.equal(aftersaleCreates,1); page.off("request",countCreates);
          results.push({name:"integrated-cod-aftersales-dashboard",result:"PASS",screens:[aftersaleShot,dashboardShot],orderId:id,requestId,refundMode:"SIMULATED",gross:item.lineTotal.toFixed(2),refund:refund.amount.toFixed(2),net:"0.00",inventoryUnchangedByRefundOnly:true});
        }

        await sellerContext.close();
      } else {
        const cancel = page.getByRole("button", {
          name: "Hủy đơn",
          exact: true,
        });
        await cancel.waitFor();
        await cancel.click();
        await page
          .getByLabel("Mô tả lý do hủy", { exact: true })
          .fill("QA đổi kế hoạch mua sau khi khôi phục Checkout");
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Xác nhận hủy đơn", exact: true })
          .evaluate((b) => {
            b.click();
            b.click();
          });
        await page
          .getByText(
            "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
            { exact: true },
          )
          .waitFor();
        assert.equal(
          (await prisma.order.findUniqueOrThrow({ where: { id } })).status,
          "CANCELLED",
        );
        assert.equal(
          (await prisma.payment.findUniqueOrThrow({ where: { orderId: id } }))
            .status,
          "CANCELLED",
        );
        assert.equal(
          await prisma.orderCommand.count({ where: { orderId: id } }),
          1,
        );
        assert.equal(
          await prisma.orderStatusHistory.count({ where: { orderId: id } }),
          2,
        );
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: variant.id },
            })
          ).stock,
          5,
        );
        assert.equal(
          await prisma.stockMovement.count({
            where: { variantId: variant.id },
          }),
          2,
        );
        assert.equal(
          await prisma.searchOutbox.count({ where: { productId: product.id } }),
          2,
        );
        assert.equal(
          (
            await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
            })
          ).version,
          version + 1,
        );
        screens.push(await shot("09-cancelled-restocked"));
      }
      assert.equal(
        await prisma.orderCommandResolution.count({ where: { orderId: id } }),
        0,
      );
      assert.equal(
        (
          await prisma.productVariant.findUniqueOrThrow({
            where: { id: untouched.id },
          })
        ).stock,
        5,
      );
      assert.equal(
        await prisma.cartItem.count({ where: { variantId: untouched.id } }),
        1,
      );
    }
    if (name === "mobile-dark") {
      await http(`/cart/items/${untouched.id}`, session.accessToken, "DELETE");
      await page.goto(frontend + "/checkout");
      await page
        .getByText("Giỏ chưa có mặt hàng mua được.", { exact: true })
        .waitFor();
      assert(await preview.isDisabled());
      screens.push(await shot("05-empty"));
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route(api + "/cart", async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(frontend + "/checkout");
      await page
        .getByRole("status")
        .getByText("Đang tải địa chỉ và giỏ hàng…", { exact: true })
        .waitFor();
      screens.push(await shot("06-loading"));
      release();
      await page
        .getByText("Giỏ chưa có mặt hàng mua được.", { exact: true })
        .waitFor();
      await page.unroute(api + "/cart");
      await page.route(api + "/cart", (route) => route.abort("failed"));
      await page.goto(frontend + "/checkout");
      await page
        .getByRole("button", { name: "Tải lại", exact: true })
        .waitFor();
      assert.equal(
        await page.getByText(/Chưa có địa chỉ nhận hàng/).count(),
        0,
      );
      assert.equal(await preview.count(), 0);
      screens.push(await shot("07-network-error"));
      await page.unroute(api + "/cart");
      await page.getByRole("button", { name: "Tải lại", exact: true }).click();
      await page
        .getByText("Giỏ chưa có mặt hàng mua được.", { exact: true })
        .waitFor();
    }
    assert.deepEqual(pageErrors, []);
    results.push({
      name,
      scenario,
      colorScheme,
      themeBoundary: "Orange surfaces intentionally remain light under dark OS preference",
      result: "PASS",
      measurements,
      screens,
      orderId: orders[0].id,
      pageErrors,
    });
    console.log(`${name}: PASS`);
    await context.close();
  }
  await writeFile(
    path.join(values.output, "results.json"),
    JSON.stringify(
      {
        ...provenance,
        evidence: "REAL_BROWSER_HTTP_POSTGRES",
        marker,
        results,
      },
      null,
      2,
    ),
  );
  const escape = (value) =>
    String(value).replace(
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
    path.join(values.output, "report.html"),
    `<!doctype html><html lang="vi"><meta charset="utf-8"><title>COD journey QA</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;color:#20242b}img{max-width:100%;border:1px solid #ddd}pre{white-space:pre-wrap}</style><h1>Address / Cart / Checkout / Seller / Buyer — isolated browser QA</h1><p>Real Chrome / Nest / PostgreSQL. Synthetic catalog and cart setup; Address, selection, Checkout, Seller preparation and Buyer actions use actual Web pages. Delivery uses the real Admin simulation HTTP API, not Admin UI. No loaded Search/notifications/whole-marketplace acceptance.</p><pre>${escape(JSON.stringify({ marker, results }, null, 2))}</pre>${results.flatMap((r) => r.screens.map((file) => `<article><h2>${escape(file)}</h2><img src="${escape(file)}" alt="${escape(file)}"></article>`)).join("")}</html>`,
  );
  console.log("ALL 4 BROWSER SCENARIOS PASSED");
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
}
