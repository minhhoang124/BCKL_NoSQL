# #73 — Attributes đọc thật trên PostgreSQL riêng, 21/10/2026

> Bổ sung sau lượt này: đã kiểm mạng/timeout thật trên head5689e3c cho list,
> detail và options. Xem [bằng chứng mới](pr73-network-qa-2026-10-21.md).
> Các NOT_RUN bên dưới giữ đúng phạm vi của lượt ban đầu; không nhận full
> acceptance, hai profile độc lập hoặc luồng ghi đã đạt từ bổ sung này.

## Baseline và giới hạn

- Bản đã bàn giao trước: `7d39c9dbe0a1d66a9b61c9dfcdc3a8b86448219d`.
- Nhận develop `fa85f6658ffd980902b4b61bce44c834c5e5913a` (gồm #77,
  #81 và Buyer #74), sau đó `d84381a7838a5d0bd343635f1a2262a534e381b7`
  (#88, bảo vệ target database E2E). Không nhận nhánh PR chưa merge.
- Code đã kiểm cuối: `ef4b82f2798b7f534e63da95d322f4a7a6d629ee`.
  Commit bàn giao sau đó chỉ bổ sung tài liệu, không đổi code đã kiểm.
- Căn cứ: [contract #65](../api/admin-category-attributes-contract.md),
  controller/query/service đọc Admin đã merge #77 và fixture DB thực tế.
- Đây là **QA bộ đọc thật ở trang DEV riêng**, không phải Catalog production,
  không phải nghiệm thu toàn Attributes hoặc toàn Admin/giai đoạn 3.

## Delta của Hiền

Giữ nguyên byte editor, adapter và reader so với head `7d39c9d`. Thêm
`FE/admin-attributes-live-qa.html` và entry/component/test/CSS DEV riêng:

- Dùng AuthProvider, LoginPage, API client và adapter GET thật đang có; không
  gán danh tính Admin mẫu, không ghi token hoặc giả lập response cho lượt live.
- Nhập Category ID cụ thể từ fixture; không đoán ID hoặc tự mở Category mặc định.
  Cỡ trang có thể chọn 1–100; guest/role khác/inactive không mount reader.
- HashRouter giữ entry QA khi login/reload. Đăng xuất bỏ reader trước khi chờ
  kết quả; lỗi logout không tự ghi nhận PASS.
- DEV entry có nhánh `import.meta.env.DEV`. Không gắn vào AppRouter/Catalog
  production, không sửa AuthProvider/API client/theme chung.
- Sửa line-height **CSS riêng trang QA** sau khi quan sát tiêu đề bị chồng dòng
  ở mobile; ảnh cuối đã chụp lại sau sửa, không dùng ảnh lỗi để xác nhận.

So với develop `d84381a`, toàn BE/AI/schema/migration, FE pages/routes/contexts/
services/types/global CSS/package/lockfile không có delta của Hiền. Giữ nguyên
Brand/Category/Address/Cart/Checkout/Order và các thiết kế recovery đã merge.
Conflict lần sync đầu chỉ ở ghi chú kiến trúc, giữ cả hai phía; sync #88 tự merge.

## Môi trường và oracle

Backend Nest build thật; Frontend Vite DEV; PostgreSQL 17 container riêng chỉ
bind loopback. Tạo **database mới**, chạy đủ **16 migration**; không reset DB
demo hoặc DB QA cũ, không giả `GITHUB_ACTIONS=true` để vượt guard.

Fixture tổng hợp: 5 tài khoản theo role/trạng thái; 3 Category (gồm leaf inactive
và Category trống), 5 definitions, 5 options cả active/inactive, 2 Product DRAFT.
Definition SELECT revision 6, usage 2; options đầu active/inactive đều usage 1.
sortOrder cố ý khác thứ tự ID để kiểm cursor theo ID. ProductValue có NUMBER 0,
BOOLEAN false và text. Dữ liệu không dùng để chứng minh sản phẩm công khai.

Snapshot trước/sau lấy bằng Prisma từ đúng database đã guard. HTTP kiểm so với
snapshot DB, không so response với chính response hoặc với dữ liệu mẫu FE.
Thông tin kết nối, tài khoản, mật khẩu, secret/token/cookie chỉ lưu private local;
không đưa các file đó vào PR. Trace chỉ ghi method/path/status/cache, không body
đăng nhập, Authorization hoặc cookie.

## Kết quả có bằng chứng

| Phần | Kết quả / phạm vi thực chạy |
|---|---|
| Browser → API → DB | PASS: login Admin thật; Category inactive đọc được; definitions 2→4→5; detail ID/revision/usage/flags khớp DB; options 2→4→5 gồm inactive, usage 0/1 |
| Bộ lọc và rỗng/lỗi | PASS: inactive 2 dòng; active 3 dòng qua 2 trang; đổi filter bỏ detail cũ; Category trống 0 dòng; Category không tồn tại báo lỗi an toàn, không giữ danh sách cũ |
| Phiên thật | PASS: reload dùng refresh thật, config Category không tự khôi phục/đoán; logout rồi reload về login, không còn reader/dữ liệu |
| Role ở UI | PASS: Buyer/Seller đăng nhập thật nhưng không mount reader; Admin inactive bị từ chối login. Không thay bằng AuthContext giả |
| HTTP/DB verifier | PASS 45 request kiểm trên bản cuối; guest 401, Buyer/Seller 403, inactive signed-fixture JWT 401, Admin 200 cho 3 GET; HEAD 200; tất cả Admin response kể cả lỗi có no-store |
| DTO/pagination ở HTTP | PASS: mọi field definition/detail/options khớp DB, cursor ID tăng, isActive true/false, revision 6; invalid query 400; sai nesting/không tồn tại 404; public read của Category inactive 404 |
| Không ghi dữ liệu nghiệp vụ | PASS: snapshot Category/definition/option/Product/ProductValue trước=sau; audit/outbox/reconciliation job/Order vẫn 0. Login/refresh tạo/đổi session bình thường, không tuyên bố auth DB bất biến |
| Giá trị 0/false | DB xác nhận giữ nguyên; UI reader chỉ hiển thị type/usage/flags, **không** hiển thị raw ProductValue. Không nhận đã nghiệm thu form nhập giá trị Product |
| Responsive | PASS: desktop mặc định và mobile override 390×844, clientWidth=scrollWidth=375, không cuộn ngang; ảnh cuối tiêu đề đọc được, options/usage không bị che |

Inactive JWT trong verifier là token fixture ký hợp lệ có danh tính người dùng
đã inactive để kiểm Backend đọc trạng thái DB hiện tại. Không gọi nó là ca mất
quyền giữa hai phiên trình duyệt hoặc ca tự khóa Admin.

## Test/lint/build trên code cuối

- Full FE **821 PASS / 6 opt-in live SKIP**, 45 files PASS / 1 SKIP, 52.99s.
  Gồm 9 test entry QA mới, 43 test reader/adapter và 48 test editor/validation;
  các nhóm này đã nằm trong tổng, không cộng lại. Unit mocks không là proof DB.
- FE lint exit 0, 5 warning Dashboard có sẵn; TypeScript/Vite production build
  PASS, 89 modules. Bundle `index-Uu3ORd9I.css`, `index-BTh7fP5F.js` không chứa
  live QA/preview/Attributes reader; HTML QA không được output trong dist.
- BE build PASS trên source runtime nhận từ develop; BE lint PASS. Sau #88,
  14 test `runtime-qa-target.spec.ts` PASS. Không chạy lại full BE/E2E suite.
  #88 chỉ đổi test harness/docs, không đổi BE runtime đã build hoặc FE.
- Có một lượt FE dừng **trước khi chạy test** do sandbox EPERM khi rename cache
  tạm; đã chạy lại cùng cấu hình với quyền phù hợp và đạt số liệu ở trên.
- Bước chốt manifest ban đầu dùng nhầm đường dẫn dist/src, đã sửa thành dist;
  không tạo lại fixture hoặc nhận lượt lỗi harness là PASS.
- diff-check/scope/marker đạt. Hai tài liệu local có sẵn của Hiền được giữ riêng,
  không stage/push trong lượt này.

## Bằng chứng local, không chứa trong Git

Thư mục `C:/khoaluan/outputs/attributes-live-qa-20261021/`:
`source-manifest.json`, `fixture-manifest.json`, `browser-proof.json`,
`http-verification.json`, `http-trace.jsonl`, `db-before.json`, `db-after.json`,
`desktop.png`, `mobile.png`, `logout.png`. Chỉ chia sẻ artifact đã rà/redact;
**không gửi cả thư mục vì có private-state.json**.

SHA-256 artifact cuối:

| Artifact | SHA-256 |
|---|---|
| desktop.png | `48C56A13360F7F0E30704684895B89DB19D3D47BF34C13CAA75815D7EBEF3E32` |
| mobile.png | `67E8745B2722FF3B08814D973CAC3C590FEA3A2C6B6A14259BB063A3D9DB661A` |
| http-verification.json | `4407F76C9C3C9761073751F6B382C73C54DBBF2EBA1A7BD6916777CC23C17E10` |
| db-after.json | `5238BF5CDCE308DF0BFF3398C61A39E9BCBD5C2F411BCCFFAFF950AB4586D4B3` |

Tái kiểm: checkout đúng code/base trên, cài theo lockfile, build BE; dùng DB mới
theo target guard và fixture tổng hợp tương đương. Chạy Vite với VITE_API_URL
trỏ Backend QA máy mình, mở `admin-attributes-live-qa.html`, đăng nhập Admin QA,
nhập Category fixture và cỡ trang 2. Không dùng trang preview mock cũ hoặc
localhost máy người khác làm môi trường bàn giao.

## Còn NOT_RUN / chưa bàn giao

- Hai Admin **hai browser/profile độc lập**: user yêu cầu để cuối, chưa chạy.
- Race revision với một luồng ghi Backend thật, network/timeout thật và mất
  quyền giữa request: chưa chạy ở lượt live; unit mocks không thay các ca này.
- Catalog production integration chưa nối; read-only DEV QA không là production
  feature acceptance. Form tạo/sửa/đổi trạng thái thật chưa bật, không gọi PATCH
  legacy, không tự biến API đọc thành hợp đồng ghi.
- CAS/unique/audit/rollback/concurrency/Search propagation và full AT01–34 còn
  chưa nghiệm thu. Không sửa tất cả trạng thái checklist sang PASS từ subset này.
- P3 tên/value editor trim/UTF16 chưa NFC vẫn chờ thống nhất normalizer Backend
  trước integration ghi; không nhận đã resolve.

Nhờ Hoàng re-review đúng head mới: delta sync, DEV boundary, Auth/session guard,
fixture/DB evidence và giới hạn trên. Giữ Draft, không tự approve/Ready/merge;
approval head cũ và local PASS không thay CI/review head mới. Bàn giao tiếp theo
cần API ghi/fixture theo #65 trước khi mở các thao tác ghi.
