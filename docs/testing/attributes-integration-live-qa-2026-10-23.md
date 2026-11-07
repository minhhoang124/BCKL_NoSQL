# Attributes integration — local live QA 2026-10-23

## Latest handoff status

### Combined develop and synchronous submit fence —26/10/2026

Codex tiếp nối e282cb0 trên nhánh riêng, ghép develop87ccf76 giữ Accounts,
Dashboard và hậu mãi đã merge. Bổ sung latch dùng chung để chặn hai sự kiện
gửi/chọn/đọc trong cùng tick, giữ khóa unknown qua read reload.141focused
Attributes/Admin tests PASS; đây không phải lượt Chrome/DB mới. Chi tiết
[finding, probe và ranh giới](attributes-submit-fence-2026-10-26.md).

### Consent-context blocker fixed — 2026-10-26

Review of74eb846 found shared reason/confirmed state could authorize option policy using a definition confirmation. Split definition/option reasons and confirmation flags. Each input edit invalidates confirmation for its own command, including changing a policy back. Selecting/new option clears option reason+consent; choosing/new definition and successful writes clear both. Submit handlers independently require the appropriate valid reason/confirmation before sending, rather than only changing checkbox display. Known-error draft retention and unknown-outcome locking remain.

- Six regression tests: five failed on original code; all six pass after fix, covering definition→option, option→definition, changed option target, changed/reverted definition policy, changed option content and correct submitted reason/ID. Broader Attributes/Admin suite137/137PASS across9files; lintPASS with5existing warnings; typecheck/buildPASS with bundle warning. Initial test added unsupported Testing Library exact options; corrected test typing before successful build.
- Real Chrome headless → Backend3014 → dedicated PostgreSQL22migrations: definition6 inactive/rev14, option4 inactive. Confirming definition then enabling option leaves option consent unchecked/reason empty; Save option disabled, zeroPATCH and DB unchanged. Content/target/policy edits reset own consent. Separate option confirmation emits only UPDATE_OPTION with reason `QA independently confirmed option enable`; definition remains inactive. Deliberate option restore leaves definition6rev16/option4inactive, audit retained.
- Evidence `C:/khoaluan/qa-evidence/attributes-2026-10-23/consent-1792993903053/results.json`, screenshot `independent-consent.png`, editor SHA256 `f889a70632f46a6b02cbd0cf1455cdb4f0ec72f97ba87330cae735a51416ffe3`. Runner remains local QA-only. First live attempt received login200 but timed out waiting navigation; retry explicitly waited bootstrap refresh completion before login. No Auth source change or claim that the first attempt passed; bootstrap/login-race behavior is not accepted by these Attributes checks.
- Scope remains the #109 base develop f5490e3; later Accounts/aftersales/Dashboard merges are not included or accepted by this run. No schema/API/Auth changes. Previous source baselines retain their existing evidence limits.

### Pagination completion — 2026-10-24, application a49da9c

Editor now follows nextCursor/afterId for definition and option pages (100/request). Load-more preserves definition/option drafts and existing rows; failed reads keep cursor for deliberate retry. Appends deduplicate IDs, preserving a successful local write also encountered in a later page. First and subsequent option pages must match the selected parent revision. A mismatch retains the draft and blocks saves/more-options until an explicit re-selection; its warning persists across list reload. No automatic revision replacement or write replay.

- 131/131 tests in eight Attributes/AdminDashboard files PASS, including seven new pagination tests: >100 definitions/options, read failure/retry, initial and later option revision mismatch, and duplicate local create. Lint/typecheck/build PASS; five existing Admin warnings and bundle warning retained.
- Real Chrome headless → Backend3014 → PostgreSQL: dedicated Category3 with105definitions/105options. Loaded100+5 for each list, verified cursor212/210,105unique rows, no next-page button at exhaustion, drafts unchanged and zero UI business writes from pagination. Separate Admin B HTTP command advanced parent revision108→109 between option pages; UI rejected mixed revision, preserved draft and disabled both save buttons. Label restored via current-revision HTTP afterward. Product/value/Order/item/payment/history full-table fingerprints unchanged.
- Fixture was populated directly by SQL in the explicitly verified QA DB. It is labeled QA-only and is not create-API acceptance. Earlier failed navigation attempt left a separate Category2 fixture; no fixture reset/delete. Accepted final run reused Category3. Initial driver timed out waiting for navigation after login; later successful runs explicitly checked login200; no runtime error inferred from the diagnostic alone.
- Final pagination evidence folder `C:/khoaluan/qa-evidence/attributes-2026-10-23/pagination-1792835379511`; editor SHA256 `135aadd77ef259c978faf9124ff0097145ff8da1a5d23a522ca3e5e0df4ac27c` matches committed application a49da9c. Tests used that source before commit; content hash binds evidence to the commit. Sanitized summary: `docs/testing/evidence/pr109-pagination-20261024.json`.
- Four UI API smoke rerun after code commit a49da9c: definition218/option216 and four audit commands at revisions1–4 PASS. Viewports360/390 no horizontal overflow. Evidence `C:/khoaluan/qa-evidence/attributes-2026-10-23/fix-four-api-1792835420957`. Runner inherited an old hardcoded head in its output; metadata corrected to the verified actual commit and runner changed to read git HEAD. This metadata correction does not change results/source or substitute earlier QA.

