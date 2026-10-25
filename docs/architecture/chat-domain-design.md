# Thiết kế Chat trực tiếp giữa User và Seller

## Lát cắt Order context — 24/10/2026, IN_PROGRESS

Chia sẻ đơn bằng `ORDER_CONTEXT/contextOrderId`, không chép địa chỉ, điện thoại,
Payment, reason hay receipt vào Message. Backend đối chiếu cả `buyerId` và
`storeId` của Order với Conversation; Seller không thể gửi đơn của khách khác
dù cùng Store. TEXT/Product cũ giữ nguyên hash. ID tham chiếu không có FK xóa
lịch sử, hai context loại trừ nhau và placeholder cố định được CHECK ở DB.

POST `/chat/conversations/order` nhận duy nhất orderId, suy cặp Buyer–Store từ
DB rồi kiểm actor hiện hành; không tự gửi tin. Store SUSPENDED chỉ gửi/chia sẻ
Order có trước lần khóa gần nhất, owner phải active; CLOSED chỉ đọc lịch sử.
Replay sau kiểm quyền trả đúng receipt cũ, không tạo sequence/tin/push mới.

GET `/chat/conversations/:id/messages/:messageId/order-context` chỉ hydrate
Order đã được chia sẻ trong đúng Message/Conversation. Allowlist: orderId,
storeId, orderNumber, status, total (Decimal string), currency VND, createdAt,
viewer BUYER/SELLER và tối đa 5 dòng tên/số lượng từ OrderItem snapshot.
Không gọi API chi tiết đơn đầy đủ để dựng thẻ Chat. Không đánh dấu đọc hoặc
thay đổi Order/kho/Search. Push chỉ báo có tin, thẻ riêng tải lại qua REST có
kiểm quyền. Cờ Backend/Web context mặc định false, migrate trước bật.

Web mở hội thoại từ đơn bằng thao tác chủ động, chia sẻ lần nữa bằng nút xác
nhận; journal giữ ID/key (không lưu PII) khi mất response. Session/unmount fence
chặn kết quả tài khoản cũ. Không nhận toàn Chat DONE, media/video chưa có.

## Lát cắt Product context — 24/10/2026, chưa nghiệm thu

Message tham chiếu Product bằng `contextProductId` nullable, không lưu tên/ảnh/
giá hoặc dữ liệu nháp vào lịch sử. TEXT cũ giữ nguyên hash và wire shape.
PRODUCT_CONTEXT dùng cùng khóa gửi, sequence, quota và transaction; Backend
đọc Product thuộc Store của Conversation và áp cùng public-listing policy.
Replay cùng key trả receipt cũ sau kiểm quyền gửi; không tạo thêm Message.
Tham chiếu không FK tới Product để việc xóa/ẩn không xóa lịch sử; ID không tái
sử dụng. Nội dung placeholder cố định, không chứa chi tiết Product.
Response chỉ thêm `productContext:{productId,storeId}` cho tin tham chiếu;
Web tải thẻ qua public GET hiện có, kiểm đúng product/store, no-store và timeout.
404/ẩn/Store khóa không hiển thị thông tin cũ hoặc nháp. Không tự gửi khi mở
route; người dùng xác nhận chia sẻ, journal giữ ID/key qua mất response.
Không Search/outbox mới, không index nội dung Chat. Migration mới additive;
không sửa hai migration đã merge. Order card triển khai riêng sau lát cắt này.

## Quyết định triển khai 23/10/2026

Hoàng chốt triển khai ổn định cho phạm vi khóa luận sau khi được hỏi về
sequence theo hội thoại và chính sách Store tạm khóa. Thay quy tắc cursor
`(createdAt,id)` cũ bằng **sequence tăng riêng trong khóa hàng Conversation**;
ID toàn hệ thống chỉ định danh, không chứng minh thứ tự commit.
Read nhận Message ID rồi resolve sequence đúng hội thoại, không bao giờ lùi.
Store SUSPENDED chỉ cho gửi nếu server tìm thấy Order đúng buyer/store có trước
history SUSPENDED gần nhất; không có history/bằng chứng thì read-only. Account
owner inactive không nhận tin mới; Buyer active vẫn đọc lịch sử của mình.

