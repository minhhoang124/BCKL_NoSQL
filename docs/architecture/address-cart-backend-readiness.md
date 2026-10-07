# Rà soát Backend và checklist triển khai Address/Cart

Ngày rà soát ban đầu: 03/10/2026; cập nhật phân công/trạng thái PR ngày 05/10/2026. Phạm vi: chuẩn bị Backend, không triển khai nghiệp vụ hoặc sửa schema trong PR tài liệu này.

## 1. Kết luận để cả nhóm thống nhất

Baseline rà ban đầu `c0a7d48` chưa có Address/Cart API. Cập nhật 05/10: Address #30 đã merge tại develop `efd86a3`; Cart Backend #31 đã merge tại `6663fab`, giữ cả hai module/migration/docs; review Hiền và CI xanh tại head `979ef58`. Schema #26 đã merge tại `08f165e`; contract #27 tại `c0a7d48`. Address/Cart CURRENT ở lớp Backend, không nhận hai luồng người dùng hoàn thành khi thiếu UI/bằng chứng tích hợp.

Thứ tự: merge #30 → đồng bộ/kiểm thử #31 → Buyer UI Address/Cart. Hoàng giao Hiền CODE hai màn này ngày 04/10, không chỉ review và không chuyển toàn bộ Buyer UI. Hiền đã [xác nhận nhận task trên PR #29](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-5978048696), chuẩn bị layout/state trước và nối API thật sau Backend tương ứng merge vào develop. Chưa có cam kết lịch cụ thể hoặc bằng chứng UI hoàn thành. Xem [phân công cập nhật](../project/address-cart-delivery-assignment-2026-10-03.md).

Address/Cart không giữ/trừ tồn kho và không tạo SearchOutbox. Checkout/Order/Inventory là bước riêng, không gộp vào đợt triển khai này.

### Mốc code đã dùng để rà

- Backend: checkout PR #26, commit `947547cf9530298ede2e30150878f0e1070f4c16`.
- Tại mốc rà ban đầu, Backend `BE/src` không khác develop `cff5b3c`; schema #26 khi đó chưa merge. Cập nhật 03/10: #26 đã merge tại `08f165e`; chưa có thêm API Address/Cart trong merge này.
- Contract: PR #27 được approve tại 842cb3c, đã merge tại develop c0a7d48; file docs/api/cart-order-inventory-api-contract.md là nguồn chuẩn đã review. Phần implementation vẫn TARGET.
- Đây là rà code/tài liệu tại các mốc trên, không phải xác nhận trạng thái GitHub trực tiếp tại thời điểm đọc báo cáo.

## 2. Backend đã có gì có thể tận dụng?

| Nền tảng | Bằng chứng trong repo | Ý nghĩa cho Address/Cart |
|---|---|---|
| Kết nối PostgreSQL qua Prisma | `BE/src/prisma.service.ts`, `database.module.ts` | Không tạo lớp kết nối DB mới |
| JWT và tài khoản hiện hành | `BE/src/auth/jwt.strategy.ts` | Đọc User đang active từ DB; không chỉ tin thông tin role trong token |
| CurrentUser và role guard | Auth decorators/guards; Store controller | Lấy chủ sở hữu từ `user.userId`, không nhận userId do client tự gửi |
| Kiểm tra request | `BE/src/configure-app.ts` | ValidationPipe đã bật whitelist, cấm trường thừa và transform |
| Quy tắc Product công khai | `BE/src/product/product-public-policy.ts` | Không tự tạo một bộ quy tắc bán hàng khác cho Cart |
| Transaction và retry | `BE/src/product/transaction-conflict.ts`, `product.service.ts` | Có helper nhận biết conflict và chờ retry; runner transaction hiện nằm riêng trong service |
| Swagger | `BE/src/main.ts` | Có thể bổ sung tài liệu API và bearer auth theo cách hiện hành |
| E2E | `BE/vitest.config.e2e.ts`, `BE/test/setup-env.ts` | Test có thể dựng ứng dụng và gọi HTTP thật với PostgreSQL |

Các điểm cần chú ý:

