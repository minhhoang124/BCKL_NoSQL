# Contract chung hậu mãi và Dashboard —25/10/2026

TARGET, chưa có migration/API runtime. Phạm vi theo
[implementation-scope](../project/implementation-scope.md#hậu-mãi-cơ-bản) và
[nghiệp vụ](../analysis/marketplace-business-processes.md). Không chuyển P1 sang
mở rộng. Contract này chốt nghĩa dữ liệu và acceptance criteria trước code;
không dùng làm bằng chứng đã có refund/Dashboard thật.

## 1. Nguồn tiền chung

PostgreSQL giữ Order/OrderItem snapshot, Payment và RefundRecord. Elasticsearch,
FAISS, bảng UI hoặc callback browser không quyết định số tiền hay trạng thái.
Mọi tiền VND dùng Decimal(14,2), trả chuỗi hai chữ số thập phân. Tổng aggregate
dùng numeric rộng hơn từng dòng; không tính bằng JS float hoặc ép về int32.

- Gross hàng hóa: tổng `Order.subtotal` của đơn COMPLETED, theo `completedAt`,
  Payment PAID/VND hợp lệ. Không dùng createdAt/deliveredAt làm ngày doanh thu.
- Refund hàng hóa: toàn `OrderItem.lineTotal` snapshot, đúng một lần theo item
  trên tất cả request/key. Không hoàn shipping và không nhận amount từ client.
- Net kỳ = gross ghi nhận trong kỳ trừ adjustment có hiệu lực trong kỳ. Refund
  kỳ sau có thể làm net kỳ đó âm; không ép về0. Shipping trình bày riêng, không
  gọi net/gross là lợi nhuận hoặc tiền thực thu/settlement.
- Bản đầu hỗ trợ snapshot `discountTotal=0`, `subtotal=sum(lineTotal)`,
  `total=subtotal+shippingFee`, `lineTotal=unitPrice*quantity`, quantity>0, tiền
  không âm. Payment.amount=Order.total; paidAt không nằm tương lai. Kiểm toàn
  Order ở lúc tạo yêu cầu và trước refund. Không đoán phân bổ discount cũ.
- Không đổi Payment.PAID thành UNPAID để biểu diễn refund một item. RefundRecord
  riêng, mode SIMULATED, currency VND, amount dương, liên kết Payment/OrderItem.
  Đọc Dashboard không trừ Payment hoặc ReturnRequest thêm lần nữa.

Một RevenueAdjustment âm liên kết duy nhất RefundRecord được tạo ngay lúc refund
thành công. `effectiveAt=NULL` nếu chưa COMPLETED; nếu đã hoàn tất:
`effectiveAt=max(refundSucceededAt,completedAt)`. Khi Buyer hoặc system hoàn tất,
cùng Order lock/transaction phải kích hoạt mọi adjustment chờ tại completedAt.
Gross và adjustment của item hoàn trước completion cùng kỳ nên net item=0.
Không cấm completion hoặc đổi ngược OrderStatus vì hậu mãi.

Ví dụ: hàng100000, shipping20000. Hoàn toàn item trước completion: refund mô
phỏng100000 được ghi, gross/net trước completion đều0, pending refund100000.
Khi completion: gross100000/refund effective100000/net0, shipping20000 riêng.
Completion tháng10/refund tháng11: tháng10 net100000, tháng11 net-100000.

## 2. Quyền, điều kiện và vòng đời

Actor hiện hành active, credentialVersion/JWT canonical. Buyer gồm USER/SELLER
đang mua đúng đơn của mình; không suy role SELLER đồng nghĩa chủ mọi Order.
Seller xử lý theo Store sở hữu hiện tại, không nhận storeId do client cấp quyền.
Admin active mới được quyết định bất đồng. Mất quyền sau khi chờ lock phải bị
từ chối. Resource ngoài quyền trả404; guest401, role không phù hợp403.

Đơn phải DELIVERED/COMPLETED, có deliveredAt hợp lệ không tương lai, Payment
PAID hợp lệ; Buyer tạo trong cửa sổ cấu hình `AFTERSALE_REQUEST_WINDOW_DAYS`
(đề xuất mặc định7, giới hạn1..30, là tham số demo của nhóm). Tính từ deliveredAt
canonical, tại đúng deadline vẫn nhận. Snapshot request lưu deadline đã áp dụng;
đổi cấu hình sau đó không âm thầm đổi thời hạn request đã tạo. Request sai thời
hạn409; tiền snapshot không hợp lệ422 `AFTERSALE_SNAPSHOT_REVIEW_REQUIRED`.

Buyer chọn `REFUND_ONLY` hoặc `RETURN_AND_REFUND`, reasonCode thuộc allowlist và
mô tả NFC trim10..1000 codepoint, chặn lone surrogate/control không cho phép.
Không gửi URL ảnh/bằng chứng tùy ý trong bản đầu. Thời gian/amount/actor/status
đích không do client tự đặt.

| Thao tác | Nguồn → đích | Hiệu ứng cùng commit |
|---|---|---|
| Buyer tạo | chưa có → PENDING | snapshot policy, history, giữ hạn mức item |
| Buyer rút | PENDING → CANCELLED | history, giải phóng hạn mức |
| Seller từ chối | PENDING → REJECTED | reason/history, giải phóng hạn mức |
| Buyer bất đồng | REJECTED → DISPUTED | reason/history, giữ lại hạn mức nếu chưa request khác giữ |
| Seller chấp thuận hoặc Admin chấp thuận DISPUTED, REFUND_ONLY | PENDING/DISPUTED → REFUNDED | refund+adjustment+history, không hoàn kho |
| Chấp thuận RETURN_AND_REFUND | PENDING/DISPUTED → AWAITING_RETURN | history, giữ hạn mức; chưa refund/kho |
| Seller/Admin xác nhận nhận hàng | AWAITING_RETURN → REFUNDED | receivedAt/restockability/reason, refund+adjustment; movement chỉ khi RESTOCKABLE |
| Admin từ chối bất đồng | DISPUTED → ADMIN_REJECTED | reason/history, giải phóng hạn mức |

Không nhận DISPUTED lần hai từ ADMIN_REJECTED; đó là bất đồng một cấp trong P1.
Seller SUSPENDED/CLOSED vẫn được xử lý hậu mãi đơn cũ đã giao (không cấp quyền
bán mới); User bị khóa không được thao tác, Admin đảm nhiệm. Hàng nhận lại không
RESTOCKABLE vẫn refund theo quyết định đã duyệt, không tăng kho; bắt buộc lý do.

**Nhiều request theo item:** không unique ReturnRequest.orderItemId vĩnh viễn.
Theo scope, REJECTED/CANCELLED không giữ hạn mức; Buyer có thể tạo yêu cầu mới
trong cửa sổ còn lại. ADMIN_REJECTED cũng kết thúc hạn mức ở P1, không tự chuyển
thành approved. Dưới OrderItem lock, tối đa một request giữ hạn mức thuộc
PENDING/DISPUTED/AWAITING_RETURN; DB partial unique index bảo vệ thêm.
DISPUTE request cũ khi request mới đang giữ hạn mức trả409
`ORDER_ITEM_ALREADY_FULLY_REFUNDED` (mã scope dùng cả trường hợp reserved).
RefundRecord uniqueOrderItem trên mọi request; không dùng uniqueness theo key
để thay ngân sách item. Thành công cuối cùng chỉ một refund/movement/adjustment.

## 3. Command, giao dịch và hoàn kho

Mọi ghi có UUIDv4 canonical, expectedRevision cho chuyển trạng thái, lý do và
history actor/before/after/time. Unique(actorId,commandId), canonical hash chứa
action,target,expectedRevision và normalized body. Cùng key khác action/target/
body409; replay khớp trả receipt cũ sau kiểm quyền hiện hành, không chạy lại.
Creation không có request revision nhưng target là OrderItem; revision request
bắt đầu1, tăng đúng1 mỗi thay đổi, không reset/no-op giả. Audit/refund/command
append-only; không sửa receipt cũ để giống current state.

Thứ tự khóa ứng viên: User actor → Store SHARE → Order UPDATE → Payment UPDATE
→ OrderItem UPDATE → request UPDATE → Product UPDATE theoID → Variant update
theoID → receipt/refund/adjustment/movement/history/outbox. Actor/key khác Order
vẫn serialize qua User lock. Completion khóa cùng Order trước đọc completedAt
và kích hoạt adjustment; migration hook phải có ở cả Buyer/system completion.

Đối chiếu source25/10: cancellation lấy User→Store→Order→Payment→Product;
checkout lấy User→Product trước **tạo Order mới**, không khóa Order cũ; completion
lấy Store→Order→Payment và job nếu có. Không kết luận deadlock chỉ từ từ khóa
Product→Order vì checkout không giữ Order cũ. Đây là lock graph ứng viên, phải
probe runtime với stock/admin/product/checkout/cancel trước khi merge API;
sortVariant đơn lẻ không phải chứng minh hết deadlock.

SERIALIZABLE/retry bounded3 cho structured40001/40P01 đã abort; timeout/unknown
không tự chạy lại mutation. StockMovement RETURN_RESTORE uniqueOrderItem+type,
quantityDelta bằng quantity snapshot, tăng đúng variant cùng Product/Store.
Chặn integer overflow và sai movement provenance; rollback toàn giao dịch khi
enqueue/audit/stock lỗi. Product/Search outbox cùng commit khi tăng kho ảnh
hưởng availability; provider/SMS/broker/network chạy ngoài transaction.

Explicit command reconcile phải được thiết kế/test trước khi nối UI ghi:
receipt tồn tại thì validate/return; chưa có thì CLOSED fence, không tự tạo
request/refund/receive. Không kết luận từ current status rằng command đã xử lý.
Legacy client hoặc UUID khác không được replay để né pending.

## 4. API dự kiến và dữ liệu bàn giao

Prefix dự kiến `/aftersales`, `/seller/aftersales`, `/admin/aftersales`:
POST tạo theo orderItemId; GET list/detail/history theo canonical ownership;
POST cancel/dispute/decision/receive theo requestId; POST command reconcile theo
target/action. Command responses có commandId, outcome, receipt và current riêng.
GET no-store, strict query allowlist/cursor/limit≤50, response allowlist, không
trả address/phone/token/hash khi không cần. Exact DTO/error/status sẽ được đóng
băng và test ở PR API; không quảng cáo các route dự kiến là endpoint đã có.

Dashboard đề xuất GET `/admin/dashboard` và `/seller/dashboard` với exact query
`from`, `to` ngày YYYY-MM-DD, `bucket=day|month|quarter` (mặc địnhday). from/to
là ngày địa phương inclusive/exclusive, giới hạn366ngày; reject query lạ/trùng/
array. Asia/Ho_Chi_Minh→UTC `[from,to)`, trả timezone/range/asOf rõ ràng. Không
đọc timezone hoặc Store tùy client. Một RepeatableRead READ ONLY/no-store,
timeout và bounded aggregate, không audit/Search mutation.

| Trường | Nguồn/phạm vi/nghĩa thời gian |
|---|---|
| currentUserCountsByRoleAndActive (Admin) | User hiện hành tại asOf, không phải số người tạo trong range |
| currentStoreCountsByStatus (Admin) | Store theo đúng enum tại asOf, gồm PENDING/SUSPENDED/CLOSED |
| currentProductCountsByStatus | Product hiện hành, Seller giới hạn Store canonical; không giới hạn50 dòng UI |
| createdOrderCountsByCurrentStatus | Order.createdAt trongrange, phân loại currentStatus tại asOf; không giả lịch sử trạng thái |
| completedOrderCount/grossMerchandise | completedAt trongrange, snapshot/payment hợp lệ |
| effectiveRefundMerchandise | adjustment effectiveAt trongrange đúng một lần |
| netMerchandise | gross-effectiveRefund, có thể âm |
| completedShipping | shippingFee đơn completed trongrange, riêng gross/net |
| pendingRefundMerchandise | refund thành công chưa có effectiveAt tại asOf, độc lập range và ghi rõ lifetime pending |

Buckets và totals dùng cùng predicate/numeric, không fetch50 rồi cộng. Một dòng
Order lỗi bị loại **toàn bộ gross và adjustment liên quan** khỏi tiền tổng hợp,
trả dataQuality.invalidSnapshotOrderCount trong tập Order đóng góp range hoặc
pending; không rơi một vế làm net sai. Operational counts vẫn là count độc lập.
Admin có endpoint tra lỗi allowlist/limit ở PR API; Seller chỉ lỗi của Store
mình. Không âm thầm trả0, không để một snapshot lỗi làm sập toàn Dashboard.

## 5. Gate kiểm thử trước nghiệm thu

Hai key/request khác nhau cùng item; reject→request mới và dispute request cũ;
hai Admin quyết định cùng revision; Seller/Buyer khác Store; thu hồi phiên khi
chờ lock; refund trước/sau completion và completion system; hoàn tháng sau;
double receive/restock; hàng không restockable; lỗi giữa refund/adjustment/kho/
outbox; replay/closed/lost response; amount client/discount snapshot lỗi; biên
deadline/ngày/tháng/quý; aggregate totals=buckets; đọc không thay DB; migration
fresh/upgrade và readonly/audit application role. Chạy DB QA riêng5549, không
dotenv/demo. Chưa pass gate thì không nhận API hoặc UI hậu mãi hoàn thành.
