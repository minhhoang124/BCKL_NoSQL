# PR #81 — bổ sung Store CLOSED và đồng bộ develop

20/10/2026. Chỉ sửa adapter/reader chuẩn bị Accounts, chưa đưa Accounts vào
production route và chưa bật khóa/mở tài khoản.

## Feedback và thay đổi

- Theo [review của Hoàng](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/81#pullrequestreview-5585461810):
  enum `StoreStatus` trong Prisma có `CLOSED`; GET `/admin/accounts` trả nguyên
  trạng thái này. Adapter cũ thiếu giá trị nên một Store hợp lệ có thể làm cả
  trang bị từ chối với 502. Lượt QA local chỉ có Store ACTIVE chưa bắt được ca này.
- Commit sửa `b19b6287c82890db3142fea69672e565870d2a2d`: thêm CLOSED vào type,
  allowlist validator và nhãn “Đã đóng”. Không lọc bỏ Seller/Store CLOSED,
  không đổi Backend/schema, không mở quyền cập nhật Store.
- Thêm test adapter cho trang ACTIVE/CLOSED/null và test reader hiển thị đúng
  cả ba, vẫn giữ account active khi Store đã đóng. Test reject UNKNOWN và dữ
  liệu ngoài allowlist vẫn giữ nguyên; màn read không có nút ghi.
- Merge develop `2f78a986265bbeed8341b164493c9dcac0e774fb` sau #71/#76/#79
  tại `dd1b540ec171fb58e443b438eb454a068c4b6655`. Không conflict; giữ nguyên
  file Brand, Admin route/menu, Checkout/Order từ develop. So với develop,
  bản preparation không sửa `AdminDashboardPage.tsx` hoặc file Brand.

## Kiểm thực chạy đúng bản chuẩn bị sau đồng bộ

Chạy trong checkout sạch riêng tại `dd1b540`, không dùng các thay đổi tích hợp
Accounts chưa commit trong worktree làm bằng chứng của PR chuẩn bị:

| Kiểm tra | Kết quả |
|---|---|
| Offline/frozen install | PASS, 585 package từ cache, không đổi lockfile |
| Full FE | **721 PASS / 6 opt-in live SKIP**, 40 file PASS / 1 file SKIP, 23.12s |
| Accounts adapter + reader | 45 ca trong tổng; thêm 2 ca CLOSED, không cộng lại vào tổng |
| Lint | Exit 0, còn 5 warning Dashboard nền `set-state-in-effect` |
| TypeScript/Vite build | PASS, 89 modules; CSS `index-Uu3ORd9I.css`, JS `index-BTh7fP5F.js` |
| Diff/whitespace/scope | PASS; phần tích hợp local, cấu hình QA và personal AGENTS không nằm trong commit |

Lượt test focused trước đó từng bị sandbox chặn rename file tạm, không chạy
được test; đã chạy lại ngoài sandbox 45/45 đạt. Full FE trên checkout sạch ở
trên là kết quả dùng để bàn giao. Sau lượt này chỉ bổ sung report, không sửa logic.

## Ranh giới và bước tiếp

- Test CLOSED ở đây là adapter + transport fixture và UI component test,
  **không phải browser → Backend → PostgreSQL với Store CLOSED/SUSPENDED**.
  Không dùng 721 PASS hoặc CI xanh để nhận các ca live chưa chạy.
- Phần read đã có QA local trên nền cũ với 56 User/Store ACTIVE nhưng chưa
  được publish trong PR preparation; phải tách report/bản được kiểm. Sau sync
  nền mới, chưa dùng bằng chứng đó để xác nhận bản tích hợp mới.
- Theo [điểm nối Hoàng đã chốt](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/81#issuecomment-6291682161):
  integration riêng từ develop mới, route Web `/admin/users`, menu Tài khoản,
  API GET `/admin/accounts`. Giữ shell/guard ADMIN, AuthProvider/shared client,
  Brand/Category/Address/Cart/Checkout/Order. Không production role/token mẫu.
- Phần integration local đã được lưu riêng để không trộn vào #81. Sau Hoàng
  re-review/chốt phần preparation, đưa integration sang nhánh riêng trên nền
  phù hợp rồi kiểm lại đúng source/DB QA. Hai Admin hai profile, delayed GET
  khi logout/đổi phiên, runtime fault và Store CLOSED/SUSPENDED còn phải bổ sung.
- Khóa/mở nâng cấp vẫn NOT_IMPLEMENTED trong PR này; không nhận toàn
  Accounts/Admin/giai đoạn 3 đã nghiệm thu, không tự Ready/approve/merge.
