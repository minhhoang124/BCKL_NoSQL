# Email/reset — QA local 27/10/2026

Nhánh từ `59bba47`. Không claim toàn Auth P1 hoặc gửi thư thật đã hoàn thành.
[Contract và rollout](../api/auth-email-recovery.md).

## Kết quả

### Bổ sung cuối buổi sáng 27/10

- Mailpit local **1.32.0** chạy loopback8025, không expose SMTP hoặc bật relay.
  Adapter thật POST qua HTTP, harness không override provider khi `--mailpit`;
  kiểm recipient chính xác trước lấy link từ inbox và không đưa token vào ảnh/log.
  Web và thư có nhãn QA LOCAL. Chưa gửi tới Gmail/Resend thật.
  Chrome bản cuối **10 nhóm PASS**, artifact
  `artifacts/auth-email-mailpit-browser-20261027/r1793068239040/report.json`;
  kiểm hộp thư thật, recipient, token fragment/consent, reset mất phản hồi,
  phiên cũ, đổi account, desktop/mobile light; hash lõi tài chính không đổi.
- Mailpit adapter bổ sung10 ca kiểm cấu hình/biên an toàn; Backend unit mốc
  sau bổ sung **1589 PASS**. Provider bị chặn ở production, DB demo5432,
  sai role/tên DB, sai Web/mailbox origin hoặc thiếu opt-in.
- Theo SRS AC-ACC-02, chặn Checkout mới và OWNER submit/resubmit khi bật email
  nhưng User chưa verified; đọc/đối chiếu/receipt cũ và Admin review vẫn dùng
  quyền hiện hành. Bốn ca HTTP mới kiểm rollback, xác minh rồi gửi, replay
  không trừ kho lại, đóng mã và resubmit. Bộ chọn Auth/Checkout/Store **78 PASS**.
- Full E2E mới **1042 PASS / 1 SKIP / 20 TODO**, 63 files PASS/2 SKIP,
  **388.35s**. Log `deliverables/auth-mailpit-full-backend-r3-20261027.log` ở
  workspace QA, không commit log/raw mailbox. Lượt r1 lỗi setup Order: helper
  cho migration20s nhưng hook15s; chỉ nâng hook khởi tạo lên30s. Lượt r2 lỗi
  Search `reconcileAll`15s vì quét DB QA giữ fixture nhiều lượt và có thể tác
  động fixture suite khác. Chuyển cả suite quét toàn DB sang child DB mới dùng
  helper được bảo vệ sẵn; không reset/drop DB chung hoặc nới timeout test.
  Search riêng **48 PASS**; r3 full PASS. Các log fail được giữ để đối chiếu.
- Full FE mới **1592 PASS / 6 live SKIP**, 94 files PASS/1 SKIP,216.01s.
  Kiểm lại30 ca UI Checkout/Store sau góp ý P3 PASS; lỗi xác minh mới hiện link
  Tài khoản, không gắn link vào mọi lỗi. TypeScript/build và lint đạt; giữ rõ
  warning nền/ref cleanup và bundle>500KB, không gọi là không còn warning.
- Gemini Argon Medium review delta Mailpit và gate/test isolation: **NONE P1/P2**;
  kiểm nhận xét P3 bằng code/test. Google design được review riêng, chưa phải
  runtime: [chuẩn bị OAuth](google-oauth-setup-preparation.md).

Các số liệu bên dưới là checkpoint trước delta Mailpit/gate, giữ để truy vết.

- Backend unit: **1579 PASS**, 71 files; 38 tests mới gồm parser, provider
  envelope/origin, guard/capped IP quota và không log secret.
- HTTP/PostgreSQL **13 PASS** bằng app-role (không superuser/CREATEDB/CREATEROLE),
  fixture synthetic v959: unknown/inactive response giống nhau, owner verify,
  exact consent/JWT, reset/revoke/access invalidation/audit, concurrent consume,
  sibling link, purpose/expiry/CV/active, recipient quota, rollback sau consume,
  HTTP boundaries và SQL payload/terminal immutability.
