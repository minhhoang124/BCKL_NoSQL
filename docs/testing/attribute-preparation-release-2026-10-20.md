# Attributes — gói chuẩn bị độc lập trên develop

## Phạm vi bàn giao

Đồng bộ develop `2f78a98`; không ghép #77 chưa merge. Không controller/module
gọi các helper mới; không schema/migration, không thay Seller/Search runtime.

- `attribute-write-policy.ts`: parser allowlist, NFC/Unicode, reason/confirmation,
  revision, usage gates và kế hoạch thay đổi definition/option.
- `attribute-normalization-audit.ts` + CLI: kiểm tra trùng normalized label
  trong snapshot read-only, không sửa dữ liệu hay tạo unique constraint.
- `attribute-write-effects.spec.ts`:16case ma trận tác động Search, gồm no-op
  và thay đổi metadata không cần job. `searchMayBeAffected` chỉ là kế hoạch
  coarse job, không chứng minh worker đã enqueue hoặc index đã thay đổi.
- Hai suite PostgreSQL: audit/CLI4case, SQL protocol10case. Protocol dùng bảng
  UUID fixture riêng, không chứng minh actual Admin/Seller writes an toàn.

## Kiểm tra thực chạy

Database mới `bckl_order_resolution_test_attrprep_release` trên PostgreSQL17
loopback5549:14 migrations chính thức PASS. Không dùng database demo5432.

| Kiểm tra | Kết quả |
| --- | --- |
| Full Backend unit | 807 PASS /33 files |
| Audit + protocol PostgreSQL suites | 14 PASS /2 files |
| Effect matrix (nằm trong full unit) | 16 PASS |
| Backend lint / Prisma generate / Nest build | PASS |
| Diff-check | PASS |

Không cộng16case vào807lần nữa. Full Backend E2E, FE, browser, live ES/FAISS
không chạy trong đợt này. Log giả lập health/Search error thuộc unit fault tests.

## Phát hiện cần giữ khi triển khai thật

SELECT-only category row lock không làm mới Serializable snapshot. SQL fixture
dùng shared write fence để buộc overlapping snapshot retry; production phải
chốt protocol cho tất cả writer, không copy UPDATE id=id vào Category tùy tiện.
Option phải khóa parent trước child/FK/trigger. Với5writer có thể hết3retry;
phải trả failure rõ, rollback sạch; không retry vô hạn/accepted giả.

## Điểm nối sau #77

1. Đồng bộ foundation chính thức; review migration normalized uniqueness trên
   dữ liệu đã audit. Không tự sửa/đoán dữ liệu trùng.
2. Trong cùng giao dịch: kiểm actor hiện hành, khóa scope/definition đúng thứ tự,
   đọc usage/canonical state, kiểm expectedRevision, gọi policy planner.
3. Persist metadata/revision/audit/durable Search job atomically; no-op không
   tăng revision/audit/job. Worker quyết định Product UPSERT/DELETE theo state mới.
4. Áp protocol cho Seller nhập attribute/submit/category changes; test HTTP nhiều
   connection trên schema thật trước bật editor ghi.

Không xem gói này là Backend ghi Attributes đã bàn giao. Reviewer Hiền kiểm
nghiệp vụ/contract; Đạt kiểm Search effect boundary. Không mở rộng rule ngoài #65.
