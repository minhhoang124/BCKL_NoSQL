# Bảng công việc và ownership — checkpoint30/10/2026

Coordinator Codex; owner yêu cầu thực thi kế hoạch, model caps Argon/ClaudeMedium, FlashHigh. CURRENT.md là nguồn bắt đầu; lịch sử từng lượt giữ trong handoff/artifact. Không push/merge/Actions do D06.

| ID | Trạng thái hiện tại | Người thực hiện/review và điều kiện |
|---|---|---|
| MEM-01 | DONE_LOCAL | Codex → ArgonMedium/ClaudeMedium; bộ context/entry đã có, snapshotMEM01 lịch sử còn giữ |
| TODAY-PLAN | DONE_LOCAL_PLANNING | Codex + ArgonMedium → ClaudeMedium; hạn08/11, không tự coi toàn sản phẩmDONE |
| SELLER-01 / RECOVERY-BE / SELLER-02 | DONE_LOCAL_c18 | UI + durable close resolver, migration40; fullregression, nativeChrome12groups/HTTP18groups/16OrdersledgerPASS; Argon/ClaudeMedium source review |
| SKU-01 | DONE_LOCAL_SKU_QA | ArgonMedium draftoffline → Codex tích hợp/sửa + localtestworkers → ClaudeMedium; D13 immediateprice/stock. FE53focusedPASS,35DMLHTTPPGPASS,3Chrome/3ledgerPASS. FullFE1856PASS6SKIP/fullBE1872PASS; toànE2EsauSKU1247PASS1SKIP20TODO; Demorollout/read-onlySellerGETPASS,0writes |
| INTEGRATE-01 | BLOCKED_QUOTA | PR138 chưa merge, source mới local; không nhận CI cũ cho commit chưa chạy |
| QA-MATRIX-01 | TRACEABILITY_LOCAL | Worker lập matrix → Codex bổ sung artifact thực thi; không tự đóng gate bằng tài liệu |
| PROVIDER-01 | DONE_LIVE_LINK_LOGIN_LOCAL_QA | Owner thao tác Google; Codex đối chiếuIdentity/User/CV/revocation. Chưa ca collision hai tài khoản thật hoặcHTTPSstaging |
| PROVIDER-03 | DONE_LIVE_VERIFY_RESET_LOCAL_QA | Resend tới một recipient đã được chỉ định, owner mởPC; DBtoken/sessionproof. QAđãdừng; businessnotificationemail còn riêng |
| PROVIDER-02 | PARTIAL_HISTORICAL | VNPay SIT6/6 vàNCB→IPN→PAID đã có; QC thủ công/callback staging còn mở, không tựTOS giao dịch mới |
| OPERATE-01 | LOCAL_RESTORE_PASS / STAGING_OPEN |39→40 giữ67business-tablefingerprints/2Orders; consistentdump restore+90ảnh. Chưaoffsite/cloud/rollback executable; Azurechưaresource/costapproved |
| SEARCH-01 / SEARCH-02 | DONE_LOCAL_SKU_SEARCH_QA | Audit chỉ đọc + chuẩn hóa URL ảnh `/uploads/...` khi tạo event mới (`search-image-url-policy.ts`, 68 unit PASS; full BE 1940 PASS) + ClaudeMedium review (0 P1) + live PG/CLIP/ES/FAISS QA 8/8 PASS (`sku-search-live-1793358243549`). Không tự drain/sửa payload lịch sử Demo |
| NOTIFY-01 | DONE_LOCAL_CHROME_QA | Kiểm thử thông báo đúng người nhận & cách ly quyền Buyer/Seller/Admin trên DB QA riêng + Chrome thật: 6/6 HTTP/PG probes & 7/7 Chrome groups PASS (`notify-browser-1793358544142`), giữ nguyên fingerprint 11 bảng nghiệp vụ |
| UI-01 | DONE_LOCAL_UI_MODERNIZATION | Hoàn tất 28 file UI 4 phase Nordic Festive Warmth (Shopee + Shein); full test FE 1.856 PASS, production build PASS; Footer gỡ BCT theo D14 |
| RELEASE-01 | CANDIDATE_COMMITTED | Commit 1 (BE/Search/WebP `ee2ec30`) + Commit 2 (FE UI `7b73dd5`); CANDIDATE_BASELINE.json cập nhật; chuẩn bị đẩy Git theo D15 |

## Ownership hiện tại

- Codex: implementation SKU BE/FE, module/controller, publicbrowserdrivers và helperQA riêng; contextCURRENT/DECISIONS/WORKBOARD, báo cáo. Không sửa các checkout khác hoặc resetDemo.
- Worker seller_client_tests đã bàn giao hai testFE SKU, không còn writer đang chạy.
- Worker seller_browser_harness đã bàn giao một e2eSKU35cases, không còn writer đang chạy. Worker seller_page_tests lượt cũ bị usage limit; root đã kiểm phần bàn giao trước đó.
- External Argon/Claude dùng snapshot lọc, staticonly, không credentials/DB/Git. Headless directwriteArgon bịdeny0files; không dùng dangerously-skip. Root tích hợp draftoffline, giữ bằng chứng không che lỗi.
- Baseline8SellerfilesMEM01 là lịch sử trướcc18, không dùng làm khóa WIP mới. Các thay đổiSeller có chủ đích đã commit; candidateSKU dùng SHA256 ở provenanceQA và baseline checkpoint mới, không tự restore snapshot cũ.

