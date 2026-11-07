#!/bin/sh
# Backend container entrypoint.
# RUN_MIGRATIONS=true applies pending Prisma migrations first (needs a DDL-capable
# DATABASE_URL). Leave it unset when the database is migrated separately.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${JWT_ACCESS_SECRET:?JWT_ACCESS_SECRET is required}"
: "${JWT_REFRESH_SECRET:?JWT_REFRESH_SECRET is required}"
: "${BACKEND_PUBLIC_URL:?BACKEND_PUBLIC_URL is required (public API origin, e.g. http://localhost:3001)}"

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Applying Prisma migrations..."
  node ./node_modules/prisma/build/index.js migrate deploy
fi

exec node dist/main
