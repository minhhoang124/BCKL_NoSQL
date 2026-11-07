# Web Review — bằng chứng 26/10/2026

Base `develop 6ca8bcd4fd7a23c465e72ab273b1508393cf9b02` (#124 Backend đã
merge, 6/6 CI). Nhánh `codex/product-review-web`. Trạng thái tích hợp phải đọc
PR/commit hiện tại; dữ liệu/bằng chứng dưới đây thuộc nhánh QA, không tự bật demo.

## Luồng đã kiểm

- Buyer từ từng dòng hàng của đơn COMPLETED vào `/account/reviews?itemId=...`,
  tạo/sửa điểm1–5 và nội dung trong window do server quyết định. Checkbox xác
  nhận gắn phiên bản draft, latch đồng bộ chặn bấm đôi trong cùng tick.
- Trang Product đọc aggregate/histogram/page từ API công khai; author cố định,
  không Order/Item/User/contact/reason. Nội dung render dạng text, không HTML.
- Seller `/seller/reviews` trả lời một lần, giữ điểm khách; Admin `/admin/reviews`
  ẩn với lý do/audit riêng Admin. Buyer sửa hidden vẫn hidden, không tự hiện lại.
- Journal `product-review-pending:v1:<actorId>` chỉ UUID/hash/scope/item và kỳ
  vọng biên nhận, không nội dung/reason/token. Một slot chung Buyer–Seller/actor.
  Immutable snapshot trước SHA256, epoch+raw CAS; receipt đúng mới xóa đúng mã.
- Mất phản hồi không replay POST; cần đồng ý đối chiếu. Reconcile trả biên nhận
  hoặc đóng mã chưa chạy, không viết hộ. GET lỗi sau biên nhận chỉ tải lại GET.
  Đổi tài khoản không hiển thị draft/mã người trước, mã cũ vẫn giữ để phục hồi.

## Kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Journal/hash/parser/receipt | 26 PASS |
| Buyer/Seller/Admin component | 12 PASS |
| Public component stale Product/XSS/read failure | 3 PASS |
| Product detail bootstrap và hồi quy cũ | 5 PASS |
| Focused tổng | **46 PASS** |
| Full FE trên source cuối | **1536 PASS / 6 live SKIP**, 89 files PASS/1 SKIP, 207.62s |
| Lint/build | PASS; lint 0 lỗi, 6 cảnh báo nền và 2 cleanup-ref; bundle >500kB là cảnh báo |
| Chrome thật + Nest + PostgreSQL | **12 nhóm PASS**, 8 ảnh desktop/mobile sáng đã xem |
| Backend | Không sửa runtime/schema/migration của #124 |

Full FE lượt trước sửa bootstrap: 1528PASS/6liveSKIP, 88filesPASS/1SKIP,
200.66s; không dùng số đó thay lượt cuối có test mới. Backend #124 có1510unit,
1003E2E/1SKIP/20TODO và22HTTP app-role; không nhận đã chạy lại toànBE ở PR Web.

## Chrome, đối kháng và lỗi đã sửa

Kịch bản `scripts/test-product-review-browser.mjs` chạy Chrome headless thật,
Vite → Nest → PostgreSQL app-role QA `v955` tại loopback5549. Ba context tài
khoản Buyer/Seller/Admin và một public, chặn network ngoài hai origin QA. Demo
`bckl_postgres` dừng, workers tắt; không dotenv/reset/drop/đổi checksum migration.

1. Đi từ chi tiết OrderItem thật, click đôi chỉ1POST; abort **sau upstream200**,
   đúng một Review được commit. Journal không chứa nội dung. Logout, login
   người khác không thấy mã cũ; login Buyer cũ, reload và đối chiếu cùng mã.
2. Buyer sửa5→4, Seller phản hồi; Product công khai count1/average4 cùng reply.
3. Admin hide rồi abort sau200, reload/đối chiếu không hide lại. Lý do nội bộ
   chỉ Admin; public count0/không review/reply. Buyer sửa3sao vẫn hidden.