SEARCH-02 & NOTIFY-01 (đã hoàn tất local QA 30/10): Codex khởi tạo code/harness, Gemini tiếp nhận khi Codex chạm limit, sửa lỗi nhỏ và chạy PASS toàn bộ unit test (1940 BE PASS), review tĩnh ClaudeMedium (`search-review-1793358367805`), live SKU→Outbox→CLIP→ES/FAISS (`sku-search-live-1793358243549`) và Chrome Notifications (`notify-browser-1793358544142`). Xem `docs/agent-context/handoffs/2026-10-30-SEARCH-02-NOTIFY-01-gemini.md`.

AuditCodex mới: SearchQA8PASS accepted6/6source, nhưng REVIEW_P2_OPEN/DEMO_PENDING; NotifyQA6+7accepted đúngscope cũ, UI_CHANGED_AFTER_QA (Header+CSS). Baseline55/56(SellerDashboardlệch); BEunitrecheck1940PASS, FEtsc+35notifunitPASS. Xem antigravity-handoff-audit report; không đánh DONEtoànUI/project hoặc bậtDemo từsummarychat.

BE-CLOSE ownerrequested30/10: Codexintegration/searchoutbox/startup/operatorcontext, QA DB riêng+provider/checks+GitauthorizedD15. Workerclient chỉimageURLpolicy/spec77PASSfrozen; workerbrowser chỉreconservice+16unit+7e2e bàn giao chưa chạy; workerpage gateauditdoc+auth-write-epoch.e2e barrierpending. Không sửaFEWIP. Baseline khácFE làUIhandoff+FooterownerD14 đã xác định, không reset/restore. SourceBEnewchangescóownership rõ, baselinecũgiữhistoryđếncheckpoint.

## Checkpoint31/10 mới nhất — ưu tiên hơn trạng thái lịch sử phía trên

- FE-COPY: DONE_LOCAL, ownerD16;1856PASS/6SKIP+build; chưacommit/push.
- THREE-ROLE-ACCEPTANCE: BUSINESS_PASS / UX_P2_OPEN. Codex+QAhelpers, ArgonMedium staticreview;54ảnh đã gom+verify. Source/hạn chế/bằng chứng trong `docs/testing/three-role-acceptance-2026-10-31.md`.
- NEXT: sửaUX01returnqueryStoreChat,UX02PDPloginreturn,UX03Adminbell; testsafeinternalredirect+regression+Chrome3ca vàluồngcùngOrder. Chưa có writer được giao sửaapp cho3lỗi này; chỉharnessmới ởscripts trong lượt audit.
- Demo đang chạyFE5173/API3001/AI8000; QA mới từnglane,40migrations/DML, khônggửimail/provider. Azure/HTTPS/offsite và integration/CI vẫn cần khép riêng; không merge từ checklist.

## UX close / clean install — 31/10, owner yêu cầu Argon thực hiện

- Argon Medium: hoàn thiện draft Codex cho UX01–03; chỉ LoginPage, ProductPurchase, AdminDashboardPage và utils/loginReturnPath cùng test tương ứng. Không sửa copy WIP ngoài phạm vi, Git, lockfile, backend hoặc bộ nhớ chung. Kết quả chưa nghiệm thu cho tới khi có diff và tests thực tế.
- Codex: review độc lập, browser driver và QA DB mới, lockfile/cài sạch ở snapshot riêng. Owner chọn soạn tin để tự gửi Đạt; không gửi thông điệp trực tiếp hoặc comment PR.
- Không sửa app trong lúc driver chốt source hash đang chạy. Giữ báo cáo FAIL_UX ban đầu và bổ sung bằng chứng sau sửa riêng.

Kết quả mới: UX01–03 DONE_LOCAL_QA, Argon offline helper/tests → Codex review+fullFE1865PASS/6SKIP+build+Chrome12business/3UXPASS,24ảnh/source-stable. Lockfile DONE_CLEAN_INSTALL: frozeninstall/Prismagenerate/FEbuildPASS ởsnapshotkhôngnode_modules;03afb53 đãpush. Owner tựgửiĐạt, chưa có tin nhắn kênhngoài. Handoff `handoffs/2026-10-31-argon-ux-fixes.md`. Không thay trạng thái staging/CI/PR139 bằng localPASS.

PR-CLOSE31/10: ownerD17 cho phép merge138/139; cả hai MERGED vào develop63ebcd6/3be37d8. Candidate đã tích hợp139 và develop, source094d455; fullFE/build/WebSearch50/AI47PASS. CI sau merge cả2run6FAIL/0steps, không coi là codeFAIL hoặc CIgreen. Candidate gồm các phần khác chưa vào develop; tiếp tục thử nhóm trên nhánhfeat/hoang/sku-management-final. Không tự tạo/merge thêmPR toàncandidate từ quyền merge haiPR này.

## Đợt UX do owner nghiệm thu trực tiếp — bắt đầu triển khai

Owner yêu cầu prompt triển khai ngay sau ADM01–03/BUY01–10/SELL01. Codex chỉ leader/review; Claude giữ BE và handoff `2026-10-31-BE-UX-contract.md`; Antigravity giữ FE và handoff `2026-10-31-FE-UX-handoff.md`. Brief có hiệu lực: `handoffs/2026-10-31-UX-execution-brief.md`; đọc cùng phản hồi rootmáy. Không chạy hai writer cùng file, không commit/push/merge bởi worker. Claude công bố contract sớm; FE làm phần độc lập trước và nối API READY. Phạm vi mua hàng mới nhất là Mua ngay→giỏ→checkout, thay đề xuất direct checkout cũ. Code chưa sửa trong lượt leader giao prompt này; workingtree HEAD60f2091 sạch trước khi ghi brief/board.

