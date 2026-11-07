# Seller Order UI mẫu — 09/10/2026

**IN_PROGRESS / fixture DEV**, không phải G-FULFILMENT DONE. Hoàng phụ trách;
không sửa Address/Cart hoặc Admin UI của Hiền. Chuẩn bị cùng nhánh preview #40;
không lấy code Checkout/Order chưa merge để nối API.

## Cách xem và ranh giới

Chạy FE ở port 5174, mở `/dev/seller-orders`. Danh sách lọc trạng thái, detail
snapshot, xác nhận đơn, bắt đầu đóng gói và sẵn sàng bàn giao. Dữ liệu giả của
một Store; chỉ thay đổi state React trong phiên. Reload khôi phục fixture;
nút khôi phục chủ động xóa cả thông báo/bước xác nhận đang dở. Buyer preview
độc lập, không mô phỏng hai bên được đồng bộ qua database.

Route chỉ mở với `import.meta.env.DEV`; không đổi guard SELLER thật và không
phục vụ đơn thật nếu chưa đăng nhập. AuthProvider toàn app có thể kiểm tra
phiên; **feature** này không gọi API, không sửa stock/Order/payment/outbox.
ID `seller-demo-*`, SKU DEMO không phải ID PostgreSQL hay DTO API.

## Luồng chuẩn trước khi nối API

Nguồn: SRS FR-ORD-01/D07 và contract Cart–Order mục 7/9.

1. GET Seller list/detail phải kiểm tra Store ownership từ JWT ở BE.
2. PENDING_CONFIRMATION → CONFIRMED → PACKING → READY_TO_SHIP qua command
   riêng, không generic PATCH status. Mỗi thao tác thật có key/body cố định,
   khóa nút gửi, receipt replay; lỗi trạng thái 409 tải lại Order.
3. Seller không ship/mark-delivered/complete. READY_TO_SHIP chờ Admin/adapter
   vận chuyển mô phỏng. COD chưa thanh toán không phải doanh thu đã hoàn tất.
4. Hủy chỉ PENDING/CONFIRMED, có lý do/audit và hoàn kho đúng một lần; chưa có
   API nên bản này không mở nút hủy. PACKING không được hủy tùy ý.
5. Khi chưa rõ commit sau timeout, giữ key/body, không giả lỗi thành rollback.
   Fixture lỗi hiện tại chỉ mô tả lỗi **trước** thao tác, không kiểm thử timeout.

## File và kiểm chứng

- `FE/src/features/seller-order-preview/SellerOrderPreview.tsx`: view model,
  provider phiên mẫu, list/detail, xác nhận và state lỗi/tải/rỗng.
- `SellerOrderPreview.test.tsx`: kiểm nhãn, luồng, lỗi không đổi state, không
  gọi fetch, chỉ command đúng nguồn, khôi phục phiên, không nút Seller delivered.
- Dùng CSS cam và format tiền nguyên đồng đã có ở Buyer preview #40; không
  thêm package/schema/API. Khi tách feature thật cần adapter DTO được review.

Các test DOM chỉ chứng minh UI mẫu. Browser desktop/mobile vẫn **NOT_RUN**
do công cụ capture lỗi khởi tạo; không tuyên bố responsive/accessibility đã đạt.
Kịch bản giao dịch thật nằm tại `../testing/checkout-order-journey-verification.md`.

Kết quả chạy 09/10: FE lint không cảnh báo, FE build PASS, full FE tests
**41/41 (8 file) PASS**, gồm 7 test Seller mới và 1 test Cart handoff Buyer mới;
git diff --check PASS. Kiểm tra bundle JS production không còn marker
`seller-demo`/`dev/seller-orders`/`dev/buyer-flow`/`DEMO-SELLER` PASS.
Không chạy Backend E2E hoặc giao dịch vì đợt này không nối/sửa Backend.
