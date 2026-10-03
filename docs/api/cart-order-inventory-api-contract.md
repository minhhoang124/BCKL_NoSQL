# Cart–Order–Inventory API contract

Ngày: 03/10/2026. Trạng thái: **TARGET, bản sửa theo review PR #27; chờ xác nhận trước khi code API**.

Tài liệu này khóa contract nghiệp vụ cho Address, Cart, Checkout, Order, COD và Inventory của bản khóa luận. Contract dựa trên SRS v3.1 và schema/migration nền ở PR #26. Việc có schema hoặc tài liệu này **không đồng nghĩa chức năng đã hoàn thành**. Chỉ chuyển sang CURRENT sau khi PR #26 merge, API/Frontend/E2E chạy trên `develop` và release gate tương ứng đạt.

## 1. Nguyên tắc và phạm vi

- PostgreSQL là nguồn chuẩn cho Product, Variant, giá, tồn kho, Cart, Order và Payment.
- Cart luôn tham chiếu `variantId`; không giữ giá hoặc giữ chỗ tồn kho.
- Backend đọc lại trạng thái công khai, giá và tồn kho trong lúc checkout; không tin giá, Store hoặc tổng tiền từ client.
- Một lần checkout nhiều Store tạo một Order cho mỗi Store trong **cùng transaction**. Một Store lỗi làm toàn bộ checkout rollback.
- Order và OrderItem giữ snapshot bất biến. Sửa Product, Variant hoặc sổ địa chỉ sau đó không làm đổi đơn cũ.
- Tồn kho bị trừ cùng transaction tạo Order. Hủy hợp lệ hoàn kho đúng một lần.
- `OrderStatus` và `PaymentStatus` là hai vòng đời độc lập.
- Không có endpoint PATCH enum tổng quát. Mọi chuyển trạng thái đi qua command cụ thể của Backend.
- API tiền tệ trả chuỗi thập phân nguyên đồng, ví dụ `"1290000.00"`; không dùng số thực JavaScript để tính tiền.
- Một tài khoản hiện có một `Role`. API Buyer áp dụng cho `USER`, API Seller áp dụng cho `SELLER`, API quản trị áp dụng cho `ADMIN`. Multi-role/capability là migration riêng; contract sau này đổi guard chứ không đổi ownership của dữ liệu.

Ngoài phạm vi contract P0 này: voucher/flash sale, nhiều kho, phí vận chuyển thật, thanh toán production, tách shipment thật, hoàn tiền production và trả hàng nhiều cấp. VNPay/MoMo sandbox dùng chung Order/Payment nhưng được khóa trong contract P1 riêng.

Nguồn nghiệp vụ hiện hành là [SRS v3.1](../analysis/hien/srs-v3.md), mục 9–10 (FR-CAR-01, FR-CHK-01, FR-ORD-01, FR-CAN-01). Bản `system-analysis-v0.5.md` là nguồn lịch sử, không thay thế các actor đã chốt trong v3.1: Seller xác nhận/chuẩn bị; adapter vận chuyển mô phỏng hoặc Admin được cấp quyền cập nhật giao hàng; Buyer hoặc job theo D07 hoàn tất đơn. Bản sửa này đưa các lựa chọn kỹ thuật bên dưới ra review, không tuyên bố chúng đã có trong schema PR #26.

## 2. Quy ước HTTP chung

### 2.1 Xác thực, validation và kiểu dữ liệu

- JWT Bearer theo cơ chế Auth hiện tại.
- ID là số nguyên dương trong giới hạn PostgreSQL `Int`.
- Body thừa trường, sai kiểu hoặc chuỗi rỗng sau trim bị từ chối.
- Timestamp dùng ISO 8601 UTC.
- Dữ liệu danh sách Order dùng cursor; Address GET không phân trang theo mục 3, Cart GET trả toàn giỏ. Không trả `total` nếu chưa đếm chính xác.
- `Cache-Control: no-store` cho Cart, Checkout và Order.
- `Idempotency-Key` không phải token bảo mật; vẫn phải kiểm tra JWT và ownership.
- Header này bắt buộc ở checkout và tất cả Order command. Giá trị là ASCII `[A-Za-z0-9_-]`, dài 16–128 ký tự, phân biệt hoa/thường; thiếu/sai định dạng trả 400. Client giữ nguyên key khi retry một thao tác, dùng key mới cho thao tác mới.

### 2.2 Error envelope

API mới phải trả lỗi có cấu trúc ổn định:

```json
{
  "statusCode": 409,
  "code": "PRICE_CHANGED",
  "message": "Giá sản phẩm đã thay đổi. Vui lòng xác nhận lại.",
  "details": {
    "variantId": 125,
    "expectedUnitPrice": "1290000.00",
    "currentUnitPrice": "1390000.00"
  }
}
```

`details` là tùy chọn, không chứa stack trace, SQL, secret hoặc dữ liệu của người khác. Client xử lý theo `code`, không so sánh nguyên văn `message`.

### 2.3 Phân trang

Query chung: `limit` mặc định 20, tối đa 50; `afterId` là ID dương. Response:

```json
{
  "items": [],
  "nextCursor": 125
}
```

Danh sách Order sắp xếp `id DESC`; `afterId` lấy các ID nhỏ hơn cursor. Không dùng offset cho luồng có dữ liệu thay đổi liên tục.

## 3. UserAddress API

Base path: `/me/addresses`. Actor: Buyer sở hữu địa chỉ.

| Method/path | Mục đích |
|---|---|
| `GET /me/addresses` | Danh sách địa chỉ của chính User |
| `POST /me/addresses` | Tạo địa chỉ |
| `PATCH /me/addresses/:addressId` | Sửa trường được gửi |
| `PUT /me/addresses/:addressId/default` | Chọn một địa chỉ mặc định |
| `DELETE /me/addresses/:addressId` | Xóa địa chỉ khỏi sổ địa chỉ |

Request tạo/sửa:

```json
{
  "recipientName": "Nguyễn Văn A",
  "phone": "0901234567",
  "province": "Thành phố Hồ Chí Minh",
  "district": null,
  "ward": "Phường Bến Nghé",
  "addressLine": "12 Nguyễn Huệ",
  "postalCode": "700000",
  "deliveryNote": "Gọi trước khi giao",
  "isDefault": true
}
```

Quy tắc:

