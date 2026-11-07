# Address → Cart → Checkout COD — 12/10/2026

IN_PROGRESS trên `codex/checkout-web-integration`. Nền develop dc52d92
(Address #49/Auth #52), tích hợp cục bộ Cart #50 head 6e9ca07 và client #53
08ddc1e. Hai PR đó chưa merge khi bắt đầu; đây không phải trạng thái develop.
Không tự merge vào develop, không ghi đè WIP `order-command-readiness`.

## Phạm vi và luồng

1. Buyer quản lý `/account/addresses`; Cart `/cart` chọn tập Variant.
2. Link `/checkout?variantId=...&variantId=...` chỉ mang ID; không mang giá,
   số lượng, địa chỉ hoặc key. Checkout đọc lại giỏ/địa chỉ từ Backend.
3. Thiếu mã, mã trùng, quá 50 mã, món không còn mua được: chặn đặt, không
   tự mua cả giỏ hoặc phần còn hợp lệ. Đi trực tiếp Checkout không tự chọn món.
4. Buyer chọn địa chỉ; POST `/checkout/preview` kiểm lại giá/kho, không giữ kho.
5. Xác nhận COD: lưu body/key cố định trong sessionStorage theo Buyer của tab
   trước POST `/checkouts`. Không lưu token/tên/số điện thoại/địa chỉ vào intent.
6. Lỗi kết nối/5xx/lookup 404 vẫn giữ intent; tra biên nhận hoặc gửi lại đúng
   key/body. Không có polling/retry nghiệp vụ tự động vô hạn. Chỉ lỗi nghiệp vụ
   có mã xác định không commit mới giải phóng intent; UI phải preview lại.
7. Thành công: kiểm biên nhận COD/PENDING_CONFIRMATION/UNPAID, Decimal string,
   payment amount và Store/order ID; xóa đúng intent, hiển thị biên nhận gốc.
   Chưa nối `/orders/:id` vì #42 còn mở; không tạo link chết tới API chưa merge.

Đợt này trích riêng Checkout và helper/test từ WIP của Hoàng. Không đưa command
Seller/Admin hoặc Order detail UI vào; không đổi Backend/schema/migration,
không sửa code Address/Cart của Hiền. Router thêm USER guard cho `/checkout`.
CSS cam chỉ trong module riêng.

## Bằng chứng chạy thực tế

- Migration 12/12 hiện có: deploy PASS vào PostgreSQL 17 riêng.
- Backend build: PASS.
- FE lint/build: PASS.
- Full FE: 145 PASS; 4 live cases SKIPPED mặc định, không gọi DB trong unit CI.
- E2E Backend Address/Cart/Checkout create/read: 133/133 PASS, 4 suite.
- Live React + HTTP + PostgreSQL: **4/4 PASS** trên bộ cuối, gồm ca bỏ chọn
  dòng còn lại trong Cart (Cart có thể chọn sẵn món mua được; Checkout chỉ nhận
  tập ID đã xác nhận khi bấm tiếp tục). Lần chạy cuối 8,26 giây.

Harness `FE/src/features/order-flow/CheckoutLive.test.jsx` dựng Nest từ `BE/dist`,
listen loopback port ngẫu nhiên; client gọi HTTP thật, không mock API/Prisma.
React dùng jsdom và AuthContext với User/token từ register thật, không phải
kiểm trình duyệt, login form/cookie-refresh hoặc responsive bằng mắt.
Catalog là fixture trực tiếp DB, ảnh URL fixture, không chứng minh Seller upload.

| Ca live | Điều kiểm chứng |
|---|---|
| Address UI → Cart UI → Checkout | Lưu địa chỉ qua API thật, nhóm/chọn Cart, preview và COD; Order snapshot đúng, kho trừ 2, movement/outbox đúng một lần, dòng không chọn giữ nguyên |
| Mất response sau commit | fetch thật tới Backend, sau HTTP 201 cố tình làm mất phản hồi; nút replay dùng cùng body/key, chỉ một Order/movement/outbox |
| Giá đổi sau preview | Update fixture DB rồi submit: không Order/Checkout/movement/outbox; giỏ còn nguyên |
| Kho giảm sau preview | Update fixture DB rồi submit: từ chối, không commit một phần; giỏ còn nguyên |

E2E Backend bổ sung bằng chứng replay, request đồng thời, hai app instance,
rollback nhiều Store và ownership; không suy ra coverage trình duyệt từ đó.
Có cảnh báo pg deprecation về query đồng thời và log lỗi dự kiến từ fault
injection của E2E; không nâng dependency hoặc sửa ngoài scope ở đợt này.

## Chạy lại trên database riêng (PowerShell)

Từ checkout tích hợp, Docker Desktop đã bật; nếu container đã tồn tại thì
kiểm tra đúng tên/port/database trước, không xóa container hoặc volume để thử lại.

```powershell
docker run -d --name bckl-checkout-web-qa-20261012 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=checkout_qa_local_only -e POSTGRES_DB=bckl_checkout_web_20261012 -p 127.0.0.1:5549:5432 postgres:17-alpine
$env:DATABASE_URL='postgresql://postgres:checkout_qa_local_only@127.0.0.1:5549/bckl_checkout_web_20261012?schema=public'
$env:JWT_ACCESS_SECRET='checkout-qa-access-only-20261012-not-production'
$env:JWT_REFRESH_SECRET='checkout-qa-refresh-only-20261012-not-production'
pnpm install --frozen-lockfile
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE build
$env:CHECKOUT_LIVE_QA='true'
pnpm --dir FE test src/features/order-flow/CheckoutLive.test.jsx
Remove-Item Env:CHECKOUT_LIVE_QA
pnpm --dir BE test:e2e test/address.e2e-spec.ts test/cart.e2e-spec.ts test/checkout-create.e2e-spec.ts test/checkout-read.e2e-spec.ts
```

Mật khẩu/key trên chỉ là cấu hình QA không production. Harness từ chối database
khác chính xác host/port/name trên, giữ DB test để đối chiếu, không tự xóa dữ liệu.
Mỗi lần chạy dùng marker riêng; fixture cũ có thể được giữ trong DB QA.

## Chưa nghiệm thu

- Browser desktop/mobile, reload tab/cookie thực, usability/accessibility bằng mắt.
- CI live PostgreSQL xuyên FE–BE chưa nối vào workflow chung.
- Giao diện login thật và đầu vào Product → thêm giỏ; bài này seed Cart qua API.
- Lookup/replay vẫn thủ công sau lỗi; không tuyên bố có bộ tự recovery 3 lượt.
- Toàn bộ Order tracking/Seller/delivery/cancel/complete UI chưa nằm trong PR này.
- Outbox có trong DB nhưng không dispatch tới FastAPI/Elasticsearch/FAISS ở harness.
- PR phụ thuộc #50/#53 phải được review/merge và chạy lại trên develop trước
  báo G-CHECKOUT DONE; browser QA vẫn còn yêu cầu riêng.

Thuật ngữ: intent = ý định mua với mã/body cố định; replay = gửi lại cùng yêu cầu
để nhận biên nhận gốc; snapshot = thông tin được lưu lúc tạo đơn; outbox = công
việc đồng bộ Search ghi cùng giao dịch; jsdom = DOM giả lập cho kiểm thử React.
