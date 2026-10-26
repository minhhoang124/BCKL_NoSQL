# Dashboard Web — kiểm chứng26/10/2026

Base `7f735a6` sau merge Dashboard Backend #120. Phạm vi Admin/Seller Web đọc
API thật; không sửa Backend/schema hoặc bật cờ giao dịch. Theo
[luồng và biến](../architecture/dashboard-web-workflow.md).

| Kiểm tra | Kết quả |
|---|---|
| Frozen offline install |602 packages, lockfile không đổi, ignore install scripts|
| Full Frontend |77 files PASS/1 skipped;1381 PASS/6 live SKIP,141.92s|
| Dashboard parser/component bản cuối |35 PASS|
| Dashboard + Admin/Seller regression lượt đầu |52 PASS, sau đó bổ sung4 ca Dashboard|
| TypeScript/Vite build |PASS; cảnh báo bundle >500kB, không thêm thư viện chart|
| Oxlint |0 errors;5 warnings set-state-in-effect nền Admin; xem ghi chú bên dưới|
| Chrome→Nest→PostgreSQL |9 nhóm PASS: Admin/Seller × desktop/mobile × light/dark, cộng503 fault/retry|
| Source/financial invariants |Hash source và Order/Payment/refund/adjustment/variant/audit/stock/Search bất biến trong browser run|

Browser cuối: `artifacts/dashboard-web-browser-20261026/r1792986609776` ở máy
QA, có report.json cùng16 screenshot. Không commit log/ảnh runtime hoặc secret.
Script tái lập: `scripts/test-dashboard-browser.mjs`. Yêu cầu database QA riêng
loopback5549/v951, app-role `bckl_qa_app_20261021` không superuser/CREATEDB/
CREATEROLE, đủ27 migration; không có dotenv trong checkout. Cả4 background
worker flags phải false. Truyền DATABASE_URL riêng qua môi trường, không ghi
credential vào Git; output directory mới và đường dẫn Playwright module qua CLI.
Launcher riêng kiểm demo dừng và binding QA trước khi cấp profile. Không chạy
script này bằng tài khoản database demo hoặc đổi URL guard cho tiện.

Fixture tạo3 actor QA, Store CLOSED,2 snapshot lịch sử: một refund hợp lệ và
một thiếu adjustment để đối chiếu. Giữ lại dữ liệu, không reset/xóa DB. Seller
tháng1 gross100000/shipping20000, tháng2 net-100000, không lấy shipping để trừ
refund. Admin tổng hợp toàn DB QA nên số tiền/count khác fixture Store riêng.

## Đối kháng và review

- Từ chối NaN/Infinity/exponent/tiền âm unsigned/sai cents, wrong scope/Store/
  range/currency/timezone, thiếu CLOSED, bucket thiếu/sai tổng/cửa sổ, count
  overflow và cursor không giảm. Format9007199254740993.01 không mất số lẻ.
- Đổi draft không đổi nhãn số đã tải; đổi range khi request cũ hoặc quality
  đang chờ không nhận phản hồi cũ. Logout/đổi account/Store hydration remount;
  401/403 ở quality bỏ cả số liệu và khóa đọc; 404 Store có giải thích rõ.
- Pending lifetime, net âm và operational counts có nhãn tách biệt. Query
  snapshot trước await; quality GET không gửi bucket hoặc body.
- Chrome503 là response được cố ý chèn, không phải mất mạng vật lý. Số liệu
  cũ biến mất, read-retry thành công, không gửi mutation hoặc gây refund mới.

Argon `gemini-4-argon-medium`, effort Medium, đọc snapshot độc lập, không sửa
code/DB/lệnh: **NONE P1/P2**. Snapshot SHA256
`4281aeef0b7812ca6ebd4ebd94e52f9200df1953c6cdb718e0977031f341aa15`.
Đã thêm4 ca/biên kiểm thử theo các khoảng trống reviewer nêu; runtime không
đổi nghiệp vụ sau review. Tinh chỉnh nền tối sau nhìn screenshot và định dạng
mã bằng Prettier; Chrome cuối ghi hash mã đã định dạng trước khi đặt lint
suppression comment hẹp cho cleanup (không đổi runtime). AI review không
được giả thành human GitHub approval.

Lượt Chrome đầu dừng bởi script gắn theme trước documentElement; sửa script,
không bỏ assert pageerror. Lượt sau tiền/luồng đạt, nhưng manual screenshot
phát hiện tương phản tiêu đề tối thấp; đã thêm nền section và chạy lại. Section
tối là test data-theme, không tuyên bố đã có dark-mode control toàn website.

Lint suppression cleanup chỉ cho ref controller cố ý trỏ request mới nhất lúc
unmount; không suppress toàn file hoặc các quy tắc an toàn. 6 live SKIP nền
chưa chạy, không chuyển sang PASS. Chưa benchmark tải lớn, audit accessibility
toàn site, hậu mãi UI, sandbox hoặc notification. CI phải kiểm riêng đúng head.