- Ownership luôn lấy từ JWT; client không gửi `userId`. Buyer dùng role USER và tài khoản active theo single-role hiện hành.
- Mô hình địa chỉ P0: province và ward bắt buộc; district optional/nullable để giữ địa chỉ cũ. Không yêu cầu User bịa quận/huyện. Trước Address API phải có migration mới đổi cả UserAddress.district và Order.districtSnapshot sang nullable, giữ nguyên giá trị cũ, không sửa migration #26. DTO/response luôn chấp nhận district:null; create bỏ district lưu null, PATCH bỏ field giữ nguyên.
- Chuỗi đều trim. recipientName 1–100; province/ward 1–100; district nếu có 1–100; addressLine 1–255; postalCode optional 1–20; deliveryNote optional 1–500. phone dài 8–20 ký tự và có 8–15 chữ số; chỉ chữ số ASCII, +, khoảng trắng, (, ), dấu chấm và gạch ngang; không khóa đầu số Việt Nam. Các giới hạn nằm trong DTO/config, có test biên.
- PATCH bỏ field giữ nguyên; null chỉ xóa district/postalCode/deliveryNote. Chuỗi rỗng/whitespace, null field bắt buộc hoặc body PATCH rỗng trả 400 VALIDATION_ERROR. PATCH hợp lệ đặt lại cùng giá trị được phép idempotent; không so sánh dữ liệu giống nhau rồi coi request là body rỗng.
- P0 lưu chuỗi địa danh đã trim, chưa thêm bảng/API địa giới hoặc danh mục hard-code.
- Tạo địa chỉ đầu tiên tự đặt mặc định, kể cả client gửi `false`.
- PATCH `isDefault=false` cho địa chỉ đang mặc định trả `409 DEFAULT_ADDRESS_CANNOT_BE_UNSET`; đổi mặc định bằng PUT default cho địa chỉ khác hoặc DELETE. Với địa chỉ không mặc định, false không đổi trạng thái.
- Tối đa 20 địa chỉ/User bằng cấu hình; vượt giới hạn trả `409 ADDRESS_LIMIT_REACHED`. GET trả `{items:[...]}`, không phân trang P0; sắp mặc định trước rồi `(createdAt DESC,id DESC)`.
- POST trả 201; GET/PATCH/PUT default trả 200; DELETE trả 204. Không tồn tại/không thuộc actor đều 404 ADDRESS_NOT_FOUND.
- Khi chọn địa chỉ mới làm mặc định, bỏ mặc định cũ trong cùng transaction.
- Xóa địa chỉ mặc định: nếu còn địa chỉ khác, chọn địa chỉ cũ nhất còn lại làm mặc định trong cùng transaction; nếu không còn thì cho phép không có mặc định.
- Xóa/sửa địa chỉ không thay đổi snapshot của Order đã tạo.
- Checkout chỉ nhận `addressId` thuộc Buyer và đọc lại địa chỉ trong transaction.

## 4. Cart API

Base path: `/cart`. Actor: Buyer.

| Method/path | Mục đích |
|---|---|
| `GET /cart` | Xem giỏ hiện hành, nhóm theo Store |
| `PUT /cart/items/:variantId` | Thêm Variant hoặc đặt **số lượng tuyệt đối** |
| `DELETE /cart/items/:variantId` | Xóa Variant khỏi giỏ |

Không tạo endpoint “tăng thêm N” trong MVP vì retry mạng có thể cộng số lượng hai lần. `PUT` cùng `variantId` và cùng quantity là idempotent.

Request:

```json
{
  "quantity": 2
}
```

Quy tắc ghi Cart:

- `quantity` là số nguyên 1–99, giới hạn tối đa đặt trong cấu hình.
- Variant phải tồn tại. Backend có thể cho giữ item vừa hết hàng trong giỏ, nhưng không cho thêm Variant đã bị xóa/vô hiệu hóa hoặc Product không còn hợp lệ để bán.
- PUT kiểm tra quantity không vượt stock hiện hành, chỉ khi Product/Variant đủ điều kiện bán. Đây là validation tại thời điểm ghi, **không giữ/trừ kho**; checkout vẫn đọc và cam kết kho lại trong transaction. Item đã unavailable chỉ được GET/DELETE; PUT chỉ được nhận khi điều kiện hợp lệ trở lại hoặc quantity giảm về mức hợp lệ.
- Buyer không được mua Variant thuộc Store của chính mình.
- Cart được tạo lười khi thêm item đầu tiên; mỗi User tối đa một Cart.

Response `GET /cart`:

```json
{
  "groups": [
    {
      "store": { "id": 8, "name": "BCKL Audio" },
      "items": [
        {
          "variantId": 125,
          "productId": 58,
          "productName": "Wireless Headphones",
          "imageUrl": "/uploads/products/58/primary.jpg",
          "optionValues": ["Black"],
          "quantity": 2,
          "currentUnitPrice": "1290000.00",
          "stock": 4,
          "available": true,
          "unavailableReason": null
        }
      ],
      "purchasableSubtotal": "2580000.00"
    }
  ],
  "unavailableItems": [],
  "lineCount": 1,
  "totalQuantity": 2,
  "purchasableSubtotal": "2580000.00"
}
```

`available=false` khi Product/Store/Variant không còn bán, tồn kho thiếu hoặc dữ liệu công khai không hợp lệ. Item vẫn được trả để UI cho User sửa/xóa; checkout phải từ chối item đó.

`lineCount` đếm mọi CartItem, `totalQuantity` cộng quantity mọi dòng; tổng subset được chọn do UI tính riêng. `purchasableSubtotal` ở nhóm và toàn giỏ chỉ cộng dòng available, dòng unavailable đóng góp 0; không phải tổng checkout đã cam kết.

Nếu Product/Store/Seller/Category/Brand không còn public, chỉ trả `variantId`, `quantity`, `available=false`, `unavailableReason="PRODUCT_UNAVAILABLE"`; không trả tên/ảnh/option/giá hoặc metadata draft. Các dòng này đặt ở `unavailableItems` cấp gốc, không lộ Store qua group; vẫn tính lineCount/totalQuantity. Nhóm Store chỉ chứa dòng có dữ liệu public được phép hiển thị. Response luôn có `unavailableItems: []` khi không có dòng loại này.

Ưu tiên reason: PRODUCT_UNAVAILABLE → VARIANT_UNAVAILABLE → OUT_OF_STOCK → INSUFFICIENT_STOCK. Với Product còn public, Variant không hợp lệ không được trả metadata riêng của Variant; chỉ dùng thông tin Product public được phép. Dòng public thiếu/hết kho có thể hiển thị giá hiện hành nhưng không cộng subtotal. Giá đổi không là unavailable reason; preview/checkout đối chiếu expectedUnitPrice và PRICE_CHANGED.

GET chưa có Cart trả groups/unavailableItems rỗng, lineCount/totalQuantity=0, purchasableSubtotal="0.00", không tạo row. DELETE item không tồn tại trả 204 idempotent. PUT thành công trả 200 với giỏ hiện hành; DELETE thành công không có body.

`unavailableItems` cấp gốc và PUT 200 trả toàn giỏ đã được Hiền xác nhận trong review 03/10; đây là contract được thống nhất, chưa phải API đã triển khai.

## 5. Checkout API và idempotency

### 5.1 Preview

`POST /checkout/preview`

Preview không giữ kho và không tạo Order. Request:

```json
{
  "addressId": 12,
  "paymentProvider": "COD",
  "items": [
    {
      "variantId": 125,
      "quantity": 2,
      "expectedUnitPrice": "1290000.00"
    }
  ]
}
```

Response nhóm theo Store, trả giá hiện hành, phí vận chuyển mô phỏng do Backend tính, tổng và các lỗi theo item. Preview thành công không bảo đảm checkout sau đó sẽ thành công; checkout luôn kiểm tra lại.

### 5.1.1 Quan hệ với giỏ hàng — P0 chỉ checkout từ Cart