- Tại baseline rà ban đầu, `AppModule` chưa đăng ký AddressModule/CartModule. Hiện develop `6663fab` có AddressModule từ #30 và CartModule từ #31 đã merge. Các checklist thiết kế dưới giữ để đối chiếu, không dùng câu baseline làm trạng thái runtime mới.
- Role hiện là một giá trị, chưa phải multi-role. Không sửa Auth trong task Address/Cart để tiện mở rộng.
- Hàm chọn các Variant hợp lệ trong public policy hiện là hàm nội bộ. Product có một Variant hợp lệ **không đồng nghĩa mọi Variant của Product đều được thêm vào giỏ**.
- Public policy kiểm tra bản ghi ảnh chính; không được diễn giải rằng helper này tự kiểm tra file ảnh vật lý.
- Chưa thấy cấu hình global rate limiter hoặc global error-envelope filter trong phần khởi tạo Backend đã rà. Không tự thêm filter toàn hệ thống làm đổi các API cũ.
- CORS/cookie đã có cấu hình; giao diện vẫn phải dùng luồng auth hiện hành, không lưu mật khẩu/token vào log.

## 3. Schema PR #26: hỗ trợ gì và chưa đảm bảo gì?

| Thành phần | Ràng buộc đã có trong PR #26 | Việc service vẫn phải làm |
|---|---|---|
| UserAddress | FK User; trường thông tin giao hàng; optional postalCode/deliveryNote | Ownership, validation và chuyển địa chỉ mặc định |
| Default address | SQL partial unique index theo userId khi isDefault=true | Chỉ đảm bảo **tối đa một** mặc định, không tự đảm bảo có một mặc định |
| Cart | userId unique | Tạo lười, xử lý hai request tạo giỏ đầu tiên cùng lúc |
| CartItem | Unique cartId+variantId; CHECK quantity>0; FK Variant Restrict | Giới hạn quantity, quyền, tính hợp lệ của Variant và giá hiện tại |

Cart không lưu snapshot giá hoặc địa chỉ; snapshot thuộc Order. Variant có trong Cart bị ràng buộc FK khi xóa vật lý, nên không thiết kế Cart dựa trên giả định Variant luôn xóa vật lý được.

File `BE/test/cart-order-inventory-schema.e2e-spec.ts` kiểm tra ràng buộc database, gồm quantity dương và một địa chỉ mặc định. Đây **chưa phải** kiểm thử HTTP Address/Cart.

## 4. Quyết định Address/Cart đã thống nhất, chờ nghiệm thu implementation

Các mục [x] là quyết định đã được reviewer xác nhận, không phải code/test đã hoàn thành. Nội dung mới vẫn phải re-review. Buyer UI đã được Hoàng giao và Hiền xác nhận nhận ngày 04/10 tại comment dẫn ở mục 1; không nhận tiến độ UI hoặc thời hạn chưa có bằng chứng.

### Address

- [x] province/ward bắt buộc, district optional/nullable chỉ tương thích dữ liệu cũ. Trước API tạo migration mới đổi UserAddress.district và Order.districtSnapshot sang nullable; không sửa migration #26, không xóa/điền giả dữ liệu cũ.
- [x] DTO/response nhận district:null; P0 chuỗi trim, không thêm bảng/API địa giới.
- [x] recipientName 1–100; province/ward 1–100; district nếu có 1–100; addressLine 1–255; postalCode optional 1–20; deliveryNote optional 1–500. phone trim 8–20 ký tự, 8–15 chữ số ASCII, chỉ chữ số và + ( ) . -/khoảng trắng; không khóa đầu số Việt Nam.
- [x] PATCH bỏ field giữ nguyên; null chỉ xóa district/postalCode/deliveryNote. Rỗng/whitespace, null field bắt buộc và body PATCH rỗng trả 400 VALIDATION_ERROR. Same-value PATCH với field hợp lệ vẫn được nhận, không nhầm với body rỗng.
- [x] PATCH false cho default trả 409 DEFAULT_ADDRESS_CANNOT_BE_UNSET; đổi bằng PUT default hoặc DELETE. False cho non-default no-op. Đầu tiên tự default; xóa default chọn cũ nhất (createdAt,id); xóa cuối cho phép không có default.
- [x] Tối đa 20 địa chỉ/User bằng config; vượt trả 409 ADDRESS_LIMIT_REACHED. GET {items:[...]} không phân trang P0, default trước rồi createdAt DESC/id DESC.
- [x] POST 201; GET/PATCH/PUT default 200; DELETE 204. Không tồn tại/không thuộc actor cùng 404 ADDRESS_NOT_FOUND.

### Cart

