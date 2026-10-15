# C4.2 — xác nhận hàng giao thất bại quay về

Trạng thái: IN_PROGRESS trên nhánh #47, đã đồng bộ develop `11a0da7` sau merge #46 ngày 15/10. Giữ API detail/Seller/cancel/delivery đã merge; không gồm hậu mãi P1, không coi đã tích hợp UI. Nội dung quyền/payload không đổi. Kết quả head tích hợp: [báo cáo sau #46](../testing/pr47-post-pr46-integration-2026-10-15.md). Các kết quả/ngày cũ bên dưới là lịch sử, không thay bằng chứng mới.

## Quyền và đầu vào

`POST /seller/orders/:orderId/confirm-returned` (Store của Seller); `POST /admin/orders/:orderId/confirm-returned` (Admin).
JWT và tài khoản phải hoạt động, quyền đọc lại trong giao dịch. Seller ACTIVE được xử lý đơn cũ của Store ACTIVE/SUSPENDED; Store khác và đơn không tồn tại đều 404.
JSON tối đa 8 KiB sau giải nén; không query hoặc field thừa. Idempotency-Key 16–128 ký tự ASCII chữ/số/_/-. Quota mặc định 20 lệnh/phút/actor/instance, kể cả replay; chưa phải quota chia sẻ nhiều replica.

Body đủ bốn field: `reasonCode`, `reasonText` (trim 1–500), `restockable` boolean, `receiptReference`.

| Quyết định | Actor | Code | Chứng từ | Hoàn kho |
|---|---|---|---|---|
| Đã nhận, bán lại được | Seller/Admin | RETURN_RECEIVED | Chuỗi trim 1–100 | Có |
| Đã nhận nhưng hỏng | Seller/Admin | DAMAGED | Chuỗi trim 1–100 | Không |
| Thất lạc | Chỉ Admin | LOST | null | Không |

Chỉ DELIVERY_FAILED có DeliveryAttempt canonical hiện hành hợp lệ, chưa delivered/completed/cancelled. Chỉ COD UNPAID, paidAt=null, amount khớp total VND. Prepaid cần quy trình refund riêng, hiện fail-closed. Không suy đoán audit/attempt/ledger lịch sử.

## Giao dịch và chống lặp

Serializable, khóa User → Store → Order → Payment → các Product tăng dần. Timeout chờ/SQL/giao dịch và retry conflict có giới hạn (ORDER_COMMAND_*). Unique scope/key xuyên command/order; hash v1 giữ false/null/chứng từ/lý do. Xác thực ownership rồi trả receipt cũ trước kiểm tra trạng thái mới.

Trong một transaction: claim OrderCommand → nếu bán lại được, kiểm tra đúng một CHECKOUT_DECREMENT từng item, không có restore cũ → tăng Variant.stock có kiểm tra overflow → CANCELLATION_RESTORE mỗi item → tăng Product.version một lần mỗi Product → outbox từ listing canonical → CANCELLED/audit → COD CANCELLED → history → receipt SUCCEEDED.

Không đổi tên/giá/địa chỉ snapshot hoặc receipt Checkout. Không hạ APPROVED chỉ vì hoàn kho; listing không public phát DELETE, listing public phát UPSERT theo contract hiện có. Không gọi FastAPI trong transaction. false không thay đổi stock/version/outbox. RETURN_RESTORE dành P1.

History/receipt giữ restockable, chứng từ, attempt/tracking đọc từ DB, actor/reason/time. Response `{orderId,commandId,command,replayed,result}` allowlist; không key/hash/JWT/địa chỉ. Result replay bất biến, cần GET nếu muốn trạng thái hiện hành.

## Nghiệm thu

**Bổ sung 14/10/2026:** suite hiện có 20 ca E2E (12 cũ + 8 mới); kiểm nhiều
Variant/một Product, full UPSERT/DELETE, restore cũ/version overflow/biên cuối,
Seller bị khóa hoặc mất role sau receipt thật. [Báo cáo và giới hạn](../testing/pr47-returned-regression-2026-10-14.md).
Nội dung 32 unit/12 E2E dưới đây là bằng chứng đợt triển khai ban đầu.

32 unit và 12 E2E mới: normalize/hash/allowlist, nhận/hỏng/mất, Seller suspended/ownership, hai instance cùng key, Seller/Admin khác quyết định, ledger thiếu, prepaid/sai trạng thái, account khóa, fault SQL final receipt rollback/retry, overflow, JSON/query/Swagger.
E2E dùng fixture DELIVERY_FAILED + attempt/ledger có nhãn, không khẳng định đã chạy API #46 hay toàn luồng Seller. Chưa có UI và chưa nghiệm thu Search index xuyên dịch vụ trong task này.
