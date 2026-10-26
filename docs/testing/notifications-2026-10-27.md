# Thông báo trong ứng dụng — kiểm thử 27/10/2026

Nhánh `codex/notifications-runtime` từ `f271318` (#125 Web Review đã merge).
Đây là bằng chứng nhánh, chỉ coi tích hợp sau merge. Contract ở
[notifications-runtime.md](../api/notifications-runtime.md).

## Phạm vi chạy được

Migration mới `20261027000000_notifications` (thứ 30); projector đọc lịch sử
đã commit của Order, Store, Product, Aftersale, Chat và Review. Không thêm lời
gọi thông báo vào giao dịch nghiệp vụ. Dedupe event/recipient/channel; không
dùng checkpoint `MAX(id)` làm mất event có id thấp commit muộn. Payload bất
biến và không sao chép nội dung Chat, lý do nội bộ, địa chỉ hay thông tin tiền.

Inbox `/account/notifications`: lọc, phân trang, số chưa đọc, đánh dấu từng
thông báo hoặc đến mốc đã hiển thị. Không tự đánh dấu khi mở trang/reload;
mất phản hồi chỉ tải GET để đối chiếu, không tự POST lại. Link nội bộ allowlist,
trang đích kiểm quyền riêng. Badge làm mới tối đa mỗi 30 giây; số chưa đọc có
thể chậm đến kỳ poll kế tiếp sau thao tác trong inbox.

Các cờ `NOTIFICATIONS_ENABLED`, `NOTIFICATIONS_WORKER_ENABLED` và
`VITE_NOTIFICATIONS_ENABLED` mặc định `false`. Bật Backend và Web để QA;
worker là tùy chọn riêng, QA giữ tắt. Cần chạy migration trước bật Backend.
GET inbox tự chiếu tối đa 100 tuple mỗi nguồn, `syncPending` khi còn backlog
hoặc chiếu lỗi; worker 15 giây có thể tiếp tục backlog cũ khi được bật.

## Kết quả đã xác minh

- Backend unit: **1541 PASS**, gồm 31 parser/bounds/audience tests mới.
- HTTP/PostgreSQL app-role: **22 PASS**, gồm late source commit, rollback,
  hai projector dedupe, khóa recipient trước cấp id, read-all watermark,
  role demotion/credential freshness, privacy và source error không rollback
  nghiệp vụ; thêm luồng Store application, Review và refund mô phỏng qua API.
- Full Backend E2E: **1025 PASS / 1 SKIP / 20 TODO**, 62 files PASS/2 SKIP,
  352.03 giây. TODO/SKIP không tính là đã kiểm xong.
- Fresh DB: **30 migrations PASS** trên QA v957.
- Upgrade 29→30: **PASS** trên v958, giữ User/Store/StoreStatusHistory legacy
  và checksum 29 migrations cũ, bảng thông báo ban đầu rỗng. Digest trước/sau
  `036467df016637c19676c754023b6e4ef9de62ecf1651172795ac6ac92d20e15`.
  Đây là fixture upgrade có giới hạn, không chứng minh toàn bộ dữ liệu demo.
- Prisma schema diff: **0** trên v957.
- Web tập trung: **35 PASS** (26 client/parser, 9 UI/session).
- TypeScript/Vite build: PASS; lint 0 errors, có warnings nền/ref cleanup.
- Chrome thật: **9 nhóm PASS**, report
  `artifacts/notifications-browser-20261027/r1793036522401/report.json`.
  Buyer inbox/badge, phân trang 23 dòng, bấm lặp, abort phản hồi sau upstream
  200 khi đánh dấu tất cả, reload GET-only, unread filter, logout/đổi account,
  Seller Store event, Admin pending và desktop/mobile không tràn ngang.
  Có 4 ảnh chụp light; dữ liệu tài chính/kho/Search không đổi qua phép hash.

- Full FE cuối: **1571 PASS / 6 live SKIP**, 91 files PASS/1 SKIP, 184.81 giây.

Gemini Argon Medium rà thiết kế, Backend source và Web
source độc lập, chưa thấy P1/P2 trong các bản đã rà. Đây là bằng chứng AI,
không phải approval của thành viên nhóm.

## Chạy lại và giới hạn

`scripts/test-notifications-browser.mjs` yêu cầu Chrome/Playwright, Backend
đã build, không có dotenv checkout, đúng QA app-role trên loopback 5549/v957;
không dùng URL/mật khẩu demo. Cấp cấu hình QA riêng ngoài Git, không copy
`.env` chung. Harness kiểm role không superuser/CREATEDB/CREATEROLE, 30 migrations,
hash source trước/sau và dữ liệu nghiệp vụ, giữ fixture synthetic để truy vết.
Không reset/drop database. Bộ E2E đầy đủ dùng migrator cho D07 child databases;
chỉ suite HTTP và Chrome nêu trên được gọi là app-role.

Chrome dùng history Order legacy hợp lệ để tạo backlog, không tuyên bố là
fulfillment hiện đại xuyên suốt. HTTP suite kiểm các API nghiệp vụ thật riêng.
Abort có kiểm soát sau upstream 200 không thay toàn bộ lỗi mạng vật lý. Mới
kiểm light desktop/mobile; chưa nghiệm thu dark. Demo container giữ dừng,
không query/migrate/reset dữ liệu demo.

Email adapter P1, push trình duyệt, retention/archiving và tối ưu lịch sử lớn
chưa làm. Không gọi in-app là đã gửi email; Auth P1 và thanh toán sandbox
vẫn là phần tiếp theo, chưa tính dự án hoàn thành.
