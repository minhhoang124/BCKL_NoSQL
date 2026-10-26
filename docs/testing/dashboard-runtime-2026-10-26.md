# Dashboard Backend — bằng chứng26/10/2026

Branch `codex/dashboard-runtime`, base `5802ae4` (hậu mãi #119 đã merge).
Phạm vi API đọc Admin/Seller; không migration mới, không UI hay settlement.
[Định nghĩa API và từng chỉ số](../api/dashboard-runtime.md).

## Kết quả local

| Kiểm tra | Kết quả |
|---|---|
| Frozen offline install |602 packages, lockfile giữ nguyên|
| Backend unit |65 files,1428 PASS|
| Dashboard đầu vào/lịch |17 PASS|
| Backend E2E toàn bộ, sau build |59 files PASS/2 skipped,958 PASS/1 SKIP/20 TODO,305.61s|
| Dashboard HTTP/PostgreSQL bằng app-role |18 PASS|
| CLI Attributes sau build |4 PASS|
| Lint/typecheck/build |PASS|
| Fresh migration QA |27 migration PASS|
| Prisma schema diff |No difference, exit0|
| git diff --check |PASS|

QA riêng `bckl_order_resolution_test_attributes_20261019_v951`, loopback5549.
Launcher kiểm exact container/binding và demo `bckl_postgres` dừng trước kết nối,
không đọc dotenv trong checkout. Full E2E dùng migrator hạn quyền để chạy các
suite migration; suite Dashboard riêng dùng app-role không superuser/CREATEDB/
CREATEROLE. D07 dùng database con mới để tách queue, không xóa dữ liệu chung.
Không chạy/migrate/xóa/khôi phục database demo. Log URL được che bởi launcher.

Lượt full E2E đầu có955 PASS/2 FAIL vì checkout mới chưa build file CLI
Attributes trong dist. Sau build, suite này4/4 và full suite958 PASS như trên.
Lượt Dashboard đầu có14/15: fixture dùng .99 bị CHECK whole-VND từ chối;
đã sửa fixture thành VND nguyên, giữ nguyên constraint/logic tiền. Không tính
lượt lỗi thành PASS hoặc giảm phạm vi chạy cuối.

## Các tình huống đã chứng minh

- Gross theo completedAt; refund ở kỳ sau làm net kỳ sau âm, shipping riêng,
  Payment vẫn PAID. Pending lifetime chưa trừ trước completion.
- Gọi HTTP Buyer completion thật kích hoạt pending; replay cùng key không
  nhân đôi gross/refund. Fixture snapshot lịch sử là synthetic, không thay
  bằng chứng checkout/COD toàn luồng.
- Một Order nhiều item/multiple refund vẫn đếm một gross; >50 Order không bị
  cắt mẫu; tổng vượt giới hạn tiền của một Order giữ exact string.
- Discount legacy/NaN/thiếu adjustment bị loại khỏi cả gross/refund và hiện
  data-quality. Cursor giảm exclusive, allowlist không lộ địa chỉ/điện thoại.
- Hai Seller có dữ liệu hợp lệ/lỗi: summary và quality không đọc chéo Store;
  Admin có all-status counts gồm CLOSED. Guest/non-Admin/inactive/stale token
  bị chặn; Seller không Store404; storeId client không cấp quyền.
- Mốc23:59:59.999 và00:00 UTC+7, SQL buckets day/month/quarter khớp khoảng
  nửa mở; kỳ cắt đầu/cuối đánh dấu partial. Unit có leapday/count overflow.
- GET body/query trùng/lạ/mảng/injection400; no-store cả lỗi/HEAD. Đọc không
  đổi Order/Payment/User/variant/refund/adjustment/audit/stock/Search queues.

## Review độc lập và giới hạn

Argon `gemini-4-argon-medium`, effort Medium, chỉ đọc snapshot mã nguồn, không
database/lệnh/sửa file: **NONE concrete P1/P2**. Snapshot SHA256:
`b8e52370e8166a05d71356a9128e528cdbc793dbd7cabecabfa392611e6dc90b`.
Các lượt CLI bị chặn đọc file hoặc trả output trống không được tính review.
Chỉ thêm quyền đọc đúng snapshot; giữ nguyên deny secret/write, không bỏ quyền
kiểm soát toàn CLI. Review này là AI static review, không human GitHub approval.

Sau review bổ sung test đối chiếu hai Store, cursor và tháng/quý; không đổi
runtime dựa trên diễn giải chưa được chứng minh. Lifetime quality scope đã
ghi rõ trong API. Uniqueness Payment/Order, Refund/item và Adjustment/refund
được bảo vệ ở schema/migration nền. Quy tắc time snapshot theo contract hiện
hành, không tự bổ sung điều kiện chronological khác producer hậu mãi.

Chưa benchmark dữ liệu thương mại lớn hoặc kiểm UI/chart. Query có bounded
timeout và không trả tổng một phần. Các SKIP/TODO nền vẫn chưa hoàn thành;
không dùng958 PASS để nhận toàn chức năng hay toàn dự án DONE. CI GitHub phải
đối chiếu riêng đúng head sau push, chưa được tính từ kết quả local này.
