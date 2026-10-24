# Chat Buyer–Seller: luồng và readiness trước code

**Cập nhật23/10/2026:** Hoàng đã trả lời gate sequence/suspended theo hướng
ổn định và mở rộng cho khóa luận; quyết định hiện tại ở `chat-domain-design.md`
và `../api/chat-text-runtime.md`. Nhánh riêng đã có REST TEXT/local PostgreSQL,
hai migration mới và kiểm thử; chưa merge, chưa UI/realtime. Các mục PROPOSED/
NOT_RUN trong tài liệu09/10 dưới đây là lịch sử, không phải kết quả của nhánh
runtime mới. Không nhận quyết định của Hoàng thành approval schema của Hiền.

Ngày 09/10/2026. **PROPOSED / CHỜ HIỀN REVIEW**. Đây là đặc tả triển khai,
không phải Chat đã chạy. Không tạo migration/schema/API trong task này.
Nguồn: SRS v3.1 FR-CHT-01, UC-HT10, D08;
`chat-domain-design.md`; implementation-scope G-AFTERSALE.

## 1. Audit hiện trạng và điểm giao

- develop `c6e0ba1`: User một role USER/SELLER/ADMIN, isActive; Store sellerId
  unique, status PENDING/ACTIVE/REJECTED/SUSPENDED; Product có policy public.
- JwtStrategy REST xác minh access token, issuer/audience/expiry rồi đọc lại
  User active/role từ PostgreSQL. RolesGuard hiện dành HTTP, không dùng nguyên
  `switchToHttp()` cho Socket.IO rồi cho là WebSocket đã được bảo vệ.
- Chưa có Conversation/Message/ReadState, ChatModule/Gateway, socket packages
  hoặc inbox Buyer/Seller trong baseline. Chat domain hiện là thiết kế.
- Không phụ thuộc Checkout/Order commands để bắt đầu chat trước mua. D08 về
  hội thoại gắn giao dịch cũ cần Order đã merge và bằng chứng ownership riêng.
- Không sửa Auth đa quyền trong PR Chat. Dùng USER phía Buyer, SELLER chủ Store;
  sau PR capability chỉ đổi kiểm tra quyền, vẫn giữ ownership dữ liệu.
- Hiền review luồng/test/SRS; Hoàng giữ migration/REST/Socket.IO/inbox. Đạt
  không index nội dung Chat, chỉ cần productId chuẩn cho context.

## 2. Ma trận quyền — đề xuất cần chốt

| Actor/state | Mở hội thoại mới | Xem lịch sử | Gửi/read/join |
|---|---|---|---|
| Buyer USER active, Store ACTIVE, owner active | Có, không tự chat Store mình | Chỉ cặp buyer–Store của mình | Chỉ hội thoại của mình |
| Seller active | Không tạo thay Buyer | Chỉ Store mình sở hữu | Chỉ Store mình sở hữu |
| Store PENDING/REJECTED | Không | Hội thoại đã tồn tại theo ownership, nếu có | Chặn gửi mới; không xóa lịch sử |
| Store SUSPENDED, account owner active | Không | Buyer/owner vẫn xem lịch sử hợp lệ | Đề xuất chỉ gửi trong hội thoại có giao dịch cũ đã xác minh theo D08 |
| Account người gọi bị khóa/token hết hạn | Không | Không qua JWT/socket | Không; socket bị ngắt/không nhận push |
| Admin hoặc người ngoài | Không mặc định | Không mặc định | Không mặc định |

**Cần Hiền quyết định trước migration:** D08 cho Chat giao dịch cũ khi Store
SUSPENDED. Chưa có liên kết Order–Conversation hiện hành. Không được dùng
`Conversation.createdAt` làm bằng chứng đã mua. Đề xuất kiểm Order buyerId/storeId
đã tồn tại trước suspension (mốc StoreStatusHistory), hoặc liên kết context Order
có ownership trong PR kế tiếp. Nếu chưa có bằng chứng thì lịch sử read-only,
không tuyên bố D08 đầy đủ. SUSPENDED không phải account bị khóa.

Không tạo đường Admin/support đọc chat riêng chỉ vì D08 nhắc hỗ trợ: việc này
cần quyền/audit/reason riêng; MVP không mặc định cho Admin xem nội dung.
Nếu owner account bị khóa, Buyer vẫn đọc lịch sử của mình, nhưng không mở/gửi
tin mới vào inbox account bị khóa; Hiền xác nhận ngoại lệ này.

## 3. Luồng chính và ngoại lệ

### Mở từ Product

