# Chat TEXT REST — runtime slice, 23/10/2026

IN_PROGRESS, chưa merge/Frontend/realtime; không nhận toàn Chat báo cáo hoàn tất.
`CHAT_TEXT_ENABLED=false` mặc định; migration phải có trước khi bật API.
PostgreSQL là nguồn chuẩn. Không gửi nội dung vào Search hoặc logs.

- POST `/chat/conversations` body `{storeId}`: active USER mở lại/tạo đúng1 cặp
  buyer/store ACTIVE, không tự chat hoặc tự thêm Message. Retry không nhân hội thoại.
- GET `/chat/conversations/:id`: metadata tối thiểu và unreadCount của actor.
- GET `/chat/conversations?limit=30&cursor=...`: inbox thật, chỉ hội thoại của
  actor đang hoạt động. SELLER có ngữ cảnh Store của mình; ngữ cảnh Buyer chỉ
  theo cờ quyền mua hiện có. `context` BUYER/SELLER giúp UI phân biệt, không
  tự cấp quyền. Không nhận buyerId/storeId/role làm bộ lọc xác lập quyền.
  Response `{items,nextCursor}`; item gồm id/context, store{id,name},
  buyer{id,fullName}, lastSequence/lastMessageAt, lastMessage hoặc null,
  lastReadSequence/unreadCount. Message dùng cùng allowlist history, không
  key/hash/email/phone/địa chỉ; GET không tự đánh dấu đọc.
  Limit1..100, mặc định30; unknown/duplicate query hoặc cursor sai trả400.
  Cursor opaque là base64url canonical `[lastMessageAt|null,id]`, không phải
  token xác thực. Server luôn AND cursor với ownership SQL hiện hành.
  Sắp lastMessageAt giảm dần, null cuối, id giảm dần để xử lý cùng timestamp.
  Đây là **inbox live**, không snapshot xuyên nhiều HTTP request: hội thoại có
  tin mới có thể di chuyển lên trên cursor cũ; refresh từ đầu để nhận lại nó.
  Không dùng cursor inbox để tải bù Message; history dùng sequence riêng.
  Toàn bộ trang + unread đọc cùng Serializable READ ONLY snapshot, không khóa
  hàng hội thoại hoặc tăng read state. Không N+1 count từng hội thoại: chỉ một
  groupBy có phạm vi tập ID trang và con trỏ đọc tương ứng.
- GET `.../:id/messages?beforeSequence=N&limit=30`: lịch sử mới nhất mặc định,
  lấy lùi theo sequence; items trả tăng dần. `afterSequence` dùng catch-up tăng
  dần; `afterSequence=0` tải từ đầu khi trước đó hội thoại rỗng, before phải≥1.
  Không kết hợp hai cursor. Limit1..100, số nguyên canonical; từ chối query
  lạ/trùng. highWatermark là lastSequence trong snapshot giao dịch, không hứa
  socket exactly-once. Cursor scope bởi path đã kiểm quyền.
- POST `.../:id/messages`: `{clientMessageId,type:"TEXT",content}`. ASCII
  printable1..128khôngspace; trim content1..2000codepoints; reject extra field,
  control/lone surrogate. Cùng conversation/sender/key+hash trả Message gốc,
  replay=true; khác payload409 MESSAGE_IDEMPOTENCY_CONFLICT. Payload hash/key
  không trả trong lịch sử. TEXT render text, không HTML ở Frontend tương lai.
- POST `.../:id/read`: `{lastReadMessageId}` đúng hội thoại; chỉ tiến. Opening
  hoặc GET không đánh dấu đọc. Unread chỉ đếm tin người kia, không tin mình.

JWT + fresh DB actor/ownership mỗi transaction. ADMIN không mặc định đọc;
Tài khoản SELLER không phải owner được dùng ngữ cảnh Buyer chỉ khi cờ server
`ACCOUNT_BUYER_ACCESS_ENABLED=true` của #106; buyerId vẫn phải khớp SQL. Không
thay JWT/User.role; tin của ngữ cảnh này có senderType BUYER. Owner vẫn phải
dùng quyền Seller; không tự chat Store mình hoặc cấp Admin quyền Buyer.
người ngoài/không tồn tại cùng404. Owner inactive: Buyer vẫn đọc, không gửi.
SUSPENDED chỉ gửi nếu Order đúng buyer/store createdAt trước StoreStatusHistory
SUSPENDED gần nhất; missing proof read-only. Không role hierarchy/StoreMember.

Serializable transaction + bounded3retry conflict/deadlock, row lock hội thoại
trước replay/cấpsequence; message/parentupdate cùngcommit. Sequence không dùng
Date/client/globalID. Lỗi giữa giao dịch rollback; Message bất biến và FK RESTRICT
giữ lịch sử. Sau3retry trả503/Retry-After1; không log body/hash/token.
Quota single-instance open10/send20/read60 perminute/actor, memory bounded;
không bảo đảm quota cluster. Không thêm broker/Redis cho đợt này.

Hai migration mới:20tạo bảng/append/history/read guards;21fence identity/counter
Conversation và deferred check counter phải khớp history khi commit. Không cho
counter-only advance hoặc reset/đổi participant. Chưa sửa migration dùng chung.
Migration mới phải qua QA fresh/upgrade và không sửa migration cũ. Realtime
adapter sau này dùng cùng service, chỉ emit saucommit; disconnect/reconnect
đọc bù bằng afterSequence. Crash trướcbroadcast không mất Message đãcommit.
Chưa triển khai Product context/media/Order card hoặc hỗ trợ nhiều owner.
Inbox REST đã có trên nhánh này; inbox Web và realtime chưa triển khai.

## Các biến để đọc code

| Tên | Ý nghĩa/lưu ở đâu |
|---|---|
| buyerId/storeId | Cặp chủ thể bất biến của chat_conversations; không nhận buyerId từ body |
| lastSequence | Tin commit cuối trong một hội thoại, ban đầu0; DB counter phải khớp history |
| sequence | Thứ tự tin riêng trong hội thoại; không phải id toàn hệ thống |
| clientMessageId | Mã một lần gửi logic; retry giữ nguyên mã và nội dung |
| payloadHash/hashVersion | SHA256 dữ liệu chuẩn hóa có conversation+sender; nội bộ, không trả history |
| lastReadMessageId/lastReadSequence | Tin đã hiển thị và thứ tự tương ứng; composite FK cùng hội thoại |
| highWatermark | Mốc lastSequence trong snapshot đọc; client tải bù sau mốc bằng afterSequence |
| replay | true khi đã lưu đúng key/payload; không có Message/sequence mới |

Không dùng session/process lock làm bảo đảm duy nhất; quota memory chỉ chống
spam trong một instance. API/UI chưa merge không tính vào báo cáo chức năng xong.