4. OrderItem quá31ngày không có nút tạo Review.
5. 4màn × desktop/mobile sáng không tràn vùng form. Cuối v5,5audit,5command,
   một Review/reply; các bảng Order/OrderItem/Payment/Refund/RevenueAdjustment/
   ProductVariant/StockMovement/SearchOutbox có hash trước–sau bất biến.

Report local: `artifacts/product-review-browser-20261026/r1793032779742/report.json`,
source SHA256 và8ảnh cùng thư mục. Dữ liệu tổng hợp được giữ lại. Abort có kiểm
soát sau response thật, không phải mất gói vật lý. Order/COD được dựng fixture,
không thay QA toàn luồng giao hàng. Các actor trên Chrome xử lý tuần tự; test
cạnh tranh nằm ở HTTP/PG của Backend. Chưa nghiệm thu dark mode, media Review,
notification/email, tiền thật. URL ảnh fixture không có file thật; ảnh public
chỉ chứng minh vùng Review, không phải kiểm thử Gallery/upload.

Các lượt thất bại được giữ rõ:

- r1: lỗi nối launcher, chưa chạy Chrome; dòng PASS của wrapper bị loại, không
  dùng nghiệm thu. Sửa dispatch và yêu cầu report + nhóm thực tế mới tính.
- r2: email fixture có chữ hoa, khác quy tắc email chuẩn hóa của Auth; sửa seed
  lowercase, không đổi cơ chế đăng nhập.
- r3: phát hiện lỗi **thực tế có sẵn** ProductDetailPage: public GET trong lúc
  bootstrap Auth đổi epoch bị AuthSessionChangedError rồi giữ lỗi. Regression
  RED tái lập; sửa GET công khai thử lại tối đa1lần chỉ với loại lỗi này và khi
  component còn active. Không retry lỗi mạng thường hoặc bất kỳ POST nào.
- r4: chạy lại toàn bộ12nhóm PASS. Source hash không đổi trong lúc chạy.

## Review độc lập và giới hạn

Gemini `gemini-4-argon-medium`, effort Medium: source review NONE P1/P2;
delta public-bootstrap và stale-row selection cũng NONE. Đây là review AI kỹ
thuật được ủy quyền, không giả approval của thành viên GitHub. Comment P3 về
Buyer route allowedRoles USER được đối chiếu với ProtectedRoute `buyerAccess`:
SELLER đã được hỗ trợ sau Buyer gate, không mở rộng quyền trái phép.

P3 còn lại: Seller deep-link sau20review cần phân trang/chọn lại, không endpoint
detail Seller riêng; lịch sử chỉ50thayđổi gần nhất và không render toàn bộ text
snapshot cũ; page đã tải không có push moderation tức thời, cần tải lại. Parser
vẫn kiểm aggregate/cursor trong từng response. Không thay thiết kế vì suy đoán
của reviewer thiếu ngữ cảnh. Lỗi refresh chặn chọn row cached, không bật ghi từ
dữ liệu cũ. Log local: `deliverables/product-review-web-*20261026*` và
`product-review-browser-r1..r4-20261026.log`; không commit raw/private log.

## Rollout và việc tiếp

Migrate Backend #124 trước; `PRODUCT_REVIEWS_ENABLED=true` trên server và
`VITE_PRODUCT_REVIEWS_ENABLED=true` khi build FE để bật UI. Hai cờ mặc địnhfalse.
Giữ Buyer capability BE/Web bật nếu Seller dùng quyền mua. Routes recovery vẫn
tồn tại khi menu/nút ghi tắt; drain mã pending trước khi tắt Backend. Không xóa
journal để né401/409. Tài khoản QA dùng dữ liệu tổng hợp, không public credentials.

Sau merge Web mới coi Review cơ bản đã tích hợp trong phạm vi QA này. Tiếp theo
thông báo trong ứng dụng theo sự kiện đã commit → Auth P1 → VNPay/MoMo sandbox.
Không gọi toàn hệ thống hoàn tất hoặc bỏ các cam kết P0/P1.
