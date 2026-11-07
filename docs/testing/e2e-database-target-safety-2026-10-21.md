# E2E database target safety incident and fix — 21/10/2026

## Incident, not a passing regression run

After merging Buyer Backend #74 at `fa85f66`, the runner explicitly selected a
fresh dedicated database on loopback 5549. All 16 migrations and Prisma validate
passed on that QA target. The subsequent full E2E run was incorrectly launched
from the primary checkout containing local `.env` files.

`BE/test/setup-env.ts` loaded `BE/.env` with `override: true`, replacing the
injected QA `DATABASE_URL` with the demo database configuration. Some newer
suites rejected the target, but older suites had no global safety gate and
opened fixture connections. The failed run is **167 failed / 134 passed /
369 skipped / 20 TODO**, 21 failed files / 14 passed / 1 skipped, 131.16s.
It is not evidence of Buyer transaction correctness and is not counted as PASS.

No migration was applied to demo during this run. The diagnostic afterwards used
server-enforced `BEGIN READ ONLY`: demo still has seven completed migrations,
latest `20260927143000_search_reconciliation_jobs`, and 20 public tables;
the dedicated QA database has 16 migrations/34 tables.

**Correction after preservation audit: the original zero/zero diagnostic is
withdrawn.** Its JS Date parameter was encoded in local +07 time while the
database columns are UTC-convention `timestamp without time zone`, moving the
cutoff seven hours forward. Reproducing the comparison on an isolated restore
returns zero with the old cutoff, but **132 new Users and 34 updated Products**
with an explicit UTC cutoff. All 132 account markers match the affected Cart,
Checkout and Order fixture suites; they include four Admin fixtures. There are
33 fixture image references without corresponding files. This is actual residual
test data, not proof of a clean demo database.

The current demo database and all 90 upload files were backed up locally with
restricted filesystem permissions, outside Git. An isolated network-none
PostgreSQL restore matched contents of 20 tables, 17 sequence states and schema
semantics; 27 foreign-key checks found no orphans. The demo container was then
stopped without deleting its persistent volume. No speculative cleanup/restore
was applied to demo. A post-incident backup cannot prove the pre-incident state:
there is no full before-snapshot, cleanup may restore timestamps and sequences
may have advanced. No credentials, account rows, backups or SQL logs are included
in this report or committed to Git.

## Fix

- E2E no longer loads root/Backend `.env` at all. Credentials and target must be
  explicitly injected; missing configuration aborts during Vitest `setupFiles`,
  before test collection/bootstrap.
- Local targets require PostgreSQL, literal loopback `127.0.0.1:5549`, dedicated
  `bckl_order_resolution_test_*` database and only optional `schema=public`.
- The disposable GitHub service remains supported only in GitHub Actions mode,
  loopback 5432 with the exact CI database name. This is configuration isolation,
  not protection against an operator intentionally forging trusted CI variables.
- Error messages never echo credentials. Existing worker-disable settings remain.
- No business source/schema/migration/Auth/Search contract change.

## Verification so far

- 14 safety tests PASS, including mocked dotenv attempting to replace the target,
  missing/demo target rejection at setup import, local allowlist, CI separation
  and credential-safe errors.
- Full Backend unit: **765 PASS**, 34 files, 5.71s; the 14 safety cases are included.
- Frozen/offline install, lint, typecheck and Nest build PASS; final typecheck/lint
  rerun after extending the tests to 14 also PASS.
- Full E2E on this safety branch against the dedicated 16-migration QA database:
  **670 PASS / 20 TODO**, 35 files PASS / 1 SKIP, **173.08s**. No test was
  skipped or timeout relaxed to get this result. The failed incident run remains
  recorded separately above; this is not a new passing run on unmodified develop.

Gemini CLI performed source-only review. Suggestions to allow protocol aliases,
implicit ports and extra driver query parameters were not adopted: rejecting
unconfigured targets is intentional. The import-order warning is already
addressed by registration in Vitest `setupFiles`; the helper has no DB imports.
Gemini did not run tests and did not inspect the demo database.

## Usage

CI first run caught an ambient-environment unit-test bug: passing `undefined`
as the helper's second argument implicitly read `GITHUB_ACTIONS=true` from the
runner, while the test intended local mode. The helper is now pure with an
explicit optional CI argument; setup passes the real CI flag. No guard was
relaxed and the failing assertion was retained. Both CI jobs passed at
`3a981ce`; this documentation correction still requires CI on its new head.

Follow-up source-only adversarial review through Gemini CLI found no P1/P2
defect in the four supplied gate/setup/test/config files. Gemini executed no
tests and supplied no GitHub approval. Its scope does not certify future code
that might override configuration after setup. Codex reran all 14 gate unit
tests and verified the real E2E runner rejects a demo-shaped URL at setup with
zero tests collected, using an intentionally nonexistent account, not demo
credentials. These checks do not authorize running tests against demo.

Inject a dedicated QA `DATABASE_URL`, test JWT secrets and other required test
configuration before launching `pnpm --dir BE test:e2e`. Do not set
`GITHUB_ACTIONS=true` locally to bypass the safety gate. Do not run seed/reset or
the full E2E suite against demo. Root/Backend environment files remain untouched.