- Full Backend E2E cuối: **1038 PASS / 1 SKIP / 20 TODO**, 63 files PASS/2 SKIP,
  364.80giây. Full suite dùng migrator cho D07 child databases, không gọi toàn
  bộ suite là app-role. Lượt đầu 1037PASS/1FAIL do role test áp nhầm kỳ vọng
  app-role cho full runner migrator; đã giữ test role ở suite riêng với flag
  exact scope và chạy lại full. Không nới DB target hoặc quyền app-role.
- Fresh31 migrations PASS v959; upgrade30→31 PASS v960, checksum30 migration
  cũ và User/Store/StoreStatusHistory legacy giữ nguyên, chỉ thêm nullable
  `emailVerifiedAt` (tất cả legacy null), token/rate tables rỗng. Digest
  trước/sau `9cd79a25a039b1904ca2b9624ce43e867d50189b7f847447016e17cd887a837d`.
- Prisma schema diff **0**. Typecheck/build/lint Backend PASS,0warning sau
  sửa fixture seed thiếu trường và kiểu actor/env trong test.
- Web focused **18 PASS**; full FE **1589 PASS / 6 live SKIP**, 93 files PASS/
  1 SKIP,199.76giây; TypeScript/Vite build/lint PASS, warnings nền/ref cleanup
  và bundle>500KB. Guest bootstrap/StrictMode, token fragment, duplicate/extra
  fields, epoch, consent/double-click, no storage/replay, password matching
  và previous-account status được kiểm.
- Chrome thật **9 nhóm PASS**, artifact
  `artifacts/auth-email-browser-20261027/r1793038858891/report.json`; 4 ảnh
  desktop/mobile light. Own verification request → memory mail → guest link
  → explicit confirm → owner status; forgot → reset → abort phản hồi sau
  upstream200 → form khóa/password xóa → reload không POST; session cũ bị thu
  hồi, đăng nhập password mới được; đổi account không giữ email/verified cũ.
  Hash các bảng Order/Payment/Refund/Revenue/Stock/Search không đổi.
- Gemini Argon Medium: thiết kế, Backend source và Web source độc lập; source
  cuối chưa có finding P1/P2. Nhận xét thiết kế đã đối chiếu thực tế: CV sẵn có
  làm token cũ vô hiệu; không áp giả định thiếu CV vào code. Đây là review AI,
  không phải approval của thành viên hoặc bằng chứng Gemini đã chạy test.

## Giới hạn và bước còn thiếu

**Harness ban đầu inject bộ nhớ; bản `--mailpit` đã dùng adapter HTTP thật tới
inbox local.** Không có endpoint
debug lấy token, không ghi raw token/password vào artifact hoặc log; không
gửi mail ra ngoài. Chưa có Resend credentials/domain/inbox QA, nên chưa chứng
minh email thật đến nơi. Không gọi mock adapter là sandbox provider chính thức.
Cần cấu hình riêng, gửi và nhận thật, xác minh/đặt lại qua inbox trước nghiệm thu.

Đã cưỡng chế verified cho hai luồng D01 Checkout/onboarding nêu trên khi cờ
bật; không tự đánh dấu legacy verified hoặc đổi SRS. Google OAuth và phone OTP sandbox còn riêng. Rate guard dùng
socket IP nên cần cấu hình triển khai proxy phù hợp. Mail best effort có thể
mất khi restart; durable encrypted outbox/retention chưa làm. Chrome light
chưa thay dark/production QA; abort có kiểm soát không thay lỗi mạng vật lý.
Token request/confirm mặc định tắt, không bật trực tiếp trên demo.

Chạy bằng script `scripts/test-auth-email-browser.mjs`: Backend build trước,
Chrome/Playwright có sẵn, đúng app-role loopback5549/v959,31 migrations, không
dotenv checkout. Full E2E và Chrome chạy lần lượt để không biến đổi cùng DB
trong lúc đối chiếu hash. Không reset/drop/migrate database demo; giữ fixture
QA. `BE/scripts/test-auth-email-upgrade.mjs` chỉ nhận DB QA mới v960 chưa có schema;
không chạy lại để ghi đè DB đã tạo.
