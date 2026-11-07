# Seller đối chiếu và đóng ý định Order — contract đề xuất v1

**Triển khai 18/10/2026 — nhánh `codex/order-command-resolution-runtime`:**
đã thêm migration mới `20261018040000_order_command_resolution` và POST
`/seller/orders/:orderId/resolve-command` theo contract bên dưới. Đây là code
trên nhánh, **chưa merge/chưa bật Seller Web**. Kết quả và các ca còn thiếu:
[báo cáo runtime](../testing/order-command-resolution-runtime-2026-10-18.md).
Các ghi nhận PROPOSED/NOT_RUN theo head cũ bên dưới là lịch sử, không phải bằng
chứng kiểm thử bản triển khai mới. Không đổi semantics hoặc Search contract.

Ngày16/10/2026; base develop `035656b`. **PROPOSED / CONTRACT REVIEW**, chưa có
endpoint/schema/migration/runtime. #58 head6e544dc được Hiền approve hướng nghiệp
vụ; không đồng nghĩa chi tiết dưới đây đã được duyệt hoặc đã triển khai.
Hoàng triển khai; Hiền review nghiệp vụ/DDL và kiểm thử. Không đổi Search contract.

Cập nhật17/10: Hiền đã approve contract `e1590be`, gồm guard identity từ
PROCESSING; đồng bộ develop `ad3b969` sau #28, cần review delta mới.
Không đổi semantics đã duyệt, chưa triển khai endpoint/migration;25ca NOT_RUN.
Sau merge #58 tại develop `7e58255`, #62 đồng bộ nền này; Hiền đã approve
contract tại `4bca065`. Delta mới chỉ giải conflict/cập nhật trạng thái tài liệu,
không đổi request/response/protocol/25acceptance và cần review delta sau push.

Nguồn: [C2 đang có](seller-order-command-contract.md),
[Order chung](cart-order-inventory-api-contract.md),
[nền phục hồi](../architecture/order-command-recovery-readiness.md).
Code đã rà: order-command-request, seller-order-command, cancellation, returned,
delivery, completion services và migration order_command_audit_foundation.

## 1. Vấn đề và ý nghĩa thao tác

Client mất response không biết lệnh đã commit. HTTP lỗi hay GET thấy trạng thái
mới không chứng minh kết quả của key cũ. API này có hai chức năng nguyên tử:

- Có biên nhận thành công đúng key/identity: trả nguyên biên nhận đó.
- Chưa thực thi: ghi bản chặn bền vững để key cũ không thể thực thi về sau.

Đây KHÔNG là hủy Order, hoàn kho hoặc endpoint tra GET thuần. Confirmation phải
nói rõ có thể **dừng ý định chưa thực thi**. Đóng key không đổi trạng thái đơn.

## 2. Request

`POST /seller/orders/:orderId/resolve-command`

JWT SELLER active, đúng chủ Store của Order. Không query. JSON strict object:

```json
{"command":"confirm"}
```

Chỉ confirm/start-packing/ready-to-ship. Không nhận actorId, orderId trong body,
requestHash, hashVersion, result, status, newKey hoặc field thừa/null/array.
Path ID integer1..2147483647; header Idempotency-Key là **key của C2 gốc**,
ASCII `[A-Za-z0-9_-]{16,128}`. Không dùng key mới riêng cho resolver.

Hash không tính từ body resolver. Gọi prepareOrderCommand với verified SELLER,
pathOrderId, command được chọn, key cũ và C2 body `{}`. Giữ canonical hash v1:
SHA256 của UTF8 JSON sorted envelope actorScope/body/command/orderId. Không sửa
hash v1 hoặc receipt C2 đã dùng chung.

Parser/guards/filter dùng cùng C2 infrastructure: body sau giải nén <=8KiB,
application/json, strict validation, no-store cả lỗi. Cùng **một instance**
SellerOrderCommandRateGuard với ba C2 endpoints: default20/phút/actor/instance,
bao gồm replay/resolve và lần lỗi đã qua guard; 429 có Retry-After.
Không thêm bucket độc lập hoặc đăng ký lại provider trong module khác.
Quota per-instance chưa là distributed rate limit và không thay khóa DB.

