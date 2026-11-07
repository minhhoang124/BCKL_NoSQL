# OTP điện thoại mô phỏng

## Phạm vi

Auth P1 theo SRS v3: thử yêu cầu mã, hết hạn, giới hạn nhập/gửi lại và đổi số liên hệ mô phỏng của tài khoản hiện tại. Đây là **sandbox không gửi SMS**, không chứng minh quyền sở hữu số điện thoại; không dùng số này để đăng nhập, khôi phục mật khẩu, xác thực hai lớp hay cấp quyền Seller. Không thay đổi số điện thoại giao hàng hoặc liên hệ Store.

Nguồn nghiệp vụ: PostgreSQL. `UserPhoneContact` là liên hệ mô phỏng theo User, không có unique toàn hệ thống trên số điện thoại. Không tự liên kết tài khoản cùng số. Khi triển khai SMS thật cần contract, bằng chứng sở hữu và migration riêng; không tự nâng dữ liệu mô phỏng thành danh tính đã xác minh.

## Bật trong QA

- `AUTH_PHONE_OTP_ENABLED=true`, `AUTH_PHONE_OTP_PROVIDER=sandbox`, `AUTH_PHONE_OTP_HMAC_SECRET` ít nhất 32 byte; khóa riêng không commit.
- Web: `VITE_AUTH_PHONE_OTP_ENABLED=true`. Hai cờ mặc định tắt.
- Backend từ chối production và DB ngoài danh sách QA cục bộ/CI rõ ràng. Không nạp `.env` chứa cấu hình demo khi kiểm thử.
- Migration mới `20261027130000_phone_otp_sandbox`; giữ nguyên migration đã dùng chung.

## API

Mọi endpoint dưới `/auth/phone-otp` yêu cầu JWT và kiểm lại User active/credentialVersion trong DB. `Cache-Control: no-store`; không nhận query, GET body, JSON dư trường hoặc body quá 8 KiB.

| Phương thức | Đường dẫn | Nội dung và kết quả |
|---|---|---|
| GET | `/status` | Liên hệ hiện tại, `version` (0 nếu chưa có), pending còn hiệu lực và `resendAfter`; không trả lại mã OTP. |
| POST | `/request` | `{phoneNumber, expectedVersion, confirmed:true}`. Số E.164 dạng `+` và 8–15 chữ số. Trả challenge UUID, số, thời hạn, thời điểm gửi lại, `channel:SANDBOX`, `demoCode`, `smsSent:false`, `ownershipVerified:false`. |
| POST | `/confirm` | `{challengeId, code, confirmed:true}`. Mã đúng 6 chữ số ASCII, giữ số 0 đầu. Thành công trả biên nhận `APPLIED`. |
| GET | `/receipts/:id` | Đọc biên nhận của chính User; `NOT_APPLIED` chỉ là kết quả đọc, **không chứng minh giao dịch cạnh tranh đã dừng**. |
| POST | `/reconcile` | `{challengeId, confirmed:true}`. Chờ khóa giao dịch: nếu đã dùng trả `APPLIED`; nếu chưa dùng đóng mã vĩnh viễn và trả `CLOSED`. Không đổi số hay gửi OTP. |

Biên nhận APPLIED gồm `challengeId`, `phoneNumber`, `version`, `sandboxConfirmedAt`, `channel`, `ownershipVerified:false`, `isCurrentContact`. Biên nhận cũ vẫn phản ánh lần xử lý cũ; khi `isCurrentContact:false` không cài lại số cũ, phải đọc `/status`.

## Quy tắc an toàn và cạnh tranh

- CSPRNG 6 chữ số, TTL 5 phút theo đồng hồ DB. DB chỉ lưu HMAC gồm challenge/User/số/credentialVersion/mã, không lưu mã thô. Mã QA chỉ xuất hiện trong phản hồi tạo của chính người đăng nhập và bộ nhớ giao diện.
- Tối đa 5 lần nhập sai. Ghi số lần sai trong transaction rồi mới trả lỗi, tránh rollback bộ đếm. Sau dùng/đóng/khóa, challenge bất biến.
- Gửi cách nhau tối thiểu 60 giây; tối đa 3 lần/15 phút theo cả tài khoản và số nhận. Bucket HMAC bền trong DB, khóa theo thứ tự key trước User rồi challenge; có thêm giới hạn IP 20 POST/phút tại mỗi tiến trình, không thay thế bucket DB.
- Gửi mới thu hồi mọi mã pending cũ của User, kể cả cho số khác. `expectedVersion` chặn ghi đè; xác nhận cùng mã đồng thời chỉ thay liên hệ một lần. Receipt và contact được ghi trong cùng giao dịch; lỗi contact rollback cả consume.
- SQL bảo vệ phiên bản, bằng chứng own challenge và dữ liệu đã xử lý. Service dùng create/update riêng dưới khóa User để không kích hoạt sai nhánh BEFORE INSERT khi đổi số lần sau.
- Timeout/lỗi giao dịch trả kết quả chưa xác định (503); Web không tự gửi lại. Chỉ POST reconcile có đồng ý mới đóng mã hoặc xác minh đã xử lý.
- Web giữ journal theo User chỉ gồm version/User/challengeId. Không lưu số, mã, token; kiểm epoch phiên và raw storage CAS trước khi ghi/xóa; reload chỉ GET, không POST tự động.

## Mã lỗi

| HTTP | Ý nghĩa |
|---|---|
| 400 | Input sai, mã sai/hết hạn/đã khóa/đã đóng. |
| 401 | Hết phiên, tài khoản bị khóa hoặc credentialVersion cũ. |
| 404 | Không có challenge thuộc tài khoản khi đọc/đối chiếu. |
| 409 | Phiên bản liên hệ thay đổi hoặc hết miền số phiên bản. |
| 429 | Cooldown hoặc hạn mức; kiểm `Retry-After`. |
| 503 | Sandbox tắt/cấu hình không an toàn hoặc chưa xác định kết quả giao dịch; không retry ghi tự động. |

Không đưa mã, token, khóa HMAC hay số điện thoại thật vào log/báo cáo/ảnh minh chứng. QA dùng dữ liệu tổng hợp.
