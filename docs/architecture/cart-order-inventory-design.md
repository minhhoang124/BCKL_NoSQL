# Thiết kế Cart, Order và Inventory

Tài liệu này là cầu nối giữa SRS v3.1 và migration nền móng Cart–Order–Inventory. Trạng thái hiện tại là **IN_PROGRESS**: schema/migration không đồng nghĩa API hoặc giao diện đã hoàn thành.

## 1. Kết quả rà soát SRS trước khi thiết kế

Các yêu cầu trong `docs/analysis/hien/srs-v3.md` phù hợp với nghiệp vụ sàn nhiều người bán và được giữ nguyên:

- Giỏ hàng tham chiếu `ProductVariant`; giỏ không giữ tồn kho và không cam kết giá.
- Checkout kiểm tra lại Product, Variant, Store, giá và tồn kho bằng dữ liệu PostgreSQL.
- Một checkout nhiều Store tạo một Order độc lập cho mỗi Store trong cùng transaction.
- Order và OrderItem lưu snapshot bất biến; không tính lại đơn cũ từ dữ liệu Product hiện tại.
- Tồn kho bị trừ trong transaction checkout. Hủy hợp lệ hoàn kho đúng một lần.
- Trạng thái Payment tách khỏi trạng thái fulfillment của Order.
- Chuyển trạng thái Order bằng command hợp lệ và luôn có history, không cho client PATCH enum tùy ý.
- Request checkout lặp phải idempotent; hai người mua cạnh tranh SKU cuối cùng chỉ một người thành công.

Các điểm được làm rõ để code không phải suy đoán:

| Điểm | Quyết định thiết kế |
|---|---|
| Tiền VND | ProductVariant và snapshot cùng dùng `DECIMAL(14,2)` để sao chép không làm tròn; check constraint bắt buộc phần thập phân bằng 0 nên đơn vị nghiệp vụ vẫn là nguyên đồng, không dùng số thực nhị phân |
| Chống checkout lặp | `Checkout` unique theo `(buyerId, idempotencyKey)` và lưu `requestHash`; cùng key khác payload là conflict |
| Tách nhiều Store | Các Order cùng tham chiếu một Checkout; toàn bộ nhóm được tạo hoặc rollback cùng nhau |
| Giá trị lịch sử | OrderItem snapshot tên, SKU, option, đơn giá, số lượng và thành tiền |
| Địa chỉ lịch sử | Order lưu các cột snapshot; thay đổi/xóa `UserAddress` không sửa đơn cũ |
| Chống âm kho | API phải cập nhật Variant có điều kiện `stock >= quantity` trong cùng transaction; check constraint tiếp tục chặn stock âm |
| Hoàn kho một lần | `StockMovement` unique theo `(orderItemId, type)` và có `idempotencyKey` unique; movement giao dịch bắt buộc có OrderItem cùng Variant, còn điều chỉnh thủ công không gắn OrderItem |
| Thanh toán | Migration tạo nền `Payment` dùng chung và COD. PaymentAttempt/callback VNPay–MoMo thuộc PR P1 riêng |
| Xóa dữ liệu | Order, OrderItem, Payment, history và stock ledger dùng `RESTRICT`; dữ liệu giao dịch không cascade theo Product/Variant |

## 2. Mô hình và trách nhiệm

```text
User ── UserAddress[]
  └── Cart (một User một Cart)
      └── CartItem[] ── ProductVariant

User ── Checkout[] (idempotency boundary)
  └── Order[] (một Store mỗi Order)
      ├── OrderItem[] (snapshot bất biến)
      ├── Payment (một payment logic mỗi Order)
      └── OrderStatusHistory[]

ProductVariant
  └── StockMovement[] (ledger tăng/giảm có truy vết)
```

### UserAddress

Là sổ địa chỉ có ownership theo User. Database bảo đảm tối đa một địa chỉ mặc định bằng partial unique index. Backend vẫn phải kiểm tra nội dung, số điện thoại và địa chỉ thuộc người checkout.

### Cart và CartItem

