# Kiểm chứng API danh sách đơn Buyer/Seller

Cập nhật 09/10/2026, branch `codex/order-list-api` / PR #37 đã merge `develop a2561c1` sau khi #36/#39 được merge. PR #37 vẫn IN_PROGRESS/chưa merge. Hiền approve head cũ e6f4427; integration mới cần re-review. Bằng chứng 08/10 ở bên dưới là lịch sử, không thay kết quả bản kết hợp mới.

## Kiểm chứng bản kết hợp ngày 09/10

Giải quyết 5 conflict cấu hình/module/tài liệu, giữ cả OrderModule và CheckoutModule. Order GET body guard chạy trước mọi JSON parser; parser Checkout giới hạn 64 KiB và parser mặc định cho Auth/Cart vẫn giữ. Không đổi schema, migration hay business contract. Migration receipt từ #36 chỉ được deploy trên database kiểm thử riêng.

| Kiểm tra | Kết quả local 09/10 |
|---|---|
| Frozen install / Prisma generate | PASS; không sửa lockfile |
| Full Backend TypeScript | PASS, không còn 13 diagnostics nền sau tích hợp #39; không tắt strict |
| Backend lint / build | PASS |
| Backend unit | PASS **270/270**, 17 files |
| Full Backend E2E | PASS **293/293**, 18 files, 79.94s; 21:31–21:32 |
| Prisma validate / migrate deploy | PASS; 10 migrations trên `bckl_order_list_20261008_a` |

Hai ca tích hợp mới trong `BE/test/checkout-create.e2e-spec.ts`, nằm trong 293 E2E (không cộng lần hai):

1. HTTP thật `GET /cart` → `POST /checkout/preview` → `POST /checkouts` → Buyer `GET /orders` / Seller `GET /seller/orders`. Danh sách có đúng Order ID/số đơn/Store/tổng tiền/trạng thái COD vừa commit, no-store và không lộ địa chỉ/phone/key/hash. Đọc danh sách rồi replay Checkout qua app instance thứ hai không làm thay đổi Order, kho, movement, version, giỏ hoặc outbox.
2. Checkout hai Store tạo hai Order. Buyer chỉ thấy hai đơn của mình, mỗi Seller chỉ thấy Order đúng Store mình; Buyer khác nhận danh sách rỗng. Các lần đọc không mutation.

Chạy actual AppModule/configureApp, hai Nest app/Prisma client và PostgreSQL thật. JWT test được ký cho fixture User đang hoạt động; không mock giao dịch hay API Checkout/Order. Đây là **integration Backend**, chưa chứng minh browser/UI, Order detail/commands, delivery hoặc Checkout → FastAPI/dual-index. E2E vẫn có cảnh báo baseline pg concurrent-query và vite-tsconfig-paths; các log lỗi cố ý trong ca rollback/malformed response không phải lỗi ngoài test.

Không migrate/seed DB demo. Sau suite xác nhận 0 User `checkout-create-*`/`order-list-*`, 0 Checkout, 0 Order và 0 StockMovement trên DB test. Không nhận CI head cũ là CI của bản tích hợp mới. Git diff-check và CI mới phải đối chiếu lúc push.

## Bằng chứng lịch sử ngày 08/10

Baseline lúc chạy riêng `develop c6e0ba1`, chưa có #36/#39; các số sau không cộng với bảng 09/10.

## Phạm vi và kết quả

`GET /orders`, `GET /seller/orders`; chỉ đọc summary + cursor/status filter theo ownership. [Thiết kế và các điểm cần Hiền review](../architecture/order-read-backend-readiness.md) ghi rõ projection list, legacy payment nullable và các trường audit còn thiếu cho API detail. Không có detail, cancel/confirm/complete, stock restore hoặc UI trong đợt này.

