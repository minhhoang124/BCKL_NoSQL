# C4.0 — nền danh tính lần giao hàng mô phỏng

Ngày: 10/10/2026. Nền: develop `27e083b` (#38 đã merge).
**CURRENT ở nền database** sau người dùng merge #45 ngày10/10 tại develop f267399:
Hiền APPROVED head60248ef, CI xanh. Schema/test foundation không phải nghiệm thu
giao hàng toàn luồng. API C4.1 đang ở [nhánh riêng](../api/order-delivery-command-contract.md).
Không phụ thuộc code chưa merge ở #42/#43/#44; không sửa contract FastAPI.

## 1. Yêu cầu dẫn đường

- [SRS v3.1](../analysis/hien/srs-v3.md): FR-ORD-01, FR-CAN-01, D07.
- [Contract đã merge #27](../api/cart-order-inventory-api-contract.md#81-vận-chuyển-mô-phỏng-theo-fr-ord-01): mục 7.1/7.2/8.1.
- [Phạm vi nghiệm thu](../project/implementation-scope.md): G-FULFILMENT.

Lần giao đầu là 1; cho **3 lần giao lại, tổng tối đa 4 lần**. Một hãng có thể
dùng cùng vận đơn khi giao lại, nên mã vận đơn không phải định danh duy nhất.
Thông báo thất bại của lần 1 đến sau khi đã bắt đầu lần 2 không được làm hỏng lần 2.

## 2. Trường dữ liệu và ý nghĩa

| Vị trí | Trường | Ý nghĩa |
|---|---|---|
| DeliveryAttempt | id | ID nội bộ của bản ghi, không thay cặp định danh nghiệp vụ |
| DeliveryAttempt | orderId | Đơn sở hữu lần giao; FK chỉ tới Order tồn tại |
| DeliveryAttempt | deliveryAttempt | Số lần giao 1..4; unique với orderId |
| DeliveryAttempt | trackingReference | Vận đơn mô phỏng, trim, 1..100 ký tự; được lặp giữa các lần/đơn |
| DeliveryAttempt | createdAt | Thời gian server tạo danh tính lần giao |
| Order | currentDeliveryAttempt | Lần giao hiện hành; null khi chưa có bằng chứng lần giao |
| Order | retryCount | Số lần giao lại, 0..3; bằng currentDeliveryAttempt − 1 |

Hai cột Order cùng null hoặc cùng có giá trị. Sau khởi tạo, bộ đếm chỉ đi lên
từng lần, không reset/giảm/nhảy số. Có FK ghép `(Order.id,currentDeliveryAttempt)`
→ `(DeliveryAttempt.orderId,deliveryAttempt)`: không lấy lần giao của đơn khác.
`NoAction` thay vì `SetNull` vì id của Order là cột dùng chung, không được làm null.
FK kiểm tra cuối transaction (giao dịch: cùng commit hoặc cùng hoàn tác).

DeliveryAttempt là **danh tính bất biến**, không thêm state machine thứ hai.
Kết quả giao/actor/reason nằm ở Order và OrderStatusHistory hiện có. Không sửa
id/order/number/tracking/time sau ghi; delete rồi insert lại để đổi tracking cũng
bị chặn nếu Order vẫn còn. Xóa cả fixture Order + attempts trong cùng transaction
được phép; đây không phải API xóa lịch sử đơn hàng.

Trigger tại cuối transaction kiểm tra đủ chuỗi 1..current, không có khoảng trống
hoặc bản ghi được thêm nhưng quên cập nhật Order. Hàm SQL dùng đúng schema nơi
trigger chạy, không rơi về bảng public khi test schema riêng.

## 3. Migration và legacy

Migration mới: `20261010100000_order_delivery_attempt_foundation` (expand-only).
Không đổi migration đã merge, trạng thái Order, snapshots, Payment, kho, ledger,
history hay receipt. Các đơn cũ nhận **null/null**, không suy diễn attempt từ
status SHIPPING hoặc từ số/tracking trong history. Đơn mới chưa ship cũng null/null.

API tương lai phải fail-closed với đơn đang SHIPPING/DELIVERY_FAILED nhưng thiếu
danh tính hiện hành; báo cần đối chiếu legacy, không nhận callback bằng tracking
đơn độc hoặc tự xem là lần 1. Không áp migration vào DB demo trong task này.

## 4. Đường runtime kế tiếp — chưa triển khai ở PR này

1. Admin `ship`: Order READY_TO_SHIP, claim OrderCommand dưới khóa DB; tạo attempt 1,
   đặt counter 1/0, SHIPPING/history/receipt cùng transaction.
2. `delivery-failed`/`mark-delivered`: xác thực actor, đọc lại Order hiện hành;
   kiểm tra **cả attempt và tracking**, không chỉ vận đơn. Mismatch trả
   STALE_DELIVERY_ATTEMPT, không mutation (thay đổi dữ liệu).
3. `retry-delivery`: chỉ DELIVERY_FAILED; đọc/khóa lại, thêm đúng attempt kế tiếp,
   counter +1, SHIPPING/history/receipt atomic. Tới 4 thì không giao lại nữa.
4. Replay (gửi lại đúng key/payload) trả receipt commit cũ sau kiểm tra quyền,
   trước so sánh attempt hiện hành; không tăng counter lần hai.
5. DELIVERED cập nhật COD PAID/paidAt cùng transaction; failure **không hoàn kho**.
   Confirm-returned mới xét hoàn kho khi hàng quay về/restockable. Buyer complete
   hoặc job SYSTEM sau hạn D07 là đợt riêng có test runtime thật.

Schema không tự kiểm tra actor/state/Payment/hash/history. Cần controller/service,
Serializable transaction + retry hữu hạn và kiểm thử API độc lập; constraint SQL
không thay chúng. Chưa chứng minh callback stale hoặc ship API qua HTTP.

## 5. Review và tích hợp

Hiền review schema/legacy, giới hạn 4, immutable tracking, state-machine một nguồn.
Sau merge foundation và #42/#43/#44, triển khai C4.1 ship/failed/retry/delivered;
C4.2 confirm-returned; C4.3 Buyer complete + job thật. Tích hợp lại luồng COD từ
Checkout → Seller → delivery → Buyer UI, không nghiệm thu chỉ bằng test schema.

Bằng chứng và giới hạn: [verification](../testing/order-delivery-foundation-verification.md).
