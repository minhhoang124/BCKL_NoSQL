# Contract đề xuất — Buyer phục hồi yêu cầu hủy/hoàn tất v1

Ngày18/10/2026. **PROPOSED / CHỜ REVIEW**, mở rộng bản chuẩn bị #69 tại
`d7ca818`, dựa trên develop `39e8343`. Chỉ tài liệu/fixture thiết kế: chưa route,
validator runtime, migration, journal v2 hoặc Buyer Web; không đổi API Seller
#67, API cancel/complete đã merge hay source #68 đang review.

Hoàng phụ trách Backend/FE; Hiền review nghiệp vụ, privacy, DDL và nghiệm thu.
Không cần Đạt duyệt contract này vì resolver không đổi Product/Search; ca hủy
thực sự → outbox/index vẫn được kiểm tích hợp riêng với Đạt.

Nguồn: [readiness Buyer](../architecture/buyer-order-command-readiness-2026-10-18.md),
[hủy COD](order-cancellation-contract.md), [complete/D07](order-completion-runtime-contract.md),
[resolver Seller](seller-order-command-resolution-contract.md),
[journal hiện hành](../architecture/order-command-recovery-readiness.md).

## 1. Quyết định đề xuất và ý nghĩa

1. Endpoint Buyer mới, không mở quyền USER ở endpoint Seller.
2. Lưu metadata + fingerprint của request gốc trong sessionStorage; không lưu
   raw reasonText/body, token, địa chỉ hoặc receipt. Fingerprint là dấu kiểm
   SHA-256, **không phải chữ ký, bằng chứng quyền hoặc dữ liệu ẩn danh**; lý do
   ngắn có thể bị dò từ điển. Vẫn bảo vệ storage/log và không đưa ra URL.
3. Resolver chỉ trả **COMMITTED** (lệnh chính key này đã commit) hoặc
   **CLOSED_WITHOUT_EXECUTION** (đóng key chưa thực thi, chặn lệnh tới muộn).
   Không tạo cancellation/completion/restore/refund và không trả receipt SYSTEM
   thay cho Buyer. Không dùng GET trạng thái đơn hoặc lỗi409 làm acknowledgement.
4. Đóng cả namespace `(USER:actorId,key)`, không chỉ một body/hash. Fingerprint
   mô tả identity cần đối chiếu; không làm key có thể chạy với payload khác.
5. Không auto resolve/replay khi mount/reload. Cần consent riêng: “Nếu chưa thực
   hiện, mã yêu cầu cũ sẽ bị đóng. Đóng mã không phải hủy đơn hoặc hoàn tất đơn.”

### Thuật ngữ

**Intent**=ý định cố định; **journal**=bản ghi chờ trong tab; **receipt**=biên nhận
đã commit; **fence**=bản chặn bền vững; **settlement**=giải quyết đúng pending
theo biên nhận/bản chặn; **canonical**=dữ liệu được chuẩn hóa theo thuật toán cố
định; **session generation**=số thế hệ đăng nhập để chặn callback phiên cũ.

## 2. Request đề xuất

`POST /orders/:orderId/resolve-command`

JWT USER đang active, Order.buyerId đúng user hiện hành. Không Admin/Seller/
SYSTEM bypass. Không tồn tại/không sở hữu cùng404 ORDER_NOT_FOUND. Đọc lại quyền
trong transaction cả khi replay, không chỉ tin JWT role hoặc FE.

Header `Idempotency-Key` là key của **lệnh Buyer gốc**, ASCII `[A-Za-z0-9_-]`,
16..128 ký tự, kiểm toàn chuỗi bằng length + ký tự cấm, không chấp nhận newline.
Không UUID mới cho resolver. Path ID integer1..2147483647, không query.

```json
{
  "command": "cancel",
  "hashVersion": 1,
  "requestHash": "5c7e4d7ab866c3dd0cd08449c4484077ba73dfc7c81009b98549c20af453f412"
}
```

Exact3fields, command literal cancel/complete, hashVersion là JSON number có
giá trị nguyên đúng1 (không boolean/string), requestHash lowercase hex64. Không body gốc/reasonText/actorId/
buyerId/orderId/status/newKey trong JSON. Body JSON sau giải nén<=8KiB; parser
scoped trước default parser, reject content-type/JSON/extra/null/array sai.