- Cả preview và create chỉ nhận tập con các Variant đang có trong Cart của Buyer; `items[].quantity` phải **bằng** quantity của CartItem tương ứng, không tự chọn số khác trong payload.
- Dòng không có trong giỏ của chính Buyer: `404 CART_ITEM_NOT_FOUND`. Quantity lệch: `409 CART_CHANGED`; UI tải lại giỏ, sửa bằng Cart API rồi preview/xác nhận lại. Không đọc giỏ người khác để kiểm tra.
- Chỉ xóa các dòng được chọn sau khi tạo Order thành công, cùng transaction. Dòng chưa chọn giữ nguyên; rollback không xóa giỏ.
- P0 chưa hỗ trợ buy-now bỏ qua giỏ. Nút “Mua ngay” nếu có phải lưu số lượng qua Cart API rồi đi qua checkout như trên; API buy-now độc lập cần contract sau.
- Replay Checkout đã COMPLETED được nhận diện **trước** kiểm tra giỏ/địa chỉ hiện hành: giỏ đã xóa, địa chỉ sửa/xóa hoặc giá thay đổi không được làm mất khả năng nhận lại đơn cũ. Vẫn xác thực tài khoản và ownership, đối chiếu hash của request gốc.
- Checkout mới đọc Cart trong Serializable transaction. Hai key khác nhau cùng mua một dòng hoặc sửa Cart song song phải được tuần tự hóa: chỉ một checkout tiêu thụ dòng; request kia đọc lại sau retry và nhận lỗi giỏ nếu dòng đã bị mua/thay đổi. Không cho đủ stock trở thành lý do tạo hai đơn từ cùng dòng đã tiêu thụ.

### 5.2 Tạo checkout

`POST /checkouts`

Header bắt buộc:

```http
Idempotency-Key: 018f6c8c-ff08-7f41-a228-0f4a8e9c1240
```

Body có cùng shape với preview. `expectedUnitPrice` bắt buộc để User xác nhận giá đang thấy. Backend không dùng giá này để tính Order; chỉ đối chiếu với giá canonical.

Trong đợt P0, DTO chỉ chấp nhận `paymentProvider="COD"`. Các enum `VNPAY`/`MOMO` trong schema chỉ là nền cho P1; không được nhận request hai provider này trước khi có PaymentAttempt, chữ ký callback, timeout và E2E sandbox.

Response `201 Created` lần đầu hoặc `200 OK` khi replay đúng request đã hoàn tất:

```json
{
  "checkoutId": 42,
  "status": "COMPLETED",
  "replayed": false,
  "orders": [
    {
      "id": 101,
      "orderNumber": "ORD-20261001-000101",
      "storeId": 8,
      "status": "PENDING_CONFIRMATION",
      "payment": {
        "provider": "COD",
        "status": "UNPAID",
        "amount": "2580000.00",
        "currency": "VND"
      },
      "total": "2580000.00"
    }
  ]
}
```

### 5.3 Chuẩn hóa request và requestHash

`requestHash` được tạo phía Backend từ payload canonical:

1. Lấy `buyerId` từ JWT.
2. Chuẩn hóa `paymentProvider`, `addressId` và số lượng.
3. Sắp xếp item theo `variantId` tăng dần.
4. Không cho hai dòng cùng `variantId`.
5. Chuẩn hóa giá chuỗi về Decimal hai chữ số.
6. Serialize JSON theo một thuật toán ổn định rồi SHA-256.

Canonicalization v1: serialize UTF-8 JSON object với key sắp xếp đệ quy, không khoảng trắng; giữ thứ tự array sau khi sắp item; ID/quantity là integer, tiền là chuỗi Decimal hai chữ số. Hash gồm buyerId, addressId, paymentProvider và từng variantId/quantity/expectedUnitPrice đã chuẩn hóa; không gồm địa chỉ hiện hành, giá hiện hành hoặc Cart snapshot. Lưu requestHash và hashVersion=1; thay thuật toán phải có tương thích replay, không tính lại hash bản ghi cũ bằng thuật toán mới. `hashVersion` cần migration bổ sung trước code API, không sửa migration PR #26.

Không đưa timestamp, request ID hoặc thứ tự item ban đầu vào hash.

Semantics:

- Cùng Buyer + cùng key + cùng hash + Checkout COMPLETED: trả lại đúng nhóm Order cũ, không trừ kho hoặc ghi movement lần hai.
- Cùng Buyer + cùng key + khác hash: `409 IDEMPOTENCY_CONFLICT`.
- Hai request đồng thời cùng key: tối đa một transaction tạo dữ liệu; request còn lại reload kết quả hoặc trả `409 CHECKOUT_IN_PROGRESS` với `Retry-After` ngắn.
- Validation thất bại trước transaction không tạo Checkout.
- Transaction thất bại phải rollback Checkout, Order, Payment, movement và stock; client có thể retry cùng key.
- Không lưu `FAILED` rồi coi đó là Order thành công. Nếu sau này dùng trạng thái FAILED để vận hành, phải có lỗi bền vững và chính sách retry riêng.

### 5.4 Transaction checkout

Isolation: `Serializable`, kèm retry có giới hạn cho lỗi serialization/deadlock; đề xuất tối đa 3 lần với jitter. Mỗi lần retry đọc lại canonical state.

Trong một transaction:

1. Kiểm tra Buyer đang hoạt động; tính hash từ request đã validate.
2. Tạo/đọc Checkout theo `(buyerId,idempotencyKey)` và kiểm tra hash.
3. Nếu Checkout đã COMPLETED, trả nhóm Order cũ mà không kiểm tra lại Cart/giá/address. Nếu là checkout mới, kiểm tra address thuộc Buyer, từng Variant có trong Cart của Buyer và quantity khớp; đọc lại Variant → Product → Store và policy public.
4. Chặn self-purchase.
5. So sánh `expectedUnitPrice`; có thay đổi thì rollback với `PRICE_CHANGED`.
6. Cập nhật từng Variant bằng điều kiện `stock >= quantity`; số dòng cập nhật khác 1 là `INSUFFICIENT_STOCK`.
7. Nhóm item theo Store, tạo một Order/Store.
8. Tạo OrderItem snapshot và Payment COD.
9. Ghi `StockMovement(CHECKOUT_DECREMENT)` cho từng OrderItem.
10. Ghi history ban đầu `null → PENDING_CONFIRMATION`.
11. Đánh dấu Checkout COMPLETED.
12. Xóa đúng CartItem đã mua; CartItem khác giữ nguyên.

Khi stock thay đổi, gom các Product bị ảnh hưởng, đọc lại dữ liệu canonical và tăng Product.version + tạo đúng một SearchOutbox theo trạng thái public cuối trong cùng transaction. Đây là biến động kho do giao dịch, **không** phải Seller sửa nội dung nên không tự hạ Product APPROVED về DRAFT. Dùng cơ chế outbox hiện có; không đổi contract FastAPI. Hoàn kho do cancel cũng áp dụng quy tắc này; replay không tăng version/phát outbox lần hai.

Không gọi email, WebSocket, Search, payment provider hoặc shipping provider trong transaction. Notification được phát sau commit bằng cơ chế bền vững ở PR riêng.

## 6. Buyer Order API

| Method/path | Mục đích |
|---|---|
| `GET /orders?status=&limit=&afterId=` | Danh sách Order của Buyer |
| `GET /orders/:orderId` | Chi tiết và timeline của Buyer |
| `POST /orders/:orderId/cancel` | Buyer hủy Order đang chờ xác nhận |
| `POST /orders/:orderId/complete` | Buyer xác nhận đã nhận sau DELIVERED |

Request hủy:

```json
{
  "reasonCode": "CHANGED_MIND",
  "reasonText": "Không còn nhu cầu"
}
```

DTO và dữ liệu audit hủy được khóa tại mục 7.2: dùng các cột riêng trong migration mới, không serialize code/text vào chuỗi `cancellationReason` để làm nguồn chuẩn.