## Bàn giao đồng leader — D18, 31/10

Claude tiếp nhận coordinator hoạt động sau bàn giao này; Codex chuyển sang review/báo cáo, không có writer source đang chạy từ Codex. Antigravity tiếp tục FE, không sửa BE. Claude được cập nhật context theo vai trò coordinator, nhưng không ghi đè handoff FE hoặc baseline để che thay đổi chưa kiểm. Chi tiết resume trong `handoffs/2026-10-31-COLEAD-TRANSFER.md`.

BE-UX-01: 2037unit/build/typecheck PASS theo Claude. Codex kiểm trực tiếp artifact QA1:241PASS/13FAIL; QA2:68PASS/0FAIL/source hash khớp hiện tại. Lỗi list500 do option snapshot hỏng đã sửa; `itemPreview[].options` nullable, FE cần fallback. 11ca fixture-DDL còn OPEN do app DML không CREATE, không bỏ/skip và không cấp CREATE cho runtime. Next: tách kết nối setupDDL trên QA dùng một lần có guard, runtime vẫn DML; kiểm lại các suite bị ảnh hưởng trên source cuối. Không gọi toànBE DONE hoặc cộng các lượt thay thế.

## Claude coordinator — 31/10 (sau D18)

- Đã đọc handoff/CURRENT/DECISIONS/WORKBOARD/PROTOCOL và kiểm working tree (branch `feat/hoang/sku-management-final`, HEAD `60f2091`, 34 mục WIP, giữ nguyên WIP FE của Antigravity). Git đọc bằng GIT_DIR trỏ worktree vì sandbox Linux không mở `.git` Windows trực tiếp.
- QA-DDL (11 ca): `SOURCE_CHANGED_NOT_RUN`. Helper `BE/test/helpers/qa-fault-ddl.ts` + 4 suite + launcher (chi tiết ở `handoffs/2026-10-31-BE-UX-contract.md` Checkpoint 2). Chưa có PASS PG; cần chạy trên máy owner. 11 ca vẫn OPEN đến khi có artifact.
- FE: chưa có `2026-10-31-FE-UX-handoff.md` ⇒ chưa nhận checkpoint. Chặn tích hợp: `orderResponse.ts` exact-key sẽ từ chối payload BE mới. Yêu cầu ở `handoffs/2026-10-31-COORD-FE-requests.md`.
- Chưa commit/push/stage; không mở rộng quyền provider/cloud; không gọi BE/FE hoàn chỉnh.

## Coordinator duy nhất — Claude phiên Windows, owner chỉ định 31/10 ~17:05 (thay mục “Claude coordinator — sau D18” ở trên)

- Có hai phiên Claude cùng ghi context. Owner chỉ định phiên Windows (có shell + PG QA) là coordinator duy nhất. Phiên sandbox Linux chuyển sang chỉ đọc/review, không ghi context/handoff chung. Ghi nhận của phiên Linux được giữ phía trên làm lịch sử.
- Helper `qa-fault-ddl` (do phiên Linux viết) được coordinator review và tiếp nhận. Trạng thái `SOURCE_CHANGED_NOT_RUN` của QA-DDL **đã bị thay thế**:
  - Lượt 3 `machine-local/final-day-20261030/be-ux01-qa-1793440773058/`: cart 31, cancellation 54, delivery 24, seller-order-command 56, returned 21 → **186 PASS / 0 FAIL / 0 SKIP**, runtime `bckl_local_app`, DDL fixture qua migrator của chính DB dùng một lần, `stable=true`, hash khớp source hiện tại.
  - Helper spec chạy bằng vitest thật: 16/16. **11 ca fixture-DDL: CLOSED**.
