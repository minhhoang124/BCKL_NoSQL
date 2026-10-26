# Hậu mãi Web — kiểm chứng26/10/2026

Base `428700b`; phạm vi Buyer/Seller/Admin list/detail/history/write/reconcile.
Theo [luồng Web](../architecture/aftersales-web-workflow.md) và
[API](../api/aftersales-runtime.md). Không thay Backend runtime/schema.

| Kiểm tra | Kết quả |
|---|---|
| Frontend journal/adapter/component |42 PASS|
| Full Frontend cuối |79 files PASS/1 skipped;1423 PASS/6 live SKIP;144.28s|
| TypeScript/Vite build |PASS; bundle >500kB là cảnh báo, chưa tối ưu chunk trong PR này|
| Lint |0 errors;5 warnings nền Admin set-state-in-effect|
| HTTP/PostgreSQL hậu mãi app-role |27/27 PASS; gồm regression GET đơn fixture|
| Fixture guard portable |9/9 PASS|
| Chrome → Nest → PostgreSQL |9 nhóm PASS,6 screenshot desktop/mobile light|

Browser cuối: `artifacts/aftersales-web-browser-20261026/r1793007375322`,
report.json ghi hash source bất biến trong lượt chạy. Không commit ảnh/log,
thông tin đăng nhập hoặc profile private. Không chạy lại full Backend ở lượt
Web này; số full Backend của #119/#120 là bằng chứng nền riêng.

## Kịch bản thực tế và đối kháng

1. Buyer tạo REFUND_ONLY bằng hai submit cùng tick: một request. Seller duyệt,
   cố ý cắt response **sau upstream200**, reload và đồng ý đối chiếu cùng UUID/hash:
   APPLIED, không POST duyệt lần hai, một refund, tồn kho không đổi. Buyer hoàn
   tất qua HTTP thật; Dashboard Seller ghi gross100000/refund100000/net0/pending0.
2. Seller từ chối → Buyer khiếu nại → Admin duyệt RETURN_AND_REFUND. Chưa nhận
   hàng không refund. Hai Admin gửi receive song song: một refund, tồn5→7 đúng
   một lần, một RETURN_RESTORE/một SearchOutbox. Bên thua đối chiếu để đóng mã.
   Đây là cạnh tranh HTTP, không khẳng định đã đo overlap khóa PostgreSQL;
   suite Backend kiểm giao dịch/cạnh tranh riêng.
3. Receive restockable=false: vẫn một refund, tồn5 không đổi, không stock event
   hoặc SearchOutbox. Cả ba scope desktop1440/mobile390 đọc đúng lịch sử và
   biên nhận mô phỏng, không tràn ngang hoặc lỗi JavaScript.

Test component/core còn kiểm: digest chậm/input mutation, CAS/session switch,
body/hash sai, receipt sai tiền/item/revision, malformed response giữ mã,
storage hỏng, xác nhận riêng từng action, late read sau401/403, cờ ghi false
vẫn cho phục hồi, tải lại sau kết quả xác định không replay mutation.

## Lỗi đã tìm và sửa trước bàn giao

Chrome bắt được parser client yêu cầu current=null cả khi tạo lần đầu, trong
khi API trả projection ở initial create và có thể null ở replay/reconcile.
Đã sửa theo protocol hiện có, thêm regression hai hình dạng và wrong-item/id;
không dùng current thay receipt. Static review lượt đầu chưa tìm thấy lỗi này.

Argon `gemini-4-argon-medium`, effort Medium, review độc lập snapshot ban đầu
và delta parser sau sửa: **NONE P1/P2** ở delta. Snapshot delta SHA256
`0d503f4bd91663fadb42bd7822f776d79cdd5b9379faf166f994e66975f5637b`.
Đây là AI review kỹ thuật, không giả thành human GitHub approval.

Harness ban đầu cũng phát hiện fixture history typed SELLER không có receipt
và optionSnapshot={} không hợp schema đọc đơn. Chỉ sửa synthetic history về
legacy untyped có chú thích, fixture tương lai dùng []; không nới constraint,
không sửa dữ liệu giữ lại. Các lượt lỗi không tính PASS. Bổ sung regression
fixture hậu mãi đọc được qua Buyer GET /orders/:id.

## Cách dựng và giới hạn QA

Script `scripts/test-aftersales-browser.mjs` yêu cầu checkout không dotenv,
DATABASE_URL private qua môi trường: đúng loopback127.0.0.1:5549, database
`bckl_order_resolution_test_attributes_20261019_v952`, app-role
`bckl_qa_app_20261021` không superuser/CREATEDB/CREATEROLE, đủ27 migration.
SEARCH_SYNC_ENABLED, SEARCH_RECONCILIATION_ENABLED, PRODUCT_IMAGE_REPAIR_ENABLED,
ORDER_AUTO_COMPLETE_ENABLED đều false. Backend phải build trước. Cấp
`--output` là thư mục chưa tồn tại và `--playwright-module` trỏ module đã cài.
Launcher private kiểm demo dừng và binding QA trước cấp URL; không đưa URL
hoặc password lên Git. Không chạy cùng suite khác trên DB này.

Đơn delivered là snapshot synthetic, không chứng minh checkout/COD/vận chuyển.
Response abort là lỗi được chèn có kiểm soát, không phải mất mạng vật lý.
Không nhận đã QA dark mode hậu mãi. Giữ lại dữ liệu QA, không reset; container
demo dừng, không query/migrate demo. Hoàn tiền SIMULATED, chưa sandbox hoặc
chuyển tiền thật; chưa nhận toàn project hoàn thành.
