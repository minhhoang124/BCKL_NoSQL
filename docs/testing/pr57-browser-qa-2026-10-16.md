# PR #57 — kiểm thử Chrome thật, 16/10/2026

Source FE/BE `e0e9d224b5d3eb31877c63df2c3aa973278c2fd0`; branch
`codex/order-web-read-runtime`. Lượt đạt: `run3`. Không sửa mã ứng dụng trong
đợt này; thêm harness tái lập và tài liệu. #57 vẫn Draft chờ review.

## Phạm vi / phương pháp

Browser tích hợp lỗi khởi tạo; người dùng cho phép Chrome riêng qua Playwright.
Chrome headless thật → Vite FE5187 → Nest HTTP loopback cổng ngẫu nhiên →
PostgreSQL QA `127.0.0.1:5549/bckl_checkout_web_20261012`. Không DB demo5432,
không inject AuthContext/token/storage; đăng nhập/đăng xuất bằng UI và cookie thật.

Seller/Store/catalog bootstrap trực tiếp DB QA có nhãn. Hai Buyer đăng ký qua API;
**22 Order được tạo bằng Cart → Checkout API thật** (Buyer A 21, B 1), không seed
Order giả để kiểm pagination. Riêng process QA tăng quota intent Checkout 5→100
để dựng fixture; không đổi mã/config mặc định. Workers Search/D07 tắt.
Store chỉ tạm khóa fixture của lượt chạy và khôi phục trong finally.

## Kết quả 5 nhóm — PASS

| Bước | Cấu hình / sức khỏe | Luồng được quan sát |
|---|---|---|
| 1 | Desktop light 1440×1080 — PASS | Account entry → list20 → cursor trang2 còn1 → filter COMPLETED rỗng/reset cursor → Buyer snapshot/detail → Seller detail, command disabled |
| 2 | Desktop dark 1440×1080 — PASS trong Order | Cùng luồng; nền/chữ Order theo theme, không pageerror; Header có contrast risk riêng bên dưới |
| 3 | Mobile light 390×844 — PASS | Mã Order/SKU dài xuống dòng, list/detail đọc được; không tràn ngang; nút/tab focus có outline |
| 4 | Mobile dark 390×844 — PASS trong Order | Cùng luồng; Seller active đọc đơn khi Store SUSPENDED; không POST Order |
| 5 | Mạng và đổi tài khoản — PASS | GET list/detail bị abort có error/retry, không empty giả/PII cũ; retry API thật phục hồi. Giữ response GET A sau fetch thật, logout/login B rồi release: không lộ đơn/địa chỉ A. B mở đơn A nhận thông báo 404 chung. Logout và truy cập trực tiếp đưa về Login |

Đo DOM: documentWidth=viewport 1440 hoặc390 ở cả4 cấu hình, panelWidth bằng
clientWidth (desktop1092, mobile302). Heading light rgb(8,6,13)/white;
dark rgb(243,244,246)/rgb(22,23,29). Đây không phải audit WCAG định lượng.
Mỗi cấu hình chính không pageerror, không request ghi vào Order endpoint.
So sánh baseline trước/sau toàn bộ lượt: Order status/updatedAt/total, số history,
OrderCommand, stock movements, SearchOutbox và Variant.stock **không đổi**.
Không tuyên bố mọi cột DB zero-write: login/logout tạo/xóa session hợp lệ.

27 ảnh, JSON kết quả và gallery HTML giữ local:
`C:/VoMinhHoang/KLCN_2026/deliverables/pr57-browser-qa-2026-10-16/run3/`.
Đã mở ảnh saved để kiểm detail desktop/mobile/light/dark, pagination, empty,
network/loading/recovery, account B/404 và guest redirect. Gallery giữ thứ tự
các bước capture; không dùng ảnh run1/run2 thay bằng chứng lượt cuối.
Ảnh chứa fixture email/address tổng hợp, không credentials/token/cookie; không
đưa nguyên output QA vào Git. Reviewer chạy script để tái tạo trên máy riêng.

## Phát hiện UX / khả năng tiếp cận

Không thấy blocker mới ở phạm vi Order read đã kiểm. Các điểm cần cải thiện:

1. **P2 ngoài diff #57 — Header search dark:** ô input tối nhưng chữ placeholder
   xám khó đọc trên Header nền trắng. Thấy ở `mobile-dark-04-buyer-detail.png`
   và `desktop-dark-04-buyer-detail.png`. Cần CSS theo theme cho Header riêng.
2. **P2 ngoài diff #57 — Login dark:** card trắng nhưng heading gần trắng,
   label nhạt và input tối; thấy `session-04-guest-redirect.png`. Luồng vẫn login
   được, nhưng ảnh chứng minh rủi ro đọc nhãn/tiêu đề. Cần task CSS Auth riêng,
   không sửa logic Auth hoặc mặc nhiên coi khả năng tiếp cận đã đạt.
3. Mã Order dạng UUID dài làm h1 mobile xuống3dòng; không mất dữ liệu/tràn
   ngang, nhưng có thể thêm copy-code/hiển thị mã ngắn trong task polish sau.

## Giới hạn / lịch sử lượt chạy

- run1 dừng vì locator exact label không khớp Chromium; sửa harness dùng
  combobox name regex. Không phải lỗi API/UI và không tính full PASS.
- run2 đạt4layout nhưng dừng vì helper login mặc định phải về `/`; ứng dụng có
  thể khôi phục protected route. Sửa helper chờ rời Login và có nút logout.
- run3 script exit0, **5/5 nhóm PASS**; node --check/diff-check PASS.
  Có pg deprecation warning về concurrent client.query, không nhận warning-free.
- Viewport mobile là giả lập, không thiết bị cảm ứng thật. Chưa screen reader,
  zoom200%, toàn bộ keyboard journey, Safari/Firefox, timeout/hỏng200 ở browser,
  mọi cách đổi phiên/tab hoặc callback401 cũ. Chỉ GET network abort/delayed success
  được inject; không suy rộng thành đã kiểm mọi lỗi mạng.
- Chưa kiểm POST xử lý đơn, recovery #56, delivery/complete Web hoặc Search thật;
  không nâng G-FULFILMENT thành DONE. Các giới hạn Backend/AI cũ giữ nguyên.
- Fixture cả các lượt không đạt được giữ riêng marker để đối chiếu, không cleanup
  tự động. Server/Vite/Chrome do harness tạo đều đóng trong finally.

## Tái lập

Build BE từ cùng checkout, set DATABASE_URL đúng QA5549 và JWT QA riêng,
QA_HEAD=git rev-parse HEAD. Chạy `scripts/test-order-read-browser.mjs` bằng Node
với `--playwright-module <đường dẫn playwright/index.mjs>` và `--output <thư mục mới>`.
Không cài browser vào profile cá nhân hoặc dùng DB demo. Không ghi secrets vào
command log/PR. Bản script không tải schema/code từ remote khi test.

Reviewer cần rà head bổ sung harness/docs; mã FE/BE giữ nguyên e0e9d22.
Không tự chuyển Ready hoặc merge. Sửa contrast Header/Auth qua task riêng.
