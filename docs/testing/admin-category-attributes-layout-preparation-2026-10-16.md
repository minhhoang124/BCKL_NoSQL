# Chuẩn bị giao diện Admin thuộc tính ngành hàng

Khởi tạo: 16/10/2026; cập nhật: **19/10/2026**. Trạng thái: **PREPARATION / PR Draft để review**, chưa nghiệm thu runtime.
Nhánh: `feat/hien/admin-category-attributes`; đã đồng bộ fast-forward từ nền cũ
`035656b` qua `aa62c84`, rồi `develop 622cfb92fcea29f763f38e515578a271123565f4`.
Giữ nguyên bản đang làm, không tạo lại từ đầu. Hiền đã cho phép bàn giao
source/test/docs qua PR riêng ngày 19/10, không bàn giao tài khoản/cấu hình QA.

Contract #65 đã merge tại `9956379b16f8b64bcffc37a8ef8fd995ac3ccc44` ngày 18/10;
reason/audit đã chốt ở lớp thiết kế. Những mô tả “chờ chốt” trong phần lịch sử
16/10 dưới đây không phải trạng thái hiện tại. Backend Admin read/options,
revision/usage/audit/normalized uniqueness đầy đủ vẫn chưa bàn giao trong nền này.
Xem [kết quả rà và kiểm tra ngày 19/10](admin-category-attributes-local-review-2026-10-19.md).

## Mục đích và nguồn đối chiếu — lịch sử khởi tạo 16/10

Chuẩn bị phần Admin của Hiền trong lúc chờ quy ước API của Hoàng được chốt.
Đây là thuộc tính **mô tả theo Category**, không phải ProductOptionGroup/Value tạo SKU.

- `docs/project/work-assignment.md`: Hiền trực tiếp làm Admin, Hoàng giữ Backend/tích hợp.
- `docs/project/implementation-scope.md`: quản lý thuộc tính thuộc P0; UI mẫu không đủ DONE.
- `docs/analysis/hien/srs-v3.md`: FR-CAT-01, FR-PRD-01 và FR-ADM-01; không kế thừa ngầm, không xóa dữ liệu đang dùng; hành động nhạy cảm có xác nhận/lý do/audit.
- `docs/architecture/product-domain-design.md`: mô hình definition/option/value khác variant.
- Contract **đề xuất** PR #65 tại `fc7c35bb201331e9d71cc27249121ea1f76b3637` và review của Hiền: khóa sửa identity đã dùng, revision dùng chung, không tự retry ghi, giữ lịch sử. Không đưa tài liệu/code Backend chưa merge vào nhánh này.
- Review #65 yêu cầu bổ sung reason/validation/audit cho thay đổi nhạy cảm. Trường lý do trong preview không phải DTO đã chốt, không chứng minh audit tồn tại.

## Đã chuẩn bị local

- Danh sách và lọc tên/slug, bật/tắt, TEXT/NUMBER/BOOLEAN/SINGLE_SELECT; có cả inactive, chỉ lọc các mẫu được truyền vào.
- Form tạo/sửa definition, required/filterable/custom/order/active; option editor riêng chỉ SELECT.
- Usage có ba trường hợp: 0 mẫu, số dương mẫu, null chưa biết. Không biến unknown thành 0.
- Khóa type/slug definition khi đã dùng hoặc chưa biết usage; có option cũng khóa type theo hướng thận trọng. Khóa value/slug option đã dùng hoặc chưa biết usage. Backend sau này vẫn phải quyết định trong transaction.
- Không có xóa cứng. Danh sách không đổi theo form chưa lưu; inactive không mất lịch sử.
- Bản nháp definition/option giữ trong bộ nhớ khi chuyển lựa chọn/thuộc tính hoặc minh họa tải/lỗi. Reload/đóng trang sẽ mất; không dùng localStorage/sessionStorage.
- Kiểm sơ bộ name/slug/order theo proposal; chặn minh họa bật required SELECT không custom khi thiếu option active. Không coi là validation/audit/concurrency Backend.
- Hộp xác nhận có lý do và tác động hai chiều: siết rule có thể mất public; nới rule chỉ giúp APPROVED/ACTIVE công khai lại nếu mọi canonical predicate còn hợp lệ. Không tự đổi moderation/sellerStatus, kho hoặc Order snapshot.
- Hủy/Escape, giữ focus trong hộp, trả focus về nút mở; nền component inert. Không gửi request khi submit form.
- Chế độ chưa nối API mặc định, mẫu rỗng, loading/error/stale/unknown có nhãn minh họa. Stale giữ draft và khóa thao tác; unknown không có nút GET-based unlock. Đây không phải recovery runtime.
- Nút lưu/xác nhận thật **luôn disabled**, kể cả có lý do; không có callback ghi, API adapter, fetch hoặc storage. Không hiện thông báo lưu thành công giả.

