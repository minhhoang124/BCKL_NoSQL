# Hồ sơ và đổi mật khẩu — runtime PR, 23/10/2026

IN_PROGRESS trên `codex/account-settings`, từ develop `a91db91`. Chưa merge,
chưa bật trên develop, chưa hoàn thiện toàn bộ FR-ACC-03. Đối chiếu SRS
FR-ACC-04 (đổi mật khẩu chủ động) và FR-ACC-03 (hồ sơ).

## Endpoint và quyền

JWT Bearer của chính tài khoản active; USER/SELLER/ADMIN đều dùng được. Actor lấy
từ JWT đã đối chiếu DB, không nhận userId/email/role/isActive trong body.
`ACCOUNT_SETTINGS_WRITE_ENABLED=true` mới cho ghi; mặc định false trả503.
Mọi phản hồi `/auth/*` được đặt `Cache-Control:no-store`, kể cả lỗi parser/guard.
Hai write route không nhận query; JSON sau giải nén tối đa8KiB, không trường dư.
Swagger có schema body, không đưa mật khẩu mẫu thật vào docs.

### PATCH /auth/profile

```json
{"fullName":"Nguyễn Văn A","expectedFullName":"Tên trước khi sửa"}
```

Nếu tên cũ là null thì gửi JSON null. `expectedFullName` giữ nguyên dữ liệu đã
đọc, dùng CAS (chỉ ghi khi dữ liệu cũ còn đúng), không phải trường để cập nhật.
Tên mới NFC/trim,2–100codepoint, chặn ký tự điều khiển/định dạng vô hình.
Khóa hàng User rồi đọc lại account/phiên bản xác thực/tên hiện hành. Sai tên cũ
trả409, không tự ghi đè. No-op đúng dữ liệu không UPDATE/đổi updatedAt.
Response200 là PublicUser cùng shape `/auth/me`: id/email/fullName/role/isActive/
createdAt, không passwordHash, credentialVersion, token hoặc dữ liệu Store.

Đợt này chỉ tên hiển thị. Không sửa email/số điện thoại đã xác thực, avatar,
quyền hoặc Store. Sổ địa chỉ cũ không đổi; Order giữ snapshot cũ, không sửa theo tên.

### POST /auth/password

Body có đúng `currentPassword` và `newPassword`, đều là string. UI còn bắt nhập
lại mật khẩu mới; confirm là kiểm tra phía UI, Backend kiểm mật khẩu hiện tại.
Không trim/normalize password. Mới ít nhất8codepoint, tối đa72byte UTF-8, không
NUL và không bằng mật khẩu cũ theo bcrypt. Mật khẩu hiện tại tối đa512byte để
không khóa người dùng legacy từng đăng ký chuỗi nhiều byte; không dùng giới hạn
ký tự để giả rằng bcrypt không có giới hạn byte.

Luồng: kiểm mật khẩu hiện tại → hash mới ngoài transaction → khóa User trong
DB → đọc lại hash/credentialVersion/isActive → cập nhật hash+tăng phiên bản1
→ revoke toàn bộ refresh token → ghi1AccountSecurityEvent → commit. Hai bên
đổi cùng lúc chỉ1bên hợp lệ; version không wrap. Audit/revoke lỗi hoàn tác cả hash,
phiên bản và các hàng khác. Audit chỉ gồm User/event/fromVersion/toVersion/thời
gian; không password/hash/token/IP/user-agent. DB chặn sửa/xóa audit và trùng
(userId,toVersion). Không tạo Search reconciliation/outbox.

```json
{"status":"PASSWORD_CHANGED","reauthenticationRequired":true}
```

HTTP200, không cấp session mới. Không Set-Cookie xóa cookie ở response này để
tránh response cũ xóa cookie của lần đăng nhập mới trên cùng trình duyệt. Cookie
cũ vẫn tồn tại tạm nhưng bị revoke ở DB, không refresh được; đăng nhập mới sẽ
thay cookie. UI xóa đúng phiên memory sau khi route Login đã commit, không xóa
Order journal hoặc dùng logout HTTP với cookie của tài khoản mới.

