# Checkpoint tích hợp và bằng chứng nghiệm thu — 29/10/2026

**Delta provider sau checkpoint tích hợp:** VNPay SIT987 đạt6/6; đã có một
NCB sandbox→IPN thật→DB PAID/SUCCEEDED→Web. Bản sửa TxnRef có40 unit/21 HTTP
riêng đạt; full E2E1201 ở bảng dưới là trước delta, không tự tính kết quả mới.
QC thủ công/whitelist/log chưa chốt. [Chi tiết](vnpay-sit-live-2026-10-29.md).

## Bản đã kiểm

Nhánh local `test/hoang/release-integration-20261029`; source tích hợp
`2157eee07c8b96be7f9b8a35a81e47f5fb14161e`, gồm PR133 head`fbaf636` và
PR134 head`f60c741` trên develop`a88a11d`. Không merge PR hoặc đổi develop/demo.
Tại commit2079c54, thay đổi sau merge chỉ gồm browser harness và tài liệu;
source ứng dụng/migration giữ đúng checkpoint đã chạy test. Delta VNPay sau
đó được tách bằng chứng ở đầu tài liệu, không kế thừa kết quả full trước sửa.

12 conflict đều thuộc allowlist QA và D07 provisioner. Giữ cả target v975 của
PR133 và hardening_20261029 của PR134; không chọn nguyên ours/theirs. Host127.0.0.1,
port5549, role, query và dotenv guards được giữ. Prisma có39 migration.

## Kết quả trên source tích hợp

|Kiểm tra|Kết quả và giới hạn|
|---|---|
|pnpm install --frozen-lockfile|PASS, không đổi lockfile|
|Backend unit|1783 PASS,0 FAIL|
|Frontend tests|1680 PASS,0 FAIL,6 live SKIP|
|Backend full E2E|1201 PASS,0 FAIL,1 live SKIP,20 TODO;70 file PASS/2 SKIP|
|Live health chạy riêng|1 PASS, FastAPI thật, model cố ý không tải; không chứng minh Search READY|
|Typecheck/lint/build BE+FE|PASS; còn warning React/ref và FE bundle614kB nền|
|Prisma migration/schema diff|39 migration, không drift trên QA riêng|
|Chrome COD journey|4/4 cấu hình desktop/mobile × sáng/tối PASS,23 PNG|
|COD→fulfilment→refund→Dashboard|Một nhóm xuyên cùng Order PASS, không dựng Order COMPLETED thay luồng mua|

Full E2E dùng schema-owner migrator không superuser/CREATEDB/CREATEROLE để các
fixture DDL chạy; không gọi toàn bộ lượt này là app-role DML. Browser dùng
`bckl_local_app` và kiểm role không superuser/CREATEDB/CREATEROLE tại runtime.
Ca Auth đã nằm trong full; không cộng số ca focused lần trước vào tổng.

Hai lượt không đạt được giữ nguyên ngoài Git:

- R1: bị ngắt trước báo cáo cuối, không có kết quả hoàn chỉnh.
- R2: PostgreSQL container đang dừng,391 FAIL/19 PASS/792 SKIP/20 TODO. Lỗi
  không kết nối được127.0.0.1:5549; không được đổi lượt này thành PASS. Sau
  khởi động đúng container hiện có, readiness đạt và schema diff0, R3 chạy
  đủ và đạt1201 PASS. Không reset/drop DB hoặc đổi logic để làm xanh test.

## Browser và cập nhật acceptance

Driver `scripts/test-checkout-browser.mjs` được bổ sung đúng target/role QA
hiện tại và kỳ vọng39 migration; native Node fixture request gửi Origin đúng
Web đã cấu hình. Không bỏ Origin guard. Query schema trùng bị từ chối.

Artifacts local:
`machine-local/integration-20261029/checkout-browser-1793267573927` trong
workspace điều phối. results.json ghi head`2157eee`, driver SHA256
`9960b30bcad20a3f621d44a1886bf42faf8df94329c7d8cd13376de573fa0a25`.
Ảnh/log/credential không commit. Đã xem ảnh checkout mobile và Dashboard.

Gemini Argon Medium review diff browser harness và D07 helper trả
NO_CONFIRMED_FINDINGS trong phạm vi source được cung cấp. Đây là review tĩnh,
không phải model tự chạy test hoặc approval của thành viên. Output giữ ngoài Git.

