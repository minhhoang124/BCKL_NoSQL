# VNPay SIT mới và thanh toán NCB sandbox — 29/10/2026

## Kết luận theo bằng chứng

- Đăng nhập được portal mới `https://sandbox.vnpayment.vn/vsm-sit-client/` sau
  phản hồi hỗ trợ VNPay; không lưu mật khẩu SIT trong repo.
- Cấu hình callback HTTPS qua proxy chỉ cho GET IPN/return; Auth/Docs/read API
  bị404. URL tạm không phải triển khai public toàn website.
- Phiên SIT **#987 đạt6/6 ca tự động**, sau một bản sửa parser có regression.
- **Order3,20000VND**, đi hết NCB với thẻ/OTP test: nhận IPN thật, Payment
  **PAID**, PaymentTransaction **SUCCEEDED**, paidAt`2026-10-29T10:36:03Z`
  (17:36:03 Việt Nam). Return về Web hiển thị Đã thanh toán từ API.
- Đây là nghiệm thu kỹ thuật một phần trên sandbox, không giao dịch tiền thật,
  không phải biên bản QC đầy đủ hoặc production payment.

## Môi trường và phạm vi

Source nền candidate PR135`2079c54` + bản sửa parser TxnRef ghi trong cùngPR.
DB mới `bckl_order_resolution_test_vnpay_sit_20261029` tại127.0.0.1:5549,
39 migration, runtime`bckl_local_app` DML-only. Không đổi database demo hoặc
đơn VNPay cũ ở database khác. Catalog, actor và địa chỉ là fixture tổng hợp.
Backend3398, Web5198; HTTPS chỉ chuyển tiếp qua cổng lọc3399.

Tất cả merchant secret/credential nằm ngoài Git. Không đưa raw signature,
password, mã thẻ hoặc OTP vào báo cáo này; request debug được che chữ ký.

## Lỗi SIT phát hiện và cách sửa

Case4 gửi reference đã ký hợp lệ có hậu tố `_99999`. Parser cũ chỉ chấp nhận
32 ký tự hex của ID nội bộ nên trả97 trước khi kiểm chữ ký/tra giao dịch;
SIT yêu cầu01 cho reference không tồn tại. Tái hiện thật:5/6PASS, case4FAIL.

Parser mới nhận opaque reference ASCII `[A-Za-z0-9_-]`, dài1–100; vẫn chặn
query trùng, ký tự điều khiển, body/URL sai, giới hạn kích thước và tiền.
Service vẫn kiểm merchant/HMAC trước tra PostgreSQL. ID tạo mới nội bộ vẫn
là32hex; không sửa schema, migration hoặc mã tham chiếu giao dịch đã tồn tại.

Regression dùng HTTP/PostgreSQL trên DB QA hardening khác với DB SIT:
unknown reference có chữ ký sai→97; ký hợp lệ→01; Payment/notification/kho
không đổi. Unit bổ sung reference SIT hợp lệ và độ dài101 bị từ chối.

Kết quả cuối: **40 payment unit PASS,21 HTTP/DB PASS**, lint và BE build PASS.
Lượt đầu có regression đăng ký trùng:20PASS/2FAIL cho cùng lỗi97/01; sau sửa
có lượt22PASS nhưng gồm một test trùng. Đã bỏ đúng bản trùng, giữ assertion,
chạy lại21 ca độc lập PASS; không dùng22 làm số ca cuối. Log đỏ/xanh cũ giữ riêng.
Gemini Argon Medium review tĩnh xác nhận không thấy regression chữ ký/tiền/
thời gian và chỉ ra test trùng, đã xử lý; không gọi model review là human approval.

Không suy toàn bộ full E2E1201 trước sửa thành kết quả sau sửa. CI phải chạy
trên head mới của PR; các số trước vẫn là checkpoint lịch sử.

## Bộ test IPN của VNPay

|Case|Nội dung|Expected|Actual cuối|Kết quả|
|---|---|---|---|---|
|1|Thông báo thành công|00|00|PASS|
|2|Retry giao dịch đã ghi nhận|02|02|PASS|
|3|Thông báo thất bại|00|00|PASS|
|4|Reference không tồn tại|01|01|PASS sau sửa|
|5|Sai số tiền|04|04|PASS|
|6|Sai chữ ký|97|97|PASS|

