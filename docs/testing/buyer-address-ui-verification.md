# Buyer Address UI — triển khai và kiểm chứng

Ngày 10/10/2026. Branch mới `feat/hien/buyer-address-ui-v2` tạo trực tiếp từ `develop 27e083b`; mang phần Address UI đã chuẩn bị ở `c12c9a5`. Address Backend #30 đã merge. Trạng thái **IN_PROGRESS**; chưa nghiệm thu G-ACCOUNT/G-CHECKOUT.

## Phạm vi

Hoàng đã xác nhận ngày 10/10 qua tin nhắn gửi Hiền: Sổ địa chỉ dùng `/account/addresses`, thêm route ở `AppRouter.tsx` và link từ `AccountPage.tsx`. Route dùng `ProtectedRoute` USER hiện có; trang kiểm tra thêm tài khoản active trước gọi API. Giữ nguyên AuthProvider/refresh/API client và các route khác. Không gộp Admin #28 hoặc Cart. Nhánh đã đồng bộ `develop f267399` bằng merge an toàn; Backend/PostgreSQL thật vẫn NOT_RUN, mở PR để review code trước.

Tham chiếu thị giác `25-address-book` của gói Orange v1 ngày 26/09. Form đã tách recipientName/phone/province/ward/addressLine theo API; district nullable, postalCode/deliveryNote tùy chọn. Giữ shell Header/Footer hiện có trên develop; màu cam áp dụng trong trang, chưa thay theme global.

Code: `FE/src/pages/AddressBookPage.tsx`, `AddressBookPage.module.css`, `FE/src/components/Address/`, `FE/src/services/addressApi.ts`, `FE/src/types/address.ts`.

## Contract và hành vi

| Thao tác | HTTP | Hành vi UI |
|---|---|---|
| Danh sách | GET /me/addresses | no-store, loading/empty/error; giữ thứ tự Backend |
| Thêm | POST /me/addresses | Trim/validate, optional trống gửi null; lần đầu mặc định do Backend quyết định |
| Sửa | PATCH /me/addresses/:id | Giữ form khi lỗi; không gửi isDefault=false để bỏ mặc định hiện hành |
| Mặc định | PUT /me/addresses/:id/default, body {} | Chỉ có nút ở địa chỉ chưa mặc định; không có nút bỏ mặc định |
| Xóa | DELETE /me/addresses/:id | Xác nhận riêng, xử lý 204; Backend chọn default thay thế nếu còn địa chỉ |

Dùng `fetchApi`/AuthProvider hiện có; không sửa Auth, global API client, Backend, schema hoặc API contract. Adapter hiện có giữ HTTP status/message nhưng không giữ code riêng; UI hiển thị thông báo server và yêu cầu đối chiếu danh sách cho tất cả lỗi 404/409. Không nhận frontend status mapping là bằng chứng DB ownership.

Các write có khóa synchronous để chặn double-submit. Sau write thành công mới đóng form, thông báo thành công và đọc lại danh sách. Nếu GET sau write lỗi, giữ thông báo đã lưu, khóa mutation cho tới khi tải lại được; không yêu cầu User tạo lại. Network/5xx khi write có kết quả chưa xác định: giữ form, yêu cầu tải lại và kiểm tra danh sách trước thao tác tiếp; không tự retry POST vì Address không có idempotency key. Validation 400 giữ form để sửa. Load có AbortController và sequence; đổi tài khoản remount trang, bỏ dữ liệu và response cũ. Không lưu địa chỉ/token vào storage, URL hoặc log.

## Kiểm tra tự động

```powershell
pnpm install --frozen-lockfile --filter fe --ignore-scripts
pnpm --dir FE lint
pnpm --dir FE test
pnpm --dir FE build
git diff --check
```

