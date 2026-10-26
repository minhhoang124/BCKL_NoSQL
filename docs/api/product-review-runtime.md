# Review giao dịch — contract triển khai 26/10/2026

Backend đã chạy trên QA, nhánh từ `76a5d71`, chưa merge và chưa nối Web. Nguồn:
SRS FR-REV-01/AC-REV-01 và implementation-scope. Không tính phần này hoàn thành
khi chỉ có Backend/schema/contract hoặc kiểm thử parser.

Buyer của Order COMPLETED được tạo một Review/OrderItem; rating 1–5, nội dung
NFC 1–2000 codepoint. Tạo/sửa trong REVIEW_WINDOW_DAYS mặc định30, chỉ nhận
integer1..365; cấu hình sai từ chối503, không âm thầm mở vô hạn. Deadline lấy
từ completedAt và DB statement_timestamp; completedAt thiếu/sai không suy từ
updatedAt. Seller có Buyer capability được review Store khác, không tự review.
RefundRecord của item không tự xóa review, không làm mất quyền review hợp lệ.

Seller hiện sở hữu Store có một reply; ACTIVE/SUSPENDED được trả lời giao dịch
cũ, CLOSED chỉ đọc/đối chiếu biên nhận cũ. Admin chỉ ẩn với reason10..500 và
audit, không sửa điểm/nội dung. Buyer sửa review đã ẩn vẫn ẩn. Một revision
chung cho CREATE/EDIT/REPLY/HIDE; REPLY tăng revision và audit giữ snapshot của
review, replyBody riêng. Đụng revision409, giữ draft và tải lại/xác nhận lại.
Ẩn lại bằng key mới409 REVIEW_ALREADY_HIDDEN; reply lần hai409 REVIEW_REPLY_EXISTS.

Mọi endpoint ghi/đối chiếu dùng **orderItemId** làm target, không suy từ reviewId.
UUID/confirmed, EDIT/REPLY/HIDE expectedRevision; hash fixed-order normalized
scope/action/item/body, không role/cv. Reconcile chỉ nhận UUID/hash/confirmed,
trả APPLIED hoặc đóng unused key CLOSED, tuyệt đối không tự ghi review/reply.
Receipt kiểm với audit bất biến; quyền actor/cv và ownership hiện hành trước
receipt, các gate thực thi (window/Store closed/revision) chỉ sau receipt.

Khóa theo cơ chế Order/hậu mãi hiện tại: actor User FOR UPDATE → Store FOR SHARE
→ Order FOR UPDATE → Review FOR UPDATE. Đọc target tham chiếu và kiểm ownership
trước khóa Order để không cho actor khóa đơn người khác; đọc lại trong TX sau
khóa. Serializable retry max3 chỉ40001/40P01. Review, reply, audit và receipt
nguyên tử. Không sửa Order/Payment/stock/Product/Search. Không thêm rating vào
contract Backend–AI hiện hành.

GET /products/:productId/reviews: cùng predicate public Product hiện có; snapshot
RepeatableRead read-only bao gồm visibility, aggregate và page. hidden=false,
average một chữ số thập phân, null nếu0review, histogram1..5. Public chỉ reviewId,
rating/body/reply/timestamps, author cố định “Người mua đã xác minh”, isRefunded
theo OrderItem.refund tồn tại. Không order/item/user/email/contact/reason. Cursor
reviewId DESC, không sort theo timestamp không tie-breaker.

GET /account/order-items/:itemId/review: chỉ Buyer owner, trạng thái/eligibility/
deadline/revision/current review/reply/history. GET /seller/reviews và
/admin/reviews phân trang reviewId DESC, Seller chỉ Store mình; Admin gồm hidden.
GET /admin/reviews/:itemId đọc audit/reason riêng Admin; lịch sử Buyer không trả
lý do kiểm duyệt nội bộ. historyTruncated chỉ rõ giới hạn50sự kiện gần nhất.
POST /account/order-items/:itemId/review/:action (create/edit),
/seller/reviews/:itemId/reply, /admin/reviews/:itemId/hide.
POST /review-commands/:scope/:action/:itemId/reconcile. Mọi response no-store,
query parser không nhận unknown/duplicate/array, GET không body, POST khôngquery.

Web cần journal metadata duy nhất/actor, scope/action nằm trong record; pending
Buyer chặn Seller command mới cùng actor. Không reason/body/token. Shared latch,
draftversion consent, immutable snapshot trước hash, epoch+rawCAS; GETfail sau
receipt chỉ GET lại. Chưa có Web nối runtime cho tới QA và merge riêng.

Gemini Argon Medium đã review proposal; chấp nhận các chốt revision/replyBody,
already-hidden/replied, target rõ, config/window, receipt sau close và aggregate
snapshot/privacy. Nhận xét lock được kiểm lại trên code: Order/hậu mãi hiện có
User→Store→Order, dùng cùng hướng. Không áp nguyên nhãn mức độ do AI suy đoán.
