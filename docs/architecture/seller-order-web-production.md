# Seller Order Web — ba bước chuẩn bị đơn

Màn thật `/seller/orders/:orderId` dùng API đã merge: xác nhận → bắt đầu đóng
gói → sẵn sàng bàn giao. Bật mặc định; build flag
`VITE_SELLER_ORDER_COMMANDS_ENABLED=false` khôi phục màn chỉ đọc. Cờ này chỉ
là chốt giao diện, không cấp quyền hoặc thay bảo vệ Backend.

Luồng giữ nguyên `sellerOrderWorkflow`/coordinator/journal/adapter đã merge:

1. Auth hiện hành → GET Order + Store, kiểm owner/status/payment; không POST
   khi mount/reload. Store SUSPENDED vẫn xử lý đơn cũ theo API chính thức.
2. Người dùng chọn một bước, tick đồng ý riêng rồi gửi. Lưu mã yêu cầu trước
   POST; bấm hai lần vẫn một ý định. Không tự nối ba bước thành một giao dịch.
3. Biên nhận hợp lệ → xóa đúng journal → GET trạng thái mới. Nếu GET lỗi, chỉ
   tải lại GET; không gửi lại lệnh đã biết thành công.
4. Mất phản hồi/timeout/HTTP lỗi/biên nhận hỏng → giữ nguyên mã, khóa lệnh mới.
   Đối chiếu là xác nhận riêng: COMMITTED trả biên nhận cũ; CLOSED chỉ đóng mã
   chưa thực hiện, không hủy đơn. Không tự đối chiếu khi reload.
5. Kết quả phiên cũ hoặc view đã unmount không được settle journal của phiên
   mới. SessionStorage theo tài khoản/tab, sống qua reload, không sống qua
   đóng tab hoặc xóa bộ nhớ bên ngoài. PostgreSQL mới bảo đảm đa request.

Phần thêm mới chỉ promotion flag, thông báo production thay nhãn QA, CSS
scoped cho checkbox/nút44px và test mặc định/kill-switch/StrictMode. Không
Backend/schema/API/Auth hoặc shared Address/Cart/Admin logic mới. Biến
`integrated` chỉ đổi câu chữ ở hộp xác nhận; `connected`, session, consent và
validator vẫn là điều kiện gửi như trước.

Rate limit thật20lệnh/phút/Seller gồm execute và resolve. Khi429, vẫn giữ key;
không tự retry hoặc tạo key mới. Driver đã kiểm chờ Retry-After42s rồi một lần
xác nhận đối chiếu mới bằng key cũ. UI thông báo lỗi đối chiếu còn chung chung,
chưa countdown riêng; không nhận đây là trải nghiệm hoàn chỉnh cho mọi lỗi.

Chưa nối Seller hủy/nhận hàng hoàn hoặc Admin delivery UI. Seller không tự
xác nhận giao thành công; Buyer hoàn tất ở màn riêng. Không nhận G-FULFILMENT
toàn bộ hoặc Chat/Notification/aftersale đã hoàn thành từ ba bước này.
[Bằng chứng và giới hạn](../testing/seller-order-web-production-2026-10-23.md).
