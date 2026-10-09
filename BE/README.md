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

## Buyer Checkout COD (working branch, not yet merged)

- `POST /checkout/preview`: read-only quote; does not reserve stock.
- `POST /checkouts`: USER JWT + `Idempotency-Key` header, same body as preview. One Order per Store, atomic stock/Cart/Payment/history/receipt/SearchOutbox transaction. First create: 201; exact replay: 200.
- `GET /checkouts/by-key`: receipt lookup with the key in a header, never URL. Keep original key/body after a timeout; 404 does not prove an earlier create did not commit.
- Shipping is **DEMO_ZERO_V1**, 0 VND, not real free shipping. COD starts UNPAID. Order fulfilment/cancellation and Buyer UI are separate work.
- See [contract](../docs/api/cart-order-inventory-api-contract.md), [architecture](../docs/architecture/system-architecture-overview.md#756-bổ-sung-ngày-0810--api-tạo-đơn-cod-nguyên-tử-in_progress) and [verification](../docs/testing/checkout-cod-api-verification.md). Timeouts and per-instance quotas are documented in the root `.env.example`; don't copy real secrets into documentation.

## Running tests

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
