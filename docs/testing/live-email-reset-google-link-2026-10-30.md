# Email reset và Google LINK thật — 30/10/2026

**PASS trong phạm vi QA local**, được owner thao tác trên PC và đối chiếu DB độc lập. Không mở HTTPS staging, không gọi thanh toán hay gửi mail nghiệp vụ trong lượt này.

## Môi trường và giới hạn dữ liệu

Source nền PR138 `6ea22d74e5088472cc4d270dac799b50c8210da0` cộng Seller WIP đang kiểm; code Auth không sửa trong lượt provider này. DB riêng `bckl_order_resolution_test_provider_20261030`,40 migrations, app-role DML. QA Web localhost5206/API3001 được dùng tạm để khớp callback Google đã đăng ký. Không dùng DB demo.

Một tài khoản USER đã verify email ở lượt trước; chỉ gửi đúng một mail RESET_PASSWORD tới OWNER_EMAIL_TEST được owner chỉ định. API key/client secret/password/token/profile và địa chỉ người nhận chỉ ở machine-local ngoài Git; không đính kèm vào báo cáo hoặc prompt review.

## Kết quả thực thi

| Ca | Bằng chứng và kết quả |
|---|---|
| Reset mail thật | App request202 → Resend200 → owner xác nhận nhận thư và hoàn tất form Web |
| Token reset | Một token, dùng lúc `2026-10-30T09:20:55.617Z`, trong hạn; credential version1→2; PASSWORD_RESET audit đúng1→2 |
| Thu hồi credential | Mật khẩu cũ401; access token trước reset401; refresh token trước reset401; toàn bộ refresh baseline đã revoke |
| Token dùng lại | Gửi lại token đã dùng trả400, credential version không tăng thêm, không ghi nghiệp vụ mới |
| LINK Google thật | Owner đăng nhập QA bằng mật khẩu mới, reauthenticate/consent rồi chọn Google trên trang provider; LINK challenge hoàn tất, GOOGLE_LINKED audit2→3 |
| Sau LINK | Một User, một Google identity đúng User; refresh trước LINK revoke; email, verifiedAt và role USER giữ nguyên |
| LOGIN sau LINK | Owner xác nhận đăng nhập lại bằng Google thành công; có LOGIN challenge completed sau LINK |
| Data isolation | Orders0, Payments0, StockMovements0; không chạm data demo, không tạo Seller/Admin |

Tại thời điểm proof cuối, credential version của QA này là3. Lượt verify email trước đó ghi version1 là snapshot lịch sử đúng lúc chạy; không chạy lại helper verify cũ đòi CV1 để suy kết quả hiện tại bị sai.

## Artifact và tái kiểm

Từ root máy `C:/Vo Minh Hoang/BCKL_2026/`:

- `machine-local/final-day-20261030/providers/database-proof.json`: đối chiếu DB độc lập, không subject/token/password.
- `accepted-report.json`: kết quả API/provider, DB và xác nhận owner.
- `user-confirmation.json`: owner xác nhận inbox/Web reset và LINK/LOGIN.
- Helper `verify-final-providers-20261030.mjs` chỉ đọc và kiểm DB; helper start có side effect gửi mail và guard chống gửi lại, **không chạy lại để đọc tiến độ**.

Server QA provider đã được dừng sau nghiệm thu; DB và bằng chứng giữ nguyên. Cổng3001 được trả cho rollout demo sau backup/migrations.

## Chưa được kết luận từ lượt này

- Không nghiệm thu HTTPS/cookie/trusted proxy hoặc mở link trên điện thoại/máy khác: localhost trỏ về từng thiết bị.
- Không nghiệm thu Resend domain/sender production hay gửi mọi người nhận; dùng sender thử đã cấu hình và recipient được duyệt.
- Không nghiệm thu email thông báo nghiệp vụ thật, toàn bộ live collision/hai Google account/đổi chủ identity hoặc mọi lỗi callback. Các ca synthetic/session của suite Auth giữ bằng chứng riêng.
- Không chứng nhận ASVS/pentest, không nhận toàn ACCOUNT gate hoặc dự án production-ready chỉ nhờ hai ca này.
