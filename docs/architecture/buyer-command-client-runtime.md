# Buyer cancel/complete và recovery client — runtime chưa mount

22/10/2026. Branch `codex/buyer-command-client-runtime` từ develop `e394c9e`.
Backend #74, receipt validator #70, journal #75 và resolver adapter #84 đã merge.
PR này nối module client; không route, nút Buyer hoặc cờ giao dịch mới, không
phụ thuộc API Attributes #94 đang review. Không đổi Backend runtime/schema/Auth.

## Thành phần và biến

| Tên | Dữ liệu và trách nhiệm |
| --- | --- |
| `createBuyerIntentJournal` | Giữ nguyên bốn hàm public của #75; không cho caller xóa pending |
| `createBuyerSettlementJournal` | Factory tích hợp riêng: prepare/settle đúng proof và raw record |
| `createBuyerCommandRecovery` | Chỉ đối chiếu và GET; không expose execute |
| `createBuyerCommandRuntime` | Factory opt-in có execute cancel/complete, resolve, reload, dispose |
| `buyerCommandApi` | POST một lần bằng body gốc đã hash, kiểm receipt; không tự refresh/replay |
| `pending` | Metadata yêu cầu chưa rõ kết quả trong cùng slot `bckl-order-command-journal-v1:<actorId>` |
| `requestHash/hashVersion` | SHA256 v1 khớp contract #69, không là chữ ký/quyền hoặc mã hóa reason |
| `raw` | Chuỗi storage đã đọc; phải còn nguyên trước settlement, kể cả format/timestamp |
| `handle/proof` | Object và WeakMap chỉ ở RAM, gắn invocation/session/order/key/hash/tiền, không chấp nhận JSON clone |
| `owner/sessionVersion` | Actor đã xác minh và thế hệ đăng nhập; không tái sử dụng instance qua phiên khác |
| `settled` | Outcome đã biết sau proof + xóa/readback thành công; sau đó chỉ GET |
| `busy/flight/dispose` | Chặn click cùng tick; AbortController theo view, abort không chứng minh rollback |

V2 lưu đúng9fields: schemaVersion,actorId,role,orderId,command,idempotencyKey,
createdAt,hashVersion,requestHash. Không lưu reason/body/token/receipt. Body gốc
được normalize/snapshot trước await và nằm trong WeakMap riêng, không public handle.
Không tự NFC/collapse/reorder khác canonical hash v1. Legacy USER complete v1
nâng metadata sau consent, giữ key/time; Seller v1 hoặc unknown không bị xóa/ghi đè.

## Execute sau khi view tương lai xác nhận

1. Current verified USER/session, route orderId khớp detail đã validate,
   consent thật, không busy/pending/settled. Cancel guard UX yêu cầu
   PENDING_CONFIRMATION+COD/UNPAID; complete DELIVERED+PAID. Backend vẫn quyết
   ownership, trạng thái, khóa tài khoản và điều kiện giao dịch thực tế.
2. Chụp command/body/order trước await; journal tạo key/hash, ghi storage và
   readback trước POST. Có bất kỳ pending nào thì không execute/new key tiếp.
3. `prepareExecution` kiểm body RAM khớp hash đã lưu, kiểm session/raw record
   sau async digest. `sendBuyerCommand` POST `/orders/:id/cancel|complete`,
   key/body gốc, no-store, timeout30s + signal view, không refresh/replay401.
4. Kiểm receipt đúng order/actor/command/tiền/reason/time/timeline bằng validator
   đã merge. Adapter cấp proof object; journal kiểm proof, session và raw record,
   remove đúng slot rồi đọc lại null. Claim chỉ dùng một lần trong journal đó.
5. Ghi known COMMITTED trong RAM rồi GET detail. GET lỗi chỉ reload GET;
   không POST lại, không tạo key/pending mới hoặc đổi known outcome về unknown.

## Đối chiếu sau mất phản hồi/reload

Không tự dựng body hủy từ fingerprint. Sau consent riêng, coordinator lấy
immutable total từ detail đã validate, gửi original key và exact
`{command,hashVersion,requestHash}` tới `/orders/:id/resolve-command`.
GET detail chỉ cho expectation, không là proof để xóa pending.

- COMMITTED: kiểm receipt gốc/replayed và tái tính fingerprint, rồi settle.
- CLOSED_WITHOUT_EXECUTION: kiểm fence identity/id/time; đóng mã chưa thực hiện,
  không gọi đây là hủy hoặc hoàn tất Order.
- Network/timeout/HTTP lỗi/malformed200: giữ raw pending và original key.
- Đổi account/login mới cùng ID/role/active/unmount: không settle response cũ.
- Storage remove/readback lỗi: fail-closed, không overwrite/restore record mới.

State `confirm-resolution`, `executing`, `resolving`, `blocked`, `committed`/
`closed` và `*-refresh-error` phục vụ view tương lai. Caller phải lấy state từ
đúng instance hiện hành và dispose khi unmount; không render response phiên cũ.

## Giới hạn và gate nối UI

sessionStorage theo tab: đóng tab/xóa storage có thể mất pending, không cross-
device/global journal. Web Storage raw compare không là CAS nguyên tử đa tab;
busy chỉ trong instance. Backend Serializable/idempotency/transition mới là
bảo đảm ghi đúng một lần. Proof WeakMap không chống XSS/extension hoặc thay
authorization server. Outcome RAM không được coi là thông báo bền vững sau reload.

Không mount component/route hoặc bật Buyer/Seller flag trong PR. Chưa browser
desktop/mobile/theme, login UI, nhiều tab/device hoặc nghiệm thu toàn COD Web.
Sau review/merge module: PR UI riêng nối consent/lifecycle vào Buyer detail,
test Chrome→HTTP→PostgreSQL trước bật giao dịch. Không lấy mock HTTP làm bằng
chứng integration. [Kiểm thử mới](../testing/buyer-command-client-runtime-2026-10-22.md).
