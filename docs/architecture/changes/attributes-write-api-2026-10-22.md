# Attributes write API — đường chạy và dữ liệu, 22/10/2026

## Trạng thái

Runtime PR từ develop `e394c9e`; chưa merge, chưa bật editor của Hiền.
Các nền policy #83, Seller coherence #87, kernel #91, uniqueness #92 và Search
regression #93 đã chính thức. Không thay migration dùng chung hoặc contract AI.

## Đường ghi

`AdminAttributeWriteController` nhận actor từ JWT, kiểm URL/query; parser nhận
JSON tối đa16KiB, no-store và rate guard60/phút/Admin/instance. Service gọi
policy thuần để kiểm body, không nhận usage/actor/thời gian/revision kết quả từ UI.

`AttributeTransactionBoundary` mở Serializable, kiểm current active ADMIN dưới
User SHARE lock → Category MVCC write fence → definition FOR UPDATE/revision
→ option khi cần. Usage đọc lại trong snapshot đã khóa. Thay đổi metadata,
revision DB trigger, audit có reason và durable reconciliation job cùng commit;
audit/job lỗi rollback toàn bộ. No-op không tăng revision/audit/job. Response
được đọc allowlist trong transaction ghi, không GET lại sau commit.

- `definitionId`: ID cấu hình mô tả trực tiếp của một Category, không phải nhóm
  phân loại tạo Variant/SKU.
- `expectedRevision`: phiên bản cấu hình Admin vừa đọc; stale trả409, không tự
  đổi sang revision mới để ghi đè. Khác `Product.version` dùng cho Search.
- `usage`: số Product/value/option chuẩn lấy từ DB, không phải quyền do UI cấp.
- `confirmPolicyChange` và `reason`: xác nhận + lý do cho thay đổi chính sách
  nhạy cảm; không cho vượt chặn đổi kiểu/slug/ý nghĩa đã được Product sử dụng.
- `searchReconciliation`: jobId string và trạng thái DB, không có nghĩa index
  đã đồng bộ hoặc Search đã sẵn sàng.

## Seller và public

Seller createDraft/value/category move/submit dùng cùng Category fence. Move
khóa hai Category theo ID tăng; retry serialization/raw SQLSTATE40001 phải đọc
lại canonical state. Submit giữ file I/O ngoài transaction dưới khóa ảnh hiện có,
kiểm version/category và toàn listing rule trong transaction trước CAS.
Re-submit Product APPROVED ghi DELETE outbox cùng chuyển PENDING.

`publicProduct` chiếu đúng kiểu TEXT/NUMBER/BOOLEAN/SINGLE_SELECT, bỏ optional
option inactive/sai definition/custom không được phép; false và0 vẫn hợp lệ.
Search dùng cùng projection. Khi rule required làm Product mất public, Public/
Cart/Checkout kiểm ngay cả khi job còn PENDING; worker đọc state hiện tại trước
UPSERT/DELETE. Không đổi ngược moderation hoặc xóa ProductValue/Order snapshot.

## Phần được giữ nguyên

Giữ Health API #89 và middleware trước guards; giữ upload/parser #90, ownership
invalidation #85, Buyer preparation và UI cam #59. Không copy cả tree local cũ
lên develop vì sẽ làm mất các miền này. Quota RAM chỉ là giới hạn một instance,
không thay bảo đảm transaction PostgreSQL hoặc rate limit nhiều replica.

Chưa có durable resolver/idempotency receipt riêng cho Catalog. FE không được
auto replay khi timeout/5xx hoặc tự mở khóa ghi chỉ vì GET trả được dữ liệu.
Chưa browser editor, loaded ES/FAISS hoặc nghiệm thu toàn Admin.
