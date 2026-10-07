# Checklist Backend Checkout/COD — chuẩn bị trước implementation

Ngày: 04/10/2026; cập nhật review ngày 05/10/2026. Chủ trì: Hoàng; Hiền review nghiệp vụ/test, Đạt review stock → outbox → index. **PREPARATION/TARGET: không có API Checkout mới trong PR tài liệu này.**

## 1. Nguồn chuẩn và baseline đã rà

- [SRS v3.1](../analysis/hien/srs-v3.md): FR-CAR-01, FR-CHK-01, FR-PAY-01, FR-ORD-01, FR-CAN-01, D06/D07.
- [Contract #27 đã merge](../api/cart-order-inventory-api-contract.md): mục 5, 10–13; chuẩn hóa hash/replay, subset giỏ, COD và transaction.
- [Thiết kế miền](cart-order-inventory-design.md); schema/migration #26 đã merge. Không sửa migration cũ.
- `develop 6663fab` ngày 05/10: có schema nền, Address/migration district nullable #30 và Cart Backend #31; chưa có Checkout controller.
- #30 đã merge. #31 đã được người dùng merge tại `6663fab` ngày 05/10; review Hiền đúng head `979ef58`, CI xanh, giữ Address/Cart.
- [CI #31](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/actions/runs/37256392693): Backend unit 122/122; E2E 158/158 (Cart 31, Address 22); Python 129 passed. Đây là bằng chứng Address/Cart, **không** phải test Checkout. Local E2E lượt sync chưa chạy vì Docker không sẵn sàng.
- File đã rà: `BE/prisma/schema.prisma`, `BE/src/auth/jwt.strategy.ts`, `BE/src/product/transaction-conflict.ts`, `BE/src/search/search-outbox.service.ts`; `BE/src/cart/cart.service.ts` từ #31. Đường dẫn tương đối root repo.

Checklist không thay contract đã duyệt, không nhận các mục dưới đã code/test. Không tự sửa SRS theo lỗi implementation.

## 2. Thứ tự và phạm vi PR

1. #30 đã được người dùng merge; agent không tự merge.
2. #31 đã merge tại `6663fab`, giữ AddressModule/CartModule/cấu hình/migration/docs; dependency Cart Backend đã hoàn tất ở mức API, không nhận Buyer UI DONE.
3. #31 đã merge; sau bản đồng bộ #29 được re-review, tạo branch Checkout riêng từ develop mới nhất; không xếp chồng feature branch hoặc gộp Checkout vào #31.
4. Sau khi bản đồng bộ contract #29 được re-review, PR Checkout/COD: audit legacy, migration mới Checkout.hashVersion/receiptVersion/receiptJson, preview/create/lookup, stock/outbox transaction, DTO/Swagger/E2E. Order read có thể là task kế tiếp; chưa nhận Order lifecycle hoàn thành.
5. PR Order riêng: OrderCommand, cancellation audit/history, DeliveryAttempt, state machine, cancel/restore, COD DELIVERED và job D07. Không gộp toàn bộ vào Checkout.
6. Hoàng giữ Buyer Checkout/Order UI và Seller Order UI. Hiền CODE hai màn Buyer Address/Cart và Admin; Đạt giữ AI/Search/evaluation.

## 3. Phần có thể tái sử dụng và khoảng trống

| Phần | Bằng chứng | Cần bổ sung ở Checkout |
|---|---|---|
| Auth | JwtStrategy đọc User active, role đơn | Kiểm tra USER/active lại trong transaction; không đổi đa quyền trong task |
| Cart concurrency | #31 khóa hàng User, Serializable/retry | Checkout dùng cùng khóa Buyer để không tiêu thụ sai dòng khi PUT/DELETE cạnh tranh |
| Public policy | listingInclude, isPublicListing, displayVariants | Kiểm tra đúng Variant được chọn, không lấy Variant hợp lệ khác thay thế |
| Checkout | Unique buyer/key, requestHash/status/orders | Migration hashVersion cho bản ghi mới và receipt theo đề xuất được review; audit dữ liệu cũ, không đoán thuật toán hash |
| Order/Item | Một Order/Store, FK ghép, snapshot/Decimal | Tạo snapshot/tổng/history canonical, không nhận tổng client |
| Payment | Một Payment/Order | COD UNPAID; chưa nhận VNPAY/MOMO chỉ vì có enum |
| StockMovement | Unique OrderItem/type + key; FK Variant/Item | CHECKOUT_DECREMENT, balanceAfter trong cùng transaction |
| SearchOutbox | Producer dùng tx, event immutable theo Product/version | Gom Product và ghi version/event từ trạng thái cuối, không HTTP trong transaction |
| Address | #30 ownership/district nullable | Snapshot thuộc Buyer trong transaction; replay không đọc địa chỉ hiện hành |

Checkout chỉ đổi kho, **không** dùng mutation Seller làm APPROVED về DRAFT. Hết kho vẫn có thể public: UPSERT với inStock=false nếu các điều kiện khác hợp lệ; DELETE khi trạng thái cuối không public.

## 4. Luồng cần triển khai/test

### Preview — POST /checkout/preview

Validate → Buyer → snapshot nhất quán address/Cart/selected Variant → quantity phải khớp Cart → public/giá/kho → Decimal nhóm Store → preview/lỗi allowlist. Không giữ kho, không Checkout/Order/Payment/movement/outbox. Preview không cam kết giá/kho khi create sau đó.

### Create — POST /checkouts

1. Validate DTO/header key theo contract; reject trường thừa, duplicate variantId, giá không đúng tiền VND. Buyer lấy từ JWT.
2. Hash canonical v1: items sort variantId, key JSON sort đệ quy, tiền hai chữ số, SHA-256. Gồm buyerId/addressId/provider/items; không gồm Cart/địa chỉ/giá hiện hành hoặc timestamp.
3. Serializable transaction; khóa hàng User như Cart, kiểm tra actor active/USER. SQL tham số, không ghép input.
4. Đọc Checkout theo Buyer/key **trước** Cart/address/public. Phân loại hashVersion/legacy trước so sánh hash v1. Cùng hash COMPLETED/receipt hợp lệ → receipt gốc; khác hash → IDEMPOTENCY_CONFLICT. Legacy không đủ bằng chứng → CHECKOUT_LEGACY_REVIEW_REQUIRED; receipt mới hỏng → 500 an toàn, không tạo lại. Replay không trừ kho/version/outbox hoặc đụng giỏ.
5. Checkout mới: address ownership, subset Cart/quantity khớp, self-purchase, selected Variant/public; so expectedUnitPrice với Decimal canonical.
6. Cập nhật Variant theo thứ tự ID để giảm deadlock, conditional stock >= quantity; ghi balanceAfter đúng sau trừ. Retry đọc lại canonical state, không dùng dữ liệu ngoài transaction/lần trước.
7. Tạo đúng **một Checkout cho toàn request/idempotency boundary** và **một Order cho mỗi Store**; mọi Order cùng tham chiếu Checkout đó. Tạo Item snapshot, Payment COD UNPAID, history ban đầu và movement âm cho từng Order. Toàn nhóm commit/rollback nguyên tử trong cùng transaction. OrderNumber unique, sinh an toàn, không dùng count bản ghi.
8. Gom Product: tăng version một lần/Product, đọc lại đầy đủ Product bằng listingInclude và cây categories bằng **cùng tx** sau khi trừ kho; writeOutboxEvent cùng tx, product.version trong payload bằng version event. Giữ APPROVED nếu chỉ đổi kho. Payload publicProduct tính giá chuỗi decimal và inStock từ toàn bộ Variant hiển thị hợp lệ, không chỉ Variant vừa mua.
9. Xóa đúng dòng đã mua, lưu receipt v1 allowlist bất biến và Checkout COMPLETED cùng tx. Một bước lỗi → rollback toàn bộ, kể cả receipt/stock/outbox/giỏ/key.
10. Commit → 201 mới/200 replay. Mất response sau commit: cùng key/body lấy lại Order cũ, không hướng dẫn key mới vì timeout.

Unique + transaction bảo vệ nhiều process; khóa JS không đủ. Retry chỉ serialization/deadlock hữu hạn theo contract; không retry validation, PRICE_CHANGED, ownership hoặc mọi unique lỗi. Duplicate key phải phân loại đúng constraint/reload kết quả, không coi mọi P2002 là replay.

Không gọi HTTP/provider/email/WebSocket trong transaction. Lỗi ghi outbox trước commit rollback checkout; lỗi worker sau commit không rollback Order. Notification durable là task riêng, chưa nhận đã hoàn thiện nếu chỉ best-effort.

## 5. Quyết định đã được Hiền chấp thuận trước code — DESIGN/TARGET

| Điểm | Quyết định | Trạng thái |
|---|---|---|
| Q1 Preview | HTTP 200 canCheckout=false cho lỗi dòng sau request/ownership/Cart hợp lệ; priority unavailable → stock → price; totals/group lỗi null, privacy allowlist | ACCEPTED_BY_HIEN / NOT_RUN |
| Q2 Shipping | DEMO_ZERO_V1, 0.00 mỗi Store chung preview/create; nhãn mô phỏng, không config phí khác P0 | ACCEPTED_BY_HIEN / NOT_RUN |
| Q3 Limits/money | 50 dòng, quantity 1–99, 64 KiB sau giải nén; Decimal nguyên đồng/check bound trước DB, 413 hoặc VALIDATION_ERROR/reason MONEY_LIMIT_EXCEEDED | ACCEPTED_BY_HIEN / NOT_RUN |
| Q4 Rate/retry | Ingress create 60/phút + 5 intent mới/phút/User; replay hợp lệ không tính intent nhưng chịu ingress; memory per-instance; transaction tối đa 3 attempts kể cả lần đầu | ACCEPTED_BY_HIEN / NOT_RUN |
| Q5 Legacy | hashVersion nullable, new explicit v1; audit/backfill có bằng chứng; legacy/unknown 409 CHECKOUT_LEGACY_REVIEW_REQUIRED không tạo lại | ACCEPTED_BY_HIEN / NOT_RUN |
| Q6 Receipt | receipt v1 allowlist cùng transaction, bất biến; replay gốc/Order GET hiện hành riêng; new corrupt 500 an toàn | ACCEPTED_BY_HIEN / NOT_RUN |
| Q7 Timeout | GET /checkouts/by-key header/actor/no-store/no mutation; cross-owner 404; UI giữ body/key, tối đa 3 lần đối chiếu/retry có backoff | ACCEPTED_BY_HIEN / NOT_RUN |

Đây là điểm chuẩn bị Checkout, **không phải blocker review mới của #30/#31**. Không thay invariant một nhóm Order nguyên tử, không âm kho/đơn đôi, snapshot bất biến và PostgreSQL nguồn chuẩn.

Nguồn chấp thuận: [Hiền review đúng head 222f52f ngày 05/10](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#pullrequestreview-5412360700). Chi tiết/lập luận trong [quyết định Checkout/COD](../api/checkout-cod-implementation-proposal.md), field/HTTP/hash tại [contract chuẩn](../api/cart-order-inventory-api-contract.md). Bản đồng bộ mới cần re-review #29 trước implementation; không nhận runtime CURRENT hoặc test PASS. Toàn bộ CHK/QCHK vẫn NOT_RUN; timeout/backoff cụ thể và constraint SQL cần review/test trong PR code/migration.

## 6. Ma trận test chuẩn bị — tất cả NOT_RUN

| ID | Kịch bản | Kết quả bắt buộc |
|---|---|---|
| CHK-01 | Preview/public/giá đổi | Decimal/allowlist đúng, không ghi dữ liệu giao dịch |
| CHK-02 | COD nhiều Store/subset giỏ | Đúng một Checkout cho toàn request/key; một Order mỗi Store, tất cả cùng checkoutId; toàn nhóm commit/rollback nguyên tử; UNPAID/snapshot/history/movement đúng; giữ dòng không chọn |
| CHK-03 | Hai Buyer độc lập stock=1 | Chỉ một thành công, stock=0, một movement giảm |
| CHK-04 | Hai app/Prisma client cùng Buyer/key/body | Một nhóm Order; replay hoặc conflict tạm theo contract rồi retry lấy kết quả |
| CHK-05 | Cùng key khác quantity/price/address/provider | IDEMPOTENCY_CONFLICT; dữ liệu cũ nguyên vẹn |
| CHK-06 | Items reorder/giá canonical tương đương | Hash v1 tương đương theo DTO đã chốt, không đơn đôi |
| CHK-07 | Replay sau xóa Cart/address hoặc đổi giá | Nhóm Order cũ; không kiểm điều kiện mua mới để chặn replay; không tăng Product.version hay tạo thêm outbox/movement |
| CHK-08 | Hai key cùng dòng, stock đủ cả hai | Một tiêu thụ dòng; bên kia lỗi giỏ sau retry |
| CHK-09 | Cart PUT/DELETE, Address mutation cạnh tranh | Snapshot hợp lệ hoặc rollback/retry, không quantity/address nửa chừng |
| CHK-10 | Dòng giỏ người khác/quantity lệch/self-purchase | Mã lỗi đúng, không lộ dữ liệu/ghi giao dịch |
| CHK-11 | Giá/public/Variant đổi sau preview | PRICE_CHANGED/VARIANT_NOT_AVAILABLE; không âm thầm đổi giá |
| CHK-12 | Store thứ hai lỗi kho hoặc inject lỗi Payment/Item | Rollback Checkout/Order/Payment/history/stock/movement/outbox; giữ giỏ |
| CHK-13 | Mua nhiều Variant cùng Product; một Variant hết kho rồi tất cả hết kho | Mỗi checkout chỉ tăng version một lần/Product và tạo một event từ listingInclude/categories đọc lại cùng tx; payload.version = event.version. Còn Variant hiển thị hợp lệ có kho → inStock=true; tất cả hết → false. minPrice/maxPrice là chuỗi decimal do publicProduct tính từ toàn bộ Variant hiển thị hợp lệ, gồm cả Variant không mua; giữ APPROVED nếu còn public |
| CHK-14 | Inject lỗi ghi outbox, rồi retry checkout/replay | Stock, Product.version, Checkout/Order/Item/Payment/history/movement và Cart cùng rollback; không best-effort. Sau lần commit thành công, replay cùng key/body không tăng version hoặc tạo event lần nữa |
| CHK-15 | Serialization/deadlock và hết retry | Đọc lại state, không nhân bản; STOCK_CONFLICT hữu hạn |
| CHK-16 | Crash trước commit/mất response sau commit | Trước: rollback; sau: key cũ lấy Order, không trừ kho hai lần |
| CHK-17 | Inactive/sai role/ID/giá/quantity/extra fields | Guard + DTO + service thật chặn, không SQL/secret/PII trong lỗi |
| CHK-18 | Rate limit key mới/replay ở ngưỡng | Mới 429; replay đúng contract, không bypass bằng key giả |
| CHK-19 | Fresh DB + hashVersion/legacy | Không sửa migration cũ/mất dữ liệu; thiếu provenance phải báo |

Race tests dùng hai app/Prisma client/connection độc lập và synchronization có kiểm soát; không gọi tuần tự làm bằng chứng. Mô phỏng crash phải ghi rõ chưa phải kill-process test. DB riêng/fixtures marker, cron tắt như setup E2E, cleanup đúng ownership/FK; không đụng demo.

### 6.1 Điểm giao Checkout → Search — bốn ca tích hợp bổ sung NOT_RUN

Theo [review phạm vi Search của Đạt ngày 04/10](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-5982077073). Đây là yêu cầu kiểm thử cho implementation sau này, không phải kết quả đã chạy hoặc thay đổi contract FastAPI.

Luồng kiểm chứng phải dùng HTTP/index thật: checkout commit PostgreSQL → SearchOutbox → SearchSync worker → FastAPI → Elasticsearch + FAISS → Backend hydrate PostgreSQL. Dùng database/index/artifact riêng; chỉ bật worker thuộc harness kiểm thử này, không can thiệp dữ liệu demo hoặc fixtures E2E khác.

| ID | Kịch bản | Kết quả bắt buộc |
|---|---|---|
| CHK-S01 | Checkout làm hết kho; cố ý giữ index ở version cũ trước khi worker chạy | inStock=true phải loại Product không có Variant phù hợp trong PostgreSQL; giá và stock phải khớp **cùng Variant**. Không lọc stock thì Product hết kho vẫn có thể public. Sau worker, xác minh version/inStock ở cả hai index và kết quả hydrate |
| CHK-S02 | Worker lỗi sau checkout commit; một index thành công, index kia lỗi rồi retry | Order/stock đã commit không rollback. Retry giữ nguyên productId/version/operation/payload của event, không dựng lại payload từ Product mới; chỉ hoàn tất phần index còn thiếu, không nhân đôi FAISS vector. Chỉ đánh dấu event hoàn tất khi response của cả hai index đạt contract |
| CHK-S03 | Event version cũ đến sau version mới | FastAPI trả STALE; không ghi đè version/payload mới ở Elasticsearch hoặc FAISS; outbox cũ hoàn tất theo STALE semantics, không retry vô hạn. Kiểm tra trạng thái từng index theo contract, không chỉ dựa vào HTTP 200 |
| CHK-S04 | Cancel/confirm-returned hợp lệ ở PR Order sau này làm stock 0 → dương | Test khi phạm vi Order/hoàn kho được triển khai: movement hoàn đúng một lần, stock/version/outbox nguyên tử, giữ APPROVED nếu chỉ đổi kho và còn public; cùng event retry an toàn, index/hydrate cập nhật tương ứng |

**Giới hạn nhất quán:** hydrate chỉ lọc các ứng viên index đã trả. Nó không tự khôi phục Product bị index cũ loại nhầm (false negative), nên không hứa tìm kiếm đầy đủ tức thời. Bảo vệ public/giá/kho bằng PostgreSQL không đồng nghĩa index đã bắt kịp. Chưa nghiệm thu CHK-S04 trong PR Checkout/COD đầu tiên.

## 7. Checklist bàn giao và thuật ngữ

- [x] Hiền chấp thuận lựa chọn Q1–Q7 ở mức thiết kế tại review dẫn ở mục 5.
- [ ] Bản đồng bộ contract/example mới được re-review trên head cuối #29 trước schema/API tương ứng.
- [ ] Dependencies merge đúng thứ tự, branch Checkout từ develop mới nhất.
- [ ] Migration mới validate/deploy DB riêng, audit legacy và migration test.
- [ ] Backend lint/build/unit/E2E, Prisma validate/status, diff-check đạt head cuối.
- [ ] Swagger/DTO/runtime khớp; kiến trúc/API/SRS traceability cập nhật.
- [ ] Đạt test stock → outbox → index thật; HTTP mock không là integration evidence.
- [ ] UI Checkout/Order + browser evidence trước nghiệm thu G-CHECKOUT/G-FULFILMENT.

**Transaction:** nhiều thao tác DB cùng thành công/hoàn tác. **Serializable:** tương đương xử lý tuần tự, có thể cần retry khi cạnh tranh. **Idempotency:** gửi lại không tạo tác dụng lần hai. **Canonical:** dữ liệu chuẩn PostgreSQL. **Snapshot:** bản chụp lúc tạo đơn. **requestHash/hashVersion:** dấu kiểm nội dung và phiên bản chuẩn hóa. **Outbox:** công việc đồng bộ ghi cùng giao dịch, worker gửi sau commit. **Race:** request đồng thời có thể ghi sai nếu thiếu kiểm soát. **Rollback:** hoàn tác toàn giao dịch khi lỗi.

**Idempotency boundary:** phạm vi chống tạo trùng của một Buyer/key cho toàn lần checkout. **Hydrate:** lấy dữ liệu hiện hành từ PostgreSQL cho các ID index trả về. **False negative:** sản phẩm phù hợp bị index bỏ sót; bước lọc PostgreSQL không tự bổ sung ID chưa nhận. **STALE:** event cũ đã bị version mới thay thế.

Đợt này chỉ rà code/viết checklist/phân công; không triển khai Checkout, không chạy migration/test runtime và không báo CHK-* là PASS.
