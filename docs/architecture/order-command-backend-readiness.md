# Chuẩn bị Order detail, vòng đời đơn và hoàn kho

Ngày đồng bộ: **14/10/2026**. Baseline `origin/develop 515f68a` sau merge #43 chuẩn bị đơn, giữ #42 detail/#38 audit/#45 DeliveryAttempt. Nhánh #44 giữ list/detail/Seller preparation/cancellation và parser riêng của từng nhóm; không ghép delivery/complete chưa merge.

Trạng thái: **IN_PROGRESS — detail CURRENT ở lớp Backend trên develop; C3 có code trên nhánh #44, chưa merge và chưa nghiệm thu toàn luồng Web**. Các mục 3, 7, 8 và kết quả cũ ở mục 9 là bằng chứng lịch sử; runtime C3 xem mục 10. Contract detail ở [order-detail-read-contract.md](../api/order-detail-read-contract.md); test đồng bộ #44 được ghi riêng, không lấy số liệu trước merge #42 thay kết quả head mới.

Đợt T0 ngày 09/10 đã thêm `20261009090000_order_command_audit_foundation`, hai bộ test schema/upgrade và [bằng chứng kiểm thử](../testing/order-command-foundation-verification.md). Phần audit chỉ đọc ở mục 3 và 7 là kết quả lịch sử trước đợt triển khai này, không phải kiểm tra mới trên DB demo. T1–T6 vẫn chưa hoàn thành; không lấy test schema làm bằng chứng luồng Order chạy được.

## 1. Nguồn yêu cầu, không thiết kế ngược từ code