Ngày 10/10, sau khi tạo branch từ `develop 27e083b`: FE lint PASS không warning; build PASS; FE test **40/40, 8 file**. Trong đó Address UI 14 ca và HTTP adapter 3 ca: loading/empty, trim/null, validation/phone, double-submit, giữ form, limit/conflict, default, edit, DELETE confirmation/204, write thành công nhưng reload lỗi, network kết quả chưa xác định, auth/permission, đổi actor/late response và không gọi API cho Seller. HTTP adapter dùng mock fetch, kiểm đúng route/method/body/Bearer/no-store và refresh token hiện có. Các test này không kết nối PostgreSQL.

## Kiểm thử trình duyệt có nhãn MOCK

Lượt bàn giao sau xác nhận Hoàng và sync `develop f267399` ngày 10/10: **46/46 FE test, 9 file**, lint không warning và build/typecheck PASS. Sáu ca route mới kiểm trang Address thật, link từ Account, anonymous, SELLER/ADMIN và inactive USER không gọi API địa chỉ. Browser evidence bên dưới là lượt MOCK trước đó; chưa chạy lại browser hoặc Backend/PostgreSQL thật sau sync. Không suy diễn 46 test là nghiệm thu DB.

Script `scripts/test-buyer-address-browser.mjs` chạy app React thật trên trình duyệt với interception API fixture, không cần DB. Playwright là công cụ tùy chọn của người chạy, chưa thêm dependency/lockfile cho project.

```powershell
pnpm --dir FE dev --host 127.0.0.1 --port 5178 --strictPort
# Terminal khác, khi Playwright đã được cài trong môi trường:
node scripts/test-buyer-address-browser.mjs --channel chrome --output artifacts/address-ui-browser
# Nếu Playwright nằm ngoài repo, thêm --playwright-module <duong-dan-tuyet-doi-toi-playwright/index.mjs>
```

PASS trên Chrome headless desktop 1440×1080 và mobile 390×844: GET→POST→PATCH→PUT default→DELETE, confirm trước xóa, giới hạn 409 giữ form, một POST thành công, không lỗi JavaScript, scrollWidth=390/innerWidth=390. Ảnh `desktop-mock.png`, `mobile-form-mock.png`, `mobile-error-mock.png` là **MOCK API evidence**, không phải demo dữ liệu PostgreSQL. Artifact local ở `C:/khoaluan/address-ui-evidence`, không commit screenshot/runtime log.

## Lượt tích hợp Backend thật — NOT_RUN

PostgreSQL service local có chạy nhưng chưa có DATABASE_URL dùng được cho worktree; kết nối psql không có password bị từ chối. Không áp migration/reset hoặc dùng database demo trong lượt UI này.

Để chạy thật: cấu hình DATABASE_URL/JWT secrets trong môi trường local, chọn DB test riêng và áp migration đã merge; chạy Backend với FRONTEND_URL khớp origin Frontend. FE mặc định gọi `http://localhost:3001`; nếu dùng cổng khác, cấu hình VITE_API_URL. Không gửi password/token qua review hoặc commit `.env`.

Reviewer kiểm tra bằng trình duyệt với API thật:

1. Login USER A, vào `/account` → Sổ địa chỉ. GET rỗng không tạo row.
2. Thêm không district; tải lại trang và xác nhận dữ liệu vẫn còn, đúng một default. Thêm địa chỉ thứ hai, đổi default và đọc lại.
3. Sửa mandatory/optional, xóa optional; invalid phone/whitespace giữ form. Không bỏ mặc định bằng checkbox.
4. Xóa cả địa chỉ mặc định: default được Backend thay thế; xóa cuối thì empty.
5. USER B không thấy dữ liệu A; API ownership vẫn 404. SELLER/ADMIN bị route/Backend từ chối.
6. Hết phiên, hai tab cùng sửa, vượt giới hạn cấu hình, DB conflict, mất mạng và GET sau commit lỗi; kiểm không tạo trùng do UI tự gửi lại.
7. Chụp desktop/mobile thật và ghi commit/run/browser/DB test tên (không secret) trước nghiệm thu.

Chỉ sau test thật, CI/review và merge mới cập nhật trạng thái chức năng; UI/Address API riêng chưa chứng minh luồng Checkout đã hoàn thành.
