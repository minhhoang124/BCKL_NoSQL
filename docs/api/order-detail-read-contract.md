# API chi tiết đơn Buyer/Seller — thiết kế và hướng đọc code

Ngày 10/10/2026, baseline `develop 27e083b` sau merge #36/#37/#38/#39. Hoàng triển khai trên `codex/order-detail-api`; **IN_PROGRESS, cần Hiền review PR mới**. Không còn dependency chờ #38. Không sửa schema/migration, Auth, FastAPI hoặc command xử lý đơn trong đợt này.

Nguồn yêu cầu: [SRS v3.1 FR-ORD-01/AC-ORD-01](../analysis/hien/srs-v3.md), [contract đã merge](cart-order-inventory-api-contract.md) mục 6–11, [thiết kế nền](../architecture/cart-order-inventory-design.md). Bản chuẩn bị của agent khác trong máy Hoàng được giữ nguyên; tài liệu này chốt chi tiết triển khai còn mơ hồ của bản đó để đưa ra review, không nhận là đã được Hiền duyệt.

## 1. Luồng và quyền

| API | Actor | Điều kiện tìm đơn ngay trong SQL |
|---|---|---|
| `GET /orders/:orderId` | USER đang hoạt động | Order.id + Order.buyerId = JWT User ID |
| `GET /seller/orders/:orderId` | SELLER đang hoạt động | Order.id + Store.sellerId = JWT User ID |

Không nhận query hoặc body. orderId là chuỗi số nguyên dương PostgreSQL Int, không leading zero, số mũ, số thập phân hoặc ép kiểu mơ hồ. Đơn ngoài quyền và đơn không tồn tại cùng `404 ORDER_NOT_FOUND`. Sai role 403; token thiếu/hết hạn/account khóa 401. Store SUSPENDED không cấm Seller active đọc giao dịch cũ; không cho quyền bán mới qua API đọc này. Admin chưa có API detail trong task.

Luồng: chặn GET body trước JSON parser → JWT tra User hiện hành → guard role → quota đọc → kiểm path/query → PostgreSQL transaction **RepeatableRead + READ ONLY** → kiểm lại User active/role → truy vấn Order đã lọc quyền → đọc snapshot/Payment/history cùng ảnh chụp DB → chọn trường và chuyển kiểu → trả 200 `Cache-Control:no-store`. Lỗi cũng no-store, không echo SQL/PII/token/key.

RepeatableRead là các lần đọc trong request thấy cùng trạng thái database, không trộn Order mới với history cũ. READ ONLY được PostgreSQL thực thi: GET không thể ghi Order, Payment, history, kho hoặc SearchOutbox. Statement timeout 2 giây, pool maxWait 2 giây, transaction timeout 5 giây; không retry vòng lặp đọc.

Tận dụng `OrderListRateGuard`: list/detail dùng **chung** quota đọc `ORDER_LIST_RATE_PER_MINUTE=60`/actor/instance, 429 có Retry-After; không tạo một bucket mới để bypass quota. Memory tối đa 10.000 actor, không nhận là quota đa replica. Đây là mở rộng quota đọc cần Hiền review, không thay quota command/Cart/Checkout.

## 2. Từng trường chứa gì?

| Trường trả về | Ý nghĩa / nguồn | Quy tắc |
|---|---|---|
| id, orderNumber, status | ID, mã dễ đọc, trạng thái Order hiện hành | Không lấy status từ receipt Checkout |
| store.id/name | Store hiện hành | Không trả seller profile/phone/email |
| shippingAddress | Tên người nhận, phone, province, district, ward, addressLine, postalCode, deliveryNote từ Order.*Snapshot | district/postalCode/note nullable; không query UserAddress |
| items[].id/productId/variantId | ID dòng mua và ID truy vết | Không có nghĩa Product hiện còn public |
| items[].productName/sku | productNameSnapshot/skuSnapshot lúc mua | Không query Product/Variant để sửa lịch sử |
| items[].options | Nhãn lựa chọn lưu trong optionSnapshot, **string[]** đúng contract mục 9 | Canonical `{groupId,groupName,valueId,value}[]` → lấy value theo thứ tự đã lưu; legacy string[] giữ nguyên; default variant `[]` |
| items[].unitPrice/quantity/lineTotal | Giá mua, số lượng, tiền dòng đã lưu | Tiền Decimal → string hai số thập phân; không dùng Number/giá hiện hành |
| subtotal/shippingFee/discountTotal/total | Các tổng đã lưu trong Order | Không tính lại bằng catalog, không sửa số liệu lịch sử |
| payment | provider/status/amount/currency/paidAt hiện hành | Không trả Payment ID/internal fields; thiếu record trả null |
| cancellation | cancelledBy:{type,id}, reasonCode, reasonText, cancelledAt từ cột canonical | Đơn chưa hủy và không có audit hủy: null; đơn CANCELLED legacy vẫn object với trường chưa biết = null |
| timeline | fromStatus/toStatus, actorType/actorId, reason cũ, reasonCode/Text, restockable, receiptReference, trackingReference, deliveryAttempt, createdAt | Sắp tăng `(createdAt,id)`, không trả history ID/commandId hoặc command receipt |
| createdAt/updatedAt | Thời gian Order | Chuỗi ISO UTC |

