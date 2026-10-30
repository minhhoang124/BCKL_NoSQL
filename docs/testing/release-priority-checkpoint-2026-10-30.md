# Checkpoint ổn định bản bảo vệ — 30/10/2026

## Bản tích hợp và cách đọc

PR135 đã merge tại `edab510`; PR136 đã merge tại
`ce4e48f802b180cdc121d49b8a76c2c33459df3c`. CI **sau merge PR136:6/6 success**,
workflow40920105806. Lượt kiểm hôm nay bắt đầu từ đúng cây source develop này.
Nhánh làm việc `test/hoang/release-priority-20261030`; chỉ bổ sung hồi quy và
tài liệu, không sửa production source, schema hoặc migration.

Hạn nộp owner xác nhận: **08/11**; mục tiêu khóa code05/11. Không suy ra ngày
bảo vệ chính thức. Owner cho phép Codex và Antigravity review chéo thay review
thành viên trong đợt này; không giả phê duyệt của người khác.

PASS local nghĩa đạt đúng phần đã thực thi, không nghĩa cả gate sẵn sàng public.
PARTIAL nghĩa còn điều kiện chưa chạy hoặc chưa đạt; BLOCKED ghi đầu vào thiếu.
Bằng chứng29/10 giữ SHA và giới hạn gốc, không đổi ngày thành lượt chạy30/10.

## Kết quả mới ngày30/10

|Phạm vi|Kết quả và giới hạn|
|---|---|
|CI develop|6/6 success trên ce4e48f; khác với CI head PR trước merge|
|Khởi động|Docker hiện có,39 tên migrations khớp; Web5173/API3001/AI8000. Không reset DB|
|HTTP/PostgreSQL|146/146 PASS,0SKIP/0TODO trong bộ focused; Checkout create42,read41,Auth33,hậu mãi27,variant race3. Đây không phải full E2E|
|Chrome xuyên hệ thống|4 tổ hợp desktop/mobile–sáng/tối PASS; thêm1 nhóm COD→refund-only→Dashboard PASS. Giao vận qua Admin simulation HTTP; không gọi là Admin UI hoặc tiền thật|
|Demo đang chạy|Login→hybrid thật24 hit→ProductDetail→route `/account/orders` với API200 PASS; không tạo đơn mới. COD/replay DemoOrder2 giữ bằng chứng29/10 riêng|
|Model/index|Health CLIP image/text,FAISS,ES và semantic/image/hybrid READY;FAISS86 vector. Chỉ một worker|
|Backup mới|Snapshot PG nhất quán→dump→restore DB đích mới:68 bảng khớp count/fingerprint,39 migration,90 ảnh khớp SHA256; app-role không CREATE. Không ghi đè nguồn|
|Baseline đọc nhẹ|40 request,concurrency4,warmup4,GET `/products?limit=12`:0error,p95≈48.94ms. Loopback Windows; không stress test/SRS SLO, không đo CPU/RAM, không suy khả năng chịu tải production|

Không cộng145 ca trước bổ sung với146 ca sau thành291. Browser có fixture
catalog/cart tổng hợp; không nhận là một luồng Seller→Search→COD không ngắt quãng.
Refund mô phỏng; không trừ hoặc hoàn tiền ngân hàng.

## Review chéo và giả thuyết đối kháng

Argon `gemini-4-argon-medium`,effortMedium đọc snapshot Checkout/Aftersales
kèm SHA256, trả **NO_CONFIRMED_FINDINGS** cho P1/P2 trong phạm vi source được gửi.
Chỉ gửi source chọn lọc; không gửi profile,credential,dump hoặc dữ liệu người dùng.
Đây là static review, model không tự chạy146 ca.

Codex kiểm lại ba giả thuyết:

1. Trùng `variantId` trong cùng request: normalizer có Set và từ chối400 trước
   purchase. Bổ sung HTTP/PG kiểm toàn bộ state không đổi, cùng key sau đó đặt
   hợp lệ được, replay không ghi thêm Order/kho. Đây là bổ sung bằng chứng,
   không phải sửa một lỗi production vừa phát hiện.
2. Reconcile đóng command trước request muộn: thiết kế chủ đích, khóa actor và
   kiểm ownership trước ghi CLOSED; hash do client mang theo để đối chiếu
   intent. Bộ hậu mãi đã chạy ca close-before-create và create/close concurrently.
   Không đổi reconcile thành tự POST lại hoặc chỉ cho internal caller.
3. Refund nhiều dòng/phí/discount: `orderFinancials` bắt discount=0,kiểm
   sum(lineTotal)=subtotal,total=subtotal+shipping,payment=total; refund theo
   từng line, không hoàn shipping. Unique refund/OrderItem và khóa Order chặn
   vượt ngân sách; suite đã có phí20000 và snapshot discount sai bị chặn.
   Chưa nhận hỗ trợ khuyến mãi hoặc prorate discount.

