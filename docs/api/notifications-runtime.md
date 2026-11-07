# Thông báo trong ứng dụng — contract triển khai 27/10/2026

Đã kiểm thử trên nhánh riêng từ Web Review #125, chỉ tính tích hợp sau merge. Nguồn
SRS FR-NOT-01 và phạm vi P0. Email adapter là P1 riêng, không gọi là đã gửi email.

PostgreSQL Notification là read model từ lịch sử nghiệp vụ đã commit; không
phải nguồn chuẩn trạng thái Order/Product. Projector không được gọi trong main
transaction, không gọi nhà cung cấp ngoài. Lỗi tạo/gửi thông báo không rollback
đơn, tiền, kho hoặc kiểm duyệt. Source event còn lại để chạy lại.

Khóa duy nhất recipient+sourceKind+sourceId+channel=IN_APP. sourceId luôn là PK
của history/audit/message, không reviewId/productId/orderId. Payload/identity
bất biến, readAt chỉ null→timestamp, không có API xóa. Không copy Chat content,
moderation reason, địa chỉ, token hoặc Payment snapshot.

Sources: OrderStatusHistory→Buyer/Store owner; StoreStatusHistory→owner (audience
ACCOUNT để USER chưa được duyệt vẫn nhận từ chối); ProductStatusHistory→Seller;
AftersaleHistory→Buyer/Seller; ChatMessage→đối tác còn lại; ProductReviewAudit
create/edit→Seller, reply/hide→Buyer. Actor không nhận lại thao tác của mình.
Admin đang hoạt động nhận Store/Product PENDING hoặc hậu mãi DISPUTED chỉ
khi đối tượng hiện còn chờ và Admin được tạo không sau event. Không backfill
các quyết định đã xử lý cho Admin mới, không dùng cutoff ngày làm rơi event P0.

Tuple recipient/event được tạo trước LIMIT, lọc self/status trước LIMIT, dedupe
audience theo ưu tiên ACCOUNT→BUYER→SELLER→ADMIN khi cùng event/recipient. API
không chuyển quyền sở hữu Store/Order. USER đọc ACCOUNT/BUYER; SELLER thêmSELLER;
ADMIN đọc ACCOUNT/ADMIN. Demote không xóa lịch sử nhưng không đọc/đánh dấu được
audience đã mất quyền. Destination link vẫn phải tự kiểm lại quyền hiện hành.

Projector anti-join NOT EXISTS + ON CONFLICT DO NOTHING, không checkpoint MAX(id)
của source để tránh mất low-id commit muộn. Mỗi source tối đa100tuple/batch;
actor GET ưu tiên event gần đây, worker xử lý event cũ để không bỏ đói backlog.
syncPending=true nếu lỗi hoặc chạm batchlimit, không nhận đã bắt kịp khi còn
backlog. Admin fan-out cũng giới hạn tuple, không LIMIT trước join recipient.

Mỗi batch lấy dữ liệu source bằng MVCC, rồi transaction riêng: advisory lock
namespace721035 từng recipient theo id tăng → INSERT unique keys có thứ tự.
Mọi projector dùng cùng lock trước cấp Notification.id, nên thứ tự id/commit
trong cùng recipient không đảo do writer đồng thời. Mark read dùng cùng lock,
khóa User FOR SHARE rồi kiểm active/role/cv; không khóa Order/Store/Product.
Không lock User FOR UPDATE trong projector hoặc network trong transaction.
Read committed, timeout ngắn, retry có giới hạn cho40001/40P01; lỗi giữ event.

GET /account/notifications?limit=20&beforeId=<bigint>&unread=true|false: canonical
query, no unknown/duplicate/array/body, limit1..50, id string1..9223372036854775807.
Actor-filtered projection riêng trước snapshot RepeatableRead read-only đọc
page/unreadCount/throughId. Query/biên lỗi no-store trước guard.
Response {items,nextBeforeId,unreadCount,throughId,syncPending}; item chỉ
{id,title,text,link,eventAt,createdAt,readAt}; không recipient/audience/source.
id DESC là thứ tự lưu inbox, không nhận mọi loại event có thứ tự thời gian toàn cục.

POST /account/notifications/:id/read {confirmed:true}: idempotent chỉ own/audience;
POST /account/notifications/read-all {confirmed:true,throughId:<bigint-string>}
chỉ đánh dấu id≤mốc đã nhận từ inbox. Mốc phải thuộc own/audience. Writer cùng
recipient dùng advisory lock nên event mới lưu sau snapshot có id lớn hơn,
không bị mark-all quá mốc. Lỗi mạng không khẳng định readAt; tải GET lại. Không
cần journal giao dịch tiền cho trạng thái đã đọc, không tự POST khi reload.

Web inbox/badge, loading/empty/error/syncPending, phân trang, explicit click
mark one/all; epoch/AbortController/latch chặn chéo tài khoản và same-tick. Nội
dung render text; link chỉ route nội bộ allowlist, không URL provider tùy ý.
Cờ NOTIFICATIONS_ENABLED/VITE_NOTIFICATIONS_ENABLED/NOTIFICATIONS_WORKER_ENABLED
mặc địnhfalse. Worker tắt QA, gọi projector fixture có kiểm soát.

Review thiết kế Argon Medium: chốt LIMIT sau fan-out, syncPending khi đủ batch,
sourceId đúng audit/message, Admin pending hiện hành, audience/dedupe rõ ràng,
insert/mark-read lock cùng recipient và read-all có mốc. Không áp nguyên nhãn
P1 của giả thuyết chưa thành code. Phải QA event commit muộn, rollback source,
duplicate projectors, actor freshness, role demotion và main state bất biến.

Email nghiệp vụ có lát cắt riêng ngày 28/10/2026 trên nhánh từ d5815d5; xem [contract và giới hạn](business-notification-email.md). Chỉ tính tích hợp sau merge; Mailpit QA không phải gửi thư ra ngoài.
