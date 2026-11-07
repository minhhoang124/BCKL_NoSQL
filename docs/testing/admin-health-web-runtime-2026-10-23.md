# Admin health — production browser verification, 23/10/2026

## Current integration verification — after #106

Tested source: `8280086683acafaa3feee363b132ef54d71a4bea`, based on
develop `df5d136c9edcd5ce62186ff531b5b519e6d53baf`. Health core files and
canonical generator are byte-identical to previously reviewed `1c03364`.
Backend/AI/schema are unchanged against develop. The sections below are older
evidence, not a description of this current run.

- Frontend **1258 PASS / 6 live SKIP**, 68 files PASS / 1 SKIP, 168.49s;
  lint/build/typecheck PASS, five existing Admin warnings. Generator check PASS.
- Auth/fault Chrome **10/10 PASS** on the new tree, marker
  `health-web-32bba8b7-7eb`, artifacts
  `artifacts/admin-health-web-qa-20261023/r1792760067095/`. Its503 upstream is
  an explicit failure fixture, not a loaded-AI success mock.
- Separately, **6/6 loaded-AI Chrome groups PASS** in
  `artifacts/admin-health-live-chrome-20261023/r1792765721964/`:
  four desktop/mobile × light/dark OS checks see actual READY and2 FAISS vectors;
  stopping the actual owned AI process yields UNKNOWN/AI_UNREACHABLE after the
  real15s Backend cache expires, with no invented component snapshot;
  disabling the Admin in PostgreSQL yields401 and stops further health polls
  for31s. Business row counts remain unchanged after fixture setup.
- This second run uses Nest/PostgreSQL17, FastAPI, pinned cached CLIP image/text,
  real Elasticsearch8.19.21 and FAISS. Runtime DB role has no superuser/create
  database/create role privileges.19 migrations; only loopback QA5549.
  Model revisions are `327ab6726d33c0e22f920c83f2ff9e4bd38ca37f` and
  `58edf8cada9e398793dca955574a48cbb7f18be2`. Two synthetic Products are not
  retrieval quality/evaluation evidence. The Admin theme intentionally stays
  light even when the OS preference is dark. Mobile screenshot inspected.

The loaded-AI launcher is a local isolated evidence helper, not a portable
production deployment tool. Its full URL/role validation refuses dotenv/demo,
creates a new DB/index, uses in-memory internal tokens and retains evidence.
No private profile, credentials, model weights or index is published in Git.
The tracked auth/fault driver below remains reproducible separately.

Initial loaded runs FAILED and are retained: missing canonical mapping caused
ES_MAPPING_INVALID (a correct health result); the helper then matched HTML
navigation instead of the API, accepted a cached zero-vector snapshot too early,
and asserted only exitCode after signal termination. Fixed only QA setup:
fresh-index canonical ensure_index before writes, exact API URL, wait for2-vector
snapshot, and signalCode-aware termination. No production validator/TTL/policy
was relaxed. Fresh-index provisioning must be explicit; do not auto-repair an
existing shared index through a read-only health endpoint.

No claim of whole Admin G3/Dashboard completion, Search queue drain, publication
quality or zero bugs. Local PASS is not GitHub CI green. Human approvals on
older remote heads are not automatically approval of this integration tree.

## Historical integration verification

PR #97 integration tree: `87331143f7a30954abcd5ef69027af411edb3cd6`, after
develop `4ed07a3` (#95/#96/#98/#99). Health runtime sources are byte-identical
to `1fe13ee`; only architecture conflicts needed resolution during sync.
This report and the reproducible browser driver are additional QA, not new
Backend/AI/schema behavior. Old results in the 22/10 report remain historical.

## New checks

- Full Frontend: **1,161 PASS / 6 live SKIP**, 60 files PASS / 1 SKIP,
  232.05 seconds. Lint PASS with five existing Admin warnings; TypeScript and
  Vite production build PASS (448 modules). Canonical generator `--check` PASS.
- Actual Chrome **155.0.8059.85**, headless: **10/10 scenarios PASS** with
  Nest HTTP, real Auth cookies and PostgreSQL17. Ten screenshots inspected at
  desktop1440x1000 / mobile390x844, light/dark OS. Intentional light Admin
  theme, not an implemented dark theme or physical-phone acceptance.
- Four viewport/theme checks: PostgreSQL READY, Search UNKNOWN when the
  explicit isolated upstream returns503. Manual refresh performs real GET.
- Guest/Buyer redirect, no Admin health HTTP request or rendered health data.
- Admin deactivated/re-roled in QA DB: real401/403, old data removed,
  refresh disabled, **no further HTTP requests after33,147/31,688ms**. The
  production poll period is30s; no shortened test-only timer.
- Real health200 held while logging out and signing in as Buyer: no old
  Admin result rendered in the new session.
- Real Backend200 with an extra field injected at the browser fault boundary:
  rejected before rendering business/health badges.
- Health reads leave counts of Product, Order, SearchOutbox, reconciliation
  jobs, attribute audit, stock movements, commands and resolutions unchanged.
  Auth-session fixtures/refreshes are intentionally outside this assertion.

## Reproduce and evidence boundary

`scripts/test-admin-health-web-browser.mjs` requires an explicit Playwright
module path/output directory and exact isolated QA DB
`bckl_order_resolution_test_health_ui_20261023_v918` at127.0.0.1:5549. It refuses
local dotenv files, validates DB identity, disables workers, binds its API/Vite
only to loopback and closes only its own processes. Fixture actors are synthetic;
credentials are random in memory, never saved in evidence. No reset/drop/purge.
Apply migrations and build BE with an explicit guarded QA environment first.

The source script starts its own loopback **HTTP503 upstream fault fixture**.
This is not live FastAPI or proof that loaded CLIP/Elasticsearch/FAISS is healthy.
No Backend HTTP200 is mocked for normal health cases. Malformed200 is an
explicit browser fault applied only after fetching a real response.

Local ignored evidence: `artifacts/admin-health-web-qa-20261023/run1/` at the
repository root, marker `health-web-e51e58ba-b47`: `results.json`, `report.html`,
ten PNGs. No token/cookie/profile/DB URL is part of the report. Do not publish
other private artifact directories or reuse a developer/demo DB to reproduce.

Snapshot TTL / historical READY / sleep and clock rollback are covered by
canonical regression unit tests, **not a loaded READY browser scenario here**.
No claim of evaluation accuracy, queue completion, revenue dashboard, whole
Admin G3 or zero undiscovered defects. Gemini Argon Medium reviewed the two
health core files statically (NO FINDING); that is not independent browser
execution or a human GitHub approval.

Owner explicitly authorized exact-head merging without waiting for human RV
when verified safe. CI billing exception applies only to checks whose annotation
says the job did not start; local PASS must not be described as CI green.
