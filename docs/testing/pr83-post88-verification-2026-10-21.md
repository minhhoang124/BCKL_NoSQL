# Attributes preparation sau merge #88 — 21/10/2026

Baseline develop `d84381a` (#88), head trước đồng bộ `9a8b593` đã được Đạt
approve. Merge chỉ conflict ghi chú kiến trúc; giữ đủ cả hai phía. Không đổi
policy/planner, auditor, protocol fixture hoặc workflow CI so với head đã duyệt.
Nhận nguyên chốt runtime QA của #88, không nới guard hoặc dùng dotenv override.

## Kết quả mới trên bản kết hợp

DB mới `bckl_order_resolution_test_attributes_20261019_v903`, PostgreSQL17 QA
riêng loopback5549, role không superuser. Demo `bckl_postgres` giữ tắt; trước
mỗi lệnh kiểm target/container/role, checkout không root/BE `.env`; cung cấp
DATABASE_URL trực tiếp trong process từ private profile, không xuất credential.

| Kiểm tra | Kết quả thực chạy |
| --- | --- |
| Fresh migrations hiện có | 16/16 PASS |
| Backend unit | 893 PASS / 38 files, 6.03s |
| Full Backend E2E | 684 PASS / 20 TODO, 37 files PASS / 1 SKIP, 175.59s |
| Backend lint / typecheck / Nest build | PASS |
| Prisma validate / git diff --check | PASS |

Full E2E local có compiled CLI audit; khác CI có một case audit skip vì môi
trường GitHub. Không gán số CI head cũ thành lượt local mới. Không cộng lại
các ca target guard, effect matrix hoặc protocol đã nằm trong tổng unit/E2E.
Negative-case logs mô phỏng lỗi và cảnh báo nền pg/Vite không là assertion fail.

## Phạm vi chưa triển khai

Đây vẫn là PREPARATION: không controller/provider gọi policy/auditor mới, không
normalized unique migration, không actual Admin/Seller write integration, không
public optional-inactive projection thống nhất. Protocol trên bảng fixture không
phải production writer proof. Job/effect planner không chứng minh SearchOutbox
hoặc Elasticsearch/FAISS đã đổi. Không browser/live AI hoặc nghiệm thu Admin editor.

Đồng bộ làm head thay đổi: cần CI/review delta đúng head mới, không tự coi
approval `9a8b593` là approval của commit đồng bộ. #88 đã merge theo quyền Hoàng
cấp riêng; không tự merge #83 khi chưa đủ gate mới.
