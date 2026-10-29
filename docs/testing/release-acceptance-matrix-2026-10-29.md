# Ma trận tám luồng nghiệm thu — bản tích hợp 29/10/2026

**Nhánh tiếp theo sau PR135:** đã có browser multi-SKU/typed attributes và
Chat chia sẻ Order, kèm hai sửa lỗi API có tái hiện. [Checkpoint](listing-chat-release-2026-10-29.md).
Không lấy số liệu của branch mới thay CI/release đã merge nếu chưa tích hợp.

**Bổ sung quyền ghi29/10:** Store9, Review12, Chat4, hậu mãi9 và listing/quyền
ghi4 nhóm Chrome PASS; focused HTTP/PG146 PASS. [Chi tiết và giới hạn](release-write-journeys-2026-10-29.md).
Các trạng thái NOT_RUN trong bảng ca bên dưới là baseline ban đầu, cần đọc
cùng các checkpoint bổ sung; không được trích riêng làm trạng thái hiện tại.

**Bổ sung nghiệm thu29/10:** UI đọc đơn/ownership6 nhóm PASS; Search thật
86 Product và Chrome desktop/mobile PASS; restore67 bảng,90 upload,3 artifact
khớp; ẩn/hydrate/outbox/replay PASS trên QA riêng. AI restart giữ86 vector và
smoke PASS. Đây là bằng chứng bổ sung cho DISCOVERY/OPERATE/quyền đọc,
không đóng các ca quyền ghi, provider hoặc HTTPS trong bảng baseline dưới đây.
[Phạm vi và giới hạn](release-ownership-search-recovery-2026-10-29.md).

**Cập nhật provider29/10:** RC-CHK-04/06 đã có bằng chứng6/6 SIT và một NCB
sandbox thành công→IPN→PAID/SUCCEEDED→Web; QC thủ công, whitelist/log và toàn
bộ các biến thể late/cancel còn mở. Trạng thái ban đầu trong bảng không phải
khẳng định hiện vẫn thiếu toàn bộ IPN. [Bằng chứng](vnpay-sit-live-2026-10-29.md).

## Phạm vi và cách đọc

Hạn nộp: **08/11/2026**, Hoàng xác nhận. Mục tiêu khóa code 05/11.
Candidate local `test/hoang/release-integration-20261029`, merge checkpoint
`2157eee07c8b96be7f9b8a35a81e47f5fb14161e`: develop `a88a11d` + PR133
`fbaf636` + PR134 `f60c741`. Đây là bản ghép để QA, **chưa merge PR vào develop**.
Migration:39; DB QA loopback5549, tên hardening_20261029. Không dùng DB demo.

Chỉ số tự động và nghiệm thu người dùng là hai cột riêng. Một suite PASS không
tự khiến gate PASS. API provider giả lập không thay callback thật. Bằng chứng
nhánh/ngày cũ chỉ tham khảo, không tự kế thừa vào candidate.

- PASS: đã thực thi đúng ca trên candidate, có kết quả và bằng chứng phù hợp.
- FAIL: đã thực thi, kết quả không đạt; phân biệt lỗi code với lỗi môi trường.
- BLOCKED: có điều kiện cụ thể chưa đáp ứng.
- NOT_RUN: chưa chạy ca nghiệm thu trên candidate.

Mã `RC-*` dưới đây là ID ca nghiệm thu nội bộ, không giả là ID SRS có sẵn.
Nguồn yêu cầu: implementation-scope mục6; SRS cần đối chiếu phiên bản cuối.

## Tổng quan tám gate

|Gate|Acceptance trên candidate|Bằng chứng tự động liên quan|Điều kiện để chốt|
|---|---|---|---|
|G-ACCOUNT|BLOCKED một phần provider|auth/session/account/address/email/google/phone suites|HTTPS, email thật, Google LINK và kiểm cờ/actor|
|G-SELLER|9 nhóm browser PASS local|store-application-runtime, seller-buyer-access|Chạy lại origin/actor trên staging|
|G-LISTING|Listing mặc định và quyền ghi PASS; chưa đầy đủ|product lifecycle/schema, image ownership, attributes|Ảnh private, đa SKU/thuộc tính và các biến thể còn thiếu|
|G-DISCOVERY|86 Product/model thật, Web và sync local PASS|search-hydrate, image-search-gateway, search-analytics|Historical queue/import portability, workload và chất lượng tập độc lập|
|G-CHECKOUT|NOT_RUN browser; BLOCKED provider|cart/checkout/VNPay synthetic suites|COD và cạnh tranh/replay; mỗi sandbox có callback thật|
|G-FULFILMENT|NOT_RUN browser|seller command, delivery/cancellation/completion/returned|Đúng actor và ledger/kho; mất phản hồi không ghi hai lần|
|G-AFTERSALE|Hậu mãi9/Chat4/Review12 nhóm browser PASS local|aftersales/chat/review suites|Order context, triển khai và các giới hạn trong report; hoàn tiền ngoài vẫn mô phỏng|
|G-OPERATE|BLOCKED nghiệm thu online|dashboard/notifications/health/migration suites|HTTPS, backup→restore, rollback, tải, số liệu Search và gói nộp|