Buyer chỉ hủy `PENDING_CONFIRMATION`. Replay được nhận diện bằng OrderCommand/key/hash theo mục 7.1, không chỉ bằng trạng thái CANCELLED. Key mới khi đơn đã CANCELLED nhận `409 ORDER_CANNOT_CANCEL`, không tạo lịch sử hoặc hoàn kho thêm.

`POST /orders/:id/complete` chỉ cho phép `DELIVERED → COMPLETED`. COD phải đã `PAID` từ bước DELIVERED; nếu Payment chưa nhất quán, từ chối và không che lỗi bằng cách tự hoàn tất.

Theo FR-ORD-01/D07 của SRS v3.1, Buyer của Order xác nhận bằng command `complete` (body `{}` và Idempotency-Key). Job tự hoàn tất sau 3 ngày tính từ deliveredAt là đường runtime P0 cần triển khai/test: mỗi lượt đọc lại Order/Payment, chỉ chuyển khi vẫn DELIVERED và đã tới hạn. Job dùng OrderCommand với actor SYSTEM, key xác định từ orderId + deliveredAt + phiên bản rule D07, ghi history cùng transaction. Buyer và job cạnh tranh chỉ tạo một transition; bên còn lại bỏ qua có kiểm soát hoặc trả INVALID_ORDER_TRANSITION nếu là lệnh mới. Seller không có quyền complete. Hoàn tất đơn là mốc doanh thu; thanh toán PAID không tự ghi nhận doanh thu trước COMPLETED. Không tự chỉnh SRS hiện hành thành Seller complete để khớp bản v0.5.

## 7. Seller Order API và state machine

Seller chỉ truy cập Order thuộc Store của chính mình.

| Method/path | Chuyển trạng thái hoặc mục đích |
|---|---|
| `GET /seller/orders?status=&limit=&afterId=` | Danh sách theo Store |
| `GET /seller/orders/:orderId` | Chi tiết và timeline theo Store |
| `POST /seller/orders/:orderId/confirm` | `PENDING_CONFIRMATION → CONFIRMED` |
| `POST /seller/orders/:orderId/start-packing` | `CONFIRMED → PACKING` |
| `POST /seller/orders/:orderId/ready-to-ship` | `PACKING → READY_TO_SHIP` |
| `POST /seller/orders/:orderId/cancel` | `PENDING_CONFIRMATION/CONFIRMED → CANCELLED` |
| `POST /seller/orders/:orderId/confirm-returned` | `DELIVERY_FAILED → CANCELLED` khi đã nhận lại hàng; xác định có hoàn kho hay không |

Mọi command:

- Khóa/kiểm tra Order hiện hành trong transaction.
- Chỉ nhận trường nghiệp vụ cần thiết như reason, tracking reference mô phỏng hoặc `restockable`; không nhận `status` tùy ý.
- Ghi `OrderStatusHistory` cùng transaction.
- Nhận diện replay qua bản ghi OrderCommand ở mục 7.1; không suy ra “cùng command” chỉ từ trạng thái đích.
- Hai command cạnh tranh: chỉ một transition hợp lệ; command còn lại nhận 409 và phải reload.

### 7.1 Idempotency cho Order command — bản ghi bền vững

Trước khi code Đợt C, tạo migration mới bổ sung `OrderCommand`; không chỉ dùng cache/in-memory hoặc unique StockMovement. Bản ghi gồm id, orderId (FK RESTRICT), actorScope, actorType (`BUYER/SELLER/ADMIN/SYSTEM`), actorId nullable (SYSTEM không có User), idempotencyKey, command, requestHash, hashVersion, status (`PROCESSING/SUCCEEDED`), responseStatus, resultSnapshot JSON, createdAt/completedAt. Actor lấy từ JWT hoặc job tin cậy; scope là `USER:<userId>` hoặc `SYSTEM:ORDER_AUTO_COMPLETE`, không nhận từ body. Unique `(actorScope,idempotencyKey)` xuyên các command/order; hash gồm scope, orderId, command và toàn bộ DTO đã chuẩn hóa, kể cả reasonText, restockable, receiptReference và trackingReference. Migration phải ràng buộc receipt/history cùng Order bằng composite FK `(commandId,orderId)` và unique `(id,orderId)` ở OrderCommand; không cho history Order A gắn receipt Order B.

Hash theo canonicalization v1 tại mục 5.3: trim trường text theo DTO; giữ nguyên hoa/thường của nội dung có ý nghĩa; không bỏ các trường nghiệp vụ hoặc giá trị false/null để tránh cùng hash cho hai quyết định khác nhau. Reject extra fields trước hash. Cùng key dùng cho order/command khác cũng là IDEMPOTENCY_CONFLICT.

- Cùng scope + key + hash, bản ghi SUCCEEDED: xác thực lại role/ownership, trả HTTP 200 với `replayed:true` và **resultSnapshot của lần commit gốc**, không chạy transition/stock/Payment/history/outbox lần nữa. Snapshot có thể cũ hơn Order hiện tại; UI lấy GET Order nếu cần trạng thái mới nhất.
- Cùng scope + key nhưng khác hash: `409 IDEMPOTENCY_CONFLICT`, kể cả Order đang ở cùng trạng thái đích. Ví dụ đổi confirm-returned từ false sang true hoặc đổi reasonText phải bị chặn.
- Lệnh mới: trong Serializable transaction, claim unique OrderCommand, khóa/đọc Order hiện hành, kiểm tra quyền/state, ghi transition + Payment + movement + history + Product version/outbox nếu có, lưu resultSnapshot/status SUCCEEDED và completedAt rồi commit cùng nhau. PROCESSING chỉ tồn tại trong transaction chưa commit, không để lại job PROCESSING mồ côi.
- Hai request cùng key: unique database và retry có giới hạn bảo vệ trên nhiều process. Bên thua reload bản ghi đã commit hoặc trả `409 ORDER_COMMAND_IN_PROGRESS` + `Retry-After: 1` khi hết thời gian chờ. Không trả success nếu chưa có SUCCEEDED.
- Transaction/crash trước commit rollback toàn bộ, cả OrderCommand; retry cùng key có thể thực hiện lại. Crash/mất response sau commit trả snapshot gốc khi retry. Không commit command receipt trước mutation hoặc ngược lại.
- Khác key nhưng cùng/khác command vẫn kiểm tra trạng thái nguồn dưới khóa; đạt trạng thái đích không tự được coi là replay. Lỗi validation/authorization/state không lưu success receipt. P0 giữ receipt theo dữ liệu Order, không TTL/xóa tự động; nếu thêm retention sau này phải bảo vệ khỏi key tái sử dụng.

Response command chuẩn: `{orderId, commandId, command, replayed, result}`; result là allowlist trạng thái Order, Payment, cancellation và timeline tại thời điểm command commit, không chứa JWT, key/hash hoặc dữ liệu tài khoản ngoài phạm vi. Lần đầu và replay đều HTTP 200; chỉ trường replayed thay đổi. Không trả mã key/hash ra client.

### 7.2 DTO và audit có cấu trúc

Tất cả reasonCode/reasonText bắt buộc với các lệnh bên dưới; reasonText trim, dài 1–500 ký tự. Unknown reasonCode, extra field, restockable không phải boolean bị từ chối 400. Actor và timestamp do Backend lấy, không nhận từ client.

