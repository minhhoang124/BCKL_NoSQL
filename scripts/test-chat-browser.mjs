// Isolated QA only: real Chrome + Socket.IO + Nest HTTP + PostgreSQL, no demo.
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
  "/bckl_order_resolution_test_attributes_20261019_v944",
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
    values["playwright-module"] &&
    values.output,
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provenance = {
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sha256: {},
};
for (const file of [
  "BE/src/chat/chat.gateway.ts",
  "BE/src/chat/chat.service.ts",
  "FE/src/features/chat/ChatPage.tsx",
  "FE/src/features/chat/chatApi.ts",
  "FE/src/features/chat/chatPending.ts",
  "FE/src/features/chat/ChatProductCard.tsx",
  "FE/src/features/chat/chatProductProjection.ts",
  "BE/prisma/schema.prisma",
  "BE/prisma/migrations/20261024110000_chat_product_context/migration.sql",
  "FE/src/features/chat/ChatPage.module.css",
  "scripts/test-chat-browser.mjs",
  "pnpm-lock.yaml",
])
  provenance.sha256[file] = createHash("sha256")
    .update(await readFile(path.join(root, file)))
    .digest("hex");
for (const name of [".env", "BE/.env", "FE/.env", "FE/.env.local"]) {
  try {
    await access(path.join(root, name));
    throw Error("Refuse local dotenv");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const be = createRequire(path.join(root, "BE/package.json")),
  fe = createRequire(path.join(root, "FE/package.json"));
be("reflect-metadata");
const { Test } = be("@nestjs/testing");
const load = (file) =>
  import(pathToFileURL(path.join(root, "BE/dist", file)).href);
const { AppModule } = await load("app.module.js"),
  { configureApp } = await load("configure-app.js"),
  { PrismaService } = await load("prisma.service.js"),
  { ChatService } = await load("chat/chat.service.js");
const { createServer } = await import(pathToFileURL(fe.resolve("vite")).href);
const { chromium } = be(path.resolve(values["playwright-module"]));
const frontend = "http://127.0.0.1:5189";
process.env.FRONTEND_URL = frontend;
process.env.CHAT_TEXT_ENABLED = "true";
process.env.VITE_CHAT_ENABLED = "true";
process.env.CHAT_PRODUCT_CONTEXT_ENABLED = 'true';
process.env.VITE_CHAT_PRODUCT_CONTEXT_ENABLED = 'true';
process.env.UPLOAD_ROOT = path.join(values.output, 'qa-uploads');
for (const flag of [
  "SEARCH_SYNC_ENABLED",
  "SEARCH_RECONCILIATION_ENABLED",
  "PRODUCT_IMAGE_REPAIR_ENABLED",
  "ORDER_AUTO_COMPLETE_ENABLED",
])
  process.env[flag] = "false";
await mkdir(values.output, { recursive: true });
await mkdir(path.join(process.env.UPLOAD_ROOT, 'products'), { recursive: true });
await writeFile(path.join(process.env.UPLOAD_ROOT, 'products', 'qa-chat-only.png'), await be('sharp')({ create: { width: 32, height: 32, channels: 3, background: '#ff6b00' } }).png().toBuffer());
const results = [];
let app, vite, browser;
const marker = `chatqa-${randomUUID().slice(0, 12)}`,
  password = `Qa-only-${randomUUID()}!`;
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
  app.useStaticAssets(process.env.UPLOAD_ROOT, { prefix: '/uploads/' });
  await app.listen(0, "127.0.0.1");
  const api = await app.getUrl(),
    db = app.get(PrismaService),
    chat = app.get(ChatService);
  process.env.VITE_API_URL = api;
  vite = await createServer({
    root: path.join(root, "FE"),
    envDir: false,
    server: { host: "127.0.0.1", port: 5189, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: values.channel });
  const passwordHash = await be("bcryptjs").hash(password, 10);
  const user = async (suffix, role) =>
    db.user.create({
      data: {
        email: `${marker}-${suffix}@example.test`,
        fullName: `QA ${suffix}`,
        passwordHash,
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
    const buyer = await user(`${name}-buyer`, "USER"),
      seller = await user(`${name}-seller`, "SELLER");
    const store = await db.store.create({
      data: { sellerId: seller.id, name: `QA Chat ${name}`, status: "ACTIVE" },
    });
    const category = await db.category.create({
      data: { name: "QA Chat", slug: `${marker}-${name}` },
    });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: "QA Chat product",
        sellerStatus: "ACTIVE",
        moderationStatus: "APPROVED",
        images: {
          create: { url: "/uploads/products/qa-chat-only.png", isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: `${marker}-${name}`,
            optionSignature: "default",
            price: "10000",
            stock: 5,
          },
        },
      },
    });
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width, height }, colorScheme }),
      browser.newContext({ viewport: { width, height }, colorScheme }),
    ]);
    const [buyerContext, sellerContext] = contexts,
      a = await buyerContext.newPage(),
      b = await sellerContext.newPage();
    const pages = [a, b];
    const browserErrors = [];
    pages.forEach((page) =>
      page.on("pageerror", (e) => browserErrors.push(e.message)),
    );
    try {
      await login(a, buyer.email);
      await a.goto(`${frontend}/products/${product.id}`);
      await a.getByRole("link", { name: "Chat với cửa hàng" }).click();
      await a
        .getByRole("button", {
          name: `Bắt đầu hội thoại với cửa hàng #${store.id}`,
        })
        .click();
      await a.waitForURL((url) => /^\/messages\/\d+$/.test(url.pathname));
      const conversationId = Number(
        new URL(a.url()).pathname.split("/").at(-1),
      );
      await login(b, seller.email);
      await b.goto(frontend + "/messages");
      await b.locator(`a[href="/messages/${conversationId}"]`).click();
      for (const page of pages) {
        await page
          .getByText("Đang kết nối trực tiếp", { exact: true })
          .waitFor();
        await page
          .getByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.", {
            exact: true,
          })
          .waitFor();
      }
      for (const page of pages)
        assert(
          await page
            .locator(`section[aria-label="Hội thoại ${conversationId}"]`)
            .evaluate(
              (section) =>
                getComputedStyle(section.querySelector("h2")).color ===
                getComputedStyle(section).color,
            ),
          "Heading must inherit readable selected storefront palette",
        );
      const text = `QA ${name} <img src=x onerror=alert(1)>`;
      await a.getByLabel("Nội dung tin nhắn").fill(text);
      await a
        .getByRole("button", { name: "Gửi tin nhắn", exact: true })
        .dblclick();
      await b
        .getByRole("list", { name: "Lịch sử tin nhắn" })
        .getByText(text, { exact: true })
        .waitFor({ timeout: 5000 });
      assert.equal(
        await b.locator('ol[aria-label="Lịch sử tin nhắn"] img').count(),
        0,
      );
      assert.equal(
        await db.chatMessage.count({ where: { conversationId } }),
        1,
      );
      await b.getByLabel("Nội dung tin nhắn").fill(`Reply ${name}`);
      await b
        .getByRole("button", { name: "Gửi tin nhắn", exact: true })
        .click();
      await a
        .getByRole("list", { name: "Lịch sử tin nhắn" })
        .getByText(`Reply ${name}`, { exact: true })
        .waitFor({ timeout: 5000 });
      for (const page of pages) {
        const [response] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().endsWith(`/chat/conversations/${conversationId}/read`) &&
              r.request().method() === "POST",
          ),
          page
            .getByRole("button", {
              name: "Đánh dấu đã đọc các tin đã hiển thị",
            })
            .click(),
        ]);
        assert.equal(response.status(), 201);
      }
      assert.equal(
        (
          await db.chatReadState.findUniqueOrThrow({
            where: {
              conversationId_userId: { conversationId, userId: buyer.id },
            },
          })
        ).lastReadSequence,
        2,
      );
      await a.screenshot({
        path: path.join(values.output, `${name}-buyer.png`),
        fullPage: true,
      });
      await b.screenshot({
        path: path.join(values.output, `${name}-seller.png`),
        fullPage: true,
      });
      if (name === "desktop-light") {
        // AFTER-COMMIT response loss: forwarding the real POST commits before aborting browser response.
        let drop = true;
        const requests = [];
        await a.route(
          `**/chat/conversations/${conversationId}/messages`,
          async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            requests.push(route.request().postDataJSON());
            if (!drop) return route.continue();
            drop = false;
            const response = await route.fetch();
            assert.equal(response.status(), 201);
            await route.abort("failed");
          },
        );
        await a
          .getByLabel("Nội dung tin nhắn")
          .fill("QA response lost AFTER commit");
        await a
          .getByRole("button", { name: "Gửi tin nhắn", exact: true })
          .click();
        await a.getByRole("button", { name: "Gửi lại cùng mã" }).waitFor();
        assert.equal(
          await db.chatMessage.count({ where: { conversationId } }),
          3,
        );
        await a.reload();
        await a.getByRole("button", { name: "Gửi lại cùng mã" }).waitFor();
        assert.equal(requests.length, 1);
        await a.getByRole("button", { name: "Gửi lại cùng mã" }).click();
        await a
          .getByRole("button", { name: "Gửi tin nhắn", exact: true })
          .waitFor();
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[0], requests[1]);
        assert.equal(
          await db.chatMessage.count({ where: { conversationId } }),
          3,
        );
        await a.unrouteAll({ behavior: "wait" });
        await buyerContext.setOffline(true);
        await b.getByLabel("Nội dung tin nhắn").fill("QA while Buyer offline");
        await b
          .getByRole("button", { name: "Gửi tin nhắn", exact: true })
          .click();
        await b
          .getByRole("list", { name: "Lịch sử tin nhắn" })
          .getByText("QA while Buyer offline", { exact: true })
          .waitFor();
        await buyerContext.setOffline(false);
        await a
          .getByRole("button", { name: "Kết nối lại", exact: true })
          .click();
        await a
          .getByRole("list", { name: "Lịch sử tin nhắn" })
          .getByText("QA while Buyer offline", { exact: true })
          .waitFor({ timeout: 7000 });
        // A real service fixture creates history for pagination; not 31 UI sends.
        await a.goto(frontend + "/account");
        await b.goto(frontend + "/account");
        for (let index = 0; index < 31; index++)
          await chat.send(buyer.id, conversationId, {
            clientMessageId: `${marker}-pagination-${index}`,
            type: "TEXT",
            content: `QA history ${index}`,
          });
        await a.goto(`${frontend}/messages/${conversationId}`);
        await a.getByRole("button", { name: "Tin nhắn cũ hơn" }).click();
        const count = await db.chatMessage.count({ where: { conversationId } });
        await a.waitForFunction(
          (expected) =>
            document.querySelectorAll('ol[aria-label="Lịch sử tin nhắn"] li')
              .length === expected,
          count,
        );
        await a.getByRole("button", { name: "Đăng xuất", exact: true }).click();
        await login(a, outsider.email);
        await a.goto(`${frontend}/messages/${conversationId}`);
        await a.getByRole("alert").waitFor();
        assert.equal(await a.getByText(text, { exact: true }).count(), 0);
        assert.equal(
          await a.locator('ol[aria-label="Lịch sử tin nhắn"] li').count(),
          0,
        );
      }
      // Product context is explicitly shared after all baseline TEXT assertions.
      if (name === 'desktop-light') {
        await a.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
        await login(a, buyer.email);
      }
      await a.goto(`${frontend}/messages/${conversationId}?productId=${product.id}`);
      await b.goto(`${frontend}/messages/${conversationId}`);
      const share = a.getByRole('button', { name: `Chia sẻ sản phẩm #${product.id}`, exact: true });
      await share.waitFor();
      await a.waitForFunction(() => ![...document.querySelectorAll('button')].find((v) => v.textContent.startsWith('Chia sẻ sản phẩm'))?.disabled);
      const contextRequests = [];
      if (name === 'desktop-dark') await a.route(`**/chat/conversations/${conversationId}/messages`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        contextRequests.push(route.request().postDataJSON());
        const response = await route.fetch();
        if (contextRequests.length === 1) {
          assert.equal(response.status(), 201);
          return route.abort('failed'); // Response lost only after actual PostgreSQL commit.
        }
        return route.fulfill({ response });
      });
      await share.dblclick();
      if (name === 'desktop-dark') {
        await a.getByRole('button', { name: 'Gửi lại cùng mã', exact: true }).waitFor();
        await a.reload();
        await a.getByRole('button', { name: 'Gửi lại cùng mã', exact: true }).waitFor();
        assert.equal(contextRequests.length, 1);
        await a.getByRole('button', { name: 'Gửi lại cùng mã', exact: true }).click();
        await a.getByRole('button', { name: `Đã chia sẻ sản phẩm #${product.id}`, exact: true }).waitFor();
        assert.deepEqual(contextRequests[0], contextRequests[1]);
        await a.unrouteAll({ behavior: 'wait' });
      }
      const card = b.getByRole('article', { name: `Sản phẩm ${product.id}`, exact: true });
      await card.getByRole('link', { name: 'QA Chat product', exact: true }).waitFor({ timeout: 7000 });
      await card.locator('img').scrollIntoViewIfNeeded();
      await card.locator('img').evaluate((img) => Promise.race([
        img.decode(), new Promise((_, reject) => setTimeout(() => reject(Error('QA image decode timeout')), 8000)),
      ]));
      assert(await card.locator('img').evaluate((img) => img.naturalWidth > 0));
      await b.screenshot({ path: path.join(values.output, `${name}-context-product.png`), fullPage: true });
      assert.equal(await db.chatMessage.count({ where: { conversationId, contextProductId: product.id } }), 1);
      await a.reload();
      await a.getByRole('article', { name: `Sản phẩm ${product.id}`, exact: true }).waitFor();
      await db.product.update({ where: { id: product.id }, data: { sellerStatus: 'HIDDEN', name: 'PRIVATE HIDDEN PRODUCT' } });
      await b.reload();
      await b.getByText('Sản phẩm không còn khả dụng hoặc chưa tải được.', { exact: true }).waitFor();
      assert.equal(await b.getByText('PRIVATE HIDDEN PRODUCT', { exact: true }).count(), 0);
      await b.screenshot({ path: path.join(values.output, `${name}-context-hidden.png`), fullPage: true });
      assert.deepEqual(browserErrors, []);
      results.push({ name, result: "PASS", conversationId });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
  await writeFile(
    path.join(values.output, "report.json"),
    JSON.stringify(
      {
        result: "PASS",
        provenance,
        marker,
        groups: results,
        limitations: [
          "No media/Order card; Product context has real public HTTP hydrate and hidden redaction",
          "Single-instance realtime; REST catch-up supports restart/other instance",
          "Pagination fixture labeled; not 31 Web sends",
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
    }),
  );
} catch (e) {
  await writeFile(
    path.join(values.output, "report.json"),
    JSON.stringify(
      {
        result: "FAIL",
        provenance,
        groups: results,
        error: e instanceof Error ? e.message : "Unknown QA failure",
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser?.close();
  await vite?.close();
  await app?.close();
}
