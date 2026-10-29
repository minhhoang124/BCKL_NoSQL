# Kiểm quyền, Search thật và khôi phục dữ liệu — 29/10/2026

Ứng dụng được kiểm tại commit `7948e239467ee9b408ebd55ae2417407081606bb`,
trên database QA riêng, không sửa dữ liệu demo nguồn. PR135 vẫn là Draft,
chưa tích hợp vào develop. Báo cáo này bổ sung bằng chứng, không đóng toàn bộ tám gate.

## Quyền qua giao diện

Driver `scripts/test-order-read-browser.mjs` chạy Chrome thật: **6 nhóm PASS**.
Bao gồm bốn tổ hợp desktop/mobile và sáng/tối, lỗi mạng/chuyển tài khoản,
và kiểm quyền trên route thật. Buyer xem đơn người khác nhận404;
Seller khác Store nhận404; Seller sở hữu nhận200. Không thay AuthContext
hoặc mock nghiệp vụ. Đọc đơn không thay Order/history/kho/outbox.

Artifact local: `machine-local/integration-20261029/ownership-browser-1793271695137/`.
SHA256 driver lúc chạy: `de6df6f7e62b81ec2f7f66f4cac3658047b85c715946365f8c9d07f4d60168b4`.
Hai lỗi harness trước lần PASS được giữ riêng; không tính là lỗi sản phẩm
hoặc xóa khỏi lịch sử. Kết quả này không thay kiểm toàn bộ quyền ghi/Admin.

## Backup và phục hồi

Tạo pg_dump custom từ snapshot nhất quán của DB demo nguồn, phục hồi sang
DB mới `bckl_order_resolution_test_search_live_20261029`. Trước migration,
**67 bảng khớp số dòng và fingerprint nội dung**. Sau đó áp dụng đủ39 migrations.
Đã copy và đối chiếu hash **90 file upload, 3 artifact AI**; dump/hash/report
giữ ngoài Git. Không đưa backup chứa danh tính thật lên staging.

Đây là diễn tập restore local; chưa chứng minh backup ngoài máy, lịch tự động,
RPO/RTO hoặc phục hồi cả máy chủ Azure.

## Search với model và index thật

Tạo index ES/FAISS mới, bật CLIP image/text từ model cache thật, một AI worker.
Rebuild **86/86 Product công khai**, không thiếu ảnh hoặc lỗi index. Keyword,
semantic, backend hybrid và image có kết quả; PG hydrate khớp Product ID.
Chrome desktop/mobile đều PASS tìm chữ và upload ảnh, không lỗi trang.
Đây là kiểm chức năng bằng ảnh catalog, không phải benchmark chất lượng
retrieval trên tập ảnh độc lập.

Sau khi restart riêng tiến trình AI, index vẫn có86 vector và smoke keyword,
semantic, hybrid, image đều PASS. Chỉ xác minh restart một process; chưa kiểm
replay event cũ sau restart hoặc phục hồi nhiều replica.

Với Product58 trong DB clone: ACTIVE v4 → HIDDEN v5 → ACTIVE v6.
Khi AI còn hit cũ, backend đã lọc sản phẩm ẩn. Hai outbox mới DELETE/UPSERT
được dispatch bằng SearchSyncWorker thật, đều SUCCEEDED; gửi lại cùng payload
trả NOOP. Order, stock movement, giá và tồn kho không đổi.

Một URL ảnh import tương đối được chuẩn hóa trong DB clone khi Product đang
ẩn, trước khi phát sinh version/event mới. Không sửa payload bất biến hoặc
event cũ. Vì vậy chưa kết luận toàn bộ hàng đợi lịch sử đã drain; cron tắt,
chỉ dispatch chính xác hai event mới. Cần xử lý portability catalog đầy đủ
trước khi bật worker cho dữ liệu import trên staging.

Artifact local: `machine-local/search-live-20261029/`: backup-restore-report,
rebuild-report, search-smoke-report, search-browser-report, lifecycle-report
và bốn ảnh Chrome. Không commit runtime secret, dump, ảnh hoặc model.

## Phần còn mở

- HTTPS staging: người dùng xác nhận chưa có tên miền; chưa tạo tài nguyên Azure.
- Auth cookie/OAuth qua HTTPS và chính sách IP sau reverse proxy chưa nghiệm thu.
- Email thật, Google LINK và MoMo còn thiếu cấu hình/nghiệm thu tương ứng.
- VNPay đã có6/6 SIT và một NCB sandbox→IPN→PAID; QC thủ công vẫn mở.
- Còn quyền ghi/Admin, listing xuyên luồng, tải, rollback và bộ demo/báo cáo cuối.

Tham chiếu [ma trận nghiệm thu](release-acceptance-matrix-2026-10-29.md)
và [điều kiện staging](../deployment/staging-readiness-2026-10-29.md).
