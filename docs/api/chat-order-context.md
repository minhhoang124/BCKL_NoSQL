# Chia sẻ đơn hàng trong Chat — 24/10/2026

Trạng thái: IN_PROGRESS trên `codex/chat-order-context`; chưa merge, hai cờ mới
mặc định tắt. Không nhận toàn Chat/SRS hoàn thành hoặc đã có ảnh/video.

## Luồng và API

1. Từ chi tiết đơn Buyer/Seller, bấm **Trao đổi về đơn hàng**.
   Route `/messages?orderId=…&orderScope=buyer|seller` chỉ là gợi ý giao diện,
   không chứng minh quyền; không gửi tự động khi mở/reload.
2. Người dùng bấm **Mở trao đổi về đơn**. POST `/chat/conversations/order`
   chỉ nhận `{orderId: positiveInt32}`. JWT → User active/role hiện hành →
   Order → cặp Buyer/Store canonical → chủ Store hiện hành.
   Trả conversation chuẩn + `orderId,viewer:BUYER|SELLER`. Tham số client
   không quyết định buyerId/storeId/senderId/viewer ở Backend.
3. Bấm **Chia sẻ đơn hàng**. POST `/chat/conversations/:id/messages`:

   ```json
   {"clientMessageId":"uuid-for-one-send","type":"ORDER_CONTEXT","contextOrderId":125}
   ```

   Body đúng 3 trường; không content/Product/actor tùy ý. Khóa hàng Conversation
   trong Serializable transaction (giao dịch kiểm soát các yêu cầu đồng thời),
   kiểm quyền → tìm receipt (biên nhận tin đã lưu) → kiểm flag/Order → append.
   `Order.buyerId` **và** `Order.storeId` phải khớp Conversation, kể cả Seller
   gửi. Cùng Store nhưng đơn của khách khác vẫn 404.
4. Message chỉ thêm `orderContext:{orderId,storeId}`; content cố định
   `Đã chia sẻ đơn hàng`. Không tên hàng/giá/địa chỉ snapshot trong history,
   inbox hoặc push. Thông báo socket là hint (báo cần tải bù), không gửi thẻ
   riêng tư; REST tải lịch sử và kiểm quyền lại trước dựng thẻ.
5. GET `/chat/conversations/:id/messages/:messageId/order-context` chỉ hydrate
   (đọc dữ liệu để dựng thẻ) một Order reference **đã lưu** trong đúng Message,
   đúng Conversation; không có API Chat tra đơn tùy ý theo ID.

## Dữ liệu tối thiểu và snapshot

GET trả đúng: `orderId,storeId,orderNumber,status,total,currency,createdAt,
viewer,lineCount,items`. `items` tối đa 5 dòng, mỗi dòng `{name,quantity}` từ
`OrderItem.productNameSnapshot`; không đọc Product hiện hành để dựng lại đơn.
`total` giữ Decimal string hai số thập phân, VND; `status` là trạng thái hiện
tại của Order, không phải trạng thái lúc gửi. `lineCount` tổng số dòng, không
phải tổng quantity; lịch sử legacy không có dòng được trả 0/[] trung thực.

Không trả điện thoại, địa chỉ, email, Payment, reason, Checkout/OrderCommand,
idempotencyKey/hash hoặc actor audit. Chỉ nhấn link chi tiết mới đi qua API
Order đầy đủ với quyền riêng. GET không thay Order/kho/Search/read cursor.
Response no-store trước guard/validation; dùng quota Chat read/send/open cũ,
không thêm bucket để né giới hạn. ID/query/body không hợp lệ bị từ chối.

## Quyền và trạng thái Store

- Buyer đúng Order; Seller đúng chủ Store và đúng Buyer của Conversation.
  Admin không mặc định đọc Chat. Seller mua ở Store khác chỉ theo capability
  Buyer server đã có; không thay role/Auth trong task.
- Thiếu Order và sai quyền mở đơn cùng 404 `CHAT_ORDER_UNAVAILABLE`.
- ACTIVE + owner active mới tạo trao đổi mới. SUSPENDED cho gửi về Order có
  **trước** history SUSPENDED gần nhất; không lấy một đơn cũ làm bằng chứng
  cho phép chia sẻ đơn mới hơn. Không history thì không suy đoán.
- Hội thoại đã tồn tại được mở lại chỉ đọc khi CLOSED/owner inactive; active
  Buyer vẫn đọc lịch sử của mình. Không tạo cặp mới để vượt khóa. Bị khóa User
  không dùng được JWT cũ; quyền gửi bị thu hồi chặn cả replay.

## Biến mới, phục hồi và rollout

| Tên | Chứa gì / vai trò |
|---|---|
| `contextOrderId` | ID Order tham chiếu; nullable, không phải mã đơn hiển thị |
| `orderContext` | Metadata reference trả cho Web, không phải full Order DTO |
| `viewer` | Backend xác định ngữ cảnh BUYER/SELLER cho link chi tiết |
| `clientMessageId` | Một mã cho một ý định gửi, giữ nguyên khi mất phản hồi |
| `CHAT_ORDER_CONTEXT_ENABLED` | Cho mở từ Order/chia sẻ **mới**, mặc định false |
| `VITE_CHAT_ORDER_CONTEXT_ENABLED` | Hiện entry/nút chia sẻ Order, mặc định false |

Migration mới `20261024170000_chat_order_context`: thêm nullable Int, CHECK
dương/placeholder và loại trừ Product reference; trigger bất biến hiện có bảo
vệ toàn hàng. Không FK cascade tới Order, không xóa lịch sử khi miền khác đổi.
TEXT/Product hash v1 không đổi. Migrate trước deploy code vì SELECT có cột mới;
không sửa/xóa migration dùng chung hoặc bật cờ trước upgrade đầy đủ replicas.

Journal v1 (vùng lưu yêu cầu chờ) chỉ giữ ID/key/placeholder trong sessionStorage,
không token/Order snapshot. Timeout, lỗi hoặc receipt sai giữ key; replay sau
reload chủ động dùng đúng payload/key. Chỉ xóa raw journal khớp sau receipt
hợp lệ; tải lịch sử lỗi sau receipt không gửi lại mutation. Giữ TEXT draft.
Đổi phiên/unmount không nhận kết quả cũ; thẻ đã tải cũng bị xóa khi poll làm
phiên bị vô hiệu. Cờ Order tắt không ngăn đọc thẻ cũ/replay đã commit; cờ Chat
TEXT tổng mới tắt toàn module. Đây là semantics chủ ý, không phải kill switch
ẩn toàn dữ liệu lịch sử.

Giới hạn: một pending/actor/tab; đóng tab có thể mất intent, chưa Chat resolver
cho request không rõ kết quả. Không tự xóa pending chỉ vì 4xx; lịch sử/mã đã
commit vẫn an toàn nhưng UX có thể phải giữ chờ khi mất quyền. Thẻ poll 30s khi
visible, timeout 10s, chưa batch/dedupe/load benchmark; có độ trễ tối đa chu kỳ
poll trước khi thấy trạng thái/thu hồi mới. Không media/video/ReturnRequest.

Kiểm thử và phạm vi bằng chứng: [báo cáo](../testing/chat-order-context-2026-10-24.md).