Đợt runtime đầu: PostgreSQL + REST TEXT/open/history/read. Không tự gửi context
khi mở; Product context, inbox UI, realtime và ảnh/video/Order-sharing chưa được
nhận là đã triển khai. Các đoạn dưới mô tả mục tiêu toàn Chat, không phải DONE.
Adapter quyền giữ USER/SELLER hiện hành, không tự sửa Auth/membership trong Chat.
Xem [contract REST runtime](../api/chat-text-runtime.md).

Tài liệu này định nghĩa phạm vi MVP, mô hình dữ liệu, phân quyền và hợp đồng tích hợp cho chức năng Chat. Đây là chức năng bắt buộc của bản bảo vệ nhưng phải được giới hạn để không ảnh hưởng luồng thương mại điện tử và tìm kiếm cốt lõi.

## 1. Mục tiêu

- User trao đổi trực tiếp với một Store trước hoặc sau khi mua hàng.
- Có thể mở Chat từ trang chi tiết Product và gửi kèm ngữ cảnh Product.
- Tin nhắn văn bản được nhận gần thời gian thực và được lưu bền vững trong PostgreSQL.
- User và Seller xem lại lịch sử, số tin chưa đọc và trạng thái đã đọc.
- Mọi thao tác đều xác thực JWT và kiểm tra quyền ở Backend.

## 2. Ngoài phạm vi MVP

- Chat nhóm giữa nhiều khách hàng.
- Gửi file, ảnh, âm thanh hoặc video.
- Gọi thoại/video.
- Thu hồi hoặc chỉnh sửa lịch sử tin nhắn.
- Typing indicator, online presence chính xác hoặc push notification bên ngoài hệ thống.
- Mã hóa đầu cuối.
- Chatbot AI và kiểm duyệt nội dung tự động nâng cao.

Các chức năng này chỉ ghi trong hướng phát triển nếu chưa được triển khai và kiểm thử.

## 3. Actor và quyền

### User

- Tạo hoặc mở Conversation với Store.
- Gửi và đọc Message trong Conversation của chính mình.
- Mở Chat từ Product để gửi Product context.

### Seller

- Xem và trả lời Conversation thuộc Store mình sở hữu.
- Không được truy cập Conversation của Store khác.

MVP chưa có `StoreMember` hoặc quyền nhân viên cửa hàng. Hỗ trợ nhiều thành viên cùng quản lý inbox là P2 và chỉ được bổ sung khi có entity, role và acceptance criteria riêng.

### Admin

- Không mặc định đọc mọi cuộc trò chuyện.
- Khả năng xử lý báo cáo vi phạm là hướng mở rộng; nếu triển khai phải có audit và lý do truy cập.

### Quy tắc chung

- Client được gửi `storeId` và `productId` làm đối tượng đích khi tạo/mở hội thoại, nhưng không được gửi `senderId`, buyer `userId`, Store owner hoặc role để xác lập danh tính/quyền.
- Backend lấy acting user từ JWT, kiểm tra Store/Product tồn tại, Product thuộc đúng Store và người gọi có quyền tham gia Conversation.
- Không cho phép tài khoản tự chat với Store do chính mình sở hữu.

## 4. Mô hình hội thoại

MVP sử dụng một Conversation trực tiếp cho mỗi cặp User-Store:

```text
User 1 ── * Conversation * ── 1 Store
                    │
                    ├── Message[]
                    ├── ConversationReadState[]
                    └── Product context gần nhất (nullable)
```

Unique logic: `(userId, storeId)`. Khi User nhấn Chat ở Product khác của cùng Store, hệ thống mở lại Conversation và gửi/cập nhật Product context thay vì tạo hội thoại trùng.

## 5. Thực thể đề xuất

### 5.1 Conversation

