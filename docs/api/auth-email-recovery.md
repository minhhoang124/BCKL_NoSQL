# Auth P1 — email verification và password recovery

Nhánh `codex/auth-email-recovery` từ `59bba47` (#126 notifications). Đây là
lát cắt email/reset; Google OAuth, phone OTP và thanh toán sandbox vẫn riêng.
Không sửa phạm vi P1 của SRS. Chỉ coi tích hợp sau merge, và **chưa nghiệm thu
gửi email thật** khi chưa có provider/inbox QA. Không tự đánh dấu legacy email
đã được xác minh.

## Luồng và API

- `GET /auth/email/status`, JWT hiện hành: `{email,verifiedAt}` của chính actor.
- `POST /auth/email/request`, JWT, `{confirmed:true}`: chỉ email lấy từ User
  hiện hành, không nhận userId/email đích từ client.
- `POST /auth/email/confirm`, `{token,confirmed:true}`: token xác minh email,
  không tự đăng nhập/đổi role; trả `{status:"EMAIL_VERIFIED"}`.
- `POST /auth/password-reset/request`, `{email}`: anonymous, trả cùng 202
  `{status:"REQUEST_ACCEPTED",message}` cho unknown/inactive/đã đạt quota.
- `POST /auth/password-reset/confirm`, `{token,newPassword,confirmed:true}`:
  trả `{status:"PASSWORD_RESET",reauthenticationRequired:true}` sau commit.

POST chỉ JSON tối đa8KiB, không query/extra fields. Tất cả Auth no-store trước
guard; status không nhận query/body. Các lỗi không trả token/email tồn tại,
passwordHash, provider response hoặc dữ liệu tài khoản khác.

Đổi mật khẩu khi đã đăng nhập (`POST /auth/password`) vẫn bắt buộc
`currentPassword`; password reset dùng bằng chứng kiểm soát email qua token,
không giả làm đổi mật khẩu không cần xác minh. Mật khẩu không trim/normalize,
ít nhất8 codepoints, tối đa72byte UTF-8 và không NUL; không dùng lại hash cũ.

## Token, giao dịch và giới hạn thử

Token ngẫu nhiên256bit; DB chỉ SHA-256 digest, purpose, User/email/CV snapshot,
expiry15phút theo DB clock và trạng thái terminal. Payload/identity bất biến.
Có thể có vài link chưa hết hạn cùng tồn tại trong quota: một yêu cầu anonymous
mới không làm chết link trước của chủ tài khoản. Thành công đóng các link cùng
purpose; reset đóng toàn bộ challenge còn mở và thu hồi toàn bộ refresh tokens.

Preflight xác minh active/current email/CV/purpose/expiry/unused trước bcrypt.
Bcrypt chạy ngoài transaction. Transaction khóa User → token, đối chiếu lại
toàn bộ bằng DB clock, consume token, đổi passwordHash, tăng CV, revoke refresh
và ghi security event `PASSWORD_RESET` cùng commit. Không Set-Cookie hoặc
auto-login. Hai consume cạnh tranh chỉ một thành công. CV đổi do password/
status/Seller grant làm token cũ vô hiệu ngay cả khi row chưa gắn revokedAt.

Guard10request/IP/phút, capped10000bucket/process; không tin Forwarded header.
DB HMAC rate keys riêng IP20/recipient3 mỗi15phút, áp dụng cả unknown account;
khóa bucket theo thứ tự, không khóa account do yêu cầu quên mật khẩu. Response
floor350–400ms giảm khác biệt nhỏ; không tuyên bố constant-time dưới mọi tải.
Triển khai sau reverse proxy cần thiết kế trust proxy/rate limit phù hợp, vì
hiện dùng socket remoteAddress; không bật tin header client tùy ý.

## Mail adapter và cấu hình riêng

`AUTH_EMAIL_ENABLED=false`, `VITE_AUTH_EMAIL_ENABLED=false` mặc định.
Provider đầu tiên `AUTH_EMAIL_PROVIDER=resend`, endpoint cố định HTTPS,
timeout5s, không redirect; sender và link origin được validate. HTTPS bắt buộc,
chỉ loopback HTTP ngoài production. API key/HMAC secret (tối thiểu32byte) và
sender/domain đã xác minh phải được cấu hình riêng ngoài Git:
`AUTH_EMAIL_API_KEY`, `AUTH_EMAIL_HMAC_SECRET`, `AUTH_EMAIL_FROM`,
`AUTH_EMAIL_WEB_ORIGIN` (origin duy nhất của Web).

Gửi thư best effort sau commit, không giữ User lock và không chờ provider RTT
trong response request. Không có durable email outbox: restart hoặc provider
outage có thể làm mất dispatch; user yêu cầu lại trong quota. Không tự vô hiệu
link cũ khi chưa rõ thư mới đã đến. Không lưu raw token vào outbox/log. Có
warning mã chung; không log provider body, recipient, token hay IP. Provider
acceptance không đồng nghĩa thư đã đến inbox. Cleanup stale rate keys và
encrypted durable outbox là hardening tiếp theo, không claim đã làm.

Web link `/verify-email#token=...` hoặc `/reset-password#token=...`; fragment
được xóa sau bootstrap, token chỉ trong component memory. Không storage/token
query, không auto POST khi mở thư hoặc reload, có global no-referrer. Mất
phản hồi sau reset: form khóa, xóa password, user kiểm đăng nhập với password
mới; không tự reset lại. Status own session kiểm riêng. Cờ tắt không làm
legacy User tự verified; chưa cưỡng chế verified trên mọi nghiệp vụ nhạy cảm.

### Điều kiện verified theo SRS AC-ACC-02

Khi `AUTH_EMAIL_ENABLED=true`, tạo Checkout mới và chủ Store gửi/nộp lại hồ
sơ (`submit`/`resubmit`) cần `User.emailVerifiedAt` trong PostgreSQL. Kiểm tra
trong transaction đang khóa User, trước mọi ghi nghiệp vụ; không tin JWT hoặc
cờ do client gửi. Thiếu xác minh trả `412 EMAIL_VERIFICATION_REQUIRED` và
không tạo Order/Payment, trừ kho hoặc tạo hồ sơ/audit. Cờ tắt giữ hành vi cũ.

Tra cứu, browsing/profile, sửa hồ sơ Store và Admin duyệt hồ sơ cũ vẫn được
phép theo quyền hiện hành. Biên nhận đã commit được kiểm và trả trước gate;
đối chiếu đóng mã chưa thực hiện không bị gate chặn. Web Checkout chỉ coi
đúng cặp 412/code này là từ chối chưa commit, xóa đúng mã đang chờ và yêu cầu
tải lại/chủ động đặt sau xác minh. Web onboarding giữ mã, hướng dẫn xác minh
và đối chiếu rõ ràng trước yêu cầu mới; không tự nộp lại hồ sơ.

### Hộp thư QA local Mailpit

`AUTH_EMAIL_PROVIDER=mailpit` chỉ chạy ngoài production, với opt-in
`AUTH_EMAIL_LOCAL_SANDBOX_ENABLED=true`, Web loopback HTTP, DB QA loopback
5549, tên `bckl_order_resolution_test_*` và đúng app-role không có quyền tạo
DB. API Mailpit cố định `http://127.0.0.1:8025/api/v1/send`, không redirect,
không gửi Resend key. Thư và Web (`VITE_AUTH_EMAIL_SANDBOX=true`) ghi rõ QA
local. Inbox bắt thư để kiểm bằng Chrome, không chuyển thư tới Gmail thật.
Không dùng chế độ này với demo/production; không công khai cổng hoặc bật relay.

Nguồn tham khảo bảo mật: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
Adapter dựa trên [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email).
[Bằng chứng/giới hạn QA](../testing/auth-email-recovery-2026-10-27.md).
