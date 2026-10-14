# Seller xác nhận và chuẩn bị đơn — C2

Ngày 10/10/2026. **IN_PROGRESS**, dựa trên SRS FR-ORD-01/UC-HT07 và
[contract mục 7.1](cart-order-inventory-api-contract.md). Không đổi schema, Auth,
FastAPI hoặc contract vận chuyển. Chi tiết đơn #42 đang review riêng; C2 không
phụ thuộc mapper của #42.

| POST path | Trạng thái nguồn → đích |
|---|---|
| `/seller/orders/:orderId/confirm` | PENDING_CONFIRMATION → CONFIRMED |
| `/seller/orders/:orderId/start-packing` | CONFIRMED → PACKING |
| `/seller/orders/:orderId/ready-to-ship` | PACKING → READY_TO_SHIP |

JWT SELLER active, Order thuộc Store của actor; sai chủ/không tồn tại cùng
404 ORDER_NOT_FOUND. Body bắt buộc JSON `{}`, không query/trường thừa.
`Idempotency-Key` ASCII 16–128 ký tự theo contract, không đổi khi gửi lại.
Ingress tối đa 20/phút/actor/instance (gồm replay), cấu hình được; quota không
thay khóa database và chưa dùng chung nhiều replica. Body tối đa 8 KiB sau
giải nén, 413 REQUEST_TOO_LARGE; JSON/content-type sai trả 400 an toàn.

**Hoàng xác nhận trong chat ngày 10/10:** Store ACTIVE hoặc SUSPENDED cho phép
Seller active xử lý Order cũ; không mở bán/checkout mới. Các trạng thái Store
khác bị chặn 409 STORE_STATE_CONFLICT. Đây là cụ thể hóa UC-HT07 cần Hiền review
trên PR, không mở quyền cho account khóa hoặc Store người khác.

Payment phải tồn tại, currency VND, amount đúng total snapshot nguyên đồng:
COD UNPAID và paidAt null, hoặc VNPAY/MOMO PAID có paidAt hợp lệ. Kiểm tra cả
ba transition, không tạo/sửa Payment khi dữ liệu thiếu hoặc sai; trả
409 PAYMENT_STATE_CONFLICT. Fixture PAID chỉ kiểm policy, chưa chứng minh
cổng thanh toán sandbox đã tích hợp.

HTTP 200 cả lần đầu/replay, Cache-Control:no-store:

```json
{
  "orderId": 101,
  "commandId": 201,
  "command": "confirm",
  "replayed": false,
  "result": {
    "status": "CONFIRMED",
    "payment": { "provider": "COD", "status": "UNPAID", "amount": "10000.00", "currency": "VND", "paidAt": null },
    "cancellation": null,
    "timeline": [{ "fromStatus": "PENDING_CONFIRMATION", "toStatus": "CONFIRMED", "actorType": "SELLER", "actorId": 8, "createdAt": "2026-10-10T07:00:00.000Z" }]
  }
}
```

`resultSnapshot` chỉ giữ result này: timeline chứa **transition của command
đó**, không phải toàn bộ lịch sử đơn; GET detail phục vụ theo dõi state mới.
`commandId` là mã biên nhận lệnh theo contract 7.1, không phải idempotency key.
Không lưu/hiển thị địa chỉ, token, hash/key hoặc dữ liệu tài khoản trong receipt.
Hash v1 cũng định nghĩa receipt C2 v1; phiên bản lạ/receipt sai shape không được
dựng lại từ Order: 500 INTERNAL_ERROR an toàn. Kiểm strict allowlist khi lưu
và khi replay, identity/hash/actor phải khớp.

Transaction Serializable: khóa User → Store → Order → Payment trong PostgreSQL,
kiểm account/ownership hiện hành → tra receipt theo USER:id/key **trước policy
transition/Payment** → cùng hash trả receipt gốc → lệnh mới kiểm canonical
state/Payment → claim PROCESSING → update Order có điều kiện + một history typed
SELLER + receipt SUCCEEDED → commit. Không commit PROCESSING riêng, không giữ
khóa bằng memory. Store bị khóa sau checkout vẫn xử lý được theo quy tắc trên.

Cùng key khác order/command/hash trả 409 IDEMPOTENCY_CONFLICT; key mới ở state
không hợp lệ trả 409 INVALID_ORDER_TRANSITION. Retry tối đa 3 attempts với
backoff cho serialization/deadlock; unique scope/key conflict được retry đúng
constraint, không coi mọi P2002 là replay. Statement 2s, lock 1s, transaction
5s, pool wait 2s, deadline tổng 22s mặc định; hết chờ/retry trả
409 ORDER_COMMAND_IN_PROGRESS + Retry-After:1, client giữ key/body.

Order/history/receipt rollback cùng nhau khi lỗi. Mất response sau commit:
gửi lại key cũ, trả snapshot gốc ngay cả khi Order đã sang bước khác; chỉ
`replayed` đổi true. Account/ownership vẫn được kiểm trước replay. Không đổi
snapshot hàng/địa chỉ/tiền, Payment, stock/movement, Product.version/outbox.
Không phát notification hoặc gọi dịch vụ ngoài trong transaction; notification,
hủy/hoàn kho, delivery và UI là PR tiếp theo, G-FULFILMENT chưa DONE.

## Chạy và kiểm chứng

Các route đã đăng ký trong OrderModule và Swagger tag `seller-order-commands`.
Parser riêng đặt trước parser Checkout/default, không đổi limit của Checkout.
Xem [kết quả và hướng chạy lại](../testing/seller-order-command-api-verification.md).
Log commit/conflict chỉ có actorId/orderId/command/replayed/attempt; không log
body, key, token hoặc địa chỉ. 500 do lỗi database trả thông báo an toàn.

**Điểm cần Hiền review:** quyền Store SUSPENDED theo Hoàng đã chốt; timeline
receipt C2 chỉ một transition thay vì toàn lịch sử; quota 20/phút/actor/instance.
Đây chưa phải approval của reviewer hoặc nghiệm thu gate toàn luồng.