Hai Order1/2 phục vụ SIT có các kết quả tài chính khác nhau: Order1 nhận
response24 và PaymentCANCELLED, OrderStatus vẫnPENDING_CONFIRMATION theo
contract; Order2 nhận thông báo00/00 nhưng PaymentREVIEW_REQUIRED vì PayDate
mẫu17:27:52 nằm sau expiry17:26:09. Không nới kiểm thời gian hoặc sửaDB thành
PAID để làm đẹp nghiệm thu. ACK00 nghĩa đã xử lý thông báo, không đồng nghĩa
mọi payload00 đều đủ điều kiện ghi PAID sạch.

SIT chỉ nhận danh sách giao dịch sau khi thẻ test đã đi tới OTP; mở trang chọn
phương thức đơn thuần chưa đủ. Lượt mở hai tab gateway đồng thời có lỗi phiên;
làm tuần tự đã vào đúng NCB/đơn. Không kết luận lỗi ứng dụng từ lượt nhiều tab đó.

## Giao dịch ngân hàng sandbox hoàn chỉnh, tách khỏi mẫu SIT

Tạo Order3 mới, một SKU số lượng1,20000VND; không dùng lại Order đangREVIEW.
Người dùng đã xác nhận điều khoản cho từng giao dịch ở thời điểm yêu cầu.
NCB xác thực bằng dữ liệu test chính thức; không dùng thẻ hoặc tiền thật.

|Bất biến kiểm DB|Kết quả|
|---|---|
|Payment.status / transaction.status|PAID / SUCCEEDED|
|paidAt / IPN receivedAt|17:36:03 /17:36:14 Việt Nam|
|Provider transaction number|Có, khác0; không ghi raw vào tài liệu|
|Notification của giao dịch|1, outcomeSUCCEEDED|
|Order.status|PENDING_CONFIRMATION, không tự giao/hoàn tất|
|Stock movement của Order3|1, quantityDelta=-1|
|Kho chung sau ba checkout|10→6 cho số lượng1+2+1; tổng3 movement|
|Callback/return|Không tạo thêm stock movement; return không ghi tài chính|
|Web sau redirect|Đúng /account/orders/3, hiển thị PAID và20000đ từAPI|

`real-bank-paid-proof.json` dùng assertion DB thực, không chỉ chụp trang VNPay
hoặc tin response00. Các ca cạnh tranh/chữ ký/replay khác còn có HTTP regression;
không gọi chúng là nhiều giao dịch ngân hàng thật đã thực hiện trong lượt này.

## Còn mở trước khi xuất biên bản hoặc lên online

- Tab QC thủ công yêu cầu ảnh return success/failure, xử lý99, whitelist IP và
  log. Chưa upload hồ sơ hoặc xác nhận toàn bộ các ô này, chưa xuất biên bản.
- Chưa có bằng chứng whitelist dải IP VNPay cho tunnel; HMAC không tự thay
  checkbox whitelist. Không đánh dấu Đạt chỉ để mở nút xuất báo cáo.
- Không lưu raw URL/query ký số vào log. Cần đối chiếu cách lưu audit đã che
  dữ liệu với yêu cầu QC; bảng notification hiện giữ metadata/digest, không tự
  gọi là full request logging đã nghiệm thu.
- Chưa chạy một luồng bank-cancel/failed return hoàn chỉnh mới để chụp ảnh
  thất bại của ứng dụng; callback failure qua SIT không tự thay bước đó.
- MoMo, email/Google, staging HTTPS/proxy, backup/restore/tải là gate riêng.
  Không biến kết quả này thành tám gate DONE hay chứng nhận thương mại.

## Artifact và nguồn

Ngoài Git: `machine-local/vnpay-sit-20261029` trong workspace điều phối:
boundary-results.json, url-diagnostics.json (không signature),
sit-987-results-redacted.txt, sit-987-six-passed.png,
real-ncb-paid-order-3.png, real-bank-paid-proof.json và checkpoint tiến trình.
Các file private không nằm trong gói nộp/PR. Screenshot chỉ chứa actor tổng hợp.

Nguồn quy trình: hướng dẫn và kết quả trực tiếp trong portal VNPay
`https://sandbox.vnpayment.vn/vsm-sit-client/guide`, phiên`/sessions/987`.
Portal yêu cầu đăng nhập; không giả đó là trang tài liệu công khai hoặc chứng
nhận đã được VNPay duyệt. Khi chạy lại phải kiểm tunnel hiện còn sống và cấu
hình đúng URL mới; không dùng lại URL tạm đã dừng.
