# Các bất biến cần giữ khi đồng bộ giao diện

Owner dự định sửa toàn bộ giao diện. Đây là bàn giao hành vi đã nối, không
phải thiết kế mỹ thuật cuối hoặc yêu cầu giữ layout hiện tại.

- Giữ component/logic thuộc tính và chọn SKU tách khỏi trang để đổi visual dễ.
  Contract enum là SINGLE_SELECT; false/0 không phải thiếu dữ liệu. Bắt buộc
  và option/custom lấy từ definition đang hoạt động của đúng danh mục.
- Mỗi SKU chọn một giá trị của mỗi nhóm. Khai báo nhóm trước SKU đầu tiên;
  giữ bảng giá/kho của từng SKU và cho cuộn ngang có keyboard trên mobile.
- ProductDetail chọn đúng `optionValueIds`; SKU hết hàng không đặt được.
  Giá/availability từ public API, kho thật và quyền do Backend kiểm lại.
- Giỏ PUT là desired quantity, không cộng. Copy phải nói đúng; không tự retry
  thao tác ghi sau lỗi mạng, hướng dẫn người dùng đối chiếu giỏ.
- Giữ pending ref/session fence, không chỉ disabled bằng state; đổi tài
  khoản/Product không được nhận dữ liệu hay thông báo của phiên trước.
- Checkout giữ intent/key, preview giá/kho và snapshot; không sửa trực tiếp
  Order/Payment bằng UI hoặc lấy return thanh toán làm bằng chứng PAID.
- Chat mở hội thoại và chia sẻ là hai thao tác riêng; giữ xác nhận chủ động,
  idempotency journal và allowlist Order card. Không đưa địa chỉ/điện thoại,
  payment/reason/receipt vào nội dung Message.
- Chạy lại unit + Chrome desktop/mobile và các ca mất response/chuyển actor
  sau đợt đổi UI. Không thay auth bằng context giả rồi nhận là browser E2E.

Xem [bằng chứng listing/Chat](../testing/listing-chat-release-2026-10-29.md).