`CartItem` unique theo `(cartId, variantId)` và quantity phải lớn hơn 0. Cart không giữ giá snapshot và không giữ kho. Khi hiển thị hoặc checkout, Backend phải đọc lại Variant và Product.

### Checkout

Checkout là ranh giới chống double-click/network retry. `requestHash` được tạo từ payload chuẩn hóa gồm danh sách cart item/quantity, address và payment method. Record `COMPLETED` trả lại nhóm Order cũ; cùng key nhưng hash khác bị từ chối.

Database dùng composite foreign key `(checkoutId, buyerId)` để một Order không thể mượn Checkout của người mua khác, kể cả khi service có lỗi.

### Order và OrderItem

Mỗi Order thuộc đúng một Store, nhưng nhiều Order có thể thuộc cùng Checkout. `OrderItem` giữ foreign key để truy vết đồng thời giữ snapshot để lịch sử không phụ thuộc listing hiện hành. Các tổng tiền có check constraint và do Backend tính.

### Payment

Mỗi Order có tối đa một Payment logic. COD bắt đầu `UNPAID` và chỉ chuyển `PAID` khi giao thành công. Enum đã chừa provider sandbox nhưng lịch sử attempt, chữ ký callback và đối soát sẽ nằm trong migration P1 riêng.

### StockMovement

Đây là sổ biến động kho, không thay thế `ProductVariant.stock`. Mỗi transaction vừa cập nhật stock hiện hành vừa ghi movement với `balanceAfter`. Checkout dùng delta âm; cancel/return đủ điều kiện dùng delta dương. Composite foreign key `(orderItemId, variantId)` chặn movement gắn OrderItem của Variant khác. Unique key bảo vệ request lặp.

## 3. Transaction checkout bắt buộc

```text
Xác thực actor, address và Idempotency-Key
→ chuẩn hóa request và tính requestHash
→ trong transaction:
   tạo/đọc Checkout và kiểm tra hash
   đọc lại Product/Variant/Store canonical
   chặn mua Store của chính mình
   kiểm tra public, giá và quantity
   cập nhật stock có điều kiện stock >= quantity
   nhóm item theo Store
   tạo Order + OrderItem snapshot + Payment COD
   ghi StockMovement cho từng OrderItem
   ghi OrderStatusHistory ban đầu
   đánh dấu Checkout COMPLETED
   xóa đúng CartItem đã mua
→ commit
→ phát notification sau commit
```

Không gọi dịch vụ thanh toán, vận chuyển hoặc notification bên trong transaction database.

## 4. Vòng đời Order

Luồng chính:

```text
PENDING_CONFIRMATION → CONFIRMED → PACKING → READY_TO_SHIP
→ SHIPPING → DELIVERED → COMPLETED
```

Nhánh kết thúc: `CANCELLED`, `DELIVERY_FAILED`. Actor, điều kiện chuyển và quy tắc COD tuân theo FR-ORD-01/FR-CAN-01 của SRS. Migration chỉ tạo enum/history; service tiếp theo phải triển khai state machine và E2E.

## 5. Phạm vi migration này và phần chưa làm

Migration này gồm Address, Cart, Checkout, Order snapshot, Payment nền, Order history và StockMovement. Chưa được báo cáo là chức năng hoàn thành vì còn thiếu:

1. Cart/Address/Checkout/Order API và Swagger.
2. Transaction cạnh tranh tồn kho và state machine service.
3. Seller/User/Admin authorization và multi-role target.
4. Notification sau commit.
5. Shipment/re-delivery mô phỏng.
6. PaymentAttempt và callback sandbox P1.
7. Return/refund/revenue adjustment P1.
8. Frontend và E2E end-to-end.

## 6. Kế hoạch PR tiếp theo

1. Schema, migration, constraint và migration test (PR hiện tại).
2. UserAddress + Cart API, ownership và E2E.
3. Checkout transaction + COD + cạnh tranh kho + idempotency E2E.
4. Order command/state machine cho User/Seller và history E2E.
5. Shipment mô phỏng, notification và giao diện.
6. Payment sandbox P1 sau khi COD ổn định.