- `id`: `Int` tự tăng do PostgreSQL sinh.
- `userId`: User phía người mua.
- `storeId`: Store nhận hội thoại.
- `contextProductId?`: Product gần nhất dùng để mở Chat.
- `lastMessageId?`.
- `lastMessageAt?`.
- `createdAt`, `updatedAt`.
- Unique `(userId, storeId)`.

Không dùng `productId` làm thành phần unique vì User cần tiếp tục một hội thoại với Store khi trao đổi nhiều Product.

### 5.2 Message

- `id`.
- `conversationId`.
- `senderId`: tham chiếu User đã xác thực.
- `clientMessageId`: mã idempotency do client sinh cho một lần gửi logic.
- `type`: MVP gồm `TEXT` và `PRODUCT_CONTEXT`.
- `content?`: bắt buộc với `TEXT` sau khi trim.
- `contextProductId?`: dùng với `PRODUCT_CONTEXT`.
- `createdAt`.
- Unique `(conversationId, senderId, clientMessageId)`.

Message là lịch sử giao tiếp. Không xóa cứng trong MVP; nếu cần ẩn nội dung về sau dùng trạng thái moderation/audit riêng.

Khi nhận lại cùng khóa `(conversationId, senderId, clientMessageId)`, Backend trả Message đã lưu thay vì tạo bản ghi mới và không phát thêm `message:created`.

### 5.3 ConversationReadState

- `conversationId`.
- `userId`.
- `lastReadMessageId?`.
- `lastReadAt?`.
- Unique `(conversationId, userId)`.

Không dùng một cột `Message.isRead` vì trạng thái đọc thuộc từng người tham gia, không thuộc bản thân Message.

## 6. REST API dự kiến

```text
POST /chat/conversations
GET  /chat/conversations
GET  /chat/conversations/{conversationId}
GET  /chat/conversations/{conversationId}/messages?cursor=...&limit=...
POST /chat/conversations/{conversationId}/messages
POST /chat/conversations/{conversationId}/read
```

Tạo/mở hội thoại:

```json
{
  "storeId": 10,
  "productId": 125
}
```

Gửi tin nhắn REST dự phòng:

```json
{
  "clientMessageId": "a-client-generated-id",
  "type": "TEXT",
  "content": "Sản phẩm này còn màu đen không?"
}
```

`clientMessageId` dùng chống tạo trùng khi client gửi lại sau mất kết nối. Backend cần ràng buộc idempotency phù hợp theo người gửi.

Đánh dấu đã đọc:

```json
{
  "lastReadMessageId": 987
}
```

Backend kiểm tra Message thuộc đúng Conversation, người gọi là thành viên hợp lệ và chỉ cập nhật con trỏ nếu Message mới nằm sau con trỏ hiện tại. Request lặp hoặc con trỏ cũ hơn không được làm trạng thái đọc lùi lại.

## 7. WebSocket dự kiến

NestJS sử dụng WebSocket Gateway với Socket.IO; React sử dụng `socket.io-client`.

Client gửi:

```text
conversation:join
conversation:leave
message:send
conversation:read (conversationId + lastReadMessageId)
```

Server phát:

```text
message:created
conversation:updated
conversation:read
chat:error
```

Socket phải xác thực access token khi kết nối. Mỗi lần join/send/read vẫn phải kiểm tra membership ở server; không tin room ID hoặc sender ID từ client.

## 8. Luồng gửi tin nhắn

```text
Client gửi message:send với conversationId + clientMessageId
→ Gateway xác thực socket
→ ChatService kiểm tra quyền trong Conversation
→ Validate loại và nội dung Message
→ Transaction tạo Message và cập nhật lastMessageAt/lastMessageId
→ Commit PostgreSQL thành công
→ Server phát message:created tới room Conversation
→ Client cập nhật giao diện và unread count
```

Chỉ phát sự kiện thành công sau khi Message đã được commit. Khi WebSocket lỗi, client có thể gọi REST hoặc gửi lại cùng `clientMessageId` mà không tạo Message trùng.

## 9. Phân trang, thứ tự và chưa đọc

