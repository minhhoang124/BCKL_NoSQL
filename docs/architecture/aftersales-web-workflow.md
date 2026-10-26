# Hậu mãi Web —26/10/2026

Nhánh `codex/aftersales-web`, base `428700b` sau Dashboard #121. Dùng API
hậu mãi #119 và nguồn doanh thu–hoàn tiền Dashboard #120; không thêm schema,
không đổi nghiệp vụ hoặc giả lập chuyển tiền thật.

## Điểm vào và quyền

- Buyer `/account/aftersales`: danh sách, chi tiết/lịch sử, tạo từ item của
  đơn đã giao/hoàn tất và đã thanh toán, rút yêu cầu PENDING hoặc khiếu nại REJECTED.
- Seller `/seller/aftersales`: duyệt/từ chối PENDING, xác nhận nhận hàng trả.
- Admin `/admin/returns`: quyết định DISPUTED, xác nhận nhận hàng trả.

Account và Seller có liên kết tới danh sách; chi tiết đơn Buyer có liên kết
đúng item. Query chỉ nhận orderId/itemId nguyên dương duy nhất. Trang đọc đơn
canonical từ API trước khi chọn item; không nhận số tiền hoặc quyền từ URL.
SELLER mua hàng vẫn theo gate quyền Buyer hiện có. Backend luôn kiểm lại
phiên/quyền và quan hệ Buyer–Store; route/ẩn nút không thay kiểm quyền server.

`VITE_AFTERSALES_ENABLED` mặc định bật. Đặt `false` chặn thao tác nghiệp vụ mới
và ẩn điểm tạo từ đơn; đọc, lịch sử và phục hồi có đồng ý vẫn hoạt động.
Không bật các cờ Buyer/Seller/Auth khác thay người vận hành.

## Gửi và phục hồi

Mỗi account giữ tối đa một metadata tại `aftersale-pending:v1:<actorId>`:
UUID, scope/action/target, hash và kỳ vọng receipt. Không lưu reason,
description, token hoặc body nghiệp vụ vào sessionStorage. Snapshot/freeze
body và identity trước await SHA-256; CAS raw storage và epoch phiên được
kiểm lại trước lưu/gửi. Storage lỗi/hỏng chặn ghi mới, không tự xóa metadata.

Mỗi action có xác nhận riêng gắn với draft; thay lựa chọn/lý do làm mất xác
nhận. Receive bắt buộc chọn rõ hàng có nhập lại kho được hay không. Latch
đồng bộ chặn bấm hai lần cả trong cùng tick. Adapter kiểm lại hash body trước
POST và không tự replay khi 401.

Timeout/lỗi/response không hợp lệ giữ nguyên mã; reload không tự gửi lại.
Người dùng phải đồng ý đối chiếu; resolver chỉ nhận UUID/hash, trả APPLIED
hoặc đóng mã chưa chạy CLOSED, không tự tạo/duyệt/hoàn tiền/hoàn kho. Chỉ xóa
đúng raw metadata sau khi kiểm receipt gắn với command, item, loại, trạng thái,
revision, history và số tiền. `current` có thể mới hơn, không là bằng chứng ghi.
Sau kết quả xác định, tải lại danh sách/đơn lỗi chỉ được retry đọc.

Đổi account/epoch/scope remount; request cũ bị abort và generation fence.
401/403 khóa đọc và xóa dữ liệu riêng trong trang, không cho phản hồi trễ
khôi phục dữ liệu. Phân trang lịch sử không tái dùng xác nhận revision cũ.

## Ranh giới

Hoàn tiền ghi rõ **mô phỏng**, toàn bộ tiền item theo API; không hoàn phí
vận chuyển, không tích hợp ngân hàng/cổng tiền thật. UI không tự cập nhật
Payment.PAID, kho hoặc số Dashboard. Chỉ server ghi trong giao dịch; hoàn tất
đơn kích hoạt adjustment chờ qua hook hiện có. Thông báo tự động, SLA Seller
và luồng thanh toán sandbox chưa nằm trong thay đổi này.

[Bằng chứng và cách dựng QA](../testing/aftersales-web-2026-10-26.md).
