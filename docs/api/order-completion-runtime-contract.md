# C4.3 — Buyer hoàn tất và tác vụ tự hoàn tất D07

Trạng thái: IN_PROGRESS trên #48, đã đồng bộ develop `5d17d4f` sau merge #47 ngày 15/10. Theo SRS FR-ORD-01/D07 và Cart–Order–Inventory mục 6/7.1. Không gồm UI, Review, Notification, Dashboard/đối soát hoặc vận chuyển thật. Contract và migration completion không đổi trong đợt đồng bộ. [Kiểm chứng tích hợp mới](../testing/pr48-post-pr47-integration-2026-10-15.md); số test và giới hạn fixture bên dưới là lịch sử đợt ban đầu.

## Buyer

`POST /orders/:orderId/complete`, JWT USER hoạt động, chỉ Order.buyerId của mình; sai owner và không tồn tại đều 404. Body chỉ `{}` và Idempotency-Key 16–128 ký tự ASCII chữ/số/_/-. Không query/extra field/SYSTEM do client gửi. JSON tối đa 8 KiB sau giải nén. Quota 20 yêu cầu/phút/Buyer/instance kể cả replay; chưa phải quota distributed.

Order DELIVERED, deliveredAt hợp lệ, chưa cancelled/completed; Payment PAID có paidAt, amount khớp total, VND. COD đã PAID ở bước giao thành công; VNPAY/MOMO PAID sandbox cũng được hoàn tất. Không tự sửa Payment lỗi. Buyer không phải chờ 3 ngày.

Serializable transaction: xác thực lại role/ownership dưới khóa User→Store→Order→Payment → tìm receipt cũ → claim OrderCommand → COMPLETED/completedAt → history BUYER → receipt SUCCEEDED, nguyên tử. Không chỉnh stock, Product.version/outbox, tiền thanh toán hoặc snapshot Checkout/Order. Khác key khi đơn đã complete nhận 409; cùng scope/key/hash trả receipt gốc. Mốc thời gian của claim/history/completion dùng giờ PostgreSQL cùng transaction, tránh chênh thời gian với default ở client.

Response `{orderId,commandId,command:'complete',replayed,result}`. Result gồm status, deliveredAt/completedAt, Payment giá chuỗi Decimal và một history của command; không key/hash/PII địa chỉ. Validator runtime kiểm tra exact allowlist trước khi replay.

## Tự hoàn tất thật, bền vững

Cron `order-auto-complete-d07` đăng ký qua infrastructure @nestjs/schedule đã có, chạy mỗi 15 giây. Mặc định bật và đợi 259200 giây (3 ngày); `ORDER_AUTO_COMPLETE_ENABLED=false` tắt, `ORDER_AUTO_COMPLETE_DELAY_SECONDS` 1–2592000 chỉ rút ngắn trong demo. Không đổi dueAt của job đã tạo khi đổi cấu hình.

```text
Order DELIVERED + deliveredAt trong PostgreSQL tới hạn
→ cron phát hiện và INSERT job duy nhất theo orderId
→ claim job bằng FOR UPDATE SKIP LOCKED + lease token 2 phút
→ đọc lại Order/Payment dưới khóa, kiểm tra đúng deliveredAt/dueAt/lease
→ OrderCommand SYSTEM + COMPLETED + history + receipt + job SUCCEEDED cùng transaction
```

Scan tối đa 100 job/lượt, xử lý tối đa 20. Discovery/claim/update job có timeout SQL 2s/lock 1s/transaction 5s/pool wait 2s. Command retry Serializable tối đa 3 lượt và deadline 22s theo ORDER_COMMAND_* (đọc job đầu tiên cũng có giới hạn riêng). In-process guard chỉ tiết kiệm tác vụ, không là bảo đảm duy nhất; database lease và Order lock bảo vệ nhiều instance.

Order DELIVERED/time là nguồn việc bền vững: crash trước lúc tạo job không mất công việc. Job RUNNING hết lease được claim lại; worker cũ mất token không được commit. Buyer cạnh tranh cron: chỉ một transition/history/receipt; worker thấy Buyer đã complete đánh dấu SKIPPED. Canonical deliveredAt đổi thì SKIPPED, không dựa snapshot cũ. Key SYSTEM xác định bằng orderId + deliveredAt + ruleVersion D07; scope SYSTEM:ORDER_AUTO_COMPLETE, actorId=null. Không có endpoint client tự khai SYSTEM.

## Biến cần hiểu

| Trường | Ý nghĩa |
|---|---|
| deliveredAt | Lúc giao thành công, không phải lúc đặt đơn |
| dueAt | Hạn tự hoàn tất, tính khi tạo job theo rule/cấu hình |
| nextAttemptAt | Lúc sớm nhất thử lại khi lỗi |
| attemptCount | Số lượt claim, gồm cả lượt bị crash; tối đa 6 |
| leaseToken/leaseExpiresAt | Dấu quyền xử lý tạm thời và hạn; chống worker cũ ghi sau worker mới |
| status job | PENDING/RUNNING/RETRY/SUCCEEDED/SKIPPED/FAILED; không phải trạng thái Order |
| OrderCommand | Receipt bất biến của giao dịch đã commit; không dùng làm queue PROCESSING qua restart |

Lỗi một Order không chặn Order khác. Backoff 30/60/120/240/480 giây; tới lượt 6 FAILED, không retry vô hạn. Crash ở lượt cuối chuyển FAILED/LEASE_EXHAUSTED sau khi lease hết. Log jobId/orderId/attempt/code, không raw SQL error/key/hash/token/địa chỉ. FAILED cần kiểm tra vận hành; chưa có UI/endpoint requeue. Không tự reset attempt hoặc đoán sửa Payment. Buyer có thể hoàn tất sau khi nguyên nhân đã sửa và điều kiện vẫn đúng.

## Migration và kiểm thử

Migration mới `20261010170000_order_completion_jobs` chỉ thêm bảng/check/index/FK và index status/deliveredAt ở Order; không sửa dữ liệu nghiệp vụ/receipt lịch sử, không backfill COMPLETED hoặc job giả. Một Order một job, dueAt>=deliveredAt, ruleVersion=1, attempt 0..6, trạng thái/lease/completedAt nhất quán. Job dùng FK RESTRICT.

27 unit; 15 E2E HTTP/runtime và 10 test nâng cấp/ràng buộc database mới: Buyer/replay/ownership/concurrency, cron thật không gọi service từ test, chưa tới hạn, Buyer-vs-job, hai worker, retry qua Nest restart, crash/lease/stale token, six-failure terminal, lỗi SQL cuối giao dịch rollback, migration giữ nguyên dữ liệu lịch sử.
Fixture DELIVERED/PAID có nhãn, không thay bằng chứng API #46/toàn luồng Buyer→Seller→Admin→Buyer. Default tests tắt cron; suite runtime mở riêng và kiểm tra scheduler thật.

COMPLETED chỉ là mốc dữ liệu cho doanh thu/Review sau này, chưa ghi tài chính/settlement hay Notification giả. Sau merge cần giữ toàn bộ controller/parser #42/#43/#44/#46/#47 khi tích hợp và nghiệm thu với UI.