- BE-UX-01: **API_ACCEPTED (local HTTP/PG QA)** theo từng API. Ma trận cuối 8 suite trên source cuối là 254 PASS / 0 FAIL / 0 SKIP (lượt 2: list 33, detail 28, buyer-access 7; lượt 3: 186). Unit 94 file / 2053 PASS, tsc exit 0. Chưa staging/Chrome. Chi tiết: `handoffs/2026-10-31-BE-UX-contract.md`.
- FE: chưa có `2026-10-31-FE-UX-handoff.md` ⇒ chưa nhận checkpoint. Blocker đã xác nhận: `FE/src/services/orderResponse.ts` dùng `exact()` (file đang được Antigravity sửa). `FE/src/types/order.ts` khai báo `options: string[]`, phải là `string[] | null`. Yêu cầu FE ở `handoffs/2026-10-31-COORD-FE-requests.md`.
- Ownership: Claude ghi BE + context; Antigravity ghi FE; Codex/phiên Linux chỉ review. Chưa commit/push/stage.
- Next BE (chưa bắt đầu): Admin lookup mã đơn ORD → địa giới → đổi mật khẩu email (thiết kế review trước) → notification operational → proposal đơn VNPay giao thất bại.
- BE-UX-02 Admin lookup mã ORD: **API_ACCEPTED (local HTTP/PG QA)**. `be-ux01-qa-1793441482233` admin-fulfilment-read 6/6, unit 95 file / 2084 PASS. Launcher thêm 1 suite vào allowlist. Contract: BE-UX-contract Checkpoint 3. FE chưa nối.
- BE-UX-03 địa giới/địa chỉ có mã/SĐT VN: **khung API_ACCEPTED (local HTTP/PG, catalogue FIXTURE)**, `be-ux01-qa-1793442688886` 68/68 (address 22, location 4, checkout 42); unit 96 file / 2139 PASS; migration mới `20261031120000_admin_division_catalog`. **Chưa có dữ liệu chính thức QĐ 19/2025** → OPEN: owner cung cấp file Phụ lục; Demo cần migrate + GRANT SELECT. FE phải đổi validation SĐT.
- BE-UX-04 đổi mật khẩu qua email: **IMPLEMENTED_DISABLED** (mặc định DIRECT). E2E (bật EMAIL trong test, delivery stub) `be-ux01-qa-1793443974417` 19/19 (mới 6 + recovery 13); lượt 1 có 1 FAIL do fixture sai, giữ lại làm lịch sử. Unit 97 file / 2148 PASS. **Cần review thiết kế (Checkpoint 5) trước khi bật**; `account-settings` e2e chưa chạy lại (DDL lane).
- FE-ORANGE (Claude là writer FE; owner xác nhận Antigravity đã dừng): **G1 DONE_LOCAL**. Token cam–trắng tập trung, Header/Auth/Admin sidebar/banner sáng, gỡ nội dung ưu đãi/cam kết/đối tác giao vận bịa và sao 4.9 giả. FE 1877 PASS / 6 SKIP, build PASS; Chrome trang công khai desktop+mobile 0 tràn ngang. G2–G5 chưa làm. Handoff `handoffs/2026-11-01-FE-orange.md`.
- FE-ORANGE **G2 DONE_LOCAL_CHROME_QA**: màn 01 bộ lọc trái (giá chỉ khi có từ khóa, không sort vì chưa có API), tóm tắt giỏ chỉ dòng đã chọn, nhãn thanh toán tiếng Việt. FE 1885 PASS / 6 SKIP, build PASS. Chrome Buyer QA DB mới `fe-orange-buyer-1793447985546` 28/28 (dblclick Mua ngay/Đặt hàng, địa chỉ inline, ledger kho/tiền). Driver three-role cũ cần cập nhật cho wizard Seller (G4).
- FE-ORANGE **G3 DONE_LOCAL_CHROME_QA**: widget chat mini (dùng lại ChatThread, ẩn trên /messages → 1 socket, key theo account/session, không tự đọc), trang cửa hàng theo màn 27, copy thông báo. FE 1892 PASS / 6 SKIP, build PASS; Chrome QA DB mới `fe-orange-buyer-1793449560600` 43/43 (gửi tin thật, widget hiển thị cùng hội thoại). Thông báo có dữ liệu thật kiểm ở G4.
- FE-ORANGE **G4 PARTIAL (dừng do hết usage)**: wizard copy sửa (bỏ “tính phí vận chuyển”, nút “Gửi duyệt”, aria riêng cho nút gửi ở danh sách); driver three-role cập nhật cho wizard/PDP mới → `three-role-` lượt cuối 12/12 + 3/3 UX, sourceStable. BE thông báo dùng mã đơn ORD/tên cửa hàng/tên SP thay ID nội bộ (`notification-sources.ts`), BE unit 2148 PASS, e2e notification-runtime 22/22. Buyer driver `fe-orange-buyer-1793450406120` 49/49 (Seller UI xác nhận đơn → thông báo đúng người, người ngoài không thấy). CHƯA LÀM: bố cục danh sách Seller (cột giãn, nút xanh, enum DRAFT/“v14”), màn 09/10/13 theo ảnh, handoff G4, G5.
- FE-ORANGE **G4 DONE_LOCAL_CHROME_QA** (thay mục G4 PARTIAL ở trên): danh sách/wizard Seller, mở cửa hàng, xử lý đơn tiếng Việt; BE thông báo dùng mã ORD/tên. FE 1892 PASS, BE 2148 PASS, e2e notification 22/22; Chrome three-role `1793453807414` 12/12+3/3, onboarding `1793453780317` PASS, buyer `1793453841664` 49/49. Còn: G5 Admin, màn 28.
- FE-ORANGE sau G4: wizard rộng + nút phụ bước 3, tab trạng thái đơn là button truy cập được, màn 28 ghi rõ mã nội bộ, G5 sidebar/fulfilment tiếng Việt. FE 1892 PASS, build PASS. **Chrome G5 chờ**: Docker PG/ES đã dừng (owner tắt, sẽ bật lại); driver G5 đã sẵn.
- FE-ORANGE **G5 DONE_LOCAL_CHROME_QA (phần chính)**: Admin tài khoản/danh mục/giao hàng tiếng Việt, nút chính cam, 404 theo màn 18, thông báo lỗi chung tiếng Việt kèm mã. FE 1896 PASS, build PASS; Chrome three-role `1793455295981` 12/12+3/3, buyer+admin `1793455245224` 70/71 (1 lỗi 503 do driver không bật cờ onboarding — môi trường, lane onboarding PASS). Còn: trạng thái chung màn 18, so chi tiết màn 31.
- FE-ORANGE **"Còn lại" DONE_LOCAL_CHROME_QA**: StateCard (màn 18), hậu mãi theo màn 31, mã ORD trên dashboard data-quality (BE+FE, e2e 18/18), wizard bước 3 hai cột. FE 1899 PASS, BE 2148 PASS; Chrome three-role/aftersales/onboarding PASS, buyer+admin 71/71. Chưa commit.
- **CẢNH BÁO DEMO (31/10, owner chọn giữ nguyên):** Demo API 3001 (`machine-local/start-service.ps1 -Service Backend`) nạp `BE/dist`. `BE/dist` hiện là BE mới, cần 2 migration Demo DB chưa có: `20261031120000_admin_division_catalog` (thêm cột `user_addresses`) và `20261031130000_auth_password_change_email` (thêm cột `auth_email_tokens`). **Không restart 3001** khi chưa có quyết định migrate Demo của owner; nếu restart, địa chỉ/checkout/quên mật khẩu trên Demo sẽ lỗi. Tiến trình hiện tại vẫn chạy BE cũ trong bộ nhớ. FE đã tương thích khi chưa có `orderNumber`.
- **DEMO ĐÃ CẬP NHẬT BE (31/10 21:33, owner chạy, cảnh báo “không restart 3001” ở trên hết hiệu lực):**
  - backup trước: `machine-local/backups/demo-before-be-ux03-04-1793456612993.dump` (pg_restore -l đọc được 68 bảng dữ liệu);
  - `machine-local/migrate-demo-be-ux03-04.mjs`: thêm 2 migration BE-UX-03/04 (chỉ thêm cột/bảng), Demo 42/42, GRANT DML cho app role trên 3 bảng địa giới;
  - restart 3001 qua `restart-demo-backend.ps1`. Lượt đầu fail vì PS 5.1 không đặt nháy cho ArgumentList có dấu cách; đã sửa, lượt 2 listening sau 2s;
  - smoke GET chỉ đọc: /products 200, /categories 200, FE 5173 200, endpoint admin 401 (đúng khi chưa đăng nhập), /locations/provinces 503 `LOCATION_CATALOG_NOT_LOADED` (đúng: chưa nạp dữ liệu địa giới chính thức, FE chưa gọi endpoint này);
  - app role đọc được cột mới: 3 địa chỉ (0 có mã địa giới), token email 0;
  - chưa kiểm luồng đăng nhập/checkout trên Demo bằng trình duyệt.