## Chính sách phiên, cạnh tranh và tương thích

- `credentialVersion`: số phiên bản xác thực bền vững trong User, mặc định1.
- JWT claim `cv`: phiên bản lúc phát token. Guard so với DB cho mọi request mới.
- Token legacy thiếu cv chỉ dùng khi DB vẫn version1. Sau đổi đầu tiên version2,
  cả token legacy lẫn cv1 đều bị từ chối ngay ở guard, không đợi access TTL.
- Login kiểm hash rồi createSession đọc lại hash dưới cùng User lock. Login đã
  xác minh hash cũ không thể lấy cv mới nếu password change commit trước.
- Refresh khóa User trước token rotation; đổi mật khẩu và refresh cùng lúc
  không để lại refresh/access token phiên bản cũ dùng được sau commit.
- Các request đã vượt guard/đang thực thi trước khi đổi mật khẩu có thể hoàn tất.
  Không hứa thu hồi giao dịch đã chạy hay thay cơ chế idempotency của Order.
- Lock timeout2s; transaction maxWait3s/timeout7s. Lỗi không dự kiến trả503 đã
  lọc chi tiết. Không retry mutation tự động, không hứa mọi503 là rollback proof.
- Quota mỗi instance:5password/phút/actor,20profile/phút/actor, tối đa10.000bucket;
  429 có Retry-After. Chưa phải quota nhiều replica/cluster.

## Giao diện và lỗi

`VITE_ACCOUNT_SETTINGS_ENABLED=true` mới mount form tại `/account`; mặc định
tắt. Tên cập nhật Auth state nhưng không tăng số phiên client, không reset
pending Order. Form có latch đồng bộ chống submit hai lần, khóa hai form khi
đang xử lý; đổi tài khoản/unmount không cho response cũ cập nhật phiên mới.
Password chỉ trong memory, không local/sessionStorage hoặc log/URL.

-400: giữ draft, sửa dữ liệu/mật khẩu rồi người dùng gửi lại chủ động.
-409 profile: giữ draft và khóa ghi, yêu cầu đối chiếu/đăng nhập lại.
-401: về Login và kết thúc đúng phiên cũ, không refresh/replay write.
-429: không tự chạy lại dù có Retry-After.
-Timeout/5xx/malformed200/mất phản hồi password: xóa dữ liệu password tại UI,
  tới Login với nhãn chưa rõ kết quả. Không tự cấp key/retry/password reset;
  thử đăng nhập bằng password mới hoặc cũ tùy kết quả thực tế.
-Unknown profile: giữ draft và khóa ghi, không tự nhận thành công hoặc replay.

## Rollout bắt buộc

1. Review hai migration mới `20261023100000_account_credential_version` và
   `20261023110000_account_security_events`; không sửa migration cũ.
2. Backup/triển khai migration additive **trước code Auth mới**. Flag false không
   giúp code mới đọc được DB chưa có cột; không triển khai sai thứ tự.
3. Nâng cấp TẤT CẢ Auth replicas, kiểm token cv/legacy và quota. Chỉ sau đó bật
   password write/FE flag. Replica cũ không kiểm cv sẽ phá bảo đảm thu hồi.
4. Tắt flag chỉ chặn ghi mới, không reset version/xóa audit. Không rollback về
   Auth binary không hiểu cv sau khi đã đổi password; giữ Auth guard mới.
5. Không áp migration dùng chung hoặc demo từ lượt QA. Onboarding/membership
   #106 là task khác; merge sau phải giữ credentialVersion, không suy Seller legacy.

Chưa có quên mật khẩu/verify email/Google/OTP hay session management UI. Chưa
có API xem audit Admin. [Bằng chứng và giới hạn](../testing/account-settings-2026-10-23.md).