Codex phát hiện smoke riêng dùng nhầm `/orders` của Web (catch-all), dù ba
bước login/Search/Product hợp lệ. Hủy phần kết luận route đơn của lượt đó,
sửa `/account/orders` và đòi GET `/orders` API200; lượt mới PASS. Giữ báo cáo
cũ kèm ghi chú invalidation, không dùng assertion “không ở login” làm nghiệm thu.

## Trạng thái tám gate hiện hành

|Gate|Trạng thái|Đã có bằng chứng|Phần còn mở|
|---|---|---|---|
|ACCOUNT|PARTIAL/BLOCKED provider|Auth HTTP/PG,login thật,profile/email/Google giả lập và Google login thật trước đó|Email ra ngoài;Google LINK thật;HTTPS/cookie/proxy|
|SELLER|PASS local,PARTIAL staging|Onboarding9 nhóm Chrome29/10;quyền/khóa/sửa–nộp lại cùng Store|Kiểm actor/origin lại trên staging|
|LISTING|PASS local,PARTIAL phạm vi|2 nhóm4 SKU,typed attributes,Admin duyệt,Buyer đúng SKU;race409;private-media suites CI|Editor sửa SKU đã tạo chưa có;media staging và biến thể còn thiếu|
|DISCOVERY|PASS local,PARTIAL vận hành|86 model/index thật;hide/hydrate/outbox2event/replay/restart29/10;smoke30/10|Portability ảnh/historical queue;workload và metric package cuối|
|CHECKOUT|PASS COD local,PARTIAL provider|Giá server,ownership,last-item race,replay/rollback;ChromeCOD;VNPay6/6 SIT+NCB/IPN thật29/10|QC VNPay thủ công/callback staging;MoMo chưa adapter/nghiệm thu|
|FULFILMENT|PARTIAL|Chrome Seller chuẩn bị/Buyer command,recovery/ledger;Admin simulation HTTP;focused/CI|Admin UI giao mô phỏng và các nhánh browser còn thiếu;logistics thật ngoài phạm vi|
|AFTERSALE|PASS local,PARTIAL triển khai|Refund-only;return/restock/dispute;Review/Chat vàOrder context;replay/race/ownership|Staging,realtime nhiều instance;refund ngoài hệ thống vẫn mô phỏng|
|OPERATE|PARTIAL/BLOCKED online|CI39migrations,backup→restore local,baseline đọc nhẹ|HTTPS,proxy,offsite/restoreAzure,rollback executable,SRS workload,gói Word/demo cuối|

Không trích bảng NOT_RUN baseline29/10 làm trạng thái hiện tại. Các ca trong
ma trận gốc có nhiều điều kiện: bằng chứng một phần không làm toàn ca PASS.

## Provider và quyết định phạm vi cần chốt

|Provider|Trạng thái hiện tại|Bước tiếp theo|
|---|---|---|
|VNPay|SIT6/6 và NCB→IPN→PAID/SUCCEEDED thật trên sandbox; tunnel cũ đã tắt|Giữ bằng chứng; QC thủ công,log/whitelist và callback HTTPS mới khi có staging|
|Email|Adapter/queue/local Mailpit có; chưa có key/sender cho delivery ngoài|Cấu hình riêng ngoài Git; gửi tới recipient đã được owner chỉ định sau khi provider sẵn sàng|
|Google|Login thật đã xác nhận;JSON riêng ngoài Git|Kiểm LINK/collision với tài khoản thật và callback HTTPS sau khi chốt origin|
|MoMo|P1 vẫn cam kết; thiếu credential; không tìm thấy adapter trong BE/src/payment|Chưa được gọi hoàn thành hoặc âm thầm bỏ phạm vi; cần credential sandbox và task triển khai riêng|

Không gửi thư mới, mở tunnel, tạo tài nguyên Azure hoặc chấp nhận điều khoản
giao dịch mới trong lượt này. Các hành động đó cần đúng đầu vào và phạm vi
đã cho phép; không thay bằng dữ liệu giả để nhận LIVE PASS.

## Bằng chứng local và hạn chế

Thư mục riêng ngoài Git: `machine-local/priority-20261030/`.

- `money-1793319470065`:145 PASS trước bổ sung.
- `money-1793319840603`:146 PASS sau bổ sung HTTP trùng SKU.
- `checkout-browser-1793319715593`:4 nhóm viewport/theme và1 nhóm hậu mãi/dashboard.
- `demo-smoke-1793319964217320700`:smoke cuối dùng đúng route; lượt1793319827042113400 không được dùng cho route đơn.
- `review-money-1793319434308`:snapshot/hash và phản hồi Argon Medium.
- `restore-1793319912877`:dump riêng,manifest68bảng/90ảnh,report.
- `runtime-1793320041381`:health,raw latency và counters không đổi.

Logs fault injection có ERROR có chủ đích; không suy chỉ từ chữ ERROR rằng
test fail. Cảnh báo pg query concurrency/Vite deprecated được giữ, chưa tự
nâng dependency hoặc sửa test ngoài phạm vi. Không chứng nhận ASVS/pentest,
không nhận không còn lỗi hoặc production-ready.
