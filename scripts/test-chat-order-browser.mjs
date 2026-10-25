// Real Chrome/Nest/Checkout/PostgreSQL. Exact isolated QA only; no dotenv.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    "playwright-module": { type: "string" },
    output: { type: "string" },
    channel: { type: "string", default: "chrome" },
  },
});
const target = new URL(process.env.DATABASE_URL ?? "");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "5549");
assert.equal(
  target.pathname,
  "/bckl_order_resolution_test_attributes_20261019_v945",
);
assert(
  !target.hash &&
    [...target.searchParams].every(
      ([k, v]) => k === "schema" && v === "public",
    ),
);
assert(
  process.env.JWT_ACCESS_SECRET &&
    process.env.JWT_REFRESH_SECRET &&
    values.output &&
    values["playwright-module"],
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, file));
    throw Error("Refusing local dotenv");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const provenance = {
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sha256: {},
};
for (const file of [
  "BE/src/chat/chat.service.ts",
  "BE/src/chat/chat.controller.ts",
  "BE/src/chat/chat-message-request.ts",
  "BE/prisma/schema.prisma",
  "BE/prisma/migrations/20261024170000_chat_order_context/migration.sql",
  "FE/src/features/chat/ChatPage.tsx",
  "FE/src/features/chat/chatApi.ts",
  "FE/src/features/chat/chatPending.ts",
  "FE/src/features/chat/ChatOrderCard.tsx",
  "FE/src/features/order-readiness/OrderReadPages.tsx",
  "scripts/test-chat-order-browser.mjs",
  "pnpm-lock.yaml",
])
  provenance.sha256[file] = createHash("sha256")
    .update(await readFile(path.join(root, file)))
    .digest("hex");
const be = createRequire(path.join(root, "BE/package.json")),
  fe = createRequire(path.join(root, "FE/package.json"));
be("reflect-metadata");
const load = (file) =>
  import(pathToFileURL(path.join(root, "BE/dist", file)).href);
