# Quyền Buyer bổ sung cho Seller — Backend đợt A

## Đồng bộ sau Auth/tìm ảnh/SRS ngày 23/10

Nhận develop `65ad255` tại `d5daf2e`. Giữ cả cờ quyền Buyer và cờ Account
settings mặc định tắt; AccountPage giữ form hồ sơ mới và link đơn mua cho đúng
quyền, router giữ tìm ảnh/Admin/Seller. Không thay schema, signup hoặc cấp quyền bán.

Thêm test đối kháng ở `seller-buyer-access.e2e-spec.ts`: Seller tự mua bị409
SELF_PURCHASE_FORBIDDEN tại Cart, preview và create. Dòng Cart được chèn bằng
fixture DB không vượt được hai chốt Checkout; kho/version/outbox/Order/ledger
không thay đổi. Bộ tập trung6/6PASS; không sửa guard hoặc nghiệp vụ để né test.

Trên source `70421f8`:
- Backend **1.228 unit PASS/54file**, lint/typecheck/build PASS.
- Full E2E **828 PASS/1 SKIP/20 TODO**,50filePASS/2SKIP,309.37s, QA v931 nâng
  17→19migration. SKIP/TODO vẫn chưa chạy, không nhận toàn hệ thống hoàn tất.
- Frontend **1.228 PASS/6liveSKIP**,64filePASS/1SKIP,149.24s; lint0error,
  5warning Admin nền, TypeScript/VitebuildPASS.
- Chrome/Nest/PostgreSQL thật chạy lại19/19PASS với Seller dùng ngữ cảnh Buyer:
  cancel/complete, lost-response/reload, receipt đã biết nhưng GET lỗi, CLOSED,
  tài khoản đổi khi giữ response, Seller xác nhận trước hủy, storage quota,
  malformed200 và timeout thật30s. Không giả HTTP thành công giao dịch.
  Artifact mới riêng `artifacts/seller-as-buyer-browser-20261023/r1792752612933/`;
  không ghi đè run1, không ghi password/token hoặc xóa immutable receipt/fence.
- Gemini Argon Medium chỉ đọc ProtectedRoute và BuyerOrderWorkspace đúng70421f8,
  NO FINDING trong2file tĩnh. Ghi nhận giới hạn getSession đóng theo mount: lớp
  adapter/fetchApi vẫn kiểm phiên thật, Chrome held-response/account-switch đạt;
  không coi review tĩnh là proof Gemini tự chạy DB/browser hoặc approval của Hiền.

Các số/source bên dưới giữ lịch sử. Hoàng đã cho phép Codex+Gemini review thay
và merge chuẩn với ngoại lệ CI billing đã kiểm annotation; không báo CI xanh.

Nền `06eb4fd`, branch `codex/account-access-foundation`, ngày23/10/2026.
Chưa merge; `ACCOUNT_BUYER_ACCESS_ENABLED=false` và
`VITE_ACCOUNT_BUYER_ACCESS_ENABLED=false` mặc định. Không sửa schema,
migration hoặc Auth signup. Web đã nối policy sau cờ QA.
[Thiết kế và audit](../architecture/account-buyer-seller-rollout.md).

## Đã thực thi

- Frozen offline install:585 package tái sử dụng, không tải dependency mới.
- Backend1129unit/50file PASS; typecheck/lint PASS, không warning lint mới.
- QA mới `bckl_order_resolution_test_account_access_20261023_v930` ở loopback5549:
  17migration có sẵn áp fresh thành công. Không có migration membership mới.
- `seller-buyer-access.e2e-spec.ts`: **5/5 PASS**,5.55s; hai Nest app/pool thật.
  Seller Store SUSPENDED mua ở Store khác, replay COD, ownership, hủy hoàn một
  lần, hoàn tất sau giao Admin mô phỏng và đối chiếu receipt, chặn Admin/khóa
  tài khoản, cờ tắt và USER không được vào Seller API.
- Fixture/receipt giữ lại trong DB QA. Launcher kiểm demo đã dừng, không đọc
  `.env` để đổi target; không dùng kết quả này khẳng định DB demo lịch sử không đổi.

- Build Backend, typecheck, lint, Prisma validate và diff-check PASS.
- Full E2E lần1:676PASS,7suite bị guard từ chối namespace DB v930; không phải
  PASS toàn bộ và không sửa guard. Giữ nguyên v930, tạo DB QA fresh đúng namespace
  `bckl_order_resolution_test_attributes_20261019_v931`/17migration, chạy lại:
  **762PASS/1SKIP/20TODO**,44filePASS/2SKIP,220.55s. Không cộng lượt test lặp.
