# Order đọc — triển khai danh sách và checklist phần chi tiết

**Cập nhật 10/10 sau merge:** #37 đã merge tại bed88a0; #38 nền audit/OrderCommand đã merge tại 27e083b. Các phần gap/migration bên dưới là ảnh chụp lịch sử trước merge, không còn là dependency chờ. Detail được triển khai riêng trên `codex/order-detail-api`; xem [contract chi tiết](../api/order-detail-read-contract.md) và [test mới](../testing/order-detail-api-verification.md). Không nhận approval list là approval detail; legacy Payment/audit/options và quota chung cần review trong PR mới. Không audit hoặc backfill DB demo trong task.

Khởi tạo 08/10/2026 từ `develop c6e0ba1`; cập nhật 09/10 sau khi merge `develop a2561c1` vào branch `codex/order-list-api` bằng merge thông thường. #36 Checkout và #39 TypeScript đã merge; #37 vẫn **IN_PROGRESS/chưa merge**. Hiền đã approve projection/quota/legacy ở head `e6f4427`; bản tích hợp mới cần re-review, không dùng approval cũ thay review head mới. Hoàng triển khai; Hiền review nghiệp vụ/response/legacy. Đạt theo dõi ranh giới Search, không nhận thêm task viết Order API.

Nguồn yêu cầu: SRS v3.1 `docs/analysis/hien/srs-v3.md`, FR-ORD-01; [contract](../api/cart-order-inventory-api-contract.md) mục 2.3, 6–11; [thiết kế nền](cart-order-inventory-design.md); phạm vi G-CHECKOUT/G-FULFILMENT. Không đổi SRS để nhận phần thiếu thành đã làm.

## 1. Phần được triển khai ở branch này

- `GET /orders`: USER đang hoạt động đọc Order có buyerId của mình.
- `GET /seller/orders`: SELLER đang hoạt động đọc Order có Store.sellerId của mình; không nhận buyerId/storeId từ query.
- Chỉ query `status`, `limit`, `afterId`. Limit mặc định 20, tối đa 50; ID Int PostgreSQL dương. Status phải đúng enum, không nhận ALL/lowercase/array/trường thừa. ID giảm dần, sau cursor lấy ID nhỏ hơn. Cursor là ranh giới, không phải quyền truy cập; không cần cursor trỏ tới một Order còn tồn tại.
- Response danh sách **tóm tắt** như mục 2, không phải response chi tiết ở mục 9 của contract. Hiền đã duyệt projection tại head cũ; API chi tiết và command chưa được đăng ký vào Swagger.
- Không thêm migration hoặc đổi business contract Checkout/Auth/FastAPI. Merge giữ nguyên module Checkout và parser từ #36; hai test tích hợp mới gọi Checkout thật để tạo dữ liệu, còn API danh sách không ghi stock/Order/Payment/outbox.

Luồng: CORS → middleware chặn body GET trước JSON parser → JWT tra User active/role hiện hành → guard USER hoặc SELLER → quota đọc → kiểm query → transaction RepeatableRead READ ONLY → kiểm lại User active/role → truy vấn Order **đã lọc ownership trong SQL** → lấy tối đa limit+1 → chuyển Decimal sang chuỗi hai số thập phân → trả allowlist + nextCursor, no-store.

RepeatableRead nghĩa là các lần đọc User, Order, Store và Payment trong request thấy cùng một ảnh chụp database. READ ONLY được PostgreSQL thực thi, không chỉ là quy ước không gọi hàm update. Statement timeout 2s, pool maxWait 2s, transaction timeout 5s; không tự retry vô hạn lỗi đọc. Lỗi nội bộ không trả SQL hoặc dữ liệu riêng.

Store bị tạm khóa không làm mất lịch sử của Seller đang hoạt động. Đây là truy cập lịch sử, không phải cho Store tiếp tục bán. Tài khoản bị khóa vẫn 401; sai role vẫn 403. Giữ Role đơn hiện tại, không tự mở multi-role.

## 2. Projection danh sách — đã review tại e6f4427

```json
{
  "items": [{
    "id": 101,
    "orderNumber": "ORD-example",
    "status": "PENDING_CONFIRMATION",
    "store": {"id": 8, "name": "BCKL Audio"},
    "total": "10000.00",
    "payment": {
      "provider": "COD", "status": "UNPAID", "amount": "10000.00",
      "currency": "VND", "paidAt": null
    },
    "createdAt": "2026-10-08T10:00:00.000Z",
    "updatedAt": "2026-10-08T10:00:00.000Z"
  }],
  "nextCursor": null
}
```

`items[].total` là số tiền đã lưu trong Order, **không** là số lượng kết quả phân trang. Chỉ có trang sau khi truy vấn tìm được dòng thứ limit+1; nextCursor là ID cuối của trang vừa trả, nếu hết là null. Không trả total count giả. Store chỉ id/name hiện hành, đúng nguyên tắc display trong contract; không trả địa chỉ/phone/email của Store hoặc Buyer.

Order/Payment status là trạng thái hiện hành, không dùng receipt Checkout bất biến làm tracking. Không tra lại Product public để quyết định có được xem lịch sử mua hay không. Item/address snapshot sẽ thuộc API chi tiết; không lộ nháp catalog hoặc PII qua danh sách này.

