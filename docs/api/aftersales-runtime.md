# API hậu mãi P1 —26/10/2026

Backend #119 đã merge tại `5802ae4`, base develop `f260192` sau #117.
Backend runtime, không phải UI hoặc hoàn tiền thật. Theo
[contract tiền chung](dashboard-aftersales-contract.md); Dashboard đọc cùng
RefundRecord/RevenueAdjustment trong [API Dashboard](dashboard-runtime.md) trên
nhánh riêng; chưa có aggregate API trong PR hậu mãi.

## Rollout và dữ liệu

Migrate26 `20261025190000_aftersales_runtime` và27
`20261026080000_aftersales_receipt_history_binding` **trước** khi nâng Backend.
Không sửa migration đã áp dụng. Giữ Order/Payment/kho/history cũ; không bịa
ReturnRequest cho đơn legacy. Nâng tất cả replica Backend có completion hook trước
khi cho client dùng API mới; không rollback về completion writer cũ khi còn
adjustment chờ. Prisma có map tên index thực tế; partial/expression
indexes, CHECK và triggers nằm trong SQL, không chỉ bảo vệ ở application.

`AFTERSALE_REQUEST_WINDOW_DAYS=7` mặc định, chỉ chấp nhận số nguyên1..30. Deadline
tính từ deliveredAt bằng giờ server DB, inclusive đúng mốc, lưu snapshot trên
request. Đây là hạn tạo yêu cầu mới, không tự hủy hồ sơ đang xử lý khi quá hạn.
Không nhận amount/time/actor/status do client tự đặt. Chỉ Order DELIVERED/COMPLETED,
Payment PAID/VND hợp lệ; snapshot discount/tổng tiền chưa hỗ trợ phải422 để rà lại.

USER mua hàng được dùng Buyer API. SELLER mua hàng cần cờ nền hiện có
`ACCOUNT_BUYER_ACCESS_ENABLED=true`; mặc định false vẫn giữ nguyên. Không tự mở
cờ hay đổi role để vượt gate. Admin không có quyền Buyer/Seller theo cấp bậc.
Mọi scope đọc lại actor active/role/credentialVersion trong DB; ghi đọc lại sau
User lock, quyền target theo Buyer của Order hoặc Seller hiện hành của Store.
Store ACTIVE/SUSPENDED/CLOSED được xử lý hậu mãi đơn cũ đã giao; không cấp quyền
bán mới. Admin quyết định **DISPUTED** hoặc xác nhận nhận hàng AWAITING_RETURN;
không nhận duyệt tùy ý PENDING. SLA/escalation khi Seller không phản hồi chưa có.

## Routes và phân trang

Các root: `/aftersales` (Buyer), `/seller/aftersales`, `/admin/aftersales`.
JWT bắt buộc; thành công/lỗi đều no-store. POST không nhận query. GET/HEAD không
nhận body. Input exact allowlist, không tự ép chuỗi thành revision/boolean.

| API | Scope/body |
|---|---|
| GET root | `limit`1..50 default20, `beforeId` int32 dương exclusive; idDESC |
| GET root`/requests/:id` | `limit`1..50 default20, `beforeRevision` int32 dương exclusive; lịch sử revisionDESC |
| POST `/aftersales/items/:itemId/requests` | Buyer, create body dưới đây |
| POST root`/requests/:id/cancel` | Buyer, PENDING→CANCELLED |
| POST root`/requests/:id/dispute` | Buyer, REJECTED→DISPUTED nếu còn hạn mức item |
| POST root`/requests/:id/approve` hoặc`/reject` | Seller: PENDING; Admin: DISPUTED |
| POST root`/requests/:id/receive` | Seller/Admin, AWAITING_RETURN |
| POST root`/commands/:action/:targetId/reconcile` | action đúng scope, cùng metadata của command |

Unknown/duplicate/bracket query, cursor0/leading-zero/overflow bị400. Mỗi trang
là snapshot riêng; đọc lại đầu để thấy audit mới. List trả
`{items,nextBeforeId}`; item gồm request projection + context. Detail trả
`{context,request,history,nextBeforeRevision,refund}`. Context chỉ
`{orderId,storeId,buyerId,storeName,productName,quantity,lineTotal}`; tên sản phẩm
và tiền là OrderItem snapshot. Không trả địa chỉ, điện thoại, email, token/hash.
Audit gồm id(bigint string), actorId, from/toState, from/toRevision, reason, createdAt.

## Body ghi và fingerprint v1

Create exact:

```json
{"commandId":"d493ab07-2c84-4d3a-9e98-bcd636189740","kind":"REFUND_ONLY","reasonCode":"DAMAGED","description":"Sản phẩm đã nhận bị hư hỏng"}
```

Kind `REFUND_ONLY|RETURN_AND_REFUND`; reasonCode
`DAMAGED|WRONG_ITEM|NOT_AS_DESCRIBED|OTHER`. Description/reason NFC→trim10..1000
Unicode codepoints; từ chối control Cc trừ TAB/LF/CR và lone surrogate Cs.

Cancel/dispute/approve/reject exact `{commandId,expectedRevision,reason}`.
Receive thêm bắt buộc `restockable:boolean`; chuỗi`"false"` không được nhận.
UUIDv4 lowercase; revision int32 dương. Đổi target/action/body dùng key mới chỉ
sau khi đã xác định kết quả mã cũ; không tự resend sau timeout.

