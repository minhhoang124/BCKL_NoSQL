# C4.1 — API giao hàng mô phỏng

**Cập nhật 15/10:** đã đồng bộ develop 2ed3ee5 sau merge #44, giữ API detail #42,
Seller preparation #43 và cancellation #44. Nội dung contract/production delivery
không đổi; cần Hiền re-review head tích hợp mới và CI. [Bằng chứng sync mới](../testing/pr46-post-pr44-integration-2026-10-15.md).
Trạng thái review/dependency trong các đoạn ngày 10/10 bên dưới là lịch sử.

Ngày 10/10/2026, branch `codex/order-delivery-commands` từ develop
`f267399` đã merge #45. IN_PROGRESS: code/test Backend riêng, chưa review/merge
hoặc nghiệm thu G-FULFILMENT/Web. Hoàng triển khai, Hiền review nghiệp vụ;
không thay contract AI và không cần Đạt duyệt shipping API.

## 1. Nguồn yêu cầu và phạm vi

- SRS v3.1: FR-ORD-01, FR-CAN-01, D07.
- [Contract chung](cart-order-inventory-api-contract.md), mục 7.1/7.2/8.1.
- [Nền DeliveryAttempt](../architecture/order-delivery-foundation.md), #45.

ADMIN còn hoạt động, JWT hợp lệ. Không mở các command này cho Seller/Buyer.
Admin được xử lý giao dịch đã tồn tại dù Store SUSPENDED hoặc account Seller khóa;
không nới quyền bán mới. Đây là mô phỏng thủ công, không callback hãng giao hàng,
không đối soát hoặc thu tiền thật.

| POST /admin/orders/:orderId/… | Body JSON strict | Trạng thái nguồn → đích |
|---|---|---|
| ship | trackingReference | READY_TO_SHIP → SHIPPING |
| delivery-failed | deliveryAttempt, trackingReference, reasonCode, reasonText | SHIPPING → DELIVERY_FAILED |
| retry-delivery | trackingReference | DELIVERY_FAILED → SHIPPING |
| mark-delivered | deliveryAttempt, trackingReference | SHIPPING → DELIVERED |

Không query, actor/status/timestamp trong body hoặc generic PATCH status.
Header `Idempotency-Key`: 16–128 ký tự ASCII chữ/số/_/-; orderId Int dương.
JSON tối đa 8 KiB sau giải nén, content-type application/json.
tracking trim 1–100, không control character; reasonText trim 1–500.
Failed reason: CUSTOMER_UNREACHABLE, ADDRESS_ISSUE, CUSTOMER_REFUSED, OTHER.
deliveryAttempt JSON integer 1..4 (không nhận chuỗi số).

## 2. Trường và luồng nguyên tử

- `currentDeliveryAttempt`: lần giao hiện hành. `retryCount`: số giao lại.
  Ship tạo 1/0; retry tăng đúng một, tối đa 4/3. Vận đơn được dùng lại.
- `requestHash`: SHA-256 canonical v1 từ scope/order/command/body chuẩn hóa,
  toàn bộ attempt/tracking/reason đều có trong hash; key không nằm trong hash.
- `OrderCommand`: receipt (kết quả lệnh đã lưu) bền vững PostgreSQL.
  Unique scope/key xuyên order/command, không TTL/xóa hoặc PROCESSING mồ côi.
- `DeliveryAttempt`: danh tính bất biến từng lần, không state machine thứ hai.
- `OrderStatusHistory`: một transition có commandId/ADMIN ID/time/attempt/tracking
  và reason nếu failed; không chỉnh history cũ khi replay.

Luồng: parser → JWT/current role → ingress quota → chuẩn hóa intent →
Serializable transaction (giao dịch cùng commit hoặc cùng hoàn tác).
Khóa PostgreSQL User → Store SHARE → Order UPDATE → Payment UPDATE;
đọc lại active/role của Admin, Order và attempt canonical. Replay được xử lý
trước state/attempt/Payment hiện hành, nhưng sau quyền hiện tại và Order tồn tại.
Lệnh mới kiểm tra nguồn, identity và Payment, tạo claim, ghi attempt/counter nếu
cần, Order/Payment/history, strict receipt và SUCCEEDED cùng transaction.