## CN3-YC2 Lịch sử giao dịch theo cửa hàng — Claude, 01/11 (owner duyệt kế hoạch đối chiếu đề cương KLCN201)

- Phạm vi owner chốt: thanh toán **COD + VNPay**, không làm MoMo; phần Search do Đạt phụ trách, không nằm trong lượt này.
- BE: `GET seller/dashboard/transactions` (store của chính Seller, không nhận `storeId`) và `GET admin/dashboard/transactions?storeId=` trong `BE/src/dashboard/`. Gộp `payments` (thời điểm `paidAt`, nếu chưa có thì `createdAt`) với `refund_records` (`succeededAt`). Totals tính trên toàn khoảng ngày; phân trang keyset `(at,kind,id)` qua cursor `<epochMs>_<P|R><id>`. Dùng lại `read()`: read-only, RepeatableRead, kiểm role/credentialVersion.
- FE: `TransactionHistory.tsx` trong Dashboard (tải khi bấm nút, Admin lọc theo cửa hàng, nhãn tiếng Việt, "Xem thêm"), validator chặt trong `dashboardApi.ts`.
- Kiểm local: BE unit 97 file / 2149 PASS, tsc + lint OK; FE 1911 PASS / 6 SKIP, build PASS. Ca e2e mới trong `BE/test/dashboard-runtime.e2e-spec.ts` (phạm vi store, totals, keyset, 400/401/403, không mutate) **NOT_RUN**: PG QA 5549 đang tắt (Docker dừng). Chưa Chrome, chưa commit/push.

## D19 — vai trò và model, Claude coordinator tiếp nhận 01/11

- Owner xác nhận **Claude là leader/coordinator hiện hành**. Codex và Antigravity là worker/reviewer theo task do Claude giao, không tự giành coordinator. Mục "Bàn giao đồng leader — D18" và "Coordinator duy nhất — Claude phiên Windows" ở trên giữ làm lịch sử; vai trò hiện hành theo D19.
- Model/effort hiện hành: Codex Astra Low; Codex khác Medium; Antigravity Argon/Claude ≤ Medium; Antigravity nhẹ Medium (bỏ mặc định Flash High); Claude leader ≤ Medium. Bảng cũ trong PROTOCOL đã đánh dấu SUPERSEDED.
- Kênh gọi Codex review: CLI `codex-cli 0.166.0-alpha.5.1` tại đường dẫn ghi trong PROTOCOL, `exec --ephemeral --sandbox read-only`; owner đã smoke test PASS. Không sửa PATH, không cài thêm.
- Ownership hiện tại: Claude ghi context (CURRENT/DECISIONS/WORKBOARD/PROTOCOL) và source CN3-YC2 (`BE/src/dashboard/*`, `BE/test/dashboard-runtime.e2e-spec.ts`, `FE/src/features/dashboard/*`). Chưa giao file nào cho Codex/Antigravity.
- CN3-YC2 giữ trạng thái **chờ E2E PostgreSQL**; unit/build PASS không thay nghiệm thu DB. WIP giữ nguyên; quyền push/merge không đổi.

### CN3-YC2 — cập nhật 01/11 sau khi owner bật lại Docker

