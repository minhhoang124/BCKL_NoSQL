# Seller nhập thuộc tính — kiểm cấu hình trong giao dịch ghi

Ngày21/10/2026. Branch `codex/seller-attribute-coherence`, từ develop `bf6f926`
sau #77/#81 đã merge; tái sử dụng checkout trước của #77, không sửa PR đã merge.
Đây là sửa runtime có phạm vi nhỏ để mở đường Admin Attributes #65, không nhận
toàn bộ Backend ghi Attributes đã triển khai.

## Nguyên nhân và luồng sửa

`ProductService.upsertAttributeValue` trước đây đọc definition và option qua
Prisma ngoài transaction. Giá trị `data` đã normalize được mang vào callback
ghi và tái dùng ở mọi lần retry. Admin có thể commit đổi kiểu/tắt option trước
khi transaction Seller bắt đầu, nhưng Seller vẫn ghi theo cấu hình cũ.

Luồng mới:

1. Giữ preflight Store/ownership/Product và version CAS hiện có.
2. Trong mỗi callback Serializable: đọc definition còn active, đúng Category;
   kiểm kiểu và đọc option còn active bằng chính `tx` của lần thử đó.
3. Upsert ProductAttributeValue, tăng version/reset duyệt và DELETE SearchOutbox
   nếu đang APPROVED trong cùng transaction như trước.
4. Serialization/deadlock được phân loại vẫn retry tối đa5lượt; callback mới
   phải đọc/normalize lại, không tái dùng `data` của lần trước.

Không thêm khóa RAM, thứ tự row-lock mới, migration, API hoặc mã lỗi mới.
Không sửa shape contract AI/Search hoặc snapshot Order/Payment/giá/kho.

### Tên biến để đọc code

- `definition`: quy tắc của một thuộc tính Category: kiểu dữ liệu, active và
  quyền nhập tự do. Không phải ProductOptionGroup tạo SKU.
- `option`: lựa chọn chuẩn thuộc definition, phải đang active khi được chọn.
- `tx`: client thuộc giao dịch PostgreSQL đang ghi, khác client `this.prisma`
  ngoài giao dịch. Các lần retry có giao dịch/snapshot riêng.
- `data`: một giá trị đã kiểm đúng kiểu; `false` và số`0` không phải thiếu dữ liệu.
- CAS version: chỉ cập nhật Product nếu version còn đúng; không tự ghi đè một
  Product đã đổi Category/moderation ở phiên bản khác.

## Tái lập và kiểm thực

File mới `BE/test/seller-attribute-coherence.e2e-spec.ts` chạy ProductService,
Prisma và PostgreSQL thật. Dùng barrier tại entry transaction để commit cấu hình
trước BEGIN; không mock definition/option/value query. Test retry tiêm P2034
sau work trong transaction đầu nên DB thực rollback, rồi đổi cấu hình trước
lần thử hai. Đây **không phải** proof hai process va chạm SSI thật hoặc lock
protocol đầy đủ của Admin/Seller writers tương lai.

Trước sửa production: **3 FAIL/3 PASS**, ba lỗi resolved thay vì reject và ghi
text/option cũ thật vào DB. Sau sửa: **6/6 PASS**:

1. TEXT→NUMBER commit trước BEGIN: từ chối text, không value/version/outbox mới.
2. Option bị tắt trước BEGIN: từ chối lựa chọn cũ, không mutation Product.
3. Retry sau rollback phải đọc kiểu mới, không dùng data normalize cũ.
4. BOOLEAN false hợp lệ; APPROVED→DRAFT/NOT_SUBMITTED,version2,đúng1DELETE.
5. NUMBER0 hợp lệ; cùng invariant transaction/lifecycle/outbox.
6. Lỗi outbox rollback toàn value/version/reset duyệt.

QA mới `bckl_order_resolution_test_attributes_20261019_v2186`, PostgreSQL17
chỉ loopback5549;15fresh migrations PASS. Không DBdemo5432, DB reviewer hoặc
container seminar; cleanup chỉ ID fixture. Product APPROVED là fixture có nhãn,
không phải bằng chứng Admin UI duyệt hoặc public listing có ảnh được phục vụ.

- Backend lint0warning/error, typecheck/Prisma generate/Nestbuild: PASS.
- Full unit709PASS/32files,5.60s.
- Full Backend E2E639PASS/20TODO,34filesPASS/1SKIP,165.98s,exit0.
  Sáu ca mới nằm trong tổng; không cộng lặp, không tính TODO/SKIP là PASS.
- Prisma validate và migrate-diff DB/schema: PASS, không khác schema.
- Diff-check PASS. Injected-failure/deprecation logs không assertion failures.
- FE/browser và live FastAPI/Elasticsearch/FAISS: NOT_RUN trong scope sửa này.

## Khoảng trống cố ý không nhận đã sửa

- Admin definition/option writers còn phải có normalized uniqueness, revision/
  reason/usage gates, audit + durable job atomic và parent-before-child locking.
- Admin sửa trong lúc transaction Seller đang chạy vẫn cần shared protocol/
  fencing và nhiều-connection tests riêng; Serializable của Seller đơn lẻ không
  bảo đảm mọi writer khác tham gia giao thức.
- Submit, Product đổi Category và actor/Store freshness phải được audit/ghép
  cùng protocol ở PR tiếp theo; không suy từ sáu ca này là đã xong mọi race.
- Chưa bật editor ghi của Hiền, chưa thay POST/PATCH Admin cũ bằng contract #65.

Nguồn chuẩn: [Attributes contract](../api/admin-category-attributes-contract.md)
mục5, [readiness](../architecture/admin-category-attributes-readiness.md) bước2/5,
[Product domain](../architecture/product-domain-design.md). Cần review/CI đúng
head trước merge; không tự merge hoặc cập nhật SRS ngược để nhận phần còn thiếu
là đã hoàn thành.
