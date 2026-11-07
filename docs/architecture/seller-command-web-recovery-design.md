# Seller chuẩn bị đơn trên Web và phục hồi lệnh — 16/10/2026

## 1. Nguồn chuẩn, trạng thái và phạm vi

Đồng bộ 17/10 lên develop `ad3b969` sau #28. Giữ nguyên thiết kế đã được
Hiền approve tại `fbbb13d`; chỉ cập nhật nền và cần review delta mới.
Không thêm API/schema hoặc bật POST trong lần đồng bộ này.

Baseline thiết kế ban đầu `develop 09daae0` có Backend C2 (#43) và FE adapter/read
panels (#55). Khi đó #56 head `f389134` còn OPEN, không được dùng làm nền code.
Đồng bộ ngày 16/10 trên `develop 035656b`: #56 và #57 đã merge, lần lượt cung cấp
journal/coordinator và màn Order GET; chưa là command UI. #60 chỉ chuẩn bị cầu nối;
#62 đề xuất contract resolution chi tiết và #63 chuẩn bị kiểm thử, đều chưa merge.
Không lấy code từ các PR đang review hoặc coi test chuẩn bị là runtime đã chạy.

Nguồn: [C2 đã triển khai](../api/seller-order-command-contract.md),
[contract chung mục 7.1](../api/cart-order-inventory-api-contract.md),
[phạm vi](../project/implementation-scope.md), SRS FR-ORD-01/UC-HT07.
Hoàng triển khai, Hiền review nghiệp vụ; không cần chờ Đạt duyệt C2 độc lập
vì không đổi stock/version/outbox hoặc contract Search.

**CURRENT** trong tài liệu này là điều đã kiểm từ code merged; **PROPOSED** là
đề xuất cần review riêng. Đây là thiết kế, chưa thêm API/schema/dispatcher.
Không sửa migration đã merge hoặc biến approval foundation thành nghiệm thu Web.

## 2. Luồng nghiệp vụ C2 — theo API đã merge

| Người thao tác | Trạng thái nguồn | Nút / endpoint POST | Trạng thái đích |
|---|---|---|---|
| SELLER active, đúng Store | PENDING_CONFIRMATION | Xác nhận / `confirm` | CONFIRMED |
| SELLER active, đúng Store | CONFIRMED | Bắt đầu đóng gói / `start-packing` | PACKING |
| SELLER active, đúng Store | PACKING | Sẵn sàng bàn giao / `ready-to-ship` | READY_TO_SHIP |

Prefix `/seller/orders/:orderId/`, body cố định `{}`, không query. Header
Idempotency-Key giữ nguyên 16–128 ký tự. Store ACTIVE/SUSPENDED được xử lý
Order cũ khi Seller active; Store khác bị chặn. Không mở quyền bán/checkout mới.
Payment phải khớp Order.total/VND: COD UNPAID/paidAt=null hoặc VNPAY/MOMO
PAID/paidAt hợp lệ. Payment null không tự được bổ sung hoặc suy đoán.

Seller kiểm đơn/detail mới → xác nhận rõ mã đơn và hành động → gửi một lệnh →
kiểm receipt → tải lại detail. Không tự chuyển tiếp sang bước kế tiếp; mỗi bước
là một ý định mới, confirmation và key mới sau khi bước trước được giải quyết.
READY_TO_SHIP chưa là SHIPPING/DELIVERED; Seller không tự giao thành công.

Backend khóa User → Store → Order → Payment, transaction Serializable, đọc lại
quyền và tìm receipt cùng scope/key trước policy trạng thái. Một lệnh ghi Order,
history và receipt SUCCEEDED cùng commit/rollback. Replay trả receipt bất biến,
không phải trạng thái theo dõi mới nhất. C2 không đổi kho, Payment, Product.version,
SearchOutbox, item/address snapshot; không tự phát notification giả.

## 3. Cầu nối #55 ↔ #56 — thiết kế triển khai sau dependency merge

**Các module đã xác định:**

- #55 `prepareSellerCommand` tạo handle bất biến trong WeakSet; JSON lấy từ storage
  không phải handle hợp lệ. `sendSellerCommand` có timeout30s, không retry/refresh
  POST sau401 và validate đầy đủ receipt/actor/order/command.
- #56 journal lưu pending intent trong sessionStorage theo actor ID; coordinator
  chụp/kiểm actor-role-active-session version trước gửi và trước acknowledge.
- Controller React ở ngoài panel giữ lifecycle; panel chỉ hiển thị và phát ý định.
  Không tạo journal/coordinator mới mỗi render để vô hiệu latch đang chạy.

**Trình tự bắt buộc:**

1. Auth xác minh Seller active. Đọc journal đúng actor; dữ liệu hỏng/storage lỗi
   chặn POST, không tự xóa để vượt khóa. Có pending thì hiển thị trước nút mới.
2. Với lệnh mới: detail đã tải đúng Order/Store/phiên và trạng thái; confirmation
   nêu mã đơn, hành động. Chưa confirm không prepare/persist hoặc POST.
3. Journal prepare và đọc lại thành công trước HTTP; coordinator giữ latch đồng
   bộ (chốt chống bấm trùng). Chụp session generation hiện hành.
4. Adapter tạo `prepareSellerCommand(intent.orderId, intent.command, actorId,
   intent.idempotencyKey)` bằng **key cũ** sau xác minh actor/role. Handle mới cho
   phiên mới; không deserialize/cast WeakSet handle hoặc tạo UUID mới để retry.
5. Gọi sendSellerCommand với AbortSignal/deadline. Backend kiểm lại ownership;
   quyền từ UI/journal không là bảo đảm server. Không auto POST retry kể cả401.
6. Chỉ sau runtime validator của #55 chấp nhận toàn receipt mới rút acknowledgement
   `{orderId, command, commandId}` cho coordinator. Typed object hoặc GET detail
   đạt trạng thái đích không phải bằng chứng lệnh đã thành công.
7. Coordinator kiểm lại session và pending identity rồi acknowledge. React cũng
   kiểm generation trước hiển thị toast/state; callback cũ không tác động phiên mới.
8. Sau receipt hợp lệ, GET detail/list mới; GET lỗi phải báo “Đã ghi nhận lệnh,
   chưa tải lại được đơn”, khóa bước tiếp theo tới khi đọc thành công. Không báo
   “thất bại” khiến người dùng gửi lệnh mới thay lệnh đã thành công.

**Reload/unknown outcome:** sau Auth xác minh, hiện Order/command và nút “Gửi lại
cùng yêu cầu” có xác nhận; giữ nguyên key/body, không tự gửi khi mount. Timeout,
abort, mất mạng,5xx,200hỏng hoặc auth đổi đều giữ pending. Nếu không còn quyền,
không gửi lại bằng tài khoản khác. Đóng tab/storage mất dữ liệu không được cam kết
phục hồi; không dùng sessionStorage làm bảo đảm đa tab hoặc database lock.

**UI state đề xuất:** loading → ready → awaiting-confirmation → persisting →
sending → acknowledged-refreshing → ready; lỗi gửi → outcome-unknown;
storage/receipt/session identity hỏng → blocked. “acknowledged-refresh-error”
khác “outcome-unknown”. State nào có thể POST đều cần latch và session hiện hành.

## 4. Từ chối chắc chắn — không mắc kẹt nhưng không xóa nhầm

### 4.1 Quy tắc có thể áp dụng ngay

| Quan sát | Quyết định |
|---|---|
| Chưa confirmation/prepare thất bại, không có pending được lưu | Không POST; hiển thị lỗi, không tạo lệnh để rồi phải dọn |
| Receipt C2 hoàn chỉnh đúng identity đã validate và còn đúng phiên | Acknowledge đúng pending; sau đó GET mới |
| 400/401/403/404/409/413/429, kể cả code business quen thuộc | Không tự clear pending chỉ từ status/code; cần biết kết quả của **key**, không chỉ request vừa trả lỗi |
| timeout/abort/5xx/200hỏng/IN_PROGRESS | Giữ key/body, không auto retry hoặc cho “bỏ qua” |
| GET thấy trạng thái đã đổi hoặc lookup không thấy | Không coi là ack, không chứng minh mọi request cũ đã chấm dứt |

Backend hiện trả lỗi `{statusCode,code,message}`, chưa có kết quả từ chối bền vững
gắn key để journal xác nhận. 401/404 kiểm quyền trước replay có thể che receipt
đã commit của lần trước. Một request mới bị từ chối cũng không là hàng rào chống
request cũ đến muộn; Store/Payment/quyền có thể thay đổi trở lại. Vì vậy không thể
giải quyết an toàn toàn bộ “definite rejection” bằng một allowlist lỗi FE.

### 4.2 PROPOSED — đối chiếu và đóng ý định ở Backend

Thiết kế ưu tiên **một thao tác đối chiếu/đóng key** có xác nhận, không nút xóa
storage tùy ý. Đây là thay đổi contract/schema cần PR riêng và Hiền review trước
code; không tuyên bố endpoint dưới đã tồn tại.

- Đề xuất `POST /seller/orders/:orderId/resolve-command`, body strict
  `{command:'confirm'|'start-packing'|'ready-to-ship'}`, header Idempotency-Key
  chính là key cũ. “Resolve” = đối chiếu kết quả và, nếu chưa thực hiện, chặn
  vĩnh viễn ý định cũ; không chỉ đọc status. UI nói rõ có thể dừng lệnh chưa chạy.
- JWT/current Seller active + ownership kiểm lại trong transaction; không cho
  client gửi actorId/hash/status. Hash canonical v1 tái tính đúng C2 body `{}`.
- Khóa actor User → Store → Order theo cùng protocol writer, Serializable và
  retry/deadline hữu hạn. Khóa actor-wide bảo vệ scope/key xuyên các Order.
- Nếu OrderCommand cùng key SUCCEEDED đúng hash: trả discriminated envelope
  `outcome:'COMMITTED', receipt:<full canonical C2 receipt>`; validate rồi ack.
- Nếu chưa có receipt: tạo **fence bền vững** (bản ghi chặn key cũ) cùng hash,
  actorScope/order/command và resolvedAt, trả
  `outcome:'CLOSED_WITHOUT_EXECUTION', resolutionId, orderId, command, resolvedAt`.
  Không đổi Order/Payment/history/kho/outbox. Không throw trước commit làm fence
  rollback rồi vẫn trả “đã đóng”. Response chỉ sinh từ transaction đã commit.
- Đề xuất bảng mới riêng, tên dự kiến `OrderCommandResolution`, unique
  `(actorScope,idempotencyKey)`, immutable identity/hash/outcome; migration mới,
  không thêm trạng thái REJECTED vào OrderCommand đang có ràng buộc receipt/history.
- **Bắt buộc kiểm mọi writer chia sẻ namespace `USER:<actorId>`**, không chỉ C2:
  cancel, returned, complete và delivery của cùng ID sau đổi role cũng không được
  dùng key đã đóng cho command/hash khác. Dùng helper chung kiểm fence sau quyền
  và trước policy/claim trong cùng actor lock; thêm DB guard ở migration mới để
  không có fence và SUCCEEDED cùng scope/key nếu một writer bị bỏ sót. Chi tiết
  constraint/trigger và thứ tự khóa cần review/test nâng cấp, chưa có DDL ở đây.
  Key đã đóng luôn bị chặn (kể cả request cũ đến muộn); không TTL/xóa fence sớm
  hơn receipt hoặc cho ghi lại cùng key. SYSTEM scope khác không bị mở quyền mới.
- Nếu lệnh cũ đã thắng lock và commit trước: resolver chỉ trả COMMITTED. Nếu
  resolver thắng: fence commit trước, lệnh cũ sau đó không thực thi. Không tạo
  cả receipt thành công lẫn fence cho một key. Key/hash/order khác → conflict,
  không clear hoặc tiết lộ dữ liệu của Order ngoài quyền.
- Lặp resolve cùng key/hash trả cùng outcome/identity, không nhân bản. Resolve
  timeout cũng giữ pending và gửi lại **resolve** có xác nhận; không sinh key mới.
- Dùng chung ingress quota C2 20/phút/actor/instance cho command/resolve/replay,
  Retry-After khi429; không tạo bucket riêng để bypass. Body8KiB, không query,
  no-store cả lỗi, response strict discriminated envelope. Backend deadline/retry
  hữu hạn theo C2, FE deadline30s; không ghi raw key/hash/body vào log.
- Backend đóng key khác với HTTP abort: abort chỉ hủy chờ client. Nếu chỉ thêm
  endpoint tra cứu “không tìm thấy” mà không fence writer thì chưa đủ an toàn.

FE cần hàm **mới** `settleClosedIntent` (tên đề xuất) khác acknowledge success:
runtime validate toàn envelope + current session + key của invocation + identity
pending; chỉ clear sau CLOSED_WITHOUT_EXECUTION hợp lệ. Không giả commandId
thành công. Storage remove thất bại tiếp tục blocked, không báo đã giải phóng.
Sau clear đọc lại detail, buộc xác nhận mới nếu còn muốn làm bằng key mới.

Mỗi account vẫn tối đa một pending/tab. Account bị khóa/mất ownership không có
quyền tự settle; cần phục hồi quyền hoặc quy trình vận hành riêng, không tự mở
endpoint Admin bypass hoặc gán “thất bại” để xóa client. Chi phí giữ metadata
chặn nhỏ nhưng phải có migration/index/quota/log không chứa raw key/hash/PII.

### 4.3 Điều kiện trước bật POST trên Web

Chốt với Hiền envelope/protocol fence, quota và phạm vi Seller-only; implement
Backend+E2E trước, rồi mở rộng journal/coordinator/adapter với test. #56 giữ scope
foundation, không nhét contract/schema mới vào để đổi điều kiện review giữa chừng.
Chưa có cơ chế settle thì có thể hoàn thiện GET UI, không nhận full recovery đã xong.

## 5. Phạm vi PR tiếp theo và cách đọc

1. Hiền review thiết kế mục4, không đổi semantics Backend hiện hành bằng tài liệu.
2. PR Backend resolution riêng từ develop mới, migration expand-only và test hai
   app cùng DB. Không khóa trong một process làm bảo đảm duy nhất.
3. #56 đã merge; tiếp tục review cầu nối #60 và chỉ triển khai FE settlement sau
   contract/migration/API resolution được duyệt, chưa bật mọi command.
4. Nối C2 từng bước, kiểm Browser/HTTP/DB và cập nhật kiến trúc theo bằng chứng.

Ma trận: [Seller command Web](../testing/seller-command-web-test-matrix.md).
Thuật ngữ: intent = ý định cố định; receipt = biên nhận đã commit; acknowledge =
xác nhận receipt và giải phóng pending; fence = bản ghi DB ngăn key cũ chạy lại;
idempotent = gửi lặp không tạo hiệu ứng lặp; session generation = thế hệ phiên;
canonical = dữ liệu/quy tắc chuẩn từ Backend; rollback = hoàn tác giao dịch.
