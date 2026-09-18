# Khảo sát và áp dụng nghiệp vụ sàn thương mại điện tử

Tài liệu này giúp nhóm tham khảo Shopee, Lazada và TikTok Shop để phân tích hệ thống, thiết kế database, viết SRS/Use Case/ERD/test case và trình bày báo cáo. Mục tiêu là học cách tổ chức nghiệp vụ của một sàn nhiều người bán, không sao chép toàn bộ chính sách hoặc tuyên bố hệ thống có chức năng chưa triển khai. Phạm vi nghiệp vụ phải làm cho bản bảo vệ tháng 12 nằm tại `docs/project/implementation-scope.md`; nhóm review cách triển khai/migration và test trước khi code, không tự chuyển nghiệp vụ đã chốt thành “hướng phát triển” chỉ vì hiện chưa có code.

Ngày rà soát nguồn: **15/09/2026**.

## 1. Cách sử dụng tài liệu

- `docs/project/implementation-scope.md` quyết định chức năng nào bắt buộc triển khai, chức năng nào chỉ là hướng phát triển.
- Tài liệu này giải thích cơ sở nghiệp vụ và gợi ý mô hình dữ liệu.
- `docs/architecture/product-domain-design.md` là nguồn chuẩn cho Product sau khi PR thiết kế Product được merge.
- `docs/architecture/chat-domain-design.md` là nguồn chuẩn cho Chat MVP.
- Chính sách của sàn có thể thay đổi. Các con số như thời hạn xử lý, số ảnh, dung lượng ảnh hoặc số kho chỉ là dữ liệu tham khảo tại ngày truy cập, không được đóng cứng vào database nếu không phải yêu cầu của đề tài.
- Khi viết báo cáo, phải phân biệt rõ **tham khảo**, **nhóm lựa chọn áp dụng**, **giản lược** và **hướng phát triển**.

## 2. Nguồn tham khảo

### 2.1 Nguồn chính thức TikTok Shop

