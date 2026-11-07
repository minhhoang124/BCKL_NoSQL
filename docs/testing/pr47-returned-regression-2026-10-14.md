# PR #47 — tăng kiểm thử hàng giao thất bại quay về, 14/10/2026

## Phạm vi và nguồn

Nhánh codex/order-returned-confirmation, head trước sửa ac7d003, nền f267399
có DeliveryAttempt #45. Đáp ứng đề nghị không chặn của Hiền tại review ac7d003,
theo contract order-returned-command-contract và quy tắc StockMovement/Outbox đã
chốt; không sửa SRS ngược từ code. Chỉ thêm test/tài liệu, production service,
schema/migration, FastAPI, lockfile và FE không đổi.

Đợt này không sync develop hoặc ghép #43/#44/#46 chưa tích hợp vào nhánh #47.
Develop đã có #43 tại 515f68a, nhưng kết quả dưới đây không phải test nền đó
hoặc toàn luồng Checkout→Seller→shipping→return. Sau các merge trước #47 phải
sync, xử lý conflict và chạy lại head kết hợp.

## Bằng chứng mới

| Ca kiểm thử | Đối chiếu |
|---|---|
| Public APPROVED, hai Variant Color liên kết đúng option group/value, stock 0→2/3 | Hai item quantity 2/3 có decrement tương ứng; HTTP Seller cùng key qua hai app nhận một thực thi/một replay. Một restore/item, Product version 7→8, chỉ một event |
| Full UPSERT | Exact JSON productId/version/name/description/categoryId/name/path cha–con/brandId/name/Material/images primary trước/Decimal min=10000,max=25000/inStock=true; expected độc lập builder |
| Public Product GET | Trước return 200/inStock=false, sau return 200/inStock=true, giá đúng hai Variant; không chỉ gắn nhãn APPROVED rồi đoán public |
| Store SUSPENDED hoặc Category inactive | Admin vẫn hoàn hàng cũ nhưng public GET 404; stock 2/3, APPROVED giữ, version tăng một và exact DELETE {productId,version}; replay không thêm event |
| Ledger CANCELLATION_RESTORE/RETURN_RESTORE có sẵn trên item thứ hai | 409 ORDER_INVENTORY_REVIEW_REQUIRED, toàn bộ snapshot DB không đổi, không hoàn item đầu một phần |
| Product.version=MAX_INT | 409 INVENTORY_STATE_CONFLICT; cả hai stock/movement/claim/order/payment/history/outbox rollback, không reset version |
| Product.version=MAX_INT-1 | Thành công đúng MAX_INT, một event; replay giữ nguyên kho/version/event tại biên |
| Seller tạo receipt SUCCEEDED thật rồi account bị khóa | Cùng key trên hai app và key mới đều 401; DB không đổi. Khôi phục active cho replay trả receipt gốc, không xử lý lại |
| Seller bị thu hồi role sau receipt thật | JWT cũ replay 403, DB không đổi. Buyer không gọi được cả Admin/Seller route |

Multi-Variant fixture riêng có parent/leaf Category, Brand, thuộc tính bắt buộc
Material, ảnh chính/phụ, khối lượng, option links và hai mức giá. Tổng snapshot
95000 VND. State assertion gồm Checkout/Order/items/Payment/attempts/commands/
history/all Variants/movements/outbox; snapshot hàng/địa chỉ/tiền không đổi.
New key của Seller hoặc Admin khác không được restore lại sau Order CANCELLED.

DELIVERY_FAILED/attempt/ledger là fixture có nhãn, không giả đã gọi API #46.
Ảnh là URL fixture để kiểm shape/thứ tự, không bằng chứng serving file/index thật.
Category/Store đổi bằng Prisma fixture, không nhận nghiệm thu parent mutation API.
Hai Nest apps/pools là hai instances trong suite, không gọi là hai OS processes.

## Kết quả thực chạy

PostgreSQL 17 QA riêng: bckl_pr47_returned_20261014 tại loopback port 5549,
container bckl-checkout-web-qa-20261012. Fresh DB áp đúng 12 migration của
checkout; không thao tác DB demo. Không root/BE .env; cấu hình QA ở process,
cron Search/reconciliation/image repair tắt theo test setup.

| Kiểm tra | Kết quả |
|---|---|
| Frozen install/postinstall Prisma generate | PASS, reuse 585 packages, không đổi lockfile |
| Prisma validate/fresh migrate deploy | PASS, 12 migrations |
| Backend full typecheck/lint/build | PASS |
| Unit | 409/409 PASS, 20 suites |
| Targeted confirm-returned E2E | 20/20 PASS, 19.66s |
| Full Backend PostgreSQL E2E | 372/372 PASS, 22 suites, 96.06s |
| FE lint/test/build | PASS, 23/23 test, 6 suites của checkout này |
| Diff check | PASS |

20 return cases = 12 cũ + 8 mới; ca blocked Seller cũ được tăng chứng cứ,
không chỉ đổi tên. Lượt typecheck đầu phát hiện mảng fixture thiếu kiểu;
đã thêm ProductVariant type và rerun PASS, không nới TypeScript hoặc skip test.
Logs fault SQL/malformed response là test có chủ đích. pg/Vite warnings nền
vẫn tồn tại, không nhận đã sửa. Không chạy lại AI suite vì AI không thay đổi;
CI head mới sẽ kiểm riêng.

Cleanup chỉ ID fixture đã tạo, giữ thứ tự FK: ledger/history/command/payment/
items/attempts/order → Checkout/outbox/Variant/Product → Category lá/cha →
Brand/Store/User. SQL đếm sau full suite: 0 User/Product/Brand/Category của
fixture returned; giữ database QA để kiểm lại, không reset/drop DB.

## Checklist bàn giao

- [x] Nhiều Variant/một Product: ledger từng item, một version/event.
- [x] Exact full UPSERT và DELETE, public/no-public được kiểm bằng HTTP.
- [x] Chặn restore cũ/new-key lặp và overflow; kiểm biên cuối hợp lệ.
- [x] Khóa/thu hồi role sau receipt thật, replay không vượt quyền hiện hành.
- [x] Full regression + cập nhật kiến trúc/phạm vi bằng chứng.
- [ ] Hiền/Đạt re-review đúng head mới và CI.
- [ ] Sync #47 sau các PR Order trước merge, rerun toàn luồng/API detail.
- [ ] ES/FAISS nhận event, serving ảnh thật và Web workflow chưa chạy đợt này.

Chưa nghiệm thu refund P1, Order UI hoặc G-FULFILMENT; không tự merge PR.