**Actor ID allowlist:** Buyer chỉ thấy ID khi actorType=BUYER và actorId đúng Buyer của đơn. Seller đọc đúng Store được xem ID Buyer của đơn, SELLER nếu đúng mình, ADMIN phục vụ audit theo contract 7.2. SYSTEM/actorType chưa biết/SELLER khác trả id=null, không tra role hiện tại để đoán vai trò lịch sử. Áp dụng giống nhau cho timeline và cancellation. Không trả User profile người mua ngoài shipping snapshot phục vụ giao hàng.

**Không trả:** checkoutId, buyerId gốc, idempotencyKey, requestHash, hashVersion, Checkout receipt, OrderCommand/resultSnapshot hoặc JSON optionSnapshot thô. Cả SQL select và mapper response đều có danh sách trường rõ ràng.

## 3. Quyết định legacy cần reviewer duyệt

1. Detail dùng `payment:null` khi DB thiếu Payment, tương tự list nhưng **approval list không tự áp dụng cho detail**. Không tạo COD/UNPAID giả. Command tương lai vẫn phải chặn Payment không nhất quán.
2. Giữ actorType/reasonCode/Text/command còn thiếu là null; cancellationReason tự do cũ không được parse thành code/text. `timeline.reason` giữ trường tương thích cũ theo contract. Không suy ra thời gian hủy từ updatedAt hoặc actorType từ role hiện tại.
3. Snapshot option không thuộc hai dạng ở mục 2: trả 500 INTERNAL_ERROR an toàn, không biến thành `[]` hoặc tải lại catalog. Database không bị sửa. Việc điều tra/chuẩn hóa dữ liệu hỏng là task riêng có bằng chứng; chưa audit demo thì không khẳng định demo không có legacy hỏng.

## 4. Đọc code và kiểm thử

- `BE/src/order/order-detail.controller.ts`: route/quyền/Swagger.
- `order-detail.service.ts`: kiểm ID/query, transaction, ownership, chọn trường, privacy, chuyển snapshot/Decimal.
- `order-detail.dto.ts`: DTO = cấu trúc dữ liệu API trả về, không phải bảng DB.
- `order-list.http.ts`: middleware trước parser và lỗi an toàn dùng chung Order read.
- `order-list-rate.guard.ts`: rate limit = giới hạn tần suất đọc, không khóa tồn kho.
- `BE/test/order-detail.e2e-spec.ts`: HTTP thật + PostgreSQL, ownership/privacy/legacy/snapshot/timeout/concurrency và POST Checkout → GET detail.
- [Bằng chứng kiểm thử](../testing/order-detail-api-verification.md).

Snapshot = bản dữ liệu lưu lúc mua; ownership = quyền sở hữu; allowlist = chỉ trả các trường được cho phép; legacy = dữ liệu cũ thiếu cấu trúc mới; audit = truy vết ai thao tác lúc nào. Đọc thêm lý thuyết tại [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) và [NestJS guards](https://docs.nestjs.com/guards); phiên bản cài trong repo vẫn là nguồn kiểm tra behavior cụ thể.

## 5. Ngoài phạm vi / bước kế tiếp

Chưa có confirm/packing/cancel/hoàn kho/delivery/complete runtime hoặc giao diện nối API. Chưa nghiệm thu G-CHECKOUT/G-FULFILMENT, chưa tuyên bố luồng mua/giao hàng toàn hệ thống DONE. Sau review detail: triển khai Seller confirm → packing bằng OrderCommand + history cùng transaction; sau đó hủy/hoàn kho rồi delivery riêng. Không tự merge PR này.
