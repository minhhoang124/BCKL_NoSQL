# Kế hoạch triển khai Store và Product

Tài liệu này chuyển thiết kế nghiệp vụ trong `product-domain-design.md` thành kế hoạch code có thể review trước khi tạo migration. Đây là kế hoạch triển khai, chưa phải bằng chứng rằng chức năng đã hoàn thành.

## Cập nhật tiến độ 25/09/2026

- Đợt A và B đã có trên develop; PR #18 (`cbc3e40`) hoàn thành Seller draft/options/attributes/variants/images/shipping/submit và importer.
- Phần còn lại đợt C đang triển khai trong `codex/product-moderation-public`: Admin review, visibility và public read, kèm migration lịch sử quyết định. Xem [contract và acceptance](../api/product-moderation-public-api.md).
- Tiếp theo sau review/merge: đợt D transactional outbox/worker và hydrate/filter; phối hợp PR #8 của Đạt. Sau đó triển khai UI Seller/Admin/Public, rồi Auth đa quyền/profile/address và Cart/Order.
- Các mục “schema hiện tại” phía dưới là baseline lúc lập kế hoạch, không phải mô tả schema develop mới nhất. Trạng thái mới nhất nằm ở [tổng quan kiến trúc](system-architecture-overview.md).

## 1. Mục tiêu

- Thay schema Product prototype bằng mô hình sàn đa ngành hàng.
- Giữ PostgreSQL là nguồn dữ liệu nghiệp vụ chính.
- Tách Product khỏi giá/tồn kho; mọi giá và tồn kho thuộc ProductVariant.
- Hỗ trợ Store, Category, Brand, thuộc tính mô tả, nhóm phân loại, ảnh và thông tin kiện hàng.
- Chuẩn bị luồng duyệt Product và đồng bộ idempotent tới FastAPI Search Service.
- Cho phép import dataset theo schema JSONL đã chốt mà không làm schema phụ thuộc ABO.

Ngoài phạm vi đợt code đầu: Cart/Order hoàn chỉnh, Chat, nhiều kho, khuyến mãi, trả hàng/hoàn tiền và giao vận thật.

## 2. Khoảng cách so với schema hiện tại

Schema hiện tại chỉ có `User` và `Product`; `Product` giữ trực tiếp `sellerId`, `price`, `stock` và một enum trạng thái đơn giản. Trước khi xây giao diện Seller cần thay đổi:

| Hiện tại | Thiết kế đích |
|---|---|
| Product thuộc trực tiếp User | Product thuộc Store; Store thuộc Seller |
| Giá/tồn kho ở Product | Giá/tồn kho ở ProductVariant |
| Không có Category/Brand | Category cây và Brand độc lập |
| Không có thuộc tính/option | Tách thuộc tính mô tả khỏi option tạo variant |
| Không có ảnh/kiện hàng | ProductImage và ProductShippingProfile |
| Một ProductStatus | Tách sellerStatus và moderationStatus |
| Chưa có cơ chế đồng bộ bền vững | Transactional outbox tới SEARCH_SERVICE |

Không sửa migration đã merge. Mọi thay đổi phải nằm trong migration mới và chạy được trên fresh checkout lẫn database đã có schema prototype.

## 3. Mô hình Prisma dự kiến

### 3.1 Store và catalog

- `Store`: `id`, `sellerId` unique, `name`, `description?`, `status`, timestamps.
- `Category`: `id`, `parentId?`, `name`, `slug` unique, `isActive`, timestamps.
- `Brand`: `id`, `name`, `slug` unique, `isActive`, timestamps.
- `Product`: `id`, `externalId?` unique, `storeId`, `categoryId`, `brandId?`, `name`, `description?`, `sellerStatus`, `moderationStatus`, dữ liệu duyệt, `version`, timestamps.

MVP cho phép một Seller sở hữu tối đa một Store. Seller chỉ chọn Category lá đang hoạt động. `externalId` chỉ dùng cho dữ liệu import theo dạng `<source>:<source-id>`; Product Seller tạo có giá trị null.

### 3.2 Thuộc tính mô tả

- `CategoryAttributeDefinition`: định nghĩa thuộc tính theo Category, kiểu dữ liệu, required/filterable và quy tắc nhập.
- `CategoryAttributeOption`: option chuẩn của thuộc tính dạng lựa chọn.
- `ProductAttributeValue`: giá trị cụ thể của Product; chỉ dùng option chuẩn khi definition yêu cầu.

Các bảng này phục vụ mô tả và filter. Chúng không tự động là trục tạo SKU.

