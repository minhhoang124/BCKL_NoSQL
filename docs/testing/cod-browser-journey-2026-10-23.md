# COD xuyên suốt sau Buyer/Seller Web — 23/10/2026

## Gate sau merge #97

Đã nhận develop `dc47ea7e2cb4a4c5ace077f4876d1069b3a88ef5` vào source kiểm
`6feeaf3932bb8d048f22ab6cb0ea374145c3b7e2`; conflict chỉ architecture và giữ cả
health + COD. BE/FE/Prisma/AI production khớp develop; driver vẫn nguyên hash.
Chạy lại Chrome **4/4 PASS**, marker `browserqa-daf1dd4d-58d6-44b8`,21PNG tại
`artifacts/cod-journey-browser-20261023/r1792767091507/`. Không cộng các lượt
trước thành ca mới. Health hồi quy trên cùng checkout **46/46 PASS/5files**,
canonical generator check PASS; syntax/diff-check PASS. Đã generate/build BE
trước sync; BE source nguyên byte sau sync nên không nhận build vừa chạy lại.
Không chạy lại toàn bộ BE/FE suite trong lượt ghép97 này; full FE1258 của97
là bằng chứng nền trước với FE source nguyên byte, không đếm thành lượt mới.

## Kiểm lại trên nền #106

Source đã chạy: `e2f8312d80072e480ff9d50ffcbfefe3e097e077`, nền develop
`df5d136c9edcd5ce62186ff531b5b519e6d53baf`. Runtime BE/FE/schema nguyên byte
develop; driver nguyên SHA256 `ea5d94e74d848b86f719deebba3e55af8bb4a2a0e7e2662e337568195abcf437`.
Không nhận approval head cũ thành approval của bản ghép mới.

- QA v924 được nâng17→19migration bằng migrate deploy, không reset/drop.
  Prisma generate, Backend build/lint/typecheck đạt. Các đoạn17migration bên dưới là lịch sử.
- Chrome mới **4/4 nhóm PASS**, marker `browserqa-b409855d-d6d8-49e8`;
  `artifacts/cod-journey-browser-20261023/r1792765813596/`: results.json,
  report.html và21PNG. Đã xem ảnh desktop hoàn tất; không có pageerror/tràn ngang.
- Kịch bản/oracle giữ nguyên bảng dưới: đặt COD thật, Seller3bước, giao mô phỏng
  qua Admin HTTP, Buyer hoàn tất; mất response sau Checkout201 rồi reload/replay
  đúng key/body và hủy hoàn kho; giá/kho đổi không sinh Order/movement/outbox.
- Không mock giao dịch thành công, không sửa Order trực tiếp; các dữ liệu
  catalog/setup có nhãn QA. Chỉ đếm outbox, không chạy Search dispatcher/index.
- Gemini Argon Medium đọc độc lập driver + báo cáo cũ trên đúng `e2f8312`:
  NO FINDING cụ thể về false-positive/destructive test risk; static-only, không
  chạy test hoặc gọi đó là approval của Hiền. Không cộng review vào số ca Chrome.

Các kết quả cũ dưới đây giữ làm lịch sử, không cộng dồn số ca giữa các lượt.
Local PASS không phải CI xanh; không nhận toàn marketplace/G-FULFILMENT xong.

## Phạm vi và bản chạy

Nền chính thức `develop 06eb4fd072c409a173ee2b239ef9c8c364bade9e` sau #100.
PR chỉ mở rộng driver kiểm thử, không sửa FE/BE runtime, Auth, schema hay quota.
Chrome thật → Nest HTTP thật → PostgreSQL17 QA riêng, loopback5549,
DB `bckl_order_resolution_test_cod_journey_20261023_v924`.
17 migration mới, Prisma generate/Nest build PASS; demo `bckl_postgres` dừng.
Không đọc dotenv; từ chối root/BE/FE dotenv, Vite envDir=false, tắt workers.
Không có thông tin đăng nhập hoặc URL chứa mật khẩu trong báo cáo/artifact public.

Driver `scripts/test-checkout-browser.mjs` xóa override bật Buyer/Seller để kiểm
mặc định production. Catalog/actors là fixture có nhãn; hai dòng Cart ban đầu
được thêm bằng HTTP thật. Address tạo trên Web, chọn dòng Cart, preview và đặt
COD đều trên Web. Không giả receipt hoặc sửa trạng thái Order trực tiếp.