- [x] quantity integer 1–99 bằng config; PUT tuyệt đối, kiểm tra kho hiện hành nhưng không giữ/trừ kho.
- [x] lineCount đếm CartItem; totalQuantity cộng mọi quantity; purchasableSubtotal chỉ cộng available. UI tính subset riêng.
- [x] Product không public chỉ trả variantId/quantity/available=false/reason PRODUCT_UNAVAILABLE trong unavailableItems cấp gốc; không lộ Store/name/image/option/price/draft.
- [x] PUT thành công 200 trả toàn giỏ; DELETE missing 204; GET giỏ chưa tồn tại trả rỗng không tạo row.
- [x] Reason ưu tiên PRODUCT_UNAVAILABLE → VARIANT_UNAVAILABLE → OUT_OF_STOCK → INSUFFICIENT_STOCK; giá đổi xử lý tại preview/checkout, không thành unavailable reason.
- [x] Chung bucket GET/PUT/DELETE 60 request/phút/User, 429 RATE_LIMITED + Retry-After. In-memory chỉ bảo vệ từng instance.
- [x] Buyer dùng USER single-role, ownership userId từ JWT; multi-role PR riêng. Contract #27 đã được duyệt/merge; nối API thật khi Backend đã triển khai/test đúng contract, không dùng mock làm bằng chứng.

## 5. Checklist triển khai Address theo contract đã duyệt

Luồng dự kiến: HTTP request → JWT/role → DTO validation → service kiểm tra ownership → transaction khi cần → response DTO.

- [ ] Cập nhật branch theo develop đã merge schema; tạo migration mới nullable cho UserAddress.district và Order.districtSnapshot, giữ dữ liệu cũ; không sửa migration cũ.
- [ ] Tạo Address module/controller/service/DTO theo cấu trúc NestJS hiện hành và đăng ký AppModule.
- [ ] GET/POST/PATCH/PUT default/DELETE đúng đường dẫn `/me/addresses` của contract đã duyệt.
- [ ] Mọi truy vấn theo addressId phải ràng buộc userId; không kiểm tra bằng frontend rồi bỏ ownership ở Backend.
- [ ] Validate/trim theo luật đã chốt; reject trường thừa, không mass-assign body vào Prisma.
- [ ] Chuyển mặc định trong một transaction: bỏ mặc định cũ rồi đặt mặc định mới; lỗi thì rollback cả hai.
- [ ] Serialize thao tác mặc định theo User, kể cả khi chưa có Address nào. Khóa một hàng User ổn định hoặc Serializable với retry hữu hạn là phương án cần review.
- [ ] Xử lý conflict đúng nguyên nhân; không retry mọi lỗi validation/FK/unique một cách mù quáng.
- [ ] Khi chọn địa chỉ cũ nhất để thay default, có thứ tự ổn định `(createdAt, id)`.
- [ ] Không đụng snapshot Order, Product.version hoặc SearchOutbox khi sửa địa chỉ.
- [ ] Error response và Swagger đúng contract; log không chứa đầy đủ thông tin cá nhân.

## 6. Checklist triển khai Cart theo contract đã duyệt

Luồng dự kiến: request → xác thực → tìm Variant/Product/Store → áp dụng policy → ghi giỏ riêng của User → khi GET đọc giá/kho hiện tại và nhóm Store.

- [ ] Tạo Cart module/controller/service/DTO; `GET /cart`, `PUT /cart/items/:variantId`, `DELETE /cart/items/:variantId`.
- [ ] Không nhận cartId/userId để cho client chọn giỏ người khác; suy ra từ JWT.
- [ ] PUT đặt quantity tuyệt đối, không cộng thêm khi retry cùng request.
- [ ] Tạo Cart lười; unique userId và unique cartId+variantId được xử lý an toàn khi nhiều request đồng thời.
- [ ] Xác minh **Variant được chọn** active, giá hợp lệ, tổ hợp option hợp lệ và Product đủ điều kiện public. Tận dụng policy hiện có, không sao chép một luật dễ lệch.
- [ ] Áp dụng quy tắc không tự mua Store của mình theo contract; không mở rộng role ngoài task.
- [ ] Cart không giữ/trừ/hoàn kho; stock thiếu được xử lý theo semantics đã chốt. Checkout sau này phải kiểm tra lại.
- [ ] GET không trả giá cũ lưu tạm; dùng Prisma Decimal để tính tiền, serialize chuỗi theo định dạng contract, không dùng Number để cộng tiền.
- [ ] Group theo Store; lineCount/totalQuantity/purchasableSubtotal/unavailableReason đúng quyết định nhóm.
- [ ] Item không còn public dùng response an toàn đã duyệt; vẫn có khả năng xóa khỏi giỏ.
- [ ] Không gọi FastAPI/Elasticsearch, không tăng Product.version và không sinh outbox do thao tác Cart.
- [ ] Kiểm tra đồng thời Product đổi trạng thái với thao tác PUT; xác định mức nhất quán trong transaction và luôn đọc lại khi checkout.
- [ ] Bổ sung giới hạn request theo phương án đã duyệt, không tuyên bố chống abuse đa instance chỉ từ một limiter bộ nhớ.