Client-supplied requestHash **chỉ là dữ liệu đối chiếu**. Không dùng để xác thực,
quyết định giá/quyền hoặc thực thi body. Backend tự tính hash cho execute như cũ;
không sửa cancel/complete để tin hash do client gửi.

### Hash v1 phải khớp Backend hiện hành

SHA256 của UTF-8 JSON không whitespace, envelope key theo thứ tự:
`actorScope,body,command,orderId`. actorScope tự suy `USER:<verified-id>`;
orderId lấy path; command lấy allowlist. Không gồm idempotencyKey/timestamp.

- complete: body đúng `{}`.
- cancel: body exact reasonCode rồi reasonText; code Buyer CHANGED_MIND/OTHER;
  text dùng JavaScript `.trim()`, length1..500 theo UTF-16 JS như execute hiện
  tại. Không Unicode NFC/NFD normalization, không đổi hoa/thường hoặc tự co
  whitespace ở giữa. JSON escaping theo JSON.stringify, không thuật toán khác.
- hashVersion1 bất biến; thay thuật toán cần version/tương thích riêng, không
  tính lại hoặc backfill giả hash của receipt lịch sử.

Ba vector giả lập và canonical string ở
[fixture thiết kế](examples/buyer-command-recovery-proposed-v1.json). Ví dụ trên
là actor7/order101/reason “Tôi đổi ý mua hàng”; không là kết quả runtime thật.

## 3. Response HTTP200 đề xuất — hai envelope loại trừ nhau

### COMMITTED

Exact `{outcome,receipt}`. receipt exact `{orderId,commandId,command,replayed,result}`,
replayed=true, ID dương1..2147483647, đúng command/order/Buyer của invocation.
result là **toàn canonical receipt đã lưu** của cancel hoặc complete; không
dựng lại từ GET Order, không gộp timeline hiện hành hoặc tạo receipt mới.

| Receipt | Điều kiện bắt buộc |
|---|---|
| cancel | status CANCELLED; COD/CANCELLED/paidAt null/VND/amount Decimal string; cancellation Buyer đúng ID, reason allowlist/text chuẩn hóa; timeline đúng1 PENDING_CONFIRMATION→CANCELLED và time/actor/reason khớp |
| complete | status COMPLETED; deliveredAt/completedAt hợp lệ và có thứ tự; Payment PAID/VND/provider hợp lệ, paidAt<=completedAt, tiền string; timeline đúng1 DELIVERED→COMPLETED/BUYER đúng ID và createdAt=completedAt |

Mọi tầng nested exact allowlist theo hai validator Backend hiện hữu. Client
không dùng Seller receipt validator cho Buyer. Không trả key/hash/actorScope,
profile, Checkout receipt hoặc dữ liệu nội bộ. Cancel receipt có reasonText của
chính Buyer theo API hiện hành; chỉ giữ trong RAM để hiển thị/validate, không
chép nó vào journal/log/analytics. `result` không phải trạng thái Order hiện tại.

### CLOSED_WITHOUT_EXECUTION

Exact5fields, không receipt/result/commandId/replayed/hash/key:

```json
{
  "outcome": "CLOSED_WITHOUT_EXECUTION",
  "resolutionId": 301,
  "orderId": 101,
  "command": "cancel",
  "resolvedAt": "2026-10-18T10:00:00.000Z"
}
```

resolutionId integer1..2147483647, resolvedAt DB UTC ISO millisecond. Replay fence
trả đúng cùng5giá trị, không refresh timestamp hoặc sửa identity. Chỉ trả200
sau commit. Không có nghĩa Order CANCELLED/COMPLETED hoặc tiền/kho đã thay đổi.

## 4. Thuật toán server dự kiến

Serializable, khóa **User UPDATE→Store SHARE→Order UPDATE**, cùng thứ tự các
writer hiện hành. Actor USER active và owner được đọc lại sau khóa. Store có
thể CLOSED/SUSPENDED, Payment thiếu/đã đổi, Order đã chuyển trạng thái: không
dùng eligibility của execute để chặn đối chiếu kết quả cũ. Không khóa/mutate
Payment/Product/Variant, không HTTP ngoài transaction.

