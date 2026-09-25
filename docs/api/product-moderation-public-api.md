# Product moderation và truy vấn công khai

Ngày: 25/09/2026. Trạng thái: **IN_PROGRESS trên nhánh `codex/product-moderation-public`**; cần review/merge trước khi gọi là CURRENT. Phụ thuộc PR #18 đã merge (`cbc3e40`).

Cơ sở nghiệp vụ: SRS v3.1 `FR-PRD-02`, `FR-PRD-03`, `AC-PRD-02/03` và `product-domain-design.md` mục 5. Đợt này triển khai API cho Hiền xây Admin và Hoàng xây Web; chưa hoàn thành release gate đăng bán–Search–Web.

## Endpoint

| Method/path | Actor | Input và kết quả |
|---|---|---|
| `GET /admin/products/review-queue` | ADMIN | `limit=20` (1–50), `afterId?`; hàng PENDING theo ID tăng dần, `{items,nextCursor}` |
| `GET /admin/products/:id` | ADMIN | Nội dung hiện tại, version, Store, thuộc tính/SKU/ảnh và statusHistory |
| `POST /admin/products/:id/approve` | ADMIN | `{version}`; chỉ PENDING → APPROVED |
| `POST /admin/products/:id/reject` | ADMIN | `{version,reason}`; chỉ PENDING → REJECTED |
| `POST /admin/products/:id/freeze` | ADMIN | `{version,reason}`; chỉ APPROVED → FROZEN, kể cả Seller đang ẩn |
| `PATCH /seller/products/:id/visibility` | SELLER sở hữu Store | `{version,sellerStatus:"ACTIVE" hoặc "HIDDEN"}`; chỉ Product APPROVED, hiện trạng không phải DRAFT |
| `GET /products` | Guest | `limit`, `afterId`, `categoryId?` (đúng category), `storeId?`; `{items,nextCursor}` |
| `GET /products/:id` | Guest | Chi tiết theo cùng predicate với list; không đủ điều kiện trả 404 |

`version` là số nguyên >=1 lấy từ màn hình chi tiết đang xem. Không tự lấy version mới rồi duyệt thay nội dung người dùng chưa xem. `reason` sau trim dài 1–1000 ký tự. Body thừa/sai kiểu bị ValidationPipe từ chối. Quyền JWT vẫn theo Role đơn hiện hành; multi-role được triển khai bằng PR riêng.

## Quyết định và request lặp

Admin kiểm tra version và trạng thái, revalidate dữ liệu khi approve, cập nhật Product và ghi ProductStatusHistory trong **một Serializable transaction**. Mỗi quyết định tăng version một lần. Unique `(productId,version)` ngăn lịch sử trùng. Hai request cạnh tranh: một thành công, request còn lại nhận 409. Retry sau response thất lạc dùng version cũ nhận 409; client tải lại để đối chiếu kết quả, không ghi thêm quyết định. Không chuyển NOT_SUBMITTED thành APPROVED trực tiếp.

Visibility gửi cùng trạng thái với version hiện hành trả kết quả hiện tại, không tăng version/ghi history. Request với version cũ nhận 409. Seller được ẩn listing khi Store bị suspended nếu tài khoản còn hoạt động; bật lại phải qua kiểm tra đủ điều kiện. Seller không được tự mở FROZEN. Đợt này chưa có command Admin gỡ FROZEN; không dùng approve để vượt vòng đời này.

`ProductStatusHistory` lưu actor, version sau thay đổi, cặp trạng thái trước/sau, reason và thời gian. Đợt này ghi **quyết định Admin và visibility**; chưa backfill lịch sử trước migration hoặc ghi mọi field edit thành audit. Các metadata submittedAt/reviewedAt/reviewedBy hiện có vẫn giữ nguyên ý nghĩa.

## Điều kiện công khai dùng chung

`product-public-policy.ts` được gọi bởi approve, show, public list và detail:

- sellerStatus ACTIVE và moderationStatus APPROVED khi đọc public;
- Store ACTIVE và tài khoản chủ Store isActive;
- category lá đang hoạt động, mọi tổ tiên đang hoạt động và không chu trình;
- brand null hợp lệ; brand đã có phải hoạt động;
- tên hợp lệ, có ảnh chính và khối lượng >0;
- required attributes trực tiếp của category lá có giá trị đúng kiểu; option lựa chọn phải hoạt động, giá trị false/0 hợp lệ;
- ít nhất một variant active, giá >0, tổ hợp đầy đủ theo option groups của Product.

Stock=0 vẫn public, response có `inStock:false`. Mua được phải kiểm tra lại đúng variant và số lượng tại checkout (chưa có trong đợt này). Chưa có filter giá/stock/Search mới trong API này.

Public response dùng allowlist: id, tên/mô tả, Store id/name, category, brand, ảnh, thuộc tính, option groups, các variant hợp lệ, minPrice/maxPrice và inStock. Giá là chuỗi Decimal; không trả externalId, thông tin tài khoản, sellerSku, SKU nội bộ, reviewer, reason hay history. Header `Cache-Control: no-store` tránh response listing đã ẩn được cache thông thường.

List/detail đọc trong RepeatableRead transaction để metadata/eligibility/response cùng snapshot. Public list kiểm tra tối đa 200 candidate/request để giới hạn công việc DB; nếu còn candidate cần đọc, trả nextCursor tăng dần. Trang có thể ít hơn limit hoặc rỗng nhưng còn nextCursor khi candidate thiếu required/không hợp lệ; FE tiếp tục theo cursor, không suy ra kết thúc chỉ từ items rỗng. Không trả total chưa tính đầy đủ. Khi dữ liệu lớn, cần chuyển kiểm tra đủ điều kiện sang projection/truy vấn tối ưu có invalidation và đo hiệu năng.

## Ranh giới và công việc tiếp

- Schema có SearchOutbox nhưng API đợt này chưa phát event/worker. PostgreSQL đã loại listing không hợp lệ ngay ở các public endpoint; index cần nối ở PR tiếp theo.
- Khi thay required/category/Store, đọc public kiểm tra lại ngay; notification và outbox invalidation cho toàn bộ sản phẩm bị ảnh hưởng chưa triển khai.
- Ảnh draft/private và signed URL theo SRS MED-01 là công việc còn thiếu của storage hiện tại; không coi public JSON filter là đã bảo vệ URL `/uploads` có sẵn. Không sử dụng ảnh nhạy cảm trong demo hiện tại.
- Khóa image publish/compensation trong cùng process được tái sử dụng cho moderation/visibility; triển khai nhiều Backend instance cần shared storage lock. Version/Serializable vẫn bảo vệ quyết định DB giữa các instance.
- UI Admin/Seller/Public và E2E trình duyệt được thực hiện sau review API này. Không gọi endpoint lẻ là luồng Web hoàn chỉnh.

## Xác minh

`BE/test/product-lifecycle.e2e-spec.ts`: RBAC, input, DRAFT/PENDING, hết hàng, audit, race/replay cả giữa service instances, rollback, reject–sửa–submit, hide/show/freeze, sửa sau duyệt, khóa Store/account/category, required false/0, dữ liệu listing thiếu, ownership và phân trang.

Chạy migration mới bằng `pnpm --dir BE exec prisma migrate deploy`, sau đó `pnpm --dir BE test:e2e product-lifecycle`. Test tạo dữ liệu riêng và dọn theo Store/marker của bộ test, không sửa dataset ABO.

Kết quả local 25/09/2026: frozen install, Prisma validate/migrate deploy, Backend lint/build và diff whitespace đạt; unit 11/11, toàn bộ Backend E2E 45/45, bộ Product lifecycle 19/19 (chạy lại sau bổ sung validation ID). PostgreSQL 17 Docker healthy. Đây là bằng chứng API/DB, chưa phải kiểm thử giao diện hay Search tích hợp.