## 3. Response HTTP200 — hai envelope loại trừ nhau

### 3.1 COMMITTED

Exact keys: outcome, receipt. Receipt là **full canonical Seller C2 receipt**,
validate resultSnapshot/actor/identity/hashVersion bằng validator hiện hành.

```json
{
  "outcome":"COMMITTED",
  "receipt":{
    "orderId":101,
    "commandId":201,
    "command":"confirm",
    "replayed":true,
    "result":{
      "status":"CONFIRMED",
      "payment":{"provider":"COD","status":"UNPAID","amount":"10000.00","currency":"VND","paidAt":null},
      "cancellation":null,
      "timeline":[{"fromStatus":"PENDING_CONFIRMATION","toStatus":"CONFIRMED","actorType":"SELLER","actorId":8,"createdAt":"2026-10-16T06:00:00.000Z"}]
    }
  }
}
```

Luôn replayed=true vì resolver không thực thi C2. Không rebuild receipt từ trạng
thái Order mới; không tạo fence hoặc sửa receipt/history/Order. Hai lần resolve
trả cùng receipt/commandId, không phát sinh side effect mới.

### 3.2 CLOSED_WITHOUT_EXECUTION

Exact keys: outcome,resolutionId,orderId,command,resolvedAt.

```json
{
  "outcome":"CLOSED_WITHOUT_EXECUTION",
  "resolutionId":301,
  "orderId":101,
  "command":"confirm",
  "resolvedAt":"2026-10-16T06:01:00.000Z"
}
```

resolutionId integer1..2147483647, timestamp ISO UTC từ DB. Không commandId,
result, payment, PII, raw key/hash hoặc fields thừa. Tạo mới và replay fence đều
HTTP200 với cùng các giá trị đã lưu; không cần replayed cho closed branch.
Chỉ trả response sau transaction commit; lỗi commit không được trả CLOSED.

## 4. Quyền và thứ tự transaction

Serializable; lock protocol User FOR UPDATE → Store FOR SHARE → Order FOR UPDATE.
Giữ cùng thứ tự writer C2; không lock một Order trước User hoặc lock bằng process.
Trong transaction, đọc lại account active/role và ownership, không tin dữ liệu
Auth/Order mà FE giữ. Ngoài owner/không tồn tại đều404 ORDER_NOT_FOUND.

Sau quyền và lock:

1. Đọc receipt và fence theo `(actorScope,key)`; nếu cả hai tồn tại →500 an toàn,
   log invariant violation không raw key/PII; không chọn một kết quả để bỏ qua lỗi.
2. Receipt có: order/command/hash khác →409 IDEMPOTENCY_CONFLICT. Cùng identity
   nhưng actor/hashVersion/shape bị hỏng →500; PROCESSING không hoàn tất →409
   ORDER_COMMAND_IN_PROGRESS. SUCCEEDED hợp lệ →COMMITTED với receipt gốc.
3. Fence có: order/command/hash khác →409 IDEMPOTENCY_CONFLICT. Cùng identity,
   SELLER/actor/hashVersion hợp lệ →CLOSED từ bản ghi cũ; dữ liệu hỏng →500.
4. Không có cả hai: insert fence immutable cùng identity/hash, trả CLOSED sau commit.

**Không áp transition/Payment/Store eligibility trước đối chiếu.** Seller active
đúng owner vẫn được đối chiếu khi Order/Payment/Store state đã đổi. Resolver không
mở bán, không thực thi C2 hay sửa dữ liệu nên không đòi Store ACTIVE/SUSPENDED để
đóng ý định cũ. Account khóa/role không còn Seller/khác owner vẫn bị chặn; không
thêm Admin bypass. C2 execute mới vẫn giữ nguyên policy hiện hành.