- Lịch sử dùng cursor sequence riêng từng Conversation, không tải toàn bộ.
- Thứ tự commit trong một Conversation được cấp dưới khóa DB hàng hội thoại.
- Danh sách Conversation sắp xếp theo `lastMessageAt` giảm dần.
- Unread count được tính từ `lastReadMessageId` hoặc duy trì counter có cơ chế đối chiếu.
- Mở Conversation không tự đánh dấu đã đọc nếu client chưa xác nhận đã hiển thị tin.
- REST và WebSocket chỉ nhận `lastReadMessageId` của tin cuối cùng client thực sự hiển thị; Backend xác minh tin thuộc Conversation và con trỏ chỉ tiến về phía trước.

## 10. Validation và an toàn

- `TEXT` sau trim phải khác rỗng.
- Giới hạn độ dài nội dung bằng cấu hình Backend; đề xuất MVP 2.000 ký tự.
- Escape/render nội dung như text ở Frontend để chống XSS; không render HTML từ Message.
- Rate limit gửi tin để giảm spam.
- Không ghi access token hoặc toàn bộ nội dung nhạy cảm vào application log.
- Chỉ trả thông tin hồ sơ tối thiểu cần hiển thị trong Chat.
- Product context chỉ hiển thị nếu Product tồn tại và người nhận có quyền xem trạng thái phù hợp.

## 11. Tích hợp với các miền khác

- `User`: nguồn danh tính và vai trò.
- `Store`: phía Seller nhận hội thoại.
- `Product`: ngữ cảnh tùy chọn; xóa/ẩn Product không được xóa lịch sử Chat.
- `Order`: Chat theo Order là hướng mở rộng; nếu thêm phải dùng context riêng, không nhét dữ liệu Order vào Message text.
- Chat không thay đổi contract Backend-AI và Đạt không cần lập chỉ mục nội dung Chat.
- Nội dung Chat không được đưa vào FAISS, Elasticsearch sản phẩm hoặc dataset thực nghiệm.

## 12. Giao diện MVP

### User

- Nút `Chat với cửa hàng` tại Product detail.
- Danh sách hội thoại.
- Khung lịch sử và ô nhập tin nhắn.
- Product context hiển thị tên, ảnh nhỏ và link Product.

### Seller

- Inbox theo Store.
- Danh sách hội thoại có tin cuối, thời gian và số chưa đọc.
- Khung trả lời và Product context.

Giao diện phải có loading, empty, reconnect và error state cơ bản.

## 13. Acceptance criteria

1. User đã đăng nhập mở Chat từ Product và nhận đúng Conversation của Store.
2. User gửi tin, Seller đang kết nối nhận được mà không tải lại trang.
3. Seller trả lời và User nhận được theo thời gian thực.
4. Khởi động lại Backend hoặc tải lại trang không làm mất lịch sử.
5. Tin nhắn cũ được phân trang ổn định, không lặp hoặc mất bản ghi.
6. Người ngoài không đọc, join hoặc gửi vào Conversation.
7. Seller không truy cập được Conversation của Store khác.
8. Tin rỗng, quá dài hoặc sai type bị từ chối có cấu trúc lỗi rõ ràng.
9. Gửi lại cùng `clientMessageId` không tạo hai Message.
10. Unread count và đánh dấu đã đọc hoạt động cho cả hai phía.
11. Socket hết hạn token hoặc mất quyền bị từ chối/kết nối lại an toàn.
12. Unit test cho quyền/validation và E2E test cho REST + luồng WebSocket chính đều đạt.

## 14. Phân công

- Hoàng: Prisma schema/migration, NestJS REST/WebSocket, JWT/ownership và React User/Seller.
- Hiền: Use Case, Sequence Diagram, UI flow, test case và kiểm thử phân quyền/reconnect.
- Đạt: không cần triển khai Chat; xác nhận Product context dùng `productId` số nguyên và Chat không đi vào pipeline tìm kiếm.

Mọi thay đổi schema Chat phải có migration mới và Hiền review nghiệp vụ. Nếu mở rộng Chat sang Order, file hoặc moderation, phải cập nhật tài liệu này trước khi code.