## 7. Ma trận kiểm thử bắt buộc trước bàn giao

| Miền | Các ca phải kiểm thử |
|---|---|
| Auth/ownership | Không token; token hết hạn; tài khoản inactive; role không được phép; User A đọc/sửa/xóa địa chỉ hoặc giỏ B |
| Address validation | Thiếu field; whitespace; quá dài; field thừa; null/empty/PATCH rỗng theo luật đã chốt |
| Address default | Địa chỉ đầu tiên; đổi default; xóa default còn/không còn địa chỉ; rollback khi lỗi |
| Address concurrency | Hai request tạo đầu tiên; hai request đổi default; đổi/xóa default cùng lúc; kết quả không có hai default |
| Address isolation | Sửa/xóa địa chỉ không làm thay đổi snapshot Order đã tồn tại |
| Cart validation | ID/quantity không nguyên; zero/âm/quá giới hạn; field thừa; Variant không tồn tại |
| Cart policy | Variant inactive; option không hợp lệ; Product DRAFT/ẩn; Store/Seller inactive; Brand/Category/rule khiến Product không public |
| Cart retry | PUT hai lần cùng quantity chỉ một item; hai request tạo giỏ đầu tiên; DELETE retry theo contract |
| Cart read | Giỏ rỗng; nhiều Store; Decimal tính đúng; giá/kho đổi; available và subtotal/count đúng |
| Cart stock | Hết hàng và quantity vượt stock; thêm giỏ không đổi stock; không phát outbox/version |
| Cart privacy | Item bị ẩn không lộ nội dung chưa công khai; vẫn xóa được |
| Rate limit | Ngưỡng đã duyệt; 429 đúng response; không ảnh hưởng nhầm User khác |

E2E phải gọi HTTP qua guard/ValidationPipe/controller thật, không chỉ gọi trực tiếp service. Dùng fixtures riêng và cleanup an toàn; không xóa demo data hoặc reset database dùng chung.

`BE/test/setup-env.ts` hiện tắt scheduler SearchSync/Reconciliation/ImageRepair để tránh can thiệp fixtures. Giữ cơ chế này khi thêm test; không bật worker thật ngoài phạm vi test.

Kiểm tra bàn giao sau implementation: Backend lint, build, unit, E2E, Prisma validate theo thay đổi và `git diff --check`. Báo rõ lệnh nào chạy/không chạy, số test và môi trường DB. Bản checklist này chưa chạy lại các bộ test và không xác nhận API đã pass.

## 8. Phân công và điều kiện bắt đầu

- **Hoàng:** Backend, transaction/concurrency, DTO/Swagger, E2E và cập nhật kiến trúc sau mỗi phần chạy được.
- **Hiền:** giữ Admin/SRS/QA; đã xác nhận nhận CODE Buyer UI Address/Cart, không gồm Checkout/Order UI. Cần cập nhật lịch/vướng mắc; không coi lời nhận task là đã code hoặc cam kết thời hạn.
- **Đạt:** chưa cần thay FastAPI cho Address/Cart. Khi tới checkout làm đổi stock/search eligibility, review contract đồng bộ ở task riêng.

Contract #27, Address #30 và Cart Backend #31 đã merge; nền mới là develop `6663fab`. Chuẩn bị bước tiếp theo bằng [checklist Checkout/COD](checkout-cod-backend-readiness.md) và [bảy quyết định đã được Hiền chấp thuận](../api/checkout-cod-implementation-proposal.md). Không coi API/mock UI là DONE khi chưa có luồng tích hợp/test thật.

## 9. Ghi chú thuật ngữ để đọc code

- **DTO:** cấu trúc dữ liệu vào/ra API; khác với toàn bộ hàng database.
- **Ownership:** quyền sở hữu; một User chỉ thao tác dữ liệu của mình.
- **Transaction:** nhóm thao tác DB cùng thành công hoặc cùng rollback.
- **Race condition:** hai thao tác đồng thời làm sai kết quả nếu thiếu kiểm soát.
- **Serializable:** mức cô lập transaction cao; có thể bị conflict và cần retry có giới hạn.
- **Idempotent:** gửi lại thao tác không tạo tác dụng nghiệp vụ cộng dồn; PUT quantity=2 vẫn là 2.
- **Contract:** thỏa thuận API về đường dẫn, field, type, lỗi và semantics.
- **Snapshot:** bản sao dữ liệu tại thời điểm đặt hàng; không đổi theo sổ địa chỉ/giá hiện tại.
- **userId/addressId/cartId/variantId/productId/storeId:** lần lượt là mã User, địa chỉ, giỏ, biến thể bán, sản phẩm và gian hàng; không tráo variantId với productId.
- **quantity:** số lượng mong muốn trong giỏ, không phải tồn kho.
- **isDefault:** địa chỉ giao hàng được ưu tiên; DB unique chỉ giới hạn số default.
- **currentUnitPrice:** giá hiện tại của một Variant; chưa phải giá snapshot Order.
- **available/unavailableReason:** khả năng mua tại thời điểm đọc giỏ và lý do chưa mua được; checkout vẫn phải kiểm tra lại.

