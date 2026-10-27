# VNPay sandbox — Checkout và đối chiếu thanh toán

Phạm vi: `SCOPE-PAYMENT-001`, runtime QA với cờ mặc định tắt. Đọc kèm
`docs/architecture/vnpay-sandbox-runtime.md`. Không thanh toán production,
không tích hợp hoàn tiền thật hoặc ví người bán.

## Cấu hình

- Backend: `VNPAY_SANDBOX_ENABLED=true`, `VNPAY_TMN_CODE`,
  `VNPAY_HASH_SECRET`, `VNPAY_WEB_ORIGIN`, `VNPAY_API_ORIGIN`.
- Web: `VITE_VNPAY_SANDBOX_ENABLED=true`. COD vẫn mặc định.
- Khóa chỉ có ở Backend; không commit `.env`/JSON riêng hoặc đưa khóa vào
  Vite, ảnh minh chứng, log, PR và yêu cầu gửi reviewer.
- Runtime hiện giới hạn database QA được kiểm tra host/port/tên/role;
  không dùng database demo. `NODE_ENV=production` bị từ chối.
- Tắt tạo mới không được gỡ cấu hình merchant cần thiết cho callback và
  đọc/replay giao dịch cũ. Không đổi merchant khi còn giao dịch cần đối chiếu.

## Checkout

`POST /checkout/preview` và `POST /checkouts` nhận `paymentProvider: VNPAY`
khi Backend cho phép. Giữ nguyên giới hạn, quyền, idempotency và kiểm giá/kho
của Checkout. Mỗi Store tạo một Order/Payment riêng. Hash/receipt v2 chỉ
dành VNPay; COD v1 không đổi. Biên nhận ban đầu vẫn UNPAID dù Payment hiện
tại đã thay đổi; đọc trạng thái qua API thanh toán hoặc chi tiết Order.

## API chủ đơn

Yêu cầu JWT còn hiệu lực, tài khoản hoạt động và quyền sở hữu được kiểm lại
trong DB; response có `Cache-Control: no-store`. ID là số nguyên dương PG.
Không nhận query. POST chỉ nhận JSON `{ "confirmed": true }`, không nhận
số tiền, merchant hoặc địa chỉ chuyển hướng từ client.

| API | Hành vi |
|---|---|
| `GET /payments/vnpay/orders/:orderId` | Chỉ đọc; không tự tạo phiên. |
| `POST /payments/vnpay/orders/:orderId/start` | Tạo một phiên bền duy nhất cho Payment, hoặc trả phiên cũ. |

Response gồm `orderId`, `provider: VNPAY`, `mode: SANDBOX`, `paymentStatus`,
`canStart` và `transaction` (null nếu chưa tạo). Transaction gồm `reference`,
`status`, `amount` (chuỗi VND), `currency`, `expiresAt`, `expired`,
`needsReview`, `paymentUrl` (null khi không còn đủ điều kiện mở cổng).
Server giới hạn 60 request/phút/tài khoản trong mỗi instance; PostgreSQL
unique/lock mới là bảo vệ tài chính giữa nhiều instance.

Mất phản hồi POST: chỉ GET lại, giữ phiên đã tạo. Không sinh mã mới hoặc tự
chuyển hướng. Một Order chưa có retry nhiều lần thanh toán; hết hạn/chưa thu
tiền thì người dùng có thể hủy đơn rồi đặt lại. Không tự hủy đơn theo TTL.

## Callback và Return

- `GET /payments/vnpay/ipn`: server VNPay gọi; không cần JWT. Query có
  allowlist, chống trùng tham số, kiểm HMAC SHA512 trước DB; đối chiếu ref,
  merchant, VND và amount ×100. Chỉ `vnp_ResponseCode=00` **và**
  `vnp_TransactionStatus=00` cùng thời gian/mã provider hợp lệ mới PAID sạch.
- Ack `00`: đã commit; `02`: đã ghi nhận; `01`: không tìm thấy; `04`: lệch
  tiền; `97`: dữ liệu/chữ ký không hợp lệ; `99`: chưa xác nhận, có thể retry.
  Lỗi cấu hình có thể trả HTTP 503; không tuyên bố xử lý thành công.
- `GET /payments/vnpay/return`: xác minh rồi 303 về chi tiết đơn cố định;
  không ghi trạng thái tài chính. Trình duyệt trở về không chứng minh đã trả tiền.
- Callback trái ngược, giao dịch đảo, quá hạn trả tiền hoặc tiền đến sau
  hủy đơn: giữ ledger và chuyển REVIEW_REQUIRED; không sống lại Order,
  không trừ/hoàn kho lần hai, không báo đã hoàn tiền thật.
- REVIEW_REQUIRED chặn luồng Seller cần PAID. Chưa có công cụ tự xử lý
  đối soát/hoàn tiền thật; liên hệ quản trị và đối chiếu provider riêng.

## Bằng chứng và phần chưa nghiệm thu

Ngày 27/10: 20 HTTP/PostgreSQL, 1.675 unit Backend, 1.638 test Web đạt;
Checkout hồi quy sau sửa 41/41 đạt. Upgrade 35→36 bảo toàn dữ liệu fixture
legacy và checksum cũ. Chrome thật 5 nhóm đạt với IPN **giả lập có chữ ký**:
Checkout, mất phản hồi sau tạo phiên, reload, desktop/mobile, callback lặp
và tiền/kho bất biến ngoài lần ghi hợp lệ.

Merchant mới mở được trang chọn phương thức Test, chưa hoàn tất giao dịch
VNPay thật. Nhóm chưa có HTTPS QA để nhận IPN. Bước còn lại: công khai
**riêng đường callback QA** bằng phương án được duyệt, cấu hình Merchant/SIT,
kiểm thành công/hủy/lỗi/nhận IPN và lưu bằng chứng đã che thông tin nhạy cảm.
Không mở toàn bộ Backend, dashboard DB hoặc cổng PostgreSQL ra Internet.