This supersedes full-pagination NOT_RUN below for the stated105-row traversal, read-error unit checks and revision-change scenario. Not a cross-page immutable snapshot or load/performance acceptance. Earlier session/fault/policy results retain their stated source baselines; they are not re-labeled as reruns after this code addition. Search propagation, physical device QA and remaining referenced-option combinations still NOT_RUN.

### Supplemental timeout/referenced-policy QA — 2026-10-24, head f2300e2

Same application code as 33f93cb, now checked on published f2300e2 with real Chrome headless/Vite/Backend3014/PostgreSQL22migrations. Two additional groups PASS:

- Native client 15-second deadline: a loopback-only HTTP reverse proxy3015 forwards exactly one PATCH to Backend3014, receives actual200, buffers its response for22seconds. Playwright routes only that PATCH to this proxy. Without forging an error response, the application's AbortSignal.timeout(15000) fires; UI locks writes and retains `QA 15-second timeout draft` after **15,212ms**. SQL proves exactly one commit (#6 revision12→13), then deliberate HTTP recovery after DB verification restores original name at revision14. This tests actual elapsed client timeout under controlled network delay; does not claim an uncontrolled production outage. Proxy and browser contexts stopped after the test; FE remains direct3014.
- Referenced policy/history: definition1 Chất liệu had2 existing Product references, active revision3. UI slug change rejected ATTRIBUTE_SLUG_IN_USE; slug unchanged. UI disable with reason/confirmation yields v4, then UI restore with separate reason/confirmation yields v5 active. Ordered full-table count+JSON-MD5 fingerprints match before, after disable and after restore for product_attribute_values(8rows), orders(1), order_items(1), payments(1), order_status_history(1). These are equality fingerprints for this isolated fixture, not cryptographic authenticity assertions. No audit/history removed; fixture policy restored.

Sanitized results are committed at `docs/testing/evidence/pr109-timeout-policy-20261024.json`. Original JSON/screenshots are in `C:/khoaluan/qa-evidence/attributes-2026-10-23/timeout-policy-1792834644791`; runner `timeout-policy-qa.mjs` is local QA-only. This supersedes timeout and referenced-definition/history NOT_RUN statements below only for these precise scenarios. Referenced option policy combinations, full pagination, Search worker/index propagation and physical-device QA remain outside this run. No source/schema change; no CI-success or whole Admin acceptance claim.

### Latest live verification 2026-10-24 — application head 33f93cb

Rebuilt Backend from the synchronized #109 source and applied the three merged Chat migrations after the launcher's isolated-target check. QA DB now has 22 completed migrations. FE Vite and Backend 3014 use this same application checkout with real PostgreSQL on loopback 5549. Workers remain disabled; no database reset.

Installed Chrome launched headless with independent Playwright contexts and distinct refresh cookies for Admin A/B. Eight groups PASS on this head:

| Case | New evidence |
| --- | --- |
| Two Admin contexts | Both load #6 v8; A saves v9, B receives conflict, keeps editable draft. Exactly one new audit; original name then restored. |
| StrictMode reload | Actual Vite app reload completes and form becomes enabled. |
| Expired access GET | Real five-second access lifetime elapsed; GET rotates refresh, retains Admin UI. |
| Expired access PATCH | Restores session without replay; draft retained, #6 v10 and audit count unchanged. |
| Connection failure | Playwright abort before delivery; draft retained, writes disabled, DB unchanged. Controlled fault. |
| Success response unavailable | Actual upstream PATCH200 commits once; substituted503 locks writes and Catalog switching. #6 v11/audit29; recovery after DB verification restores original name v12/audit30. Simulated gateway loss, not physical packet loss. |
| Invalid refresh | Exact QA cookie refresh row expired via SQL; access lifetime elapsed. Reload and direct Catalog redirect to login without Admin UI. |
| Logout/reload/direct route | UI logout, reload and direct Catalog all end at login without Attributes UI. |

