# Seller concurrency tests: remove the observer-held business lock

22/10/2026. IN_PROGRESS on `codex/order-race-diagnostics`, base develop `e394c9eb3c13c8f96bfe40f5be97d5efb97d192e`.
Test-only change. No change to Backend production service, transaction isolation, retry count, deadlines,
API/receipt contract, Prisma schema/migration, Frontend or AI. Not a new Order feature.

## Finding and precise limits

The existing race helper acquires the Seller User row with an external transaction, starts two HTTP
commands, and polls database-wide `pg_stat_activity` before releasing the User row. Production lock timeout
is1000ms. A slow poll/process can hold this *test-created* business lock beyond that deadline, legitimately
returning two ORDER_COMMAND_IN_PROGRESS409s. Database-wide waiter counts also do not identify these requests.

The old historical full-run409/409 has no per-request elapsed/SQLSTATE trace. This patch removes a real
test-orchestration hazard; it does **not** assert that the historical incident's exact cause is proven, or
that no other production conflict is possible. Production deadlines and the original expected200/200 and
200/409 assertions are not weakened. Existing timeout/retry semantics remain necessary under real load.

## Change

The helper wraps the actual first Serializable transaction callback of each independent Nest app.
After the real set_config statements, both callbacks must reach their own pre-User-lock query barrier.
Only that query is delayed; every query/write still executes using its real Prisma transaction client.
No actor/Order business row is held by the test observer. Retries execute normally without rejoining the
initial barrier. A4000ms test watchdog releases waiters and fails the test; it does not extend the unchanged
production5000ms transaction or1000ms lock budgets. Missing arrivals cannot silently pass.

This wrapper controls test scheduling, not a runtime lock or mock successful SQL/HTTP response. The real
PostgreSQL lock, Serializable conflict/retry, receipt and unique constraints decide the outcome. Two app
instances are not a multi-OS-process/crash or browser acceptance claim.

## Added regression cases

1. Artificially delay synchronization1200ms **before** either actor lock: same key still gives200/200,
   one original/one replay, one command ID, one receipt and one new history transition.
2. Deliberately retain a real User row lock until both requests end: both return409/Retry-After1, the entire
   Order/Payment/history/command snapshot stays unchanged. Release the real lock and retry the original key:
  200/200 with one original/one replay, one command ID/history transition and no Payment mutation.

The controlled second case proves that two409s can be safe bounded refusal, not two committed outcomes.
It is separate from the original same-key success regression; it does not replace that assertion.
Order fixtures here are synthetic (as in the existing suite), not proof of a new real Checkout/UI flow.

## Validation checkpoint

- Frozen offline install585 packages; lockfile unchanged.
- Seller suite56/56 PASS on isolated DBv911 before the final formatting/isolation assertion; all56 are also
  included in the final full-suite pass on guard-compatible DBv912 below. Do not add the subset to the total.
- Backend unit1034/1034 PASS,47 files,8.12s.
- Backend typecheck/lint/build/Prisma validate PASS; no new production warning or schema.
- Working/full-range diff must pass before push.
- Full Backend E2E final tree:757 PASS/1SKIP/20TODO,43 files PASS/2SKIP (45 total),207.16s, exit0.
  The20TODO and1SKIP are not passing cases. This tree has no new write API from unmerged Attributes94.
- Five affected concurrency cases repeated in three independent runner invocations on v912:3/3 runs PASS,
  each5PASS/51unselected,8.31/8.23/8.06s. These repetitions are not15new cases or added to the full total.
- Frontend/browser/AI/loaded ES–FAISS not run for this test-only delta.

## Failed/incomplete checks retained, not hidden

An initial reviewer probe that spied on root `$queryRaw` affected transaction-client inheritance and was
discarded, not called a production reproduction (one probe timeout, then a missing-waiter assertion).
The final helper intercepts `$transaction` and delegates SQL to the bound transaction client instead.

The first full run on v911 had669 PASS/2 FAIL/87 SKIP/20TODO and8 failed files: seven suites refused its
Order-specific DB name, and the audit CLI suite required the missing prior build. A second attempt after
build still used that incompatible DB name and was stopped as incomplete. Those are local setup mistakes,
not passing evidence or defects in the application. Guards were not relaxed to work around them.

Final full run: new database `bckl_order_resolution_test_attributes_20261019_v912`, restricted QA migrator,
loopback5549,17 existing migrations, prior Nest build, no root/BE.env. The older v911 is preserved; no
database reset/drop or audit/receipt purge is performed. Demo must remain stopped; no demo data is used.

## Review and next step

Review the scheduling wrapper, preserved assertions and real-lock refusal case. A passing local suite
does not self-approve this PR or close the historical409/409 investigation without its missing evidence.
Buyer Web integration still waits for exact-head95/96 reviews; this test-only change does not enable buttons.
