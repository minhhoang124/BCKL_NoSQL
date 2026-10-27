# VNPay sandbox runtime — thiết kế triển khai

Base `ebf6a87` (#129), phạm vi P1 `SCOPE-PAYMENT-001`. Chưa nghiệm thu live
VNPay khi chưa có bằng chứng IPN và trình duyệt. Không tiền thật, không
provider refund thật, không ví Seller; hậu mãi vẫn ghi bút toán mô phỏng.

## Luồng và ranh giới

1. Checkout chọn COD hoặc VNPAY sandbox khi cờ bật. Cùng transaction kiểm giá,
   quyền/Store/variant, snapshot Order, trừ kho và Search outbox như COD.
   Một Order theo Store, mỗi Order có Payment riêng. Receipt ban đầu bất biến
   giữ provider đã chọn và UNPAID; không viết lại khi thanh toán thay đổi.
   COD giữ hash/receipt v1; VNPay dùng hash/receipt v2 và phải khớp provider
   yêu cầu gốc. Replay đã commit vẫn đọc được khi tắt cờ tạo giao dịch mới.
2. Chủ đơn chủ động tạo phiên VNPay. Server lấy amount/currency từ Order và
   Payment, không nhận amount/URL/merchant từ client. `PaymentTransaction`
   unique paymentId là định danh bền: một phiên duy nhất cho mỗi Order trong
   lát cắt này. Bấm lại hoặc mất phản hồi trả đúng phiên cũ, không sinh mã mới.
3. Mỗi phiên có ref ngẫu nhiên 32 ký tự, merchant/config snapshot không có
   secret, số tiền, IP, return URL cố định và hạn 15 phút theo DB. SDK vnpay
   2.5.0 chỉ chạy Backend, tắt log; tạo chữ ký tại server.
4. IPN public GET: từ chối query trùng/mảng/không hợp lệ, kiểm HMAC trước DB,
   đối chiếu merchant/ref/số tiền VND chính xác, response code VÀ transaction
   status. Khóa Order -> Payment -> PaymentTransaction; ledger notification
   append-only và state/Payment ghi nguyên tử. Chỉ cả hai mã 00 mới là thành
   công sạch; 07/giao dịch đảo hoặc thông tin mâu thuẫn cần đối chiếu.
5. Return URL kiểm chữ ký rồi chỉ chuyển về màn đơn hàng để GET trạng thái
   canonical. Không cập nhật Payment, Order, kho hoặc tin kết quả ở trình duyệt.
6. Seller chỉ xử lý Order online đã PAID theo guard hiện có. Buyer hoàn tất
   dùng trạng thái PAID hiện có, không đổi quy tắc COD.

## Thất bại, hủy, hết hạn và cạnh tranh

- IPN thất bại/hủy chỉ đổi Payment/transaction; không hủy Order hoặc hoàn kho.
- Phiên hết 15 phút không cấp URL mới, hiển thị EXPIRED theo DB clock. Chưa
  có retry nhiều phiên cho một Order và chưa tự hủy Order theo thời gian;
  người dùng có thể chủ động hủy đơn chưa thu tiền rồi đặt lại.
- Mở rộng hủy Order hiện có cho VNPAY chưa PAID và không REVIEW_REQUIRED:
  cùng khóa Order/Payment, stock movement/idempotency/reason/history như COD.
  Receipt mới nhận provider VNPAY; receipt COD và hash cũ giữ nguyên bytes.
- Hủy Order trước rồi IPN success đến muộn: không sống lại Order/không trừ
  kho lại. Lưu bằng chứng transaction REVIEW_REQUIRED và hiển thị cần đối
  chiếu; không tự hoàn tiền thật hoặc báo đã hoàn tiền.
- IPN success đến trước: Payment PAID và hủy đơn bị chặn. Callback lặp không
  ghi PAID/kho/history hai lần. Hai ref/Order không được dùng chung mã giao
  dịch thành công của provider.
- Success sau một kết quả terminal trái ngược hoặc ngoài hạn thanh toán:
  REVIEW_REQUIRED, giữ trạng thái nghiệp vụ an toàn và bằng chứng. Không bỏ
  qua thông báo chỉ vì Order đã đóng hay phiên hết hạn.
  Payment cũng chuyển REVIEW_REQUIRED để guard Seller không coi PAID cũ là
  còn đủ điều kiện xử lý; giữ paidAt trước đó làm bằng chứng nếu đã có.
  Hủy đơn chỉ khóa luồng local; không tuyên bố đã thu hồi URL tại VNPay.
- Lỗi DB/timeout trả lỗi IPN có thể retry; không trả ack thành công trước
  commit. Không log key, URL ký số, query thô hoặc thông tin thẻ/người trả.

## An toàn Web và vận hành

- Hai flag Backend/Web mặc định false, chỉ sandbox endpoint cố định. Secret
  nằm ngoài Git; dùng khóa tổng hợp cho test và Gemini chỉ đọc mã/design.
- Own read/status không tự tạo phiên. POST start phải confirmed=true; UI
  latch, epoch/actor/order identity, không tự retry 401/timeout, chỉ GET lại.
- URL trả về phải đúng HTTPS sandbox host/path/ref/merchant/amount. Không
  cho client quyết định ReturnUrl/IPN/amount; không lưu URL/key vào storage.
- Chưa expose API local ra Internet tự động. IPN từ server VNPay cần HTTPS
  công khai trỏ đúng QA riêng và được cấu hình trên merchant/SIT.
- Fresh + upgrade35→36, unit/HTTP/PostgreSQL thật, callback invalid/replay/
  race/rollback và Chrome phải có log trước khi coi hoàn thành. DB demo dừng,
  QA loopback5549, không dùng root `.env`.

## Bằng chứng QA ngày 27/10/2026

- Unit Backend: 1.675 PASS; Web: 1.638 PASS / 6 live SKIP.
- VNPay HTTP/PostgreSQL: 20 PASS, gồm hai app chạy đồng thời, callback lặp,
  cạnh tranh IPN–hủy đơn, rollback khi lỗi và callback đến muộn.
- Hồi quy Backend toàn bộ lượt đầu: 1.099 PASS, 2 FAIL, 1 SKIP, 20 TODO.
  Hai lỗi nằm ở fixture phiên bản hash chưa biết và enum Swagger COD cũ;
  sau cập nhật đúng contract v2, file Checkout được chạy lại: 41/41 PASS.
  Không gọi lượt full đầu là xanh toàn bộ.
- Lượt hồi quy Backend cuối sau sửa: 1.101 PASS / 1 SKIP / 20 TODO nền,
  66 file PASS / 2 file SKIP. Log điều phối `vnpay-full-e2e-r2-20261027.log`.
- Upgrade 35→36 trên QA v970: dữ liệu legacy COD/VNPAY/MOMO, Google/OTP,
  các bảng đối chiếu và checksum 35 migration trước giữ nguyên. Đây là
  kiểm nâng cấp fixture tổng hợp, không thay kiểm vòng đời đơn hàng.
- Gemini Argon Medium review thiết kế và mã: các finding thiết kế đã sửa;
  lượt rà mã chưa phát hiện P1/P2. Review tĩnh không thay runtime QA.
- Merchant mới đã mở được trang chọn phương thức thanh toán Test với URL
  ký số. Chưa hoàn tất thanh toán thật trên sandbox, chưa nhận IPN VNPay.
  Chưa có HTTPS QA; không công khai Backend bằng tunnel tự động.
- Chrome thật → Nest → PostgreSQL QA app-role: 5 nhóm PASS (Checkout Web,
  mất phản hồi sau commit/reload giữ phiên cũ, desktop/mobile, IPN giả lập
  lặp không ghi tiền/kho hai lần, URL ký số không nằm trong browser storage).
  Ảnh và report tại `artifacts/vnpay-browser-20261027/r1793116060821` trong
  workspace điều phối; không có thông tin merchant thật trong bộ fixture này.
