# PR #48 — đồng bộ sau #47, ngày 15/10/2026

## Nền và phạm vi

- Nền chính thức `develop 5d17d4f`, đã merge #42/#43/#44/#46/#47. Head #48 trước sync: `c66e82f`.
- Gỡ ba conflict: `BE/src/configure-app.ts`, `BE/src/order/order.module.ts`, tổng quan kiến trúc. Giữ SearchModule, tất cả controller/provider/guard list/detail/Seller/cancel/delivery/returned và completion worker.
- Parser: guard GET → Seller preparation → cancellation → delivery → returned → completion → Checkout/default. Giữ CORS, cookie và ValidationPipe.
- Không sửa production completion service/worker/request/receipt/quota hoặc migration/schema so với head #48 cũ. Không sửa các migration đã dùng chung. Không lấy #54/#55 chưa merge, không thay FE/AI_CLIP/lockfile so với develop.

## Ba ca tích hợp mới

Order/Payment/ledger/history/deliveredAt được tạo bằng HTTP thật qua hai ứng dụng Nest/PostgreSQL, không mock HTTP và không UPDATE trạng thái Order bằng SQL. Catalog, URL ảnh, tài khoản và địa chỉ là fixture kiểm thử có nhãn.

1. **Buyer hoàn tất:** Cart quantity2 → Checkout COD → Seller confirm/packing/ready → Admin ship/mark-delivered → Buyer complete. Stock5→3 tại Checkout; COD PAID tại delivered. Completion chỉ đổi Order/completedAt/history/receipt; không đổi kho/ledger/Payment/Product.version/outbox/items/attempt. GET Buyer/Seller giữ snapshot địa chỉ gốc dù địa chỉ hiện hành đã sửa. Replay complete cùng key ở app khác và replay Checkout không ghi thêm; complete key mới409, Seller/Admin403.
2. **Runtime D07:** cùng chuỗi HTTP giao thành công → tác vụ scheduler đã đăng ký phát hiện Order tới hạn → SYSTEM complete. Dùng delay demo1 giây trong ứng dụng QA riêng, không backdate Order/Payment. Kiểm dueAt=deliveredAt+1 giây, job SUCCEEDED/attempt1; tick lần hai không ghi thêm. Đây là gọi callback cron đã đăng ký để chạy xác định; ca wall-clock cron độc lập có sẵn vẫn được giữ và chạy.
3. **Buyer cạnh tranh D07:** cùng chuỗi HTTP, tạo job ở ranh giới queue theo deliveredAt thật và delay demo1 giây để bảo đảm cả hai có việc hợp lệ, rồi POST Buyer và callback scheduler chạy đồng thời ở hai app. Chỉ một COMPLETED/history/receipt; job SUCCEEDED hoặc SKIPPED. Nếu Buyer thắng, replay receipt gốc; nếu SYSTEM thắng, Buyer409 INVALID_ORDER_TRANSITION. Tick sau không đổi DB.

Ca thứ ba dựng bản ghi queue để kiểm cạnh tranh, không phải bằng chứng tự discovery; ca thứ hai kiểm discovery độc lập. Hai app/pools không phải hai process phân tán hoặc thử tải production. Các test cũ tiếp tục kiểm lease/restart/stale token/backoff/terminal6 lần, SQL fault rollback và migration nâng cấp không đoán dữ liệu lịch sử.

## Kết quả thực chạy

PostgreSQL17 QA `127.0.0.1:5549/bckl_pr48_post47_20261015`, database mới riêng, không demo port5432.

| Kiểm tra | Kết quả |
|---|---|
| Fresh migrate deploy / Prisma validate | PASS, 13 migrations |
| Backend typecheck/lint/build | PASS |
| Unit Backend | **594/594 PASS**, 25 suites, maxWorkers1 |
| Completion targeted runtime+migration trước siết queue | **28/28 PASS** (18 runtime, 10 migration) |
| Full Backend E2E trước siết queue | **560/560 PASS**, 28 suites, 151.76 giây |
| Full Backend E2E sau siết queue | **560/560 PASS**, 28 suites, 140.58 giây |
| FE test/lint/build | **122/122 PASS**, 15 files; FE không đổi |
| Diff-check | PASS |

Lượt đầu hai ca mới lỗi do `$queryRaw SELECT pg_sleep(...)` trả kiểu void mà Prisma không giải mã. Sửa riêng truy vấn chờ thành `SELECT 1 AS ready FROM pg_sleep(1.1)`, không thay business state/production, không tăng timeout hoặc skip test. Lượt targeted sau sửa28/28 và full560/560 PASS. Warning pg/Vite nền vẫn còn; ERROR do negative/fault-injection tests có chủ đích không bị che giấu.

SQL sau full E2E cuối: Orders=0, StockMovement=0, SearchOutbox=0, OrderCompletionJob=0. Cleanup theo ID fixture/thứ tự FK; không xóa rộng các seed hoặc dữ liệu khác. Không dùng DB demo. Định dạng ba file TypeScript đã kiểm Prettier PASS.

## Giới hạn / bàn giao

- Chưa browser/Order UI, chưa phục vụ file ảnh, chưa FastAPI/ES/FAISS hoặc quality metrics trong đợt này. AI source không đổi; chưa chạy Ruff/Pytest local.
- Không suy COMPLETED là đã triển khai Review/Notification/Dashboard hoặc đối soát tiền thật. G-CHECKOUT/G-FULFILMENT vẫn chưa nghiệm thu toàn Web.
- Job FAILED cần operator investigation, chưa có endpoint requeue. Delay1 giây chỉ dùng app QA, mặc định vẫn3 ngày và không đổi dueAt job đã tạo.
- Chờ CI và review đúng head mới, không dùng approval/CI cũ thay thế; không tự merge.
