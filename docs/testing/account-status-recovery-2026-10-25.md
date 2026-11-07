# Accounts audit/recovery và dialog —25/10/2026

IN_PROGRESS trên `codex/account-status-audit-recovery`, base develop `d508c61`
sau #114. Đây là kiểm thử source mới chưa commit lúc chạy; không tuyên bố commit
base chứa implementation mới. Chrome summary ghi SHA256 từng file runtime/driver
để đối chiếu. Contract: [account-status-recovery](../api/account-status-recovery.md).

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Backend unit toàn bộ |1341 PASS,61 files|
| Backend E2E toàn bộ trên PostgreSQL QA |914 PASS,1 SKIP,20 TODO;57 files PASS/2 SKIP|
| Accounts HTTP/PostgreSQL với application role không superuser/createdb/createrole |36 PASS: recovery15, hardening15, owner invalidation6|
| Accounts FE mục tiêu |82 PASS/5files|
| FE toàn bộ |1346 PASS/6 live SKIP;75 files PASS/1 SKIP|
| Backend lint/typecheck/build |PASS,0 lint error/warning|
| FE lint/typecheck/build |PASS;5 warning nền cũ AdminDashboardPage|
| Prisma schema diff với DB đã migrate |Không có khác biệt|
| Migration |25 migrations fresh PASS; nâng SQL thật23→24→25 bảo toàn User/audit/refresh cũ trong E2E|
| Chrome thật desktop/mobile × light/dark |4/4 PASS: khóa/mở, mất response thật sau commit, reload, đóng mã, đổi phiên, revision conflict|

Build FE mặc định tắt và bật riêng cờ đều đạt. Bản bật cờ có cảnh báo bundle
trên500KB; không tăng ngưỡng để che cảnh báo. Full E2E dùng migrator vì có test
DDL; chỉ suite Accounts36 và Chrome được chạy bằng application role. Không
gọi toàn914 test là bằng chứng least privilege.

Full suite chạy trước điều chỉnh metadata ORM FK/index cho khớp SQL hiện hữu;
SQL/data không đổi. Sau điều chỉnh đã generate/build/typecheck lại và schema-diff
không khác biệt. Thay đổi hiển thị cuối chỉ scope dialog vào CSS Accounts để
tiêu đề có tương phản và nút có kích thước phù hợp trong cả hai chế độ màu;
Chrome được chạy lại sau sửa, không dùng ảnh trước sửa làm nghiệm thu cuối.

## Đối kháng và bất biến đã kiểm

- Writer/closure đồng thời chỉ có một kết quả cuối; close-before-write chặn
  PATCH đến muộn. Cùng UUID khác target/revision/state/reason trả409; Admin khác
  không đọc receipt của actor gốc. NOOP chỉ ghi command metadata.
- APPLIED replay trả snapshot gốc; trạng thái hiện tại có thể đã khác. Audit,
  session revoke, Search owner job và command cùng commit hoặc cùng rollback.
- Corrupt receipt trả503, không bịa/xóa fence hoặc sửa User. Command immutable;
  SQL NULL receipt không lách CHECK. Audit history phân trang đúng revision,
  gồm cả revision int32 tối đa; không trả credentialVersion/hash/token.
- Double click chỉ một PATCH. Timeout giữ metadata qua reload, không lưu reason
  plaintext/token/email và không tự gửi lại thao tác. Chỉ explicit reconcile
  mới đọc receipt hoặc đóng mã. CAS không xóa intent khác/phiên khác.
- Chrome nhận HTTP200 thực từ Backend rồi chủ động hủy response tới browser:
  commit đã xảy ra, journal vẫn giữ, reload không replay PATCH. Đây là fault
  injection ở browser, không phải bằng chứng packet loss vật lý.
- Chuyển cookie/session giữa hai Admin không dùng hoặc xóa pending của nhau.
  Đây không phải test logout-revocation. Token target cũ bị401 cả sau unlock;
  login mới dùng được. Store vẫn SUSPENDED, không bị mở theo User.

## Review độc lập và lỗi đã sửa

Gemini Argon Medium đọc snapshot8file source, kết quả SUCCESS/NONE cho P1/P2.
Đây là review tĩnh độc lập, không phải human approval trên GitHub hoặc một lượt
live QA riêng. Snapshot và JSON review ở deliverables local, không có secret.

Lượt Chrome đầu sai giả định login chuyển thẳng /admin; ứng dụng chuyển / nên
driver sửa sang vào /admin/users chủ động. Không nới timeout để giấu lỗi. Lượt
ảnh kế tiếp cho thấy tiêu đề bị nhạt trên nền trắng khi hệ thống dark; đã sửa
scope CSS và kiểm lại Chrome. Prisma diff phát hiện tên index/onUpdate metadata
khác SQL; sửa schema declaration, không sửa migration đã merge.

## Tái lập và bàn giao

1. Dùng QA riêng loopback5549, database tên chính xác
   `bckl_order_resolution_test_attributes_20261019_v949`. Demo phải dừng; không
   load `.env`. Không reset DB dùng chung. Fixture chỉ tạo dữ liệu synthetic,
   giữ lại các hàng đã có audit append-only.
2. Deploy migration25 bằng migrator trước, triển khai Backend mới cho mọi
   replica rồi mới bật Web `VITE_ADMIN_ACCOUNT_STATUS_ENABLED=true`.
3. Fixture portable: `BE/scripts/account-status-qa.mjs`, đọc hướng dẫn hardening
   hiện có; script chặn sai host/port/name và không ghi đè credential cũ.
   Không đưa mật khẩu/profile QA lên Git hoặc PR.
4. Driver `scripts/test-account-status-browser.mjs` yêu cầu QA application-role
   URL và Playwright path được cấp qua environment đã kiểm; không tự tìm secret
   hay `.env`. Chạy có chốt launcher local, không song song full E2E trên cùng DB.
5. Chrome artifacts local: `artifacts/account-status-browser-20261025/r*/` gồm
   summary/hash và20 ảnh. Log suite local ở `deliverables/accounts-recovery-*`.
   Không commit log, cookie, profile hoặc ảnh chứa dữ liệu tài khoản thật.

## Giới hạn nghiệm thu

Mặc định Web chỉ đọc; cần bật cờ trên môi trường QA sau migration/Backend để
demo dialog. Legacy PATCH3fields không được closure fence bởi client không gửi
UUID. Chưa chứng minh multi-replica crash/physical network fault/live AI index
propagation. 20 TODO,1 Backend SKIP và6 FE live SKIP vẫn giữ nguyên, không tính
là PASS. Không nhận toàn Accounts/Admin hoặc toàn dự án DONE từ lát cắt này.