- FE **1162PASS/6liveSKIP**,59filePASS/1SKIP,62.15s; TypeScript/Vite build PASS,
  lint0error/5warning Admin nền. Có ca SELLER lost-response/remount/resolve cùng
  key và complete đúng endpoint, Auth role vẫn SELLER; default-off chặn route.
- Gemini Flash Medium rà tĩnh đúng policy/guard Backend tại `ba18785`:
  NO FINDING; không chạy test, không review Web hoặc toàn bộ transaction.

Chrome Seller-as-Buyer: **19/19 PASS**,32PNG, Chrome155.0.8059.85; marker
`buyer-web-fbb6982e-99f`. Driver dùng tài khoản role SELLER thật, mỗi tài khoản
có Store riêng SUSPENDED, mua hàng tại Store ACTIVE khác. API tạo Checkout và
chuyển trạng thái Order thật trên v931; không mock thành công giao dịch.

Các nhóm: desktop/mobile light/dark cancel/complete; mất response sau commit
rồi reload/resolve cả hai lệnh; receipt đã biết nhưng GET lỗi; CLOSED rồi xác
nhận ý định mới riêng; đổi tài khoản khi response còn chờ; Seller xác nhận trước
Buyer hủy; storage quota trước POST; malformed200 sau commit; timeout thật30s.
Đối chiếu Order/Payment/kho/ledger/history/receipt trong PostgreSQL. Header có
cả Giỏ hàng và Kênh người bán, không overflow. OS dark giữ storefront cam sáng.

Bằng chứng local bị Git ignore: `artifacts/seller-as-buyer-browser-20261023/run1/`
với `results.json`, `report.html`,32PNG. Script đã merge nền được mở rộng bằng
`--seller-as-buyer`; chỉ nhận namespace QA v931 trong chế độ này và giữ target
v916 cho chế độ Buyer cũ. Lượt driver đầu thiếu khai báo tùy chọn bị từ chối
trước khởi tạo; đã bổ sung rồi chạy lại đầy đủ. Không thay guard DB để bỏ lỗi.

Chưa nhận toàn SCOPE-ROLE-001: đăng ký/onboarding và migration membership còn
đợt review/triển khai tiếp. Catalog/tài khoản là fixture tổng hợp; giao Admin
mô phỏng qua HTTP, không logistics thật. Không chứng minh toàn Address→Cart→
Checkout bằng thao tác Chrome: bước chuẩn bị này dùng HTTP, Chrome bắt đầu từ
Order detail. Chưa chạy Chrome thao tác hai phía mua/bán trong cùng tab liên tục.

## Chạy lại

Chỉ dùng DB riêng theo guard `BE/test/setup-env.ts`, không dùng demo5432.
`pnpm --dir BE exec vitest run src/auth/buyer-access.spec.ts` kiểm policy thuần.
E2E dùng cấu hình `BE/vitest.config.e2e.ts`, biến QA được inject từ launcher riêng;
không lưu credentials vào tài liệu. Test mới tự bật cờ trong phạm vi suite và
khôi phục sau suite; full hồi quy còn lại giữ cờ mặc định tắt.
Đợt FE đầu có một ca fixture sai: router từ chối Seller rồi chuyển về Home,
nhưng mock trả Order cho Categories, gây flatMap error. Đã sửa đúng fixture và
chạy lại toàn bộ FE đạt; không sửa Home để che lỗi fixture.
## Cập nhật đồng bộ 23/10/2026

Nhận develop `a91db91` sau #94; conflict chỉ ở tổng quan kiến trúc, giữ cả
ghi chú miền tính năng và Attributes. Không thay runtime của tính năng trong
lượt đồng bộ; không dùng approval head cũ thay review bản kết hợp.

Đã chạy lại seller-buyer-access.e2e-spec.ts: 5/5 PASS trên DB QA v931. Các số full suite/Chrome phía trên là bằng chứng trước đồng bộ, chưa chạy lại toàn bộ sau merge này. Sửa diễn giải tài liệu: SRS AC-CAR-01/D05 đã cấm tự mua Store mình, runtime Cart/Checkout hiện có SELF_PURCHASE_FORBIDDEN được giữ nguyên.
