# PR #40 — đồng bộ preview với develop ngày 22/10/2026

Nhận develop `e394c9e` vào head đã duyệt `d3c0f6a`. Chỉ conflict tổng quan
kiến trúc; giữ cả hai phía. AppRouter tự merge sạch và được đọc/đối chiếu lại:
route thật Address/Cart/Checkout/Order/Accounts/Admin giữ đủ, Admin shell riêng;
preview chỉ `/dev/buyer-flow` và `/dev/seller-orders` dưới `import.meta.env.DEV`.

Hai thư mục preview nguyên byte so `d3c0f6a`. BE/Prisma/AI/lockfile khớp develop,
không lấy Chat #66, QA #51 hoặc Buyer #95/#96 đang mở làm nền. Không bật nút
Buyer transaction hoặc thay Seller flag/default. Màn mẫu không phải Order thật.

## Kiểm thử mới

- Frozen install/ignore-scripts PASS, không đổi lockfile.
- Preview Buyer/Seller + OrderReadPages:40PASS/3files,5.27s;18preview nằm trong
  tổng này, không cộng lại vào full.
- Full FE:957PASS/6liveSKIP,52filesPASS/1SKIP,25.66s.
- FE lint PASS/0error/5warning Admin nền; TypeScript/Vite build PASS437modules.
- JavaScript production không có `/dev/buyer-flow`, `/dev/seller-orders`,
  `BẢN MINH HỌA`, `SELLER DEMO`, `seller-demo-pending`.
- Full-range diff-check PASS.

Preview tests chặn fetch và kiểm chuyển trạng thái mẫu chỉ trong RAM; không
lấy đó làm bằng chứng HTTP/PostgreSQL. Không browser/desktop/mobile/theme,
QA Backend hoặc BE/AI tests mới trên nhánh #40 vì phần tương ứng không đổi.
Màn đọc thật dùng tests đã merge; không thêm nghiệm thu transaction Web.

## Gate

Nhờ Hiền re-review đúng head đồng bộ mới, approvald3c0f6a không thay bản kết hợp.
Chưa merge PR. CI billing không được gọi là xanh. Preview vẫn có nhãn dữ liệu
mẫu và không biến G-CHECKOUT/G-FULFILMENT thành DONE.
