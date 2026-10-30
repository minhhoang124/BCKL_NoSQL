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
| SEARCH-01 | FUNCTIONAL_LOCAL / FINAL_PACKAGE_OPEN | CLIP/ESFAISS86real smoke;7querypackageverifierPASS với externalrawhash/officialgate chưa chạy. Historicalqueue/portability vẫn riêng |
| UI-01 | OPEN | Chỉ patchUI nghiệp vụ theo component cũ; chưa đồng bộ thiết kế toàn bộ |
| RELEASE-01 | OPEN | Chốt source/flags/accounts/runbook/report/Word-slide khớp phạm vi sau các gate; không sửa Word Hiền ngoài việc được giao |

## Ownership hiện tại

- Codex: implementation SKU BE/FE, module/controller, publicbrowserdrivers và helperQA riêng; contextCURRENT/DECISIONS/WORKBOARD, báo cáo. Không sửa các checkout khác hoặc resetDemo.
- Worker seller_client_tests đã bàn giao hai testFE SKU, không còn writer đang chạy.
- Worker seller_browser_harness đã bàn giao một e2eSKU35cases, không còn writer đang chạy. Worker seller_page_tests lượt cũ bị usage limit; root đã kiểm phần bàn giao trước đó.
- External Argon/Claude dùng snapshot lọc, staticonly, không credentials/DB/Git. Headless directwriteArgon bịdeny0files; không dùng dangerously-skip. Root tích hợp draftoffline, giữ bằng chứng không che lỗi.
- Baseline8SellerfilesMEM01 là lịch sử trướcc18, không dùng làm khóa WIP mới. Các thay đổiSeller có chủ đích đã commit; candidateSKU dùng SHA256 ở provenanceQA và baseline checkpoint mới, không tự restore snapshot cũ.
