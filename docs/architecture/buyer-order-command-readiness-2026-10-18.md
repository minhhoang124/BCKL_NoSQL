# Chuẩn bị Buyer hủy và hoàn tất đơn — 18/10/2026

## 1. Phạm vi, nguồn chuẩn và kết luận

**PREPARATION — chưa code, chưa bật giao dịch Buyer.** Nhánh tài liệu độc lập
`codex/buyer-order-readiness`, nền `develop 39e8343` sau merge #67. Không lấy
source #68 chưa merge; không sửa schema, Backend, FE hoặc SRS để khớp code.

Nguồn đã đối chiếu:
- [SRS v3](../analysis/hien/srs-v3.md), FR-ORD-01, FR-CAN-01, AC-ORD-01/CAN-01, D07.
- [Contract hủy](../api/order-cancellation-contract.md), Backend #44 đã merge `2ed3ee5`.
- [Contract hoàn tất](../api/order-completion-runtime-contract.md), Backend #48 đã merge `541d15b`.
- [Contract Cart–Order](../api/cart-order-inventory-api-contract.md), mục6/7.
- [Resolver Seller](../api/seller-order-command-resolution-contract.md), #67 đã merge `39e8343`.
- [Nền journal](order-command-recovery-readiness.md) và [phạm vi](../project/implementation-scope.md).

Header IN_PROGRESS/PR đang review trong một số contract là mốc lịch sử; trạng
thái **Backend đã merge** ở đây được xác minh bằng Git và source `39e8343`.
Không suy từ việc Backend đã merge rằng Web hoặc toàn gate đã nghiệm thu.

**Kết luận:** API thực thi đã có; thiếu adapter/validator và UI Buyer. Điểm cần
chốt trước implementation là phục hồi kết quả Buyer: resolver #67 chỉ nhận
SELLER và ba lệnh chuẩn bị hàng. Không gửi cancel/complete vào resolver này.
Cancellation còn có body lý do không được journal hiện tại lưu; không thể chỉ
thêm một nút rồi mặc định đã an toàn qua reload.

## 2. Ma trận quyền và trạng thái hiện hành

| Điều kiện | Buyer hủy | Buyer hoàn tất |
|---|---|---|
| Endpoint | POST `/orders/:orderId/cancel` | POST `/orders/:orderId/complete` |
| Actor | JWT USER active, buyerId đúng chủ đơn | Như hủy |
| Đơn người khác/không tồn tại | Cùng404 ORDER_NOT_FOUND | Cùng404 ORDER_NOT_FOUND |
| Trạng thái nguồn cho lệnh mới | Chỉ PENDING_CONFIRMATION | Chỉ DELIVERED |
| Payment | COD/UNPAID, paidAt=null, amount=total, VND | COD/VNPAY/MOMO PAID, paidAt hợp lệ không ở tương lai, amount=total, VND |
| Thời gian Order | Theo policy hủy và ledger đã trừ | deliveredAt có thật, không ở tương lai, chưa completed/cancelled |
| Store khóa/đóng | Không chặn Buyer hủy đơn mình nếu điều kiện khác đúng | Không đòi Store ACTIVE để Buyer hoàn tất |
| Seller bị khóa | Không dùng làm điều kiện cấm Buyer | Không thay kiểm Buyer/Order/Payment |
| Thời hạn3ngày | Không áp dụng | Buyer không phải chờ;3ngày dành cho SYSTEM D07 |
| Replay cùng key/body | Trả receipt gốc sau kiểm quyền, trước kiểm transition hiện tại | Tương tự |
| Vai trò SELLER/ADMIN | Không đi đường Buyer, không bypass bằng JWT body | Không tự hoàn tất thay Buyer qua API này |

Hoàn tất không phải đánh dấu giao: DELIVERED do Admin/adapter giao mô phỏng;
Buyer chỉ xác nhận sau giao và PAID. Không mở Review/Dashboard/Refund giả khi
chuyển COMPLETED; các miền đó còn task riêng.

## 3. Contract request và response cần dùng đúng

### 3.1 Chung

Path ID nguyên1..2147483647. Header `Idempotency-Key` ASCII chữ/số/underscore/
dấu gạch ngang,16..128 ký tự. Không key trong URL/query, không caller-supplied
buyerId/actorId/status/amount. JSON application/json, body sau giải nén tối đa8KiB,
không field/query thừa. Response và lỗi no-store. FE deadline đề xuất30s giống
Seller đã review; đây là kế hoạch adapter, chưa code. Không auto retry/refresh POST.

### 3.2 Hủy

```json
{"reasonCode":"CHANGED_MIND","reasonText":"Tôi đổi ý mua hàng"}
```

