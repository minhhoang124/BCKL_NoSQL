# C3 — Hủy đơn COD và hoàn kho

Trạng thái: IN_PROGRESS, cần Hiền review; nền develop `27e083b` (#38 đã merge).
Nhánh độc lập, không phụ thuộc code chưa merge của #42/#43. Căn cứ SRS
`docs/analysis/hien/srs-v3.md` FR-CAN-01, AC-ORD-01/CAN-01 và contract
`cart-order-inventory-api-contract.md` mục 7.1–7.2. Không sửa SRS để khớp code.

## Quyền và đầu vào

- Buyer: `POST /orders/:orderId/cancel`, role USER, chỉ đơn của mình,
  nguồn PENDING_CONFIRMATION. reasonCode CHANGED_MIND hoặc OTHER.
- Seller: `POST /seller/orders/:orderId/cancel`, role SELLER, Store thuộc mình,
  nguồn PENDING_CONFIRMATION hoặc CONFIRMED. reasonCode OUT_OF_STOCK,
  CANNOT_FULFIL hoặc OTHER.
- Body đúng hai trường reasonCode, reasonText (trim 1–500 ký tự), JSON tối đa
  8 KiB sau giải nén. Idempotency-Key ASCII chữ/số/_/- dài 16–128, không query.
- Không tồn tại/trái ownership cùng 404. Actor, thời gian, stock do server lấy.
- Tài khoản phải active cả lần đầu và replay. Seller được xử lý đơn cũ trong
  Store ACTIVE/SUSPENDED theo lựa chọn Hoàng; trạng thái khác chặn lệnh mới.
  Buyer vẫn được hủy đơn mình khi Store bị khóa, không cần quyền mở bán.

## Giao dịch và chống xử lý trùng

Serializable transaction, khóa User → Store → Order → Product theo id tăng dần;
Payment được khóa trước khi cập nhật. Không gọi HTTP/AI trong giao dịch.
Replay đọc receipt bền vững theo USER:id + key sau kiểm tra quyền, trước
kiểm tra trạng thái mới. Cùng key khác request nhận IDEMPOTENCY_CONFLICT.

Lần đầu ghi Order CANCELLED/audit, Payment COD UNPAID → CANCELLED, mỗi Item
một CANCELLATION_RESTORE theo quantity snapshot, history và receipt SUCCEEDED
trong cùng transaction. Chỉ một lần tăng version/ghi SearchOutbox mỗi Product,
kể cả nhiều Variant của cùng Product. Stock-only không đưa APPROVED về DRAFT.
Outbox quyết định UPSERT/DELETE theo Product/category canonical trong transaction.
Không thêm lại món vào Cart; không sửa Checkout receipt đã lưu.

Mỗi Item phải có CHECKOUT_DECREMENT đúng variant/quantity và chưa có movement
hoàn kho. Legacy thiếu bằng chứng nhận 409 ORDER_INVENTORY_REVIEW_REQUIRED,
không đoán kho đã trừ. Stock vượt Int PostgreSQL hoặc version hết miền hợp lệ
nhận 409 INVENTORY_STATE_CONFLICT và rollback toàn bộ.

P0 này chỉ phục vụ COD chưa thanh toán. Payment thiếu/không nhất quán/sandbox
đã PAID nhận PAYMENT_STATE_CONFLICT; hoàn sandbox cần luồng refund riêng theo
FR-CAN-01, không giả hủy đồng nghĩa hoàn tiền. Giao thất bại/nhận hàng trả về
không thuộc endpoint này.

## Response và giới hạn

HTTP 200 `{orderId, commandId, command:"cancel", replayed, result}`.
result gồm status CANCELLED, payment (Decimal string), cancellation có actor
code/text/time, timeline một sự kiện của command (không phải toàn lịch sử GET).
Replay trả nguyên result gốc; không trả key/hash/Checkout receipt/profile Buyer.
Nhờ Hiền review phạm vi timeline này, nhất quán hướng #43; GET detail riêng.

Ba lần thử tối đa, backoff ngắn, timeout khóa/statement/transaction và deadline
theo ORDER_CANCEL_*; hết thời gian trả ORDER_COMMAND_IN_PROGRESS + Retry-After:1.
Quota ingress riêng mặc định 20 request/phút/actor/process; không dùng khóa RAM
làm bảo đảm tồn kho. Rate limit nhiều instance cần gateway/shared limiter sau.

## Bằng chứng cần có

HTTP thật + PostgreSQL test riêng: Buyer/Seller, ownership, trạng thái, lý do,
replay sau response mất/process đổi, concurrent key/actor, rollback bằng lỗi SQL,
multi-variant/outbox, stock overflow, thiếu ledger, inactive/suspended, Checkout
thật và snapshot không thay đổi. Confirm-vs-cancel qua HTTP #43 cần kiểm thử
tích hợp sau merge; không coi writer SQL mô phỏng là bằng chứng API #43.