| Kiểm tra | Kết quả local |
|---|---|
| Cài đặt | `pnpm install --frozen-lockfile` PASS, postinstall sinh Prisma Client, không đổi lockfile |
| Backend lint | PASS |
| Backend unit | PASS 166/166, 12 files; gồm 44 ca Order query/limiter |
| Backend build | PASS Prisma generate + Nest build |
| Full Backend E2E | PASS 190/190, 15 files, 63.68s; 23:53–23:54 ngày 08/10 |
| Order list E2E | 32 ca nằm trong 190; không cộng lần hai |
| Migration | 9 migration đã merge deploy thành công trên DB riêng mới; không tạo/sửa migration |
| Full TypeScript check | Còn 13 diagnostics baseline ngoài Order; diagnostic TS7022 trong test mới đã sửa, chạy lại không còn diagnostic Order |

Database riêng `bckl_order_list_20261008_a`, PostgreSQL 17 Docker; không migrate/seed DB demo. Cleanup sau suite xác nhận 0 fixture User `order-list-*`, 0 Checkout, 0 Order, 0 StockMovement. E2E tắt cron Search/reconciliation/image repair để không xử lý dữ liệu ngoài fixture.

Lượt đầu phát hiện thiếu PassportModule options cho JwtAuthGuard; đã bổ sung đúng mẫu module hiện có rồi chạy lại E2E. Một diagnostic TypeScript ở kiểu response trong vòng lặp cursor đã được sửa bằng type Response từ top-level supertest, không thêm đường dẫn supertest/types đang lỗi ở baseline. Giữ các cảnh báo baseline pg concurrent-query và vite-tsconfig-paths; không tuyên bố toàn repo typecheck sạch vì build pass.

## Ma trận E2E

- Buyer chỉ thấy Order của mình qua nhiều Store; Seller chỉ thấy Store của mình qua nhiều Buyer. Actor không có Order/Store nhận trang rỗng.
- Status filter trong ownership; không nhận client buyerId/storeId/offset hoặc enum giả; query array/duplicate/bounds sai bị từ chối.
- Cursor id DESC; không cần Order cursor tồn tại; cursor thuộc người khác không mở quyền đọc; page cuối null; insert mới giữa hai trang không trùng kết quả. Default 20/max 50 được kiểm tra với 51 fixture Orders.
- Allowlist summary, Decimal bound `999999999999.00` giữ exact; không phone/address/key/hash/buyerId/checkoutId. Order/Payment status hiện hành, không receipt Checkout. Legacy Payment thiếu trả null, không tự sinh dữ liệu.
- Store SUSPENDED vẫn đọc lịch sử khi Seller active. User inactive/token role cũ bị kiểm lại theo DB; service kiểm actor thêm trong transaction.
- 401/403/400/429/500 no-store, lỗi an toàn; GET body kể cả JSON hỏng và alias bị chặn trước parser; rate limit có Retry-After và độc lập User.
- GET lặp không mutation. Test bọc transaction **thật** của service để đọc `transaction_read_only=on`, thử UPDATE no-op thực trong cùng transaction bị PostgreSQL từ chối P2010; không dùng mock DB làm bằng chứng READ ONLY.
- Swagger có hai list API, không có detail/command chưa triển khai.

Fixture Order/Checkout/Payment được tạo riêng cho read test, không chạy POST /checkouts hoặc trừ kho. E2E này không chứng minh Checkout → Order list trên branch kết hợp; phải chạy bổ sung sau #36 merge. Không gọi FastAPI/Elasticsearch/FAISS trong list; đọc Order không phát outbox.

## Chạy và demo

Trên database kiểm thử riêng có 9 migration baseline, cấu hình DATABASE_URL/JWT secrets bằng process env, không commit `.env`; chạy Backend lint/unit/build và `pnpm --dir BE test:e2e`. Không dùng lệnh seed/reset/drop trên DB demo để chạy test.

Swagger: đăng nhập USER → GET /orders với status/limit/afterId; đăng nhập SELLER → GET /seller/orders. Nếu chưa có Order hợp lệ trên database đang chạy sẽ trả rỗng, không tự thêm đơn giả vào dữ liệu của người dùng. Sau khi #36 tích hợp, dùng đơn COD thật từ flow Cart/Checkout để demo create → list.

Chưa có CI của commit mới tại thời điểm ghi bảng local. Khi push, đối chiếu đúng head trên PR; không dùng CI #36 làm bằng chứng branch này.