| Command | DTO bắt buộc | Reason code cho phép |
|---|---|---|
| Buyer cancel | reasonCode, reasonText | CHANGED_MIND, OTHER |
| Seller cancel | reasonCode, reasonText | OUT_OF_STOCK, CANNOT_FULFIL, OTHER |
| Admin/adapter delivery-failed | reasonCode, reasonText, trackingReference | CUSTOMER_UNREACHABLE, ADDRESS_ISSUE, CUSTOMER_REFUSED, OTHER |
| Seller confirm-returned | reasonCode, reasonText, restockable, receiptReference | RETURN_RECEIVED khi true; DAMAGED khi false |
| Admin confirm-returned | reasonCode, reasonText, restockable, receiptReference nếu hàng đã nhận | RETURN_RECEIVED khi true; DAMAGED hoặc LOST khi false |

trackingReference/receiptReference là chuỗi trim 1–100 ký tự. Receipt bắt buộc khi RETURN_RECEIVED hoặc DAMAGED; LOST chỉ Admin và receiptReference=null. Đây là đóng đơn giao thất bại theo quyết định Admin, không giả nhận hàng và không hoàn kho. Một P0 Order có một lần kết thúc này; hàng trả về một phần cần contract riêng, không tự hoàn toàn bộ kho.

Migration mới cho Đợt C bổ sung các cột canonical ở Order: `cancelledById` (nullable FK User), `cancelledByType`, `cancellationReasonCode`, `cancellationReasonText`, dùng `cancelledAt` đã có. Mọi CANCELLED phải có đủ actor/type, code, text và thời gian do server lưu; P0 cancel do người dùng/Admin nên cancelledById không null. Cột cancellationReason cũ không còn là nguồn audit; dữ liệu cũ không được tự đoán code/actor khi backfill. Nếu có Order cũ chưa đủ audit, phải báo/đánh dấu legacy trước chuyển sang ràng buộc bắt buộc.

OrderStatusHistory bổ sung `commandId` FK, actorType, reasonCode, reasonText, restockable?, receiptReference?, trackingReference?, deliveryAttempt?; actorId hiện có lấy từ JWT, nullable cho SYSTEM. Một transition một history/command bằng unique commandId (không áp dụng history khởi tạo checkout có commandId null). cancel, delivery-failed và confirm-returned lưu nguyên dữ liệu đã chuẩn hóa và thời gian cùng transaction. Không sửa reason của history cũ khi replay.

Order read trả `cancellation: null | {cancelledBy:{type,id}, reasonCode, reasonText, cancelledAt}`; timeline trả dữ liệu audit theo mục 9. Buyer được xem loại actor và reason/time của chính đơn, không lộ ID Seller/Admin hoặc thông tin riêng; Seller/Admin đúng quyền được xem actor ID phục vụ audit. resultSnapshot phải dùng cùng allowlist theo actor của command.

`restockable=false` vẫn kết thúc DELIVERY_FAILED → CANCELLED, Payment UNPAID → CANCELLED nhưng stock không đổi, không tạo CANCELLATION_RESTORE/RETURN_RESTORE và không tăng Product.version/outbox chỉ vì tồn kho. Không dùng replay với payload true để sửa quyết định đã commit.

Quy tắc COD:

- Tạo Order: `UNPAID`.
- `SHIPPING → DELIVERED`: chuyển Payment COD `UNPAID → PAID` và đặt `paidAt` trong cùng transaction với Order/history.
- `CANCELLED` trước thanh toán: Payment `UNPAID → CANCELLED`.
- Không tự đổi Order thành COMPLETED chỉ vì Payment PAID.

Hoàn kho:

- Buyer/Seller hủy trước giao: mỗi OrderItem tạo tối đa một `CANCELLATION_RESTORE`, tăng stock và ghi `balanceAfter` cùng transaction.
- `DELIVERY_FAILED` chưa tự hoàn kho vì hàng có thể đang ở đơn vị vận chuyển.
- `confirm-returned` chỉ hoàn kho khi `restockable=true`; vẫn phải chống lặp bằng unique movement/idempotency key.
- `RETURN_RESTORE` dành cho hậu mãi P1, không dùng thay cancellation movement.

## 8. Admin API và ma trận quyền

P0 đề xuất Admin có API đọc để hỗ trợ/audit:

- `GET /admin/orders?status=&storeId=&buyerId=&limit=&afterId=`
- `GET /admin/orders/:orderId`

Không tạo generic Admin PATCH status. Nếu cần can thiệp, phải mở command riêng có reason, policy, history và test; đây không phải đường tắt vượt state machine.

### 8.1 Vận chuyển mô phỏng theo FR-ORD-01

Không mở ship/mark-delivered/delivery-failed/retry-delivery cho Seller. P0 UI Admin hiển thị rõ **mô phỏng**, dùng guard ADMIN và từng command riêng:

| Method/path | Transition và DTO |
|---|---|
| `POST /admin/orders/:orderId/ship` | READY_TO_SHIP → SHIPPING; trackingReference |
| `POST /admin/orders/:orderId/mark-delivered` | SHIPPING → DELIVERED; deliveryAttempt và trackingReference phải khớp lần giao hiện hành |
| `POST /admin/orders/:orderId/delivery-failed` | SHIPPING → DELIVERY_FAILED; DTO tại mục 7.2 cộng deliveryAttempt và trackingReference, phải khớp lần giao hiện hành |
| `POST /admin/orders/:orderId/retry-delivery` | DELIVERY_FAILED → SHIPPING; trackingReference |
| `POST /admin/orders/:orderId/confirm-returned` | DELIVERY_FAILED → CANCELLED; DTO tại mục 7.2, chỉ quyền xử lý giao thất bại |

Adapter mô phỏng nội bộ gọi cùng service/state machine với actor được nhận diện từ cấu hình tin cậy, không nhận actor từ public body; chưa có callback hãng vận chuyển thật.

Đợt C bổ sung migration mới cho danh tính lần giao bền vững: DeliveryAttempt có unique `(orderId, deliveryAttempt)`, trackingReference bất biến từng lần; Order lưu lần hiện hành và retryCount. Lần ship đầu deliveryAttempt=1, retryCount=0. Mỗi transition retry thành công tăng cả hai một lần: retryCount tối đa 3, tổng tối đa 4 attempt, đúng FR-ORD-01/D07. Retry lần 3 được nhận, retry lần 4 trả 409 DELIVERY_ATTEMPT_LIMIT. Không yêu cầu trackingReference phải khác giữa các attempt: hãng vận chuyển có thể dùng cùng vận đơn. Danh tính authoritative là cặp orderId/deliveryAttempt, không chỉ tracking. Đây là thiết kế cần review, chưa có trong schema #26.

Cả delivered/failed yêu cầu deliveryAttempt integer và trackingReference khớp attempt hiện hành, kiểm tra cùng transaction OrderCommand/Order/Payment/history. Attempt cũ hoặc tracking không khớp trả 409 STALE_DELIVERY_ATTEMPT, không đổi Order/Payment/history/stock. Include hai field trong requestHash và history/receipt để audit. Replay đúng key/hash đã commit trả receipt cũ trước kiểm tra attempt hiện hành, không mutation lần hai; cùng payload với key mới vẫn bị kiểm tra stale. Hai command cạnh tranh phải đọc lại state/attempt sau retry. Retry cùng key không tăng số lần giao. Admin không có endpoint complete thay Buyer; chỉ job SYSTEM tới hạn D07 được tự complete.

