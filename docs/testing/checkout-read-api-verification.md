# Checkout preview và tra biên nhận — kiểm chứng API chỉ đọc

Ngày 08/10/2026; Hoàng triển khai, Hiền review DB/nghiệp vụ; Đạt theo dõi điểm nối Search. **PR #36 IN_PROGRESS, chưa merge; không phải Checkout/COD hoàn chỉnh.** Baseline `develop c6e0ba1`, tiếp nối commit nền `f1666b2` trên cùng branch `codex/checkout-cod`. Nguồn yêu cầu là [contract đã merge #29](../api/cart-order-inventory-api-contract.md), mục 5.1, 5.5, 10–11; không tự thiết kế lại SRS theo code.

## 1. Có gì mới và chưa có gì

Bản này là ảnh chụp bước preview/lookup tại head `38fda70`. Bước create COD tiếp theo trong PR #36 được kiểm chứng riêng tại [checkout-cod-api-verification.md](checkout-cod-api-verification.md); các số test/giới hạn “chưa có create” dưới đây thuộc bước đọc, không phải trạng thái branch mới nhất.

| Thành phần | Trạng thái trên branch | Ranh giới |
|---|---|---|
| POST /checkout/preview | Có controller/service, JWT, validation, parser/quota và E2E PostgreSQL | Chỉ đọc, không giữ/trừ kho hoặc tạo đơn |
| GET /checkouts/by-key | Có runtime đọc receipt theo Buyer/key, E2E HTTP | Chỉ đọc biên nhận đã tồn tại; không tạo Checkout |
| CheckoutModule | Đã nối AppModule/configureApp | Không đổi Auth hoặc FastAPI contract |
| POST /checkouts | Chưa triển khai | Cần transaction mua hàng, chống tạo trùng và E2E cạnh tranh |
| Order/COD/Inventory/Search integration, Buyer UI | Chưa nghiệm thu trong PR này | G-CHECKOUT và CHK/QCHK toàn luồng chưa PASS |

Không có migration mới trong phần tiếp nối này. Ba cột và trigger của migration nền vẫn giữ nguyên. Bằng chứng tại commit nền được giữ trong [tài liệu riêng](checkout-foundation-verification.md), không thay 196/182 thành số test hiện tại rồi nhận là đã chạy trước đây.

## 2. Luồng và những trường cần hiểu

Preview nhận addressId, paymentProvider=COD, items với variantId/quantity/expectedUnitPrice. ID là PostgreSQL Int dương; 1–50 Variant riêng biệt, quantity nguyên 1–99; tiền là chuỗi VND nguyên đồng, chuẩn hóa hai số lẻ, bound Decimal(14,2). Reject trường thừa ở cả object ngoài và từng item, không ép string thành ID/số lượng. expectedUnitPrice là giá người mua đã xác nhận, không phải giá được tin để tính đơn.

JWT + role USER → quota preview → chuẩn hóa input → **RepeatableRead READ ONLY** PostgreSQL → kiểm User active/role lại → địa chỉ đúng Buyer → chỉ đọc dòng thuộc giỏ Buyer đã chọn → quantity phải khớp → cấm tự mua Store mình → đọc policy công khai + Variant hiện hành → nhóm Store, tính Decimal → trả response. READ ONLY là ràng buộc ở DB, không chỉ cam kết trong code. maxWait=2s, timeout transaction=5s, statement_timeout=2s, lock_timeout=1s.

Snapshot = một bản đọc nhất quán trong lần preview. Không phải đặt chỗ và không bảo đảm giá/kho còn nguyên cho request tạo đơn tương lai. Tài khoản chỉ có một role theo Auth hiện hành; multi-role là task riêng.

Product/Variant không còn public: chỉ variantId, quantity, VARIANT_NOT_AVAILABLE trong unavailableItems; không lộ giá, tên, ảnh, Store, Brand hoặc lý do kiểm duyệt. Dòng public ưu tiên INSUFFICIENT_STOCK trước PRICE_CHANGED. canCheckout=false khi có lỗi; tổng toàn checkout null, bốn tổng của group lỗi null. Group không lỗi có thể có tổng nhưng **không được đặt hàng bằng tổng một phần**. Shipping/discount demo đều 0.00, shippingMode=DEMO_ZERO_V1, không phải miễn phí vận chuyển thực.

