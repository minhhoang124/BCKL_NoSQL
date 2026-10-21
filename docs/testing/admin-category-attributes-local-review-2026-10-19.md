# Rà bản chuẩn bị Attributes của Hiền — 19/10/2026

**PREPARATION / bàn giao PR Draft**. Không có API mới, không ghi PostgreSQL,
không mở route/menu. Không phải nghiệm thu Admin/G3. Hiền cho phép bàn giao
source/test/tài liệu để Hoàng review ngày 19/10; artifact/cấu hình QA giữ local.

## Đúng nền và đúng nguồn

- Nhánh `feat/hien/admin-category-attributes` đã fast-forward từ `035656b` lên
  `develop aa62c846a9be18753435d3f4b2066bf5d3d3caaa`, sau đó lên
  `622cfb92fcea29f763f38e515578a271123565f4` sau merge #61/#68/#69.
  Không ghép Brand integration #71 hoặc code #70/#72 chưa merge.
- Contract #65 đã merge tại `9956379b16f8b64bcffc37a8ef8fd995ac3ccc44`:
  [request/response, chính sách và reason](../api/admin-category-attributes-contract.md),
  [readiness](../architecture/admin-category-attributes-readiness.md),
  [34 acceptance](admin-category-attributes-acceptance.md).
- Giữ phân công Hiền FE/Admin, Hoàng Backend; SRS FR-CAT-01/FR-PRD-01/FR-ADM-01,
  [Product domain](../architecture/product-domain-design.md) và
  [phạm vi/Definition of Done](../project/implementation-scope.md).
- Đây là definition/option mô tả theo Category, không tạo SKU, không kế thừa cha.
  API public active-only không thay Admin GET đầy đủ. Không sửa contract #65.

## Rà và sửa tiếp trên bản cũ

1. Bỏ nhãn lỗi thời “reason/audit chờ chốt”; phân biệt contract đã merge với
   Backend chưa triển khai đầy đủ. Không nhận audit hiện đã tồn tại.
2. Hộp xem trước hiển thị từng giá trị trước/sau và revision mẫu của definition
   cha, kể cả khi sửa option. Không cho mở xác nhận khi không có metadata đổi;
   trim name/order tương đương không tạo diff giả.
3. Lý do chính sách: NFC rồi trim, đếm Unicode code points (emoji không tính
   hai lần), 10–500; không cắt ngầm. Chặn C0/C1 ngoài LF/tab, kể cả control
   ở hai đầu có thể bị trim mất. Chưa gửi/lưu reason hoặc audit.
4. Tạo active required hoặc đổi required/active/custom cần reason. Option bật/tắt
   có cảnh báo và reason theo hướng thận trọng; sortOrder-only không bắt buộc,
   nhưng nếu nhập reason vẫn kiểm hợp lệ. Nút xác nhận thật luôn disabled.
5. Lỗi tên/slug/order có giải thích gắn `aria-describedby` và `aria-invalid`.
   Giữ nháp, giới hạn order Int, không bịa kiểm unique Backend từ mẫu local.
   Lọc không dấu chỉ hỗ trợ tìm mẫu, không dùng làm normalized uniqueness:
   tên canonical của #65 vẫn giữ dấu.
6. Giữ khóa identity khi đã dùng/unknown usage, không DELETE, không sửa value cũ.
   Chặn minh họa bật required SELECT không custom mà không có option active.
   Tắt option cuối **không tự cấm**: cảnh báo mất public và yêu cầu reason theo
   contract, giữ lịch sử; mẫu không giả lập thay đổi Product/public/index thật.
7. Thêm minh họa pending khóa bộ lọc, lựa chọn và form; loading/error/stale/unknown
   vẫn giữ draft nhưng không có retry/write/GET-unlock. Selector trạng thái nằm
   ngoài component để thử bố cục, không phải điều khiển recovery thật.
8. Giữ modal focus/Hủy/Escape/inert, CSS riêng module. Không đổi global theme,
   Auth/apiClient/AppRouter, Address/Cart/Brand, Checkout/Order, BE/schema/Search.

## Kiểm thử lịch sử trên nền aa62c84

Kết quả cuối cùng được ghi sau lượt kiểm trên working tree mới, không dùng
365 test hoặc ảnh 16/10 để xác nhận bản 19/10.

| Kiểm tra | Kết quả |
|---|---|
| Full FE `pnpm --dir FE exec vitest run --maxWorkers=1` | **480 PASS / 6 live SKIP**, 32 suite PASS / 1 live suite SKIP; 87.64s |
| Attributes component + validation, target `src/features/admin-category-attributes` | **48 PASS / 2 suite**, 3.49s ở lượt cuối |
| `pnpm --dir FE lint` | PASS, exit0; 5 cảnh báo set-state-in-effect có sẵn trong AdminDashboardPage, không warning mới ở Attributes |
| `pnpm --dir FE build` | PASS, TypeScript + Vite, 77 modules; bundle chính không đổi hash so với trước sửa preparation |
| Production bundle | Không có chuỗi/module Attributes preview trong dist, không thêm preview HTML vào build; không import từ router/app |
| Browser IAB desktop 1440×1000 | Hộp trước/sau, revision, reason hợp lệ nhưng nút ghi khóa; scrollWidth1425 ≤ innerWidth1440 |
| Browser IAB mobile 390×844 | Hộp cuộn được, reason ngắn báo lỗi; scrollWidth375 ≤ innerWidth390, dialog nằm trong viewport |
| Preference màu | Thực tế dark=true; module nền sáng/chữ heading rgb(32,36,43). Không đổi preference/toàn theme |
| Pending minh họa trên browser bản cuối | Tên, bộ lọc và chọn definition đều disabled; trở lại ready không giả lưu thành công |