- **E2E PostgreSQL PASS:** QA DB mới dùng một lần, runtime `bckl_local_app` (DML), source-stable. Lượt đầu `be-ux01-qa-1793532327609` 19/19 (giữ làm lịch sử, trước khi sửa review). Lượt cuối `be-ux01-qa-1793532639659` **20/20**.
- **Review Codex** (CLI 0.166.0-alpha.5.1, `exec --ephemeral --sandbox read-only`, effort Medium; writer Claude, reviewer Codex theo D19):
  - Lượt 1 `machine-local/final-day-20261030/cn3-yc2-codex-review-1793532366855.md`: 3 CONFIRMED. (1) keyset `ORDER BY id` gắn vào alias text ⇒ bỏ sót dòng; (2) FE thiếu `REVIEW_REQUIRED`; (3) validator FE lỏng (thứ tự tuple, cursor, totals).
  - Đã sửa: qualify `r.*`, cursor so sánh không cast; FE kiểm tuple `(ms,kind,BigInt id)`, nextCursor phải khớp dòng cuối, trang sau phải đứng sau cursor đã gửi, totals ≥ trang và khớp tuyệt đối khi chỉ có một trang; thêm retry danh sách cửa hàng.
  - **Đối chứng âm** `be-ux01-qa-1793532626355`: đưa ORDER BY về bản lỗi ⇒ ca keyset FAIL đúng `[P9999999]` thay vì `[P10000000, P9999999]`. Khôi phục ⇒ 20/20.
  - Lượt 2 `cn3-yc2-codex-rereview-*.md`: 3 lỗi đã đóng, 0 CONFIRMED mới. OPTIONAL "lỗi tải danh sách cửa hàng bị nuốt" đã xử lý sau review (chưa re-review riêng phần này; FE test 51/51).
- Hồi quy: BE unit 2149 PASS; FE 1913 PASS / 6 SKIP (trước sửa OPTIONAL), build PASS.
- Còn lại: **Chrome chưa chạy** (Demo 5173/3001/8000 đang tắt; chạy cần build lại `BE/dist`). Giả thuyết còn mở: payment đổi từ `createdAt` sang `paidAt` giữa hai trang có thể làm lệch keyset (chấp nhận như giới hạn đọc theo trang). Chưa commit/push.

### CN3-YC2 — Chrome trên Demo, 01/11 (owner chọn "Claude bật Demo + chụp")

- `BE/dist` build lại bằng `nest build`; Demo chạy bằng `machine-local/start-all.ps1 -Profile Demo` (5173/3001/8000 đều lên; PG/ES dùng container đang chạy). Không migrate DB; endpoint mới chỉ đọc.
- Driver chỉ đọc `machine-local/cn3-yc2-demo-chrome-20261101.mjs` (Chrome thật, tài khoản demo đọc nội bộ, không in thông tin đăng nhập; chỉ đăng nhập rồi GET).
- **Lỗi tìm thấy bằng Chrome và đã sửa:**
  1. Admin desktop tràn ngang 1601/1440 khi bảng có dữ liệu: `.panel` là grid item với `min-width:auto` ⇒ thêm `min-width:0`.
  2. Admin mobile tràn 396/390 do ô chọn cửa hàng ⇒ `.inlineField` cho phép xuống dòng, select `max-width:100%`.
- Các lượt driver FAIL/sai lệch trước đó (sai origin `127.0.0.1` thay vì `localhost`, selector trùng nhãn "Từ ngày", race điền ngày trước khi lần tải đầu xong) là lỗi driver, giữ trong `final-day-20261030/cn3-yc2-chrome-*` làm lịch sử.
- **Lượt cuối `final-day-20261030/cn3-yc2-chrome-1793533512405`:** Seller và Admin HTTP 200, 5 dòng, totals UI = API (`Đã thanh toán (1) 50.000 ₫ / Đã hoàn tiền (0) 0 ₫`). Bộ lọc cửa hàng của Admin: mọi dòng cùng store. Desktop 1440/1440, mobile 390/390 cả trước và sau khi mở panel. 0 pageerror, 0 request ghi ngoài auth.
- FE sau sửa: 1915 PASS / 6 SKIP, build PASS. CSS mobile và nút thử lại danh sách cửa hàng chưa qua Codex re-review (rủi ro thấp, chỉ UI).
- Trạng thái **CN3-YC2: DONE_LOCAL** (E2E PG 20/20 + Codex review 0 CONFIRMED còn mở + Chrome Demo PASS). Chưa staging, chưa commit/push.
- Demo đang chạy với `BE/dist` mới (gồm WIP BE-UX đã có trước + CN3-YC2).

### Commit local 01/11 — owner yêu cầu "thực hiện tiếp" sau CN3-YC2 (không push, D06/D15 giữ nguyên)

- Branch `feat/hoang/sku-management-final`, base `60f2091`. Stage từng đường dẫn đích danh (`--pathspec-from-file`, không `git add .`). Author `Claude <noreply@anthropic.com>` truyền qua `-c` cho từng lệnh, giống quy ước commit của Codex; không sửa git config.
  1. `d038a6c` feat(be) BE-UX-01..04 + notification + QA DDL helper (46 file).
  2. `59a1330` feat(web) FE-ORANGE G1–G5 + 3 driver Chrome trong `scripts/` (86 file).
  3. `ad6efa9` feat(dashboard) CN3-YC2 (13 file; mang theo thay đổi hiển thị mã ORD ở data-quality nằm cùng file).
  4. Commit tài liệu agent-context + AGENTS.md (lượt này).
- Trước commit: quét secret/email thật trên mọi file sẽ commit. Thay địa chỉ `@gmail.com` trong `FE/src/pages/AccountPage.test.tsx` bằng `buyer.qa.demo@example.invalid` (test vẫn PASS). Không có file private/dataset/upload; `BE/dist` đã ignore; lockfile không đổi.
- `CANDIDATE_BASELINE.json` **chưa** cập nhật theo các commit mới (vẫn tham chiếu baseline cũ). Hash lệch là thay đổi có chủ đích đã commit, không restore.
- Chưa push; CI chưa chạy cho các commit này.