Lookup dùng **header** Idempotency-Key ASCII 16–128, không query/body. PostgreSQL đọc theo buyerId + key trong snapshot READ ONLY; kiểm hashVersion/receiptVersion và receipt allowlist, trả receipt gốc + replayed=true. Không đọc lại Cart, địa chỉ, giá hoặc trạng thái Order/Payment để dựng biên nhận. PENDING → 409 + Retry-After:2; legacy không đủ provenance → 409 CHECKOUT_LEGACY_REVIEW_REQUIRED; receipt v1 hỏng → 500 an toàn, server chỉ log checkoutId. Sai Buyer và không tồn tại cùng 404. **404 không chứng minh request tạo đơn trước đó chưa commit.**

## 3. Bảo vệ HTTP và lỗi đã phát hiện/sửa

- CORS chạy trước parser: trình duyệt được đọc envelope lỗi 413/400 an toàn. Cache-Control:no-store cả response thành công/lỗi.
- POST Checkout chỉ JSON, giới hạn **64 KiB sau giải nén**, không tin Content-Length; kiểm chunked/gzip, alias hoa/thường và slash cuối. Không áp giới hạn này vào Auth/Address/Cart.
- Nest nhận biết parser theo tên middleware jsonParser. Chỉ thêm parser scoped sẽ làm Nest bỏ parser JSON mặc định, phá API cũ. Full E2E phát hiện regression này; đã giữ parser mặc định rõ ràng sau parser/error-handler Checkout, rồi chạy lại toàn bộ suite. Test đăng ký hợp lệ bảo đảm không nhầm “400 do body bị bỏ qua” là validation hoạt động.
- GET body có thể bị adapter bỏ qua, nên @Body kiểm tra đơn thuần không đủ. Lookup từ chối Content-Length>0 hoặc Transfer-Encoding trước parse; đã test cả body có độ dài và chunked GET. Không echo key/body/token/PII vào lỗi.
- Hai bucket quota riêng: preview 20/phút/User, lookup 20/phút/User, 429 + Retry-After. Cấu hình CHECKOUT_PREVIEW_RATE_PER_MINUTE và CHECKOUT_LOOKUP_RATE_PER_MINUTE; giá trị không phải số nguyên dương làm startup fail. Map tối đa 10.000 bucket, xóa hết hạn, không evict bucket sống để né limit.
- Quota này là **per-instance/in-memory**: restart reset và nhiều replica không chia sẻ. Không mô tả là rate limiter phân tán hay quota chống lặp create; phần create chưa có.

## 4. Kiểm thử ngày 08/10/2026

Database riêng `bckl_checkout_foundation_20261008_a`, không migrate/seed demo `klcn_ecommerce`. Credential chỉ nằm trong môi trường tiến trình; E2E tắt cron Search sync/reconciliation/image repair theo setup chung. HTTP chạy qua Nest app thật, không mock DB/HTTP cho các ca preview/lookup. Lookup tạo fixture receipt trực tiếp trong DB và cố ý không tạo Order thật: đây **không phải** bằng chứng create COD.

| Kiểm tra | Kết quả |
|---|---|
| Backend unit | PASS 213/213, 15 file; thêm 17 unit guard/transaction-boundary |
| Backend E2E toàn bộ | PASS 223/223, 16 file; 41 ca HTTP Checkout mới |
| Backend lint/build | PASS |
| Prisma validate/migrate status | PASS, 10 migration, DB test up-to-date; không đổi schema trong phần đọc |
| Full TypeScript tsc --noEmit | FAIL 13 diagnostics baseline, không thêm diagnostic ở file mới |
| git diff --check | PASS |