Ảnh desktop/mobile và DOM snapshot lưu local ngoài repo trong thư mục outputs
`attributes-preparation-20261019`; không chứa credential hoặc dữ liệu DB thật.
Lượt test trong sandbox gặp EPERM cache rename trước chạy test; không tính FAIL
nghiệp vụ hoặc PASS. Chạy lại với quyền runtime phù hợp, ghi riêng kết quả cuối.
Các ca live bị skip không tính PASS. Không chạy DB/Backend vì chưa có adapter.

## Kiểm tra lại trước bàn giao — nền 622cfb9

Lượt test mới tách khỏi kết quả nền aa62c84 ở trên. Source Attributes không đổi
khi fast-forward, vẫn không import vào router/app production. Phần Admin,
Address/Cart/Checkout, Seller Order recovery và health/Buyer contract mới nhận
nguyên trạng develop, không sửa hoặc bật cờ giao dịch từ task Attributes.

| Kiểm tra mới trên nền 622cfb9 | Kết quả |
|---|---|
| Full FE Vitest, một worker | **603 PASS / 6 live SKIP**, 37 suite PASS / 1 live suite SKIP; 60.42s, gồm 48 test Attributes |
| FE lint | PASS exit0; 5 warning AdminDashboardPage có sẵn, không warning mới ở Attributes |
| TypeScript + Vite build | PASS, 86 modules; bundle runtime chính không import preview, không có chuỗi/module Attributes trong dist |
| Desktop1440×1000 / mobile390×844 | Chạy lại IAB sau reload; before/after, revision, reason hợp lệ/ngắn và nút xác nhận khóa đúng. scrollWidth1425/375 ≤ innerWidth1440/390 |
| Pending/unknown minh họa | Bộ lọc/input khóa; không tự gửi lại hoặc GET-unlock. Selector thử state không phải recovery runtime |
| Source sau đồng bộ | SHA256 sáu file TS/TSX/CSS giữ nguyên bản đã kiểm trước sync; không sửa BE/schema/API/theme chung |

Ảnh mới được chụp sau khi render ổn định (desktop-final/mobile-final), DOM snapshot
giữ local trong outputs `attributes-handoff-20261019`, không commit artifact hoặc
cấu hình. Preference thực tế dark=true; chưa kiểm riêng light/cross-browser/WCAG.
Đã reset viewport sau kiểm. CI/review trên PR mới được theo dõi riêng sau push;
không nhận test local là CI đã xanh hoặc nghiệm thu Backend.

## Checklist Hoàng review và bàn giao Backend

- Review scope chuẩn bị, label mẫu/chưa nối API, form/draft/validation/reason,
  preview before/after và khóa identity/ghi; không coi đây là DTO/API thật.
- Review không ảnh hưởng route/Auth/apiClient/theme/Brand/Category và Order.
- Bàn giao Attributes theo #65 bằng PR/commit đã merge: Admin list/detail/options
  cả inactive, pagination/revision/usage, writes với CAS, normalized uniqueness,
  reason/audit/durable reconciliation nguyên tử và error/quota/body policy.
- Kèm hướng dẫn migration/DB QA riêng và fixture: Admin A/B, Category lá/cha/
  inactive, definitions bốn kiểu, options active/inactive, Product/Order lịch sử;
  dữ liệu NUMBER0/BOOLEANfalse. Credentials gửi riêng, không qua PR.
- Ghi checkpoint/thứ tự bàn giao từng phần; chưa có ngày cam kết thay Hoàng.
  Sau đủ đầu vào Hiền mới nối adapter/phiên/pagination/route và kiểm DB thật.

## Chưa hoàn thành / đầu vào tiếp theo

- AT01–AT34 vẫn **NOT_RUN ở mức acceptance tích hợp**. Component/pure tests chỉ
  kiểm phần trình bày và validation; không chứng minh RBAC/audit/CAS/rollback.
- Chờ Hoàng bàn giao PR Backend đã merge: Admin read cả inactive, pagination,
  definition detail/options và definitionRevision; write/CAS/usage/normalized
  uniqueness/audit/reconciliation nguyên tử, giới hạn HTTP và lỗi đã chốt.
- Sau đó mới làm adapter/session isolation, pagination và revision giữa các trang,
  bắt conflict/unknown theo runtime, nối Catalog đúng phần file chung được duyệt.
  Không dùng số usage hoặc revision mẫu làm quyền sửa thật.
- QA riêng cần Admin A/B, Category active/inactive, definition đủ bốn kiểu,
  option active/inactive và Product/Order lịch sử. Kiểm HTTP/DB hai connection,
  đổi phiên, timeout, mutation rollback và public/Search canonical đầy đủ.
- Unknown chỉ khóa instance, reload không phải recovery bền vững; GET không chứng
  minh lần ghi cũ rollback. Không replay POST/PATCH tự động.
- Chưa kiểm light preference, browser khác/thiết bị thật hoặc toàn WCAG. Không
  báo toàn bộ Admin/giai đoạn 3 hoàn thành từ bản xem trước này.
