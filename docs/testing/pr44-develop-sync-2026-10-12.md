# PR #44 đồng bộ develop sau Cart #50 — 12/10/2026

Nền `develop d4d1884`; merge develop vào cùng nhánh PR, không rebase/force push.
Conflict chỉ tài liệu kiến trúc: giữ C3, ledger/StockMovement/version/outbox, receipt replay và giới hạn legacy. Nền #45 và Address/Auth/client/Cart đã merge được giữ. `BE/src` không đổi so với head 11332bb; có thêm schema/migration #45 nguyên trạng từ develop. 49 test cancellation thuộc full E2E.

## Kiểm thử thực chạy

- Frozen install PASS; lockfile không đổi.
- Prisma validate, full Backend typecheck, lint, build PASS.
- Backend unit **393/393 PASS**.
- Backend E2E **401/401 PASS**, 22 suites trên PostgreSQL 17 QA riêng
  `127.0.0.1:5549/bckl_pr44_sync_20261012`.
- Fresh migration deploy PASS: 12 migration đúng checkout. Không dùng
  database demo hoặc DB superset của browser Checkout.
- Lượt E2E đầu thiếu JWT QA nên bootstrap thất bại; không phải bug nghiệp vụ.
  Bổ sung JWT access/refresh QA ở process rồi chạy lại toàn bộ đạt số trên.
- Log lỗi forced/malformed trong test là ca kiểm lỗi có chủ đích.
  pg báo deprecation concurrent client.query; không coi cảnh báo đã được sửa.
- FE 122/122 test, lint/build PASS; diff-check PASS.

## Giới hạn

Không chạy ghép các nhánh Order khác, không thêm controller/parser của PR
chưa merge vào nhánh này. Confirm-vs-cancel qua API #43, detail #42 và luồng
Checkout → Seller → Admin → Buyer cần chạy lại sau tích hợp. Không chứng minh
SearchOutbox đã tới FastAPI/ES/FAISS; CHK-S04 riêng với Đạt. Không có browser
Order UI trong đợt sync. Không nâng G-FULFILMENT hoặc Review/Dashboard/Notification
thành DONE, không đổi contract FastAPI.

Head commit sau sync và CI của head mới được ghi trên comment PR; Hiền cần
re-review delta/bằng chứng, không tự resolve review cũ hoặc tự merge.
