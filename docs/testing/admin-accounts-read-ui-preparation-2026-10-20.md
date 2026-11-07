# Accounts UI — chuẩn bị phần đọc từ layout có sẵn

20/10/2026. **PREPARATION — chưa nối router hoặc nghiệm thu Backend thật.**

## Nền và phạm vi

- Nhánh `feat/hien/admin-accounts-read-ui`, tạo từ develop
  `6d682e42a7f4dafe8adb91b13a673d00d0fb2fe9`.
- Tái sử dụng layout/CSS/test và tài liệu lịch sử ngày16/10 từ bản Accounts local;
  giữ nguyên worktree cũ và phần Attributes/checklist QA chưa commit.
- Căn cứ: phần đọc của [contract #76](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/76)
  tại `a761879`, [API #80 tại head đã review](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/blob/ddf8a810b0b7363a824517df4b658a0f71327c7e/docs/api/admin-accounts-list.md).
- Hiền đã [APPROVE #80 đúng ddf8a81](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/80#pullrequestreview-5584420176)
  cho Backend read/QA handoff; không coi approval đó là QA Frontend Accounts.

## Đã chuẩn bị

1. Giữ `AdminAccountsLayout`/CSS/test cũ làm ví dụ display-only. Không đưa DTO
   Backend vào `AccountLayoutExample.sampleId`, không âm thầm biến preview thành
   tài khoản thật. Readiness/layout docs ngày16/10 là lịch sử tại baseline cũ,
   không dùng dòng “chưa API list” trong đó để phủ nhận API mới #80.
2. `accountReadApi.ts`: DTO ID số riêng, chỉ GET `/admin/accounts`; allowlist
   response/Store null hoặc summary, strict query/limit/cursor/role/isActive,
   NFC+trim và tối đa120 codepoints cho q. Giữ boolfalse/null, không nhầm Store
   tạm khóa với trạng thái tài khoản. Không lọc q trên một trang phía client.
3. Adapter mặc định dùng shared fetchApi khi được nối rõ ràng; no-store,
   abort/timeout15s, kiểm session generation trước trả kết quả. Bộ đọc này
   không tự refresh/retry401; không sửa AuthProvider/API client hoặc lưu token riêng.
4. `AdminAccountsReader`: mặc định chưa kết nối API, cần active Admin context.
   Tìm theo tên/email, vai trò USER/SELLER/ADMIN, hoạt động/khóa. Bấm Tìm kiếm
   hoặc Enter mới áp dụng; label bộ lọc đã áp dụng tách khỏi form đang sửa.
5. Cursor tăng ID, tải thêm từng trang, đếm số đã tải thay vì bịa totalCount;
   đổi bộ lọc/reset/phiên thì bỏ dữ liệu và request cũ. Cùng ID nhưng session
   mới cũng reset. Loading/rỗng/lỗi/401/403 khác nhau; lỗi trang tiếp theo bỏ
   dữ liệu không còn chắc chắn và cho retry từ đầu; mất quyền khóa đọc.
6. Không có nút khóa/mở trong màn read thật. Form quyết định cũ chỉ tồn tại
   trong layout minh họa, nút xác nhận luôn disabled, không gọi PATCH.
7. DEV preview dùng adapter thật + transport giả lập, synthetic Admin/ID/Store
   có nhãn rõ; không gọi network Backend, không token/storage/DB. Có thể chuyển
   về layout mẫu cũ. Không có production caller trong AppRouter/Catalog/Admin pages.

Không BE/schema/migration, không thay shared Auth/client/router/theme hoặc
Address/Cart/Brand/Checkout/Order. Bản chuẩn bị ban đầu chưa chứa #80; lúc bàn
giao, #80 đã merge nên nhận qua fast-forward develop `39bbe28`, không cherry-pick
hoặc gộp nhánh Backend chưa merge. Hiền yêu cầu push UI bằng PR Draft riêng;
không tự approve/Ready/merge hoặc coi API đã merge là UI được nghiệm thu.

## Kiểm thực chạy

| Kiểm tra | Kết quả |
|---|---|
| Frozen/offline install | PASS, không đổi lockfile |
| Full FE trên working tree cuối | **710 PASS / 6 opt-in live SKIP**,39filesPASS/1SKIP,24.44s |
| Accounts tests | 57ca nằm trong tổng:14layout cũ +29adapter +14reader; không cộng lại |
| Lint | Exit0, chỉ5warning Dashboard có sẵn; warning FastRefresh ở preview mới đã sửa |
| TypeScript/Vite build | PASS,86modules; bundle production vẫn CSS `index-C3rnJ6XR.css`, JS `index-CdrpQHaw.js` |
| Production boundary | Không có reader/nhãn API giả lập trong dist; không import từ router/pages |
| Trình duyệt mock | Desktop1280×900 và mobile390×844, dark preference=true; tiêu đềrgb(32,36,43), mobile scrollWidth375≤390 |

Browser đã thao tác: tải đủ5row qua3trang (2/2/1); query+roleSELLER+inactive cho
đúng một dòng; xóa bộ lọc; tìm bằng Enter; tên null/email dài/Store suspended;
loading/rỗng/lỗi/401/403/chưa kết nối.403 xóa row/khóa input, chưa API không biến
thành0kết quả. Preview mẫu cũ có14test giữ hành vi trước. Chưa full WCAG,
light preference/cross-browser hoặc kiểm tải lớn.

Ảnh bằng chứng giữ local ngoài repo:
`C:/khoaluan/outputs/accounts-read-ui-20261020/{desktop,mobile,forbidden}.png`.
Không đưa tài khoản/mật khẩu/cấu hình QA lên GitHub.

## Chưa làm và đầu vào tiếp theo

- Browser/UI → Backend/PostgreSQL thật, refresh thực, hai Admin ở hai profile:
  **NOT_RUN** cho phần UI mới; test mock không thay bằng chứng đó.
- Accounts khóa/mở nâng cấp: **NOT_IMPLEMENTED** trong nhánh này. PATCH cũ không
  đủ reason/audit/revision/session epoch, self-lock/lastAdmin và race safety theo
  #76. Chỉ đọc danh sách không phải từ chối tính năng khóa/mở; phải có PR riêng
  cho Backend và QA trước khi nối nút.
- Không nhận toàn Accounts/Admin/giai đoạn3 DONE. Không lấy683unit/612E2E của
  lượt review Backend #80 làm kết quả UI; full FE710 là suite khác.
- #80 hiện đã merge: dùng đúng merge commit/API, thống nhất route/menu/file dùng
  chung với Hoàng, nối reader vào Admin trên nền develop mới rồi dựng DB riêng
  bằng script đã review. QA filter/cursor/reset/permissions/session bằng UI thật
  và đối chiếu DB; giữ nút khóa/mở tắt cho đến API command đầy đủ.

Tham khảo lịch sử, không phải trạng thái API hiện tại:
[layout16/10](admin-accounts-layout-preparation-2026-10-16.md),
[readiness16/10](admin-accounts-api-readiness-2026-10-16.md).

## Bàn giao PR chuẩn bị

#80 đã merge vào develop tại `39bbe2832a32fb2ab56583d6df540080c6adc92c`
ngày20/10. Nhánh FE đã fast-forward lên đúng commit này trước commit/push,
giữ nguyên các file UI local; thay đổi upstream chỉ Backend/tài liệu, không FE.

Đã chạy lại trên nền mới: **710 PASS / 6 live SKIP**,39filesPASS/1SKIP,27.10s;
lint exit0 còn5warning Dashboard nền; TypeScript/Vite build PASS,86modules,
bundle production giữ nguyên tên/hash. Không lấy24.44s của lượt trước làm thời
gian bản sau đồng bộ. Sau kiểm chỉ sửa tài liệu và bỏ dòng trống EOF dư do nhập
layout cũ, không đổi logic. Ảnh/browser mock ở trên
đã chạy trước đồng bộ, source FE không đổi, chưa chạy lại browser/DB sau sync.
UI→Backend/PostgreSQL/route/menu vẫn NOT_RUN trong đợt preparation này.
Không thiếu API danh sách nữa: thiếu bước nối màn UI này với route/Auth/API thật
và bằng chứng tích hợp. Test giả lập hỗ trợ phát triển UI, không thay bước đó.

Nhờ Hoàng review DTO/query/cursor và trạng thái UI; guard/abort khi đổi bộ lọc/
phiên; reuse layout cũ; không route/shared client/theme/write. Chốt route/menu
và scope tích hợp tiếp theo để Hiền nối API đã merge và QA thật trên DB riêng.
