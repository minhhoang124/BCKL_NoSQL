# Backend (NestJS + Prisma)

This is the backend for the BCKL Thương Mại Điện Tử project.

## Prerequisites

- Node.js >= 24
- pnpm >= 9
- Docker (for PostgreSQL)

## Setup

When performing a fresh checkout, simply run:

```bash
$ pnpm install
```

Since the project uses Prisma ORM, the `pnpm install` step will automatically trigger the `postinstall` script, which runs `prisma generate`. This ensures that the Prisma Client is generated immediately without any manual intervention.

If you ever modify the `schema.prisma` file, you should manually run:

```bash
$ pnpm --dir BE exec prisma generate
```

## Import Product JSONL

Importer chỉ nhận schema JSONL version 1 trong
`docs/architecture/product-domain-design.md`. Luôn chạy dry-run trước:

```bash
$ pnpm products:import --input C:/data/abo/products.jsonl --images-root C:/data/abo --store-id 1 --dry-run
```

Sau khi xử lý hết lỗi category, brand và ảnh, chạy import thật rồi xuất mapping
cho Search Service:

```bash
$ pnpm products:import --input C:/data/abo/products.jsonl --images-root C:/data/abo --store-id 1 --create-missing-brands --mapping-output C:/data/abo/external-product-mapping.jsonl
```

Lệnh chạy lại không tạo Product hoặc ProductImage trùng và không ghi đè
Product đã được Seller chỉnh sửa. Ảnh nguồn phải dùng đường dẫn tương đối nằm
trong gói, không phải symlink, và có nội dung JPEG, PNG hoặc WebP hợp lệ. File
mapping chỉ được ghi khi toàn bộ input không có lỗi.

## Running the app

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

Swagger UI is available at `http://localhost:3001/docs` with the default local configuration.

## Authentication and roles

- `POST /auth/register`: create a `USER` or `SELLER` account. `ADMIN` cannot be created publicly.
- `POST /auth/login`: return an access token and set a refresh token as an HttpOnly cookie.
- `POST /auth/refresh`: rotate the refresh token and return a new access token.
- `POST /auth/logout`: revoke the current refresh token and clear its cookie.
- `GET /auth/me`: return the signed-in user; requires `Authorization: Bearer <accessToken>`.
- `GET /seller/test`: example endpoint restricted to `SELLER`.
- `GET /admin/test`: example endpoint restricted to `ADMIN`.

The access token is short-lived. The refresh token is stored only in an HttpOnly cookie, while its SHA-256 hash is stored in PostgreSQL so it can be rotated and revoked.

Copy the root `.env.example` to `.env`, replace both JWT secrets with long random values and keep `.env` out of Git. TTL values are expressed in seconds.

After changing `prisma/schema.prisma`, create a new migration instead of editing a shared migration:

```bash
$ pnpm --dir BE exec prisma migrate dev --name <migration_name>
```

## Order list (merged in PR #37)

- `GET /orders`: active USER, own orders only.
- `GET /seller/orders`: active SELLER, own Store orders only, including history for suspended Stores.
- Filters: exact `status`, `limit` (default 20, max 50), `afterId` (positive PostgreSQL Int), descending ID cursor. No body or extra query fields.
- Summary only; no shipping PII, detail/timeline or Order command in this step. Payment can be null for legacy data; never invented during GET. Hiền approved this projection/legacy behavior at PR #37 head e6f4427; integration changes need re-review.
- Read-only PostgreSQL snapshot, no stock/outbox writes. Per-instance `ORDER_LIST_RATE_PER_MINUTE=60`, 429 Retry-After. See [architecture and next steps](../docs/architecture/order-read-backend-readiness.md) and [verification](../docs/testing/order-list-api-verification.md).

## Order detail (working branch, not yet merged)

- `GET /orders/:orderId` for the active USER Buyer; `GET /seller/orders/:orderId` for the active SELLER owning the Order's Store. Foreign and absent Orders both return 404 ORDER_NOT_FOUND.
- Positive PostgreSQL Int path only; no query/body. Exact Decimal strings, purchased item/address snapshots, current Payment and chronologically ordered history. No raw Checkout/OrderCommand receipts, keys/hashes or Buyer profile. Buyer cannot see Seller/Admin actor IDs.
- Missing legacy Payment = null; unknown audit fields = null; malformed options fail with safe 500, never replaced from current catalog. These detail choices need their own reviewer approval.
- List/detail share the same per-actor read quota (`ORDER_LIST_RATE_PER_MINUTE`), READ ONLY RepeatableRead and no-store protection. No migration or command API in this step.
- [Detailed contract and field glossary](../docs/api/order-detail-read-contract.md); [verification](../docs/testing/order-detail-api-verification.md). Seller confirm/packing/cancel/delivery are still separate work.

## Buyer Checkout COD (merged in PR #36)