1. Auth active → kiểm role/Store đủ điều kiện → Product thuộc Store và public.
2. Suy buyerId từ JWT, không nhận senderId/role/userId từ client.
3. Lấy/tạo Conversation unique `(buyerId,storeId)`; concurrent create vẫn một row.
4. Chỉ thêm PRODUCT_CONTEXT khi Buyer thực sự chọn chia sẻ Product; clientMessageId
   riêng để double-click/retry không thêm context hai lần. Mở inbox đơn thuần
   không tự tạo tin hoặc thay context mỗi GET.
5. Product bị ẩn về sau: vẫn giữ lịch sử text; context render “không còn khả dụng”,
   không trả tên/ảnh/giá nội dung nháp qua Chat. Không cascade xóa lịch sử.

### Gửi TEXT qua REST hoặc WebSocket

1. Cùng ChatService/policy cho hai transport (cách truyền tin), không hai logic.
2. Kiểm JWT và DB active/ownership mỗi action; validate extra fields, trim content,
   1–2.000 ký tự; xác nhận clientMessageId đúng định dạng.
3. Trong transaction khóa Conversation; đọc lại quyền; tìm cùng sender/key.
   Cùng payload chuẩn hóa → trả Message gốc; khác type/content/context →
   `409 MESSAGE_IDEMPOTENCY_CONFLICT`, không âm thầm trả tin khác.
4. Lệnh mới tạo Message, cập nhật lastMessage, commit nguyên tử. Không gọi socket
   trong transaction và không chỉ dùng khóa trong một process.
5. Sau commit mới trả ack (xác nhận đã lưu) / phát `message:created`.
   Replay không tạo row hoặc tăng unread/phát event mới.
6. Mất ack → retry cùng key/body. Crash sau commit trước broadcast → reconnect
   tải bù bằng REST; PostgreSQL giữ Message, mạng không hứa exactly-once.

### Đọc và reconnect

- Lịch sử limit mặc định 30, tối đa 100; cursor ràng buộc Conversation.
- Read nhận Message ID đã hiển thị; phải thuộc Conversation. Cursor chỉ tiến,
  replay hoặc tin cũ không làm unread tăng lại. Unread không đếm tin mình gửi.
- Reconnect refresh access token qua Auth hiện có; join được kiểm lại membership.
  Tải bù từ server, merge theo messageId; không tin danh sách lưu cục bộ là đủ.
- Race join/fetch có thể mất event: join rồi fetch bù với high-watermark (mốc tin
  cuối đã biết), dedupe. Sự kiện tới hai lần không tạo hai dòng UI.

## 4. Đề xuất dữ liệu và thứ tự an toàn — chưa migration

Conversation: Int id, buyerId, storeId, optional contextProductId,
lastMessageId?, lastMessageAt?, createdAt/updatedAt; unique buyer/store;
FK buyer/store RESTRICT để không mất lịch sử.
Message: Int id, conversationId, senderId, clientMessageId, type,
content?/contextProductId?, payloadHash + hashVersion, createdAt.
Unique conversation/sender/clientMessageId; FK sender RESTRICT, không xóa account
vật lý để xóa lịch sử; optional Product context SET NULL/RESTRICT theo migration
review, tuyệt đối không cascade Message từ Product.
ReadState: conversationId/userId unique, lastReadMessageId?, lastReadAt.
Composite FK bảo vệ lastMessage/read Message thuộc đúng Conversation; membership
vẫn kiểm ở service, không giả rằng FK User đã chứng minh người tham gia.

**Điểm cần chốt:** domain đang dùng `(createdAt,id)` và read theo Message ID.
ID auto-increment có thể được cấp trước khi transaction khác commit; đọc cursor
lớn hơn không tự bảo đảm tin nhỏ hơn đã xuất hiện. Đề xuất thêm `sequence` tăng
trong khóa row Conversation, unique `(conversationId,sequence)`; read/unread và
cursor/recovery dựa sequence, API read vẫn nhận Message ID rồi resolve sequence.
Nếu chọn cách này, cập nhật domain/SRS/contract trước code; không tự coi đã duyệt.
Không dùng đồng hồ client hoặc ID toàn cục làm thứ tự commit trong Conversation.

CHECK Message type/content/context theo từng type; text trim khác rỗng,
clientMessageId bounded ASCII, payloadHash/version hợp lệ; index conversation/seq
và inbox. Read cursor không lùi trong transaction. Không lưu token trong bảng Chat.
Migration mới kiểm empty/existing DB; không chỉnh migration đã merge của Order.

## 5. API đề xuất và lỗi

Giữ paths trong chat-domain-design, chưa khai là endpoint chạy:

