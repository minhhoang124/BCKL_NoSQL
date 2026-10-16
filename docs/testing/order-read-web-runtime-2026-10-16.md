# Order Web chỉ đọc — 16/10/2026

**Bổ sung browser cùng source e0e9d22:** Chrome QA đã chạy 5/5 nhóm trên desktop/
mobile, sáng/tối và lỗi mạng/đổi account; 27 ảnh và baseline DB. Xem
[bằng chứng và giới hạn](pr57-browser-qa-2026-10-16.md). Các dòng NOT_RUN browser
bên dưới là lịch sử lượt jsdom trước đó, không thay bằng chứng mới. Chưa POST
Order runtime hoặc toàn G-FULFILMENT; contrast Header/Login có vấn đề ngoài diff.

Branch `codex/order-web-read-runtime`, base develop `09daae0` (#55 đã merge).
Không lấy #56 chưa merge; không sửa Backend/schema/contract AI/Auth client.
Hoàng triển khai, Hiền review. IN_PROGRESS, không nghiệm thu toàn G-FULFILMENT.

## Người dùng xem ở đâu / luồng dữ liệu

| Điểm vào | API |
|---|---|
| Account → Đơn mua → `/account/orders` | GET `/orders` |
| Chi tiết → `/account/orders/:orderId` | GET `/orders/:orderId` |
| Seller dashboard → `/seller/orders` | GET `/seller/orders` |
| Chi tiết Seller → `/seller/orders/:orderId` | GET `/seller/orders/:orderId` |
| Biên nhận Checkout → Theo dõi từng đơn | Link detail Buyer bằng ID đã validate |

Route cụ thể giữ trước `/seller/*`, không thay dashboard; giữ Address/Cart,
Checkout và Admin. USER/SELLER active mới mount luồng đọc. Link receipt không
thay tracking: detail GET hiển thị trạng thái hiện hành, item/địa chỉ từ snapshot.

`OrderReadPage` → `useOrderList/useOrderDetail` đã merge #55 → `orderApi`
→ shared fetchApi → Backend JWT/ownership → PostgreSQL → runtime validator
→ panel. Snapshot là dữ liệu lúc mua; không đọc catalog hiện hành thay lịch sử.

## Phân trang / lỗi / phiên

- Mỗi trang tối đa 20 summary, ID giảm dần; nextCursor đưa vào afterId.
  Đây là **thay trang**, không append/tải thêm tích lũy; có Trang đầu và Back
  của trình duyệt. Đổi filter bỏ cursor. Refresh/retry giữ đúng trang hiện tại.
- Chỉ URL status enum và afterId PG Int dương, không trùng query; ID sai và
  trường query ngoài phạm vi chặn trước HTTP. Không nhận storeId từ client.
- Loading/empty/error riêng; lỗi trang sau không tự quay về trang đầu hay báo
  hết đơn. Không giữ detail cũ khi route/actor/phiên đổi. GET có AbortSignal,
  deadline và no-store từ client #55; không polling/retry tự động vô hạn.
- Parent remount theo actor ID, session generation (thế hệ phiên), scope,
  orderId và URL; hook còn kiểm generation/abort trước setState. Logout/login
  cùng ID vẫn là phiên mới, không hiển thị lại snapshot phiên cũ.
- 404 chung: không tìm thấy hoặc không có quyền; response 200 sai cấu trúc bị
  từ chối trước render. Payment null không tự gán COD. 429 có thông báo chờ và
  retry thủ công; chưa có countdown từ Retry-After ở UI.
- Không truyền onAction cho detail panel: mọi nút command disabled. Không gọi
  POST confirm/packing/ready/cancel/returned/complete, không import #56 hoặc
  tự coi GET là receipt để giải phóng pending command.

## Kiểm chứng trên source cuối

| Kiểm tra | Kết quả |
|---|---|
| Frozen install offline / lockfile | PASS, không đổi lockfile |
| Full FE Vitest | 295 PASS, 6 opt-in live SKIP; 23 files PASS, 1 SKIP |
| FE lint | PASS |
| FE build (tsc -b + Vite) | PASS |
| Backend build cho live harness | PASS |
| QA migrate deploy | 13 migrations, không pending |
| Live suite chạy riêng | 6/6 PASS, 10.45 giây tổng / 8.38 giây test |
| git diff --check | PASS |
| Browser desktop/mobile/theme/keyboard | NOT_RUN |
| Full Backend unit/E2E, Ruff/Pytest local | NOT_RUN, không sửa source BE/AI |

21 ca route mới ở `OrderReadPages.test.tsx` dùng MemoryRouter + AuthContext thật,
GET adapter/validator thật, mock fetchApi boundary. Chứng minh list/detail cả hai
scope, filter/cursor/reset/retry, malformed200, ID/query sai, 404, đổi route/actor
và cùng actor phiên mới, role/inactive/guest, Account entry, mọi request chỉ GET.
Không nhận mock là integration HTTP hoặc PostgreSQL.

Live harness `CheckoutLive.test.jsx` dùng React jsdom, Nest HTTP loopback thật,
PostgreSQL QA riêng `127.0.0.1:5549/bckl_checkout_web_20261012`, không mock thành
công HTTP và không đụng demo5432. Giữ 4 ca Checkout cũ (selected Cart, mất response,
đổi giá/thiếu kho), mở rộng ca đầu click receipt → Buyer detail và Seller list/detail
với JWT Seller thật khi Store SUSPENDED. Hai ca mới Buyer/Seller ngoài ownership
bị từ chối qua UI. Đối chiếu Order/Payment/stock/cart/movement/outbox, không thêm
OrderCommand qua luồng đọc. Seller fixture bootstrap DB có nhãn; giao dịch mua
được tạo qua API/Checkout UI, không seed Order để giả luồng mua.

Workers Search/reconciliation/image-repair/D07 tắt trong process kiểm thử; không
nhận index đã cập nhật hoặc tự hoàn tất từ suite này. DB/fixture QA giữ lại để đối
chiếu, không cleanup demo. Lần migrate đầu lỗi khi container vừa khởi động; kiểm
pg_isready và retry sau khi sẵn sàng đạt. Có cảnh báo pg về concurrent client.query
trong harness, test vẫn đạt; chưa đổi thư viện hoặc nhận warning-free runtime.

## Chạy lại

1. Checkout đúng branch, frozen install; dùng riêng container QA5549.
2. Cấu hình DATABASE_URL vào đúng DB nêu trên, JWT QA riêng; không dán secrets
   vào PR/log. Không dùng DB manual QA này cho suite Backend có reset hook.
3. Migrate deploy, Backend build; tắt ORDER_AUTO_COMPLETE_ENABLED.
4. FE test/lint/build; chạy riêng live bằng CHECKOUT_LIVE_QA=true và
   `pnpm --dir FE test src/features/order-flow/CheckoutLive.test.jsx`.

## Tiếp theo

Reviewer kiểm route/read/privacy, browser desktop/mobile và lỗi tải với API QA.
Sau #56 merge, bổ sung HTTP adapter/coordinator và UX unknown outcome trong PR
riêng trước bật nút; cancel/returned có body riêng không ghép journal body-rỗng.
Luồng giao/hoàn tất/Chat/Notification/Review vẫn cần UI và kiểm thử riêng.
