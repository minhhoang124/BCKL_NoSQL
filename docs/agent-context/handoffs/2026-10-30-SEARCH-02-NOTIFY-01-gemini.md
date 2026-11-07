# SEARCH-02 & NOTIFY-01 — Gemini (Coordinator tiếp nhận từ Codex) — 2026-10-30 18:12 Asia/Saigon

- Trạng thái: `DONE_LOCAL_QA` (cả `SEARCH-02` live SKU→Outbox→AI→ES/FAISS và `NOTIFY-01` native Chrome correct-recipient).
- Yêu cầu và acceptance criteria:
  1. `SEARCH-02`: Chuẩn hóa URL ảnh `/uploads/...` sang URL tuyệt đối theo `BACKEND_PUBLIC_URL` khi tạo event `SearchOutbox` mới (`buildUpsertPayload`), giữ nguyên byte-for-byte URL tuyệt đối hợp lệ, chặn traversal/double-encoding/control chars; dùng chung builder cho `SearchReconciliationService` để tạo event version mới thay thế mà không sửa payload lịch sử cũ; chứng minh trên DB QA riêng + FastAPI CLIP thật + Elasticsearch + FAISS.
  2. `NOTIFY-01`: Chứng minh thông báo in-app đúng người nhận (Buyer/Seller/Admin) và cách ly quyền đọc/đánh dấu đã đọc giữa các tài khoản trên DB QA riêng + Chrome thật.
- Checkout, branch, HEAD:
  - Checkout: `C:/Vo Minh Hoang/BCKL_2026/release-integration`
  - Branch: `feat/hoang/sku-management-final`
  - HEAD trước commit: `3291c8aa1e603358f8db0714eb0cf141a0c588ba` (source base `91f4d90559cf9fce852c414386fe33eb13092484`)
- WIP file SHA256:
  - `BE/src/search/search-outbox.service.ts`: `41e5c7fce70a1e0136fabf1bcceea697a324d71be2bcecb90fa480c32875b174`
  - `BE/src/search/search-image-url-policy.ts`: `48a4dc8c95e2995834eeb9556e51b821686f18105b97320c903dedabefe96055`
  - `BE/src/search/search-image-url-policy.spec.ts`: `6906828298f588581efef35e1aac7f68d31b713be3141bbdd0f4de16b255d329`
  - `scripts/test-sku-search-live.mjs`: `8b1fb80a704af349e0f9849cc6d8e4d901fcae3a80a2d0a04a640f6895f4019a`
  - `scripts/test-notifications-final-browser.mjs`: `8e142632776f46acef098d8a07a695ed0669994e013fb22ff0af6364392a8985`
  - `scripts/test-notifications-final-browser.py`: `a35bdfb3d85edc8b66bdc1f0a64572376312de205bc4066d8cbca998a62ff166`
- Worker / reviewer, model / effort:
  - Khởi tạo code & harness: Codex (trước khi chạm usage limit lúc 17:48).
  - Tiếp nhận, sửa lỗi nhỏ, chạy kiểm thử & điều phối: Gemini (Antigravity).
  - Static adversarial review: `claude-sonnet-5-5-medium` (`machine-local/final-day-20261030/search-review-1793358367805/summary.json`, 0 confirmed P1).
- Môi trường:
  - DB QA riêng (role `bckl_local_app`, không superuser/DDL, 40 migrations):
    - `bckl_order_resolution_test_sku_search_20261030_1793358243549` (cho `SEARCH-02`, index ES riêng `bckl-sku-search-qa-1793358248869`, AI port `8146`).
    - `bckl_order_resolution_test_notify_20261030_1793358544142` (cho `NOTIFY-01`, Vite port `5199`).
  - Không đụng DB Demo, không gọi provider ngoài.
- Đã thực thi & kết quả:
  1. Sửa `assertManagedPath` trong `BE/src/search/search-image-url-policy.ts` tách kiểm tra ký tự điều khiển sau `decodeURIComponent` (`controlOrBackslash`) khỏi kiểm tra raw space ban đầu (`unsafeCharacters`), giúp tên file UTF-8 có `%20` hợp lệ không bị chặn nhầm.
  2. Unit test miền Search & toàn bộ BE: `86/86` files (`1940/1940` tests PASS, gồm `68/68` test mới trong `search-image-url-policy.spec.ts`).
  3. Live QA `SEARCH-02` (`machine-local/final-day-20261030/sku-search-live-1793358243549/browser/report.json`):
     - Lượt chạy đầu (`1793357897885`, `1793358045687`) phát hiện 2 lỗi trong script test (`storeId` dư trong nested `variants.create` và `app.useStaticAssets` đặt sau `app.listen`); đã sửa trong `scripts/test-sku-search-live.mjs` và giữ nguyên log các lượt chạy trước.
     - Lượt chạy `1793358243549`: **PASS 8/8 checks**, `vectorCount: 2`, chứng minh cập nhật giá/kho SKU → Outbox → Worker → FastAPI CLIP → ES/FAISS v2/v3, replay `NOOP`, reconciliation tạo event version mới thay thế payload tương đối đúng 1 lần (`CREATED` rồi `SKIPPED`), giữ nguyên 100% payload lịch sử, và rollback toàn bộ transaction khi URL ảnh vi phạm.
  4. Live QA `NOTIFY-01` (`machine-local/final-day-20261030/notify-browser-1793358544142/browser/ledger-report.json` & `browser-report.json`):
     - Lượt chạy đầu (`1793358331459`) fail selector tiêu đề `'Đơn ORD-'` do UI thực tế render `'ORD-...'`; đã sửa selector trong `scripts/test-notifications-final-browser.py`.
     - Lượt chạy `1793358544142`: **PASS 6/6 HTTP/PG probes & 7/7 Chrome groups** (Buyer nhận 2 thông báo đơn hàng, Seller nhận 1 thông báo đơn mới không nhận echo tự thao tác, Admin nhận 1 thông báo hồ sơ Store chờ duyệt, Other Buyer/Seller = 0 và bị chặn 404 khi cố đọc/read-all thông báo người khác, giữ nguyên fingerprint 11 bảng nghiệp vụ).
- Chưa chạy, giới hạn:
  - Chưa tự drain/sửa hàng đợi Demo thực tế; khoảng cách định dạng WebP giữa Backend upload và AI decoder vẫn tách riêng như ghi nhận trước đó.
  - Không push/merge/kích GitHub Actions theo D06.