| Nghiệp vụ | Buyer | Seller | Admin |
|---|---:|---:|---:|
| CRUD địa chỉ của chính mình | Có | Không với Role đơn hiện tại | Không sửa thay |
| Xem/sửa giỏ của chính mình | Có | Không | Không |
| Checkout | Có | Không | Không |
| Xem Order của Buyer | Chỉ Order của mình | Không | Có quyền đọc/audit |
| Xem Order của Store | Không | Chỉ Store của mình | Có quyền đọc/audit |
| Hủy trước xác nhận | Có | Có, bắt buộc lý do | Không qua generic status |
| Xác nhận/đóng gói/bàn giao ở READY_TO_SHIP | Không | Chỉ Store của mình | Không làm thay qua generic status |
| Cập nhật giao mô phỏng/thử giao lại | Không | Không | Có qua command mô phỏng riêng |
| Ghi nhận hàng giao thất bại đã trả/mất/hỏng | Không | Nhận lại hàng Store mình, không khai LOST | Có qua command riêng có reason |
| Xác nhận đã nhận/COMPLETED | Chỉ Buyer của Order; SYSTEM theo D07 | Không | Không |
| Điều chỉnh kho thủ công | Không | Chưa mở trong P0 | Chỉ command riêng có audit nếu triển khai |

Không trả password hash, refresh token, email/phone tài khoản không cần thiết, internal SKU ngoài đúng actor, idempotency key hoặc dữ liệu Order của actor khác.

## 9. Order response tối thiểu

```json
{
  "id": 101,
  "orderNumber": "ORD-20261001-000101",
  "status": "PENDING_CONFIRMATION",
  "store": { "id": 8, "name": "BCKL Audio" },
  "shippingAddress": {
    "recipientName": "Nguyễn Văn A",
    "phone": "0901234567",
    "province": "Thành phố Hồ Chí Minh",
    "district": null,
    "ward": "Phường Bến Nghé",
    "addressLine": "12 Nguyễn Huệ",
    "postalCode": "700000",
    "deliveryNote": "Gọi trước khi giao"
  },
  "items": [
    {
      "id": 501,
      "productId": 58,
      "variantId": 125,
      "productName": "Wireless Headphones",
      "sku": "BCKL-000125",
      "options": ["Black"],
      "unitPrice": "1290000.00",
      "quantity": 2,
      "lineTotal": "2580000.00"
    }
  ],
  "subtotal": "2580000.00",
  "shippingFee": "0.00",
  "discountTotal": "0.00",
  "total": "2580000.00",
  "payment": {
    "provider": "COD",
    "status": "UNPAID",
    "amount": "2580000.00",
    "currency": "VND",
    "paidAt": null
  },
  "cancellation": null,
  "timeline": [
    {
      "fromStatus": null,
      "toStatus": "PENDING_CONFIRMATION",
      "reason": null,
      "actorType": "BUYER",
      "reasonCode": null,
      "reasonText": null,
      "restockable": null,
      "receiptReference": null,
      "trackingReference": null,
      "createdAt": "2026-10-01T06:00:00.000Z"
    }
  ],
  "createdAt": "2026-10-01T06:00:00.000Z",
  "updatedAt": "2026-10-01T06:00:00.000Z"
}
```

Response có `cancellation` và timeline có cấu trúc theo mục 7.2; ví dụ đơn mới ở trên có cancellation=null. `reason` là trường tương thích history cũ, không thay reasonCode/reasonText. ActorType của history khởi tạo checkout là BUYER (actorId từ Checkout.buyerId). Buyer response ẩn actorId của Seller/Admin; Seller/Admin response chỉ trả actor allowlist phục vụ audit. receiptReference/trackingReference chỉ chứa tham chiếu nghiệp vụ không có secret/PII, không phải URL tùy ý được client gửi để server truy cập.

## 10. Mã lỗi chuẩn

| HTTP | Code | Ý nghĩa |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Body/query/header sai định dạng |
| 400 | `EMPTY_CHECKOUT` | Không có item để checkout |
| 401 | `UNAUTHORIZED` | Thiếu/hết hạn token |
| 403 | `FORBIDDEN` | Role không được phép |
| 409 | `SELF_PURCHASE_FORBIDDEN` | Buyer mua hàng của Store mình |
| 404 | `ADDRESS_NOT_FOUND` | Không tìm thấy address trong phạm vi actor |
| 409 | `DEFAULT_ADDRESS_CANNOT_BE_UNSET` | Không bỏ mặc định bằng PATCH |
| 409 | `ADDRESS_LIMIT_REACHED` | Đã đủ giới hạn 20 địa chỉ/User |
| 404 | `CART_ITEM_NOT_FOUND` | Cart không có Variant đó |
| 409 | `CART_CHANGED` | Quantity request không khớp giỏ hiện hành |
| 404 | `ORDER_NOT_FOUND` | Không tìm thấy Order trong phạm vi actor |
| 409 | `VARIANT_NOT_AVAILABLE` | Variant/Product/Store không còn bán |
| 409 | `INSUFFICIENT_STOCK` | Tồn kho không đủ tại checkout |
| 409 | `PRICE_CHANGED` | Giá canonical khác giá User đã xác nhận |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Thiếu header checkout hoặc Order command |
| 409 | `IDEMPOTENCY_CONFLICT` | Cùng key nhưng payload khác |
| 409 | `CHECKOUT_IN_PROGRESS` | Request cùng key đang được xử lý |
| 409 | `ORDER_COMMAND_IN_PROGRESS` | Order command cùng key chưa có kết quả commit trong thời gian chờ |
| 409 | `INVALID_ORDER_TRANSITION` | Chuyển trạng thái không hợp lệ |
| 409 | `ORDER_CANNOT_CANCEL` | Order đã qua trạng thái được hủy |
| 409 | `STOCK_CONFLICT` | Cạnh tranh kho hoặc transaction retry đã hết |
| 409 | `PAYMENT_STATE_CONFLICT` | Payment không phù hợp transition Order |
| 409 | `DELIVERY_ATTEMPT_LIMIT` | Đã đủ số lần giao mô phỏng theo cấu hình |
| 409 | `STALE_DELIVERY_ATTEMPT` | Attempt/tracking không khớp lần giao hiện hành |
| 429 | `RATE_LIMITED` | Vượt giới hạn request theo cấu hình |

Policy P0: ID không tồn tại hoặc nằm ngoài ownership của Buyer/Seller đều trả 404 ADDRESS_NOT_FOUND/ORDER_NOT_FOUND qua query đã lọc actor; không truy vấn người khác rồi trả khác biệt 403. Sai role ở guard vẫn 403 FORBIDDEN. Không replay command trước kiểm tra phạm vi actor.

## 11. Rate limit, an toàn và vận hành

Giới hạn nằm trong cấu hình, không hard-code vào controller. Giá trị khởi đầu để kiểm thử tải:

- Cart read/write: 60 request/phút/User.

- Checkout preview: 20 request/phút/User.
- Checkout create: 5 request/phút/User, nhưng retry cùng Idempotency-Key vẫn phải nhận kết quả idempotent thay vì tạo đơn mới.
- Order command: 20 request/phút/actor.
- Admin list/filter: 60 request/phút/Admin.

Cart dùng chung một bucket GET/PUT/DELETE theo User; 429 RATE_LIMITED có Retry-After. Limiter in-memory P0 chỉ bảo vệ một instance, không tuyên bố bảo vệ đa replica; cần shared store khi triển khai nhiều instance.