- [SRS v3.1](../analysis/hien/srs-v3.md): FR-ORD-01, FR-CAN-01, D06/D07.
- [API contract đã merge #27](../api/cart-order-inventory-api-contract.md): mục 6–11, 13.
- [Thiết kế Cart–Order–Inventory nền](cart-order-inventory-design.md).
- [Phạm vi nghiệm thu](../project/implementation-scope.md): G-CHECKOUT và G-FULFILMENT.
- PR [#36](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/36): create COD và receipt Checkout đã merge vào develop `a2561c1`.
- PR [#37](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/37): danh sách đơn Buyer/Seller đã merge vào develop tại `bed88a0` ngày 10/10. Đây không phải API chi tiết đơn.

Tình trạng review ở trên là ảnh chụp lúc kiểm tra; kiểm tra lại GitHub trước tích hợp. CI xanh không thay approval hoặc nghiệm thu luồng có UI.

## 2. Đã rà được gì từ schema và code?

| Thành phần | Hiện có | Còn cần cho luồng Order |
|---|---|---|
| Order/OrderItem | FK ownership, snapshot địa chỉ/tên/SKU/option/tiền | Mapper chi tiết chỉ đọc snapshot; không dựng lại từ Product/Variant/Address hiện tại |
| Payment | Tối đa một Payment mỗi Order, quan hệ nullable | Xử lý thiếu Payment legacy phải rõ; không tạo Payment khi GET |
| OrderStatusHistory | Baseline có actorId/fromStatus/toStatus/reason; branch T0 thêm audit nullable, commandId và dữ liệu lần giao | Writer/reader mới phải dùng audit có cấu trúc; chưa tự backfill legacy |
| Cancellation | Branch T0 thêm cancelledById/type, reasonCode/text nullable, giữ cancellationReason cũ | Service phải ghi đủ audit theo contract 7.2; không ghép JSON vào reason cũ |
| OrderCommand | Branch T0 có schema/migration, unique scope/key, composite FK, receipt bất biến và kiểm tra lúc commit | Chưa có service/API claim/replay/authorization hoặc state machine |
| DeliveryAttempt | C4.0 có schema/migration trên nhánh riêng; chưa merge/API | Lần giao hiện hành, tracking, 3 lần giao lại = tối đa 4 lần tổng |
| StockMovement | Decrement/restore, unique item/type, FK đúng Variant | Service hoàn kho cùng transaction; không coi unique movement là đủ thay OrderCommand |
| Checkout #36 + sửa tương thích #38 | Tạo history đầu fromStatus=null, pending, actorId=buyerId, actorType=BUYER trong transaction tạo COD | Replay không thêm history; không đặt default BUYER cho mọi history hoặc tự backfill lịch sử |

`actorId` là mã người thao tác; `actorType` là vai trò **tại lúc phát sinh sự kiện**, không phải quyền tài khoản lúc đọc lại. `receipt` là bản ghi kết quả lệnh để trả lại khi gửi lặp; không phải dữ liệu Order hiện hành để theo dõi giao hàng.

## 3. Kết quả kiểm tra PostgreSQL chỉ đọc

Script: [order-legacy-readiness-audit.sql](../testing/order-legacy-readiness-audit.sql).
Mỗi lần chạy dùng `REPEATABLE READ READ ONLY`, timeout statement 15 giây, timeout khóa 3 giây và `ROLLBACK`. Output chỉ là số lượng/schema/constraint, không có tên người nhận, địa chỉ, điện thoại, token, key hoặc hash.

| Database đã chọn rõ | Kết quả ngày 09/10 | Diễn giải đúng |
|---|---|---|
| `klcn_ecommerce` — DB demo | 7 migration; thiếu bảng Cart/Checkout/Order. Script dừng `ORDER_AUDIT_SCHEMA_NOT_READY` | **SCHEMA_NOT_READY**, không phải “0 đơn legacy” hoặc audit sạch. Không chạy migrate/seed/reset trên DB này |
| `bckl_order_list_20261008_a` — DB test riêng | 9 migration; 0 Order/Item/Payment/History/Movement; script chạy hết và rollback | Audit PASS trên schema nền, dữ liệu giao dịch rỗng; không chứng minh xử lý legacy có dữ liệu |
| `bckl_checkout_foundation_20261008_a` — DB test riêng | 10 migration, gồm receipt #36; 0 Order/Item/Payment/History/Movement; script chạy hết và rollback | Audit PASS trên nền Checkout; không phải nghiệm thu API detail/command |

DB demo còn thiếu hai migration **đã merge**: `20260930143000_cart_order_inventory_foundation` và `20261003140000_nullable_address_district`. Receipt `20261007100000_checkout_hash_receipt` thuộc #36 đang chờ merge; không lén áp dụng migration nhánh chưa duyệt vào DB demo.

Cả hai DB test chưa có 12 cột audit đích và hai bảng OrderCommand/DeliveryAttempt. Đây là phần TARGET chưa triển khai, không kết luận schema nền đã hỏng. Các chỉ báo Payment/tổng tiền/history/movement đều 0 vì không có giao dịch; không gọi đó là đã test các ca bất thường.

### Cách chạy lại an toàn

Ở root của checkout chứa script, PowerShell:

```powershell
Get-Content -Raw docs/testing/order-legacy-readiness-audit.sql |
  docker exec -i bckl_postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d <database-da-chon-ro>
```

Thay placeholder bằng tên DB đã đối chiếu; không tự lấy DB đầu tiên tìm được. Dùng credential môi trường nếu khác cấu hình local, không ghi mật khẩu vào lệnh/tài liệu. Không có PostgreSQL/Docker thì ghi NOT_RUN, không suy ra số liệu bằng schema Prisma.

Script kiểm tra cấu trúc, số lượng, Payment khớp tổng tiền, timeline liên tục/khớp Order, snapshot JSON và movement khớp quantity. Candidate history đầu khớp buyer chỉ là bằng chứng cấu trúc; **không phải phép cho backfill tự động**. Script không kiểm chứng đủ provenance, toàn bộ transition matrix, delivery attempt hoặc chất lượng mọi snapshot legacy; thiếu Order được ghi nhận riêng, không bị phép JOIN che khuất.

## 4. Trình tự triển khai tiếp theo

### C0 — tích hợp các nền đang chờ review

1. #36/#39/#37 đã merge. Hiền approve #38 tại `4655407`, yêu cầu đồng bộ sau merge #37 và chạy lại kiểm thử tích hợp trước merge.
2. Branch #38 đồng bộ `origin/develop bed88a0` bằng merge thường, giữ writer audit BUYER cùng các Order list API; chỉ conflict tài liệu kiến trúc, giữ đủ cả hai phần.
3. Kiểm thử lại head kết hợp chính thức trên DB riêng, ghi kết quả trong verification; không dùng kết quả checkout tạm trước đó thay kết quả mới. Chờ CI đúng head xuất bản rồi người dùng quyết định merge; agent không tự merge.
4. Khi cần demo: xác định đúng DB/backup, dùng các migration đã duyệt với `prisma migrate deploy`, không reset/db push/seed đè. Audit lại trước và sau. Bước này **chưa thực hiện trên DB demo**.

Kết quả đồng bộ #37 ngày 10/10: **377/377 unit, 331/331 E2E**, lint/full typecheck/build/Prisma validate đạt. Full E2E bao gồm hai suite schema/migration (37 ca) và COD create → Order list/audit/replay nhiều Store (71 ca). DB riêng `bckl_order_command_20261009_a`, 11 migration up to date; checksum audit giữ nguyên và cleanup fixture đạt. Xem verification cho giới hạn và kết quả lịch sử; chờ CI head mới, không coi API detail/commands đã hoàn thành.

### C1 — audit foundation và API chi tiết

Migration mới cho OrderCommand và cancellation/history audit theo contract 7.1/7.2; không sửa migration cũ. Chốt quy tắc legacy trước phần backfill/ràng buộc NOT NULL. Đồng bộ writer Checkout trong cùng PR nếu history mới bắt buộc actorType. Không giả định DB test rỗng đồng nghĩa mọi DB triển khai đều rỗng.

Tiếp đó triển khai `GET /orders/:id` và `GET /seller/orders/:id`:

- JWT active, đúng role, ownership lọc ngay trong SQL; không có/sai chủ cùng 404.
- Store bị suspended vẫn đọc đơn cũ nếu tài khoản Seller active; không dùng Product public để chặn lịch sử.
- Địa chỉ và item từ snapshot; tiền Decimal trả chuỗi; district nullable; không cập nhật dữ liệu bằng GET.
- Timeline sắp `(createdAt,id)`; Buyer không thấy actorId nội bộ của Seller/Admin.
- Không biến Payment thiếu thành COD/UNPAID giả; không đoán actor hoặc options cũ.
- GET có deadline, no-store, giới hạn tần suất và test HTTP thực, tương tự nền #37.

### C2 — Seller xác nhận và đóng gói

Command riêng `confirm`, `start-packing`, `ready-to-ship`, không nhận PATCH status tùy ý. OrderCommand + transition + history + snapshot kết quả commit/rollback cùng nhau. Replay đúng key/hash trả snapshot gốc sau kiểm tra quyền, không chuyển trạng thái lần hai. Khác key phải kiểm tra state nguồn, không suy diễn replay từ state đích.

### C3 — Buyer/Seller hủy trước giao và hoàn kho

Buyer hủy pending; Seller hủy pending/confirmed, bắt buộc code/text. Transaction phải cùng lúc ghi CANCELLED/audit, Payment CANCELLED, restore từng OrderItem đúng một lần, Product version/SearchOutbox và receipt lệnh. Stock-only giữ APPROVED. Một Product có nhiều Variant trong cùng đơn chỉ tăng version/phát một logical event trong transaction.

Giao thức khóa phải đối chiếu toàn bộ writer hiện có trước code: khóa actor/Order/Product theo thứ tự xác định; Product ID tăng dần thống nhất với Checkout. Không thêm đường lấy khóa User sau Product/Order gây đảo thứ tự với Checkout/Cart. Retry serialization/deadlock hữu hạn, phân loại đúng unique key, không retry mọi lỗi DB và không gọi dịch vụ ngoài trong transaction.

### C4 — vận chuyển mô phỏng và hoàn tất

Migration DeliveryAttempt/counters mới và API Admin/adapter theo 8.1. Không giao Seller quyền tự mark-delivered/complete. failed/delivered phải khớp attempt hiện hành; tracking đơn độc không đủ. DELIVERY_FAILED không tự hoàn kho; chỉ confirm-returned có bằng chứng và restockable=true. Buyer hoặc job SYSTEM hoàn tất theo D07 sau DELIVERED, COD đã PAID; job thực sự chạy, không chỉ có test gọi service trực tiếp.

Cập nhật 10/10: [C4.0](order-delivery-foundation.md) tách nền danh tính và migration
expand-only từ develop `27e083b`, không phụ thuộc code chưa merge #42/#43/#44.
Xem [verification](../testing/order-delivery-foundation-verification.md); các ca
delivery/complete HTTP ở mục 6 vẫn NOT_RUN, không đổi thành DONE vì có bảng mới.

C2–C4 chưa code/chưa test trong task này. VNPay/MoMo sandbox, refund P1 và UI Buyer Checkout/Order vẫn là các task riêng, không bỏ khỏi phạm vi bảo vệ.

## 5. Điểm cần Hiền review trước C1

Không thay yêu cầu SRS đã duyệt; các câu hỏi dưới đây chỉ khóa cách chuyển tiếp dữ liệu cũ:

1. Với history thiếu provenance: chọn phương án migration/API biểu diễn legacy rõ ràng hay chặn triển khai để xử lý thủ công. Không tự thêm actorType `UNKNOWN` vào contract hoặc gán SYSTEM/BUYER theo suy đoán.
2. Với Order thiếu Payment: detail hiển thị nullable có nhãn legacy hay trả lỗi dữ liệu an toàn? Command bắt buộc từ chối khi Payment không nhất quán; không tự tạo khi đọc.
3. Quy tắc snapshot option legacy sai shape: không lấy tên/option Variant hiện tại thay thế. Chốt hành vi fail-safe, không sửa ngầm dữ liệu lịch sử.

Các câu hỏi này không ngăn rà schema, viết test plan hoặc review #36/#37, nhưng chặn guessed backfill và tuyên bố detail đã đúng contract. Đạt chỉ cần review phần stock/version/outbox ảnh hưởng Search; không chuyển trách nhiệm thiết kế Order cho Đạt.

## 6. Checklist kiểm thử cho các PR triển khai

| Nhóm | Bằng chứng bắt buộc |
|---|---|
| Migration — PASS ở T0 | DB riêng đã migrate; schema cô lập nâng cấp từ migration cũ có fixture legacy; giữ snapshot; FK command/history khác Order bị từ chối; unique actorScope/key và command/history. Xem bằng chứng T0 |
| Detail | Buyer/Seller đúng chủ, sai chủ/role/inactive; snapshot sau sửa Product/Address; timeline riêng tư; Payment/options legacy theo quyết định review |
| Replay | Cùng key/hash hai app độc lập, mất response trước/sau commit, khác key cùng state đích, khác order/command/reasonText cùng key |
| Cancel | Buyer cancel vs Seller confirm; cancel vs Checkout; restore từng item một lần; rollback khi history/Payment/outbox/receipt lỗi |
| Search | Một version/event mỗi Product; payload canonical; retry event bất biến; stock 0→dương cập nhật index/hydrate thật với Đạt |
| Delivery | Attempt cũ đến muộn, tracking sai, retry 3 nhận/retry 4 chặn, lost/damaged không restore, replay không tăng counter |
| Complete | COD chưa PAID bị chặn; Seller/Admin không complete; Buyer vs job D07 chỉ một transition; runtime job có test kích hoạt |

Các dòng Detail/Replay/Cancel/Search/Delivery/Complete vẫn **NOT_RUN** ở cấp API/luồng nghiệp vụ. Test unique/transaction của T0 không thay test replay HTTP sau mất response, hoàn kho hay giao hàng. Không lấy test của #36/#37 làm bằng chứng cho C1–C4.

## 7. Bằng chứng lịch sử của lượt chuẩn bị trước T0

- PASS: SQL chạy hoàn chỉnh trên hai DB test kể ở mục 3; xác nhận `read_only=on`, isolation `repeatable read`, cả năm bảng giao dịch rỗng, có kết quả constraint/index và kết thúc `ROLLBACK`.
- PASS: khi chạy trên DB demo thiếu bảng, script thoát lỗi đúng `ORDER_AUDIT_SCHEMA_NOT_READY`, không tiếp tục xuất số liệu legacy giả.
- PASS: kiểm tra tĩnh script không có INSERT/UPDATE/DELETE/DDL/COMMIT; có READ ONLY và ROLLBACK. Kiểm tra các link local và whitespace đạt.
- NOT_RUN: fixture legacy có dữ liệu bất thường, migration mới và API detail/command; chưa có triển khai trong lượt này. Không chạy lại lint/build/unit/E2E ứng dụng vì không sửa code, schema, package hoặc cấu hình runtime.
- Chỉ sửa ba file tài liệu/script trên branch `codex/order-command-readiness`; chưa commit/push, chưa tạo PR, không đổi DB demo hay hai branch #36/#37.

## 8. Cập nhật T0 sau khi Docker hoạt động

- Hai suite Order chạy chung: **37/37 PASS**; toàn Backend **122/122 unit, 195/195 E2E PASS**. Prisma validate, build, lint đạt sau sửa cảnh báo cleanup trong test nâng cấp.
- Full TypeScript check còn **13 lỗi ở file nền không thuộc diff Order**; không ghi all-green. Chi tiết tại tài liệu verification.
- Migration chỉ áp dụng ở `bckl_order_command_20261009_a`; checksum SQL khớp migration đã áp dụng. Không sửa migration đã dùng chung; không chạy thao tác DB demo trong đợt tiếp tục.
- DB cho phép toàn bộ audit mới null để tương thích legacy/writer #36 hiện tại. Service mới phải luôn ghi audit; DB chưa phân biệt bản ghi legacy và writer mới bỏ sót audit. Đây là giới hạn chuyển tiếp có chủ đích, không phải backfill hoàn chỉnh.
- History actor FK đổi SET NULL sang RESTRICT để xóa tài khoản không làm mất định danh lịch sử; reviewer cần chú ý thay đổi này. Không suy actorType từ User.role khi đọc.
- T1 vẫn chờ #36/#37 merge: cả hai OPEN, CI xanh nhưng chưa có review decision khi kiểm tra lại. Không stack/cherry-pick hai nhánh đó vào PR này. Sau tích hợp, cập nhật writer Checkout ghi actorType BUYER rồi triển khai detail theo quyết định legacy đã review.

## 9. Chuẩn bị policy/request độc lập trong lúc chờ review — 09/10

**PREPARATORY CODE, không phải API đã chạy.** Không thêm controller/module runtime, không thay schema/migration, không cherry-pick #36/#37. Trạng thái hiện kiểm tra: #36 có approval của Đạt; #37/#38 chưa có review. Approval Search không thay review nghiệp vụ của Hiền.

Nguồn là contract đã merge mục 2.1, 6, 7.1 và 7.2, không đặt thêm quyền hoặc chuyển trạng thái mới:

| Người thao tác | Lệnh mới | Trạng thái nguồn | Kết quả |
|---|---|---|---|
| Seller | confirm | PENDING_CONFIRMATION | CONFIRMED |
| Seller | start-packing | CONFIRMED | PACKING |
| Seller | ready-to-ship | PACKING | READY_TO_SHIP |
| Buyer | cancel | PENDING_CONFIRMATION | CANCELLED |
| Seller | cancel | PENDING_CONFIRMATION hoặc CONFIRMED | CANCELLED |

### Lần theo code và biến

- `BE/src/order/order-command-request.ts`: `prepareOrderCommand` kiểm tra dữ liệu và tạo bản chuẩn hóa không thể sửa. `actorId`/`actorType` phải do service lấy từ JWT đã kiểm chứng, không phải từ body; helper không chứng minh JWT/ownership. `orderId` là mã đơn PostgreSQL, khác `productId` và `variantId`.
- `idempotencyKey`: mã client giữ nguyên khi gửi lại một thao tác; không phải mật khẩu hay quyền truy cập. ASCII `[A-Za-z0-9_-]`, 16–128 ký tự; không trim/đổi case. `actorScope=USER:<id>` là phạm vi tra key và unique trong database.
- `body`: confirm/start-packing/ready-to-ship chỉ `{}`; cancel chỉ reasonCode/reasonText theo allowlist của actor. reasonText trim, 1–500 ký tự; không nhận actor, status hoặc restockable trong lệnh cancel này.
- `requestHash`: SHA-256 của UTF-8 JSON v1, thứ tự key đệ quy: `{actorScope,body,command,orderId}`; body cancel `{reasonCode,reasonText}`. Không có khoảng trắng ngoài chuỗi; giữ case nội dung. Key không nằm trong hash vì nó định danh lần thao tác, không phải nội dung. Đổi actor scope/order/command/reason phải đổi hash; đổi thứ tự field hoặc khoảng trắng trim không đổi hash. `hashVersion=1` chỉ gắn cho request mới; không backfill receipt cũ. Chưa có receipt runtime dùng format này.
- `BE/src/order/order-command-policy.ts`: `nextOrderCommandStatus` chỉ tính trạng thái đích của **lệnh mới**, không ghi Order, Payment, stock, history hay SearchOutbox. Đạt trạng thái đích không phải bằng chứng replay. Buyer bị chặn khỏi ba lệnh Seller; không có đường Seller mark-delivered/complete.

### Thứ tự bắt buộc khi nối runtime sau review

1. Guard xác thực tài khoản active/role; service lọc ownership và chuẩn hóa request. Không coi actor caller truyền vào helper là bằng chứng quyền.
2. Trong transaction, tra receipt scope/key và kiểm tra identity/actorType đã lưu. Receipt hỗ trợ + hash đúng → trả snapshot gốc sau kiểm tra quyền; hash khác → conflict. Không chạy policy trạng thái mới trước khi phân loại replay, vì Order có thể đã đi xa hơn kết quả gốc.
3. Chỉ lệnh mới mới claim receipt, khóa/đọc Order canonical và dùng policy. Kiểm tra Payment và invariant dữ liệu; không tự tạo Payment thiếu. Việc Store suspended còn được phép thực hiện lệnh nào phải chốt riêng với reviewer, không suy từ quyền đọc đơn cũ.
4. Ghi Order/audit/history/Payment và receipt cùng transaction. Với cancel, restore từng item và một version/outbox mỗi Product cùng giao dịch; rollback tất cả nếu một bước lỗi.
5. Unique DB + Serializable + retry hữu hạn bảo vệ cạnh tranh giữa nhiều process; helper/hash **không tự bảo vệ concurrency**. Sau commit mới trả response.

107 unit test mới kiểm tra ma trận trạng thái, payload/ID/key/lý do, hash Unicode và tính bất biến. Bằng chứng tại thời điểm mục 9 viết chưa chứng minh receipt replay HTTP, cancellation restore, lost response, concurrency hay rollback; cập nhật runtime C3 nằm tại mục 10. G-FULFILMENT chưa DONE.

## 10. C3 triển khai độc lập sau merge #38 — 10/10

Nền `develop 27e083b`; #42 detail/#43 Seller preparation đã được Hiền approve,
chưa merge ở lần kiểm tra. C3 không cherry-pick code feature chưa merge. Không
thêm/sửa migration: dùng OrderCommand/audit #38 và StockMovement/Outbox đã có.

Đọc [contract C3](../api/order-cancellation-contract.md), [bằng chứng test](../testing/order-cancellation-api-verification.md)
và mục 7.5.9 kiến trúc để lần theo Controller → Service → policy/request →
ledger/stock/version/outbox → history/receipt. Các số liệu NOT_RUN ở mục 6/9
là lịch sử; không thay bằng chứng mới hay nâng toàn bộ C1–C4 thành DONE.

Hiền review Buyer/Seller state, Store/legacy/payment scope, timeline một event.
Đạt review hoàn kho → một Product version/outbox, canonical UPSERT/DELETE.
CHK-S04 xuyên dịch vụ và confirm-vs-cancel HTTP cần test tích hợp sau merge #43;
writer SQL trong E2E C3 chỉ chứng minh canonical re-read/khóa, không là API confirm.
## 11. Cập nhật sau merge #38 và runtime chuẩn bị đơn C2 — bằng chứng lịch sử 10/10

Các mục 1–9 giữ bằng chứng và quyết định tại thời điểm chuẩn bị nền. #38 đã
merge tại develop **27e083b**, có writer Checkout history BUYER và audit nền;
không còn chờ migration đó để làm API detail/command. Detail #42 đang review
riêng. Không backfill dữ liệu demo hoặc sửa migration đã merge.

`codex/seller-order-commands` triển khai ba command confirm/start-packing/
ready-to-ship, dùng helper v1 + receipt strict + Order/history cùng transaction.
Hoàng chốt Seller active được xử lý đơn cũ trong Store SUSPENDED, không mở bán
mới; ghi trong [contract C2](../api/seller-order-command-contract.md) để Hiền review.

ActorScope/key được khóa bằng User row trong PostgreSQL trước Store/Order/
Payment, bảo vệ cùng key ở nhiều Order và nhiều process. Replay kiểm quyền
hiện hành rồi trả resultSnapshot gốc trước kiểm state/Payment; key mới ở state
đích không bị nhận nhầm là replay. Lỗi history/receipt hoàn tác tất cả, không
persist PROCESSING ngoài transaction. Giới hạn retry/wait/quota có tài liệu.

[Verification C2](../testing/seller-order-command-api-verification.md): **411
unit/385 E2E PASS** trên branch từ develop27e083b, trong đó 34 unit/54 E2E mới.
Gồm HTTP Checkout COD → ba command, restart/replay, hai app cạnh tranh key,
khóa DB thực và lỗi SQL ở history/receipt; không lấy kết quả test #42 chưa merge
cộng vào branch C2. C2 chưa merge/nghiệm thu Web; hủy/hoàn kho, delivery,
notification và UI còn NOT_RUN, G-FULFILMENT chưa DONE.

## 12. Tích hợp sau merge #43 — 14/10

#43 đã merge tại 515f68a. Test confirm-vs-cancel mới phải dùng HTTP thật trên
hai ứng dụng/pool PostgreSQL độc lập, không dùng writer SQL mô phỏng confirm.
Xác nhận thắng thì Buyer cancel bị chặn, không hoàn kho/version/outbox; hủy
thắng thì confirm bị chặn, mỗi item hoàn đúng một lần, một version/event mỗi
Product. Đọc detail/audit và replay receipt của bên thắng phải nhất quán. Test
packing-vs-Seller-cancel phải tuân thủ trạng thái nguồn đã chốt. UI, delivery và
G-FULFILMENT chưa nghiệm thu; bằng chứng cũ các mục 10/11 giữ thời điểm riêng.
