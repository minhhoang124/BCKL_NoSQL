# Thiết kế miền sản phẩm đa ngành hàng

Tài liệu này là nguồn chuẩn để Hoàng, Hiền, Đạt và các coding agent thống nhất cách thiết kế sản phẩm, database, dữ liệu import và chỉ mục tìm kiếm. Hệ thống là **sàn thương mại điện tử đa ngành hàng**; dataset ABO hoặc dataset khác chỉ là dữ liệu prototype/seed, không quyết định schema.

Kế hoạch chuyển thiết kế này thành migration, API và các PR code nhỏ được mô tả tại [`product-implementation-plan.md`](product-implementation-plan.md).

## 1. Nguyên tắc bắt buộc

- PostgreSQL là nguồn dữ liệu nghiệp vụ chính.
- FAISS và Elasticsearch là index phụ trợ, có thể xây lại từ PostgreSQL.
- `productId` là `Int` do PostgreSQL sinh và dùng xuyên suốt Backend, Elasticsearch và FAISS.
- `externalId` là `String?`, unique khi có, chỉ dùng truy vết dữ liệu import và chống import trùng. Giá trị có dạng `<source>:<source-id>`, trong đó prefix nguồn viết thường, ví dụ `abo:B07ABC123` hoặc `kaggle:ELEC001`. `abo:` chỉ áp dụng cho Amazon Berkeley Objects, không phải prefix cố định của toàn hệ thống. Sản phẩm Seller tạo trực tiếp có `externalId = null`.
- Không tạo cột cố định như `color`, `size`, `ram` trong bảng `products`.
- Giá và tồn kho thuộc `ProductVariant`, kể cả sản phẩm không có nhiều lựa chọn.
- Giỏ hàng và thao tác tồn kho luôn tham chiếu `variantId`.
- `OrderItem` giữ snapshot tên sản phẩm, SKU, thuộc tính và giá tại thời điểm đặt.
- Dataset thiếu trường được import ở trạng thái `DRAFT`; không tự suy đoán thuộc tính không có trong nguồn.
- Chỉ sản phẩm đủ dữ liệu, được duyệt và ở trạng thái công khai mới xuất hiện trong tìm kiếm của khách hàng.

## 2. Quy trình Seller đăng sản phẩm

Quy trình được giản lược theo cách các sàn thương mại điện tử hiện đại vận hành:

```text
Seller có tài khoản
→ Thiết lập cửa hàng
→ Tạo sản phẩm DRAFT
→ Nhập tên và chọn danh mục lá
→ Nhập mô tả, thương hiệu và ảnh
→ Điền thuộc tính mô tả theo danh mục
→ Tạo nhóm phân loại và các lựa chọn
→ Hệ thống sinh tổ hợp ProductVariant
→ Seller nhập giá, tồn kho và SKU riêng nếu có cho từng variant
→ Nhập khối lượng và kích thước kiện hàng
→ Gửi duyệt
→ Admin duyệt
→ Sản phẩm ACTIVE
→ Backend lập lịch đồng bộ Search Service hợp nhất
```

Tham khảo nghiệp vụ:

