# Google OAuth — login và liên kết có xác thực lại

Nhánh `codex/auth-google-login` từ `d789afa` (#127). Chỉ coi tích hợp chính thức
sau merge. Không thay email login/reset, quyền Seller hoặc phạm vi OTP/payment.

## Luồng Web/Backend

1. Người dùng chủ động bấm Google. Web POST JSON `{confirmed:true}` tới
   `/auth/google/start`, Origin phải đúng Web cấu hình. Backend cấp state/nonce
   ngẫu nhiên256bit, cookie proof HttpOnly/SameSite=Lax10phút, trả URL Google.
2. Google authorization-code flow, scopes `openid email profile`, S256 PKCE,
   `prompt=select_account`. Không xin quyền Gmail/Drive hoặc Google offline token.
3. Google GET `/auth/google/callback`. Backend kiểm raw query/duplicate/size,
   state, cookie proof, digest refresh-cookie lúc bắt đầu và expiry theo DB clock.
   Kiểm proof trước claim nguyên tử; hai callback cùng state chỉ một gọi provider.
4. Trao đổi code qua `google-auth-library`, timeout8s/request, không tự retry/
   redirect; verify signature/issuer/audience/expiry bằng thư viện, đối chiếu
   nonce digest riêng. Network nằm ngoài transaction/khóa User.
5. Transaction ngắn khóa User canonical, kiểm active/CV, tạo hoặc đọc identity
   và ghi session/complete challenge cùng commit. Thành công đặt refresh cookie
   theo Auth hiện hành, redirect303 cố định `/account`; Web bootstrap lấy access
   token vào memory. Không đưa token vào URL hoặc localStorage.

Callback thất bại redirect cố định `/login?google=failed`, collision dùng
`google=collision`, link thành công `google=linked`. Không phản chiếu code,
provider error body, email hoặc return URL tùy ý. Callback từ chối không xóa
refresh-cookie của phiên mới hơn. Proof cookie hết hạn tự nhiên; không xóa bằng
phản hồi cũ có thể vô hiệu flow mới. Khởi động flow mới thay proof cũ.

## Quy tắc identity và email

- `GoogleIdentity` unique `(provider,subject)` và unique `userId`; ownership
  bất biến ở DB, chưa có unlink/chuyển identity. Không dùng email làm khóa OAuth.
- Chưa có subject nhưng trùng User.email: từ chối `ACCOUNT_COLLISION_LINK_REQUIRED`,
  hướng dẫn login mật khẩu rồi liên kết rõ ràng. Không auto-merge/auto-login.
- User mới chỉ `USER`, không Store/Seller/Admin, passwordHash từ secret ngẫu
  nhiên không cung cấp cho người dùng. Muốn đặt mật khẩu local dùng recovery
  email đã triển khai; không đổi nullable passwordHash toàn hệ thống.
- Chỉ nhận email_verified=true từ ID token đã verify. Chỉ tự verified email
  của Gmail hoặc Workspace có hd; mailbox bên thứ ba vẫn null, dùng email
  verification của app. Returning subject không tự đổi User.email/fullName/role.

## Liên kết tài khoản đã có

`POST /auth/google/link`, JWT + refresh-cookie hiện hành, JSON chính xác
`{confirmed:true,currentPassword}`. Không trim mật khẩu, giới hạn72byte/không
NUL. So bcrypt ngoài khóa, rồi khóa User → refresh-token, kiểm passwordHash,
CV/active và refresh chưa revoke/chưa hết hạn. Challenge LINK lưu digest phiên
và CV, callback kiểm lại sau trao đổi Google. Logout, reset/password/CV đổi hoặc
đổi refresh-cookie khi đang ở Google đều làm flow cũ thất bại.

LINK thành công: identity + tăng CV + revoke toàn bộ refresh + security event
`GOOGLE_LINKED` + complete challenge trong một transaction. Không tự đổi email,
verifiedAt hoặc role; không tự login. Web xóa ô mật khẩu ngay khi gửi, yêu cầu
đồng ý và hướng dẫn đăng nhập lại. `GET /auth/google/status` JWT trả trạng thái
liên kết của chính User, không trả sub/credential của người khác.

## Migration và rollout

Ba migration mới, không sửa migration đã merge: bảng identity/challenge và
event; explicit SQL non-null/expiry evidence guard; LOGIN browser-session binding.
Legacy LOGIN challenge có sessionHash null được giữ làm evidence, không được
resume; người dùng bắt đầu mới. Trigger chặn sửa ownership/payload, xóa evidence
và mở lại claim/completion đã đóng. Giao dịch kiểm expiry lại trước complete.

`AUTH_GOOGLE_ENABLED=false`, `VITE_AUTH_GOOGLE_ENABLED=false` mặc định. Cấu hình
riêng: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_STATE_SECRET` tối thiểu32byte, `GOOGLE_OAUTH_CALLBACK_URL`,
`GOOGLE_OAUTH_WEB_ORIGIN`. Secret chỉ Backend, không `VITE_*`, không commit.
Production yêu cầu HTTPS; chỉ localhost/127.0.0.1 HTTP ngoài production.
Callback local đã chốt `http://localhost:3001/auth/google/callback`, Web5173.

Rate guard socket IP20/phút, capped10000buckets/process. Chưa dùng quota chia sẻ
giữa instance/trust-proxy; cần thiết kế riêng trước scale qua reverse proxy.
Không tự tin Forwarded/X-Forwarded-For từ client. Challenge retention/cleanup
và unlink/relink có audit là phần mở rộng riêng, chưa triển khai.

Full-page OAuth dùng cơ chế cookie session chuẩn của Auth. Binding phát hiện
phiên khác có sẵn khi callback tới; không tuyên bố giải quyết toàn bộ thứ tự
Set-Cookie của mọi login đồng thời ở nhiều tab trong thời gian response bay về.

[Bằng chứng QA](../testing/google-oauth-2026-10-27.md).
Nguồn chính thức: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[verify ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
