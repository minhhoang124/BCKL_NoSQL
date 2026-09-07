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

## Running the app

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Running tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e
```
