# OTP mô phỏng — bằng chứng QA 27/10/2026

Base `4a35b4a` (#128 Google OAuth đã merge), nhánh `codex/auth-phone-sandbox`.
Phạm vi [contract](../api/auth-phone-otp-sandbox.md): mô phỏng SMS, không xác
minh quyền sở hữu điện thoại thật hay hoàn thành toàn Auth P1/thanh toán.

## Kiểm tra đã chạy

| Hạng mục | Kết quả |
|---|---|
| Parser và cấu hình OTP | 32 unit PASS; strict fields, Unicode/leading zero, DB/production/key/provider gate |
| HTTP/PostgreSQL OTP | 19 PASS, hai app instances; lượt chọn chạy app-role không superuser/CREATEDB/CREATEROLE |
| Backend unit toàn bộ | 1.636 PASS, 74 files |
| Backend E2E toàn bộ | 1.081 PASS / 1 SKIP / 20 TODO, 65 files PASS / 2 SKIP, 392,54 giây |
| Web OTP | 20 PASS: journal/CAS/epoch, consent/latch, reload, timeout/close, lỗi đọc sau khi phát mã |
| Web toàn bộ | 1.619 PASS / 6 live SKIP, 97 files PASS / 1 SKIP, 211,28 giây |
| Build/typecheck/lint | Backend và Web đạt; lint riêng OTP không warning. Warning nền Web và bundle lớn vẫn còn |
| Schema | Fresh 35 migrations trên QA v965, schema diff 0 |
| Upgrade | QA v966: 34→35, giữ checksum 34 migration cũ và digest User/Google identity/refresh token/email token/Order/Payment/stock/Search |
| Review độc lập | Gemini Argon Medium, chỉ đọc snapshot nguồn: NONE P1/P2; không gọi đây là người duyệt GitHub hay QA SMS thật |

HTTP có: hai xác nhận đúng đồng thời, 6 lần đoán sai đồng thời tối đa 5,
quota số nhận bền qua hai app/tài khoản, TTL theo DB, resend thu hồi mã cũ,
đổi số lần hai, receipt cũ không cài lại liên hệ, khóa User/CV/khác chủ,
fault khi ghi contact hoàn tác cả consume, SQL immutability/version/evidence,
HTTP guard thật/no-store/query/body, reconcile–confirm cạnh tranh và đóng mã.

## Chrome thật, SMS mô phỏng

`scripts/test-phone-otp-browser.mjs` chạy Chrome → Nest HTTP → PostgreSQL app-role
trên QA v965, chặn mọi request ngoài origin QA. Năm nhóm đạt:

1. Đồng ý trước khi yêu cầu; một POST; nhãn không gửi SMS.
2. Backend commit xác nhận, chủ động bỏ phản hồi, reload không tự POST;
   sessionStorage chỉ giữ User/challenge, không có số hoặc OTP.
3. Chủ động đối chiếu trả APPLIED, xóa đúng journal; contact vẫn phiên bản 1.
4. Desktop/mobile light, không tràn ngang.
5. User/auth/role và digest các bảng tài chính/Search được chọn không đổi.

Artifact local ở `artifacts/auth-phone-browser-20261027/`; không commit ảnh/log
hay dữ liệu QA. Hai lượt đầu bài kiểm tra đọc journal trước khi reconcile trả
về do dòng liên hệ đã có từ GET reload. Đã sửa điểm đợi receipt và chuyển UI,
giữ nguyên assert không ghi trùng; lỗi harness không bị báo thành lỗi Backend.

Lỗi thật tìm trong lượt HTTP đầu: Prisma upsert chạy BEFORE INSERT dù nhánh
update, làm trigger version ban đầu chặn lần đổi số thứ hai. Đã đổi service
create/update riêng dưới khóa User; không nới trigger. Log lỗi được giữ.

## An toàn và giới hạn

- Demo `bckl_postgres` dừng; chỉ DB riêng loopback 5549. Không đọc/sửa/xóa/khôi phục demo.
- Full suite chỉ thêm đúng v965 vào allowlist đích QA cũ, không nới host/port/role/query/dotenv guard.
- DB chứng cứ giữ lại; không tự truncate/drop để chạy lại. HMAC/key/password tổng hợp không in ra báo cáo.
- Chrome chỉ kiểm light desktop/mobile và một luồng mất phản hồi thật; các ca khác có HTTP/component test, không gọi tất cả là browser QA.
- Chưa nghiệm thu SMS provider thật, OTP đăng nhập/2FA, production hay thanh toán.
- Chỉ coi tích hợp chính thức sau merge; flag mặc định tắt và vẫn cần môi trường QA riêng khi bật mô phỏng.
