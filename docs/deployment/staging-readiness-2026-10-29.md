# Chuẩn bị staging cho bản bảo vệ —29/10/2026

**Cập nhật30/10:** PR135/136 đã merge develop ce4e48f,CI sau merge6/6;
điều kiện tích hợp cũ bên dưới đã được đáp ứng. Restore local mới68bảng,
39migrations,90ảnh đạt;chưa triển khai Azure hoặc kiểm HTTPS.
[Trạng thái và bằng chứng hiện hành](../testing/release-priority-checkpoint-2026-10-30.md).

Mục tiêu là một bản demo online ổn định, có dữ liệu mô phỏng và bằng chứng
kiểm thử. Không đồng nghĩa mở bán, nhận tiền thật hoặc đã đạt chứng nhận bảo mật.
Tài khoản Azure education của người dùng chưa được kiểm subscription/credit/
quota trong lượt này. Chưa tạo tài nguyên tính phí hoặc triển khai public.

Người dùng xác nhận **chưa có tên miền**. Trước mắt chưa cần mua tên miền
để tiếp tục QA local. Trước deploy cần chọn URL, kiểm subscription/credit/quota,
ước tính chi phí và kiểm thiết kế cookie bên dưới. URL mặc định của Azure có
thể dùng cho staging nếu thiết kế origin đã được kiểm bằng Chrome; không
tự coi các hostname mặc định là cùng site. Restore local đã có bằng chứng
[67 bảng và catalog thật](../testing/release-ownership-search-recovery-2026-10-29.md),
nhưng chưa thay diễn tập restore trên hạ tầng staging.

## Điều kiện trước khi tạo staging

1. Review/merge nhánh Auth/dependency hardening và khép tích hợp PR133 theo
   quy trình. Không đưa một feature branch chưa được duyệt lên làm bản chính.
2. Migrations, build, test hồi quy và Chrome chạy đúng commit được chọn.
   Lưu riêng lỗi cũ, TODO và ca chưa nghiệm thu; không chỉ báo tổng số PASS.
3. Chọn origin Web/API và xác minh cookie trước khi cấu hình Google/VNPay.
4. Cấu hình email recovery thật và hỗ trợ tài khoản password legacy >72byte
   trước rollout chính sách mới cho người dùng ngoài nhóm.
5. Chốt dữ liệu staging tối thiểu: actor giả và catalog có nhãn mô phỏng. Không
   đẩy nguyên backup máy cá nhân hoặc GoogleIdentity của người dùng lên public.

## Origin và cookie là một gate thực tế

Auth hiện dùng refresh cookie host-only, HttpOnly, SameSite=Lax, Path=/auth;
Google proof và Search cookie cũng có path riêng. HTTPS ở cả Web/API, Origin
phải bằng FRONTEND_URL chính xác. Không bật trust proxy hoặc CORS wildcard
để chữa lỗi cookie.

Hướng ít đổi contract nhất: Web và API là hai origin HTTPS **cùng site** dưới
tên miền nhóm kiểm soát, API giữ đường dẫn gốc /auth, /payments, /search...
Cookie host-only ở API; fetch credentials include và CORS đúng Web origin.

Hai hostname do nhà cung cấp cấp không tự động là cùng site. Phải thử bằng
Chrome thực tế; không giả định hai URL Azure hoặc tunnel luôn dùng cookie được.
Nếu chọn một origin với prefix /api, cần thiết kế và kiểm lại cookie path,
OAuth callback URL, payment return/IPN và các redirect. Hiện nhiều contract
dùng callback path cố định; không chỉ đổi VITE_API_URL rồi gọi là đã deploy.

## Hạ tầng dự kiến

Một máy Linux chạy các container là phương án cần khảo sát tiếp để gần môi
trường hiện tại. Đo RAM/CPU của CLIP và Elasticsearch trước khi chọn cấu hình;
kiểm quota và chi phí dự kiến trước khi tạo tài nguyên. Chưa chốt loại VM.

- Reverse proxy TLS ở cổng80/443; API chỉ ở mạng nội bộ/loopback.
- PostgreSQL, Elasticsearch và FastAPI index mutation không mở Internet.
- Runtime dùng app-role DML; migrator chỉ dùng ở bước triển khai. Provisioner
  tạo database QA không được đưa vào biến môi trường ứng dụng staging.
- Model, upload, FAISS state và Elasticsearch data có nơi lưu bền; PostgreSQL
  là nguồn nghiệp vụ. Chạy FastAPI một worker theo giới hạn hiện tại; chưa có
  bằng chứng cho nhiều replica cùng sửa FAISS.
- Secret tạo ngoài Git, không VITE_*, không nằm trong image, URL log hoặc ảnh
  minh chứng. Log proxy tránh query OAuth/payment có chữ ký, không log mật khẩu.
- Chốt trusted proxy và rate policy: socket IP sau proxy có thể là IP chung.
  Cần kiểm quota giữa nhiều người dùng; không tin header do client tự gửi.

## Gate nghiệm thu staging

|Gate|Bằng chứng cần lưu|
|---|---|
|Auth|Đăng ký/login/refresh/logout qua HTTPS; CSRF form bị chặn, cookie Secure/HttpOnly, không phục sinh refresh sau logout|
|Quota|Hai client/instance cùng account chia sẻ giới hạn, X-Forwarded-For không tự né, Retry-After hợp lệ, DB lỗi không bỏ guard|
|Quyền|Buyer/Seller/Admin và Store khác nhau; IDOR, khóa tài khoản, role/CV thay đổi|
|Nghiệp vụ|Search→Cart→COD→Seller→giao mô phỏng→Buyer→Review/Chat/hậu mãi→Dashboard trên đúng release|
|Search|Đổi giá/ẩn Product, worker ngắt/restart, outbox replay và index hội tụ; PG hydrate không lộ sản phẩm đã ẩn|
|Email/Google|Email thật tới recipient được duyệt; Google callback public đúng, collision/LINK theo consent|
|Thanh toán|Provider sandbox thực sự gửi IPN, kiểm ledger/PAID/kho, success/cancel/failure/duplicate; return chỉ đọc|
|Browser|Desktop/mobile, reload, mất phản hồi, nhiều tab, lỗi503/429; không tự replay thao tác ghi|
|Vận hành|Health riêng có xác thực, log không secret, backup→restore sang DB khác, rollback release và migrations additive|
|Tải|Đặt SLO và mô hình tải trước khi đo; p95/error/CPU/RAM; không lấy unit test làm bằng chứng chịu tải|

Giữ một bản COD local dự phòng trong buổi bảo vệ. Các luồng provider chưa đạt
phải tắt cờ hoặc hiển thị giới hạn, không trình bày giao dịch giả lập là tiền thật.

## Bằng chứng dùng cho báo cáo

Nên trình bày chuỗi: lỗi tái hiện → sửa → test hồi quy/đối kháng → review → CI
đúng commit → nghiệm thu staging. Ví dụ login CSRF trước sửa phát cookie và
refresh200; sau sửa form bị403, không cookie và refresh401 trên QA local.

Điểm chất lượng chỉ được đánh giá lại theo bằng chứng. Không tự tăng điểm
khóa luận, không gọi audit một phần là ASVS L1/L2 hoặc pentest chứng nhận.
Nguồn phương pháp: https://asvs.owasp.org/ và OWASP WSTG payment testing.