- [TikTok Shop Seller University - Add and Manage Product](https://seller-vn.tiktok.com/university/essay?knowledge_id=10008556&lang=en).
- [TikTok Shop Seller University - Product Attributes Guidelines](https://seller-vn.tiktok.com/university/essay?knowledge_id=2034281343239937&lang=en).
- [Quy trình đăng sản phẩm trên Shopee do Sapo tổng hợp](https://www.sapo.vn/blog/cach-dang-san-pham-tren-shopee).
- [Quy trình đăng sản phẩm trên TikTok Shop do Điện Máy Chợ Lớn tổng hợp](https://dienmaycholon.com/kinh-nghiem-mua-sam/chia-se-cach-dang-san-pham-len-tiktok-shop-duyet-nhanh-100).

Các nguồn trên được dùng để tham khảo luồng nghiệp vụ. Giới hạn như số ảnh, dung lượng ảnh hoặc số nhóm phân loại phải nằm trong cấu hình/validation của Backend, không đóng cứng vào schema database vì chính sách sàn có thể thay đổi.

## 3. Hai loại thuộc tính khác nhau

### 3.1 Thuộc tính mô tả theo danh mục

Admin quản lý các định nghĩa chuẩn để dữ liệu đồng nhất và có thể lọc.

Ví dụ danh mục điện thoại:

- Hệ điều hành.
- RAM.
- Kích thước màn hình.
- Dung lượng pin.

Ví dụ danh mục áo:

- Chất liệu.
- Kiểu dáng.
- Giới tính.

Các thực thể đề xuất:

- `CategoryAttributeDefinition`: tên, kiểu dữ liệu, bắt buộc hay không, có dùng làm bộ lọc hay không.
- `CategoryAttributeOption`: lựa chọn chuẩn nếu thuộc tính dùng danh sách option.
- `ProductAttributeValue`: giá trị mà Seller nhập/chọn cho sản phẩm.

Admin kiểm soát tên chuẩn để tránh tạo đồng thời `Color`, `Màu` và `Màu sắc`. Seller có thể nhập giá trị tự do chỉ khi định nghĩa thuộc tính cho phép.

### 3.2 Nhóm phân loại tạo variant

Nhóm phân loại thuộc phạm vi một sản phẩm và do Seller cấu hình trong giới hạn hệ thống.

Ví dụ:

```text
Nhóm Màu sắc: Đen, Trắng
Nhóm Kích thước: M, L
```

Hệ thống sinh:

```text
Đen / M
Đen / L
Trắng / M
Trắng / L
```

Các thực thể đề xuất:

- `ProductOptionGroup`: nhóm phân loại của một Product, ví dụ Màu sắc.
- `ProductOptionValue`: lựa chọn trong nhóm, ví dụ Đen.
- `ProductVariant`: một SKU có giá, tồn kho và trạng thái riêng.
- `ProductVariantOptionValue`: bảng nối variant với các lựa chọn tạo nên variant đó.

Không nên buộc mọi lựa chọn variant của Seller phải là option dùng chung toàn danh mục. Tuy nhiên tên nhóm cần được chuẩn hóa hoặc gợi ý từ thuộc tính danh mục.

## 4. Mô hình dữ liệu logic

```text
User (SELLER)
└── Store
    └── Product
        ├── Category
        ├── Brand (nullable)
        ├── ProductImage[] ── ProductOptionValue? (ảnh theo lựa chọn)
        ├── ProductShippingProfile?
        ├── ProductAttributeValue[]
        ├── ProductOptionGroup[]
        │   └── ProductOptionValue[]
        └── ProductVariant[]
            └── ProductVariantOptionValue[]
```

### 4.1 Store

Trường tối thiểu:

- `id`
- `sellerId` unique
- `name`
- `description?`
- `status`
- `createdAt`, `updatedAt`

Một Seller sở hữu tối đa một Store trong phạm vi khóa luận.

### 4.2 Category

Trường tối thiểu:

- `id`
- `parentId?`
- `name`
- `slug` unique
- `isActive`

Admin quản lý cây danh mục. Seller chỉ chọn danh mục lá đang hoạt động.

### 4.3 Product

Trường tối thiểu:

- `id`: khóa số nguyên do PostgreSQL sinh.
- `externalId?`: mã truy vết nguồn import dạng `<source>:<source-id>`, unique khi có; null với sản phẩm Seller tạo trực tiếp.
- `storeId`
- `categoryId`
- `brandId?`
- `name`
- `description?`
- `sellerStatus`
- `moderationStatus`
- `rejectionReason?`
- `submittedAt?`, `reviewedAt?`, `reviewedBy?`
- `version`: tăng khi thay đổi dữ liệu cần đồng bộ tìm kiếm.
- `createdAt`, `updatedAt`

Không lưu `color`, `size`, `price`, `stock` cố định trong Product.

### 4.4 ProductImage

- Một Product có nhiều ảnh.
- Có `sortOrder` và tối đa một ảnh chính.
- Ảnh chung chỉ tham chiếu `productId`.
- Ảnh đại diện cho một lựa chọn như màu Đen có thể tham chiếu thêm `productOptionValueId?`.
- Không nhân bản cùng một ảnh cho mọi tổ hợp variant như `Đen / 128GB` và `Đen / 256GB` nếu ảnh chỉ đại diện cho màu Đen.
- Chỉ lưu URL/đường dẫn tương đối do hệ thống quản lý; không lưu đường dẫn tuyệt đối trên máy cá nhân.
- Quy tắc số lượng, định dạng, kích thước, dung lượng và tỉ lệ ảnh thuộc validation/configuration của Backend. Cấu hình demo có thể áp dụng tối đa 9 ảnh, ảnh vuông và độ phân giải tối thiểu 600 x 600 theo luồng tham khảo TikTok Shop.

### 4.5 ProductVariant

Trường tối thiểu:

- `id`
- `productId`
- `skuCode`: mã nội bộ do hệ thống sinh, unique toàn hệ thống.
- `sellerSku?`: mã do Seller tự nhập, có thể null.
- `price` decimal, lớn hơn 0 khi đăng bán
- `stock` integer, không âm
- `isActive`
- `createdAt`, `updatedAt`

`sellerSku` chỉ cần duy nhất trong phạm vi một Store, không phải toàn sàn. Backend kiểm tra trong transaction thông qua quan hệ Variant → Product → Store; nếu schema triển khai lặp `storeId` ở Variant để tạo unique index `(storeId, sellerSku)` thì phải bảo đảm `storeId` luôn khớp Product.

Product ở trạng thái `DRAFT` được phép chưa có variant. Trước khi gửi duyệt/đăng bán phải có ít nhất một variant hợp lệ.

Sản phẩm không có phân loại vẫn tạo một variant mặc định. Nhờ đó giỏ hàng, đơn hàng và tồn kho không phải xử lý hai mô hình khác nhau.

### 4.6 Ràng buộc tổ hợp variant

- Một variant chỉ được chọn tối đa một giá trị trong mỗi `ProductOptionGroup`.
- Hai variant của cùng Product không được có cùng tổ hợp lựa chọn.
- Mỗi lựa chọn của variant phải thuộc option group của chính Product đó.
- Tên nhóm và giá trị phân loại được Seller nhập trong phạm vi Product; không tạo các cột cố định `color`, `size` hoặc giới hạn schema ở một ngành hàng.
- Số nhóm phân loại tối đa là chính sách cấu hình của hệ thống, không phải ràng buộc cố định của database.
- Backend kiểm tra các quy tắc liên bảng trong transaction.
- Database dùng unique key/index cho những ràng buộc biểu diễn trực tiếp được; không tuyên bố một PK ghép đơn giản có thể tự chặn mọi tổ hợp trùng.

### 4.7 ProductShippingProfile

Thông tin kiện hàng thuộc cấp Product trong phạm vi khóa luận:

- `productId` unique.
- `packageWeightGrams?`.
- `packageLengthCm?`.
- `packageWidthCm?`.
- `packageHeightCm?`.

Product ở trạng thái `DRAFT` được phép thiếu thông tin kiện hàng. Trước khi gửi duyệt, `packageWeightGrams` phải lớn hơn 0; các kích thước có thể để trống theo cấu hình nghiệp vụ. Nếu sau này mỗi variant có kiện hàng khác nhau, mở rộng bằng override ở Variant thay vì thay thế dữ liệu cấp Product.

COD, đơn vị vận chuyển, phí vận chuyển và địa chỉ lấy hàng là chính sách của Store/đơn hàng hoặc module vận chuyển, không lưu lẫn vào thuộc tính mô tả Product.

### 4.8 CartItem và OrderItem

`CartItem`:

- Tham chiếu `variantId`, không chỉ `productId`.
- Unique theo `(cartId, variantId)`.
- Giá và tồn kho được đọc lại từ variant khi hiển thị giỏ và checkout.

`OrderItem`:

- Giữ `productId` và `variantId` để truy vết.
- Lưu `productNameSnapshot`, `skuSnapshot`, `attributesSnapshot`, `unitPrice`, `quantity`.
- Snapshot không thay đổi khi Seller sửa sản phẩm sau này.

## 5. Trạng thái sản phẩm và kiểm duyệt

Đề xuất tách trạng thái Seller và trạng thái kiểm duyệt để tránh một enum gánh nhiều ý nghĩa.

Trạng thái vòng đời hiển thị có thể suy ra từ:

- `sellerStatus`: `DRAFT`, `ACTIVE`, `HIDDEN`.
- `moderationStatus`: `NOT_SUBMITTED`, `PENDING`, `APPROVED`, `REJECTED`, `FROZEN`.

Ý nghĩa:

- `DRAFT` + `NOT_SUBMITTED`: Seller đang hoàn thiện và có thể lưu nháp.
- `PENDING`: đã gửi duyệt; các trường ảnh hưởng nội dung bán hàng không được công khai trước khi duyệt.
- `REJECTED`: Admin từ chối và phải ghi `rejectionReason`; Seller được sửa rồi gửi lại.
- `APPROVED`: đã đạt kiểm duyệt nhưng chỉ công khai khi `sellerStatus = ACTIVE` và các điều kiện bán hàng đều hợp lệ.
- `FROZEN`: Admin đóng băng do vi phạm hoặc cần điều tra; Seller không thể tự kích hoạt lại.

Mỗi lần gửi duyệt cập nhật `submittedAt`. Mỗi quyết định duyệt cập nhật `reviewedAt`, `reviewedBy` và lý do nếu bị từ chối/đóng băng. Lịch sử kiểm duyệt chi tiết có thể tách thành bảng audit ở giai đoạn triển khai Admin.

Một sản phẩm chỉ công khai khi đồng thời:

- Seller cho phép hiển thị.
- Admin đã duyệt.
- Store và tài khoản Seller hoạt động.
- Có ảnh chính hợp lệ.
- Có ít nhất một variant hoạt động với giá hợp lệ.
- Có khối lượng kiện hàng hợp lệ.

## 6. Quản lý thuộc tính và API dự kiến

Admin:

```text
POST   /admin/categories/{categoryId}/attributes
PATCH  /admin/categories/{categoryId}/attributes/{attributeId}
POST   /admin/categories/{categoryId}/attributes/{attributeId}/options
PATCH  /admin/categories/{categoryId}/attributes/{attributeId}/options/{optionId}
```

Public/Seller đọc cấu hình danh mục:

```text
GET /categories/{categoryId}/attributes
```

Seller tạo sản phẩm:

```text
POST  /seller/products
PATCH /seller/products/{productId}
POST  /seller/products/{productId}/variants
PATCH /seller/products/{productId}/variants/{variantId}
POST  /seller/products/{productId}/images
PUT   /seller/products/{productId}/shipping-profile
POST  /seller/products/{productId}/submit
PATCH /seller/products/{productId}/visibility
```

Admin kiểm duyệt:

```text
GET   /admin/products/review-queue
POST  /admin/products/{productId}/approve
POST  /admin/products/{productId}/reject
POST  /admin/products/{productId}/freeze
```

API chi tiết sẽ được chốt trong tài liệu riêng trước khi code controller.

## 7. Dữ liệu import và dataset

Dataset chỉ cần cung cấp dữ liệu có thật trong nguồn:

```json
{
  "schemaVersion": 1,
  "source": "abo",
  "externalId": "abo:B07ABC123",
  "name": "Wireless Bluetooth Headphones",
  "description": "Over-ear wireless headphones",
  "brand": "Sony",
  "externalCategory": "headphones",
  "normalizedCategory": "Electronics > Audio > Headphones",
  "images": [
    {
      "sourcePath": "images/B07ABC123/1.jpg",
      "sortOrder": 1,
      "isPrimary": true
    }
  ],
  "sourceAttributes": {
    "color": "Black"
  }
}
```

- `schemaVersion`: phiên bản số nguyên của schema JSONL; bản đầu dùng `1`.
- `source`: mã nguồn viết thường và phải khớp prefix của `externalId`.
- `externalCategory`: giá trị danh mục nguyên bản từ dataset, không tự sửa nghĩa.
- `normalizedCategory`: đường dẫn/tên danh mục chuẩn mà adapter đề xuất để Backend ánh xạ; nếu chưa ánh xạ chắc chắn thì để null và giữ Product ở trạng thái `DRAFT`.
- `images`: danh sách ảnh trong gói bàn giao; `sortOrder` xác định thứ tự và mỗi sản phẩm có tối đa một ảnh `isPrimary = true`.

Quy trình:

```text
Metadata + ảnh đã làm sạch
→ Adapter ánh xạ trường chắc chắn
→ Import/upsert theo externalId
→ PostgreSQL sinh productId
→ Backend kiểm tra và ingest từng images[].sourcePath
→ Backend lưu ảnh rồi sinh imageUrls do hệ thống quản lý
→ Thiếu dữ liệu thì giữ DRAFT
→ Hoàng/Seller bổ sung thuộc tính, variant và kiện hàng
→ Đủ điều kiện thì gửi duyệt/ACTIVE
→ Xuất mapping externalId → productId
→ Đạt xây lại FAISS/Elasticsearch bằng productId
```

Không tự đoán brand, màu, RAM, dung lượng hoặc thông số không có trong nguồn. Giá/tồn kho/SKU giả lập phải được đánh dấu là dữ liệu sinh phục vụ demo.

Mỗi `images[].sourcePath` chỉ chứa đường dẫn tương đối nằm trong thư mục gốc của gói dataset bàn giao. Importer phải từ chối đường dẫn tuyệt đối, phần `..` vượt thư mục gốc, symlink thoát khỏi thư mục gốc và file không thuộc định dạng ảnh cho phép. Đây là dữ liệu đầu vào cho quá trình import, không phải URL công khai. Sau khi kiểm tra và ingest/upload thành công, Backend mới tạo bản ghi `ProductImage` theo `sortOrder`/`isPrimary` và sinh `imageUrls` do hệ thống quản lý để gửi sang Search Service.

Mapping bàn giao cho AI:

```json
{"externalId":"abo:B07ABC123","productId":125}
```

ABO 1.200 sản phẩm điện tử là corpus prototype hiện tại. Nếu đổi dataset, chỉ thay adapter/import mapping; không thiết kế lại schema sản phẩm.

## 8. Đồng bộ tìm kiếm

- PostgreSQL là nguồn dữ liệu nghiệp vụ chính; Backend luôn commit thay đổi sản phẩm vào PostgreSQL trước.
- Backend tạo một outbox/job tới target `SEARCH_SERVICE`, không tạo hai job độc lập cho Elasticsearch và AI Service.
- Request đồng bộ phải idempotent theo `productId` và `version`; Search Service bỏ qua phiên bản cũ hơn phiên bản đã lập chỉ mục.
- FastAPI Search Service quản lý cả Elasticsearch, CLIP/FAISS và bước hợp nhất RRF. Backend không gọi trực tiếp Elasticsearch và không tự tính RRF.
- Payload lập chỉ mục chứa dữ liệu công khai ở cấp Product, bao gồm `productId`, `version`, tên, mô tả, danh mục, thương hiệu và `imageUrls` do Backend quản lý. Giá nhỏ nhất/lớn nhất và thuộc tính đã chuẩn hóa có thể được gửi làm dữ liệu lọc; Search Service không phải nguồn chuẩn của giá hoặc tồn kho variant.
- Search Service phải trả trạng thái cập nhật của các index để Backend retry cùng `productId`/`version` khi một phần cập nhật thất bại.
- Khi tìm kiếm production, NestJS gọi endpoint hợp nhất `POST /search/hybrid`; Search Service chạy Elasticsearch và CLIP/FAISS rồi thực hiện RRF.
- Backend hydrate kết quả bằng PostgreSQL, loại sản phẩm không còn công khai hoặc dữ liệu không hợp lệ và giữ nguyên thứ tự xếp hạng còn lại.
- Xóa/hide Product phải bị loại khỏi kết quả công khai ngay ở bước kiểm tra PostgreSQL, kể cả khi index phụ trợ cập nhật chậm.
- Contract Backend–Search Service chính thức nằm tại `docs/api/ai-service-contract.md`; thay đổi endpoint hoặc payload phải được Hoàng và Đạt cùng review.

## 9. Quyền sở hữu

- Seller chỉ được sửa Store/Product/Variant của chính mình.
- Client không được tự gửi `sellerId`, `storeId` hoặc `role` để vượt quyền; Backend suy ra từ JWT.
- Admin quản lý danh mục, định nghĩa thuộc tính và kiểm duyệt.
- Sản phẩm/variant nên ẩn hoặc vô hiệu hóa thay vì xóa cứng khi đã phát sinh đơn hàng.

## 10. Điều kiện nghiệm thu thiết kế

- Schema không phụ thuộc một ngành hàng hoặc dataset.
- Product DRAFT có thể chưa có variant; Product bán được có ít nhất một variant.
- Giá/tồn kho nằm ở variant.
- SKU nội bộ được hệ thống sinh; Seller SKU là tùy chọn và chỉ có ý nghĩa trong phạm vi Store.
- Ảnh có thể gắn với một giá trị phân loại như màu sắc mà không bị nhân bản theo mọi tổ hợp variant.
- Thông tin kiện hàng được tách khỏi thuộc tính mô tả và phải hợp lệ trước khi gửi duyệt.
- Cart tham chiếu variant.
- Order lưu snapshot bất biến.
- Thuộc tính mô tả được phân biệt với nhóm phân loại tạo variant.
- Giới hạn ảnh và số nhóm phân loại nằm trong cấu hình/validation, không đóng cứng schema.
- Có vòng đời lưu nháp, gửi duyệt, từ chối, gửi lại, duyệt và đóng băng với lý do truy vết được.
- `externalId` nullable; dữ liệu import dùng namespace theo nguồn, còn sản phẩm Seller tạo trực tiếp để null.
- Dataset thiếu trường không bị AI tự suy đoán.
- Có thể đổi dataset mà không sửa schema cốt lõi.
- Mọi thay đổi contract Backend–AI được Hoàng và Đạt cùng review.

## 11. Phân công áp dụng

- Hoàng dùng tài liệu này để thiết kế Prisma schema, migration, API Seller/Product, import và mapping.
- Hiền dùng tài liệu này để cập nhật SRS, ERD, Use Case, test case và module Admin.
- Đạt dùng tài liệu này để chuẩn hóa metadata đầu vào và giữ `productId` nhất quán trong FAISS/Elasticsearch.
- Nếu phát hiện yêu cầu mới mâu thuẫn tài liệu, không tự đổi schema hoặc contract; mở thảo luận và yêu cầu đúng người review.