### 3.3 Option và variant

- `ProductOptionGroup`: nhóm do Seller cấu hình trong phạm vi Product.
- `ProductOptionValue`: giá trị thuộc một ProductOptionGroup.
- `ProductVariant`: `productId`, `storeId`, `skuCode`, `sellerSku?`, `price`, `stock`, `isActive`, `optionSignature`, timestamps.
- `ProductVariantOptionValue`: nối Variant với các ProductOptionValue.

Ràng buộc:

- `skuCode` unique toàn hệ thống và do Backend sinh.
- `sellerSku` nullable, unique trong phạm vi Store bằng `@@unique([storeId, sellerSku])`.
- `Product` có composite unique `(id, storeId)` và Variant tham chiếu composite `(productId, storeId)` để không thể gắn Store sai.
- `optionSignature` được Backend chuẩn hóa từ danh sách option đã sắp xếp; unique `(productId, optionSignature)`.
- Một Variant chọn tối đa một value trong mỗi option group; Backend kiểm tra và ghi Variant cùng bảng nối trong transaction.
- Product không phân loại vẫn có một Variant mặc định.
- `price` dùng Decimal(12,2), lớn hơn 0 khi bán; `stock` là Int không âm.

### 3.4 Ảnh và kiện hàng

- `ProductImage`: `productId`, `productOptionValueId?`, URL/path do hệ thống quản lý, `sortOrder`, `isPrimary`, timestamps.
- `ProductShippingProfile`: `productId` unique, khối lượng gram và ba kích thước cm nullable.

Backend bảo đảm mỗi Product tối đa một ảnh chính. Ảnh đại diện màu có thể gắn ProductOptionValue mà không nhân bản theo mọi Variant. Product chỉ được gửi duyệt khi có ảnh chính và khối lượng kiện hàng hợp lệ.

### 3.5 Kiểm duyệt và đồng bộ

- `sellerStatus`: `DRAFT`, `ACTIVE`, `HIDDEN`.
- `moderationStatus`: `NOT_SUBMITTED`, `PENDING`, `APPROVED`, `REJECTED`, `FROZEN`.
- `SearchOutbox`: target cố định `SEARCH_SERVICE`, operation, `productId`, `version`, payload JSON, trạng thái, số lần thử, thời điểm retry và lỗi rút gọn.

Unique outbox theo `(target, productId, version)`. Mỗi phiên bản Product chỉ biểu diễn một trạng thái cuối và một operation; không được đồng thời có `UPSERT` và `DELETE` cho cùng phiên bản. Thay đổi ảnh hưởng tìm kiếm tăng Product.version và ghi Product + outbox trong cùng transaction. Worker chỉ đánh dấu hoàn tất khi Search Service xác nhận trạng thái index theo contract.

## 4. Chiến lược migration an toàn

Áp dụng expand–migrate–contract, không chỉnh migration `init` hoặc `add_auth_refresh_tokens`:

1. **Expand:** thêm enum/bảng mới và các cột Product mới ở dạng nullable khi cần backfill.
2. **Migrate data:** tạo Store mặc định cho Seller có Product cũ; tạo Category legacy; gán Product vào Store/Category; tạo một Variant mặc định từ `price`/`stock` cũ.
3. **Verify:** kiểm tra không còn Product thiếu Store/Category/Variant và không có giá/tồn kho âm.
4. **Contract:** đặt các cột bắt buộc thành NOT NULL, thêm index/FK/unique, sau đó loại cột prototype `sellerId`, `price`, `stock`, `status` khỏi Product.

Nếu dữ liệu local không thỏa điều kiện backfill, migration phải dừng với lỗi rõ ràng; không âm thầm xóa Product. Migration cần được thử trên database trống và database có Product prototype.

## 5. API và phân quyền triển khai theo đợt

### Đợt A: Store và catalog đọc

- Seller tạo/xem/sửa Store của chính mình.
- Admin CRUD Category/Brand; public/Seller đọc cây Category hoạt động.
- Guard dùng JWT; không nhận `sellerId` từ client để xác định ownership.

### Đợt B: Product draft

- Seller tạo/sửa Product DRAFT.
- Đọc cấu hình thuộc tính theo Category.
- Quản lý ProductAttributeValue, option group/value và Variant.
- Validation transaction cho tổ hợp Variant, sellerSku, giá và tồn kho.

### Đợt C: ảnh, kiện hàng và kiểm duyệt