Buyer chỉ CHANGED_MIND/OTHER; cả hai đều cần reasonText trim1..500 theo code JS.
Không mượn reasonCode OUT_OF_STOCK/CANNOT_FULFIL của Seller. Body canonical
chuẩn hóa trước tính hash; whitespace ngoài hai đầu không tạo ý định mới.
Đổi lý do thật sự là đổi payload, không được gửi với key cũ chưa giải quyết.

HTTP200 exact envelope `{orderId,commandId,command:"cancel",replayed,result}`:
- result exact: status=CANCELLED, payment, cancellation, timeline.
- payment: COD/CANCELLED, amount chuỗi nguyên đồng dạng `10000.00`, VND, paidAt=null.
- cancellation: cancelledBy{type:BUYER,id hiện hành}, reasonCode/Text khớp body
  gốc chuẩn hóa, cancelledAt UTC ISO; không actor tùy ý từ response hỏng.
- timeline đúng1 transition PENDING_CONFIRMATION→CANCELLED, actor BUYER đúng ID,
  reason khớp và createdAt=cancelledAt. Không phải toàn lịch sử GET.

### 3.3 Hoàn tất

Body đúng `{}`. HTTP200 envelope tương tự, command="complete"; result exact:
status=COMPLETED, deliveredAt, completedAt, payment, timeline.
- Thời gian UTC ISO; completedAt>=deliveredAt; payment.paidAt<=completedAt.
- Payment PAID/provider hợp lệ, VND/amount dạng chuỗi chính xác, không JS float.
- Timeline đúng1 DELIVERED→COMPLETED, actor BUYER/ID hiện hành và createdAt=completedAt.
- Không chấp nhận receipt SYSTEM làm acknowledgement lệnh Buyer. Nếu SYSTEM
  thắng, Buyer có thể nhận409 INVALID_ORDER_TRANSITION; GET COMPLETED không
  chứng minh chính key Buyer đã chạy.

DTO GET detail hiện có không trả deliveredAt/completedAt top-level. Không đoán
giờ chuẩn từ updatedAt hoặc lấy timeline làm bằng chứng commit key. UI có thể
dùng status/Payment để gợi ý nút; Backend kiểm timestamp canonical. Receipt
complete có timestamps để validate riêng; chưa cần tự thêm cột/schema/GET field.

## 4. Transaction và hiệu ứng cần chứng minh

### Hủy COD

Khóa User→Store SHARE→Order UPDATE→Payment UPDATE→Products theo ID tăng dần,
Serializable. Actor/key chung USER:id, không đổi namespace theo role. Đọc receipt
và fence trước policy lệnh mới. Lần đầu cùng transaction:
1. Kiểm đúng CHECKOUT_DECREMENT cho từng OrderItem/variant/quantity, chưa restore.
2. Tăng stock theo quantity snapshot, ghi CANCELLATION_RESTORE từng Item.
3. Mỗi Product bị ảnh hưởng chỉ tăng một version và ghi một SearchOutbox
   UPSERT/DELETE theo public eligibility canonical, kể cả nhiều Variant cùng Product.
4. Order CANCELLED/audit, Payment COD CANCELLED, history và receipt SUCCEEDED.

Sai ledger/overflow/version cuối miền/outbox lỗi phải rollback tất cả. Stock-only
không hạ APPROVED thành DRAFT. Không thêm lại Cart hoặc sửa Checkout receipt,
OrderItem/địa chỉ/tiền snapshot. Không gọi FastAPI trong transaction; outbox tồn
tại không chứng minh ES/FAISS đã đồng bộ. Không giả hoàn tiền sandbox bằng cancel COD.

### Hoàn tất

User→Store SHARE→Order UPDATE→Payment UPDATE, Serializable; ghi COMPLETED/
completedAt/history/receipt nguyên tử, không đổi tiền đã thu/stock/Product/version/
outbox/snapshot. Buyer và SYSTEM cạnh tranh chỉ một transition. Nếu SYSTEM xử lý,
job thành SUCCEEDED; nếu Buyer thắng, worker sau đó SKIPPED theo canonical state.
Không dùng latch FE hoặc một cron instance làm bằng chứng duy nhất.

## 5. Khoảng trống phục hồi cần review, chưa phải contract mới

