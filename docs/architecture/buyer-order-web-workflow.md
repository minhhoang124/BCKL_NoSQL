# Buyer Order Web — cơ chế xử lý và phục hồi

Branch tích hợp từ develop `023ce96` sau merge #95/#96; không thêm Backend,
migration hoặc đổi contract resolver. Tài liệu mô tả code mới của PR này,
chỉ CURRENT trên develop sau khi PR tích hợp được merge.

## Ranh giới

- `/account/orders/:orderId` dùng `BuyerOrderWorkspace` với AuthContext/GET
  hiện có. `ProtectedRoute` và workspace đều yêu cầu active USER; Backend
  quyết định ownership từ JWT/DB, không dùng ID gửi từ UI để cấp quyền.
- `OrderReadPage` vẫn đọc list như trước. Buyer detail bật mặc định; biến build
  `VITE_BUYER_ORDER_COMMANDS_ENABLED=false` trả về màn chỉ đọc để rollback UI.
  Đây không phải công tắc bảo mật của Backend. Seller giữ gate riêng đã có.
- `OrderDetailPanel.showActions=false` chỉ ở workspace Buyer để không render
  thêm bộ nút disabled cũ; panel Seller và bản read-only vẫn giữ mặc định.
- `BuyerCommandReview.integrated=true` chỉ đổi nhãn giải thích. Consent,
  snapshot body/binding và latch của component #96 không bị bỏ qua.

## Hai hành động và điều kiện

| Hành động | UI chỉ cho chọn khi | Điều vẫn do Backend quyết định |
| --- | --- | --- |
| Hủy | PENDING_CONFIRMATION, COD/UNPAID, paidAt null, VND và amount=total | Owner đang hoạt động, trạng thái dưới khóa, hoàn kho/outbox/history nguyên tử |
| Hoàn tất | DELIVERED/PAID, paidAt hợp lệ, VND và amount=total | Đã giao/thanh toán hợp lệ, chỉ một completion khi Buyer/D07 cạnh tranh |

Chọn nút chỉ mở confirmation, chưa POST. Hủy nhập reasonCode/reasonText và
đồng ý; đổi lý do phải đồng ý lại. Hoàn tất phải xác nhận đã nhận hàng. Có
“Quay lại, chưa gửi”; không Enter/double-click để tự tạo thêm lệnh.

## Những biến cần hiểu

| Biến | Nội dung và mục đích |
| --- | --- |
| `identity` | actorId và thế hệ phiên cố định lúc tạo controller; không chứa token |
| `epoch` | Tăng mỗi lần mount/unmount; response của lần gắn màn cũ không được ghi state hoặc mở khóa lần mới |
| `job` | Một object riêng cho công việc đang chạy; finally chỉ xóa đúng object của nó, không mở khóa request khác |
| `runtime` | Bộ execute/resolver/journal #95; mỗi epoch tạo instance mới, cleanup dispose instance cũ |
| `readKey` | Ghép phiên, Order, epoch, revision; confirmation từ lần đọc cũ không được gửi |
| `pending` | Metadata mã yêu cầu chưa rõ kết quả trong sessionStorage theo actor, không chứa reason/token |
| `outcome` | Chỉ `committed`/`closed` sau runtime kiểm receipt/fence thật; GET status không là proof |
| `revision` | Số thay đổi UI state để reset binding/consent; KHÔNG phải Order.version hoặc Product.version |

`job`/epoch là bảo vệ giao diện, không thay khóa/idempotency của PostgreSQL.
React StrictMode setup→cleanup→setup không tái sử dụng runtime đã dispose.
Callback GET cũ bị chặn kể cả mock transport không chấp nhận AbortSignal.

## Các trạng thái chính

- `loading`: GET đang chạy; không chọn/gửi lệnh.
- `ready`: GET hợp lệ, đúng phiên, không pending; xét nút theo Order/Payment.
- `confirm-new`: chỉ RAM chứa draft/lý do và consent, khóa reload bên ngoài.
- `sending`: một POST explicit, journal đã lưu trước; không auto-retry/refresh.
- `unknown`: giữ key gốc; chỉ đối chiếu khi người dùng đồng ý riêng. Nếu key
  thuộc đơn khác, đưa link về đơn đó, không đóng nhầm key hiện tại.
- `resolving`: một POST đối chiếu; không gọi execute hoặc tạo key mới.
- `committed-refresh-error`: receipt đã xác minh nhưng GET lỗi; giữ kết quả
  cũ trong runtime, chỉ GET retry, không gửi lại lệnh.
- `closed-refresh-error`: đã có fence nhưng chưa GET mới; chưa cho ý định mới.
- `blocked`: phiên/storage/metadata không xác minh được; không tự xóa pending.
- `error`: chưa đọc được đơn; chỉ thử GET, không suy Order tồn tại từ lỗi404.

Khi COMMITTED và GET đạt, dùng Order mới để hiển thị. Khi CLOSED và GET đạt,
có thể tạo runtime mới cho **một lần xác nhận mới**; old runtime vốn cố ý khóa
execute sau settlement. Không reset runtime để vượt GET failure hoặc unknown.
Chi tiết vẫn giữ khi mạng lỗi phải gắn nhãn “lần đọc trước”; không trình bày
PENDING/UNPAID cũ như bằng chứng lệnh vừa rồi đã rollback.

## Phục hồi và quyền riêng tư

Metadata v2 lưu orderId/actor/command/key/hashVersion/requestHash/createdAt.
Reason chỉ trong RAM/request và bản ghi nghiệp vụ Backend; không localStorage,
sessionStorage, URL hoặc log UI. Token chỉ qua client/Auth hiện có.

Legacy v1 chỉ có Buyer complete body{} được phục hồi: hiển thị consent riêng;
chỉ sau đồng ý mới nâng cấp hash/CAS trong runtime rồi resolve key gốc. Không
tự invent reason/hash cho cancel cũ. Metadata hỏng không được “dọn” để mở nút.

Logout/account/role/order-route change unmount controller, abort GET/command
và dispose runtime. Callback của phiên cũ không cập nhật UI hoặc xóa pending
của actor khác. Journal tồn tại qua reload cùng tab, không bảo đảm qua đóng tab.
Không có đồng bộ xuyên thiết bị hoặc tự resolver khi đăng nhập.

## Kiểm thử và giới hạn

[Báo cáo runtime/Chrome](../testing/buyer-order-web-runtime-2026-10-23.md).
Unit/component dùng HTTP mock có nhãn; Chrome dùng route production và
Nest/PostgreSQL QA thật. Không nhận các test mock là integration/DB proof.
Không thay full G-CHECKOUT/G-FULFILMENT, Search loaded index, vận chuyển thật,
thông báo, hậu mãi hoặc Seller cancel/returned UI. Những phần đó còn gate riêng.
