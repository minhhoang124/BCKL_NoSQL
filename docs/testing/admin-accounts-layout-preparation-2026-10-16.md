# Admin Accounts — chuẩn bị layout, 16/10/2026

**PREPARATION, chưa nối API, không phải quản lý tài khoản đã nghiệm thu.**

Đối chiếu lại develop `035656b` ngày 16/10: vẫn chưa có API list User/Seller;
PATCH status hiện có chưa đủ lý do/audit/chính sách nhạy cảm theo SRS.
Xem [readiness API và checklist nghiệm thu, chỉ local](admin-accounts-api-readiness-2026-10-16.md).

## Baseline và phạm vi

- Nhánh riêng `feat/hien/admin-accounts-layout`, tạo từ remote develop `035656b` sau #56/#57, không nhập Admin #28 chưa merge.
- Chỉ thêm component/CSS/test, entry xem trước local và tài liệu này. Không sửa Admin #28, AppRouter/menu, Address/Cart, Checkout/Order, AuthProvider/apiClient, CSS global, Backend/schema/migration hoặc contract Search.
- Căn cứ: `work-assignment.md` giai đoạn 3 của Hiền; `implementation-scope.md` P0/Admin; SRS v3.1 `FR-ADM-01`; code `BE/src/auth/admin-account.controller.ts`, `auth.service.ts`, `jwt.strategy.ts` và DTO hiện hành.

## Có thể xem gì?

Chạy Vite của nhánh này trên cổng riêng, chỉ bind loopback. Mở `/admin-accounts-preview.html` trong development; không cần đăng nhập hoặc Backend vì chỉ có mẫu giả lập công khai. Không dùng cổng QA 5176 đang chạy Admin #28. Entry này không được thêm vào production build mặc định hoặc router ứng dụng; có kiểm tra `import.meta.env.DEV`.

- Danh sách mẫu Người mua/Người bán, tên/email/mã **minh họa**, trạng thái.
- Tìm kiếm không phân biệt hoa thường/dấu tiếng Việt; kết hợp lọc vai trò/trạng thái; reset và thông báo không khớp.
- Số dòng có nhãn minh họa, không tự gọi là tổng tài khoản hệ thống; không giả lập phân trang Backend.
- Hộp xem trước khóa/mở, ô lý do không lưu, Hủy/Esc, focus khi mở/đóng và vòng Tab. Nền phía sau bị inert khi mở hộp.
- Nút xác nhận luôn disabled, không gửi HTTP, không ghi storage, không đổi trạng thái; không thông báo thành công giả.
- Nếu dùng component không truyền mẫu: hiện chờ API, bộ lọc disabled, không biến dữ liệu chưa tải thành tổng 0 hoặc danh sách rỗng thành công.
- CSS module giữ nền/chữ sáng riêng, responsive thành thẻ ở màn nhỏ, không đổi theme dùng chung.

`AccountLayoutExample` là model trình bày mẫu, **không phải DTO/API contract**. Không truyền dữ liệu thật vào bản preview; không dùng entry này để xác nhận quyền Admin.

## Dependency cần Hoàng chốt trước runtime

1. API list/detail User/Seller: trường được phép trả, tìm kiếm/filter, phân trang, lỗi và quyền; không trả passwordHash/token. Không tự đặt tên endpoint hoặc payload mới.
2. API đổi trạng thái hiện có là `PATCH /admin/accounts/:userId/status` nhận `{ isActive: boolean }`, ADMIN-only. Hàm hiện tại chưa nhận reason/actor và chưa ghi audit quyết định account tương ứng SRS. Không tự thêm reason vào body DTO hiện có.
3. Bảo vệ Admin cuối cùng/tự khóa, cạnh tranh quyết định và chính sách refresh session khi khóa/mở. JWT/login/refresh hiện đọc isActive; chưa có browser runtime cho account bị khóa khi đang mở trang trong task layout này.
4. Seller eligibility tạo SearchReconciliationJob không có nghĩa ES/FAISS đã cập nhật xong; phải kiểm bằng chứng riêng, không thông báo đồng bộ hoàn tất từ response PATCH.
5. Chốt điểm tích hợp vào Admin shell sau #28; hiện chưa bật `/admin/users` hoặc sửa menu dùng chung.

## Kiểm thử và giới hạn

Test component chỉ kiểm bố cục/bộ lọc/xem trước, không dùng làm bằng chứng API/PostgreSQL, RBAC, audit, session expiry, concurrent Admin hoặc account management end-to-end. Chưa có CI/PR/merge trong bước local này.

Kết quả local cuối ngày 16/10/2026, trên develop `035656b` cộng các file layout mới:

| Kiểm tra | Kết quả |
| --- | --- |
| Cài dependency FE từ cache, frozen lockfile | PASS, không đổi lockfile |
| `pnpm --dir FE exec vitest run --maxWorkers=1` | 360 PASS / 6 SKIP; 26 files PASS / 1 suite SKIP; gồm 14 test layout mới |
| `pnpm --dir FE lint` | PASS, exit 0 |
| `pnpm --dir FE build` | PASS, TypeScript + Vite |
| Production output | Chỉ entry ứng dụng mặc định, không có HTML/bundle preview trong dist |
| Browser desktop 1280×720 | Bố cục danh sách/bộ lọc; tìm không dấu trả đúng 1/4 mẫu; không tràn ngang |
| Browser mobile 360×800 | Mẫu email dài và hộp mở khóa nằm trong viewport; nút lưu disabled, Hủy trả focus đúng nút mở |
| Browser mobile 390×844 | Kết hợp bộ lọc → không khớp → reset về 4/4 mẫu; không tràn ngang |
| Chế độ màu lúc browser QA | `prefers-color-scheme: dark` thực tế true; component giữ nền sáng riêng và chữ tối; không phải đối chứng đầy đủ light/dark hoặc đo WCAG |

Browser phát hiện focus bị mất khi trang chuyển inert; đã sửa bằng giữ nút mở ngay lúc click, thêm test hồi quy và kiểm lại Hủy trên browser thật. Unit cũng kiểm Esc/Tab/khôi phục focus, lý do không lưu, không request hoặc thay trạng thái. Ảnh viewport giữ local, chỉ chứa mẫu giả lập. Đã trả viewport về mặc định và giữ tab xem trước.

Lượt test đầu chạy trong sandbox bị EPERM khi tạo/đổi tên cache trước khi test thực thi, không phải kết quả PASS. Đã chạy lại bằng lệnh `exec vitest` đúng tham số với một worker trong môi trường cho phép; bảng trên là kết quả lượt cuối thành công. Không sửa code nghiệp vụ để né lỗi môi trường.

Toàn bộ runtime account QA, quyền nhạy cảm và cơ sở dữ liệu giữ nguyên. Các thiếu sót account list/status vẫn là công việc chưa hoàn thành, không hạ thành P2 chỉ vì đã có layout.