Timeout/retry dùng cùng cấu hình C2: statement2s,lock1s,transaction5s,pool2s,
deadline22s; tối đa3attempts, backoff có giới hạn. Chỉ retry serialization/deadlock,
lock timeout theo handler đã phân loại và đúng unique-key race; không retry mọi
P2002/P2004/5xx vô hạn. Exhausted →409 ORDER_COMMAND_IN_PROGRESS,Retry-After1.
FE deadline30s; abort HTTP không hủy/đóng ý định server.

## 5. Bảng mới và ràng buộc migration cần review

Tên đề xuất `OrderCommandResolution`, map `order_command_resolutions`:

| Field | Ràng buộc |
|---|---|
| id | serial PK, integer |
| orderId | FK Order RESTRICT |
| actorId | FK User RESTRICT, NOT NULL |
| actorType | SELLER; không nhận từ client |
| actorScope | varchar64, đúng USER:actorId |
| idempotencyKey | varchar128, regex C2 |
| command | varchar32, whitelist3C2 |
| requestHash | varchar64, lowercase hex64 |
| hashVersion | integer, bằng1 cho version này |
| resolvedAt | timestamp(3), DB default current timestamp |

Unique(actorScope,idempotencyKey), index(orderId,resolvedAt), index(actorId).
Không cần status/outcome mutable vì row luôn có nghĩa CLOSED_WITHOUT_EXECUTION;
COMMITTED tiếp tục lấy từ OrderCommand. Không PROCESSING fence, TTL hoặc backfill.
Không sửa migration cũ/receipt/history enum; migration expand-only mới.

### DB guard đề xuất — phần chi tiết phải được kiểm bằng migration tests

Hai bảng riêng không tự loại trừ nhau chỉ nhờ unique index riêng từng bảng.
Đề xuất trigger BEFORE INSERT trên fence và OrderCommand (nhánh USER scope):

- Bắt buộc transaction Serializable; transaction isolation khác bị từ chối rõ
  constraint, không im lặng chạy ở Repeatable Read/Read Committed. Mục đích tránh
  write-skew do snapshot cũ khi kiểm hai bảng; lock/advisory lock đơn lẻ không
  được coi là chứng minh mutual exclusion.
- Khóa User tương ứng, đọc bảng đối diện theo scope/key; nếu có thì raise23514
  với constraint cố định, không log key. Trigger phải schema-qualified/dựa schema
  thực, không search_path tùy ý. Command mọi role chung USER đều đi qua guard;
  SYSTEM scope riêng không được đổi namespace hoặc mở quyền mới.
- SSI/unique conflict giữa hai Serializable transactions phải abort ít nhất một
  và service retry nguyên transaction đọc state mới; E2E hai app phải chứng minh.
- Fence BEFORE UPDATE/DELETE luôn reject; receipt immutable trigger hiện có giữ
  nguyên nhưng CHƯA đủ: trigger cũ chỉ chặn UPDATE khi OLD.status=SUCCEEDED.
  Migration mới bắt buộc thêm **identity guard BEFORE UPDATE trên OrderCommand
  từ lúc INSERT claim**, áp dụng cả PROCESSING lẫn SUCCEEDED. So sánh NULL-safe
  (IS DISTINCT FROM) từng field `id, orderId, actorScope, actorType, actorId,
  idempotencyKey, command, requestHash, hashVersion, createdAt`; bất kỳ thay đổi
  nào đều raise23514 với constraint cố định. Không cho đổi nhiều field đồng thời
  thành bộ identity khác vẫn hợp lệ để tránh INSERT cross-table guard.
  Chỉ các field hoàn tất `status,responseStatus,resultSnapshot,completedAt` được
  thay đổi trong transition PROCESSING→SUCCEEDED đúng receipt constraints hiện
  hành; no-op identity được phép, hashVersion không là đường escape. Không sửa
  trigger/migration cũ; bổ sung trigger mới. Scope SYSTEM cũng giữ identity bất
  biến. Không cho “sửa key/hash” để vượt ràng buộc. Database role ứng dụng không
  được disable trigger; privileged SQL/DBA không nằm trong threat model này.
