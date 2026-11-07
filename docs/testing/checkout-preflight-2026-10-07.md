# Checkout/COD preflight — 07/10/2026

Trạng thái: **PREPARATION**, không có Checkout API/migration mới trong thay đổi này. Theo dõi [task Hoàng #33](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/issues/33); phối hợp [Hiền/Đạt #32](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/issues/32).

## 1. Nguồn và phạm vi đã kiểm

Checkout kế thừa SRS v3.1, scope P0/P1 và contract #27. Cập nhật ngày 08/10: chi tiết Q1–Q7 ở [PR #29 head đã review 6cbaeb1](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29) đã được Hiền và Đạt approve; [review Search của Đạt](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#pullrequestreview-5439915734). #29 đã merge vào `develop` tại `c6e0ba1`. Không coi review tài liệu là runtime PASS.

Rà checkout source từ `origin/develop 6663fab`: `BE/prisma/schema.prisma`, hai migration Cart–Order/district, `BE/src/app.module.ts`, CartService/AddressService, `product-public-policy.ts`, `search-outbox.service.ts`, `transaction-conflict.ts`, `configure-app.ts`, `main.ts`, test `cart-order-inventory-schema.e2e-spec.ts` và cấu hình E2E.

`6663fab` ở trên và trong kết quả mục 6 là baseline lịch sử lúc audit/test, không phải head develop hiện tại. Đọc kiến trúc tổng thể tại [overview](../architecture/system-architecture-overview.md); mục Cart trên baseline audit cũ còn ghi chờ merge. Bản đồng bộ trạng thái đã merge qua #29 tại `c6e0ba1`; không sửa chồng file kiến trúc trong PR preflight này. Chưa bổ sung component/runtime mới.

Đạt đã chuẩn bị [runbook/preflight #35](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/35) head `88e1c78`, CI xanh; Hiền approve ngày 08/10, Hoàng còn review. Công cụ chỉ kiểm tra nền, **integrationStatus=NOT_RUN**; CHK-S01–S03 chỉ chạy sau khi có Checkout runtime, CHK-S04 chờ Order/cancel.

## 2. Kết quả rà code

| Thành phần | Có thật trên develop | Điều kiện cho Checkout |
|---|---|---|
| Checkout | Bảng, buyer/key unique, requestHash, status/completedAt | Chưa có hashVersion/receiptVersion/receiptJson và controller; tạo migration mới sau review |
| Order | Snapshot địa chỉ/tiền, một Order mỗi checkout/store, FK cùng Buyer | Không lấy Order hiện hành để dựng lại biên nhận gốc khi replay |
| OrderItem/Payment/Movement | Composite FK đúng Product/Variant/Store, check tiền nguyên đồng, movement unique và chiều stock | Service phải ghi cùng transaction, không chỉ dựa vào schema |
| Cart | USER active, absolute PUT quantity, Serializable + lock User, read public policy | Checkout phải dùng cùng lock User; không gọi public CartService trong tx để mở transaction khác |
| Address | Ownership, default atomic, READ COMMITTED + lock User, district nullable trong schema | Snapshot bằng tx client sau lock; replay hoàn tất trước khi kiểm địa chỉ/giỏ hiện hành |
| Public policy | listingInclude, isPublicListing, displayVariants/publicProduct | Đọc Product/categories trong cùng tx; selected Variant phải hợp lệ, public không đồng nghĩa còn kho |
| SearchOutbox | Write bằng tx caller, immutable upsert, unique target/Product/version | Một version/event mỗi Product sau stock mutation; ghi outbox lỗi rollback toàn Checkout; giữ APPROVED nếu chỉ đổi kho |
| Retry | P2034 hoặc adapter conflict 40001/40P01 | Checkout giới hạn 3 attempts theo #29, không copy giới hạn 5 của Cart/Address |
| HTTP bootstrap | ValidationPipe strict field, CORS/cookie/static assets | Body limit Checkout 64 KiB cần đặt trước parser; guard sau parse không đủ. Không phá upload Product |

Không phát hiện controller Checkout trong AppModule; các test schema hiện chỉ chứng minh FK/check constraint, không chứng minh đặt hàng/rollback/replay. Khi tạo PR chỉ thêm tài liệu/audit này, full Backend lint/build/unit/E2E **chưa chạy lại**; lượt kiểm tiếp ngày 07/10 đã chạy như mục 6. Không sửa BE/FE/AI hay Prisma schema.

## 3. Audit PostgreSQL thực tế — chỉ đọc

Script [checkout-preflight-audit.sql](checkout-preflight-audit.sql) dùng `REPEATABLE READ READ ONLY`, timeout, chỉ aggregate/schema/constraint/index, cuối `ROLLBACK`. Không in địa chỉ, người nhận, key/hash đầy đủ hoặc credential. Kết nối đứt hoặc lỗi ON_ERROR_STOP tự kết thúc transaction, không có write để commit.

Docker Server 29.7.2; chỉ kiểm container `bckl_postgres` (`postgres:17-alpine`). Không tác động container seminar hay chạy migration/seed lên demo.

| Database được chọn | Kết quả 07/10 | Ý nghĩa |
|---|---|---|
| `klcn_ecommerce` (demo) | 7 migration hoàn tất; thiếu `20260930143000_cart_order_inventory_foundation` và `20261003140000_nullable_address_district`. Chưa có checkouts/orders/order_items/payments/stock_movements/cart_items. Guard audit dừng với CHECKOUT_PREFLIGHT_SCHEMA_NOT_READY | **BLOCKED_SCHEMA**; không được báo legacy checkout count=0 hoặc database up-to-date |
| `bckl_cart_test_20261003` (test có sẵn) | 8 migration hoàn tất; thiếu nullable district. Có 7 bảng audit yêu cầu; 0 Checkout/Order/Item/Payment/Movement, các aggregate vi phạm trả 0; đọc được 27 constraint và 24 index; kết thúc ROLLBACK | Audit SQL thực thi được ở schema nền Cart. **Không phải** schema cuối đã đồng bộ, không là bằng chứng legacy demo sạch hoặc test business Checkout PASS |

Đã xác minh unique index `(buyerId,idempotencyKey)`, `(checkoutId,storeId)` và `(orderItemId,type)` hiện có trên DB test. Chưa có hash/receipt version trong cả schema source và DB test. Ngay cả hash giống SHA-256 cũng không chứng minh canonical input version; không backfill bằng regex.

### Chạy lại an toàn

Đứng tại root checkout chứa script, chọn **chính xác** DB muốn audit:

```powershell
Get-Content docs/testing/checkout-preflight-audit.sql -Raw |
  docker exec -i bckl_postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d klcn_ecommerce
if ($LASTEXITCODE -ne 0) { throw 'Checkout audit chưa đạt; đọc lỗi trước khi tiếp tục.' }
```

Lệnh trên cố ý dừng trên DB demo hiện chưa đủ schema. Script không tự deploy migration. Không chạy nhiều DB nối tiếp rồi chỉ nhìn exit code cuối: mỗi lần phải giữ kết quả/exit code riêng.

## 4. Việc kế tiếp theo thứ tự

1. Dependency thiết kế #29 đã được Hiền/Đạt approve và người dùng merge tại `c6e0ba1`. Bắt đầu implementation trên baseline này hoặc develop mới hơn đã xác minh; không chờ lại review đã hoàn tất. Agent không tự merge PR.
2. Trước demo Address/Cart: backup đúng DB demo, kiểm migration cũ/backfill và deploy **hai migration đã merge** từ develop mới nhất; audit lại. Đây chưa được làm trong PR này, không tự sửa dữ liệu.
3. Tạo branch implementation riêng; thiết kế migration mới thêm hash/receipt versions nullable, constraint cho record mới, không sửa migration đã dùng chung. Row cũ thiếu provenance không được tự gán v1 hoặc dựng receipt từ Order đã biến đổi.
4. Viết helper hash/Decimal và preview → atomic create COD/receipt → read-only lookup; rate/body/retry theo Q1–Q7. Không gọi HTTP/email trong transaction.
5. Database test mới đã đủ migration như mục 6; tiếp theo bổ sung fixtures marker, cleanup theo FK và CHK/QCHK/race dùng connection độc lập khi triển khai Checkout. Sau Checkout hoạt động mới chạy CHK-S01–S03 với Đạt, không dùng HTTP mock làm integration proof.
6. Cập nhật kiến trúc với luồng thực sự thêm mới; Swagger/SRS/test traceability cùng PR. Buyer UI/Order và gate G-CHECKOUT vẫn chưa DONE.

## 5. Kiểm tra của đợt này

- Audit SQL thực thi trên DB Cart test: **PASS ở mức script**, có cảnh báo thiếu migration district.
- Database thiếu schema: **guard từ chối đúng dự kiến**; readiness demo vẫn BLOCKED, không gọi là audit toàn dữ liệu PASS.
- DB read-only snapshot/constraint/index: đã kiểm như bảng trên; không chạy migration/backfill/seed hoặc sửa stock.
- CHK/QCHK/Checkout E2E: **NOT_RUN, API chưa triển khai**. Không lấy các dòng `count=0` ở DB test trống làm test tính đúng giao dịch.
- Diff hygiene/link/file scope: kiểm trước commit; kết quả ghi trong mô tả PR.

**Preflight** = kiểm tra nền trước triển khai; **legacy** = bản ghi cũ chưa chứng minh phiên bản quy tắc; **receipt** = kết quả checkout gốc lưu bất biến; **canonical hash** = dấu kiểm request được chuẩn hóa theo phiên bản; **constraint/index** = ràng buộc/chỉ mục DB; **rollback** = hoàn tác giao dịch.

## 6. Kiểm tiếp sau re-review #29 — 07/10/2026

PR #29 được rà đúng head `6cbaeb1`: chỉ 10 Markdown, 43 link nội bộ tồn tại, 15 JSON examples parse được, code fence cân bằng, không conflict marker và diff-check PASS. Hiền approve đúng head; hai CI check SUCCESS. [Comment re-review](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-6032598585) lưu kết quả tại thời điểm còn chờ Đạt. Cập nhật trạng thái 08/10: Đạt đã approve Search tại review `5439915734` và người dùng đã merge #29 tại `c6e0ba1`; không còn task chờ review/merge #29. Các số liệu test sau đây vẫn thuộc baseline lịch sử lúc chạy, không phải test mới của Checkout.

Đã tạo database test riêng `bckl_checkout_preflight_20261007_a`, deploy **9 migration hiện có** từ Backend baseline. Không tạo migration mới, không deploy/seed lên `klcn_ecommerce` và không sửa mật khẩu PostgreSQL. Database này được giữ lại cho kiểm thử kế tiếp, không phải database demo. Source BE của checkout dùng chạy test có Git tree `a70807ed3cb2fd1960aca94b638a8e28e4b5e016`, bằng đúng tree BE của `origin/develop 6663fab`.

| Kiểm tra | Kết quả | Phạm vi bằng chứng |
|---|---|---|
| Prisma migrate deploy | PASS, 9/9 migration áp dụng | Chỉ DB test mới; schema source không đổi |
| Prisma validate | PASS | Schema hợp lệ, không chứng minh service Checkout |
| Backend lint | PASS | Không lỗi lint |
| Backend unit tests | PASS, 122/122, 11 files | Tests hiện có, không có Checkout service mới |
| Backend build | PASS | Prisma Client generate + Nest build; không thay thế kiểm typecheck toàn bộ riêng |
| Backend E2E | PASS, 158/158, 14 files, 55.84 giây | Luồng Backend hiện có trên DB test mới, gồm Address/Cart; không phải CHK/QCHK |
| Audit SQL sau E2E | PASS, READ ONLY/REPEATABLE READ, ROLLBACK | 9 migration, không thiếu migration yêu cầu; 7 bảng đầy đủ, 27 constraints/24 indexes |
| Aggregate audit | 0 Checkout/Order/Item/Payment/Movement; các aggregate vi phạm = 0 | DB test sau cleanup, **không suy ra dữ liệu demo sạch hay giao dịch Checkout đúng** |

Lần E2E đầu không khởi tạo được Auth vì worktree thiếu `JWT_ACCESS_SECRET`. Đã cung cấp hai JWT secret **chỉ dùng test** trong môi trường tiến trình rồi chạy lại toàn bộ thành công; không ghi secret vào repo. Kết nối DB dùng cấu hình local hợp lệ, thay đúng tên DB test, không in credential. Các log lỗi do test cố ý gây transaction/outbox/file/HTTP failure là ca kiểm thử âm, không phải failure của lượt chạy cuối.

Còn cảnh báo `pg` về query đang chạy trên cùng client và thông báo Vite hỗ trợ tsconfig paths native; không sửa dependency ngoài phạm vi. Không gọi suite này là integration Elasticsearch/FAISS thật. **CHK/QCHK và G-CHECKOUT vẫn NOT_RUN/chưa hoàn thành**. DB demo vẫn giữ kết quả thiếu hai migration ở mục 3, chưa được nâng cấp hoặc audit lại.