Schema hiện cho Order.payment nullable. Danh sách trả `payment:null` khi record cũ chưa có Payment, không bịa COD/UNPAID hoặc tự tạo Payment trong GET; Hiền đã duyệt cách biểu diễn này tại e6f4427. Đây không phải xác nhận record đó đủ điều kiện chuyển trạng thái; command tương lai vẫn phải kiểm tra tính nhất quán. Mọi Checkout COD mới từ #36 tạo Payment trong cùng transaction; null chỉ là bảo toàn sự thật dữ liệu đọc, không nới yêu cầu create.

Quota đã được Hiền duyệt ở head cũ: `ORDER_LIST_RATE_PER_MINUTE=60`/User/instance, memory cap 10.000 bucket, TTL 60s, không evict bucket còn hiệu lực để reset quota. 429 có Retry-After, CORS cho UI đọc header. Không dùng chung bucket Cart/Checkout/Order command; không tuyên bố quota này dùng chung đa replica.

## 3. Khoảng trống đã xác định cho API chi tiết

| Dữ liệu | Schema đã merge | Contract đích | Việc còn lại |
|---|---|---|---|
| Tiền/địa chỉ/item | Order/OrderItem snapshot, Decimal, district nullable | Chi tiết lấy snapshot, không catalog/address hiện hành | Mapper/validation/ownership E2E, không đoán optionSnapshot legacy |
| Payment | Quan hệ nullable, provider/status/amount/paidAt | Payment hiện hành và kiểm nhất quán khi command | Chốt biểu diễn legacy thiếu Payment cho detail, không tự sửa khi GET |
| Hủy đơn | cancellationReason/cancelledAt cũ | cancelledByType/Id, reasonCode/Text, cancelledAt | Migration mới cho các cột canonical và audit legacy |
| Timeline | actorId/reason cũ | actorType, reasonCode/Text, restockable, receiptReference, trackingReference | Migration mới; không suy diễn actorType từ role hiện tại |
| Replay command | Chưa có OrderCommand | Unique actorScope/key, hashVersion, resultSnapshot | PR nền command riêng trước confirm/cancel/complete |
| Giao hàng | Chưa có DeliveryAttempt/counters | Attempt hiện hành, 3 lần giao lại = 4 tổng | PR delivery riêng, không nhồi vào list |

**Không phải blocker của giao dịch COD #36:** #36 tạo history ban đầu bằng actorId Buyer theo schema nền, chưa nhận hoàn thành command/audit mở rộng. API đọc không được che khoảng trống này bằng cách gán mọi history thành BUYER/SYSTEM.

Checklist trước khi triển khai detail:

- [x] Hiền review projection list và `payment:null` tại e6f4427; approval không bao gồm thay đổi tích hợp sau đó hoặc detail chưa triển khai.
- [ ] Audit read-only số Order/Payment/history legacy trên database đích, chỉ báo số lượng/ID cần xử lý, không ghi PII/raw key ra tài liệu. Chưa audit demo thì không kết luận “không có legacy”.
- [ ] Migration **mới** thêm cột audit canonical theo contract 7.2. Không sửa migration #26/#30/#36 hoặc ghi code/text vào cancellationReason để làm nguồn chuẩn.
- [ ] Chỉ backfill khi có bằng chứng. History khởi tạo phải đối chiếu Checkout.buyerId/Order.buyerId/actorId và transition; không suy luận từ role hiện tại hoặc reason tự do. Case không chứng minh được cần quy ước legacy được Hiền review, không bịa actor/reason.
- [ ] Response chi tiết lấy snapshot item/address, timeline sắp `(createdAt,id)`, tiền exact, nullable district. Buyer không thấy actor ID Seller/Admin; Seller chỉ đúng Store, không lộ Order khác.
- [ ] Test Order không tồn tại và Order ngoài ownership cùng 404; Product/Variant/địa chỉ bị sửa/ẩn không làm lịch sử thay đổi; null Payment/cancellation/history legacy xử lý theo quyết định đã review.
- [x] Sau #36/#39 merge, đồng bộ develop bằng merge thông thường; giữ cả CheckoutModule/OrderModule và hai middleware HTTP, không force-push. Middleware Order chặn body GET trước parser JSON của Checkout và parser mặc định. Kết quả toàn suite trên bản kết hợp ghi ở tài liệu kiểm chứng, không nhận test fixture thay bằng chứng create → read.

## 4. Đọc code và bằng chứng

`BE/src/order/order-list.controller.ts` → `order-list.http.ts` (query/error/body) → `order-list-rate.guard.ts` → `order-list.service.ts` → Order/Payment/Store trong Prisma schema → `BE/test/order-list.e2e-spec.ts`.

DTO là cấu trúc dữ liệu request/response; projection là tập trường được chọn để trả; ownership là quyền sở hữu; cursor là mốc ID để lấy trang tiếp theo; audit là thông tin truy vết ai đã làm gì; legacy là dữ liệu cũ chưa có đủ cấu trúc mới.

Xem [kiểm chứng Order list](../testing/order-list-api-verification.md). List không phải toàn bộ Order read; schema không phải command runtime; test fixture không phải bằng chứng Buyer đã mua từ UI. G-CHECKOUT/G-FULFILMENT chưa DONE.
