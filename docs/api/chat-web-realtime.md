# Chat Web/realtime — nhánh triển khai 24/10/2026

IN_PROGRESS, phụ thuộc #110 (`5b443da`). Chưa có trên develop; không tự merge
hoặc gọi toàn FR-CHT-01/G-AFTERSALE hoàn thành. Không thay schema/migration,
Product/Search hoặc nghiệp vụ Address/Cart/Admin của Hiền.

## Điểm chạy

- Backend dùng `CHAT_TEXT_ENABLED=true` sau đủ21migration của #110; mặc định false.
- Frontend `VITE_CHAT_ENABLED=true`, `VITE_API_URL` đúng Backend; mặc định false.
- Route chung `/messages[/conversationId]` chỉ USER/SELLER. Link Header và
  Product detail dẫn vào inbox; từ Product, người mua xác nhận mở Store cụ thể.
  Không tự tạo Message/PRODUCT_CONTEXT hoặc POST khi tải route/reload.
- Giữ bộ màu/font/spacing `--market-*` của storefront cam đã chọn. OS dark
  không tự tạo theme cục bộ khác shell; đã sửa title contrast khi xem ảnh QA.

## Socket contract

Socket.IO namespace `/chat`, websocket transport, max frame16KiB. Token trong
handshake `auth.token`, không URL/query. Origin chỉ `FRONTEND_URL` (mặc định
localhost5173); native client không Origin vẫn phải JWT. Không CORS wildcard.
Kiểm signature HS256/issuer/audience/type/expiry và User active/current role/
credentialVersion; không dùng role client để cấp membership.

Server `chat:ready` sau auth; client gửi và nhận acknowledgement:

| Action | Body | Ack data |
|---|---|---|
| conversation:join | `{conversationId}` | Metadata như REST detail |
| conversation:leave | `{conversationId}` | `{conversationId}` |
| message:send | `{conversationId,message:{clientMessageId,type:"TEXT",content}}` | REST Message/replay |
| conversation:read | `{conversationId,lastReadMessageId}` | REST read cursor |

Ack `{ok:true,data}` hoặc `{ok:false,error:{status,code}}`; không echo SQL,
token/key/content trong lỗi. Permission/validation/atomic write cùng ChatService
với REST; shared quota ingress cùng actor/instance open10/send20/read60 mỗi phút.
Không chống spam bằng cách chia quota riêng từng transport.

Sau Message commit mới phát `message:created` có Message allowlist; read cập
nhật phát `conversation:updated {conversationId}`. Replay không phát Message
mới. Đây là hint best-effort, có thể coalesce/không đến khi disconnect; không
hứa exactly-once, ordering transport không thay sequence PostgreSQL. Web không
tin event để tiến watermark, mà tải mọi sequence còn thiếu qua REST.

## Bảo vệ nhận tin và vòng đời gateway

- Token được kiểm sau DB lookup; timer expiry ngắt socket và mỗi action kiểm
  lại trước/sau xử lý. Lỗi sau write commit vẫn có thể là kết quả chưa rõ,
  không đổi key hoặc suy rollback từ lỗi mạng/401.
- Trước private push: authorization transaction ngắn READ COMMITTED khóa User
  SHARE → Store SHARE → Conversation, đọc canonical ownership và credential.
  Kiểm expiry ngay trước enqueue đồng bộ; không await mạng trong giao dịch này.
  Khóa bảo vệ thay role/credential/owner trong lúc quyết định phát, không ghi
  Message mới. Message đã commit ở giao dịch trước; không phát từ write transaction.
- Join/leave có generation riêng cho socket: join cũ chờ DB không ghi đè leave/
  join mới. Không nhân subscription; tối đa1hội thoại/socket và5socket/actor.
- Chặn trước auth khi≥32handshake pending hoặc≥1000peer; rejected cap không
  tiêu thụ thêm quota sau khi biết actor. Delivery queue≤1000conversation,
  coalesce latest hint, tối đa8recipient query song song mỗi batch. Sweep10s
  cũng tối đa8, không Promise.all1000 DB query. Không distributed broker.
- Destroy đặt fence trước unsubscribe, clear timer/queue và ngắt cả pending
  handshake; kết quả DB đến muộn không đăng ký peer/timer mới.

## Web: gửi, tải bù và đổi phiên

Mở socket → join được server xác minh → tải REST latest page/catch-up. REST
poll15s khi tab visible là fallback khi broadcast mất hoặc khác instance; inbox
refresh30s. Sequence liên tục/shape/ID được validate trước tiến watermark.
Render TEXT bằng React text; không innerHTML. History có pagination riêng;
read chỉ POST khi người dùng xác nhận các tin đã hiển thị, không chỉ mở route.

Trước gửi, tạo UUID và lưu `{version,actorId,conversationId,clientMessageId,content}`
vào sessionStorage của actor; đọc lại xác minh write thành công. Nội dung tin
chờ là dữ liệu riêng tư trong tab, có thông báo UI; không lưu token/history.
Timeout/malformed200/reload giữ key/content gốc; retry chỉ theo thao tác chủ động.
Một pending/actor/tab chặn gửi mới ở hội thoại khác. Receipt phải đúng sender/
conversation/content; chỉ xóa raw journal khớp, không xóa pending đã thay đổi.
Known receipt nhưng GET lỗi chỉ tải GET lại, không gửi lệnh khác tự động.
Đổi phiên/unmount không acknowledge kết quả cũ; 401/403/404 xóa history render
không còn quyền. Storage hỏng/lỗi giữ fail-closed. Đóng tab có thể mất pending;
PostgreSQL vẫn lưu Message đã commit, không tuyên bố phục hồi qua đóng tab.

## Giới hạn

Chưa PRODUCT_CONTEXT/media/video/Order card, unread/read receipt UX đầy đủ,
multi-replica push/broker, benchmark tải lớn hoặc OS crash. Hai tài khoản Chrome
và Nest restart không thay OS/power loss. UI text/realtime đạt QA chưa đồng nghĩa
scope toàn Chat đã merge/đủ nghiệm thu; #110 còn cần review schema/runtime.

Nguồn kỹ thuật: [Nest gateways](https://docs.nestjs.com/websockets/gateways),
[Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/),
[Socket.IO server options](https://socket.io/docs/v4/server-options/).
