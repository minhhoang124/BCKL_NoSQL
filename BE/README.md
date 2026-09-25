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

## Running tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e
```