## 10. Đối chiếu nghiệp vụ thực tế, không chỉ áp dụng feedback

Ngày tham khảo: 03/10/2026. Phân biệt quy trình chung với giới hạn cấu hình của đồ án:

| Quy tắc | Đánh giá và điều kiện |
|---|---|
| Một địa chỉ mặc định, đổi bằng thao tác rõ ràng | Hợp lý cho UX; tự chọn địa chỉ cũ nhất khi xóa là lựa chọn nhóm, phải hiển thị rõ và cho Buyer chọn lại tại checkout, không tự đặt hàng |
| Giới hạn 20 địa chỉ, 99 quantity | Là giới hạn P0 của nhóm, không phải tiêu chuẩn chung của Shopee/TikTok Shop; phải cấu hình được |
| PUT kiểm tra kho, giỏ không giữ kho | Hợp lý; hai giỏ vẫn có thể cùng thấy hàng cuối. Chỉ transaction checkout quyết định ai mua được; không hứa có hàng vì PUT thành công |
| Tổng chỉ tính item mua được | Hợp lý nếu UI phân biệt tổng toàn giỏ với tổng subset được chọn; không âm thầm coi là tiền cuối cùng gồm vận chuyển |
| Không lộ dữ liệu Product đã ẩn | Hợp lý về privacy; cần DTO tối thiểu và thông báo để User biết vì sao dòng không còn mua được |
| Failed/delivered khớp attempt hiện hành | Cần thiết để event cũ không thay đổi lần giao mới; tracking đơn thuần có thể được carrier dùng chung qua nhiều attempt, nên production cần attempt/event identity độc lập |
| 3 lần giao lại, 4 attempt tổng | Quy tắc SRS của nhóm, không khẳng định mọi carrier đều áp dụng. P0 mô phỏng có thể dùng tracking mới mỗi attempt; production không nên bắt hãng vận chuyển đổi vận đơn mỗi lần thử giao |
| Địa chỉ province/district/ward đều bắt buộc | Cần rà riêng: địa chỉ hành chính hiện hành đã thay đổi; không ép User tự bịa district. Đã chốt district nullable; phải có migration mới cho UserAddress.district và Order.districtSnapshot trước API, giữ dữ liệu cũ |

Nguồn chính thức:

- [Shopee — thêm/thay đổi/xóa địa chỉ](https://help.shopee.vn/portal/4/article/79433): có quản lý sổ địa chỉ và giới hạn số địa chỉ; không dùng nguồn này để khẳng định con số 20.
- [Shopee — cập nhật địa chỉ hành chính mới](https://help.shopee.vn/portal/4/article/197479): yêu cầu rà địa chỉ sau thay đổi địa giới; cần thiết kế địa chỉ không cố định theo một mô hình hành chính cũ.
- [TikTok Shop — chính sách vận chuyển](https://seller-vn.tiktok.com/university/essay?knowledge_id=8974899868518160): tracking/trạng thái logistics phục vụ theo dõi đơn; không suy ra số retry hay cơ chế attempt kỹ thuật riêng của nhóm.

Các kết luận về transaction/retry/privacy là phân tích thiết kế cho hệ thống này, không phải khẳng định nội bộ kỹ thuật của các sàn. Validation/Cart DTO/rate limiter đã được Hiền xác nhận và ghi tại mục4/contract #27; chưa nhận luồng người dùng là hoàn thành. Buyer UI đã được Hoàng giao cho Hiền ngày 04/10.

## 11. Kết quả của đợt rà này

Chỉ bổ sung tài liệu checklist. Không sửa schema, migration, Auth, Product, Address/Cart code; không chạy migration trong PR tài liệu này. #29 đã có approval cho head cũ; cập nhật mới cần re-review, không tự merge. Các quyết định nghiệp vụ mục 4 đã thống nhất với contract #27; phân công mới do Hoàng giao ngày 04/10. Các mục 2–7 giữ baseline rà ban đầu và checklist chưa tick nghiệm thu; bằng chứng API mới phải đọc trong #30/#31.