Evidence folder: `C:/khoaluan/qa-evidence/attributes-2026-10-23/fix-browser-1792833565804` (results.json and conflict/network/response-loss screenshots). Runner `review-fix-browser-qa.mjs` stays outside repo; private credentials never logged. Actual login claims confirmed TTL without logging token. Initial launcher used unsupported expiry variable names; corrected to JWT_ACCESS_TTL_SECONDS/JWT_REFRESH_TTL_SECONDS before accepted run. TTL restored to 900/604800 afterward.

Four API UI smoke PASS on this head with normal TTL: definition #7 inactive SINGLE_SELECT create/rename, option #5 create/rename. SQL audits CREATE_DEFINITION/UPDATE_DEFINITION/CREATE_OPTION/UPDATE_OPTION at revisions1/2/3/4. Desktop and 390x844/360x844 screenshots inspected; no document horizontal overflow. Evidence folder `C:/khoaluan/qa-evidence/attributes-2026-10-23/fix-four-api-1792833800450`. These are viewport simulations, not physical devices. Two earlier smoke attempts timed out on an exact label for the type select; only QA locator changed to combobox before accepted run. Diagnostics retained; no product error inferred.

Remaining NOT_RUN on this head: actual15second timeout, Search propagation, complete pagination, physical mobile and referenced-policy/historical-order equality repetition. Earlier baseline evidence is historical. Eight browser groups and four API smoke are not added to unit counts. CI billing remains separate; no CI-success claim.

### Review fixes 2026-10-24 (supersedes earlier code status)

Fixed both findings from Hoang's review of bc4b313: effect setup restores the mounted guard for StrictMode, and write responses are validated against operation kind and path definition/option IDs. Definition operations require null option; option operations require a SINGLE_SELECT parent and non-null matching option. Invalid confirmation remains 502/unknown outcome, preserving draft and locking writes without replay. No-op PATCH may retain revision.

New regression tests reproduced six failures before fixes (StrictMode reload and five invalid-response acceptance cases). After fixes and synchronization with develop f5490e3 at merge 890cd41, 124/124 targeted tests across seven Attributes/AdminDashboard files PASS. This includes the editor-level wrong-resource response preserving draft and locking writes. Lint passes with five existing Admin warnings. These are fixture/JSdom checks, not live evidence that Backend returns malformed data.

The new develop includes Chat migrations/dependencies. Existing live QA results below belong to their stated earlier baselines. Rebuild/migrate the isolated Backend and rerun browser fault/session regressions before accepting live integration on this latest base. No Ready/merge acceptance from these fixes alone.

Frontend TypeScript/production build PASS after synchronization; bundle warning reports the main chunk above 500 kB. This is a build warning, not a failed build. No backend/schema/contract edits were made for the review fixes.

Implementation saved as `bd3f506`; synchronized with `origin/develop` `0e6bb41` at merge commit `9bffa97`. The sole merge conflict was imports in AdminDashboardPage; both Attributes and Search Health imports were retained. On this synchronized code, 54/54 targeted Attributes/AdminDashboard tests, lint (five existing warnings), and frontend build passed. The detailed browser/PostgreSQL evidence below was collected BEFORE this synchronization against the `a91db91` Backend baseline. Full browser regression with rebuilt Backend on the synchronized base is NOT_RUN. This handoff remains draft and is not ready for merge acceptance.

### Synchronized-base smoke