- `POST /checkout/preview`: read-only quote; does not reserve stock.
- `POST /checkouts`: USER JWT + `Idempotency-Key` header, same body as preview. One Order per Store, atomic stock/Cart/Payment/history/receipt/SearchOutbox transaction. First create: 201; exact replay: 200.
- `GET /checkouts/by-key`: receipt lookup with the key in a header, never URL. Keep original key/body after a timeout; 404 does not prove an earlier create did not commit.
- Shipping is **DEMO_ZERO_V1**, 0 VND, not real free shipping. COD starts UNPAID. Order fulfilment/cancellation and Buyer UI are separate work.
- See [contract](../docs/api/cart-order-inventory-api-contract.md), [architecture](../docs/architecture/system-architecture-overview.md) and [verification](../docs/testing/checkout-cod-api-verification.md). Timeouts and per-instance quotas are documented in the root `.env.example`; don't copy real secrets into documentation.

## Seller preparation commands (C2 merged through #43)

- Active SELLER, own existing Order only: `POST /seller/orders/:orderId/confirm`,
  `/start-packing`, `/ready-to-ship`, each with JSON `{}` and `Idempotency-Key`.
- Transitions: PENDING_CONFIRMATION → CONFIRMED → PACKING → READY_TO_SHIP.
  These routes never mark delivered/completed or cancel/refund.
- Hoàng confirmed active Sellers may process existing Orders in ACTIVE or
  SUSPENDED Stores; new selling/checkout permissions are not broadened.
- HTTP 200 after atomic Order/history/OrderCommand commit; exact retry returns
  original receipt. No Payment/stock/snapshot/Product version/outbox write.
- Safe body parser (8 KiB after decompression), per-actor ingress quota,
  bounded DB waiting/retry; see [C2 contract](../docs/api/seller-order-command-contract.md)
  and [verification](../docs/testing/seller-order-command-api-verification.md).
- Detail #42 and cancellation #44 are merged. This branch adds delivery;
  combined regression is required, not just separate branch results.

## Running tests

### Admin delivery simulation (C4.1 working branch)

ADMIN JWT + Idempotency-Key; four POST commands: /admin/orders/:orderId/ship,
delivery-failed, retry-delivery and mark-delivered. Strict JSON, 8 KiB inflated
body, 20 requests/Admin/minute/instance. Replay uses the original durable receipt.
3 retries = 4 total attempts. Failed does not restore stock; delivered sets COD
PAID atomically, never COMPLETED. Not a real carrier or payment settlement.
See [contract](../docs/api/order-delivery-command-contract.md) and
[verification](../docs/testing/order-delivery-command-verification.md).
Legacy SHIPPING/FAILED without canonical attempt identity is rejected, not guessed.
No new migration; #45 foundation is already merged.

### C3 cancellation (merged through #44)

`POST /orders/:orderId/cancel` (USER) and
`POST /seller/orders/:orderId/cancel` (SELLER) accept JSON reasonCode/reasonText
plus Idempotency-Key. Buyer: pending; Seller: pending/confirmed. Only unpaid COD
is supported here. Ledger-backed restoration, cancellation audit, Payment,
one Product version/outbox and immutable command receipt commit atomically.
Same-key replay does not repeat stock changes. See
[C3 contract](../docs/api/order-cancellation-contract.md) and
[verification](../docs/testing/order-cancellation-api-verification.md).
Timeouts/quota use ORDER_CANCEL_* in `.env.example`. Do not run E2E against demo.

From the repository root, check all Backend TypeScript (including tests and
`prisma.config.ts`) with:

```bash
pnpm --dir BE typecheck
```

This generates Prisma Client and runs `tsc --noEmit -p tsconfig.json` without
changing the database. `nest build` only compiles application source, and Vitest
transpiles tests without a full type check; neither replaces this command. CI
runs it separately before unit tests/build. Keep strict checking enabled.

HTTP E2E tests use `test/http-test-types.ts`, which derives the server type from
Supertest's public callable API rather than importing an internal package path.
The native JavaScript seed helper has `prisma/seed-demo-user.d.mts` as its type
declaration; update it together with the helper if its inputs/result change.

The commands below are run from `BE/`. E2E requires PostgreSQL: use a dedicated
test database with current migrations, not the demo database. Check that local
`BE/.env` does not override the test `DATABASE_URL` (see `test/setup-env.ts`).

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e
```

## Order completion D07 (IN_PROGRESS)

Buyer command: `POST /orders/:orderId/complete`, body `{}`, Idempotency-Key, own delivered/paid Order only. Scheduler `order-auto-complete-d07` runs every 15 seconds and discovers due Orders from PostgreSQL. Default delay is 3 days (`ORDER_AUTO_COMPLETE_DELAY_SECONDS=259200`); enable with `ORDER_AUTO_COMPLETE_ENABLED=true`. Apply the new completion-job migration before running. Never shorten the delay on real transactions merely to demo.

Jobs/lease/retries persist in PostgreSQL; max 6 attempts with backoff, then FAILED for operator investigation (no requeue endpoint yet). Buyer/worker share atomic completion and immutable receipts. See [contract and limits](../docs/api/order-completion-runtime-contract.md). Backend tests disable global cron; the runtime suite enables an isolated app and verifies a real wall-clock tick on a dedicated test database. This is not acceptance evidence for UI, Review, Dashboard, Notification or real payment settlement.