Thêm giới hạn kích thước body, số item checkout và quantity. Log chỉ ghi request ID, actor ID, order/checkout ID, command, kết quả và latency; không log JWT, địa chỉ đầy đủ, số điện thoại đầy đủ hoặc idempotency key nguyên văn. Có thể log hash rút gọn của key để đối chiếu.

Order number phải sinh an toàn khi cạnh tranh và có unique database; không dùng số lượng bản ghi hiện tại để tạo số tiếp theo. Mọi lỗi transaction trả response hữu hạn; retry Backend có giới hạn, không loop vô hạn.

## 12. Ma trận test bắt buộc

| Nhóm | Kịch bản | Kết quả bắt buộc |
|---|---|---|
| Address | User A đọc/sửa/xóa address User B | Không lộ hoặc thay đổi dữ liệu |
| Address | Hai request chọn default cạnh tranh | Sau commit tối đa một default |
| Address | Sửa/xóa address sau checkout | Snapshot Order giữ nguyên |
| Address | Create bỏ district/null; PATCH bỏ/null; snapshot địa chỉ hai cấp | Null lưu đúng; bỏ field giữ; null xóa optional; Order snapshot nullable, không bịa district |
| Address | Test biên độ dài/phone/whitespace/body PATCH rỗng | 400 đúng code; same-value PATCH hợp lệ không bị coi là rỗng |
| Cart | PUT cùng variant/quantity hai lần | Một CartItem, quantity đúng |
| Cart | Variant không còn public/hết kho | Cart hiển thị unavailable; checkout bị chặn |
| Cart | Buyer tự mua Product Store mình | Bị từ chối |
| Checkout | Hai Buyer mua Variant stock=1 | Chỉ một checkout thành công; stock=0; một movement giảm |
| Checkout | Cùng Buyer gửi cùng key/payload đồng thời | Một nhóm Order; một lần trừ kho |
| Checkout | Cùng key nhưng payload khác | `IDEMPOTENCY_CONFLICT`; dữ liệu cũ không đổi |
| Checkout | Hai key khác nhau mua cùng cart item | Không tạo hai nhóm Order vượt tồn |
| Checkout | Item không có trong giỏ Buyer hoặc chỉ có ở giỏ người khác | CART_ITEM_NOT_FOUND; không tạo Checkout/Order/stock movement |
| Checkout | Quantity khác CartItem, hoặc sửa giỏ đồng thời | CART_CHANGED hoặc serialization retry đọc lại; rollback, không xóa giỏ |
| Checkout | Hai key khác nhau mua cùng dòng, stock đủ cả hai | Chỉ một tiêu thụ dòng; bên còn lại lỗi giỏ sau retry, không tạo đơn đôi |
| Checkout | Replay sau giỏ bị xóa/address sửa/giá đổi | Nhận lại nhóm Order gốc theo key/hash, không kiểm tra giá/giỏ lần nữa |
| Search | Checkout/hoàn kho thay đổi nhiều Variant cùng Product | Một version/outbox mỗi Product/transaction, không hạ APPROVED; lỗi outbox rollback |
| Checkout | Giá đổi sau preview | `PRICE_CHANGED`; không tạo Order/movement |
| Checkout | Product/Store bị ẩn trong lúc checkout | Đọc state mới nhất và rollback toàn bộ |
| Checkout | Hai Store, một item hết kho | Không Store nào tạo Order; kho không bị trừ dở dang |
| Checkout | Lỗi giữa lúc tạo Order thứ hai | Checkout/Order/Payment/movement/stock rollback toàn bộ |
| Checkout | Serialization/deadlock tạm thời | Retry có giới hạn; không nhân bản Order |
| Snapshot | Seller sửa tên/SKU/giá; User sửa address | Order cũ không đổi |
| Ownership | Buyer/Seller đọc Order người/Store khác | 404 ORDER_NOT_FOUND; sai role 403 FORBIDDEN, không lộ payload |
| State | Bỏ qua bước, ví dụ PENDING → COMPLETED | 409; không có history sai |
| State | Hai Seller command cạnh tranh | Một transition; history không trùng |
| Command | Cùng key + payload đồng thời hoặc mất response | Một OrderCommand SUCCEEDED/history; replay snapshot gốc, không mutation/outbox thêm |
| Command | Cùng key, khác reasonText/restockable/orderId/command | IDEMPOTENCY_CONFLICT; không đổi audit/stock |
| Command | Khác key khi đơn đã đạt trạng thái đích | Không coi là replay; từ chối transition không hợp lệ |
| Command | Crash trước/sau commit | Trước: receipt/mutation rollback; sau: retry lấy snapshot bền vững |
| Cancel | Buyer hủy hai lần | Một CANCELLATION_RESTORE/OrderItem; stock tăng một lần |
| Cancel | Buyer cancel cạnh tranh Seller confirm | Chỉ một command commit theo state/version canonical |
| Cancel | Cancel cạnh tranh checkout/retry | Không âm kho hoặc hoàn kho khi chưa từng trừ |
| COD | Mark delivered lặp | Payment PAID và history chỉ ghi một lần |
| COD | Complete khi COD chưa PAID | Bị từ chối; Order không đổi |
| Complete | Seller/Admin gọi complete hoặc job chưa tới D07 | Bị từ chối/skip; không tạo history/doanh thu |
| Complete | Buyer cạnh tranh job D07 sau 3 ngày DELIVERED | Một transition COMPLETED; history/revenue không ghi hai lần |
| Delivery | Seller gọi ship/delivered/failed/retry-delivery | Guard từ chối; chỉ Admin/adapter mô phỏng được thao tác |
| Delivery | Retry lần 3 và lần 4 | Retry 3 thành công (attempt=4); retry 4 bị chặn, không đổi DB |
| Delivery | Replay retry cùng key/hash | Không tăng attempt/retryCount, không đổi kho/history lần hai |
| Delivery | Delivered/failed cũ sau retry tracking mới | STALE_DELIVERY_ATTEMPT; Order/Payment/history/stock giữ nguyên |
| Delivery | Đúng attempt sai tracking hoặc failed cạnh tranh retry | Từ chối mismatch; transaction retry đọc lại attempt canonical |
| Address | PATCH bỏ default; tạo địa chỉ thứ 21 | 409 đúng code, DB không đổi; tạo đầu tiên/xóa cuối đúng rule |
| Cart | Item ẩn; thiếu kho; GET giỏ chưa tồn tại | Không lộ metadata; subtotal loại unavailable; GET không tạo row |
| Cart | PUT quantity vượt stock; DELETE lặp | PUT bị từ chối không giữ kho; DELETE 204; lineCount/totalQuantity đúng |
| Delivery | DELIVERY_FAILED nhưng hàng chưa trả | Không hoàn kho |
| Delivery | confirm-returned lặp, restockable=true | Một movement hoàn kho |
| Delivery | confirm-returned restockable=false, DAMAGED/LOST đúng actor | CANCELLED/Payment CANCELLED; không tăng stock, không tạo restore movement |
| Audit | Cancel/failed/returned rồi GET Order và replay | Actor/code/text/time/restockable giữ đúng dữ liệu; Buyer không lộ actor ID nội bộ |
| Database | Movement gắn sai Variant/OrderItem | Composite FK từ chối |
| Database | History gắn OrderCommand của Order khác | Composite FK từ chối; không tạo audit sai Order |
| Database | Giá có phần lẻ hoặc total sai | Check constraint từ chối |
| Rate limit | Spam checkout vượt ngưỡng | 429 nhưng request đã commit trước đó vẫn replay đúng |
| Recovery | Mất response sau commit rồi retry | Trả đúng Order cũ, không trừ kho lần hai |