Backend build PASS. Applied the two additive account migrations from develop to the same isolated QA DB after target verification (19 applied migrations). Restarted the rebuilt Backend on 3014. Login and Catalog/Attributes read PASS, Search Health navigation remains present. Through actual UI, created definition `qa-sync-23-10` (#6), updated name to `QA sync updated`, created option `qa-sync-option` (#4), and updated value to `QA sync option updated`. Final definition revision 4; direct DB audit #19–#22 correspond to the four commands. These four basic API regressions PASS on synchronized base `9bffa97`. Screenshot: `C:/khoaluan/qa-evidence/attributes-2026-10-23/synced-smoke.png`. Full repetition of the earlier fault/two-session/policy matrix on this new base remains NOT_RUN.

Base commit: `a91db91e74fc686863d27dbcebf04bd4fe5f009b` with uncommitted Attributes integration changes. No PR published by this run.

## Environment

### Continuation 2026-10-24 — head bc4b313

- Same implementation as synchronized base 9bffa97; bc4b313 adds handoff documentation. Before interruption, UI on definition #6 rejected a two-character policy reason even with confirmation. Editing the reason reset confirmation. PASS for these UI guards on this head.
- Attempted enable with valid reason returned ATTRIBUTE_SESSION_REFRESHED, preserved the editable draft and explicitly required a deliberate save. PostgreSQL rechecked after environment recovery: definition #6 still `QA sync updated`, revision 4; total attribute audits still 22. PASS for no automatic mutation following that observed refresh. The enable itself has NOT been committed or accepted by this check.
- Docker and QA services were stopped at continuation. Restarted the existing isolated PostgreSQL container without recreating its volume. Frontend 5173 and Backend 3014 were restored; Backend launcher passed its database/migration safety checks. Default PATH selected a Node-RED Node binary and did not reach listen; the existing bundled Node runtime successfully started the same launcher. No application code changed.
- Full two-independent-browser, network/ambiguous-response, GET refresh and invalid-refresh regression on this synchronized head remains NOT_RUN. Previous-base results above are not substituted. Browser-control tooling changed during the session; no fresh browser state or screenshot was captured after recovery. Restarted Backend uses fresh QA JWT secrets, so login is required again.
- Local evidence update only; no new GitHub comment, push, Ready or merge action in this continuation. CI billing remains a separate unresolved prerequisite.

### 2026-10-24 API/PostgreSQL supplemental regression — bc4b313

- Actual HTTP against QA Backend 3014 with separately authenticated Admin A/B and Buyer; direct PostgreSQL checks. This is API evidence, not two independent browser sessions.
- PASS: anonymous definition read 401; Buyer definition read and PATCH 403; no definition or audit change from denied requests.
- PASS: both Admins read the same revision; A's rename succeeds once, B's stale PATCH returns 409. Database retains A's name and increments revision/audit exactly once. Restored original name with a subsequent valid command; immutable audits retained.
- PASS: policy change without confirmation returns 409; confirmed change with short reason returns 400; database and audit count stay unchanged.
- First script execution expected 400 for missing confirmation and stopped on actual 409. Contract source `attribute-write-policy.ts` explicitly requires 409 ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED; corrected the QA assertion and reran successfully. No product fix was needed.
- Fixture #6 started at revision 4 / global audits 22. Two executions each made a rename and restoration, so final revision is 8 / global audits 26, name `QA sync updated`. No stale or denied write generated an audit. Script remains outside repository at `C:/khoaluan/qa-evidence/attributes-2026-10-23/synced-api-regression.mjs`; credentials are read from private local fixture files and never logged.
- Browser stale-draft retention, cookie isolation, network ambiguity and session UI regressions on this head remain pending. Do not promote API-only checks to UI PASS.

- Dedicated Docker PostgreSQL container `bckl-attributes-handoff-qa-postgres-1`, loopback port 5549; retained QA volume.
- Database `bckl_order_resolution_test_attributes_20261019_v1`; launcher verified restricted application role and isolated target.
- 17 migrations applied successfully. Backend build PASS after frozen-lockfile dependency installation.
- Backend `http://127.0.0.1:3014`; frontend `http://localhost:5173` matches configured CORS origin.
- Actual Admin login and Catalog → Attributes UI. Fixture category #1. Credentials remain in ignored private artifacts.

## UI → Backend → PostgreSQL results

| Case | UI result | PostgreSQL evidence | Result |
| --- | --- | --- | --- |
| Create definition | Created `QA UI 23-10`, v1 | Definition #5, slug `qa-ui-23-10`; audit #7 CREATE_DEFINITION revision 1 | PASS |
| Update definition | Renamed to `QA UI 23-10 updated`, v2 | Definition #5 name and revision 2 match; audit #8 UPDATE_DEFINITION revision 2 | PASS |
| Create option | Created `QA WiFi 23-10`; parent Kết nối v3 → v4 | Option #3, slug `qa-wifi-23-10`; audit #9 CREATE_OPTION revision 4 | PASS |
| Update option | Renamed to `QA WiFi 23-10 updated`; parent v5 | Option #3 value matches; definition #4 revision 5; audit #10 UPDATE_OPTION revision 5 | PASS |

Read-only SQL confirmed original definitions #1–#3 remain revision 1 and original options Bluetooth/USB cũ retain their labels. Audit count is 10: six fixture setup records plus four UI writes.

## Limits and remaining QA

- This verifies the four basic write paths against real PostgreSQL, not full Attributes acceptance.
- New definition and option were created inactive. Policy changes, reason/confirmation behavior, enable/disable, and referenced-data impacts were not exercised in this browser run.
- Two independent Admin sessions, stale revision conflict, timeout/network recovery, mobile layout and complete historical snapshot comparison: NOT_RUN in this run.
- Initial use of frontend 127.0.0.1 did not match configured localhost CORS origin; browser QA used localhost thereafter. Reload/session persistence has not been accepted; the API host differs from frontend host.
- No credentials, tokens or database passwords belong in this document or GitHub.

Basic four-API UI/DB prerequisite: PASS. Complete integration regression and remaining QA must be assessed before claiming full acceptance.

## Follow-up: connection failure and two Admins

- Connection failure: stopped only the verified QA Backend process on 3014, then attempted to save definition #5 from the browser. UI retained `QA network draft retained`, displayed unknown-outcome warning and disabled writes/navigation controls. Direct SQL confirmed definition #5 remained revision 2 and audit count remained 10. Backend was restarted. PASS for connection refusal; response-loss-after-commit and timeout remain NOT_RUN.
- Two Admins: Hiền operated Admin B in Chrome incognito independently from Admin A. B initially displayed definition #5 revision 2 (screenshot supplied in chat). A saved `QA Admin A conflict check`; B then attempted `QA Admin B stale attempt` using the retained revision 2. Hiền confirmed the expected revision-conflict message and retained draft. Direct SQL after the attempt confirmed #5 is `QA Admin A conflict check`, revision 3; latest audit #11 UPDATE_DEFINITION revision 3, with no additional audit for B. PASS, combining user-observed browser behavior and direct database verification.
- Logout/reload/direct Admin access and expiration/refresh cases remain pending. These results do not establish complete Admin acceptance.

## Follow-up: authentication expiry

- Logout → reload → direct `/admin/catalog`: Hiền confirmed redirect to login without Admin data. PASS (user-observed).
- QA runtime configured access TTL 5 seconds and refresh TTL 600 seconds. Frontend API hostname changed in runtime configuration to localhost:3014, matching frontend localhost:5173 for cookie behavior. No production configuration changed.
- Attributes GET after access expiry: FAIL. UI displayed `ERROR: Unauthorized`; `attributeReadApi.ts` explicitly sets `retryOnUnauthorized: false`. The editor remained visible. Valid-refresh handling in Attributes is not accepted.
- Shared Catalog reload after access expiry: PASS. Database showed refresh #10 revoked and replacement #11 valid; Admin remained in Catalog. This establishes shared refresh rotation, not Attributes GET recovery.
- Controlled DB expiry of refresh #11 for QA Admin A only: next shared Catalog reload redirected to `/login`, removed Admin UI; direct `/admin/catalog` still redirected to login. PASS for server-side refresh expiry. JWT refresh expiry by elapsed lifetime was not separately tested.
- Remaining blocker before declaring integration ready: Attributes-specific 401/session handling, including safe behavior for writes without automatic write replay. No PR opened.

## Session fix and retest

The preceding failure was reproduced and then fixed locally. GETs now allow the shared single-flight refresh with session identity checks. Writes still disable automatic replay: a definitive 401 restores authentication and returns an explicit message asking the operator to review and save again. Failed refresh uses the shared auth-failure callback to clear the session.

- Targeted read/write/editor tests: 37/37 PASS. Includes single write invocation on 401 and rejection when identity changes during refresh.
- Lint PASS with five existing AdminDashboard set-state-in-effect warnings. TypeScript and production build PASS. Initial sandbox test collection failed with cache EPERM; rerun outside sandbox passed.
- Live GET after five-second access expiry: Attributes list loaded normally. DB showed refresh #12 → #13, then detail read rotated to #14. PASS.
- Live PATCH after access expiry: displayed `ATTRIBUTE_SESSION_REFRESHED`, kept `QA refresh draft 23-10` editable, did not automatically submit again. DB remained definition #5 `QA Admin A conflict check`, revision 3 and audit count 11. Refresh rotated to #15. PASS.
- Controlled server-side expiry of refresh #15: Attributes `Tải lại danh sách` redirected to login and removed Admin data. PASS.
- QA runtime remains configured access TTL 5 seconds/refresh TTL 600 seconds for reproduction; these are local process settings only.
- Complete Attributes policy/mobile/timeout-after-commit acceptance is outside these checks. No push or PR performed.

## Policy and responsive follow-up

- Restored QA process TTL to access 900 seconds / refresh 604800 seconds before this run.
- Definition #5 inactive revision 3 → active revision 4 → inactive revision 5 through UI. Empty reason and short `QA` reason kept Save disabled. Editing the reason cleared confirmation. Valid reason plus explicit checkbox enabled Save. PASS.
- Option #3 inactive → active → inactive through UI; parent definition #4 revision 5 → 6 → 7. Explicit confirmation and reason required. PASS.
- Direct SQL matched final inactive states, definition #5 revision 5, definition #4 revision 7. Audit #12/#13 UPDATE_DEFINITION and #14/#15 UPDATE_OPTION retained the four reasons shown in the UI. PASS.
- Mobile visual inspection at 390×844 and 360×800 exposed cramped native input layout. Added an editor-only CSS module for stacked labels, full-width fields, 44px field height, visible focus and readable disabled styles. Reader/global theme unchanged. Retest showed no horizontal document overflow at either width and no text/select inputs below 44px at 390px. This is browser viewport simulation, not physical-device QA.
- Local screenshots: `C:/khoaluan/qa-evidence/attributes-2026-10-23/mobile-390.png`, `mobile-360.png`, `desktop.png`. These are real QA UI screenshots, not fixture-only previews; inspect before publication.
- Post-CSS targeted tests 37/37 PASS; lint passed with five existing warnings. No push or PR performed.
- Remaining unverified cases include response lost after commit/true timeout, policy effects on referenced products and historical Order snapshots, complete pagination, and physical mobile device behavior. The tested policy transitions used previously unreferenced QA definition/option.

## Post-commit response loss and referenced-data follow-up

- A local loopback-only proxy on 3015 forwarded to real Backend 3014. It consumed exactly one successful HTTP 200 for PATCH definition #5, then substituted a controlled 503 so the client could not see the success. Proxy logged one upstream completion; no credentials logged. This simulates a gateway losing the success response, not an actual packet-loss/timeout event.
- UI retained `QA committed response lost`, displayed unknown-outcome warning and disabled all editor writes and Catalog/category switching. Direct SQL proved definition #5 committed once at revision 6, audit #16 UPDATE_DEFINITION. PASS for post-commit ambiguous outcome. Screenshot `C:/khoaluan/qa-evidence/attributes-2026-10-23/response-loss.png`.
- After DB verification, frontend was restored to direct Backend 3014 and the fault proxy stopped. No proxy code was added to the repository.
- Definition #1 Chất liệu had two existing Product references. UI attempt to change slug was rejected with ATTRIBUTE_SLUG_IN_USE and draft retained. Existing slug stayed `chat-lieu`.
- UI confirmed disable with reason: definition #1 revision 1 → 2 inactive. SQL confirmed two ProductAttributeValue rows remained. Restored active through UI with reason, revision 3.
- Before/after disable fingerprints (MD5 over ordered complete QA table JSON, used only for equality comparison): ProductAttributeValue `6fbfc04f062601ba09dd2c36755b1448`; Orders `683fc1eef3516a29d0931ae7a0ebeefd`; OrderItems `93cdca989e2b90d32c7e858a2f0337a5`; Payments `a13fb43a27ab422f8e3d59a555770b59`; OrderStatusHistory `4720c39d1749eb559465dd9c322a100c`. All matched after disable. PASS for retained values and unchanged historical order data in this fixture.
- This does not accept Search index propagation: QA Search/reconciliation workers remained disabled. Actual transport timeout, physical mobile and full pagination are still NOT_RUN. Prior pending statements are historical; the follow-up results above supersede only their explicitly tested cases. No PR/push performed.
