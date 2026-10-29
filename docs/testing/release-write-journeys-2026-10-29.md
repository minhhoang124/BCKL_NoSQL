# Nghiệm thu quyền ghi và nghiệp vụ — 29/10/2026

Ứng dụng tại `63274b01924959dc58519e692a79b2e8511ba5c7`, DB riêng
`bckl_order_resolution_test_hardening_20261029`,39 migrations. Các thay đổi
trong lượt này chỉ gồm driver QA và tài liệu, không đổi code nghiệp vụ.
Không truy cập DB demo nguồn hoặc gửi thư/thanh toán bên ngoài.

## Kết quả Chrome thật

|Luồng|Kết quả|Bằng chứng chính|
|---|---|---|
|Mở Store|9 nhóm PASS|Đăng ký USER; gửi hồ sơ; Admin từ chối; sửa/nộp lại cùng Store; duyệt và xoay phiên; SELLER vẫn mua hàng được; khóa chặn ghi; mở lại không cấp quyền lần hai|
|Review|12 nhóm PASS|Buyer từ OrderItem; gửi lặp và mất response sau commit không tạo trùng; sửa đánh giá; Seller phản hồi; Admin ẩn; lý do riêng không công khai; đánh giá hết hạn bị chặn|
|Chat|4 nhóm PASS|Desktop/mobile, sáng/tối; hai browser trao đổi qua Socket.IO và lịch sử PG; nội dung giống HTML là text; gửi lặp, khôi phục và thẻ Product bị ẩn|
|Hậu mãi|9 nhóm PASS|Refund-only không hoàn kho; tranh chấp→Admin quyết định; hai lần nhận hàng chỉ một refund/restock; hàng không đủ điều kiện nhập lại không tăng kho; Buyer/Seller/Admin desktop/mobile|
|Listing và quyền ghi|4 nhóm PASS|Seller tạo nháp, tải ảnh, nhập một variant giá25000/tồn7/kiện100g, gửi duyệt; Admin duyệt; public404 trước duyệt/200 sau duyệt; Seller khác sửa404, Buyer/Seller gọi duyệt403; dữ liệu không đổi sau yêu cầu bị từ chối|

Đây là38 nhóm kiểm chức năng, không phải38 test case độc lập hoặc một thước
đo bao phủ bảo mật. Không mock phản hồi nghiệp vụ; fault injection có chủ đích
được ghi trong driver. Dữ liệu giao/hoàn tiền và OrderItem của Review/hậu mãi
là fixture mô phỏng, không chứng minh giao vận hoặc hoàn tiền qua ngân hàng.

Listing chỉ kiểm một variant mặc định. Form Seller hiện có tên/danh mục/ảnh/
giá/kho/kiện hàng; ca này không nghiệm thu editor option/thuộc tính hoặc đa SKU.
Chat bốn nhóm không thay nghiệm thu thẻ Order, nhiều instance hoặc tải realtime.
Mobile là viewport Chrome mô phỏng, chưa kiểm thiết bị vật lý/Safari/screen reader.

## HTTP/PostgreSQL và quyền database

Lượt DML app-role:144 PASS,2 FAIL do hai test rollback cần CREATE FUNCTION/
TRIGGER để dựng lỗi PG. Quyền app không được nâng. Lượt QA migrator chạy lại
cùng bộ đạt **146/146**, gồm rollback Order/history/receipt, retry cùng key,
khóa chờ có giới hạn, Product lifecycle, Chat, Review và hậu mãi.
Không cộng144 và146 thành290. Suite này không chạy lại toàn bộ1201 E2E.
Driver ghi Buyer command chưa nằm trong bộ focused này; giữ bằng chứng full
suite và Checkout trước đó riêng, không gọi tên file không tồn tại là đã chạy.

Lượt đầu tiên còn bị chặn vì Docker tắt. Sau khi bật Docker/PG hiện có, chạy
lại thành công. Driver listing có các lỗi fixture/assertion trước lần PASS:
email local-part quá dài, selector dropdown và shape public store/inStock.
Các log được giữ nguyên; không sửa ứng dụng để làm test xanh.

## Vị trí bằng chứng local

Trong `machine-local/integration-20261029/` ngoài Git:

- `remaining-1793286186187`: bốn report Chrome, ảnh, source hashes; focused DML.
- `remaining-1793286489837`: focused146 PASS bằng QA migrator.
- `remaining-1793287091571`: listing4 PASS trước định dạng driver.
- `remaining-1793287142928`: listing4 PASS với driver cuối sau định dạng.
- Các lượt lỗi trước giữ riêng theo tên thư mục thời gian, không ghi đè.

Driver listing lưu SHA commit, SHA256 chính driver, kết quả HTTP denial và
ảnh riêng. Bản sau định dạng được chạy xác nhận riêng trước commit bàn giao.
Không đưa secret, dump, model, log runtime hoặc ảnh lên Git.

## Review và điều kiện tích hợp

CI tại `63274b0`: **6/6 success** khi kiểm trong lượt này. GitHub không có
review/comment của thành viên trên PR135 tại thời điểm kiểm. Codex kiểm lại
phần Auth admission, bounded input, opaque VNPay reference và tenant analytics;
không xác nhận P1/P2 mới trong phạm vi đã đọc và thực thi. Đây là review nội bộ.

Gọi Gemini CLI không thành công vì chưa cấu hình phương thức xác thực trong
CLI hiện tại. Không nhận response rỗng hoặc lỗi cấu hình là review đạt; review
Argon trước đó vẫn chỉ áp dụng cho phạm vi/commit đã ghi trong tài liệu trước.

PR135 có thể bàn giao review; chưa đủ điều kiện tự merge: quy trình yêu cầu
ít nhất một thành viên khác review. Thay đổi schema cần Hiền review nghiệp vụ,
contract Backend–AI nếu đổi cần Hoàng–Đạt review. Không đóng133/134 hoặc merge
ba PR trùng nội dung khi chưa chọn đường tích hợp. CI commit mới phải kiểm riêng.

HTTPS/proxy, email ngoài, Google LINK, MoMo, QC VNPay thủ công, rollback/tải,
listing đa SKU/thuộc tính và bộ nộp cuối vẫn mở. Xem [ma trận](release-acceptance-matrix-2026-10-29.md).
