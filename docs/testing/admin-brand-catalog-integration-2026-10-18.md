# Brand editor trong Admin Catalog — 18/10/2026

Trạng thái: **IN_PROGRESS**, PR integration riêng; không phải nghiệm thu toàn bộ
Admin hoặc giai đoạn 3. Chỉ dùng kết quả chạy trên nguồn tích hợp mới bên dưới.

## Nguồn và phạm vi

- PR #64 đã merge thực tế ngày18/10/2026 tại `bdd3fce`, head được bàn giao
  `3521df2`. Nhánh `feat/hien/admin-brand-catalog-integration` tạo mới từ
  `develop aa62c846a9be18753435d3f4b2066bf5d3d3caaa` sau merge.
- Căn cứ: phân công Hiền giai đoạn3, SRS FR-ADM-01, thiết kế Product,
  `AdminCatalogController`/`UpdateBrandDto`/`CatalogService` đã merge và
  [module Brand #64](admin-brand-editor-and-attributes-readiness-2026-10-16.md).
- Nối editor name/slug vào tab **Thương hiệu** tại `/admin/catalog`, dưới
  AuthProvider/guard Admin hiện hành. Không thêm route hay đăng nhập giả.
- Giữ nguyên tạo Brand, PATCH isActive bật/tắt Brand, tạo/sửa/bật–tắt Category
  và các route Admin/Address/Cart/Checkout/Order. Không đổi Backend, schema,
  migration, API, AuthProvider/apiClient, CSS toàn ứng dụng hoặc bật Seller command.

## Cách sử dụng và điểm tích hợp

1. Admin active đăng nhập → Danh mục & thương hiệu → Thương hiệu →
   **Sửa tên/slug thương hiệu**. Editor chỉ tải khi được mở lần đầu.
2. Chọn Brand gồm cả bản ghi đã tắt → sửa → xem lại → xác nhận lưu.
   Adapter chỉ gửi trường name/slug thực sự đổi, không gửi isActive.
3. Editor giữ instance/bản nháp khi đổi tab Category/Brand. Trong lúc xác nhận,
   đang PATCH hoặc kết quả chưa rõ, khóa tạo/bật–tắt và đổi tab/Làm mới ở Catalog;
   các handler cũng kiểm lock, không chỉ disabled giao diện.
4. Legacy create/toggle đang chạy khóa editor. Thành công tải lại dữ liệu editor;
   editor lưu thành công tải lại danh sách Catalog ngoài. Không cập nhật lạc quan.
5. HTTP409 giữ draft. Mất response/timeout/5xx/phản hồi không hợp lệ giữ unknown
   lock; GET thành công không mở khóa ghi hay tự gửi lại PATCH.
6. Chỉ thêm CSS embedded trong module Brand; không lồng heading h1 thứ hai
   hoặc chiều cao toàn màn hình trong nội dung Catalog.

## Kiểm thử bản mới

| Kiểm tra mới ngày18/10 | Kết quả / giới hạn |
| --- | --- |
| Full FE: `pnpm --dir FE exec vitest run --pool=threads --maxWorkers=1` | **441 PASS / 6 live SKIP**,31files PASS/1suite SKIP;382.46s. Không đổi timeout hoặc bỏ ca đang lỗi |
|9ca integration mới | PASS trong full run; Catalog + editor + adapter thật, HTTP mock |
| FE lint | PASS/exit0;5warning `set-state-in-effect` có sẵn ở Admin, không tắt rule |
| FE build | PASS TypeScript/Vite,80modules; build mặc định chứa editor do đã nối Catalog |
| Backend build | PASS Prisma generate + Nest; không thay Backend source/schema |
| Diff/giữ phạm vi | `git diff --check` PASS; BE/AI/lockfile/Auth/client/router/Checkout/Order không đổi so nền |
| Browser đăng nhập + đọc Catalog | PASS chọn lọc: AuthProvider/LoginPage/shared client thật, Backend3012/PostgreSQL QA riêng |
| Browser tạo Category | POST201; danh sách hiển thị Category11 “QA Catalog Integration 18-10”; DB khớp tên/slug/parentId=null/isActive=true |
| Browser Category bật/tắt | PASS chọn lọc: lượt đầu Category11 OFF khớp DB; lượt bổ sung trên`560f7af` bật lại một lần, UI/DB true. Mỗi chiều đúng một PATCH200 |
| Browser Brand tạo/sửa name/slug/409/unknown | PASS chọn lọc qua FE→Nest→PostgreSQL trên source`37b4182`; chi tiết lượt tiếp tục bên dưới |
| Desktop/mobile |1280×900 và390×844, dark preference=true; ảnh và kích thước DOM thật, không tràn ngang ở các trạng thái đã kiểm. Mobile viewport giả lập, không thiết bị cảm ứng thật |
| Browser Brand bật/tắt | PASS chọn lọc trên`560f7af`: fixture12 true→false→true, Catalog và editor cùng cập nhật; hai PATCH200, DB/job đối chiếu riêng |

Lượt test mới ban đầu lỗi setup router của bài test (mở nhầm Overview); đã sửa
test route cho giống `/admin/*` thật. Lượt kế tiếp8/9PASS, một assertion kiểm
unlock409 trước khi effect cập nhật; sửa thành đợi trạng thái đã ổn định.
Full run cuối441PASS/6SKIP ở trên mới là kết quả bàn giao. Không sửa production
để bỏ validation hoặc nới timeout cho test qua.

Các ca tự động mới ở `FE/src/pages/AdminBrandCatalog.integration.test.tsx`
chạy Catalog thật + editor + adapter Brand, chỉ mock HTTP: giữ controls cũ,
name-only payload/consent, refresh danh sách, lock hai chiều, hủy xác nhận,
giữ draft qua tab,409, unknown+GET và create/toggle refresh. Đây không phải
kiểm thử trình duyệt/Backend/PostgreSQL.

QA local dùng database PostgreSQL riêng loopback5550; chỉ áp dụng migration
đã merge bằng deploy, không seed/reset. Backend3012 và FE/gateway5188 chỉ
listen loopback, Search/reconciliation/image-repair/auto-complete workers OFF.
Credentials/cấu hình/snapshot/log/ảnh gốc giữ ngoài repository; trace chỉ có
method/path/status, không headers, body hoặc tài khoản.

Snapshot trước/sau lượt browser ban đầu trên base`aa62c84` + source integration có
SHA-256 tracked FE diff`ee7d6320f01d812d9f86074b4b8a888695f539a0dea8caac8d82a1180b403f8d`:
14migration đã áp dụng, Category9→10 đúng một fixture mới, Brand7 và jobs29
không đổi ở thời điểm hộp xác nhận chưa xử lý. Hash toàn bảng products60/stores10/orders0/stock_movements0/
search_outbox24 giữ nguyên. Không xóa fixture hoặc reset database. Hash diff
định danh code runtime mới, không phải kết quả QA của head #64 cũ; artifact
manifest riêng ghi SHA từng file source để đối chiếu sau commit.

### Tiếp tục browser/DB sau hộp xác nhận — source`37b4182`

Đối chiếu SHA-256 cả4file FE (Catalog/component/CSS/test) với manifest trước
commit: khớp hoàn toàn; working tree FE sạch. Không lấy QA module#64 cũ thay
bản integration. Auth cookie được phục hồi qua AuthProvider thật khi mở lại
`/admin/catalog`; không inject actor/token hoặc bỏ guard.

| Ca thực chạy | UI / HTTP / DB |
| --- | --- |
| Category11 tắt | Chỉ một PATCH200 sau xác nhận của Hiền; UI/DB false; jobs29→30 |
| Tạo Brand fixture12 qua form Catalog cũ | POST201; Brand7→8, name`QA Brand Integration 18-10`, slug`qa-brand-integration-1810-1900`, isActive=true; không gắn Product |
| Xem lại / quay lại sửa / đổi Category↔Brand tab | Chưa PATCH trước xác nhận; draft tên/slug giữ nguyên qua tab; trong xác nhận các nút create/toggle/tab/Làm mới disabled |
| Slug trùng | PATCH409; UI giữ draft tên/slug, không báo đã lưu; DB/Brand/jobs không đổi, controls được mở lại |
| Sửa riêng name trên desktop | PATCH200; DB chỉ đổi name thành`QA Brand Integration Renamed 18-10`, slug/isActive giữ nguyên; cả danh sách Catalog và editor cập nhật; jobs30→31 |
| Sửa riêng slug trên mobile | PATCH200; slug thêm`-updated`, name/isActive giữ nguyên; jobs vẫn31, không bịa job Search |
| Mất response sau server commit | Gateway local cắt đúng một PATCH200 của fixture12. DB tên thành`QA Brand Integration Lost Response 18-10`, jobs31→32. UI giữ draft và unknown lock; không nhận lỗi mạng là rollback |
| GET sau unknown | GET thấy tên đã commit nhưng nút review/create/toggle/tab vẫn khóa. Trace Brand12 đúng4PATCH:409/200/200/200; sau lần response bị cắt chỉ có GET, không auto replay |
| Giao diện | Desktop1280×900 scrollWidth1280; mobile390×844 scrollWidth≤390. Dark preference=true nhưng CSS module giữ nền/chữ đọc được. Đã kiểm ảnh saved/409/review/unknown; chưa full WCAG/cross-browser hoặc light preference |

Verifier DB/trace read-only của lượt này PASS; không tự coi verifier là bằng
chứng hình ảnh. Brand/Category cũ giữ nguyên; Product60/Store10/Order0/
stock movements0/outbox24 giữ hash baseline. Jobs29→32 đúng Category OFF +
hai Brand rename; slug-only/create không thêm job. Giữ Category11 đã tắt và
Brand12 sau fault injection cho đối chiếu, không xóa/reset hoặc tự replay.

Ảnh gốc/snapshot/trace và source-commit proof giữ local, không commit. Tab unknown
được giữ khi bàn giao lượt trên; không dùng đóng/reload tab làm bằng chứng mở khóa an toàn.

### Bù hai ca toggle — source`560f7af`

Head`560f7af` chỉ đổi tài liệu so với code`37b4182`; SHA cả4file FE khớp manifest,
working tree FE sạch và PR#71 OPEN/Draft đúng head trước chạy. Baseline riêng
của lượt này có Brand12=true, Category11=false,8Brand/10Category và32job.
Đã đối chiếu DB và trace200 của fault injection
trước đó trước khi bắt đầu command toggle mới; không coi GET/reload là receipt.
Admin được phục hồi bằng AuthProvider thật, không inject token/role hoặc giả
`window.confirm` trong browser.

| Ca bổ sung | UI / HTTP / PostgreSQL |
| --- | --- |
| Brand12 OFF | Sau xác nhận, một PATCH `/admin/brands/12`200; Catalog ghi “Đã tắt”, editor tự reload cũng ghi “Đã tắt”; DB isActive=false, name/slug giữ nguyên, jobs32→33 |
| Brand12 ON | Sau xác nhận, một PATCH cùng path200; Catalog và editor cùng “Đang bật”; DB isActive=true, name/slug giữ nguyên, jobs33→34 |
| Category11 ON | Sau xác nhận, một PATCH `/admin/categories/11`200; hàng danh mục “Đang bật”, form đúng #11 hiện nút “Tắt danh mục”; DB isActive=true, name/slug/parentId giữ nguyên, jobs34→35 |
| Không gửi trùng | Cả3lần click native confirm có báo timeout từ công cụ; không click lại. Kiểm state UI/trace/DB sau mỗi lần rồi mới chuyển bước; trace chỉ có đúng3PATCH200 mới |
| Dữ liệu khác | Brand/Category count giữ8/10, các bản ghi ngoài fixture12/11 không đổi. Product60/Store10/Order0/stock movements0/outbox24 giữ hash của baseline; không tạo/xóa/reset fixture |

Verifier đọc snapshot/trace và hash source PASS. So jobs theo ID (không dựa
vị trí trong array vì snapshot project ID dạng text): chỉ3job mới PENDING
BRAND12/BRAND12/CATEGORY11, job cũ nguyên trạng. UI được kiểm bằng AX/ảnh
riêng; script DB không tự thay bằng chứng browser. Ảnh các trạng thái
Brand12 OFF/ON và Category11 ON, snapshot/trace/source proof giữ local,
không commit tài khoản/cấu hình/runtime artifacts.

Hai ca toggle đã được bù trên nguồn trên, không còn NOT_RUN cho chúng.
Không chạy lại full test/lint/build vì không đổi source/runtime;441PASS/
6liveSKIP và lint/build của code`37b4182` là lượt đã ghi phía trên, không
mô tả thành lệnh mới chạy ở commit tài liệu. Chưa tự chuyển Ready/merge;
Hoàng review và chốt phạm vi nghiệm thu Brand integration.

Không chạy lại full Backend E2E/AI suite cho diff FE này; Backend build và
PostgreSQL login/GET/Category POST có chạy nhưng không thay full regression
Backend. PR giữ **Draft** chờ Hoàng review bản tích hợp/bằng chứng và quyết định
phần QA còn thiếu; không tự chuyển Ready hoặc nhận toàn Admin đã nghiệm thu.

## Giới hạn không được bỏ qua

- Brand chưa expectedVersion/If-Match hoặc receipt bền vững: chưa giải quyết
  ghi đè hai Admin hay retry an toàn qua reload/đóng màn hình/đổi phiên.
  Giữ editor khi đổi tab chỉ kéo dài lock trong instance Catalog hiện tại.
- Reconciliation job PENDING chỉ chứng minh Backend nhận việc, không xác nhận
  Elasticsearch/FAISS đã cập nhật. Không gọi Search runtime PASS.
- Không dùng fixture Brand không gắn Product để chứng minh mọi tác động listing.
- Accounts/Attributes/Dashboard/Search health/hậu mãi Admin vẫn cần đầu vào và
  PR triển khai riêng; PR integration này không hoàn tất toàn bộ giai đoạn3.
- Hoàng review và quyết định merge; tác giả không tự approve/merge.
