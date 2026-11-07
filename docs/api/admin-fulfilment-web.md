# Admin giao hàng mô phỏng

Route Web: `/admin/fulfilment`, trong shell Admin hiện hành. Chỉ Admin đang
hoạt động được truy cập. Đây là thao tác mô phỏng cho khóa luận, không gọi
hãng vận chuyển hoặc thu tiền thật.

## Đọc dữ liệu vận hành

- `GET /admin/fulfilment/orders`: tối đa20 đơn gần nhất theo ID giảm dần ở
  READY_TO_SHIP/SHIPPING/DELIVERY_FAILED. Danh sách là snapshot lúc mở màn hình.
- `GET /admin/fulfilment/orders/:orderId`: đọc trạng thái hiện hành của một đơn.
- Không nhận query hoặc GET body. ID canonical Int dương; lỗi400,401,403,404,
  quota429 hoặc lỗi đọc/khóa503 an toàn. Cả hai trả `Cache-Control:no-store`.
- JWT/role guard và quota đọc hiện có; transaction khóa SHARE actor và kiểm
  lại active/role/credentialVersion, lock1s/statement2s/transaction4s.

Projection chỉ gồm `id,orderNumber,status,total,currentDeliveryAttempt,
retryCount,currentAttempt:{trackingReference}|null,payment`. Payment chỉ có
provider/status/amount/currency. Total và amount là chuỗi Decimal hai chữ số
thập phân. Không trả Buyer ID, địa chỉ, điện thoại, lý do, command key/hash
hoặc dữ liệu tài khoản. Schema và migrations không đổi.

## Thao tác

Web dùng các POST đã có tại `/admin/orders/:orderId/`:

|Trạng thái|Lệnh|
|---|---|
|READY_TO_SHIP|ship|
|SHIPPING|delivery-failed hoặc mark-delivered|
|DELIVERY_FAILED|retry-delivery nếu chưa đủ4lần;confirm-returned với COD|

`confirm-returned` phân biệt hàng đủ điều kiện nhập kho, hỏng hoặc thất lạc.
Chỉ hàng thực sự nhận lại và đủ điều kiện mới tăng kho. Backend vẫn kiểm
toàn bộ quyền, tiền, identity lần giao, trạng thái, ledger và idempotency.
Không có generic PATCH status hoặc chỉnh Payment/stock trực tiếp từ Web.

## Xác nhận và phục hồi

Mỗi thao tác cần checkbox xác nhận riêng. Latch đồng bộ chặn cùng tick;
session/unmount/generation fence chặn kết quả của phiên hoặc đơn cũ.
Tải đơn khác xóa lý do/biên nhận và consent của đơn trước.

Trước POST, sessionStorage lưu duy nhất actorId/orderId/command/key/bodyHash.
Không lưu payload, vận đơn, reasonText hoặc biên nhận vào journal. Không tự
POST khi mount, reload, timeout hoặc401; mỗi lần gửi lại cần thao tác chủ động.
Hash buộc nội dung gửi lại đúng intent cũ, cùng idempotency key.

Chỉ biên nhận đã kiểm đúng order/actor/command mới kết thúc intent; GET đơn
không thay biên nhận. Phiên cũ trả thành công hoặc thất bại muộn đều không
được sửa journal của phiên mới. Sau thành công, người dùng tải lại trạng thái
canonical trước bước kế tiếp. Danh sách ban đầu không tự nhận là dữ liệu live.

Journal hỏng hoặc không thể lưu phải chặn ghi. Request chưa rõ kết quả vẫn
giữ pending khi replay nhận409/429. Nếu quên nội dung cũ sau reload, cần người
vận hành đối chiếu biên nhận bền; không xóa key để gửi lệnh mới hoặc dùng trạng
thái Order làm bằng chứng intent đã xong. Chưa có endpoint đóng intent Admin.

Journal theo tab; không tuyên bố khóa toàn bộ tab/instance. Receipt và các
ràng buộc PostgreSQL là biên an toàn cuối. Các đơn fixture hoặc giới hạn quota
tăng riêng của driver QA không dùng để kết luận tải hoặc cấu hình production.