Đọc OrderCommand và OrderCommandResolution theo `(USER:actorId,key)`:

| DB canonical | Kết quả |
|---|---|
| Cả receipt và fence |500 INTERNAL_ERROR an toàn, không chọn một để bỏ lỗi |
| Một record nhưng khác Order/command/actorType hợp lệ |409 IDEMPOTENCY_CONFLICT, không trả metadata record kia |
| Record identity actorId/scope hỏng hoặc hashVersion không hỗ trợ |500 an toàn, không đoán/backfill |
| Identity đúng nhưng requestHash khác |409 IDEMPOTENCY_CONFLICT, không sửa hash/key |
| OrderCommand PROCESSING chưa hoàn tất |409 ORDER_COMMAND_IN_PROGRESS, Retry-After; không đóng key |
| SUCCEEDED đúng identity/hash + full receipt hợp lệ |COMMITTED, không insert fence |
| Fence đúng identity/hash |CLOSED từ record cũ, không ghi thêm |
| Không có cả hai |Kiểm hash theo quy tắc bên dưới rồi insert fence BUYER; CLOSED sau commit |

### Kiểm hash mà không cần persist raw lý do

- complete: Backend tái tính canonical hash từ user/path/complete/body{}.
  Khi chưa có record, hash request khác giá trị này →400 VALIDATION_ERROR,
  không tạo fence. Record có hash không thể khớp canonicalcomplete →500 nếu
  identity/input khớp nhưng dữ liệu lưu bị hỏng.
- cancel khi có receipt: validate body lý do lấy từ **resultSnapshot gốc**
  (reasonCode/text), dựng canonical request v1 từ đó rồi so với hash của
  OrderCommand và fingerprint invocation. Receipt hỏng/không tái tạo được đúng
  hash →500, không fake COMMITTED hoặc sửa snapshot. Không lấy reason từ Order
  hiện hành; không sửa snapshot khi replay. Identity bất biến không thay thế
  việc kiểm tra đầy đủ resultSnapshot khi đọc.
- cancel khi chưa có record: không thể chứng minh lý do gốc chỉ từ hash. Server
  nhận fingerprint đúng format **chỉ để ghi identity fence của key đã xác nhận**;
  không tuyên bố đã kiểm raw body hay đã từng nhận request execute. Buyer chỉ
  đóng key thuộc namespace mình và Order mình; không thể dùng hash này để chạy
  cancel, hoàn kho hoặc đổi Order. Mọi lệnh tới muộn cùng scope/key đều bị chặn,
  kể cả hash khác. Đây là trade-off cần Hiền review, không phải chữ ký request.

Nếu receipt của SYSTEM D07 tồn tại nhưng key Buyer không có record: không lấy
SYSTEM receipt làm COMMITTED. Đóng **key Buyer** →CLOSED, giữ nguyên COMPLETED
do SYSTEM và job; GET sau đó cho biết đơn đã hoàn tất. Tương tự Seller confirm/
cancel thắng trước: resolver chỉ đóng ý định Buyer chưa thực hiện, không đảo
ngược trạng thái hiện tại. Nếu chính Buyer đã commit thì luôn trả receipt gốc.

## 5. DB invariants và migration dự kiến — chưa triển khai

Đề xuất dùng chung OrderCommandResolution, không tạo queue/Redis mới. Migration
mới sau #67 mới được mở rộng allowed-pair:
- SELLER: confirm/start-packing/ready-to-ship, giữ nguyên behavior hiện hành.
- BUYER: cancel/complete. Không ADMIN/SYSTEM fence qua endpoint này.

Giữ unique(scope,key), FK RESTRICT, fence bất biến/không TTL/delete, OrderCommand
identity bất biến từ PROCESSING, hai trigger opposing-table + Serializable và
schema-qualified SQL. Không sửa migration #67 hoặc backfill record giả.

