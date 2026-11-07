# Google OAuth — QA 27/10/2026

Base `d789afa` (#127), nhánh riêng `codex/auth-google-login`. Không sử dụng
database demo. [Contract/giới hạn](../api/auth-google-oauth.md).

## Kiểm tự động

- **15 unit mới**: config fail-closed, canonical random, chữ ký RSA tổng hợp
  đi qua Google library thật, sai signature/aud/iss/exp/nonce/verified/sub/email,
  phân biệt Gmail/Workspace và mailbox bên thứ ba, URL/scopes/S256. Không mạng.
- **20 HTTP/PostgreSQL PASS** trên v961, app-role không superuser/CREATEROLE:
  create USER, thirdparty unverified, replay/concurrent callbacks, sai proof
  không burn challenge, collision, returning sub đổi email, disabled User,
  LINK/password/consent/live refresh, logout/CV/session switch, provider outage,
  session failure rollback, duplicate query/cancel/open redirect, immutability,
  LOGIN cookie switch và expired challenge. Có app riêng dùng **guard thật**
  kiểm Origin/query/body/no-store/no-referrer, không gọi override là guard QA.
- Full Backend unit **1604 PASS**,72 files,25.80s.
- Full Backend E2E **1062 PASS / 1 SKIP / 20 TODO**,64 files PASS/2 SKIP,
  376.01s. Lượt đầu1057PASS/2FAIL do checkout mới chưa build `dist` cho hai ca
  compiled Attribute CLI. Đã build trước và chạy lại full; không sửa/nới test
  audit. Log fail được giữ trong workspace, không giấu bằng rerun chọn ca xanh.
- Full FE **1599 PASS / 6 live SKIP**,95 files PASS/1 SKIP,190.77s. Bảy ca
  mới: feature gate/bootstrap, explicit one-start latch, no-auto-retry,
  redirect allowlist, session epoch, LINK/password/consent/password clear,
  already-linked status. Kiểm focused/build lại sau chỉnh thông báo lỗi.
- Backend typecheck/build/lint đạt; Web typecheck/build đạt. Web còn warning
  nền/ref cleanup và bundle>500KB; không gọi toàn repo là zero warning.
- Prisma schema diff **0**. Fresh **34 migrations PASS** trên v963. Các đích
  QA trong suite chỉ thêm đúngv961; không nới host/port/role/query/dotenv guard.

## Chrome giả lập và Google thật — tách bằng chứng

Chrome giả lập **5 nhóm PASS**, artifact local
`artifacts/auth-google-browser-20261027/synthetic-1793074794416/report.json`:
signup USER/identity, LINK bằng password+consent và revoke, login lại đúng User
local, email collision không tự ghép, desktop/mobile light. Hash Order/Payment/
stock_movements/search_outbox không đổi. Provider và trang Google được giả lập
chỉ trong harness QA; không gọi đây là nghiệm thu Google thật. Các lỗi harness
ban đầu (CJS import Playwright, đợi redirect mặc định, chọn nhầm ô password trước
khi panel tải xong) đã sửa, không quy thành lỗi provider/nghiệp vụ.

**Google thật:** user đã tạo Web Client trong project của nhóm, giữ secret ngoài
repo và tự đăng nhập từ Chrome qua `localhost:5173/login`. Backend dùng provider
production, không override, callbacklocalhost3001. User xác nhận về trang account
và cung cấp ảnh minh chứng. Kiểm DB read-only ở **v963 riêng**, không chung DB
hồi quy v961: Userid1/roleUSER/CV1/verified=true/linked=true, một identity,
hai LOGIN challenges completed, không Order. Không xuất email/sub/token/secret
vào report kiểm chứng. Artifact local `artifacts/auth-google-live-evidence-20261027.json`.

Đây là nghiệm thu local với một Google identity đã xác nhận, chưa phải kiểm
đủ cả hai Gmail, live LINK/cancel, dark mode hay production rollout. Những ca
đối kháng khác có bằng chứng automated/fake-provider riêng ở trên.

Gemini **Argon Medium** review source độc lập hai lượt, không còn P1/P2 trong
phạm vi rà. P3 đầu: bổ sung guard thật và sửa loading-error. P3 cuối: rate/proxy
đã ghi giới hạn; thông báo sai mật khẩu/phiên và already-linked đã phân biệt.
Không gọi AI review là human approval hoặc Gemini tự chạy test.

## Chạy QA

Build Backend trước. `scripts/test-google-oauth-browser.mjs` nhận DATABASE_URL
app-role riêng đã migrate, không dotenv, QA5549 và exact v961; `--live` chỉ v963,
provider thật và cấu hình riêng từ tiến trình cha, chờ người dùng đăng nhập.
Không hardcode secret vào script, không reset/drop DB; worker nghiệp vụ tắt.
Playwright/Chrome chỉ cần cho chế độ synthetic. Live mode không điều khiển hoặc
thu mật khẩu Google của người dùng. Flags nguồn mặc địnhfalse.