Test transaction phải chạy với ít nhất hai Prisma client/connection độc lập để mô phỏng cạnh tranh thật; không dùng một Promise tuần tự rồi gọi đó là race test.

## 13. Acceptance criteria và thứ tự triển khai

### Đợt A — Address + Cart

- Migration mới đổi UserAddress.district và Order.districtSnapshot sang nullable, giữ dữ liệu cũ; không sửa migration nền đã merge.
- API, Swagger, validation, ownership và error code theo contract.
- E2E cross-user, default address, PUT idempotent và cart unavailable.
- Chưa đánh dấu `G-CHECKOUT` hoàn thành.

### Đợt B — Checkout transaction + COD

- Preview và create với Idempotency-Key/requestHash.
- Multi-Store all-or-nothing, snapshot, conditional stock decrement, Payment COD và movement.
- E2E cạnh tranh stock=1, retry/mất response, giá đổi và rollback giữa batch.

### Đợt C — Order state machine + cancellation

- Buyer/Seller/Admin read đúng quyền.
- Migration mới cho OrderCommand, hashVersion, cancellation/history audit và dữ liệu lần giao mô phỏng; tuyệt đối không sửa migration nền PR #26. Checkout.hashVersion bổ sung trước Đợt B.
- Command transition/key/hash/replay snapshot, history, COD delivery, cancel/restore, delivery failed và job D07.
- Quyền vận chuyển mô phỏng và complete theo SRS v3.1, không trao Seller quyền tự xác nhận đã giao/hoàn tất.
- Không có generic status patch.

### Đợt D — Frontend và tích hợp

- Cart, checkout, Buyer orders và Seller order management có loading/empty/error/retry.
- UI xử lý PRICE_CHANGED, INSUFFICIENT_STOCK và replay idempotent rõ ràng.
- Demo User → checkout nhiều Store → Seller xử lý → Buyer hoàn tất.

Chỉ khi Đợt A–D có trên `develop`, CI xanh, có dữ liệu demo và E2E/browser evidence mới chuyển `G-CHECKOUT`/`G-FULFILMENT` sang DONE.

## 14. Điểm cần reviewer xác nhận

### Đối chiếu thực tế và điểm chưa chốt trong lượt sửa 03/10

Giới hạn 20 địa chỉ/99 quantity/3 retry là cấu hình nhóm chọn theo phạm vi/SRS, không tuyên bố là chính sách chung của các sàn. Giỏ không giữ kho: PUT kiểm tra kho không đảm bảo lần checkout sau còn hàng. Tổng giỏ mua được không thay tổng subset chọn tại checkout hoặc phí vận chuyển cuối.

Nguồn [Shopee về địa chỉ hành chính mới](https://help.shopee.vn/portal/4/article/197479) cho thấy phải hỗ trợ địa chỉ hiện hành, không ép mô hình tỉnh–huyện–xã cũ. Schema #26 đã merge vẫn bắt buộc district; quyết định đã chốt là province/ward bắt buộc, district nullable, migration mới cho UserAddress.district và Order.districtSnapshot trước API. Lượt này chỉ ghi thiết kế, chưa áp dụng migration. Không tạo placeholder district giả.

Nguồn [Shopee quản lý địa chỉ](https://help.shopee.vn/portal/4/article/79433) và [TikTok Shop vận chuyển](https://seller-vn.tiktok.com/university/essay?knowledge_id=8974899868518160) chỉ dùng đối chiếu nghiệp vụ công khai; không suy ra transaction, giới hạn retry hay contract kỹ thuật nội bộ của các sàn. Truy cập 03/10/2026.

Hiền đã xác nhận Address validation/PATCH, USER single-role, Cart DTO/reason/rate-limit nêu ở mục 3/4/11. Chỉ trạng thái approval toàn PR còn chờ re-review; không để các lựa chọn này là câu hỏi mở. Phân công Buyer UI Address/Cart được Hoàng đề xuất ở #29, trạng thái PROPOSED/PENDING_HIEN_CONFIRMATION; nếu Hiền chưa nhận thì Hoàng vẫn giữ theo phân công gốc. Không sửa schema/code trong lượt tài liệu.

Hiền review:

- Quyền hủy của Buyer/Seller và chuỗi trạng thái.
- Hành vi DELIVERY_FAILED/confirm-returned/restockable.
- Snapshot địa chỉ/tiền và cách hiển thị lịch sử.
- Mã lỗi/ma trận test có đủ SRS không.

Hoàng review triển khai:

- Idempotency-Key/requestHash, Serializable retry và conditional stock update.
- Multi-Store rollback, movement uniqueness và COD atomicity.
- DTO/response/money serialization và rate limit.

Đạt không cần review contract này trừ khi thay đổi Product public, Variant payload hoặc Search contract. Nếu reviewer yêu cầu đổi schema đã merge, phải tạo migration mới; không sửa migration PR #26.

### 14.1 Truy vết bản sửa theo review PR #27

| Feedback | Quyết định đưa ra review | Phần kiểm thử thiết kế |
|---|---|---|
| Nhận diện retry command | Mục 7.1: OrderCommand bền vững, scope/key/hash, snapshot và transaction nguyên tử | Cùng/khác payload, hai connection, crash trước/sau commit, khác key cùng trạng thái đích |
| Actor COMPLETED lệch bản v0.5 | Mục 1/6/8.1: dùng FR-ORD-01 và D07 của SRS v3.1; Buyer hoặc SYSTEM, không Seller | Sai actor, chưa tới hạn, Buyer cạnh tranh job, COD chưa PAID |
| Audit hủy chưa canonical | Mục 7.2/9: cột riêng và history có cấu trúc; migration mới, không ghép chuỗi | Đối chiếu actor/code/text/time, false không hoàn kho, replay không đổi lịch sử |
| Checkout/Cart chưa rõ | Mục 5.1.1/5.4: chỉ tập con Cart, quantity khớp, kiểm tra trong transaction | Thiếu dòng, lệch quantity, sửa giỏ cạnh tranh, hai key stock đủ, replay sau xóa giỏ |
| Failed cũ làm sai lần giao mới | Mục 8.1: attempt/tracking hiện hành, receipt/hash bền vững | Failed/delivered stale, tracking mismatch, concurrent command, replay receipt |
| Giới hạn giao lại lệch SRS | 3 retry, tối đa 4 attempt tổng, không bắt vận đơn mới mỗi retry | Retry 3 nhận; retry 4 chặn; replay không tăng counter |
| Review Address/Cart #29 | Default không unset; 20 địa chỉ/99 quantity; count/subtotal/privacy và PUT kiểm tra kho | Boundary/default/stock/privacy; DTO chi tiết còn cần review |

Đây là **test matrix cần triển khai**, không phải kết quả test API đã PASS. Reviewer xác nhận các lựa chọn kỹ thuật trước migration/API. Idempotency = gửi lại không thực hiện nghiệp vụ lần hai; receipt = bản ghi kết quả lệnh; requestHash = dấu kiểm tra nội dung; snapshot = bản chụp dữ liệu tại một thời điểm; Serializable = transaction có kết quả tương đương xử lý tuần tự, có thể cần retry khi cạnh tranh.