Helper chung hiện hard-code SELLER nên **phải thay trong PR implementation**:
validate fence pair độc lập rồi so identity caller. Fence BUYER hợp lệ khác
actorType/command/hash của caller →409 conflict; fence đúng identity →409
ORDER_COMMAND_CLOSED; corrupt pair/dual outcome →500. Không biến fence BUYER
thành INTERNAL_ERROR chỉ vì helper cũ không biết type mới. Cả năm writer USER
vẫn đi qua guard trước replay/policy, SYSTEM giữ namespace riêng và chỉ đi
entry point nội bộ. Đổi role không tạo scope mới để né fence.

Concurrency phải chứng minh: execute thắng →resolver COMMITTED; resolver thắng
→execute muộn bị chặn; hai snapshot cũ không commit hai outcome. User row lock
đơn lẻ không là proof; SSI/exclusion + retry transaction đọc canonical là bắt buộc.
COMMITTED và fence cùng scope/key không được đồng tồn tại qua crash/restart.

## 6. Lỗi, quota, timeout và vận hành

Envelope lỗi exact `{statusCode,code,message}` an toàn; no-store cả thành công/
lỗi. Không raw exception/SQL/payload/key/hash/reasonText hoặc token trong log.

| HTTP/code | FE |
|---|---|
|400 VALIDATION_ERROR/IDEMPOTENCY_KEY_REQUIRED |Giữ pending; không tự tạo key mới |
|401 UNAUTHORIZED;403 FORBIDDEN |Xác minh lại đúng tài khoản, không auto refresh/replay POST |
|404 ORDER_NOT_FOUND |Không tiết lộ existence; không coi là chưa commit |
|409 IDEMPOTENCY_CONFLICT/ORDER_COMMAND_CLOSED |Không clear từ error; cần resolution200 đúng invocation |
|409 ORDER_COMMAND_IN_PROGRESS |Retry-After:1, giữ key, retry có consent |
|413 REQUEST_TOO_LARGE |Giữ pending, không thay payload/key tự động |
|429 RATE_LIMITED |Retry-After theo bucket, không vòng lặp vô hạn |
|500 INTERNAL_ERROR/network/timeout/200malformed |Giữ unknown, không hydrate/settle |

Đề xuất guard resolver riêng20/phút/actor/instance, gồm replay và request sai đã
qua guard; không đổi hai bucket execute hiện hành (cancel20,complete20). Không
nhận đây là quota distributed hoặc shared với execute. Không tránh quota bằng
new key. Bucket hữu hạn và cleanup như guards hiện có; retention fence cần vận
hành riêng, không xóa theo TTL chỉ để tiết kiệm DB.

Mặc định timeout giống #67: lock1s,statement2s,transaction5s,poolwait2s,
deadline22s; tối đa3attempts kể cả lần đầu, chỉ retry serialization/deadlock và
đúng scope-key unique race. Config phải hữu hạn và hợp lệ. Client30s, abort không
chứng minh rollback. Không retry 4xx/5xx tùy ý hoặc mọi unique violation.
Log chỉ actorId/orderId/resolutionId/outcome/attempt/code/correlationId không
nhạy cảm; metrics count/duration/conflict không label theo key/hash/reason.

## 7. Journal v2 và tương thích đề xuất

Giữ **cùng physical key** `bckl-order-command-journal-v1:<actorId>` để không tạo
hai kênh pending song song. Chữv1 ở namespace là tên legacy, discriminator trong
value mới quyết định format. Mỗi account/tab một pending, role không nằm ở key.

V2 Buyer exact9fields: schemaVersion2, actorId, role="USER", orderId,
command="cancel"|"complete", idempotencyKey, createdAt, hashVersion1, requestHash.
Không current session generation được lưu như quyền. createdAt là UTC client
để hiển thị, không là bằng chứng thời gian commit hoặc TTL.

1. Consent → normalize body trong RAM → tính hash (kiểm lại session sau async
   digest) → lưu metadata v2 + đọc kiểm lại → đóng băng handle/body trong RAM
   → POST execute cũ. Storage lỗi thì chưa dispatch.
2. Sau reload, v2 chỉ có fingerprint: **chỉ đối chiếu/đóng với consent**, không
   tự dựng raw cancel body hoặc execute lại với lý do người dùng vừa nhập.
3. Buyer complete v1 hợp lệ: tính hash body{} từ actor/order/command, giữ nguyên
   key/createdAt/identity, ghi v2 vào cùng slot và đọc kiểm lại trước HTTP.
   Đây là nâng metadata client có thể tái lập, không migration/ghi đè receipt DB.
