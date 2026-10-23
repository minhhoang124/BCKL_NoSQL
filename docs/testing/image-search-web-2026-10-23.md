# Web tìm ảnh — 23/10/2026

## Phạm vi và trạng thái

Nhánh `codex/image-search-web`, nền develop `06eb4fd`. Chỉ sửa Frontend,
không lấy Backend chưa merge làm nền chính thức. Phụ thuộc API PR #102,
head đối chiếu `3cc0e9fe961062cfb5eb1b94186b91006d41e724`.
Mặc định `VITE_IMAGE_SEARCH_ENABLED=false`; chỉ khi build với giá trị `true`
mới có đường dẫn `/search/image` và liên kết ở trang tìm kiếm.
Đây chưa phải nghiệm thu tìm ảnh xuyên suốt với model/index thật.

## Luồng và các biến chính

- `selection`: File đang chọn và địa chỉ object URL để trình duyệt xem trước;
  không lưu vào localStorage/sessionStorage. URL được thu hồi khi bỏ/đổi ảnh,
  đổi phiên hoặc rời màn hình.
- `previewReady`: chỉ bật gửi khi ảnh đã được trình duyệt giải mã, có kích thước
  dương và không quá 25 triệu điểm ảnh. Backend vẫn phải kiểm tra bytes độc lập.
- `resources.generation`: số thứ tự lần yêu cầu. Đổi ảnh, dừng chờ hoặc unmount
  tăng số này; phản hồi của lần cũ không được ghi đè màn hiện tại.
- `resources.busy`: khóa đồng bộ ngay trước await, ngăn bấm hai lần trong cùng
  một nhịp, không phải bảo đảm giao dịch database.
- `resources.controller`: AbortController để dừng chờ request HTTP. Không hứa
  rằng dừng chờ sẽ thu hồi ảnh mà server đã nhận.
- `cooldownUntil`: thời điểm được thử lại sau HTTP 429/Retry-After; không tự gửi lại.

Người dùng chọn JPEG/PNG tối đa 5 MiB → xem trước → chủ động gửi multipart
`image`, `topK=24`, `candidateK=100` → Backend → AI → Backend đối chiếu Product
trong PostgreSQL → Web kiểm tra response → ProductCard dùng component có sẵn.
Không gửi token/cookie; tên file truy vấn thay bằng `query.jpeg`/`query.png`.
Không bổ sung bộ lọc keyword vào contract image và không đổi contract FastAPI.

API adapter giới hạn chờ 50 giây gồm cả đọc body, body tối đa 2 MiB, kiểm kiểu
và trường bắt buộc trước hiển thị. Product được dựng theo danh sách trường cho
phép, không sao chép trường dư từ upstream. Chấp nhận cosine score âm, rank có
khoảng trống sau hydrate; không biến điểm thành phần trăm giống nhau.

## Kiểm thử và ranh giới

Test đơn vị dùng mock HTTP, không được gọi là bằng chứng AI integration.
Kết quả local: toàn bộ FE **1191 PASS/6 live SKIP**, 60 file đạt/1 file bỏ qua;
lint không lỗi, còn 5 warning Admin có sẵn; TypeScript/Vite build đạt.
Lệnh formatter không chạy vì checkout không cài prettier; không tải thêm gói
hoặc tính lượt đó là formatter PASS. `git diff --check` đạt.
Bao gồm file sai kiểu/kích thước, malformed HTTP 200, body quá giới hạn,
rank/ID trùng, score không hữu hạn, hủy, phản hồi cũ về muộn, StrictMode,
bấm hai lần, đổi ảnh, đổi tài khoản, thu hồi URL, chờ Retry-After và cờ bật/tắt.

Chrome riêng: **4/4 nhóm PASS**, desktop 1440×1000/mobile 390×844, OS light/dark,
12 PNG; kiểm giải mã PNG thật trong browser, không tự POST khi chọn ảnh, double
click cùng nhịp chỉ 1 POST, kết quả rỗng, malformed200, lỗi mạng, bỏ ảnh và không
tràn ngang. Đây là **Chrome + HTTP mẫu**, không Backend/PostgreSQL/AI integration.
Storefront vẫn dùng bộ màu cam sáng đã chốt trong cả hai cấu hình OS, không tuyên
bố đã bổ sung một theme tối mới. Script `scripts/test-image-search-web-browser.mjs`
nhận `--output` và `--playwright-module`; cấu hình Vite `envDir:false`, không DB.
Lượt đầu driver lỗi cách import thư viện CJS, đã sửa và chạy lại đủ 4 nhóm đạt.

Gemini Argon Medium rà tĩnh độc lập đúng hai file API/page tại commit `4a28e2c`:
NO FINDING; không chạy test, không đọc router/dependencies và không thay approval
con người. Hai file này không đổi trong commit bổ sung driver/bằng chứng.

Chưa chạy trong đợt này: Chrome với Backend/PostgreSQL và CLIP/FAISS
thật; đánh giá chất lượng tìm ảnh trên tập nhãn; Elasticsearch/hybrid integration.
Không chạy DB demo, không migration hoặc ghi dữ liệu nghiệp vụ.

## Cách tiếp tục QA

1. Sau #102 được tích hợp, dựng Backend/AI trên môi trường QA riêng; không trỏ
   Vite hoặc script test vào database demo. Không đọc `.env` để ghi đè QA profile.
2. Bật `VITE_IMAGE_SEARCH_ENABLED=true` khi khởi chạy/build FE QA; mọi biến VITE
   đều có thể đi vào bundle, tuyệt đối không đặt secret trong chúng.
3. Kiểm ảnh thực, kết quả rỗng, lỗi giải mã, 429, timeout; bấm hai lần, đổi ảnh
   khi đang chờ, dừng chờ, đổi tài khoản và phản hồi cũ đến sau kết quả mới.
4. Chụp desktop/mobile, kiểm bàn phím và màu sáng/tối. Lưu exact commit của
   Frontend/Backend/AI, model revision, index QA và kết quả, không kèm thông tin nhạy cảm.
5. Chỉ sau bằng chứng đó mới xét bật mặc định; flag tắt hiện tại không phải
   tuyên bố chức năng đã được đưa vào sử dụng chính thức.
## Cập nhật đồng bộ 23/10/2026

Nhận develop `a91db91` sau #94; conflict chỉ ở tổng quan kiến trúc, giữ cả
ghi chú miền tính năng và Attributes. Không thay runtime của tính năng trong
lượt đồng bộ; không dùng approval head cũ thay review bản kết hợp.

Frontend: 1.191 PASS/6 live SKIP, 60 file PASS/1 SKIP; lint PASS với 5 warning Admin nền, TypeScript/Vite build PASS. Kết quả Chrome fixture trước đây không thay nghiệm thu Backend/AI/DB thật sau đồng bộ.