13 lỗi typecheck đã xác nhận tồn tại trước phần Checkout: earlyAccess trong PrismaConfig; 10 import supertest/types; ReconciliationStats.locked; thiếu declaration seed-demo-user.mjs. Không nhận toàn repo typecheck sạch dù build PASS. Cần task chất lượng riêng.

41 ca HTTP mới gồm: tổng tiền Decimal/nhóm nhiều Store/tập con giỏ; DRAFT/HIDDEN không lộ nội dung; đúng selected Variant; Store/Seller/Category/Brand/required-attribute invalidation; ưu tiên kho/giá; ownership địa chỉ/giỏ; quantity lệch và self-purchase; input/ID/quantity/51 dòng/trùng ID/tràn tiền; auth/quyền; lookup giữ receipt sau xóa giỏ/địa chỉ/đổi giá; ownership, legacy, PENDING, receipt hỏng; key không query/body; quota; chunked/gzip oversize/JSON lỗi; CORS/parser regression; Swagger. Unit bổ sung quota reset/memory/config và transaction options/actor recheck. Không gọi test tuần tự là chứng minh race đặt hàng.

Sau kiểm thử, fixture Checkout được xóa theo owner marker, fixture Product/Cart/Store/User được dọn theo FK. Không gửi fixture sang FastAPI và không thay index demo. Các ERROR log từ test cố ý gây lỗi là ca kiểm tra âm, không tự bỏ test để báo xanh.

## 5. Đọc code và thử lại

Đọc theo thứ tự:

1. Contract mục 5.1/5.5 và [kiến trúc mục 7.5.5](../architecture/system-architecture-overview.md).
2. BE/src/checkout/checkout-read.dto.ts và checkout-read.controller.ts: tên API, input/output, guard và header.
3. checkout-http.ts, checkout-read-rate.guard.ts: parser, giới hạn, envelope lỗi.
4. checkout-read.service.ts → product-public-policy.ts, checkout-money.ts và checkout-replay.ts: snapshot, điều kiện mua, tiền, receipt.
5. BE/test/checkout-read.e2e-spec.ts; hai spec unit mới cạnh service/guard.

Tại đúng checkout branch, chọn DATABASE_URL của **DB test riêng** và JWT test qua môi trường tiến trình; bảo đảm BE/.env không ghi đè sang demo. Không đưa token/credential vào command lưu Git hoặc tài liệu.

```powershell
pnpm --dir BE exec prisma validate
pnpm --dir BE exec prisma migrate status
pnpm --dir BE lint
pnpm --dir BE test
pnpm --dir BE build
pnpm --dir BE test:e2e
git diff --check
```

Thử Swagger: đăng nhập Buyer USER, Authorize Bearer token; dùng Address API chọn địa chỉ và Cart API thêm Variant **đã public** với quantity hợp lệ. Gọi preview bằng các ID thực + giá đang thấy; thử đổi expectedUnitPrice để thấy PRICE_CHANGED/totals=null. Preview không tự tạo Cart hoặc Order. Không tự chuyển Product DRAFT thành public chỉ để demo.

Tra biên nhận chỉ có kết quả khi DB đã có Checkout v1 COMPLETED hợp lệ. Với DB mới và chưa có create API, 404 là bình thường; không yêu cầu người dùng tự chèn receipt giả để báo cáo chức năng mua hàng đã chạy. Test lookup được dựng fixture trong DB riêng và dọn sau suite.

## 6. Việc tiếp theo

Create COD: khóa Buyer và đọc lại idempotency row trong Serializable transaction; replay trước Cart/address; đọc lại giá/kho/public, kiểm tiền, một Order mỗi Store; Stock/Checkout/Order/items/Payment/history/movement/Cart/receipt/Product.version/SearchOutbox nguyên tử; retry có giới hạn. Sau đó test rollback, hai Buyer mua sản phẩm cuối, key/body lặp/xung đột, mất response và stock→outbox→index thật cùng Đạt. Không gọi FastAPI bên trong transaction. Buyer Checkout/Order UI và Order state machine tiếp nối sau API; không tự merge PR #36.