| Endpoint/action | Phạm vi |
|---|---|
| POST /chat/conversations | Lấy/tạo cặp Buyer–Store, Product context được validate |
| GET /chat/conversations | Inbox của actor, cursor/limit |
| GET /chat/conversations/:id | Metadata tối thiểu đúng quyền |
| GET /chat/conversations/:id/messages | Trang lịch sử hoặc tải bù, không cả hai cursor mâu thuẫn |
| POST .../messages | TEXT/PRODUCT_CONTEXT, clientMessageId; sender suy JWT |
| POST .../read | Message ID trong Conversation, cursor chỉ tiến |
| Socket join/leave/send/read | Cùng policy và service REST |

Lỗi: 400 validation, 401 expiry/inactive, 403 role (trước ownership lookup),
404 CONVERSATION_NOT_FOUND cho không tồn tại/ngoài scope, 409 conflict/read-only,
429 CHAT_RATE_LIMITED + Retry-After. Không trả existence/account info của người khác.
Đề xuất quota: gửi 20/phút/actor, mở 10/phút/Buyer, đọc 60/phút/actor; cấu hình
nhóm chọn, không gán thành chính sách Shopee. In-memory chỉ bảo vệ một instance;
nếu multi-replica cần shared limiter riêng, không tự thêm Redis ở task này.

Socket token qua auth payload, không URL/query. Kiểm signature/issuer/audience/exp,
đọc DB active và quyền; không tái dùng HTTP guard không phù hợp context.
Expiry timer disconnect; khi dispatch tới room phải lọc recipients active/đúng
membership/token còn hạn, không chỉ dựa join lúc đầu. Role/owner bị đổi thì rời
room trước nhận payload. CORS origin allowlist, không `*` với credentials.
Render TEXT bằng React text, không HTML; không log nội dung, JWT hoặc raw key.

## 6. Chia PR nhỏ theo thứ tự

1. Review tài liệu này: Hiền chốt quyền suspended/khóa, context, thứ tự/cursor/quota.
2. Schema/migration + constraints, concurrency tests (không UI/Socket chưa kiểm).
3. REST/policy/history/read/idempotency, E2E hai buyer/hai Seller/ngoài scope.
4. Socket.IO adapter cùng service, expiry/room/reconnect tests; không sửa Auth role.
5. Buyer inbox/Product button + Seller inbox, loading/empty/error/reconnecting,
   browser evidence hai tài khoản; không làm trùng Address/Cart/Admin của Hiền.

## 7. Ma trận test cần có — tất cả NOT_RUN

| ID | Ca | Kết quả |
|---|---|---|
| CHT-01 | Hai lần tạo cùng cặp qua hai connection | Một Conversation |
| CHT-02 | Buyer/Seller khác, Admin đọc/join/send/read | Không lộ nội dung/metadata |
| CHT-03 | Tự chat, Product Store khác/nháp | Reject, không tạo context |
| CHT-04 | Gửi cùng key cùng/khác payload REST + socket | Một Message/replay hoặc 409 |
| CHT-05 | Hai gửi cạnh tranh và rollback | Thứ tự/cursor ổn định; lastMessage đúng |
| CHT-06 | Read tin ngoài conversation/tin cũ, unread tin mình | Reject hoặc no-op đúng; cursor không lùi |
| CHT-07 | Crash trước/sau commit, mất ack/broadcast | Rollback hoặc REST recovery, không nhân bản |
| CHT-08 | Reconnect có tin tới lúc join/fetch | Không mất tin, UI dedupe |
| CHT-09 | Token hết hạn/account khóa/role đổi trong room | Không gửi hoặc nhận payload mới |
| CHT-10 | Store SUSPENDED/giao dịch cũ | Theo decision đã review; không mở bán mới |
| CHT-11 | Product hidden/deleted context sau chat | Không lộ nháp, không xóa text history |
| CHT-12 | Rỗng/quá dài/extra fields/quota/XSS | Reject/render text, Retry-After đúng |
| CHT-13 | Restart Backend | Lịch sử/read state còn PostgreSQL |
| CHT-14 | Browser Buyer ↔ Seller, pagination | Realtime + history + unread chạy đúng quyền |

## 8. Reviewer cần trả lời trước code

Hiền review 4 quyết định: (1) chứng minh giao dịch cũ ở SUSPENDED; (2) recipient
khóa/account active distinction; (3) sequence/cursor đổi so với domain;
(4) quota và idempotency payload conflict. Nếu chưa chốt, vẫn chuẩn bị test/layout
độc lập nhưng không tạo migration hoặc quảng cáo Chat CURRENT.

Thuật ngữ: ownership = quyền trên dữ liệu của mình; transaction = nhóm ghi cùng
thành công/rollback; idempotency = gửi lại không tạo tin thứ hai; cursor = mốc
phân trang/tải bù; ack = xác nhận đã lưu; canonical = trạng thái chuẩn ở PostgreSQL.