|Ca trong ma trận|Bằng chứng mới|Giới hạn còn lại|
|---|---|---|
|RC-CHK-01|Web Address/Cart selection/Checkout COD; snapshot, một Order, kho5→3 cho qty2, một movement/outbox|Chưa thay acceptance browser nhiều Store|
|RC-CHK-03|Sau commit cố ý mất response, reload và gửi lại cùng key/body;hai POST nhưng một Order/movement/outbox|Không thay mọi double-click trên mọi flow/provider|
|RC-FUL-01|Cùng Order từ Web mua→Seller chuẩn bị→giao mô phỏng→Buyer hoàn tất, COD PAID|Giao mô phỏng dùng Admin API thật, không phải Admin UI/vận chuyển thật|
|RC-FUL-02|Luồng mất response có hủy/hoàn kho; stock và receipt kiểm DB|Các hướng thất bại/return khác vẫn cần acceptance browser riêng|
|RC-AFT-01/02|Cùng Order trên, Buyer refund-only→Seller duyệt; double-submit/replay không tạo thêm refund/adjustment; kho không tăng|Chưa thay return-and-refund/RESTOCKABLE/dispute đầy đủ|
|RC-OPS-01|Gross20000/refund20000/net0 đúng kỳ từ HTTP+DB+Seller Dashboard Web; một refund/adjustment|Chưa nghiệm thu toàn bộ dashboard cross-period/503 trên browser candidate|
|Live health G-OPERATE|Admin HTTP đọc contract thật từ FastAPI riêng; không lộ token hoặc tạo outbox|Model NOT_READY theo chủ đích; không proof CLIP/index loaded|

Fixture catalog/cart là tổng hợp; không gọi đây là Seller tạo Product→Admin duyệt
hoặc Search→Cart đầy đủ. Ảnh minh họa Product không thay kiểm upload/private media.
Kết quả refund là mô phỏng, không có hoàn tiền thật. Không gọi tám gate đã DONE.

## TODO, SKIP và ưu tiên tiếp theo

[Ma trận39 ca/tám gate](release-acceptance-matrix-2026-10-29.md) ghi acceptance
ban đầu và yêu cầu còn thiếu. Bảng trên cập nhật phần đã có bằng chứng, không
đổi một ca nhiều điều kiện thành PASS khi mới chạy một phần.

20TODO lịch sử đã ánh xạ sang runtime/migration Rxx trong ma trận. Sáu WebSKIP
đều ở `FE/src/features/order-flow/CheckoutLive.test.jsx` (opt-in jsdom+HTTP):
đặt COD, buyer/seller IDOR, mất response, đổi giá và đổi kho. Browser hiện có
bằng chứng tương ứng cho đặtCOD/mấtresponse/giá/kho, chưa thay riêng hai ca
routed UI IDOR. Không bật bừa CHECKOUT_LIVE_QA hoặc nới target DB của suite cũ.

Chưa phát hiện bug nghiệp vụ chặn release trong lượt tích hợp này. Đây không
phải bảo đảm không còn lỗi hoặc chấm lại điểm trưởng thành sản phẩm.
Việc ưu tiên tiếp:

1. Chốt human review và đường tích hợp vào develop; CI candidate riêng nếu
   mở PR. CI133/134 không tự tính là CI của bản ghép.
2. Buyer/Seller IDOR qua routed UI, onboarding/listing/private media; Search
   thật với mapping/index và worker; Chat/review còn cần browser candidate.
3. Email thật/recovery/GoogleLINK và VNPayIPN/MoMo: nhận đầu vào provider an toàn,
   chốt blocker trước01/11. Synthetic provider test không được đổi thành LIVE PASS.
4. HTTPS/proxy, backup→restore/rollback và tải theo workload SRS; giữ hạn chế
   trong Word. Bàn giao ảnh và manifest cho Hiền theo từng đợt.

## Tái lập và artifact

Không dùng môi trường demo hoặc copy .env. Runner private ngoài Git chọn rõ
checkout integration, database hardening_20261029, role và secret QA tổng hợp.
Provisioner chỉ dành fixture D07, không đưa vào application/staging env.

Artifact local `machine-local/integration-20261029`: unit/web/full/live JSON,
typecheck/lint/build/migration/schema logs, browser HTML/JSON/PNG và
`evidence-index.json` với hash báo cáo, tên từng ca và danh sách không PASS.
Grouping suite theo gate là phân loại thành phần, không phải tỷ lệ hoàn thành.
Không chạy full E2E song song browser vì dùng chung DB QA.
