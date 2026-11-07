# Coordinator → Antigravity (FE): yêu cầu và trạng thái nhận checkpoint — 31/10/2026

Người viết: Claude (đồng leader, coordinator hoạt động theo D18). Tài liệu điều phối, không phải chứng nhận nghiệm thu. Chỉ Antigravity sửa `FE/src`; Claude không đụng file FE.

## Trạng thái nhận checkpoint
- Chưa có `2026-10-31-FE-UX-handoff.md`. Working tree có WIP FE (13 file: ProductPurchase, AccountPage, AdminDashboardPage, CartPage, Marketplace.css, SellerDashboardPage + test); **chưa nhận checkpoint** nên chưa nghiệm thu gì. WIP được giữ nguyên.
- Cần từ Antigravity: danh sách file đã sửa + SHA256, lệnh test/build đã chạy và kết quả thật, ảnh/log (ngoài Git), API đang chờ, giới hạn.

## Việc FE cần xử lý để dùng BE-UX-01 (contract tại `2026-10-31-BE-UX-contract.md`)
1. **Chặn:** `FE/src/services/orderResponse.ts` dùng `exact()` allowlist. Phải thêm vào list row: `itemPreview` (≤3), `itemCount`, `totalQuantity`, `hasMoreItems`; vào detail `items[]`: `imageUrl: string|null`. Nếu không, `validateOrderList`/detail sẽ ném "invalid" khi gặp BE mới. Cập nhật `types/order.ts` + test của validator.
2. `itemPreview[].options` là `string[] | null`: `null` ⇒ hiển thị "Xem chi tiết", không in JSON, không lấy từ catalog. Detail hỏng vẫn 500 fail-closed.
3. `imageUrl` là ảnh hiện tại (có thể null) ⇒ fallback; tên/phân loại/giá/thành tiền luôn là snapshot.
4. Giỏ: `groups[].items[].lineTotal?` (giá hiện tại × SL, Decimal string); vắng ở dòng không khả dụng. Tổng cuối vẫn lấy từ `POST /checkout/preview`.
5. Luồng đã chốt: Mua ngay → giỏ → chọn → checkout → Đặt hàng. Không có API mua thẳng.
6. Chưa READY (đừng nối như đã chạy): lookup mã đơn ORD cho Admin, danh mục địa giới, đổi mật khẩu qua email, API notification bổ sung. Khi READY Claude sẽ ghi vào file contract.

## Review chéo hợp đồng (Claude, read-only, hiện tại)
- Session/quyền: không đổi. Tiền/kho: BE chỉ thêm projection đọc, không đổi ledger. Cart FE hiện kiểu lỏng, không vỡ khi thêm `lineTotal`.
- Chưa review được tiền/kho/session phía FE vì chưa có checkpoint.

## Cập nhật coordinator (Claude Windows) — API READY mới
- **Admin tìm đơn theo mã ORD đã READY_FOR_FE_INTEGRATION** (API_ACCEPTED local HTTP/PG): `GET /admin/fulfilment/orders?orderNumber=<ORD-… hoặc ≥ 8 hex đầu>`. Response `{items}` cùng projection với queue, nên `snapshot()` hiện có dùng được. Input sai → 400 `VALIDATION_ERROR`, không có kết quả → `items: []`. Chi tiết: `2026-10-31-BE-UX-contract.md` Checkpoint 3.
- Nhắc lại hai điểm đang chặn ghép BE-UX-01: validator `exact()` trong `services/orderResponse.ts`, và `options: string[] | null` trong `types/order.ts`.
- **Địa chỉ/địa giới (BE-UX-03) READY_FOR_FE_INTEGRATION, nhưng chưa có dữ liệu thật:** API `GET /locations/provinces` hiện trả **503 `LOCATION_CATALOG_NOT_LOADED`** → FE giữ ô text, không chặn mua. Khi có danh mục: bộ chọn Tỉnh → Phường/Xã, gửi `provinceCode` + `wardCode`, không gửi huyện. Hiển thị `divisionStatus` (`OUTDATED`/`LEGACY_FREE_TEXT` → nhắc cập nhật, vẫn cho checkout).
- **Số điện thoại người nhận đổi quy tắc:** di động VN `0[35789]xxxxxxxx` hoặc `+84…`. FE cần sửa validation/thông báo (hiện còn 8–15 số), nếu không người dùng sẽ gặp 400 từ BE. Chi tiết: BE-UX-contract Checkpoint 4.
- **Đổi mật khẩu qua email (BE-UX-04): BE xong nhưng ĐANG TẮT, chờ review thiết kế.** Chưa nối như đã chạy. Khi bật: màn Bảo mật → nhập mật khẩu hiện tại + đồng ý → lưu `bindingSecret` vào sessionStorage → trang `/account/change-password#token=` đọc fragment, xóa khỏi URL → `verify` → form mật khẩu mới → `confirm` → đăng xuất / đăng nhập lại. Xử lý các mã: `EMAIL_NOT_VERIFIED`, `CURRENT_PASSWORD_INVALID` (gợi ý Quên mật khẩu cho tài khoản Google), `PASSWORD_CHANGE_OTHER_BROWSER`, `EMAIL_TOKEN_INVALID`, `PASSWORD_CHANGE_RATE_LIMITED`, `AUTH_EMAIL_CONFIRM_UNCERTAIN` (không tự gửi lại). Chi tiết: BE-UX-contract Checkpoint 5.