Kết quả cuối, số ca theo suite và artifact phải lấy từ báo cáo chạy thực,
không đọc bảng tổng quan này như kết luận chưa có code.

## Ca nghiệm thu và thứ tự ưu tiên

P1 trong bảng là ưu tiên chốt release vì hậu quả hoặc phụ thuộc, không phải
khẳng định đã phát hiện lỗ hổng mức High. Lỗi mới phải có tái hiện trước khi gán severity.

|ID|Gate/ưu tiên|Ca và kết quả mong đợi|Trạng thái acceptance ban đầu|Bằng chứng cần lưu|
|---|---|---|---|---|
|RC-ACC-01|ACCOUNT/P1|Register→login→refresh→logout; refresh cũ không dùng lại|NOT_RUN HTTPS|Chrome/network an toàn, session DB, cookie flags|
|RC-ACC-02|ACCOUNT/P1|Form từ site khác bị403; password>72byte từ chối; quota không né bằng proxy header|NOT_RUN browser candidate|Chrome trước/sau + Auth HTTP/PG; không lộ token|
|RC-ACC-03|ACCOUNT/P1|Đổi/reset password thu hồi phiên; tài khoản khóa/CV đổi bị chặn|NOT_RUN browser|UI + session/version DB, replay token một lần|
|RC-ACC-04|ACCOUNT/P1|Email verify/reset tới recipient đã cho phép, token hết hạn/replay bị từ chối|BLOCKED provider/sender|Thư nhận thật đã che dữ liệu; token/queue evidence an toàn|
|RC-ACC-05|ACCOUNT/P1|Google login mới/collision/LINK có consent, không ghép nhầm account|BLOCKED cấu hình staging|Trình duyệt + User/Identity/session DB|
|RC-ACC-06|ACCOUNT/P2|Profile/address lưu sau reload; OTP sandbox xác nhận ranh giới mô phỏng|NOT_RUN browser|Ảnh, network, snapshot địa chỉ|
|RC-SEL-01|SELLER/P1|User mua hàng rồi gửi hồ sơ Store; Admin duyệt; trở lại mua bình thường|NOT_RUN|Một actor xuyên luồng; membership/Store/history|
|RC-SEL-02|SELLER/P1|Từ chối→sửa→nộp lại cùng Store; suspended không tự mở lại|NOT_RUN|Hai actor Web + history; không tạo Store thứ hai|
|RC-SEL-03|SELLER/P1|Seller khác/Buyer không quản trị Store; locked owner không ghi mới|NOT_RUN browser|HTTP denial + không có business mutation|
|RC-LST-01|LISTING/P1|Seller tạo thuộc tính/options/SKU/giá/kho/kiện hàng/ảnh; gửi duyệt|NOT_RUN|Web thật + Product/Variant/shipping DB|
|RC-LST-02|LISTING/P1|Admin duyệt; public chỉ hiện đúng Product hợp lệ, biến thể hết hàng rõ ràng|NOT_RUN|Seller/Admin/Buyer + public payload|
|RC-LST-03|LISTING/P1|Không xem ảnh private/draft bằng URL trực tiếp hoặc Store khác|NOT_RUN|HTTP/media rights + file ownership; ảnh công khai vẫn hoạt động|
|RC-LST-04|LISTING/P2|Sửa đồng thời/option bị vô hiệu/mất phản hồi không ghi trùng hoặc mất audit|NOT_RUN browser|Hai phiên, revision/receipt/audit|
|RC-DIS-01|DISCOVERY/P1|86 demo Product khớp ID–ảnh–ES–FAISS; tìm keyword/text/image ra sản phẩm đúng|NOT_RUN AI thật|Manifest/hash, runtime model/index, browser/network|
|RC-DIS-02|DISCOVERY/P1|Ẩn Product/Store/owner; PG hydrate không lộ dù index cũ còn hit|NOT_RUN browser|PG public state + kết quả Search; không chỉ mock AI|
|RC-DIS-03|DISCOVERY/P1|Ngắt worker→ghi→restart/replay; index hội tụ, không nhân đôi|NOT_RUN|Outbox version/attempt + ES/FAISS state|
|RC-DIS-04|DISCOVERY/P2|Impression/click theo cohort hiển thị; Seller chỉ thấy Store mình; dedupe/bot|NOT_RUN browser candidate|Rendered cohort + aggregate DB; AI giả lập phải ghi nhãn|
|RC-CHK-01|CHECKOUT/P1|Chọn variant/address, nhiều Store, giá server; snapshot và kho đúng một lần|NOT_RUN browser|Web + Checkout/Order/StockMovement|
|RC-CHK-02|CHECKOUT/P1|Hai buyer mua món cuối; tối đa một giao dịch hợp lệ, không âm kho|NOT_RUN release acceptance|Concurrent HTTP/DB + số receipt/stock movement|
|RC-CHK-03|CHECKOUT/P1|Mất response/reload/bấm hai lần: giữ intent/key, không đặt hai đơn|NOT_RUN browser|Browser fault + receipt/order count|
|RC-CHK-04|CHECKOUT/P1|VNPay success/cancel/failure/duplicate/late IPN thật; return không tự set PAID|BLOCKED VNPay IPN|Provider transaction + Payment/attempt/ledger/kho|
|RC-CHK-05|CHECKOUT/P1|MoMo sandbox có adapter/config và callback thật; không nhận số tiền client|BLOCKED runtime/credential|Provider callback + signature/amount checks + DB|
|RC-CHK-06|CHECKOUT/P1|Chữ ký/số tiền/ref sai; callback chạy đua với hủy không trả PAID sai|NOT_RUN provider thật|Synthetic QA và provider acceptance tách riêng|
|RC-FUL-01|FULFILMENT/P1|Seller chuẩn bị/bàn giao; Admin/adapter mô phỏng giao; Buyer hoàn tất|NOT_RUN browser|Một Order Web xuyên luồng, history/Payment COD|
|RC-FUL-02|FULFILMENT/P1|Hủy/giao thất bại/nhận hoàn; kho hoàn đúng một lần, không sửa snapshot|NOT_RUN browser|Order/history/StockMovement, replay|
|RC-FUL-03|FULFILMENT/P1|Mất response sau commit, đối chiếu original intent; GET lỗi không tự POST lại|NOT_RUN browser|Receipt/fence/journal/network; quota chung|
|RC-FUL-04|FULFILMENT/P2|In-app notification đúng recipient/unread, không lộ Store/Order khác|NOT_RUN browser|Hai actor + event/recipient dedupe|
|RC-AFT-01|AFTERSALE/P1|Refund-only không tăng kho; return-and-refund chỉ restock đúng điều kiện|NOT_RUN browser|Web + refund/adjustment/stock ledger một lần|
|RC-AFT-02|AFTERSALE/P1|Hai quyết định/replay/race không refund quá snapshot hoặc ghi hai lần|NOT_RUN release acceptance|Concurrent requests + DB constraints/ledger|
|RC-AFT-03|AFTERSALE/P1|Chat đúng người; history/realtime/read; thẻ Product/Order không lộ chéo|NOT_RUN browser|Hai browser/session và persisted messages/read state|
|RC-AFT-04|AFTERSALE/P2|Buyer review đúng OrderItem; Seller phản hồi, Admin ẩn có audit|NOT_RUN browser|Web + Review/OrderItem + moderation audit|
|RC-OPS-01|OPERATE/P1|Dashboard đúng gross/refund/net, đúng kỳ; lỗi503 xóa số cũ|NOT_RUN browser|Response kỳ đã chọn + DB + screenshot|
|RC-OPS-02|OPERATE/P1|Fresh checkout/config/migrations/seed demo có thể chạy lại|NOT_RUN full setup|Runbook + version/lock/hash; không dùng secret Git|
|RC-OPS-03|OPERATE/P1|Backup DB+ảnh/mapping; restore sang đích khác; kiểm dữ liệu và chạy smoke|NOT_RUN|Manifest/hash + restore log + query/smoke; không ghi đè nguồn|
|RC-OPS-04|OPERATE/P1|HTTPS/cookie/proxy đúng; DB/ES/AI index private; DB lỗi không bỏ Auth guard|BLOCKED staging|Network boundary + browser + readiness/log redaction|
|RC-OPS-05|OPERATE/P1|Rollback release có kiểm soát, additive migration không mất dữ liệu|NOT_RUN|Diễn tập trên QA clone; phiên bản và tương thích schema|
|RC-OPS-06|OPERATE/P2|Workload SRS, p50/p95/error/CPU/RAM có cấu hình cold/warm rõ|NOT_RUN|Raw measurements, script/config, không suy từ unit tests|
|RC-OPS-07|OPERATE/P1|7 query/86 Product/602 cặp: metric/provenance tái lập; ảnh kiểm riêng|NOT_RUN xác minh gói cuối|Raw rankings/labels/hash, P/R@5/10/20; giới hạn AI-assisted|
|RC-OPS-08|OPERATE/P1|Gói nộp/Word/demo cùng release, actor/flags cố định, local/video dự phòng|NOT_RUN|Tag/SHA + checklist Hiền/Hoàng + runbook|