Canonical body theo đúng thứ tự key: create `{kind,reasonCode,description}`;
thao tác khác `{expectedRevision,reason}`, receive append`restockable`.
`requestHash=SHA256(UTF8(JSON.stringify({scope,action,targetId,body})))`, lowercase
64hex; scope `BUYER|SELLER|ADMIN`. UUID/actor không nằm trong hash, namespace là
unique(actorId,commandId). Body writer không nhận requestHash do client áp đặt;
server luôn tự chuẩn hóa/tính. Helper chuẩn: `BE/src/aftersales/aftersales-input.ts`.

## Response ghi và đối chiếu

HTTP200 `{commandId,outcome,receipt,current}`. APPLIED receipt exact:

```json
{"request":{"id":125,"orderItemId":310,"kind":"REFUND_ONLY","state":"REFUNDED","revision":2},"historyId":"880","refund":{"id":"44","amount":"100000.00","currency":"VND","mode":"SIMULATED"}}
```

`refund=null` nếu bước đó chưa ghi refund. Receipt là kết quả lịch sử, current
có thể đã ở revision khác. Với target create, replay/reconcile current có thể
null vì target là item, không phải request; lấy request.id từ receipt rồi GET.
Không suy từ current rằng command đã chạy. Không diễn giải SIMULATED là đã
chuyển tiền về ngân hàng/ví. Không gọi Search index đã đồng bộ từ receipt này.

Reconcile exact `{commandId,requestHash}` trên action/target gốc:

- Có record khớp: kiểm history actor/identity/revision/state, hash chuẩn hóa và
  refund thực; trả APPLIED receipt. Receipt tương lai/hỏng503, giữ record cũ.
- Chưa có: ghi CLOSED fence, receipt null. **Không** tạo/rút/duyệt yêu cầu,
  refund hoặc hoàn kho. Late writer cùng UUID bị409 AFTERSALE_COMMAND_CLOSED.
- Cùng key khác action/target/body/scope409 AFTERSALE_COMMAND_MISMATCH. Không
  dùng receipt để bypass quyền hiện hành. History id chỉ được một APPLIED UUID
  nhận nhờ expression unique index; ledger/history/refund không UPDATE/DELETE.

## Giao dịch và tiền/kho

SERIALIZABLE; User actor→Store SHARE→Order UPDATE→Payment UPDATE→OrderItem UPDATE
→request UPDATE→Product UPDATE→Variant. Toàn bộ state/revision/history, refund,
adjustment, movement/outbox và command cùng commit. Retry tối đa3 chỉ structured
40001/40P01/P2034 đã abort; timeout/unknown503, không tự chạy lại mutation.

Một active reservation/item qua partial unique index. REJECTED/CANCELLED/
ADMIN_REJECTED giải phóng; request mới vẫn phải trong cửa sổ tạo. Một refund
thành công/item trên mọi request/key. Dispute hồ sơ cũ khi hồ sơ khác giữ hạn
mức409 ORDER_ITEM_ALREADY_FULLY_REFUNDED (mã scope dùng cả reserved).

REFUND_ONLY duyệt→REFUNDED cùng transaction, không stock movement. RETURN_AND_REFUND
duyệt→AWAITING_RETURN; receive→REFUNDED, refund luôn được ghi khi quyết định hợp
lệ, chỉ RESTOCKABLE mới cộng đúng quantity snapshot. Chặn overflow; kiểm movement
CHECKOUT_DECREMENT, không có restore cũ. Product version+Search outbox cùng commit;
enqueue lỗi rollback cả refund/kho/audit/receipt. Không network/provider trong TX.

Refund đúng lineTotal, không shipping, không đổi Payment.PAID/OrderStatus. Adjustment
âm tạo đúng một lần; trước completion effectiveAt null, sau completion
max(refundSucceededAt,completedAt). Cả Buyer/system đi cùng completion method,
Order lock và activation hook trong transaction sau cập nhật Order. Không có
projection âm trước gross, không kích hoạt adjustment hai lần.

## Lỗi chính và bàn giao

400 input/query;401 phiên hết hiệu lực/khóa;403 scope;404 target ngoài quyền;
409 state/revision/window/budget/closed/mismatch;422 snapshot tiền chưa hỗ trợ;
503 unavailable hoặc receipt invalid. Lỗi không phải bằng chứng rollback/commit.
Không tự gửi UUID mới khi kết quả mã cũ còn unknown.

Fixture `pnpm --dir BE qa:aftersales:guards` kiểm chốt URL; seed bằng
`BE/scripts/aftersales-qa.mjs` chỉ app-role QA127.0.0.1:5549/v950, không dotenv.
Mỗi run namespace mới,3actor và3Order DELIVERED/COMPLETED/EXPIRED, không reset
audit. Credential ngẫu nhiên chỉ lưu file private trong artifacts, không log,
không commit/chụp/gửi GitHub. Launcher local có chốt demo dừng trước khi cấp URL.

Kiểm chứng và giới hạn: [báo cáo](../testing/aftersales-runtime-2026-10-26.md).
Chưa UI, thông báo hậu mãi, ảnh bằng chứng, hoàn một phần hay provider refund.
