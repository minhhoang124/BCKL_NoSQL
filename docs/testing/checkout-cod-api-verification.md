# API tạo đơn COD — giao dịch nguyên tử

Ngày 08/10/2026, branch `codex/checkout-cod`, tiếp nối head preview/lookup `38fda70`; **IN_PROGRESS, gửi review trong PR #36, chưa merge**. Không tự merge hoặc thay đổi SRS/contract đã chốt trong PR #29. Không sửa schema/migration trong bước create này; dùng migration nền hash/receipt đã có trên branch. Kết quả local dưới đây không thay kết quả CI của head mới trên GitHub.

## 1. Phạm vi đã triển khai

`POST /checkouts` nhận JWT USER và header `Idempotency-Key`; body giống preview gồm addressId, COD và 1–50 dòng Variant/quantity/expectedUnitPrice. ID PostgreSQL Int dương, quantity 1–99, giá chuỗi nguyên đồng, body 64 KiB sau giải nén. Reject trường thừa/query ngoài contract. Response no-store, CORS expose Retry-After, 201 lần đầu/200 replay.

Một transaction Serializable làm tất cả: khóa Buyer → xác thực lại → đọc key/receipt → kiểm địa chỉ → khóa Product theo thứ tự → kiểm giỏ/public/giá/kho → tạo Checkout → conditional decrement Variant → một Order/Store + OrderItem/address snapshot + COD UNPAID + history + stock ledger → một Product.version/outbox mỗi Product → xóa đúng dòng giỏ đã chọn → lưu receipt v1 COMPLETED. Bất kỳ lỗi nào hoàn tác tất cả; các sequence DB có thể tăng dù transaction rollback.

Replay nhận diện trước giỏ/địa chỉ/giá hiện hành, trả biên nhận ban đầu ngay cả khi Order/Payment/catalog đã đổi. Không có create PENDING ở transaction riêng, không reset key, không dựng lại receipt từ Order hiện hành. Hai Buyer có thể dùng cùng chuỗi key độc lập; key không phải credential.

## 2. An toàn cạnh tranh và vận hành

- Khóa hàng User dùng cùng cơ chế Cart/Address. Khóa Product trước cập nhật Variant; ID tăng dần để giảm deadlock. Conditional stock >= quantity + check DB chống âm kho.
- Ba attempts tối đa, chỉ retry serialization/deadlock với backoff 25/50 ms + jitter 0–24 ms. Prisma 7 có thể bọc raw SQLSTATE 40001/40P01 trong P2010.meta.driverAdapterError.cause; phải phân loại chính xác, không retry mọi P2010/P2002/lỗi nghiệp vụ.
- Timeout mặc định: lock 1s, statement 2s, transaction 5s, pool maxWait 2s, deadline tổng 22s. Cấu hình integer dương tối đa 60s; lock <= statement <= transaction. Hết retry STOCK_CONFLICT; lock/statement/transaction timeout CHECKOUT_IN_PROGRESS + Retry-After 2, client giữ body/key để đối chiếu.
- Quota memory mỗi instance: 60 ingress/phút/User gồm replay, 5 intent mới/phút/User. Phân loại receipt dưới khóa Buyer trước quota intent; giao dịch retry không tính lại, attempt mua mới thất bại vẫn tiêu một quota. Bucket giới hạn 10.000, không loại bucket còn hiệu lực để bypass. Đây không phải shared limiter đa replica.
- SearchOutbox ghi cùng tx, không gọi HTTP trong tx. Đổi kho không hạ APPROVED. Public sold-out vẫn UPSERT inStock=false; payload lấy toàn bộ Variant hiển thị, không chỉ Variant vừa mua. Worker lỗi sau commit không đảo ngược đơn.
- OrderNumber dùng UUID ngẫu nhiên + unique DB, không dùng count. Option snapshot lưu nhãn/ID nhóm và giá trị; SKU dùng skuCode chuẩn, không tin nội dung client. Log không ghi raw key/hash/JWT/địa chỉ/receipt/SQL.

## 3. Bằng chứng test mới

`BE/test/checkout-create.e2e-spec.ts`: 36 ca HTTP/service qua PostgreSQL thật, hai Nest app và hai Prisma client/pool độc lập. Race harness khóa Product thật đến khi cả hai request đang chờ khóa trong pg_stat_activity, rồi thả; không gọi tuần tự và gọi đó là race.

| Nhóm | Bằng chứng |
|---|---|
| Thành công/subset/multi-Store | Snapshot, COD UNPAID, history/movement/balance, receipt; một Checkout/một Order mỗi Store; dòng giỏ không chọn còn nguyên |
| Search transaction | Nhiều Variant cùng Product chỉ một version/event; all sold-out giữ APPROVED; payload giá/kho gồm sibling không mua |
| Replay/ownership | Cùng key/hash canonical/reorder trả receipt gốc sau xóa address/Cart và đổi catalog/Order/Payment; khác hash conflict; hai Buyer cùng key độc lập |
| Canonical validation | Giá/kho/public/Variant/Store/Seller/Category/required attribute đọc lại; Cart/address ownership, quantity, self-purchase, Decimal overflow; lỗi không ghi dữ liệu |
| Rollback | Inject lỗi outbox sau Orders/stock, lỗi ở Product Store thứ hai sau event đầu, lỗi validate receipt sau xóa Cart; so DB trước/sau, rồi cùng key retry thành công |
| Race hai app | Cùng key: 201+200 một receipt; khác key cùng dòng stock đủ: 201+404; hai Buyer stock=1: 201+409, một decrement và một OrderItem |
| Retry/deadline | Ba conflict attempts rồi STOCK_CONFLICT; một conflict rồi commit một lần và quota intent chỉ một; khóa PostgreSQL thật timeout hữu hạn và retry cùng key thành công |
| Quota/HTTP | Năm intent gồm failed attempt; replay không tiêu intent nhưng bị cap 60 ingress; Retry-After; Auth/header/provider/extra/query/64 KiB; Swagger 200/201/header |
| Snapshot | Nhãn option/SKU không đổi theo catalog; địa chỉ nullable được sao đúng; receipt gốc không đổi theo Order/Payment |

