# #59 — Chrome trên bản kết hợp, 20/10/2026

Application source: `9172ba1`, nhận develop `2f78a98`.
Thay đổi sau đó chỉ là guard ba script QA cho phép thêm đúng database riêng
`bckl_pr59_combined_20261020`; không đổi source FE/BE hoặc schema.

## Môi trường

- Chrome headless riêng qua Playwright, không dùng profile người dùng.
- Nest HTTP thật và PostgreSQL17 QA loopback5549; 14 migrations fresh PASS.
- DB mới riêng, không DB demo5432, không dùng lại dataset/QA của thành viên.
- JWT/password sinh trong RAM; không ghi credential vào báo cáo.
- Fixture tổng hợp được giữ trong database QA này để kiểm chứng; không phải
  dữ liệu demo chính thức. App/Vite/browser của các harness đã đóng trong finally.
- Trình duyệt tích hợp lỗi khởi tạo kernel assets; dùng harness Chrome có sẵn.

## Kết quả thực chạy

| Harness | Kết quả | Phạm vi |
| --- | --- | --- |
| test-auth-header-browser.mjs | 4/4 PASS | Desktop/mobile, light/dark; lỗi login, register/login/logout thật, cookie, font/màu/focus/artwork, không tràn ngang |
| test-order-read-browser.mjs | 5/5 PASS | 4 viewport/theme và lỗi mạng/đổi tài khoản; phân trang, filter, snapshot, quyền404, guest redirect |
| test-seller-command-browser.mjs | 6/6 PASS | Hai viewport; confirm→pack→ready, double-submit; mất response/reload/COMMITTED; đóng key chưa chạy; GET lỗi sau ACK; đổi Seller khi response đang bay |

Order read tạo 22 đơn qua Cart/Checkout thật để kiểm phân trang. Baseline nghiệp vụ
trước/sau đọc giữ nguyên: Order/history/command/stock/outbox. Không dùng HTTP mock
cho phản hồi nghiệp vụ thành công; fault injection chỉ abort/giữ request có chủ đích.

Seller chạy với feature flag bật riêng trong tiến trình QA; default ứng dụng vẫn
tắt. Mỗi đơn chuẩn bị có đúng3command và4history; replay mất phản hồi chỉ1command.
Sau prepare/resolver, Product/Variant/stock/SearchOutbox giữ nguyên so baseline.
Store SUSPENDED vẫn xử lý đơn cũ theo rule đã chốt.

Đã mở xem ảnh mobile Login và Buyer Order dark: nội dung đọc được, không tràn
panel ngang; không nhận việc này là khớp tuyệt đối toàn bộ thiết kế Figma.

## Bằng chứng local

`deliverables/pr59-combined-20261020/` ở root repository:

- `auth/results.json`, `auth/report.html` và ảnh.
- `order/results.json`, `order/report.html` và ảnh.
- `seller/results.json` và ảnh.

Không commit credential, DB, ảnh hoặc artifact runtime vào Git.
Kết quả unit trước đó:678 PASS/6 live SKIP; lint/build PASS,5warning Admin nền.

## Giới hạn

Không Safari/Firefox, thiết bị touch thật hoặc screen reader; không ES/FAISS live.
Buyer hủy/hoàn tất, vận chuyển và toàn bộ COD end-to-end chưa nghiệm thu trong
lượt này. 15 nhóm trên không phải15 đơn độc lập hay test toàn bộ hệ thống.
Warning pg concurrent-query và cron deadline3ms không làm assertion fail; chưa
điều tra nguyên nhân trong scope UI này. Cần review head mới và CI trước merge.