## B3 VNPay IPN online + B4 đổi mật khẩu qua email — 01/11 (owner: "mục 1 và 2 đi, cho phép mở HTTPS tunnel")

- **B3 hạ tầng đã dựng** (`machine-local/vnpay-live-20261101`, ngoài Git): DB QA mới `bckl_order_resolution_test_vnpay_live_20261101` (42 migration, runtime DML), backend 3398 chạy `BE/dist` của `227691a`, web 5198, proxy chỉ cho callback 3399, Cloudflare quick tunnel `https://artists-consumer-tribal-deck.trycloudflare.com`. Ranh giới qua tunnel: /docs, /auth/login, /products, /admin/dashboard, /payments/vnpay/orders/1 → 404; IPN không chữ ký → 200 RspCode 97; POST IPN → 405.
- Bối cảnh: 29/10 đã có SIT #987 6/6 + một giao dịch NCB PAID trên source PR135 (`docs/testing/vnpay-sit-live-2026-10-29.md`). Lượt này để chứng minh trên candidate hiện tại và bổ sung luồng hủy tại cổng.
- **Chờ owner:** (1) cập nhật IPN URL trong portal VNPay SIT sang tunnel mới; (2) xác nhận điều khoản cho từng giao dịch sandbox theo D11. Chưa tạo đơn/giao dịch nào.
- **B4 review Codex** (`final-day-20261030/b4-codex-design-review-*.md`, effort Medium): **chưa thể bật EMAIL**. CONFIRMED: FE chưa có `/account/change-password`; gửi thư thất bại vẫn báo đã gửi; token hết hạn trả 400 (không phải 410). HYPOTHESIS: `sessionStorage` theo tab nên mở link email ở tab mới sẽ thiếu binding; IP sau reverse proxy gom chung quota. Lượt chạy nền đầu tiên exit 2, không có output (giữ log); chạy lại foreground thì OK.
- **B3 BLOCKED_EXTERNAL (01/11):** owner báo đăng nhập portal VNPay SIT trả "Request failed with status code 400". Từ máy này các trang `vsm-sit-client/login`, `paymentv2`, `merchantv2` vẫn tải được (200/302), nên lỗi nằm ở bước gửi đăng nhập phía VNPay. Không đổi được IPN URL nên không chạy giao dịch (IPN sẽ đi về tunnel cũ đã chết). Đã tắt tunnel/proxy/backend/web theo đúng PID (kiểm identity); tunnel công khai trả 502. Giữ DB QA và script `vnpay-live-20261101` (orders.mjs đã chỉnh cho ca thành công + hủy tại cổng). Chạy lại: bật proxy + tunnel → `setup.mjs bind <url>` → bật backend/web → owner đổi IPN URL trong portal + xác nhận điều khoản → `orders.mjs create`.
- **B4 BUY-02 đổi mật khẩu qua email — DONE_LOCAL_CHROME_QA (FE), chưa bật trên Demo.** Writer Claude, reviewer Codex (effort Medium, 4 lượt):
  - Review thiết kế: chưa thể bật (FE thiếu trang, lỗi gửi thư vẫn báo đã gửi, mã 400 ≠ 410; giả thuyết sessionStorage theo tab).
  - FE mới: `services/passwordChangeEmailApi.ts`, `features/account-settings/passwordChangeBinding.ts` (localStorage theo user, hết hạn, compare-and-delete), nhánh EMAIL trong `AccountSettings.tsx` (consent; copy "đã tiếp nhận yêu cầu"), `pages/ChangePasswordPage.tsx` (route công khai `/account/change-password`, đọc fragment rồi `replaceState`, verify một lần, chống double submit, map 400/409/401/429/503). Route chỉ có khi `VITE_AUTH_EMAIL_ENABLED=true` và `VITE_AUTH_PASSWORD_CHANGE_MODE=EMAIL`. BE không đổi.
  - Review FE lượt 1: 2 P2 (link cũ xóa binding mới; confirm về muộn điều hướng phiên mới) + 1 P3 (verify 2 lần trong StrictMode) ⇒ đã sửa. Lượt 2: thêm 1 P2 (confirm thành công về muộn xóa binding mới) ⇒ sửa bằng compare-and-delete. Lượt 3: **0 CONFIRMED**, kết luận FE có thể bật.
  - Chrome thật + Nest in-process (`BE/dist`) + DB QA mới 42 migration, runtime DML, mail capture trong RAM (không gửi thư thật): `scripts/test-password-change-email-browser.mjs` qua `machine-local/pwchange-qa-20261101.mjs`. **20/20 PASS** ở 4 lượt DB mới; lượt cuối `final-day-20261030/pwchange-chrome-1793535535348`. Phủ: ẩn form trực tiếp; đúng 1 thư; binding lưu, token không lưu; `POST /auth/password` 409; trình duyệt khác bị chặn, không tiêu thụ token; **tab mới cùng trình duyệt đổi được**; fragment bị xóa; credentialVersion +1; hash mới; token used; refresh revoke; 1 audit; access token cũ 401; mật khẩu cũ 401; link dùng lại bị chặn; 0 pageerror.
  - Đối chứng âm `pwchange-chrome-1793535002450`: đổi binding sang sessionStorage ⇒ tab mới không vào được form (xác nhận giả thuyết của Codex).
  - FE 1931 PASS / 6 SKIP, build PASS. Lỗi copy tìm thấy bằng Chrome (link đã dùng báo "sai trình duyệt") đã sửa.
  - **Để bật trên Demo (cần owner quyết):** BE `AUTH_PASSWORD_CHANGE_MODE=EMAIL`, `AUTH_EMAIL_ENABLED=true` + provider thật, `ACCOUNT_SETTINGS_WRITE_ENABLED=true`, `AUTH_EMAIL_WEB_ORIGIN`; FE `VITE_AUTH_PASSWORD_CHANGE_MODE=EMAIL`. Migration Demo đã có từ 31/10. Gửi thư thật bị giới hạn bởi D09 (chỉ alias kiểm thử). Còn mở: BE vẫn trả `CHANGE_EMAIL_SENT` dù gửi thư thất bại sau commit (FE đã đổi copy, chưa sửa BE); suite e2e `account-settings` (DIRECT) chưa chạy lại; quota IP sau reverse proxy.

