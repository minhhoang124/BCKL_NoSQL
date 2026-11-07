## Phạm vi — PREPARATION, chưa API Attributes hoàn chỉnh

### Cập nhật sau #86/#73, nền `be568e0`

Thêm đủ năm canonical counts trong `run().usage` (reference, option reference,
all options, active options, direct Category Products), cùng snapshot sau fence,
Object.freeze; không nhận usage từ HTTP. Ba probe RED trước sửa rồi GREEN;
36/36 kernel PostgreSQL và795unit PASS, lint/typecheck/build/Prisma/diff PASS.

**Full E2E lượt mới chưa xanh:698 PASS/8FAIL/20TODO.** Đã tái lập riêng nguyên
nhân test Search chờ sai khi có >20 job cũ; bảy lỗi 403 là hậu quả Store chưa
được mở lại. Bản sửa test tách nhánh từ develop, không sửa production worker
hoặc xóa hàng đợi để che lỗi. Chưa dùng kết quả lịch sử703PASS làm gate mới.
CI GitHub còn bị quota/billing, job không khởi chạy; cần exact-head review và
full regression sau bản sửa test trước merge. Không tự nới gate/activate API.

Các phần bằng chứng phía dưới giữ lịch sử trước lượt bổ sung counts.

Từ develop `d84381a` sau #88; không lấy #83/#87/#90 pending làm nền chính thức.
Không sửa schema/migration, CatalogModule/controller, Seller/Product/AI hoặc
lockfile. Mở Draft để review cơ chế trước khi tích hợp các writer/API thật.

## Cơ chế đã viết và kiểm chứng

- User SHARE/current active ADMIN → Category MVCC write fence → definition
  UPDATE/CAS; canonical usage đọc cùng transaction. Không một-process lock.
- Parent được khóa trước insert option; trigger hiện có tăng revision một bước.
- createDefinition khóa actor/Category, đọc usage rồi gọi planner nội bộ; INSERT
  revision1/audit CREATE_DEFINITION/job cùng transaction, chưa HTTP API.
- Metadata + canonical allowlisted audit + optional durable Category job cùng
  transaction; server actor/time/correlation, không nhận old/new từ HTTP.
- Scope/effect snapshot, record latch, phát hiện nuốt lỗi/thiếu audit/no-op;
  final signature chặn thay trạng thái sau audit. Context chỉ có hạn trong callback.
- Retry toàn transaction tối đa3, chỉ phân loại serialization/deadlock; không
  retry business409. Callback nội bộ phải await và không làm external I/O.

## Bằng chứng

- QA riêng5549/v903, role không superuser, không dùng demo;16migration đã áp
  trên DB mới trước lượt kiểm #83, sau đó các suite chạy tuần tự cùng DB này.
- **795Backend unit PASS**, gồm30case khung; **703full E2E PASS/20TODO** gồm33
  kernel PostgreSQL,183.49s. Không cộng subset lần hai.
- Lint/typecheck/build/Prisma validate/diff-check PASS; không nới timeout/skip.
- Hai probe audit từng FAIL đúng trên source kernel đang dở, đã sửa và22/22PG
  xanh: xóa option sau record/giấu xóa option trong audit definition phải rollback.
- Hai Prisma pool + quan sát `pg_blocking_pids` chứng minh Admin thực chờ value
  writer harness rồi đọc usage mới sau retry; không chỉ dùng delay/đoán kết quả.
- Opus4.6Thinking review source-only phần create không nêu blocker trong đoạn
  cung cấp; đầu ra cuối bị cắt, không nhận full review/human approval/test độc lập.

## Gate còn thiếu — không nghiệm thu hoặc bật giao dịch

@Hiennq44 @dungdat nhờ review thứ tự khóa/audit/retry trong phạm vi kernel.
Không registered provider/controller, chưa create-definition API, full policy,
normalized-name uniqueness, toàn bộ Seller/Admin/import/category-change/submit
writers, projection hoặc live Search. Cờ effect ở test do harness cung cấp,
không phải planner production. Không coi snapshot signature là sandbox ngăn mọi
SQL tùy ý của callback nội bộ.

#83 đã được Đạt chấp nhận P2 ở9a8b593, đồng bộ #88 lên9975f32 cần re-review
delta; #87 chờ review riêng. Không tự bật editor từ kết quả này.
Audit fixture giữ trong DB QA một lần,
không xóa audit/disable trigger trên dữ liệu demo. Secret/config gửi riêng,
không commit vào diff hay gửi cho CLI.

Luồng/biến: docs/architecture/attribute-write-transaction-boundary.md.
Ma trận/lệnh/baseline: docs/testing/attribute-transaction-boundary-2026-10-21.md.