| Chủ đề | Nguồn |
|---|---|
| Đăng và quản lý sản phẩm | [Add and Manage Product](https://seller-vn.tiktok.com/university/essay?knowledge_id=10008556&lang=en) |
| Đăng ký/hoàn thiện hồ sơ Seller | [Seller Registration Process](https://seller-vn.tiktok.com/university/essay?from=feature_guide&identity=1&knowledge_id=6837778147297025&role=1) |
| Thuộc tính sản phẩm | [Product Attributes Guidelines](https://seller-vn.tiktok.com/university/essay?knowledge_id=2034281343239937&lang=en) |
| Tiêu đề, mô tả, ảnh và video | [Product Titles, Descriptions, Images & Videos](https://seller-vn.tiktok.com/university/essay?knowledge_id=5918681919178512&lang=en) |
| Hoàn tất và giao đơn | [Order Fulfilment - Overview](https://seller-vn.tiktok.com/university/essay?knowledge_id=7045464017700624&lang=en) |
| Thời hạn xử lý đơn | [Order Fulfillment Timelines](https://seller-vn.tiktok.com/university/essay?knowledge_id=7261258355672849&lang=en) |
| Hủy, trả hàng và hoàn tiền | [Customer Order Cancellation, Return and Refund Policy](https://seller-vn.tiktok.com/university/essay?article_type=agreement&default_language=vi-VN&knowledge_id=6837773789234946) |
| Quản lý yêu cầu trả hàng | [Managing Return and Refund Requests](https://seller-vn.tiktok.com/university/essay?knowledge_id=6819122768905985&lang=en) |
| Nhiều kho | [Multi-warehouse Feature Guidance](https://seller-vn.tiktok.com/university/essay?knowledge_id=6837797940283137&lang=en) |
| Đánh giá | [Customer Review Policy](https://seller-vn.tiktok.com/university/essay?knowledge_id=10013847&lang=en) |
| Voucher của Seller | [Seller Regular Voucher](https://seller-vn.tiktok.com/university/essay?knowledge_id=5159633199597314&lang=en) |
| Voucher qua Chat | [Voucher qua Chat](https://seller-vn.tiktok.com/university/essay?default_language=en&knowledge_id=5787845827200769) |

### 2.2 Nguồn chính thức Shopee

| Chủ đề | Nguồn |
|---|---|
| Quy chế hoạt động sàn | [Quy chế hoạt động Shopee.vn](https://help.shopee.vn/portal/4/article/77245-QUY-CH%E1%BA%BE-HO%E1%BA%A0T-%C4%90%E1%BB%98NG-SA%CC%80N-TH%C6%AF%C6%A0NG-MA%CC%A3I-%C4%90I%C3%8A%CC%A3N-T%C6%AF%CC%89-SHOPEE.VN) |
| Điều khoản dịch vụ và xử lý tiền | [Điều khoản dịch vụ Shopee](https://help.shopee.vn/portal/4/article/77243-%C4%90I%E1%BB%80U-KHO%E1%BA%A2N-D%E1%BB%8ACH-V%E1%BB%A4) |
| Trả hàng/hoàn tiền | [Cẩm nang Trả hàng hoàn tiền](https://help.shopee.vn/portal/4/article/79258-Tr%E1%BA%A3-h%C3%A0ng%2FHo%C3%A0n-ti%E1%BB%81n%5D-C%E1%BA%A9m-nang-Tr%E1%BA%A3-h%C3%A0ng-ho%C3%A0n-ti%E1%BB%81n?seo=1) |
| Thứ tự áp dụng voucher | [Cách tính đơn hàng có Voucher](https://help.shopee.vn/portal/4/article/85353-%5BThanh-to%C3%A1n%5D-%C4%90%C6%A1n-h%C3%A0ng-c%C3%B3-s%E1%BB%AD-d%E1%BB%A5ng-Voucher/M%C3%A3-gi%E1%BA%A3m-gi%C3%A1-s%E1%BA%BD-%C4%91%C6%B0%E1%BB%A3c-t%C3%ADnh-nh%C6%B0-th%E1%BA%BF-n%C3%A0o) |

### 2.3 Nguồn chính thức Lazada và nguồn Shopee bổ sung

| Chủ đề | Nguồn |
|---|---|
| Lazada Seller onboarding | [Lazada Seller Center - Sign Up](https://sellercenter.lazada.vn/apps/register/index?lazMall=0) |
| Lazada Category/Attribute/SKU/Order | [Lazada Seller Center API - Process flow](https://lazada-sellercenter.readme.io/docs/process-flow) |
| Shopee Seller onboarding | [Shopee Blog - Đăng ký bán hàng và thiết lập gian hàng](https://shopee.vn/blog/?p=189017) |
| Shopee đăng bán và phân loại giá | [Shopee Help Center - Quy định đăng bán sản phẩm](https://help.shopee.vn/portal/4/article/77246) |
| Shopee tồn kho và SKU | [Shopee Help Center - Thiết lập sản phẩm kho](https://help.shopee.vn/portal/1/article/97568) |
| Xác minh Google login tại Backend | [Google Identity - Authenticate with a backend server](https://developers.google.com/identity/sign-in/web/backend-auth) |

Lazada Seller Center API mô tả Category→Attribute→SKU→QC, cập nhật giá/kho và xử lý Order; nhóm chỉ dùng làm đối chiếu luồng, **không tích hợp API Lazada**. Quy trình Seller ngoài đời có xác minh giấy tờ và tiền, nhưng bản demo không thu thập giấy tờ thật khi chưa có chính sách bảo vệ dữ liệu và vận hành phù hợp.

### 2.4 Nguồn tham khảo thứ cấp

- [Quy trình đăng sản phẩm Shopee do Sapo tổng hợp](https://www.sapo.vn/blog/cach-dang-san-pham-tren-shopee).
- [Quy trình đăng sản phẩm TikTok Shop do Điện Máy Chợ Lớn tổng hợp](https://dienmaycholon.com/kinh-nghiem-mua-sam/chia-se-cach-dang-san-pham-len-tiktok-shop-duyet-nhanh-100).

Nguồn thứ cấp hữu ích để quan sát trình tự giao diện nhưng không được ưu tiên hơn tài liệu chính thức khi mô tả chính sách.

## 3. Tổng quan các miền nghiệp vụ

| Miền | Bài học từ sàn | Nhóm áp dụng | Dữ liệu chính |
|---|---|---|---|
| Tài khoản/Store | Người mua, Seller và sàn có quyền khác nhau; đăng ký khác với đủ điều kiện mở bán | JWT + RBAC, hồ sơ/địa chỉ và Seller onboarding; Store tách khỏi User | `User`, `AccountIdentity?`, `UserAddress`, `Store`, `StoreAddress` |
| Catalog | Product có thông tin chung, thuộc tính và SKU/variant | Product đa ngành hàng; không có cột color/size cố định | `Category`, `Product`, `ProductVariant`, `ProductImage` |
| Kiểm duyệt | Sản phẩm có lưu nháp, chờ duyệt, từ chối, hoạt động/đóng băng | Tách trạng thái Seller và kiểm duyệt | `Product`, `ModerationHistory` |
| Tồn kho | Tồn kho thuộc SKU và có thể mở rộng theo kho | MVP theo Variant; transaction chống bán vượt kho | `ProductVariant`, `StockMovement` |
| Cart/Checkout | Giá và điều kiện được kiểm tra lại khi đặt | Cart theo Variant; Order lưu snapshot | `Cart`, `CartItem`, `Order`, `OrderItem` |
| Thanh toán | Trạng thái tiền khác trạng thái giao hàng | COD; `PaymentStatus` tách `OrderStatus` | `Payment`, `PaymentTransaction` |
| Vận chuyển | Có kiện hàng, mã vận đơn và vòng đời giao | Mô phỏng hãng vận chuyển; snapshot địa chỉ | `Shipment`, `OrderAddressSnapshot` |
| Hủy đơn | Quyền hủy phụ thuộc trạng thái và người thực hiện | Hủy cơ bản, lý do, lịch sử, hoàn kho đúng một lần | `OrderStatusHistory`, `Cancellation` |
| Hậu mãi | Trả hàng/hoàn tiền là vòng đời riêng sau Order | P1 yêu cầu–Seller phản hồi–Admin quyết định–hoàn tiền mô phỏng; tranh chấp/tiền thật là P2 | `ReturnRequest`, `ReturnHistory`, `Refund?`, `Dispute?` |
| Đánh giá | Gắn với sản phẩm đã mua và có thể kiểm duyệt | Gắn `OrderItem`, Seller phản hồi, Admin ẩn | `Review`, `ReviewReply` |
| Chat | Hội thoại theo khách và Store, có thể mang ngữ cảnh Product | Text realtime + lịch sử + unread | `Conversation`, `Message`, `ConversationReadState` |
| Thông báo | Sự kiện đơn/duyệt/hậu mãi cần đến đúng actor | P0 inbox trong ứng dụng; email adapter là P1 | `Notification`, outbox/job |
| Khuyến mãi | Có nhiều nguồn giảm giá và thứ tự áp dụng | P2; chỉ mở rộng khi P0 ổn định | `Promotion`, `Voucher`, `VoucherUsage` |
| Tìm kiếm | Nội dung công khai được lập chỉ mục và đo hành vi | Elasticsearch + CLIP/FAISS + RRF | `SearchLog`, `ClickLog`, outbox/index job |
| Báo cáo | Seller cần doanh thu và tình trạng đơn | Dashboard ngày/tháng/quý | dữ liệu tổng hợp từ Order/Payment |

## 4. Phân tích nghiệp vụ áp dụng cho hệ thống

### 4.1 Tài khoản, Seller và Store

Luồng đề xuất:

```text
Người dùng đăng ký/xác thực
→ hoàn thiện hồ sơ và địa chỉ khi chuẩn bị mua
→ nếu muốn bán: nộp thông tin Store và địa chỉ lấy/hoàn hàng
→ Admin chấp thuận/hoặc từ chối Store với lý do
→ Seller tạo Product và gửi duyệt
→ Product công khai khi cả Store và Product đủ điều kiện
```

Quy tắc:

- `User` là tài khoản đăng nhập; `Store` là chủ thể bán hàng.
- MVP cho phép một Seller sở hữu tối đa một Store.
- Backend suy ra chủ sở hữu từ JWT; client không tự chọn `sellerId` để sửa dữ liệu.
- Store hoặc Seller bị khóa thì Product không được bán, nhưng lịch sử Order/Chat không bị xóa.
- Vòng đời Store mục tiêu là `PENDING → ACTIVE` hoặc `PENDING → REJECTED`. Store `REJECTED` được Seller sửa hồ sơ và nộp lại về `PENDING` trên chính Store cũ; không tạo Store khác để xóa lịch sử. `ACTIVE → SUSPENDED` do Admin thực hiện, và chỉ Admin được khôi phục `SUSPENDED → ACTIVE`. Mỗi quyết định lưu actor, thời gian, lý do và history.
- Đăng ký công khai không được tạo role `ADMIN`.
- **CURRENT:** Auth trên `develop` mới có email/mật khẩu và một role `USER` hoặc `SELLER`; đăng ký Seller không tự tạo Store. **TARGET:** xác minh email, khôi phục mật khẩu, một OAuth provider và phone OTP qua sandbox/adapter thuộc phạm vi cam kết mới; chưa được báo là đã triển khai.
- Đăng nhập qua Google/Facebook khác với việc nhập địa chỉ Gmail. Backend phải xác minh token của provider; khóa identity nên dựa trên provider + subject ID ổn định, không chỉ email. Nối identity vào User hiện có phải xác minh chủ sở hữu; không tự nâng `SELLER`/`ADMIN` từ email trùng.
- Địa chỉ User và Store là các thực thể riêng; Order snapshot địa chỉ giao, Shipment/ReturnRequest dùng dữ liệu liên hệ theo quyền và mục đích.
- **TARGET/P0 của bản bảo vệ:** cùng tài khoản có quyền mua và có thể được duyệt mở Store để bán. Schema hiện có một role nên Seller không được mua như User; đây là khoảng cách triển khai cần khắc phục bằng capability/role membership hoặc mô hình tương đương với migration/Auth/API/UI/test riêng. Yêu cầu nghiệp vụ đã được Hoàng xác nhận; nhóm review phương án kỹ thuật và tương thích dữ liệu cũ, không tự sửa PR schema/Auth đang review.

Hiền cần thể hiện trong Use Case: xác minh/khôi phục/liên kết tài khoản, quản lý hồ sơ/địa chỉ, tạo/cập nhật/duyệt Store, khóa/mở Seller và kiểm tra quyền sở hữu. Hoàng thiết kế API/adapter; không đẩy identity provider hoặc thông tin OTP vào bảng Product.

### 4.2 Category, Product, Attribute, Variant và Image

Các sàn tách thông tin chung của Product khỏi các tổ hợp SKU. TikTok Shop cho phép chọn hoặc tự đặt tên biến thể, còn thuộc tính theo Category có thể là gợi ý hoặc bắt buộc. Nhóm áp dụng:

- Category dạng cây; Seller chọn Category lá hoạt động.
- Thuộc tính mô tả được định nghĩa theo Category.
- Nhóm phân loại do Seller cấu hình trong phạm vi Product.
- Mỗi tổ hợp phân loại tạo một ProductVariant.
- Giá và tồn kho thuộc Variant.
- Product không có phân loại vẫn có một Variant mặc định.
- Ảnh chung thuộc Product; ảnh màu có thể gắn `ProductOptionValue`.
- Giới hạn số ảnh/kích thước ảnh thuộc validation cấu hình, không đóng cứng schema.
- Dataset chỉ cung cấp dữ liệu thực sự có trong nguồn; dữ liệu thiếu được giữ `DRAFT` để bổ sung.

### 4.3 Kiểm duyệt Product

Luồng đề xuất:

```text
DRAFT + NOT_SUBMITTED
→ PENDING
→ APPROVED hoặc REJECTED
→ Seller sửa và gửi lại nếu REJECTED
→ ACTIVE khi Seller bật bán và đủ điều kiện
→ HIDDEN hoặc FROZEN khi bị ẩn/đóng băng
```

Phải lưu người duyệt, thời gian, lý do và lịch sử. Không xóa cứng Product đã xuất hiện trong Order. Chỉ Product công khai mới được đưa vào Elasticsearch/FAISS; thao tác ẩn/đóng băng phải tạo công việc loại khỏi index.

### 4.4 Tồn kho

- Tồn kho theo Variant, không theo Product chung.
- Khi checkout, Backend phải kiểm tra và cập nhật tồn kho trong transaction.
- Hủy đơn hợp lệ phải hoàn kho đúng một lần.
- Nên có `StockMovement` với loại `IMPORT`, `ORDER`, `CANCEL_RETURN`, `MANUAL_ADJUSTMENT` để truy vết.
- Nhiều kho là P2. Thiết kế tương lai có `Warehouse` và `Inventory(warehouseId, variantId, quantity)` nhưng MVP không cần triển khai ngay.

### 4.5 Cart, checkout và tính tiền

Luồng đề xuất:

```text
User chọn Variant
→ thêm CartItem
→ xem giỏ
→ Backend kiểm tra lại Product/Variant/giá/tồn kho
→ User chọn địa chỉ và COD
→ transaction tạo Order + OrderItem snapshot + cập nhật tồn kho
```

Quy tắc:

- Cart tham chiếu `variantId` và unique `(cartId, variantId)`.
- Giá trong Cart chỉ để hiển thị; giá cuối được kiểm tra ở checkout.
- `OrderItem` snapshot tên Product, SKU, thuộc tính, đơn giá và số lượng.
- Địa chỉ giao hàng được snapshot để sửa sổ địa chỉ không làm đổi đơn cũ.
- Nếu giỏ có nhiều Store, Backend tách thành một Order độc lập cho mỗi Store trong cùng thao tác checkout.
- Voucher phức tạp là P2. Nếu bổ sung, phải lưu từng thành phần giảm giá thay vì chỉ lưu `total` cuối cùng.

### 4.6 Order, COD và Shipment

Trạng thái Order đề xuất:

```text
PENDING_CONFIRMATION
→ CONFIRMED
→ PACKING
→ READY_TO_SHIP
→ SHIPPING
→ DELIVERED
→ COMPLETED
```

Nhánh ngoại lệ:

```text
PENDING_CONFIRMATION / CONFIRMED → CANCELLED
SHIPPING → DELIVERY_FAILED → SHIPPING hoặc CANCELLED theo quy tắc
```

Quy tắc:

- Chuyển trạng thái bằng command/use case của Backend, không cho client cập nhật enum tùy ý.
- Mỗi chuyển trạng thái ghi `OrderStatusHistory` gồm trạng thái trước/sau, actor, thời gian và lý do.
- COD ban đầu là `UNPAID`; giao thành công mới chuyển `PAID` theo luồng demo.
- `PaymentStatus` tách khỏi `OrderStatus`.
- Shipment giữ đơn vị vận chuyển mô phỏng, mã vận đơn và lịch sử giao.
- Không tuyên bố đã tích hợp hãng vận chuyển hoặc đối soát thật nếu chỉ nhập trạng thái thủ công.

### 4.7 Hủy đơn

- Ai được hủy phụ thuộc trạng thái Order.
- Lưu `cancelledBy`, `reasonCode`, `reasonText`, `cancelledAt`.
- Hủy phải cập nhật Order, Payment liên quan và tồn kho trong cùng transaction hoặc cơ chế idempotent đáng tin cậy.
- Không cho Seller yêu cầu User hủy thay để né trách nhiệm trong logic mô phỏng.
- E2E test phải chứng minh không thể hoàn kho hai lần khi request bị gửi lại.

### 4.8 Trả hàng, hoàn tiền và tranh chấp

Shopee và TikTok Shop đều xử lý hậu mãi bằng quy trình riêng sau bán hàng. Có thể có bước yêu cầu, Seller phản hồi, vận chuyển hoàn, kiểm tra hàng, hoàn tiền và khiếu nại/bằng chứng.

Nhóm đưa **hậu mãi cơ bản vào P1 cam kết**; điều đó không có nghĩa đã triển khai. Luồng tối thiểu được chọn:

```text
REQUESTED
→ SELLER_APPROVED hoặc SELLER_REJECTED
→ ADMIN_REVIEW nếu người mua phản đối hoặc cần can thiệp
→ RESOLUTION_RECORDED (`REFUND_ONLY` hoặc `RETURN_AND_REFUND`) hoặc DENIED
→ ITEM_RECEIVED nếu `RETURN_AND_REFUND`
→ REFUND_RECORDED (COD/sandbox mô phỏng)
→ CLOSED
```

`ReturnRequest` gắn `OrderItem`, có thời hạn do nhóm cấu hình, lý do, actor, trạng thái và history. Chỉ yêu cầu hợp lệ sau khi giao, chỉ người mua của OrderItem tạo và chỉ Seller của Store đó trả lời. P1 hoàn toàn bộ OrderItem theo `lineTotal` snapshot do Backend đọc từ PostgreSQL; client không quyết định số tiền. Hoàn một phần trong cùng OrderItem là P2.

`REFUND_ONLY` không tăng tồn kho. `RETURN_AND_REFUND` chỉ tạo `StockMovement` dương sau khi Seller/Admin ghi nhận `ITEM_RECEIVED` và hàng `RESTOCKABLE`; hàng không bán lại được không nhập kho. `REFUND_RECORDED` tạo payment/refund record và revenue adjustment âm đúng một lần. Dashboard giữ doanh thu gốc của Order `COMPLETED` để audit và tính doanh thu thuần bằng doanh thu gốc trừ adjustment; không đổi ngược `OrderStatus`. Refund, revenue adjustment và restock dùng khóa idempotency/history riêng để request lặp không tạo tiền/kho hai lần.

Không dùng thêm vài giá trị `OrderStatus` để thay thế toàn bộ vòng đời hậu mãi. Vận chuyển hoàn thật, bằng chứng nhiều lớp, tranh chấp phức tạp và trả tiền production là P2. Nếu demo được một phần, báo cáo phải ghi rõ giới hạn và các trạng thái thực tế đã xây dựng.

### 4.9 Đánh giá

TikTok Shop cho phép đánh giá theo sản phẩm đã mua thay vì đánh giá chung cả Order. Nhóm lựa chọn:

- Review tham chiếu `orderItemId` để chứng minh giao dịch hợp lệ.
- Chỉ OrderItem thuộc User và Order đã đạt trạng thái cho phép mới được đánh giá.
- Một OrderItem có tối đa một Review trong MVP.
- Điểm 1-5, nội dung, thời gian; Seller có một phản hồi.
- Admin có thể ẩn Review vi phạm nhưng không xóa lịch sử audit.
- Điểm trung bình Product có thể tính từ Review hợp lệ hoặc lưu cache có cơ chế cập nhật.

### 4.10 Chat User-Seller

Chat là P0 theo quyết định của nhóm. Hội thoại thuộc cặp User-Store và có thể mang ngữ cảnh Product. MVP gồm tin văn bản, lưu lịch sử, realtime, unread và kiểm tra quyền. Không đưa nội dung Chat vào dataset, Elasticsearch sản phẩm hoặc FAISS.

Việc TikTok Shop có voucher gửi qua Chat cho thấy Chat có thể là điểm mở rộng nghiệp vụ bán hàng, nhưng voucher qua Chat không thuộc MVP. Thiết kế chi tiết nằm tại `docs/architecture/chat-domain-design.md`.

### 4.11 Search và hành vi

- PostgreSQL là nguồn dữ liệu nghiệp vụ; Elasticsearch và FAISS là index có thể xây lại.
- `productId` số nguyên được dùng xuyên suốt; `externalId` chỉ để truy vết dataset.
- Chỉ Product công khai được trả cho User, kể cả khi index phụ trợ cập nhật chậm.
- Search log lưu loại truy vấn, text hoặc tham chiếu ảnh an toàn, filter, thời gian và số kết quả.
- Click log lưu Product được click và rank tại thời điểm click.
- Không dùng search/click log làm ground truth tự động mà không nêu giả định trong thực nghiệm.

### 4.12 Dashboard, khuyến mãi và tài chính

- Dashboard Seller lấy doanh thu từ Order/Payment hợp lệ, không cộng Order đã hủy.
- Phải thống nhất `DELIVERED` hay `COMPLETED` là thời điểm ghi nhận doanh thu demo.
- Báo cáo ngày/tháng/quý dùng timezone hệ thống đã chốt.
- Voucher có thể áp dụng theo Store, Product, mức chi tiêu, thời gian và giới hạn lượt dùng; nhiều voucher còn có thứ tự/cộng dồn. Vì vậy khuyến mãi phức tạp là P2.
- Ví Seller, phí sàn, đối soát và rút tiền chỉ là hướng phát triển nếu hệ thống chỉ có COD mô phỏng.

### 4.13 Thông báo và khả năng vận hành thử

- Sau khi Order/Moderation/Chat/ReturnRequest commit, hệ thống tạo Notification cho đúng User/Seller/Admin. Lỗi gửi email hoặc kết nối WebSocket không được làm mất Order hay thay đổi trạng thái Product.
- Có trạng thái đã đọc, phân trang và không gửi trùng vô hạn; thông báo trong ứng dụng là P0, email qua adapter là P1. Không dùng notification làm nguồn chuẩn trạng thái đơn.
- API phân trang, lọc theo quyền và có trạng thái lỗi/rỗng; ảnh upload chỉ dùng đường dẫn hệ thống quản lý, giới hạn định dạng/dung lượng và không cho file từ dataset vượt thư mục bàn giao.
- Mọi tích hợp ngoài (Google, SMS/email, Payment, Shipping, object storage) đặt sau interface/adapter. Cấu hình giới hạn, thông điệp nghiệp vụ và trạng thái rõ ràng; Product/Order/Auth không gọi thẳng một nhà cung cấp cố định ở mọi tầng.
- Để mở bán thật cần quy trình người bán, điều khoản/chính sách, thanh toán/vận chuyển production, bảo mật/backup/giám sát và hỗ trợ khách hàng. Docker local, cổng sandbox và Seller tự bấm `DELIVERED` chưa đạt điều kiện này.

## 5. Phạm vi dùng trong báo cáo

### 5.1 Được mô tả là triển khai chính khi đã hoàn thành

- Auth và RBAC ba vai trò.
- Hồ sơ/địa chỉ User, Seller onboarding và Store công khai; xác minh email/khôi phục mật khẩu, Google login và phone OTP sandbox khi đã có code/test tích hợp.
- Store, Category, Product, Attribute, Variant và Image.
- Kiểm duyệt Product cơ bản.
- Keyword/text/image search, RRF và bộ lọc.
- Cart, checkout, COD, tồn kho và vòng đời Order.
- Hủy đơn cơ bản.
- ReturnRequest/hoàn tiền mô phỏng và quyết định Admin ở mức cơ bản nếu đã có luồng thực thi; không gọi đó là hoàn tiền thật.
- Chat User-Seller.
- Thông báo trong ứng dụng cho sự kiện chính; email qua provider thử nghiệm nếu đã kiểm thử.
- Review, Admin, Seller Dashboard và search/click log.
- Docker, migration, API docs, test và thực nghiệm.

### 5.2 Chỉ mô tả là thiết kế dự phòng/hướng phát triển nếu chưa làm

- Tranh chấp nhiều cấp, hoàn tiền một phần/chuyển tiền hoàn production và logistics hoàn hàng thật.
- Voucher và khuyến mãi chồng lớp.
- Nhiều kho.
- API vận chuyển và thanh toán thật.
- Ví Seller, phí sàn và đối soát.
- Kiểm duyệt giấy tờ/thương hiệu nâng cao.
- Livestream, affiliate, quảng cáo và Chat đa phương tiện.

## 6. Gợi ý cho Hiền cập nhật tài liệu

### SRS

- Mỗi yêu cầu chức năng có actor, tiền điều kiện, luồng chính, luồng ngoại lệ và hậu điều kiện.
- Đánh mã FR theo miền: `FR-AUTH`, `FR-PROFILE`, `FR-STORE`, `FR-PRODUCT`, `FR-SEARCH`, `FR-CART`, `FR-ORDER`, `FR-PAYMENT`, `FR-RETURN`, `FR-NOTIFY`, `FR-CHAT`, `FR-REVIEW`, `FR-ADMIN`.
- NFR cần có thời gian phản hồi tìm kiếm, bảo mật/ownership, tính nhất quán tồn kho, khả năng tái lập bằng Docker và khả năng phục hồi Chat cơ bản.

### Use Case

- Tách actor User, Seller, Admin và FastAPI Search Service.
- Không vẽ database, FAISS hoặc Elasticsearch như actor nghiệp vụ.
- Bổ sung Chat với Seller, gửi tin, xem lịch sử và đánh dấu đã đọc.
- Với Order, thể hiện rõ xác nhận, chuẩn bị, giao, hoàn tất và hủy.

### ERD

- Thể hiện Product-Variant và OrderItem snapshot.
- CartItem tham chiếu Variant.
- Tách Order, Payment và Shipment.
- Có OrderStatusHistory và StockMovement.
- Chat gồm Conversation, Message và ConversationReadState.
- Không đưa bảng P2 vào ERD “đã triển khai” nếu code/migration chưa có; có thể đặt trong sơ đồ mở rộng riêng.
- Tách `UserAddress`, `StoreAddress`, `Notification`, `ReturnRequest` và history khi các luồng tương ứng được chốt; IdentityProvider/OTP/ResetToken không được tự nhồi vào Product/Store.

### Activity/Sequence Diagram

Ưu tiên các luồng:

1. Seller tạo Product → duyệt → đồng bộ Search Service.
2. User tìm bằng ảnh/text → RRF → Backend hydrate Product.
3. Checkout → tạo Order → trừ tồn kho transaction.
4. Seller chuyển trạng thái Order.
5. Hủy Order → hoàn tồn kho.
6. Chat User-Seller qua REST + WebSocket + PostgreSQL.
7. User đánh giá OrderItem.
8. User yêu cầu hậu mãi → Seller phản hồi → Admin quyết định → ghi hoàn tiền mô phỏng.
9. Đăng ký/xác minh hoặc Google login → hồ sơ → Seller onboarding → Admin chấp thuận Store.

### Test case

- Có happy path, validation, sai quyền, trạng thái không hợp lệ và request lặp.
- Test ownership giữa hai Store và hai User.
- Test mất kết nối Search Service nhưng dữ liệu PostgreSQL không bị mất.
- Test index chậm nhưng Product bị ẩn không được trả công khai.
- Test Chat chống đọc chéo, tin rỗng/quá dài, reconnect và idempotency.
- Test seed Admin không nâng User trùng email; OAuth/OTP/đổi liên hệ không nối sai identity hoặc tự tăng role.
- Test User không mở Store chưa được duyệt; Seller không xem/sửa Order/ReturnRequest của Store khác.
- Test hậu mãi sai trạng thái, sai owner, request lặp và hoàn tiền mô phỏng không làm sai tồn kho/doanh thu.

## 7. Cách trích dẫn và diễn đạt trong báo cáo

Nên viết:

> Nhóm khảo sát quy trình quản lý sản phẩm, xử lý đơn hàng, hậu mãi và đánh giá của một số sàn thương mại điện tử phổ biến. Từ kết quả khảo sát, nhóm lựa chọn tập trung vào các nghiệp vụ phù hợp phạm vi khóa luận và giản lược các cơ chế vận hành phụ thuộc nền tảng thực tế.

Không nên viết:

> Hệ thống hoạt động giống hoàn toàn Shopee/TikTok Shop.

Khi dùng thông tin cụ thể từ một nguồn:

- Ghi tên tổ chức/trang, tên bài, URL và ngày truy cập.
- Ưu tiên nguồn chính thức.
- Paraphrase bằng lời của nhóm; không sao chép dài nguyên văn.
- Không dùng thời hạn/chính sách của sàn làm yêu cầu hệ thống nếu nhóm chưa chủ động chọn và kiểm thử yêu cầu đó.
- Trong chương kết quả, chỉ mô tả chức năng có bằng chứng từ bản tích hợp.

## 8. Quyết định nghiệp vụ MVP

Các quyết định sau phân biệt quy tắc **CURRENT** đã merge với mục tiêu **TARGET** của bản bảo vệ. Dòng `TARGET/P0` là yêu cầu nghiệp vụ đã xác nhận nhưng phương án kỹ thuật/migration cần Hoàng–Hiền review; dòng `TARGET/chờ review` còn cần chốt chi tiết nghiệp vụ trước khi đổi schema/API hiện có:

| Chủ đề | Quyết định MVP |
|---|---|
| Role tài khoản `CURRENT` | Mỗi tài khoản có đúng một role theo schema đã merge. Chỉ `USER` dùng giỏ hàng, checkout, đánh giá và phía người mua của Chat; `SELLER` quản lý Store/sản phẩm/đơn/inbox. Không mô tả hệ thống hiện đã hỗ trợ cùng người vừa mua vừa bán. |
| Role tài khoản `TARGET/P0` | Trong bản bảo vệ, tài khoản đã xác minh mua hàng và nộp yêu cầu mở Store; quyền Seller chỉ được cấp sau onboarding. Reviewer chốt phương án multi-role/capability và migration mới, giữ dữ liệu cũ và cập nhật Auth, JWT, ownership, SRS, UI và test. Không tự nâng role chỉ theo email/seed. |
| Store | Một `SELLER` sở hữu tối đa một Store. Chưa có `StoreMember`; nhân viên Store là P2. |
| Seller onboarding `TARGET/P0` | Store mới ở `PENDING`, điền liên hệ/địa chỉ lấy/hoàn hàng; Admin đưa về `ACTIVE`, `REJECTED` hoặc `SUSPENDED` với reason/history. Store `REJECTED` được sửa và nộp lại về `PENDING` trên cùng bản ghi; `SUSPENDED` chỉ Admin được khôi phục. Quy trình giấy tờ định danh thật chỉ thiết kế cho pilot production có chính sách dữ liệu. |
| Identity `TARGET/chờ review` | Email verify/reset; một OAuth provider với identity khóa theo provider+subject; phone OTP sandbox có giới hạn và hết hạn. Không tự ghép tài khoản theo email trùng. |
| Giỏ nhiều Store | Một lần checkout tách thành một Order độc lập cho mỗi Store; mỗi Order chỉ thuộc một Store. |
| Tồn kho | Trừ tồn kho trong transaction tạo Order tại checkout. Khi hủy ở trạng thái cho phép, hoàn kho bằng transaction/idempotency key và không được hoàn hai lần. |
| Trạng thái Order | Dùng chuỗi ở mục 4.6: `PENDING_CONFIRMATION → CONFIRMED → PACKING → READY_TO_SHIP → SHIPPING → DELIVERED → COMPLETED`, cùng các nhánh `CANCELLED` và `DELIVERY_FAILED`. Chỉ command Backend hợp lệ mới được chuyển trạng thái. |
| COD và doanh thu | COD chuyển từ `UNPAID` sang `PAID` khi Order đạt `DELIVERED`; doanh thu Dashboard chỉ ghi nhận khi Order đạt `COMPLETED`. |
| Hủy đơn | User có thể hủy khi `PENDING_CONFIRMATION`; Seller có thể hủy khi `PENDING_CONFIRMATION` hoặc `CONFIRMED` và phải lưu lý do. Sau `PACKING`, hủy chỉ là hướng mở rộng/quy trình Admin. |
| Review | Chỉ tạo Review cho OrderItem thuộc User khi Order đã `COMPLETED`; một OrderItem tối đa một Review. |
| Hậu mãi `TARGET/P1` | Yêu cầu gắn OrderItem đã giao; Seller phản hồi và Admin quyết định bất đồng cơ bản. P1 hoàn toàn bộ OrderItem theo snapshot. `REFUND_ONLY` không hoàn kho; `RETURN_AND_REFUND` chỉ hoàn kho sau `ITEM_RECEIVED` và `RESTOCKABLE`. Refund tạo adjustment âm đúng một lần để Dashboard tính doanh thu thuần; history/idempotency tách khỏi OrderStatus. |
| Thông báo `TARGET/chờ review` | P0 inbox trong ứng dụng sau commit sự kiện chính; P1 email adapter; không rollback giao dịch khi gửi notification thất bại. |
| Conversation ID | Dùng `Int` tự tăng do PostgreSQL sinh. |
| Giới hạn cấu hình | MVP cấu hình tối đa 9 ảnh/Product, tối đa 2 option group/Product, Message tối đa 2.000 ký tự; phân trang Chat mặc định 30 và tối đa 100 bản ghi/request. Các giá trị nằm trong cấu hình/validation, không đóng cứng thành cấu trúc schema. |

Thay đổi một quyết định trong bảng phải cập nhật tài liệu liên quan trước migration và được Hoàng–Hiền review. Đạt chỉ cần review phần tác động Product import, dữ liệu công khai, filter, index, search log và contract Backend–Search Service.