## Phân loại TODO và SKIP

20 `it.todo` ở `BE/test/order-command-resolution.e2e-spec.ts` là checklist lịch
sử, không phải20 chức năng chưa code. Runtime và migration suite có bằng chứng
theo Rxx; file TODO vẫn giữ nguyên, không tính vào PASS. Bảng này là ánh xạ để
đọc kết quả, không tuyên bố vét cạn hợp đồng.

|Checklist|Suite thực thi liên quan|Giới hạn phải giữ|
|---|---|---|
|R01/R02/R24|order-command-resolution-runtime: receipt gốc, close/replay, original key sau intent mới|Backend không thay browser recovery|
|R03/R04/R11|runtime: DB barrier, hai hướng thắng, stale opposing snapshot|Hai Nest app/kết nối không phải hai OS process|
|R05|runtime: khác command/Order/hash|Hash sai dựng fixture có chủ đích|
|R06/R07/R08|runtime: bootstrap lại, concurrent resolve, proxy mất response, insert fault|Chưa crash/restart host hoặc mất điện|
|R09/R10|runtime + migration: writers cùng fence, direct insert DB guard|Một số ca dùng service/SQL thật thay HTTP|
|R12/R25|runtime + migration: immutable/malformed/PROCESSING identity/null transitions|Không vét cạn mọi tổ hợp giá trị/FK|
|R13|order-resolution-migration: nâng schema và giữ history|Không phải restore DB demo hay rollback production|
|R14/R15/R16/R17|runtime: ownership/account/input/quota/timeout/retry|Không thay nghiệm thu UI và proxy production|
|R18|runtime + unit/DB exclusion: corrupt receipt fail-closed|Không tắt trigger để giả DB hỏng; không suy phủ mọi corrupt state|