| ID | Khoảng trống trên develop | Việc cần chốt trước code |
|---|---|---|
| BR-01 | Resolver #67 chỉ Seller confirm/start-packing/ready-to-ship | Contract Buyer đối chiếu/đóng key cho cancel/complete, quyền/identity/quota/response và DB guard tương ứng; không tái dùng endpoint Seller |
| BR-02 | Journal v1 cho USER chỉ complete body{}; cancel chưa hỗ trợ | Cách giữ identity/fingerprint của payload lý do qua reload, version và tương thích pending v1; một pending/account/tab, không tạo journal khác để né khóa |
| BR-03 | Lý do tự do có thể chứa dữ liệu cá nhân; journal đã duyệt không lưu PII/body | Không âm thầm persist reasonText. Đề xuất cân nhắc fingerprint canonical không chứa raw text + đối chiếu server; phải có thiết kế/negative tests trước chọn wire format |
| BR-04 | Retry complete khi SYSTEM đã thắng có thể409 mà chưa có receipt Buyer | Cần kết quả terminal có bằng chứng cho key Buyer; không clear từ GET/409 hoặc giả receipt SYSTEM |
| BR-05 | Chưa có FE full validator Buyer cancel/complete | Tách schema hai receipt, so body/actor/key/session; không ép theo receipt Seller |
| BR-06 | Các nút Buyer đang disabled | Chỉ nối sau contract recovery + adapter tests + QA được review; không dựa approval #68 thay Buyer |

Phương án đề xuất để Hiền review: ưu tiên cơ chế Buyer đối chiếu/đóng key có
bằng chứng bền vững, giữ cùng nguyên tắc #67 nhưng không giả định DDL hiện tại
đã cho phép BUYER/cancel/complete. Chốt canonical payload/fingerprint và privacy
trước migration mới. Bản bổ sung [contract phục hồi Buyer đề xuất](../api/buyer-order-command-resolution-proposal.md)
đã đặc tả endpoint/body để review, chưa được coi là contract đã duyệt và không
tự mở rộng enum/constraint. Chỉ replay nguyên key/body trong RAM có thể hỗ trợ một
phiên, **không đủ** để nghiệm thu reload/process/network recovery.

## 6. Thiết kế UI dự kiến, chưa bật nút

- Hủy: lý do Buyer đúng enum + giải thích bắt buộc; tóm tắt đơn/số lượng, xác
  nhận riêng. Bấm quay lại giữ draft trong RAM, chưa có key trước khi submit.
- Hoàn tất: “Tôi đã nhận được hàng”; không tạo mốc giao hoặc thông báo hoàn tiền.
- Lệnh mới chỉ khi GET mới, đúng actor, policy phù hợp và không pending. Mỗi
  intent ghi trước HTTP. Chỉ thay đổi hiển thị sau receipt/GET, không optimistic stock.
- Unknown: giữ mã, chặn thao tác mới, không auto execute/resolve khi mount/reload.
- Đã acknowledge nhưng GET lỗi: chỉ read-retry, không resend command đã commit.
- Đổi tài khoản/rời trang: callback cũ không expose dữ liệu hoặc clear journal.
- Lỗi có mã rõ:401 đăng nhập lại;403/404 không lộ đơn;429 chờ Retry-After;
  PAYMENT_STATE_CONFLICT không coi tiền đã hoàn; ORDER_INVENTORY_REVIEW_REQUIRED
  báo cần kiểm tra dữ liệu, không tự sửa stock.

## 7. Thứ tự giao việc và điều kiện mở đường

1. Hoàng/Hiền review BR-01..BR-04 và ma trận test. Đạt chỉ review phần ảnh hưởng
   Product→Search của hủy, không phải gate chờ cho toàn Buyer flow.
2. Contract recovery Buyer riêng → migration mới nếu cần → Backend tests đồng
   thời với execute/SYSTEM, giữ guard của #67. Không sửa migration dùng chung.
3. Adapter/validator Buyer và journal tương thích; chưa mount. Không cần chờ
   source UI cam #59 để thiết kế, cũng không lấy #68 làm nền chưa merge.
4. Nối complete trước (body{}), rồi cancel (body lý do); PR nhỏ độc lập sau
   dependency chính thức. Các bước chuẩn bị validator/fixture có thể làm song song.
5. Browser/HTTP/PostgreSQL QA: hủy→hoàn kho/outbox, giao→Buyer/SYSTEM complete,
   reload/mất response/storage/session và cạnh tranh. Reviewer đúng head, CI xanh,
   sau đó mới quyết định bật nút và nghiệm thu phạm vi thật.

## 8. Kết quả audit hôm nay

Chỉ đọc code/contract/SRS, không đổi ứng dụng/schema. Chạy lại trên develop
`39e8343`: **150 Backend unit PASS** (policy/request/cancellation receipt/completion),
**51 FE unit/component PASS** (journal/coordinator). HTTP ở các test FE là mock;
không là Buyer UI integration. Không chạy lại Backend E2E/browser/DB trong đợt
này; evidence 595 E2E của #67 là lịch sử khác scope, không cộng vào kết quả mới.

[Ma trận chi tiết và nguồn test](../testing/buyer-order-command-test-matrix-2026-10-18.md).