`BE/src/checkout/checkout-create-rate.spec.ts`: 9 unit cases cho hai bucket/User, expiry/Retry-After, capacity và config sai. Các tests rollback dùng DB thật, chỉ inject lỗi ở ranh giới service để chứng minh transaction; **không gọi đây là bằng chứng tích hợp FastAPI/FAISS/Elasticsearch**. Chưa thử kill-process/đứt mạng thật; replay sau commit và fault injection không thay chaos test.

## 4. Kết quả kiểm tra

Database riêng: `bckl_checkout_foundation_20261008_a`, Docker PostgreSQL 17. Không migrate/seed dữ liệu demo `klcn_ecommerce`; cron Search/reconciliation/image repair tắt trong E2E. Cleanup chỉ fixture marker theo FK.

| Kiểm tra local ngày 08/10 | Kết quả |
|---|---|
| Backend lint | PASS |
| Backend unit | PASS 222/222, 16 files (9 ca limiter mới) |
| Backend build | PASS, Prisma generate + Nest build |
| Prisma validate | PASS, schema không đổi |
| Prisma migrate status | PASS, database riêng up-to-date với 10 migrations |
| Toàn bộ Backend E2E | PASS 259/259, 17 files; lượt cuối 19:38–19:39 Asia/Saigon |
| COD create E2E | PASS 36/36, nằm trong 259; không cộng thêm lần nữa |
| Git diff whitespace | PASS cho tracked diff; file mới được Prettier/lint kiểm tra |
| Full TypeScript check | Chưa PASS toàn repo: giữ 13 diagnostics baseline, không có diagnostic ở file Checkout mới |

Sau lượt cuối đã query DB riêng: 0 User fixture COD, 0 Checkout, 0 Order, 0 StockMovement còn lại. Đây là xác nhận cleanup, không phải xóa dữ liệu demo.

Lượt đầu phát hiện lỗi phân loại serialization của driver (P2010 bọc 40001), đã sửa và chạy lại race thật; fixture required attribute ban đầu dùng sai tên delegate và Swagger test cũ còn khẳng định không có POST /checkouts, đã sửa rồi chạy lại toàn suite. Giá trong Search payload vẫn theo producer canonical hiện có (`"10000"` là chuỗi decimal hợp lệ), không đổi contract Search chỉ để ép assertion Checkout thành `.00`. Các error logs trong ca fault injection là kết quả lỗi cố ý, không phải test thất bại. CI cho commit COD phải đối chiếu riêng trên PR #36; không dùng CI xanh của `38fda70` thay bằng chứng head mới.

Full TypeScript check còn 13 diagnostics baseline ngoài file mới (Prisma config earlyAccess, supertest/types, ReconciliationStats.locked và declaration seed-demo-user). Không nhận toàn repo sạch typecheck chỉ vì Nest build pass. Có cảnh báo pg concurrent-query deprecation và vite-tsconfig-paths từ baseline; cần xử lý riêng, không che cảnh báo bằng sửa ngoài phạm vi.

## 5. Chưa hoàn thành

- Cần reviewer và CI xác nhận head COD mới của PR #36; chưa merge, không nhận G-CHECKOUT/G-FULFILMENT DONE.
- Chưa Buyer Checkout UI, Order read/command/cancel/hoàn kho/delivery/auto-complete, sandbox provider hoặc durable notification.
- CHK-S01…04 stock → worker → HTTP FastAPI → dual index/hydrate chưa chạy ở bước này; Đạt phối hợp ở harness riêng. Stock/movement/outbox E2E không chứng minh index đã cập nhật.
- Limiter per-instance cần shared store nếu nhiều replica. Timeout/quota hiện là cấu hình demo đã kiểm thử, chưa load test quy mô production.

## 6. Đọc và thử thủ công

Đọc [contract mục 5](../api/cart-order-inventory-api-contract.md) → [kiến trúc mục 7.5.6](../architecture/system-architecture-overview.md) → `checkout-create.controller.ts` → `checkout-create.service.ts` → E2E. Transaction = cùng thành công/hoàn tác; replay = trả kết quả cũ không mua lần hai; snapshot = bản chụp lúc mua; outbox = công việc đồng bộ được lưu bền vững cùng giao dịch.

Trên database demo riêng đã chuẩn bị Product public có Variant đủ kho: đăng nhập USER → tạo địa chỉ → PUT Variant/quantity vào Cart → preview → POST /checkouts trong Swagger với đúng body preview và key ngẫu nhiên 16–128 ký tự `[A-Za-z0-9_-]`. Nhận 201; giữ nguyên key/body gọi lại nhận 200 cùng checkoutId/orders. GET Cart chỉ mất dòng đã mua; DB có Order/Item/Payment UNPAID/history/movement/outbox. Dùng key khác khi giỏ đã tiêu thụ sẽ bị chặn. Phí ship demo 0đ, không tuyên bố giao/thu COD thật.
