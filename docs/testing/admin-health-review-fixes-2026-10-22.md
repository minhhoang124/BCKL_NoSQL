# Search health UI: three review fixes — 22/10/2026

Base PR97 head `5bdc985818565cea5e9eaefe23ca44258d9f3b78`, develop `e394c9e`.
Branch `codex/admin-health-review-fixes`; this is a proposed code fix for Hiền to integrate into PR97,
not an approval of the old head, a merge into develop or a new preparation-only PR.
Author branch is not edited/pushed by this task. Backend/AI/schema/Auth/shared client unchanged.

## Fixed review findings

1. A synchronous blocked latch stops all further automatic/manual network reads after401/403.
   The old effect closure can no longer bypass the authorization block. Session/in-flight checks remain.
2. UI current badges use the canonical effective projection and expire independently of30s polling.
   Raw producer observations/timestamps are retained unchanged and explicitly labeled as historical when
   expired. Server servedAt is the anchor, never the browser's absolute clock. A conservative measured
   request duration plus elapsed monotonic/positive wall-clock time ages the observation; it never extends
   producer TTL. Focus/visibility refresh age after a tab resumes. A high-water mark prevents a clock
   rollback from making an expired observation READY again. New validated responses get a new anchor.
3. The adapter rejects contradictory snapshot/error/nullability/aggregate/effective-capability envelopes,
   invalid timestamps, invalid reason codes, component/dependency invariants and nonfinite metadata.
   A stale cache hit may legitimately keep raw READY components while its effective capabilities are
   UNKNOWN; it is accepted and rendered as expired, not rejected or rewritten into a fake producer sample.

## Canonical code, not a third hand-written health schema

`scripts/sync-search-health-ui-contract.mjs` statically copies the already-merged, pure Backend
`BE/src/health/search-health-contract.ts` into the FE generated module with an explicit header.
No runtime Backend import, network/schema download, database or dotenv. Backend/Pydantic contract is not
changed. `--check` plus a source-byte equivalence unit test detect drift in the checkout; regenerate after
an intentional canonical contract update and review the resulting delta.

The production FE uses that validator/projection with server time. The adapter's response-duration metadata
is only a WeakMap entry in memory, not an extra field on the HTTP envelope or a persisted timestamp.
No internal AI token, query content or sensitive data is stored by this change.

## Tests and precise scope

- Original six independent reviewer probes on5bdc985:6FAIL. The same unchanged six probes on the fix:6PASS,
  2.53s, including canonical Backend-derived stale responses. The temporary copy in the fix checkout was
  then removed; the original review checkout remains unchanged.
- Eight permanent regression tests include those six plus browser-clock rollback and old-account response.
- Nine canonical/drift/negative-envelope tests;17new cases total. Do not add repeated probes to the full total.
- Targeted Health + Admin page:46PASS/5files,3.93s.
- Full FE:969PASS/6liveSKIP,54filesPASS/1SKIP (55total),21.52s on the final runtime text/tree
  (the preceding pass was20.09s). Original full suite was952PASS/6SKIP.
- Generator `--check`:PASS; FE lint:PASS/5 existing Admin warnings; production TypeScript/Vite build:PASS,
  436modules. No new Backend E2E, FastAPI/model/ES/FAISS or actual browser/mobile acceptance in this task.
- Original two DEGRADED/UNAVAILABLE component tests used contradictory fixtures: their effective status
  changed while raw producer observations stayed allREADY. Fixtures now derive both producer and consumer
  capabilities from valid FAISS degraded/failed observations and pass through the real parser before render.
  The rendering assertions remain; they are not weakened to accept wrong status.
- Early build exposed an inappropriate Node fs import in a FE source test; replaced with static Vite raw
  imports, without changing application Node types or shared tsconfig. The earlier incomplete build is not PASS.

## Receiving this patch

Hiền should inspect the single fix commit/patch against exact5bdc985. If the branch has progressed, compare
the new fixes before applying; do not blindly overwrite or stack duplicate changes. Run generator check,
targeted/full FE and lint/build, then request reviewers on the resulting PR97 head. These passing local
tests do not dismiss Request changes or self-approve this branch. Retain billing CI exception boundaries.

After receipt/merge, browser QA should inspect expired versus historical badges, tab resume, authorization
denial and account switching. This task used no database container, demo data or secret configuration.