Live health `admin-system-health-live.e2e-spec.ts` cần Python rõ ràng và khởi
chạy FastAPI riêng, model cố ý không tải. Nếu chạy đạt cũng chỉ chứng minh
health contract ở trạng thái NOT_READY, không phải CLIP/FAISS đã sẵn sàng.
Web6SKIP phải giữ danh sách tên từ JSON, không đổi thành PASS hoặc gộp vào20TODO.

## Backlog ưu tiên theo hậu quả

|Thứ tự|Việc|Lý do / điều kiện đóng|
|---|---|---|
|1|Ổn định môi trường QA và hoàn tất hồi quy candidate|Lượt bị ngắt hoặc PostgreSQL dừng không cho kết luận code; giữ log lỗi, chạy lại sau readiness|
|2|COD/stock/receipt/refund/browser recovery trên cùng candidate|Sai tiền/kho hoặc ghi lặp là lỗi chặn release; sửa trước UI phụ|
|3|Quyền actor/Store/account và private media|Không chấp nhận đọc/ghi chéo; cần HTTP/DB/browser theo ranh giới|
|4|Email recovery và Google LINK; IPN/MoMo đầu vào|Phụ thuộc ngoài và nguy cơ account/payment; chốt blocker trước01/11|
|5|AI thật, mapping, outbox và analytics browser|Unit/synthetic AI không thay Search end-to-end|
|6|HTTPS/proxy/backup/restore/rollback/tải|Là điều kiện online, không giải quyết bằng tăng số test|
|7|Word/ảnh/metric/runbook/tag|Bàn giao dần cho Hiền, không chờ05/11; đóng code trước06–07/11|

Chỉ tạo bug confirmed khi có expected/actual, bước tái hiện, đích QA, SHA,
ảnh/log/DB và mức độ ảnh hưởng. Các NOT_RUN/BLOCKED là việc nghiệm thu còn
thiếu, không tự gọi là lỗ hổng hoặc thiếu implementation.

## Báo cáo thực thi

Xem [checkpoint tích hợp](release-integration-checkpoint-2026-10-29.md) để lấy
kết quả cuối, artifact và phần đã đổi trạng thái. Ma trận gốc giữ điều kiện
nghiệm thu; checkpoint phải chỉ rõ bằng chứng chỉ bao phủ một phần của ca nếu có.