- Direct test fixtures ghi OrderCommand ngoài Serializable có thể bị chặn; phải
  cập nhật helper test, không tắt guard để giữ test xanh. Rollback data test không
  được biến thành cleanup fence production hoặc TTL.

Đây là đề xuất DDL/protocol, CHƯA phải migration đã chạy. Nếu proof hai process/
isolation phát hiện chưa đủ thì đổi sang registry unique dùng chung trong PR
implementation và xin review lại; không merge giải pháp chỉ an toàn một process.

## 6. Bắt buộc kiểm toàn bộ writer chung namespace

Sau authorize/lock, trước policy/claim: helper chung assert scope/key chưa bị
fence. Fence cùng identity →409 ORDER_COMMAND_CLOSED; khác identity/hash →409
IDEMPOTENCY_CONFLICT. Với caller không phải C2 mà dùng lại key bị fence →conflict,
không cho reset scope theo role hoặc lộ nội dung fence.

| Service hiện có | Command | Scope / điểm tích hợp |
|---|---|---|
| SellerOrderCommandService | confirm/start-packing/ready-to-ship | USER:id; trước transition/Payment |
| OrderCancellationService | Buyer/Seller cancel | USER:id; trước policy/hoàn kho |
| OrderReturnedService | Seller/Admin confirm-returned | USER:id; trước policy/stock |
| OrderDeliveryService | Admin ship/mark-delivered/delivery-failed/retry-delivery | USER:id; trước state/Payment |
| OrderCompletionService | Buyer complete | USER:id; trước completion policy |
| OrderCompletionService | SYSTEM D07 complete | SYSTEM:ORDER_AUTO_COMPLETE; namespace riêng, không đổi logic |

Rà OrderCommand.create toàn repo trước bàn giao. Application helper cho lỗi API
dễ hiểu; DB guard là lớp fail-closed nếu writer quên gọi helper. Không nhận đã
an toàn khi chỉ thêm check trong ba endpoint Seller.

## 7. Lỗi và quy tắc FE

400 VALIDATION_ERROR/IDEMPOTENCY_KEY_REQUIRED;401 UNAUTHORIZED;403 FORBIDDEN;
404 ORDER_NOT_FOUND;409 IDEMPOTENCY_CONFLICT/ORDER_COMMAND_CLOSED/
ORDER_COMMAND_IN_PROGRESS;413 REQUEST_TOO_LARGE;429 RATE_LIMITED;500 INTERNAL_ERROR.
Mọi lỗi giữ envelope C2 `{statusCode,code,message}` an toàn; no-store/Retry-After.
ORDER_COMMAND_CLOSED ở execute không đủ để FE clear: cần envelope CLOSED200 từ
resolve với đúng invocation và pending identity.

FE chỉ gọi sau explicit confirmation. Unknown cả execute và resolve đều giữ key.
COMMITTED: full receipt validator + session generation + pending identity →ack.
CLOSED: strict envelope + current actor/session + invoked key/order/command khớp
pending →settleClosedIntent mới; KHÔNG fake success commandId. Storage remove lỗi
vẫn blocked. Sau cả hai outcome, GET mới; GET lỗi không phát command mới.
Không auto resolve/replay on mount, expire/logout-clear hoặc GET-based ack.

## 8. Acceptance trước merge implementation / trước bật Web

Ma trận [resolution tests](../testing/order-command-resolution-acceptance.md)
phải có kết quả thực và baseline/schema rõ. Hiện tất cả ca mới NOT_RUN.
Chỉ sau Backend migration/worker-free API + FE settlement/controller + browser/
HTTP/PostgreSQL QA và reviewer duyệt mới bật nút C2. Review contract không phải
nghiệm thu code. Không thao tác database demo hoặc sửa migration dùng chung.