- Upload nhiều ảnh, chọn ảnh chính và gắn ảnh với ProductOptionValue.
- Cập nhật ProductShippingProfile.
- Seller submit; Admin approve/reject/freeze; Seller hide/show theo trạng thái hợp lệ.
- Ghi người duyệt, thời gian và lý do; không cho client gán enum tùy ý.

### Đợt D: Search Service

- Ghi outbox trong transaction khi Product công khai thay đổi.
- Worker gửi request idempotent theo productId/version tới SEARCH_SERVICE.
- FastAPI quản lý Elasticsearch, CLIP/FAISS và RRF.
- NestJS gọi `POST /search/hybrid`, hydrate bằng PostgreSQL, loại Product không còn công khai và giữ thứ tự còn lại.

Swagger DTO/response và test phải được cập nhật trong từng đợt. API chi tiết chỉ được khóa khi schema của đợt tương ứng đã review.

## 6. Import dataset

Input là `products.jsonl` cùng thư mục ảnh, dùng schema version 1 đã ghi trong `product-domain-design.md`. Importer thực hiện:

1. Validate schema, source và externalId namespace.
2. Chặn absolute path, traversal, symlink thoát gốc và ảnh không hợp lệ.
3. Upsert theo externalId; không dùng externalId làm khóa nghiệp vụ nội bộ.
4. Ánh xạ Category chắc chắn; trường chưa chắc để null/DRAFT, không suy đoán.
5. Ingest ảnh rồi tạo URL do Backend quản lý.
6. Tạo dữ liệu demo được đánh dấu rõ nếu nguồn thiếu giá/tồn kho/SKU.
7. Xuất mapping JSONL `externalId → productId` cho pipeline AI.

ABO Electronics 1.200 sản phẩm là corpus hiện tại, không phải giới hạn ngành hàng của schema.

## 7. Chia pull request code

| Thứ tự | Branch/PR dự kiến | Phạm vi |
|---:|---|---|
| 1 | `feat/hoang/product-schema` | Prisma schema, expand/backfill/contract migration, seed nhỏ, test migration |
| 2 | `feat/hoang/store-category-api` | Store, Category, Brand, ownership/RBAC, Swagger và test |
| 3 | `feat/hoang/seller-product-api` | Product draft, attributes, options, variants, images, shipping và moderation |
| 4 | `feat/hoang/product-search-sync` | Outbox worker, Search Service client, retry/idempotency và integration test |
| 5 | `feat/hoang/seller-product-ui` | Giao diện Store và quản lý/tạo/sửa/gửi duyệt Product |

Mỗi PR tạo từ `develop` mới nhất sau khi dependency trước đã merge. Không xếp chồng feature branch hoặc tự merge.

## 8. Kế hoạch kiểm thử

- Prisma format/validate/generate và migration status.
- Fresh database: migrate + seed thành công.
- Database từ schema prototype: backfill không mất Product và tạo Variant mặc định đúng giá/tồn kho.
- Unit test validation/ownership/state transition.
- Integration test transaction tạo Product/Variant và outbox.
- E2E test Seller không sửa Store/Product khác; Admin mới duyệt được; Product chưa đủ điều kiện không công khai.
- E2E test request lặp không tạo outbox trùng; Search Service lỗi không rollback dữ liệu PostgreSQL.
- Frontend lint/build và các trạng thái loading/error/validation khi đến PR giao diện.
- Rà secret, file lớn, dataset, ảnh runtime và generated artifact trước commit.

## 9. Điểm reviewer cần xác nhận trước khi code

### Hiền review nghiệp vụ/database

- Một Seller–một Store và quyền Admin/Seller.
- Tách thuộc tính mô tả khỏi option tạo Variant.
- Trạng thái Product, điều kiện submit/public và thông tin kiện hàng.
- Ràng buộc Variant, sellerSku và ảnh theo option.
- Kịch bản backfill Product prototype và acceptance test.

### Đạt review import/Search

- Schema JSONL version 1, externalId namespace và mapping productId.
- image sourcePath trước ingest và imageUrls sau ingest.
- Product.version, outbox SEARCH_SERVICE và idempotency/retry.
- Payload Product cấp index; giá/tồn kho PostgreSQL vẫn là dữ liệu hiện hành.
- Ranh giới NestJS hydrate/filter và FastAPI Elasticsearch + CLIP/FAISS + RRF.

Chỉ bắt đầu migration sau khi hai reviewer xác nhận các phần giao thuộc trách nhiệm của họ. Nếu reviewer yêu cầu đổi contract Backend–Search Service, phải cập nhật `docs/api/ai-service-contract.md` và được Hoàng–Đạt cùng review.
