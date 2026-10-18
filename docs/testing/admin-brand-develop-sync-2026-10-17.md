# Brand #64 — đồng bộ sau merge Admin #28, 17/10/2026

## Baseline và phạm vi

- Nhánh `feat/hien/admin-brand-editor`, head trước đồng bộ `647cf0e`.
- Hợp nhất `develop ad3b969` sau #28; không rebase/force-push.
- Conflict duy nhất tại `docs/architecture/system-architecture-overview.md`:
  giữ đủ phần Brand và phần Admin/Checkout/Order từ develop, thêm ghi chú baseline.
- Code AdminDashboardPage, CSS/test Admin và AppRouter khớp develop `ad3b969`.
  Module `FE/src/features/admin-brands` không đổi so với `647cf0e`.
- Backend, Prisma, AI, lockfile, Auth/client, Address/Cart/Checkout/Order khớp develop.
  Chưa nối Brand editor vào Catalog production; integration là PR riêng sau #64 merge.

## Kiểm tra trên cây kết hợp mới

| Kiểm tra | Kết quả |
| --- | --- |
| FE `vitest run --maxWorkers=1` | 392 PASS, 6 live SKIP; 28 files PASS, 1 suite SKIP |
| FE lint | Exit 0; 5 warning set-state-in-effect nền Admin, không có warning mới ở Brand |
| FE build | TypeScript/Vite PASS |
| So sánh source với hai parent | Admin/router khớp develop; Brand module không đổi |
| Diff-check / conflict markers | PASS |
| Browser + Backend/PostgreSQL trên bản kết hợp | NOT_RUN trong lượt đồng bộ này |
| CI đúng head đồng bộ | Chưa có kết quả trong báo cáo local; kiểm riêng sau push |

Lượt Vitest đầu trong sandbox không khởi tạo suite vì EPERM rename cache,
không chạy được test; chạy lại ngoài sandbox exit 0 như bảng trên. Không sửa
test, lockfile hoặc tắt ca để có PASS. Không tính 6 live SKIP là đã chạy.

QA browser/HTTP/PostgreSQL tại source `6aabf98` ngày 16/10 trong
[báo cáo Brand](admin-brand-editor-and-attributes-readiness-2026-10-16.md)
là bằng chứng lịch sử, không đổi nhãn thành QA bản đồng bộ mới.

## Bước tiếp theo / giới hạn

Hoàng review delta và CI đúng head đồng bộ trước quyết định merge #64.
Sau merge, mở PR integration riêng từ develop mới nhất, nối editor vào tab
Thương hiệu của Catalog; giữ tạo/bật–tắt Brand, Category, guards và các route cũ.
Kiểm selection/pending, draft409, unknown không auto replay/GET-unlock và đổi phiên.
Unknown lock chỉ trong instance; không nhận retry xuyên reload đã an toàn.
Không thêm API/schema, reset DB hoặc nghiệm thu toàn bộ Admin/Search.
Không đưa secret, tài khoản QA hay artifact runtime vào PR.
