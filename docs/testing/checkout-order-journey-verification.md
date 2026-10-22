# Kịch bản Checkout → xử lý Order → theo dõi — 09/10/2026

**PREPARED / NOT_RUN**: tài liệu này thiết kế kiểm thử xuyên suốt, không phải
biên bản nghiệm thu. Không thao tác database demo và không coi màn fixture là
chứng cứ giao dịch thành công. Người chạy điền kết quả thực tế từng ca.

## 1. Nguồn và khả năng chạy hiện tại

Nguồn yêu cầu: SRS `docs/analysis/hien/srs-v3.md` (FR-CART-01, FR-CHK-01,
FR-ORD-01, FR-CAN-01/D07), contract
`docs/api/cart-order-inventory-api-contract.md` mục 5–9 và phạm vi
`docs/project/implementation-scope.md`. Contract chi tiết quyết định actor;
Seller chuẩn bị hàng, **không** tự đánh dấu giao thành công/hoàn tất.

Snapshot PR ngày 09/10 (phải đọc lại head trước thực chạy):

| Chặng | Khả năng / dependency | Trạng thái luồng Web trong đợt này |
|---|---|---|
| Address / Cart API | Đã merge #30/#31 | NOT_RUN; UI Address/Cart do Hiền nối |
| Preview/create/lookup COD | Code ở #36 `c59b349`, chưa merge | NOT_RUN; không lấy endpoint trên branch làm baseline tích hợp |
| Buyer/Seller list | Code ở #37 `e6f4427`, chưa merge | NOT_RUN |
| OrderCommand/audit | Schema ở #38 `88968ce`, chưa có command runtime | NOT_RUN |
| Order detail, confirm/packing/cancel | Contract có; controller runtime chưa có trong các branch được kiểm tra | BLOCKED / NOT_RUN |
| Admin giao mô phỏng / Buyer complete / job D07 | Contract có; chưa có runtime | BLOCKED / NOT_RUN |
| Buyer/Seller UI preview | Fixture DEV, không API | Chỉ test hiển thị, không test giao dịch |

Idempotency = gửi lại cùng yêu cầu logic không tạo đơn/hoàn kho lần hai.
Transaction = các thay đổi dữ liệu cùng thành công hoặc cùng hoàn tác.
Snapshot = bản chụp giá, SKU, địa chỉ lúc đặt; không đọc giá/địa chỉ mới để sửa đơn cũ.
Outbox = bản ghi công việc đồng bộ Search được lưu cùng giao dịch kho.

## 2. Chuẩn bị môi trường và fixture

1. Checkout các PR dependency đã được review vào môi trường tích hợp riêng;
   ghi SHA của FE/BE/migration/AI. Không tự merge PR hoặc sửa migration cũ.
2. Dùng database test riêng, xác minh DATABASE_URL trỏ đúng database trước
   migration/seed. Chưa xác minh thì dừng. Không dùng dữ liệu demo hoặc mapping 86.
3. Fixture có Buyer A/B, Seller S1/S2, hai Store ACTIVE; địa chỉ giả thuộc A/B;
   hai Product ACTIVE/APPROVED đủ ảnh/category/attribute/shipping; Variant V1
   kho 5 giá `100000.00`, V2 kho 3 giá `200000.00`, V-LAST kho 1.
   ID do PostgreSQL sinh, lưu trong fixture context, không hard-code ID dataset.
4. A chọn V1 × 2, V2 × 1; giữ một dòng giỏ không chọn. Tổng demo 400.000đ,
   shipping `DEMO_ZERO_V1` 0đ. Mỗi Store một Order, cùng Checkout.
5. Ghi baseline kho/version/movement/outbox bằng query chỉ đọc. Tắt worker
   tự gửi dữ liệu ngoài fixture hoặc chạy isolated Search index nếu test Search.
6. Hai request cạnh tranh dùng hai client/connection hoặc hai app instance;
   không dùng khóa trong một process làm bằng chứng chống bán vượt kho.

## 3. Kịch bản chuẩn (đi theo thứ tự)

| Bước | Thao tác actor | Kỳ vọng giao diện / API | Kiểm chứng dữ liệu |
|---|---|---|---|
| J01 | A chọn hai dòng ở Cart và địa chỉ của A | Chỉ selected Variant chuyển Checkout; quantity khớp giỏ | Không trừ/giữ kho, không Order |
| J02 | A gọi POST /checkout/preview | canCheckout=true; Store groups; COD; tổng do BE tính | Không write kho/Cart/Order/outbox |
| J03 | A xác nhận giá, POST /checkouts với Idempotency-Key | Receipt nhóm hai Order PENDING_CONFIRMATION, COD UNPAID | Một Checkout; hai Order; snapshot; decrement movement; xóa đúng hai dòng; version/outbox nguyên tử |
| J04 | A xem GET /orders và GET /orders/:id | Danh sách/detail/timeline chỉ đơn A; receipt không thay tracking | Đọc trạng thái hiện hành, không mutation |
| J05 | S1 xem /seller/orders và detail | Chỉ đơn Store S1; không thấy đơn S2 | Ownership từ JWT, không tin storeId client |
| J06 | S1 confirm → start-packing → ready-to-ship, mỗi command key riêng | CONFIRMED → PACKING → READY_TO_SHIP; lỗi phải reload | Một history/receipt mỗi transition; không trừ kho thêm; COD vẫn UNPAID |
| J07 | Admin mô phỏng ship rồi mark-delivered đúng attempt/tracking | SHIPPING → DELIVERED; Buyer thấy timeline cập nhật | COD PAID và Order/history cùng transaction; Seller không có quyền delivered |
| J08 | A complete sau DELIVERED hoặc SYSTEM D07 tới hạn | COMPLETED; không cho Seller complete | Buyer/job cạnh tranh chỉ một transition; doanh thu chỉ ghi nhận mốc hoàn tất |

