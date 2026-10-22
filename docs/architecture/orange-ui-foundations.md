# Bộ giao diện cam–trắng thống nhất — 16/10/2026

Trạng thái: IN_PROGRESS trên `codex/auth-header-theme-fix`, chưa merge.
Đã đồng bộ develop `035656b` có #56/#57; bản ghép UI commit `4bf24cf`.
Nguồn thiết kế: bộ mẫu `deliverables/ui-orange-v1` trên máy Hoàng, các màn
00-foundations, 16-login, 04-checkout, 05-orders, 06-order-detail.

## Quy ước dùng chung

`FE/src/styles/marketplace.css` là điểm khai báo token (giá trị thiết kế dùng chung):

| Thành phần | Giá trị |
|---|---|
| Màu chính | `--market-brand: #D63B0B` |
| Nền nhấn / nền trang | `#FFF2EC` / `#F6F7F8` |
| Chữ chính / phụ | `#20242B` / `#69717C` |
| Viền / bề mặt | `#E3E6E9` / trắng |
| Font | Inter 400/500/600/700, tải cục bộ từ gói Fontsource; có tiếng Việt |
| Khoảng cách | 8 / 16 / 24 / 32 px |
| Bo góc / mục tiêu bấm | 6 px / tối thiểu 44 px |

`market-button`, `market-card` là lớp trình bày dùng chung; AuthLayout là khung
Login/Register. CSS module của Header, Checkout và Order dùng các token này.
PublicLayout ánh xạ biến CSS cũ sang bộ mới để không xuất hiện chữ trắng trên
nền sáng khi hệ điều hành dùng dark preference. Đây là storefront sáng cố định,
không phải đã hoàn thiện một theme tối riêng. Không thay CSS nghiệp vụ Address/Cart
do Hiền sở hữu trong đợt này.

## Thứ tự áp dụng và ranh giới

1. Header/Login/Register: cam thay xanh, Inter thật, thanh tìm kiếm và form 48 px,
   khung giới thiệu hai cột; mobile chuyển một cột. Icon tìm kiếm dùng Heroicons.
2. Checkout: cột địa chỉ/Store bên trái, xác nhận COD bên phải; mobile xếp dọc.
   Giữ nguyên selection, preview, payload, điều kiện disabled và mã yêu cầu.
3. Order: panel list/detail đã merge trong #55 dùng card, status và tổng tiền
   đồng bộ. Không đổi orderPolicy, hook đọc đơn, quyền hoặc command handler.
   #57 đã merge; giữ đủ route Buyer/Seller và link Account/Seller/Checkout.

Không thêm Google/reset-password, payment sandbox, chat hoặc ảnh sản phẩm giả
chỉ vì xuất hiện trong mock. Ảnh ABO của DRAFT không được tự lấy từ uploads làm
ảnh bán công khai. Order list API chỉ có summary, không bịa item/ảnh hoặc query
detail từng đơn để mô phỏng dữ liệu không có trong contract.

## Bằng chứng và việc còn lại

**Follow-up sau review c444a95:** Login có artwork tĩnh sinh riêng (không catalog),
Buyer list có sidebar theo session và route thật; detail tách các vùng snapshot,
history thật nằm trên address/payment. Không đổi API/hook/policy hoặc bật POST.
362 FE PASS/6liveSKIP; Auth Chrome4/4 + Order Chrome5/5 chạy lại trên QA riêng.
Đối chiếu trực quan scoped PASS, không clone1:1/không nghiệm thu transaction;
các số và khoảng trống bên dưới là baseline trước follow-up.
Xem [báo cáo đợt mới](../testing/pr59-visual-followup-2026-10-16.md) và
[nguồn ảnh trang trí](auth-artwork-provenance.md).

- Sau sync: 359 FE tests PASS, 6 live tests SKIP trong lần Vitest thông thường.
- Lint và TypeScript/Vite build PASS.
- Chrome thật, Nest HTTP và PostgreSQL QA riêng: Auth 4/4, Checkout 4/4 nhóm PASS
  ở 1440×1080 và 390×844, light/dark preference. Bao gồm lỗi giá/kho và replay
  sau mất response; không chạm DB demo.
- Order runtime Chrome API thật: 5/5 nhóm PASS, 27 ảnh; 6/6 HTTP/PostgreSQL chạy
  riêng PASS. Kiểm Inter/heading dark đúng20242B, card trắng, không tràn ngang,
  list20/cursor/filter, snapshot/detail, error/retry, account switch/404. Không POST
  xử lý Order từ màn đọc; DB baseline được chọn giữ nguyên.
- Ảnh, JSON kết quả và cặp đối chiếu: `deliverables/orange-ui-alignment-2026-10-16`
  tại root máy Hoàng, không commit ảnh QA/dữ liệu tài khoản.
- Ảnh/JSON Order mới: `deliverables/orange-order-runtime-2026-10-16/browser`.
- `design-qa.md` vẫn blocked: thiếu ảnh minh họa Login và một số bố cục mẫu chưa
  khớp; không nhận là clone 1:1. List API thiếu item/image nên không bịa dữ liệu.
- Bước command Seller còn chờ gate #58; việc theme/read PASS không bật quyền POST.

Backend, schema, migration, contract API, Auth/session, transaction và các luật
idempotency (gửi lại cùng mã mà không tạo giao dịch thứ hai) không đổi.