const { Test } = be("@nestjs/testing"),
  { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js");
const { chromium } = be(path.resolve(values["playwright-module"]));
const { createServer } = await import(pathToFileURL(fe.resolve("vite")).href);
const frontend = "http://127.0.0.1:5189";
Object.assign(process.env, {
  FRONTEND_URL: frontend,
  CHAT_TEXT_ENABLED: "true",
  CHAT_ORDER_CONTEXT_ENABLED: "true",
  VITE_CHAT_ENABLED: "true",
  VITE_CHAT_ORDER_CONTEXT_ENABLED: "true",
  SEARCH_SYNC_ENABLED: "false",
  SEARCH_RECONCILIATION_ENABLED: "false",
  PRODUCT_IMAGE_REPAIR_ENABLED: "false",
  ORDER_AUTO_COMPLETE_ENABLED: "false",
});
const marker = "chatorderqa-" + randomUUID().slice(0, 10),
  password = "QA-only-" + randomUUID() + "!";
await mkdir(values.output, { recursive: true });
const results = [];
let app, vite, browser;
async function login(page, email) {
  await page.goto(frontend + "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}
try {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  const api = await app.getUrl(),
    db = app.get(PrismaService);
  process.env.VITE_API_URL = api;
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5189, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: values.channel });
  const hash = await be("bcryptjs").hash(password, 10);
  const user = (name, role) =>
    db.user.create({
      data: {
        email: `${marker}-${name}@example.test`,
        fullName: "QA " + name,
        passwordHash: hash,
        role,
      },
    });
  const outsider = await user("outsider", "USER");
  for (const [name, width, height, colorScheme] of [
    ["desktop-light", 1440, 1000, "light"],
    ["desktop-dark", 1440, 1000, "dark"],
    ["mobile-light", 390, 844, "light"],
    ["mobile-dark", 390, 844, "dark"],
  ]) {
    const buyer = await user(name + "-buyer", "USER"),
      seller = await user(name + "-seller", "SELLER");
    const store = await db.store.create({
      data: {
        sellerId: seller.id,
        name: "QA Order Store " + name,
        status: "ACTIVE",
      },
    });
    const category = await db.category.create({
      data: { name: "QA Chat Order", slug: marker + "-" + name },
    });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "QA Purchased " + name,
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: {
          create: {
            url: "/uploads/products/synthetic-order-only.png",
            isPrimary: true,
          },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: marker + "-" + name,
            optionSignature: "default",
            price: "10000",
            stock: 10,
          },
        },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0].id;
    const address = await db.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: "PRIVATE QA RECIPIENT",
        phone: "0901234567",
        province: "P",
        ward: "W",
        addressLine: "PRIVATE QA ADDRESS",
      },
    });
    const cart = await db.cart.create({ data: { userId: buyer.id } });
    await db.cartItem.create({
      data: { cartId: cart.id, variantId, quantity: 2 },
    });
    const auth = await fetch(api + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: buyer.email, password }),
    });
    assert.equal(auth.status, 200);
    const token = (await auth.json()).accessToken;
    const checkout = await fetch(api + "/checkouts", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Idempotency-Key": marker + "-" + name,
      },
      body: JSON.stringify({
        addressId: address.id,
        paymentProvider: "COD",
        items: [{ variantId, quantity: 2, expectedUnitPrice: "10000" }],
      }),
    });
    assert.equal(checkout.status, 201);
    const orderId = (await checkout.json()).orders[0].id;
    const businessBefore = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: true,
        payment: true,
        statusHistory: true,
        commands: true,
      },
    });
    const stockBefore = await db.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      }),
      outboxBefore = await db.searchOutbox.count({
        where: { productId: product.id },
      });
    const buyerContext = await browser.newContext({
        viewport: { width, height },
        colorScheme,
      }),
      sellerContext = await browser.newContext({
        viewport: { width, height },
        colorScheme,
      });
    const buyerPage = await buyerContext.newPage(),
      sellerPage = await sellerContext.newPage();
    buyerPage.setDefaultTimeout(12000);
    sellerPage.setDefaultTimeout(12000);
    await login(buyerPage, buyer.email);
    await login(sellerPage, seller.email);
    await buyerPage.goto(frontend + `/account/orders/${orderId}`);
    await buyerPage
      .getByRole("link", { name: "Trao đổi về đơn hàng", exact: true })
      .click();
    await buyerPage
      .getByRole("button", {
        name: `Mở trao đổi về đơn #${orderId}`,
        exact: true,
      })
      .click();
    await buyerPage.waitForURL((url) => /^\/messages\/\d+$/.test(url.pathname));
    const conversationId = Number(
      new URL(buyerPage.url()).pathname.split("/").at(-1),
    );
    assert.equal(await db.chatMessage.count({ where: { conversationId } }), 0);
    await sellerPage.goto(frontend + `/messages/${conversationId}`);
    await sellerPage
      .getByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.", {
        exact: true,
      })
      .waitFor();
    await buyerPage.getByLabel("Nội dung tin nhắn").fill("Keep draft");
    const share = buyerPage.getByRole("button", {
      name: `Chia sẻ đơn hàng #${orderId}`,
      exact: true,
    });
    await share.dblclick();
    const buyerCard = buyerPage.getByRole("article", {
      name: `Đơn hàng ${orderId}`,
      exact: true,
    });
    await buyerCard.waitFor();
    const dimensions = await buyerCard.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      scroll: element.scrollWidth,
      client: element.clientWidth,
      item: element.querySelector("li").getBoundingClientRect().width,
    }));
    assert(
      dimensions.width > 150 &&
        dimensions.item > 100 &&
        dimensions.scroll <= dimensions.client + 1,
      "Order card must not collapse into Product image column or overflow",
    );
    await sellerPage
      .getByRole("article", { name: `Đơn hàng ${orderId}`, exact: true })
      .waitFor();
    assert.equal(
      await buyerPage.getByLabel("Nội dung tin nhắn").inputValue(),
      "Keep draft",
    );
    assert.equal(
      await db.chatMessage.count({
        where: { conversationId, contextOrderId: orderId },
      }),
      1,
    );
    assert((await buyerCard.innerText()).includes("QA Purchased " + name));
    assert(!(await buyerCard.innerText()).includes("PRIVATE QA"));
    await buyerCard.scrollIntoViewIfNeeded();
    await buyerPage.screenshot({
      path: path.join(values.output, name + "-buyer-card.png"),
      fullPage: true,
    });
    await sellerPage.screenshot({
      path: path.join(values.output, name + "-seller-card.png"),
      fullPage: true,
    });
    // New explicit share from a reload, then lose the real successful HTTP response.
    await buyerPage.reload();
    let lost = false;
    await buyerPage.route("**/chat/conversations/*/messages", async (route) => {
      if (
        !lost &&
        route.request().method() === "POST" &&
        route.request().postDataJSON()?.type === "ORDER_CONTEXT"
      ) {
        lost = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort("failed");
      } else await route.continue();
    });
    await buyerPage
      .getByRole("button", {
        name: `Chia sẻ đơn hàng #${orderId}`,
        exact: true,
      })
      .click();
    await buyerPage
      .getByRole("button", { name: "Gửi lại cùng mã", exact: true })
      .waitFor();
    const pending = await buyerPage.evaluate(
      (id) => sessionStorage.getItem("chat-pending:v1:" + id),
      buyer.id,
    );
    assert(pending);
    await buyerPage.unroute("**/chat/conversations/*/messages");
    await buyerPage.reload();
    const retry = buyerPage.getByRole("button", {
      name: "Gửi lại cùng mã",
      exact: true,
    });
    await retry.waitFor();
    assert.equal(
      await db.chatMessage.count({
        where: { conversationId, contextOrderId: orderId },
      }),
      2,
    );
    const retried = buyerPage.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        req.url() === `${api}/chat/conversations/${conversationId}/messages`,
    );
    await retry.click();
    const savedIntent = JSON.parse(pending);
    assert.deepEqual((await retried).postDataJSON(), {
      clientMessageId: savedIntent.clientMessageId,
      type: "ORDER_CONTEXT",
      contextOrderId: orderId,
    });
    await buyerPage
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .waitFor();
    assert.equal(
      await db.chatMessage.count({
        where: { conversationId, contextOrderId: orderId },
      }),
      2,
    );
    assert.equal(
      await buyerPage.evaluate(
        (id) => sessionStorage.getItem("chat-pending:v1:" + id),
        buyer.id,
      ),
      null,
    );
    await buyerPage.screenshot({
      path: path.join(values.output, name + "-recovered.png"),
      fullPage: true,
    });
    // A different login must not render the previous participant's card.
    await login(buyerPage, outsider.email);
    await buyerPage.goto(frontend + `/messages/${conversationId}`);
    await buyerPage.getByRole("alert").first().waitFor();
    assert.equal(
      await buyerPage
        .getByRole("article", { name: `Đơn hàng ${orderId}`, exact: true })
        .count(),
      0,
    );
    await buyerPage.screenshot({
      path: path.join(values.output, name + "-outsider.png"),
      fullPage: true,
    });
    assert.deepEqual(
      await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: true,
          payment: true,
          statusHistory: true,
          commands: true,
        },
      }),
      businessBefore,
    );
    assert.deepEqual(
      await db.productVariant.findUniqueOrThrow({ where: { id: variantId } }),
      stockBefore,
    );
    assert.equal(
      await db.searchOutbox.count({ where: { productId: product.id } }),
      outboxBefore,
    );
    results.push({
      name,
      result: "PASS",
      checks: [
        "real COD Checkout",
        "Order UI to explicit Chat open/share",
        "Buyer/Seller live card",
        "doubleclick",
        "snapshot/privacy",
        "lost 201 + reload same-key replay",
        "different account denied",
        "no Order/stock/outbox mutation",
      ],
      orderId,
      conversationId,
    });
    await buyerContext.close();
    await sellerContext.close();
  }
  await writeFile(
    path.join(values.output, "report.json"),
    JSON.stringify(
      {
        provenance,
        results,
        limitations: [
          "Synthetic isolated QA data",
          "No media/video or Chat resolver",
          "No load benchmark",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      groups: results.length,
      output: values.output,
      source: provenance.head,
    }),
  );
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
}