## UI-SHOPEE (01/11, owner: chỉ các chức năng trong đề cương; chia Claude + Codex)
Nguồn tham khảo: owner cho xem shopee.vn (chỉ xem, không đặt hàng) + bài Sapo đăng sản phẩm. Học bố cục, không chép logo/thương hiệu. Không làm giao diện cho chức năng không có (voucher, xu, đơn vị vận chuyển, bảo hiểm, ưu đãi ngân hàng). Base HEAD `4929171`, working tree sạch.
- **UI-A (Claude, writer)** khung chung: `FE/index.html`, `FE/src/components/{Header,Footer,AuthLayout}/*`, `FE/src/layouts/*`, `FE/src/index.css`, `FE/src/styles/*`, `FE/src/pages/{LoginPage,RegisterPage,SellerDashboardPage}.tsx` (chỉ bỏ chữ Noel). Bỏ chủ đề Noel, tiêu đề tab, header icon + menu tài khoản.
- **UI-C (Claude, writer; reviewer Codex)** giỏ + thanh toán: `FE/src/pages/CartPage.*`, `FE/src/features/order-flow/*`. Chạm tiền/kho: không đổi hợp đồng API/idempotency; Chrome Buyer + ledger sau sửa.
- **UI-B (Codex, writer; reviewer Claude)** đơn mua: `FE/src/features/order-readiness/*`, `FE/src/features/order-recovery/*.module.css`, và markup trình bày trong `BuyerOrderWorkspace.tsx` (không đổi logic lệnh/journal/fingerprint).
- **UI-D (Codex, writer; reviewer Claude)** sản phẩm/trang chủ: `FE/src/pages/{HomePage,ProductDetailPage}.tsx`, `FE/src/pages/Marketplace.module.css` (không xóa/đổi tên class mà file seller đang dùng), `FE/src/components/ProductCard/*`, `FE/src/features/seller-listing/ProductPurchase.tsx`, `FE/src/features/product-reviews/PublicProductReviews.tsx`, `FE/src/features/public-store/*`.
- File ngoài danh sách: chỉ đọc. Không commit/push; Claude commit sau review + test.
- **UI-SHOPEE kết quả (01/11) — DONE_LOCAL_CHROME_QA, chưa push.** Writer: Claude (UI-A khung chung + AccountPage dọn trang trí; UI-C giỏ/thanh toán), Codex Medium workspace-write (UI-B đơn mua, UI-D trang chủ/PDP/ProductCard/đánh giá/trang shop). Reviewer chéo: Codex read-only review UI-C ⇒ 3 CONFIRMED (heading checkout bị bọc làm hỏng `test-checkout-browser.mjs` dòng 295–298; nhãn hiển thị khác accessible name ở ô chọn địa chỉ; chữ #888 tương phản 3.54:1) — đã sửa cả 3. Claude review UI-B/UI-D: không đổi API/lệnh/journal; sửa thêm nút "Cập nhật" có aria-label khác chữ (label-in-name) về đúng chữ "Làm mới…". `ProductPurchase.tsx` Codex bị EPERM, không sửa.
  - Giữ nguyên logic tiền/kho: checkout vẫn 2 bước "Kiểm tra giá và kho" → "Đặt hàng COD"; giỏ giữ mọi accessible name driver dùng. Header mới: thanh cam liền, icon giỏ (`aria-label="Giỏ hàng"`), tài khoản `aria-label="Tài khoản (tên)"`, nút "Đăng xuất" hiển thị. `AuthHeaderTheme.test.js` cập nhật theo header cam (trắng/#d63b0b).
  - Kiểm: FE 1932 PASS / 6 SKIP, tsc + build PASS. Chrome DB QA mới, runtime DML: three-role `acceptance-20261031/three-role-1793542192369` PASS 12/12 + 3/3 UX, 0 pageerror, ledger 10 bước; buyer lane `fe-orange-buyer-1793542375384` **71/71**, stable. Lượt `fe-orange-buyer-1793542236792` FAIL 1 (driver tìm nhãn "Tạm tính đã chọn" đã bị rút gọn; số tiền đúng) ⇒ trả lại nhãn, giữ làm lịch sử.
  - Còn mở: chip danh mục trang chủ hiện cả danh mục rác QA trong Demo DB (dữ liệu, không sửa Demo khi chưa có quyết định owner); khách chưa đăng nhập chưa thấy chip phân loại trên PDP; Kênh người bán (đợt E) chưa làm.
