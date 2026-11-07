# Attributes: chuẩn bị bộ đọc Admin — 20/10/2026

> Cập nhật 21/10: đã sync develop gồm #77/#81/#74/#88 và chạy bộ đọc thật
> ở trang DEV trên PostgreSQL riêng. Xem [bằng chứng mới](pr73-live-read-qa-2026-10-21.md).
> Các số liệu/NOT_RUN bên dưới là lịch sử đúng baseline ngày20/10, không thay
> bằng chứng mới hoặc nhận toàn bộ Attributes/Catalog production đã hoàn thành.

## Phạm vi và nguồn đối chiếu

Tiếp tục bản local trên branch `feat/hien/admin-category-attributes`, nền
`28b079c0a234a5ea21e594f4788a0b45bf8c4171` của #73; không tạo lại editor.
Đối chiếu [contract #65](../api/admin-category-attributes-contract.md) và
`BE/src/catalog/admin-attribute-read.service.ts` / query/controller của #77
tại `dd8e5b39eadc0e7bbb6ed8d3fec45be15261f05a`.
Đây là chuẩn bị Frontend dựa trên DTO của PR chưa merge, không phải nghiệm thu
API tích hợp hoặc xác nhận #77 đã merge. Bảng kiểm chứng đầu tiên bên dưới thuộc
bản local trước bàn giao; kết quả sau đồng bộ develop được ghi riêng cuối tài liệu.

## Thay đổi local

- `attributeReadApi.ts`: ba GET Admin list/detail/options; DTO riêng, không dùng
  kiểu `sampleKey` của editor mẫu. Kiểm ID/nesting, field, bool/count, cursor,
  thứ tự ID tăng và bộ lọc. Không áp validation ghi mới lên tên/slug legacy.
- GET có abort/timeout 15 giây, `no-store`; không tự refresh/retry 401 trong
  bộ đọc này. Không đổi shared API client hoặc cơ chế Auth của ứng dụng.
- `AdminCategoryAttributesReader.tsx`: mặc định chưa nối API; khi được cấp
  adapter và AuthContext hợp lệ mới đọc. Danh sách phân trang, bộ lọc trạng thái,
  detail/usage/revision/options cả bật và tắt; không suy số dòng tải thành tổng.
- Mỗi definition có revision riêng. Detail khác revision của dòng đã chọn hoặc
  options khác revision detail/trang trước thì bỏ detail/options, báo tải lại.
  Không tuyên bố các trang danh sách Category là snapshot đồng nhất.
- Đổi ngành hàng/bộ lọc/phiên hoặc hủy request sẽ bỏ phản hồi cũ; 401/403 xóa
  dữ liệu đã tải và khóa đọc. Lỗi không hiển thị message thô của Backend.
- Editor minh họa và validation/form cũ giữ nguyên. Không bật tạo/sửa, không gọi
  API ghi, audit hoặc Search reconciliation.
- DEV preview có chế độ đọc qua transport giả lập gắn nhãn rõ. Admin/ID/usage/
  revision đều là dữ liệu mẫu; không fetch network hay ghi token/storage.
- CSS riêng cho bộ đọc, gồm màu tiêu đề rõ trên nền trắng và layout một cột
  ở mobile. Không đổi CSS toàn ứng dụng.

Không sửa AppRouter, Catalog production, AuthProvider, schema/migration,
Backend hoặc phần Address/Cart/Checkout/Order. Bộ đọc chưa có production caller;
chỉ DEV preview và test import. Lượt chuẩn bị ban đầu chỉ sửa local; lượt bàn giao
tiếp theo được Hiền yêu cầu commit/push trên cùng PR #73, không mở PR trùng.

## Kiểm chứng local

- Bộ test mới kiểm DTO/cursor/ownership/filter, `false`/`0`, loại request sai
  trước HTTP, cancellation/session boundary, mất quyền, lỗi/rỗng, double-click,
  phản hồi muộn sau đổi filter/Category và revision lệch ở trang đầu/trang sau.
- Trình duyệt thật với transport giả lập: desktop 1280×900 và mobile 390×844;
  không tràn ngang. Màu tiêu đề sau sửa là `rgb(32,36,43)` trên nền sáng.
- Đã thao tác tải thêm definition, đọc detail, tải hết 3 options, gồm option
  inactive; ca revision 3→4 bỏ detail/options và hiện cảnh báo; 403 khóa đọc;
  bộ lọc inactive chỉ trả dòng đã tắt. Không cần hộp xác nhận ghi.
- Ảnh local lưu ngoài repository tại
  `C:/khoaluan/outputs/attributes-read-preparation-20261020/`.

Kết quả trên đúng working tree sau thay đổi cuối:

| Kiểm tra | Kết quả |
|---|---|
| FE toàn bộ | **646 PASS / 6 live SKIP**, 39 file test pass, 1 file live skip |
| Test mới | **43 PASS** (30 adapter + 13 UI); đã nằm trong 646 ở trên |
| Lint | Exit 0, không lỗi; 5 cảnh báo `set-state-in-effect` cũ ở AdminDashboardPage chưa thay đổi |
| TypeScript + production build | PASS, 86 modules; CSS `index-C3rnJ6XR.css`, JS `index-CdrpQHaw.js` |
| Production boundary | Không có import bộ đọc trong router/Catalog; tìm tên bộ đọc/nhãn giả lập trong dist không có kết quả |
| Diff whitespace | PASS, chỉ cảnh báo LF→CRLF theo cấu hình Git |

Lần chạy sandbox ban đầu lỗi quyền đổi tên cache (EPERM), không chạy được test;
đã chạy lại ngoài sandbox, không sửa test để bỏ qua lỗi chức năng.

## Chưa chạy / điều kiện bước tiếp theo

- Backend/PostgreSQL thật: **NOT_RUN** cho bộ đọc mới này.
- Phân quyền thực, session/refresh thực, Category inactive, dữ liệu fixture thật:
  **NOT_RUN**. Guard/mô phỏng Frontend không chứng minh bảo vệ Backend.
- API ghi definition/options, CAS/audit/recovery/Search sync: **NOT_IMPLEMENTED**
  trong phần chuẩn bị này; không coi read API đủ đầu vào để bật ghi.
- Chờ #77 được đồng bộ/review và merge thật, rồi đối chiếu lại đúng DTO/head.
  Sau đó mở nhánh tích hợp từ develop theo phân công, nhận fixture QA riêng,
  nối Catalog và kiểm DB thật. Không dùng kết quả giả lập làm bằng chứng runtime.
- Giai đoạn 3 chưa hoàn thành chỉ nhờ phần chuẩn bị này; Accounts/Search health/
  Dashboard/hậu mãi còn phụ thuộc đầu vào tương ứng.

## Bàn giao trên #73

Ngày 20/10 kiểm GitHub: #71 OPEN/APPROVED, chưa merge; #77 OPEN/Draft,
head `dd8e5b3`, APPROVED nhưng CONFLICTING với develop hiện tại. Không merge
nhánh Backend #77 chưa được tích hợp vào nhánh Frontend này.

Review của Hoàng trên #73 tại `28b079c` chỉ áp dụng bản preparation cũ;
phần đọc mới và delta develop cần re-review đúng head sau push. P3 về
`name.trim().length`/`maxLength` chưa NFC trước kiểm tên/value ở editor minh họa
vẫn mở trước integration ghi; không âm thầm đổi semantics hoặc nhận đã giải quyết.

Đã đồng bộ `origin/develop 6d682e42a7f4dafe8adb91b13a673d00d0fb2fe9`.
Conflict duy nhất ở cuối tài liệu kiến trúc: giữ nguyên đoạn Attributes ngày19/10
và đoạn Buyer resolution test preparation, bổ sung ghi chú read preparation mới.
Không dùng 646 test ở nền cũ làm bằng chứng bản kết hợp.

Kiểm thực chạy trên bản kết hợp trước push:

- **744 FE PASS / 6 live SKIP**, 40 files PASS / 1 live SKIP, 18.39 giây;
  gồm 43 test đọc mới và 48 test editor/validation cũ, không cộng lại vào tổng.
- Lint exit0, vẫn 5 warning Dashboard có sẵn; TypeScript/Vite build PASS,
  86 modules, tên/hash bundle production giữ nguyên như bảng trước đồng bộ.
- So với develop: toàn Backend, FE pages/services/routes/contexts/types,
  global CSS/package/lockfile nguyên byte; nhận đủ Buyer receipt #70, fixture
  #72 và test concurrency #78. Không thêm thay đổi Address/Cart/Brand/Order.
- Source Attributes và DEV preview nguyên byte so với commit chuẩn bị `36a6030`.
  Không có marker conflict hoặc lỗi whitespace, không có bộ đọc trong dist.
- Browser desktop/mobile phía trên đã chạy trước đồng bộ; không chạy lại browser
  trên bản kết hợp này. Không đổi nhãn ảnh cũ thành bằng chứng head mới.
- Backend/PostgreSQL/live acceptance tiếp tục **NOT_RUN**; không chạy BE suite
  local lượt này vì toàn BE khớp develop, không nhận test mock FE là chứng cứ DB.

Giữ Draft để Hoàng re-review phần mới và delta, không tự approve/Ready/merge.
Approval cũ chỉ áp dụng bản cũ. CI head mới phải kiểm riêng sau push.
