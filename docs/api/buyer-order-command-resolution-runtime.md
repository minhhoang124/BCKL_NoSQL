# Buyer command resolver — Backend IN_PROGRESS, 19/10/2026

Contract #69 đã merge tại `622cfb9`. Đây là triển khai trên nhánh riêng,
chưa là nghiệm thu Buyer Web hoặc toàn bộ G-FULFILMENT.
Nguồn quy tắc: [contract đã review](buyer-order-command-resolution-proposal.md).

## Luồng và quyền

`POST /orders/:orderId/resolve-command`, JWT USER active, key gốc ở header
`Idempotency-Key`, JSON exact `{command, hashVersion, requestHash}`. `command`
chỉ `cancel|complete`, `hashVersion` đúng số 1, fingerprint là lowercase hex64.
Không nhận lý do/body gốc hoặc actor từ client. Không query; body sau giải nén
tối đa 8 KiB, kể cả URL hoa/thường/slash cuối.

Controller → guard quyền/quota → parse metadata → Serializable transaction
→ User UPDATE → Store SHARE → Order UPDATE → đọc lại ownership → đọc receipt
và fence theo `(USER:actorId, originalKey)` → commit → HTTP 200.

- **COMMITTED:** trả nguyên biên nhận Buyer gốc đã lưu, `replayed:true`.
  Không dựng từ Order/Payment hiện hành. Cancel tái tính hash từ lý do trong
  snapshot rồi kiểm toàn payment/cancellation/timeline; complete kiểm hash `{}`
  và receipt BUYER. Receipt hỏng trả lỗi an toàn, không tự chữa hoặc backfill.
- **CLOSED_WITHOUT_EXECUTION:** trả exact `outcome,resolutionId,orderId,command,
  resolvedAt`. Chỉ tạo fence, không hủy/hoàn tất đơn và không hoàn kho.
  Replay trả cùng ID/thời điểm. Đơn/Payment/Store đã đổi vẫn cho đối chiếu,
  nhưng account và ownership luôn phải hợp lệ.
- Complete chưa có record phải khớp hash canonical do Backend tính. Cancel
  chưa có record chỉ nhận fingerprint để định danh fence; không tuyên bố biết
  lý do cũ. Fence chặn toàn key trong scope, kể cả payload tới muộn khác hash.
- Không mượn receipt `SYSTEM:ORDER_AUTO_COMPLETE`. Nếu D07 đã thắng mà key
  Buyer chưa được thực thi, chỉ đóng key Buyer; Order vẫn COMPLETED bởi SYSTEM.

## Database và cạnh tranh

Migration mới `20261019040000_buyer_order_command_resolution` chỉ mở allowed
pair của check constraint: SELLER ba lệnh chuẩn bị + BUYER cancel/complete.
Không sửa migration #67, không thay bảng/cột Prisma hoặc dữ liệu lịch sử.
Giữ nguyên opposing-table triggers, unique scope/key, immutable fence/identity
và kiểm Serializable. Migration phải triển khai trước API mới; không được tự
hạ guard khi database chưa nhận migration.

Khi triển khai nhiều instance, cập nhật migration và helper trên tất cả instance
trước khi mở đường gọi Buyer resolver. Backend cũ chỉ hiểu Seller fence sẽ
fail-closed với Buyer fence; không coi rolling deployment lẫn phiên bản là đã QA.

Helper `assertOrderCommandNotClosed` kiểm fence hợp lệ độc lập với actor gọi,
rồi so đầy đủ actorType/Order/command/hash. Đổi role không tạo namespace key
mới. Cả năm writer đều kiểm trước replay/policy. Delivery bổ sung actorType
ADMIN ở lời gọi helper; SYSTEM tiếp tục namespace nội bộ riêng.

SSI = cơ chế database phát hiện các giao dịch Serializable xung đột.
Row locks thống nhất thứ tự cộng với SSI và opposing-table triggers loại trừ
receipt/fence đồng tồn tại; không dùng khóa RAM làm bảo đảm giữa nhiều process.

## Lỗi và vận hành

Giữ envelope `{statusCode,code,message}`, `Cache-Control:no-store` cho cả lỗi.
Thiếu/sai quyền 401/403; không tồn tại/khác owner cùng404; khác identity/hash409;
đang chờ/hết retry409 ORDER_COMMAND_IN_PROGRESS với Retry-After:1. Metadata sai
400, body quá lớn413, quota429; dữ liệu lưu hỏng500 không lộ nội dung.

`BUYER_RESOLUTION_RATE_PER_MINUTE=20`: bucket riêng theo actor/instance, gồm
replay; không dùng chung quota cancel/complete và không là limiter distributed.
Timeout tái dùng `ORDER_COMMAND_*`: lock1s/statement2s/transaction5s/poolwait2s,
deadline22s; tối đa3 lần, chỉ retry serialization/deadlock/scope-key unique race.
Log success gồm actorId/orderId/outcome/attempt, lỗi chỉ thông báo an toàn;
không log key/hash/reason/token. Fence không có TTL xóa tự động.

## Ranh giới bàn giao

Không đổi execute cancel/complete để tin hash client. Không Frontend/journal v2,
không bật nút Buyer, không Auth đa role/FastAPI/Search contract mới.
Browser QA, crash hai OS process và recovery qua nhiều thiết bị chưa được nhận
PASS chỉ từ unit hoặc hai Nest app. Xem [bằng chứng](../testing/buyer-command-resolution-runtime-2026-10-19.md).