Kho, OrderItem/địa chỉ snapshot, Product.version/SearchOutbox **không đổi**.
Giao thất bại chưa chứng minh hàng quay về, nên không hoàn kho.
COD phải UNPAID/paidAt=null trước giao; delivered chuyển PAID/paidAt và đặt
Order.deliveredAt cùng transaction. Amount đúng Order.total, VND.
Sandbox VNPAY/MOMO đã PAID/paidAt có thể giao, giữ nguyên paidAt; không tự
tạo hoặc thu tiền. Payment thiếu/inconsistent bị chặn.
DELIVERED không phải COMPLETED; không tự ghi nhận doanh thu.

## 3. Replay, cạnh tranh và lỗi

Cùng scope/key/hash đã SUCCEEDED trả snapshot gốc, chỉ replayed đổi sang true.
Snapshot có thể cũ hơn Order; UI đọc GET để xem mới nhất sau khi detail API merge.
Khác payload/order/command dùng cùng key: 409 IDEMPOTENCY_CONFLICT.
Hai app cùng key chỉ một attempt/history/receipt; hai Admin cạnh tranh transition
đọc lại sau serialization retry. Khác key không được coi là replay từ state đích.

Callback attempt/tracking khác hiện hành: 409 STALE_DELIVERY_ATTEMPT, không ghi.
Legacy SHIPPING/FAILED không có identity: 409 DELIVERY_STATE_CONFLICT, không
đoán lần 1 hoặc tự tạo lại history. State khác nguồn: INVALID_ORDER_TRANSITION.
Retry sau 4 attempts: DELIVERY_ATTEMPT_LIMIT. Payment sai: PAYMENT_STATE_CONFLICT.
Đơn không tồn tại: 404 ORDER_NOT_FOUND. JSON/key/body/query lỗi: 400; body lớn413.

Retry transaction tối đa3, backoff 25/50ms+jitter, deadline22s; lock1s,
statement2s, transaction5s, pool wait2s mặc định. Hết giới hạn/lock wait:
409 ORDER_COMMAND_IN_PROGRESS, Retry-After:1; không success giả.
Quota20/request/Admin/phút/instance dùng chung bốn command và replay,
429+Retry-After; không phải quota chia sẻ nhiều replica.
Log chỉ actor/order/command/retry, không key/hash/PII; error500 trả thông tin an toàn.

## 4. Response v1 — đề nghị Hiền review

HTTP200 cả lần đầu/replay:

```json
{
  "orderId": 125,
  "commandId": 9,
  "command": "mark-delivered",
  "replayed": false,
  "result": {
    "status": "DELIVERED",
    "delivery": { "deliveryAttempt": 2, "retryCount": 1, "trackingReference": "DEMO-WAYBILL" },
    "deliveredAt": "2026-10-10T09:00:00.000Z",
    "payment": { "provider": "COD", "status": "PAID", "amount": "10000.00", "currency": "VND", "paidAt": "2026-10-10T09:00:00.000Z" },
    "cancellation": null,
    "timeline": [{
      "fromStatus": "SHIPPING", "toStatus": "DELIVERED",
      "actorType": "ADMIN", "actorId": 7,
      "createdAt": "2026-10-10T09:00:00.001Z",
      "deliveryAttempt": 2, "trackingReference": "DEMO-WAYBILL",
      "reasonCode": null, "reasonText": null
    }]
  }
}
```

Timeline receipt chỉ transition của lệnh, không toàn lịch sử. Admin được xem actor
ID phục vụ audit; không có địa chỉ/người mua/key/hash. Amount decimal string,
strict allowlist trên cả lần ghi và replay; receipt hỏng trả500, không tự dựng
từ Order hiện tại. deliveredAt null cho ba command chưa delivered.

## 5. Phần tiếp theo chưa triển khai

- confirm-returned: hàng quay về, restockable, ledger/version/outbox đúng một lần.
- Buyer complete, job SYSTEM sau3ngày, notification và shipping/Admin/Buyer UI.
- Luồng Backend Checkout → Seller command (#43) → delivery → detail (#42) đã
  chạy qua HTTP/PostgreSQL trên bản kết hợp sau #44; kiểm cả Seller cancel
  cạnh tranh ship trên READY_TO_SHIP bị chặn, không hoàn kho. Còn phải nghiệm
  thu browser/Order UI, #47/#48 và Search xuyên dịch vụ; fixture đơn lẻ không
  thay bằng chứng các luồng đó.
- [Kết quả kiểm thử](../testing/order-delivery-command-verification.md).