4. Seller v1 giữ nguyên, không convert sang Buyer. V1 malformed/role khác/
   version chưa biết phải blocked, không xóa/reset. Client cũ không hiểu v2
   phải fail-closed, không fallback tạo namespace khác.
5. Không dual-write hoặc lưu fingerprint ở slot khác rồi xóa v1. CAS/check full
   pending identity trước settle; thay đổi bất kỳ metadata trong lúc await
   khiến callback không clear record mới. Không claim Web Storage là khóa DB.

Fingerprint không giúp khôi phục sau mất/xóa storage hoặc đóng tab. Không auto
logout-clear/TTL. Nhiều tab/thiết bị không có global journal; PostgreSQL kiểm
idempotency/transition thật. XSS/DevTools/extension không được xem đã giải quyết
bằng hash hoặc WeakMap proof. Future cross-device recovery là task riêng.

## 8. Settlement trên FE đề xuất

Resolver adapter nhận handle đã prepare theo actor/session/key/order/command/
hashVersion/requestHash; no-auto-retry, no-store, strict response. Proof gắn
invocation/session trong RAM, không chấp nhận JSON clone/GET hoặc receipt khác.

- COMMITTED cancel: từ reason trong receipt tái tính hash rồi so pending; full
  receipt/actor/source/timestamps/money được kiểm trước acknowledge.
- COMMITTED complete: full receipt BUYER, canonical hash body{} đúng pending.
- CLOSED: envelope exact + proof đúng key/fingerprint/session/pending → thao
  tác settle riêng, không giả commandId để dùng acknowledgement thành công.
- Hai outcome chỉ clear khi remove + đọc kiểm lại thành công. Storage failure,
  pending đổi hoặc phiên đổi →blocked; không mở ý định mới.
- Sau settlement, GET mới. GET lỗi giữ thông báo outcome đã biết, chỉ read-retry.
  Có dữ liệu mới mới cho chọn hành động theo trạng thái và consent mới/key mới.
  Không tự optimistic stock/cancel/complete hoặc tự chain.

## 9. Gate review và acceptance — toàn bộ NOT_RUN

1. Hash vectors khớp FE WebCrypto và BE SHA256: Unicode/trim/property order/
   reason thay đổi/complete; không tự normalize lịch sử.
2. Hai receipt đúng command + negative cases exact fields, identity/time/money;
   cancel resultSnapshot reason-hash bị sửa không trả COMMITTED.
3. Client hash giả không thể execute/đóng key actor khác; malformed hash400;
   sai fingerprint của key đã tồn tại409; complete wrong canonical hash không
   record400; no-record cancel close không thay Order/kho/Payment.
4. Execute-first/resolver-first cho cả cancel/complete, SQL stale snapshots,
   process recovery, rollback lỗi fence/commit; direct SQL guard và role changes.
5. Buyer-vs-SYSTEM D07, Seller-confirm-vs-Buyer-cancel, Buyer/Seller cancel:
   một transition hợp lệ, closure key Buyer không giả receipt actor khác.
6. Migration nâng cấp giữ mọi Seller fence/receipt; helper toàn5writer hiểu
   allowed pair và SYSTEM scope không bị đổi; không sửa migration dùng chung.
7. V1 complete upgrade, v1 Seller, v2 Buyer, unknown version, storage getter/
   setter/removal/no-op, hai callback, pending đổi và session đổi trong async hash.
8. Browser/Nest/PostgreSQL: consent, double click, reload, response mất sau
   commit, CLOSED sau chưa gửi, GET lỗi sau ack, logout/login actor khác; kiểm
   receipt/history/stock/outbox. Không lấy mockHTTP hoặc test vector là proof DB.

Các ca bổ sung chi tiết trong [acceptance đề xuất](../testing/buyer-resolution-contract-acceptance-2026-10-18.md).
Chỉ sau Hoàng–Hiền chốt contract → migration/API PR riêng → validator/journal/
Buyer controller → QA đúng head → review mới xét bật nút. #68 approval không
thay Buyer review. Không gọi contract này CURRENT hoặc G-FULFILMENT DONE.
