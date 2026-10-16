# Kiểm chứng nền journal Order — 15/10/2026

Nền develop541d15b, nhánh codex/order-command-recovery. Không nhập code #54/#55 chưa merge. Mục tiêu độc lập: giữ cùng metadata/key của lệnh body `{}` qua remount/reload, không phải triển khai đầy đủ Order UI hoặc recovery end-to-end.

| Kiểm tra thực chạy | Kết quả |
|---|---|
| Install frozen lockfile | PASS, lockfile không đổi, postinstall Prisma generate không kết nối DB |
| Full FE | **154/154 PASS**,16 files (nền122 +32 mới) |
| FE lint | PASS |
| FE TypeScript/Vite build | PASS |
| Diff-check | PASS |
| Backend/Prisma/AI | Không sửa; không chạy lại BE/E2E/Ruff/Pytest local |
| Browser/HTTP/DB/route/nút giao dịch | **NOT_RUN / chưa tích hợp** |

32 ca mới tại `orderIntentJournal.test.ts`: persist trước dispatch; cùng key sau tạo lại module; một pending/order/command mỗi actor; tách tài khoản và chặn role thay đổi; không expire theo tuổi; whitelist lệnh/field/schema/IDs/key/date; corruption không overwrite; storage read/write/remove lỗi; receipt mismatch/commandId invalid; callback cũ không xóa intent mới. Test jsdom với sessionStorage, không chứng minh F5/tab-close bằng browser thật hoặc chống double commit ở PostgreSQL.

API module không có HTTP, timer, auto retry, tự clear khi logout hoặc GET-based ack. Caller phải cung cấp actor đã xác thực, session fencing, xác nhận trước gửi và runtime-validated command receipt trước acknowledge. Chỉ Seller preparation/Buyer complete body `{}`; cancel/returned, clear khi chắc chắn bị từ chối và recovery sau đóng tab còn thiếu. Không bật giao dịch chỉ vì test foundation xanh.

## Bổ sung coordinator sau nền journal

Các số154/32 mới phía trên là lượt foundation ban đầu. `orderCommandCoordinator` bổ sung điều phối độc lập với adapter inject: explicit confirmation, latch trước await, persist trước send, lỗi giữ nguyên key và không auto retry, cùng-key retry sau xác nhận lại; chụp session identity/generation, không ack response/lỗi muộn sau đổi account/role/active/version/logout. Test tạo lại coordinator giữ cùng sessionStorage để mô phỏng reload, không gọi đó là browser F5 thật. Wrong receipt và storage hỏng không giải phóng pending. Không route/HTTP/UI mới hoặc thay contract server. Kết quả toàn bộ lượt mới cập nhật trong comment PR sau chạy cuối.

Lượt cuối thực chạy: **173/173 FE tests PASS**,17 files (nền122 +32journal +19coordinator),8.20 giây; lint/TypeScript/build/diff-check PASS. Adapter trong19ca coordinator là mock/deferred Promise, không HTTP thật; chưa chứng minh Backend commit/replay/F5 browser hoặc recovery end-to-end. BE/AI/router/shared Auth client/lockfile không đổi, không chạy DB hoặc BE E2E ở đợt này.

Chi tiết/ma trận bước tích hợp: [thiết kế](../architecture/order-command-recovery-readiness.md). Sau #55 merge mới nối list/detail và controller bên ngoài panel, review riêng trước bật POST. PostgreSQL là bảo đảm idempotency cuối, sessionStorage không thay khóa/ownership và không an toàn trước XSS/DevTools.