## Phạm vi file và cách mở

```text
FE/src/features/admin-category-attributes/
  AdminCategoryAttributesLayout.tsx
  AdminCategoryAttributesLayout.module.css
  AdminCategoryAttributesLayout.test.tsx
FE/src/dev/adminCategoryAttributesPreview.tsx
FE/admin-category-attributes-preview.html
```

CSS riêng module, dùng màu chữ/nền light tường minh, responsive. Không sửa AppRouter,
menu, AuthProvider, apiClient, CSS global, Address/Cart, BE/schema/migration hoặc Search.
Mẫu dùng sampleKey chuỗi tổng hợp, không có ID/tài khoản/sản phẩm thật, không phải DTO.

Từ root checkout:

```powershell
pnpm --dir FE exec vite --host 127.0.0.1 --port 5186 --strictPort
```

Mở `http://127.0.0.1:5186/admin-category-attributes-preview.html`.
Port chỉ phục vụ local, không phải URL bàn giao môi trường cho thành viên khác.
Entry có `import.meta.env.DEV`; không có route/import trong ứng dụng production.
Build Vite mặc định chỉ có index.html và bundle ứng dụng, không kèm preview/mẫu.

## Kiểm chứng lịch sử đúng bản working tree ngày 16/10

| Kiểm tra | Kết quả |
|---|---|
| Vitest toàn FE, `pnpm --dir FE exec vitest run --maxWorkers=1` | **365 PASS, 6 SKIPPED**; 26 suite PASS, 1 suite live SKIPPED |
| Ca mới cho layout | **19 PASS**; gồm không API/storage, draft, usage/type/option, modal/focus/Escape và state lỗi |
| `pnpm --dir FE lint` | PASS, không warning |
| `pnpm --dir FE build` | PASS, TypeScript + Vite |
| Rà output production | Không có chuỗi/module preview thuộc tính; chỉ index.html và bundle chính |
| Browser IAB desktop 1440×1000 và mobile 390×844 | Bố cục và hộp xác nhận đọc được; không tràn ngang (scrollWidth 1425/375, innerWidth 1440/390) |
| Browser dark preference thực tế | `prefers-color-scheme: dark = true`; module vẫn chữ đậm trên nền sáng, heading rgb(32,36,43). Không đổi theme toàn hệ thống |
| Browser thao tác | Nhập lý do vẫn khóa xác nhận; Hủy/Escape đóng hộp; unknown khóa fieldset; lỗi ẩn dữ liệu mẫu; về ready vẫn giữ bản nháp option |

Ảnh trình duyệt được quan sát trong phiên làm việc, chưa lưu thành bộ artifact ảnh
bàn giao. Chưa chạy riêng với browser light preference. Đây không phải ảnh/QA từ
Admin #28 hoặc baseline cũ. Lượt Vitest đầu bị sandbox EPERM tại cache rename,
chưa chạy test; lượt chạy lại ngoài sandbox và hồi quy cuối cùng đạt như bảng.
6 ca live bị skip không được tính PASS. Không chạy BE E2E/DB vì không sửa/nối Backend.

## Phần còn thiếu — NOT_RUN / chờ dependency

1. **Đã có:** contract #65 merge ngày 18/10, gồm reason/audit và Search. Chưa có implementation tương ứng; error envelope/quota chi tiết phải đối chiếu PR Backend bàn giao trước code adapter.
2. Migration và Backend Admin read/write/options, revision/usage/audit/job nguyên tử được review, test và merge.
3. Hiền nối DTO adapter qua apiClient hiện hành, phân trang và snapshot revision; không dùng public GET active-only thay Admin read.
4. Nối route/menu qua phần file dùng chung được xác nhận. Component preview không có Auth/guard, không được deploy như trang Admin thật.
5. Kiểm API/PostgreSQL thật, guest/Buyer/Seller/khóa Admin, hai Admin stale revision, timeout/unknown/phiên đổi và rollback/audit. Tất cả **NOT_RUN** trong đợt layout.
6. Kiểm tác động public/Search trên bản tích hợp: predicate canonical, job accepted khác synced, giữ lịch sử/false/0 và không hồi sinh listing không hợp lệ. **NOT_RUN**.
7. Browser light preference, ảnh desktop/mobile lưu thành artifact, CI và review Hoàng sau khi có yêu cầu đưa lên GitHub.

Không nâng Admin hoặc giai đoạn 3 lên DONE từ kết quả chuẩn bị này.