**J01–J08 đều NOT_RUN**, J04 detail và J06–J08 bị chặn bởi runtime chưa có.
Không ghi PASS chỉ vì API/unit test riêng hoặc CI xanh.

## 4. Ngoại lệ và cạnh tranh bắt buộc

| ID | Chuẩn bị / thao tác | Kỳ vọng và dấu vết cần kiểm | Kết quả đợt này |
|---|---|---|---|
| E01 Giá đổi | Sau preview, đổi V1 sang 110000; gửi expectedUnitPrice cũ | PRICE_CHANGED; không tự nhận giá mới; cả nhóm rollback; Buyer xác nhận lại intent mới sau lỗi chắc chắn | NOT_RUN |
| E02 Thiếu kho | Sau preview giảm V2 dưới quantity | INSUFFICIENT_STOCK; không đặt riêng Store còn đủ; kho/giỏ/Order/outbox không đổi từ request lỗi | NOT_RUN |
| E03 Public mất | Ẩn Product/khóa Store sau preview | Không bán; nội dung nháp không lộ trong lỗi; nhóm rollback | NOT_RUN |
| E04 Gửi trùng | Double-click / hai request cùng body/key | Một Checkout, hai Order, decrement một lần; response replay receipt gốc | NOT_RUN |
| E05 Key sai intent | Key cũ với quantity/address/giá khác | 409 IDEMPOTENCY_CONFLICT; không thêm dữ liệu | NOT_RUN |
| E06 Mất response | Cắt response sau commit rồi lookup/retry nguyên body/key | Trả receipt gốc; không tạo key mới; lookup 404 không chứng minh rollback; tối đa 3 lần tự đối chiếu có backoff/Retry-After | NOT_RUN |
| E07 Rollback giữa nhóm | Fault injection sau tạo Store đầu hoặc ghi outbox | Rollback Checkout/Order/items/payment/history/movement/kho/Cart/version/outbox toàn nhóm | NOT_RUN |
| E08 Sản phẩm cuối | A/B đồng thời mua V-LAST bằng key riêng | Chỉ một bên đặt được; stock=0, không âm; không hai movement decrement thành công | NOT_RUN |
| E09 Hủy Buyer | A cancel PENDING với lý do và key | CANCELLED, Payment CANCELLED, restore một lần, version/outbox cùng transaction | NOT_RUN — command thiếu |
| E10 Replay hủy | Retry nguyên key/body sau mất response; thử key mới | Replay không tăng kho/history/outbox; key mới không giả replay và bị chặn trạng thái | NOT_RUN — command thiếu |
| E11 Hủy cạnh confirm | A cancel và S1 confirm đồng thời | Chỉ transition hợp lệ thắng; bên thua 409/reload; không Order CONFIRMED nhưng kho đã hoàn | NOT_RUN — command thiếu |
| E12 Seller hủy | S1 hủy PENDING/CONFIRMED; thử PACKING | Lý do bắt buộc; restore một lần ở trạng thái cho phép; PACKING bị chặn | NOT_RUN — command thiếu |
| E13 Ownership | B đọc/hủy Order A; S2 xử lý Order S1; USER gọi Seller/Admin | Không đọc chéo, không mutation; actorId/status client không được nhận | NOT_RUN |
| E14 Snapshot/replay | Sửa catalog/address sau tạo; Seller chuyển trạng thái; replay create | Receipt ban đầu giữ nguyên; detail cập nhật status nhưng giữ giá/địa chỉ snapshot | NOT_RUN |
| E15 Giao thất bại | Fail attempt 1, retry, callback cũ attempt 1; retry tới giới hạn | Stale attempt không đổi đơn; tối đa 4 lần giao tổng; thất bại chưa tự hoàn kho | NOT_RUN — runtime thiếu |
| E16 Nhận hàng trả | confirm-returned true/false, retry cùng key | True restore một lần; false không tăng stock/version/outbox vì kho; đổi false→true cùng key conflict | NOT_RUN — runtime thiếu |
| E17 Phiên/lỗi mạng | 401/403/429/5xx, reload/back, đổi tài khoản | Không ghép intent actor khác, không key/PII trong URL/log; 429 giữ intent và tôn trọng Retry-After | NOT_RUN — adapter thiếu |
| E18 Search kho | Mua hết → cancel hoàn kho; retry event | Version tiến, outbox canonical, worker/index idempotent; hydrate giá/kho hiện hành; không tuyên bố index tức thời | NOT_RUN — phối hợp Đạt |

## 5. Cách ghi biên bản khi dependency sẵn sàng

Mỗi ca ghi: ID, UTC/timezone, commit SHA, actor alias, requestId (không JWT/key),
HTTP/errorCode, trước/sau kho/version, số Order/movement/history/outbox,
ảnh màn hình hoặc output đã che dữ liệu, expected/actual và PASS/FAIL/BLOCKED.
Không ghi credential/raw key/hash/PII. Cleanup chỉ xóa đúng fixture đã tạo theo
FK-safe order; giữ chứng cứ tổng hợp. UI DOM tests không thay thế browser E2E.

Thứ tự thực thi: J01–J03 + E01–E08 → Order list/detail → J05/J06 + E09–E14
→ giao mô phỏng J07/J08/E15/E16 → E17/E18. Chưa có API thì giữ NOT_RUN;
không dựng endpoint giả để báo PASS. Hiền review luồng/test; Hoàng tích hợp;
Đạt xác minh chặng stock → outbox → hai index sau khi Checkout thật chạy.
