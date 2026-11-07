# Auth session admission — 29/10/2026

Phạm vi: sửa các lỗi đã tái hiện trong audit tại source `fbaf636`: login CSRF,
mật khẩu Unicode vượt giới hạn bcrypt và thiếu giới hạn thử đăng nhập. Bản vá
đi từ `develop a88a11d`; không chứa PR #133 và không thay Google/payment callback.
Chỉ coi tích hợp sau review/merge, không tuyên bố production đã an toàn.

## Ranh giới HTTP

POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` kiểm trước
body parser: Origin nếu có phải bằng đúng `FRONTEND_URL`; từ chối `null`, nguồn
khác và browser có Sec-Fetch nhưng thiếu Origin. Không suy Origin từ Host hoặc
Forwarded. Origin được cấu hình hợp lệ vẫn được chấp nhận khi Sec-Fetch-Site
là cross-site; cookie deployment giữa hai site cần nghiệm thu riêng.

Client native/server không có Origin và không có Sec-Fetch vẫn được dùng API.
Đây không phải cơ chế xác thực client: login vẫn cần mật khẩu, refresh/logout
vẫn cần cookie hợp lệ. Không dùng CORS làm cơ chế chống CSRF duy nhất.

Register/login chỉ nhận JSON; refresh/logout cho body rỗng không Content-Type
hoặc JSON. Không query, không compressed body. JSON strict tối đa8KiB; lỗi400,
quá lớn413, Origin sai403 `AUTH_ORIGIN_REJECTED`. Từ chối trước ghi session và
không phát/xóa cookie trong phản hồi bị chặn. Cache-Control no-store.

## Mật khẩu và dữ liệu cũ

Register/mật khẩu mới cần ít nhất8 codepoints, tối đa72byte UTF-8. Login và
currentPassword cũng tối đa72byte; không NUL hoặc surrogate không hợp lệ.
Không trim, normalize, pre-hash hoặc cắt đuôi. Dùng chung helper ở DTO và các
service/input quan trọng, gồm đổi mật khẩu, reset và Google LINK.

Hash cũ không bị thay đổi. Một password cũ vượt72byte sẽ không được login mới
bằng cách âm thầm coi phần prefix là mật khẩu. Cần recovery/đổi mật khẩu qua
bằng chứng hợp lệ; production chỉ rollout sau khi email recovery và kế hoạch
hỗ trợ tài khoản legacy được xác minh. Không sửa password trực tiếp trong DB
để vượt kiểm tra và không gọi đây là migration mật khẩu đã hoàn tất.

Login dùng synthetic bcrypt cost12 cho email không tồn tại để bỏ nhánh trả
về ngay. Đây không phải cam kết constant-time dưới mọi tải.

## Admission dùng chung PostgreSQL

Migration mới `20261029080000_auth_session_abuse_limits` tạo bảng riêng. Không
sửa migration cũ hoặc model nghiệp vụ. Quota fixed-window60giây mặc định:

|Phạm vi|Giới hạn|
|---|---:|
|Login theo socket IP|60/phút|
|Login theo email chuẩn hóa|10/phút|
|Register theo socket IP|10/phút|
|Refresh theo socket IP|120/phút|

Các biến cấu hình xem `.env.example`; giá trị nguyên1..10000. Tất cả attempt
được chấp nhận qua admission đều tính, kể cả password sai hoặc email chưa có.
Quota theo account chia sẻ qua instance/IP; không khóa User hoặc đổi CV vì bị
người khác spam. Bucket hết hạn được đặt lại theo DB clock. Fixed window có
thể có burst ở ranh giới hai cửa sổ; đây không phải sliding-window limiter.

UPSERT có điều kiện và thứ tự khóa IP trước, account sau bảo vệ cạnh tranh.
IP hết quota thì không tính thêm vào account. Nếu account từ chối, attempt IP
đã chấp nhận vẫn commit; không dùng account đã bị chặn để né quota IP.
429 `AUTH_RATE_LIMITED`, Retry-After1..60; lỗi DB/missing migration503 fail-closed,
không fallback sang login không giới hạn. Lock/statement/transaction có timeout.

Logout không bị quota dùng chung chặn thu hồi phiên; vẫn phải qua HTTP Origin
và parser policy. Chống tải mạng cho logout cần reverse proxy ở deployment.

Không lưu raw IP/email/password: HMAC-SHA256 với JWT access secret có domain
separation theo scope. Xoay secret cũng đổi rate identity, cần tính trong rollout.
Cleanup dùng SKIP LOCKED, có giới hạn100 row/lần, giữ row hết hạn khoảng một ngày khi còn
traffic; không phải cron retention hoặc cam kết xóa đúng giờ khi hệ thống idle.

Không tin X-Forwarded-For. Sau reverse proxy, socket IP có thể là proxy chung,
do đó cần chốt topology, quota và trusted-proxy policy trước khi scale public;
không bật `trust proxy=true` tùy tiện để né quota.

## Triển khai và QA

Apply migration bằng migrator; cấp DML bảng mới cho app-role; build/start sau
đó. Không cấp CREATEDB cho runtime. Thiếu bảng mới sẽ trả503, không bỏ qua guard.
Rollback code có thể giữ bảng additive; không drop dữ liệu hoặc sửa migration.

`auth-session-hardening.e2e-spec.ts` kiểm HTTP/PG hai app và app-role không có
superuser/CREATEDB/CREATEROLE. Suite kiểm chức năng dùng quota test cao vì nhiều
actor giả cùng socket; suite Auth riêng kiểm quota thấp và default10. Không tắt
admission để lấy test xanh.

QA exact-target mới không nới host/port. Guard chung cũng từ chối hai database
Demo/Catalog phục hồi vốn có tiền tố giống QA. D07 dùng provisioner riêng qua
`QA_DATABASE_PROVISIONER_URL` ngoài Git, chỉ cho đúng host/port/database/role QA;
runtime/migrator không được nâng CREATEDB. Database con giữ lại để truy vết.

Đăng xuất thu hồi refresh; access token còn TTL là policy hiện có, không tự
đổi thành denylist trong bản vá này. Các gate online còn lại nằm ở runbook staging.
