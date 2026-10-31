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
