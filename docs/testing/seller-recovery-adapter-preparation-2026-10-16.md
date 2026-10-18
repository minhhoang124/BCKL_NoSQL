# Cầu nối Seller recovery — PREPARATION, 16/10/2026

Follow-up cùng #60: thêm khung confirmation/status chưa mount route; tổng FE
386 PASS/6liveSKIP, gồm19component cases mới. [Phạm vi và checklist runtime](seller-command-confirmation-preparation-2026-10-16.md).
Số367 bên dưới là kết quả baseline bridge trước follow-up, không cộng hai lượt.

Base develop `035656b` sau #56/#57. Chỉ bổ sung module và test, không route,
controller React, Store context, Backend, schema, hoặc bật nút giao dịch.

## Luồng chuẩn bị

`createSellerCommandRecovery` nhận storage và hàm lấy phiên Auth đã xác minh.
Caller phải giữ một instance ổn định, không tạo mới mỗi render. Module dùng
journal/coordinator đã merge #56 và adapter/validator thật của #55:

1. Kiểm Seller active và generation trùng apiClient trước khi lưu/gửi.
2. Yêu cầu confirmed=true; journal lưu và đọc lại trước HTTP.
3. Tạo WeakSet handle mới bằng **key đã lưu**, không cast JSON thành handle.
4. Gửi body `{}` qua timeout/strict receipt validator của orderApi.
5. Chỉ rút acknowledgement sau full receipt hợp lệ; coordinator kiểm lại phiên
   trước xóa đúng pending. GET detail không được dùng thay biên nhận.

Timeout/mạng/HTTP lỗi/200 hỏng đều giữ pending; retry phải có xác nhận và dùng
key cũ, không auto send khi tạo instance hoặc đọc pending. Module chỉ nhận
confirm/start-packing/ready-to-ship, không mở Buyer complete/cancel/returned.
Không log raw key/token hoặc lưu PII/receipt vào storage.

## Kiểm thử

- Frozen offline install: PASS; không đổi lockfile.
- FE 367 PASS /6 live SKIP; lint và TypeScript/Vite build PASS.
- 21 ca mới chạy real adapter/validator/journal/coordinator nhưng HTTP transport
  mocked: 3 commands, persist-before-send, confirmation, remount/new login giữ key,
  8 HTTP errors giữ pending và không refresh/retry, malformed200, double click,
  late success phiên cũ, storage lỗi kể cả remove sau receipt, khóa đơn/lệnh khác
  khi còn pending, command ngoài phạm vi và phiên sai.
- KHÔNG gọi những ca này là HTTP/PostgreSQL/browser hoặc transaction thật.
- Chưa chạy bridge live hoặc command Web end-to-end. Nền Backend C2 có bằng chứng
  riêng; không chuyển kết quả đó thành nghiệm thu module mới.

## Gate còn thiếu trước bật nút

Thiết kế #58 head `6e544dc` chưa có review tại lúc kiểm tra. Thiết kế yêu cầu chốt
protocol xử lý pending bị từ chối trước bật POST. API đối chiếu/đóng key và DB fence
(bản ghi ngăn ý định cũ chạy muộn) vẫn PROPOSED, không tồn tại trên develop.

Không tự clear bằng mã HTTP/GET hoặc thêm nút bỏ qua storage. Cần Hiền review
thiết kế #58 → triển khai Backend resolution trong PR riêng nếu chốt → mở rộng
settlement/React controller và Store context → chạy browser/HTTP/database trước
review bật command. Nhánh này chỉ làm cầu nối độc lập; Order route vẫn chỉ đọc.
