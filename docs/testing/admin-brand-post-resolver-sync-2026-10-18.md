# #64 — đồng bộ develop sau resolver #67, 18/10/2026

## Phạm vi và nguồn

- Đầu vào Brand: `a220a5e93ed76fa3b4d79eb939c14295fd0ddb84`.
- Develop nhận vào: `39e83435695bbfd3131b259f8118b31d951f2f90`, đã merge #67.
- Giữ module Brand editor độc lập; chưa mount tab Thương hiệu production.
- Không tự approve hoặc merge PR; merge commit này chỉ đồng bộ develop vào
  nhánh `feat/hien/admin-brand-editor` đang có của #64, không force-push.

## Giải conflict và bảo toàn source

Conflict duy nhất trong `docs/architecture/system-architecture-overview.md`.
Giữ cả cập nhật/bằng chứng/giới hạn resolver #67 và toàn bộ lịch sử Brand;
thêm mốc hiện tại để các đoạn NOT_IMPLEMENTED/NOT_RUN lịch sử không bị hiểu
là trạng thái Backend resolver sau merge #67.

Diff toàn bộ `FE/` so với `a220a5e` rỗng: source Brand/editor/adapter/tests và
dev entries không đổi. Admin/Catalog, Auth/client/guards/routes, Address/Cart,
Checkout/Order và recovery nền khớp `39e8343`; giữ tạo/bật–tắt Brand và Category.
Diff `BE/`, `AI_CLIP/` và lockfile so với develop rỗng, bao gồm migration/Prisma;
không sửa migration hoặc semantics. Architecture so với develop chỉ thêm nội
dung Brand và mốc đồng bộ, không xóa nội dung nền. Không bật nút Seller POST
trên Web từ approval.

## Kiểm thử lượt đồng bộ mới

Chạy mới trên cây kết hợp sau giải conflict, không dùng kết quả của head cũ:

| Kiểm tra | Kết quả |
|---|---|
| Frozen/offline install, ignore-scripts | PASS; lockfile không đổi |
| Toàn FE unit/component | 432 PASS, 6 live SKIP; 30 file PASS/1 file SKIP, 32.07 giây |
| FE lint | PASS/exit0; 5 warning react/set-state-in-effect có sẵn ở AdminDashboardPage |
| FE TypeScript/Vite build | PASS |
| Prisma generate | PASS; chỉ sinh client local, không kết nối/migrate DB |
| Toàn Backend unit | 629 PASS/27 file, 7.20 giây |
| Backend typecheck/lint/Nest build | PASS |
| Diff-check, source identity, conflict markers/unmerged entries | PASS |

Backend unit dùng mock/fault cases; log lỗi Search/health và warning worker
trong các ca âm không phải bằng chứng chạy hệ thống live. Cảnh báo gợi ý
Prisma major update và Vite plugin không được xử lý bằng nâng dependency
ngoài phạm vi. Không tắt test hoặc nới rule để đạt.

## Giới hạn và bước sau

Browser/Backend/PostgreSQL live trên cây kết hợp mới: **NOT_RUN**.
Không migrate/seed/reset hoặc sửa DB QA/demo trong lượt đồng bộ này.
Các số E2E/unit trong ghi nhận #67 là bằng chứng nền, không tự cộng thành
test runtime đã chạy lại trên cây Brand kết hợp.

Unknown lock Brand vẫn chỉ trong instance; không coi reload/retry ghi là an
toàn, không có durable Brand receipt/expectedVersion trong phạm vi này.
Chưa nghiệm thu toàn bộ Admin, Order hoặc G-ADMIN/G-FULFILMENT.

Sau khi #64 merge và xác minh trên GitHub, mới tạo nhánh integration riêng từ
develop mới nhất, nối editor vào tab Thương hiệu của Catalog, giữ Category và
tạo/bật–tắt Brand; chạy integration tests và QA browser → Backend → PostgreSQL
riêng rồi mở PR riêng. Không làm trước điều kiện merge.