## Kết quả thực tế

Lượt cuối **4/4 nhóm PASS, exit0**, marker `browserqa-1ba85149-6320-4d11`.
JSON có checkoutHead và SHA256 driver
`ea5d94e74d848b86f719deebba3e55af8bb4a2a0e7e2662e337568195abcf437`.
Lượt trước cũng 4PASS nhưng chưa có provenance/theme assertion; không cộng hai
lượt thành8case mới. Không sửa source trong lúc browser chạy.

| Nhóm | Luồng và đối chiếu PostgreSQL |
| --- | --- |
| Desktop1440/light | Address → Cart chọn1Variant → Checkout → Seller xác nhận/đóng gói/sẵn sàng giao qua Web, mỗi bước consent riêng và doubleclick → Admin ship/mark-delivered HTTP → Buyer hoàn tất Web. COMPLETED/PAID,6command/7history/0resolution, kho5→3,1movement/1outbox; version không tăng thêm sau Checkout. |
| Desktop1440/dark preference | Làm mất response sau Checkout201 thật → reload → replay cùng key/body, chỉ1Order. Buyer hủy Web với lý do/consent và doubleclick: CANCELLED,1command/2history/0resolution, kho3→5,2movement/2outbox tổng cộng, version tăng đúng1 so sau Checkout. |
| Mobile390/light | Đổi giá giữa preview và đặt: từ chối,0Order/0movement/0outbox, Cart còn nguyên; khôi phục fixture giá rồi preview/đặt thành công. |
| Mobile390/dark preference | Thiếu kho giữa preview và đặt: cùng zero-mutation oracle; khôi phục fixture rồi đặt. Thêm giỏ rỗng, giữ GET để thấy loading, lỗi mạng GET rồi tải lại thành công. |

Trong mọi nhóm, Variant thứ hai cùng Product không được chọn vẫn kho5 và còn
đúng1dòng Cart; tiền snapshot20.000đ/1OrderItem, địa chỉ snapshot khớp. Không có
pageerror, không tràn ngang. Có **21PNG** trong manifest. Đã xem ảnh hoàn tất,
hủy và thiếu kho mobile. Tên dark là `prefers-color-scheme: dark` được assert
trực tiếp: surface cam có chủ ý giữ nền sáng, không nhận đã có theme tối riêng.

## Cách chạy lại và giới hạn

- Dùng checkout của PR, provision DB **đúng tên/cổng trên** bằng migrator QA
  được phép; không copy `.env` demo. Không reset/drop DB cũ; driver tạo marker mới.
- Build BE/Prisma trước, inject DATABASE_URL/JWT secrets QA từ local private
  configuration, không đặt secret trong command history hoặc repo. Run từ root:
  `node scripts/test-checkout-browser.mjs --playwright-module <absolute Playwright index.js> --channel chrome --output <ignored artifact directory>`.
- Driver từ chối target khác, yêu cầu explicit JWT; launcher local đã kiểm
  container/demo stopped và redacts output. Bản ghi chạy ở
  `artifacts/cod-journey-browser-20261023/run1/{results.json,report.html}` trên máy
  Hoàng, không phải endpoint được chia sẻ cho thành viên khác.
- Delivery là **API Admin mô phỏng**, chưa Admin delivery UI/carrier thật.
  SearchOutbox chỉ kiểm số hàng; workers tắt, **không chứng minh ES/FAISS nhận**.
  Không kiểm notifications, Chat, Seller hủy/nhận hàng hoàn hoặc toàn marketplace.
- Bấm hai lần trong lượt này không thay stress race giữa các actor; giữ bằng
  chứng race #98 riêng. 409/409 lịch sử vẫn chưa đủ trace để kết luận root cause.
- Chrome desktop/mobile emulation, không iOS/Safari/Firefox/thiết bị thật.
  DeprecationWarning pg concurrent client.query có sẵn được ghi nhận, exit0;
  không diễn giải warning là lỗi transaction mới hoặc đã được sửa.
- Lượt chuẩn bị từng thiếu formatter trong checkout (`prettier` không có),
  không phải lỗi ứng dụng; node syntax/diff-check đạt. Không dùng lượt lệnh
  formatter lỗi làm bằng chứng format PASS.

Đây là bằng chứng một luồng COD thật có giới hạn, không đánh dấu toàn bộ
G-FULFILMENT hoặc khóa luận đã hoàn thành.
