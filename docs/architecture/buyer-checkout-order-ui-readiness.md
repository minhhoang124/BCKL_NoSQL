# Chuẩn bị Buyer Checkout / Order UI — 09/10/2026

Trạng thái: **IN_PROGRESS, UI minh họa**, không phải G-CHECKOUT/G-FULFILMENT DONE.
Branch `codex/buyer-checkout-order-ui` từ develop `c6e0ba1`, không lấy code chưa
merge từ PR #36/#37/#38. Không sửa Address/Cart UI của Hiền hoặc Auth/schema/API.

## Phạm vi và cách xem

Chạy `pnpm --dir FE dev --host 127.0.0.1 --port 5174`, mở
`http://127.0.0.1:5174/dev/buyer-flow/checkout`.
Routes chỉ đăng ký khi `import.meta.env.DEV`; bản production không mở preview.
Không cần đăng nhập để xem dữ liệu giả; **không** bỏ guard của các route thật.
AuthProvider hiện có có thể kiểm tra phiên đăng nhập khi mở app, nhưng feature
preview không gọi bất kỳ API Checkout/Order/Address/Cart nào.

| Màn | Route DEV | Điều đã chuẩn bị |
|---|---|---|
| Xác nhận mua | `/dev/buyer-flow/checkout` | Địa chỉ mẫu chỉ đọc; nhóm Store; COD; phí demo 0; giá đổi/thiếu kho/chưa rõ kết quả chặn bước tiếp |
| Kết quả tạo | `/dev/buyer-flow/result` | Nhóm hai đơn mẫu; receipt tạo đơn tách trạng thái hiện hành; mất response không coi chắc chắn thất bại |
| Danh sách đơn | `/dev/buyer-flow/orders` | Lọc trạng thái; rỗng/lỗi/tải; liên kết chi tiết |
| Chi tiết | `/dev/buyer-flow/orders/demo-audio` | Snapshot mẫu, Payment tách Order, timeline mẫu; không có command hủy/giao/complete thật |

`fixtures.ts` là **view model** (dữ liệu phục vụ hiển thị), không phải DTO API.
ID `demo-*` không phải PostgreSQL ID; không dùng chúng để import/tìm kiếm.
Không lưu key/địa chỉ vào URL/storage; không sinh đơn, trừ kho hoặc thu tiền.
Nút kết quả chỉ điều hướng; nút hướng dẫn hủy không đổi trạng thái.

## Nguồn nghiệp vụ trước code

- `docs/analysis/hien/srs-v3.md`: FR-CHK-01/FR-ORD-01/FR-CAN-01, D07.
- `docs/api/cart-order-inventory-api-contract.md`: mục 5/6/7/9; nguồn chuẩn,
  không thay bằng fixture UI hay DTO tự đoán.
- `docs/project/work-assignment.md`: Hiền CODE Address/Cart; Hoàng Checkout/Order.

## Luồng thật cần nối sau review dependencies

1. Buyer USER active chọn tập con Cart, quantity khớp giỏ; chọn Address thuộc mình.
2. Preview đọc lại giá/kho. `canCheckout=false` thì không hiển thị tổng có thể
   thanh toán; không lấy tổng của Store hợp lệ để đặt một phần.
3. Tạo intent (một yêu cầu mua logic) có body/key cố định. Submit khóa nút;
   retry dùng nguyên key/body. Không tự thay expectedUnitPrice theo giá mới.
4. POST tạo COD ở #36 commit tất cả Store/kho/snapshot/outbox trong một transaction.
5. Timeout/404 lookup chưa chứng minh rollback. Giữ intent, tối đa 3 lần đối chiếu
   có backoff/Retry-After; hết giới hạn báo chưa rõ, cho kiểm tra thủ công.
6. Receipt = kết quả lúc tạo, không phải tracking mới nhất. GET Order đọc trạng
   thái hiện hành; Buyer chỉ hủy chờ xác nhận, complete sau DELIVERED và COD PAID.

**Chưa implement** persistence intent/recovery, API adapter/validator, auth/owner
Buyer routes, cursor pagination, preview/create/lookup, command/timeline thật.
Phải review cách lưu key/body theo actor (không token/PII trong URL, xóa khi
logout/đổi actor) trước nối API. Không thêm số lần retry giả vào UI preview.

## Các bước tiếp theo và nghiệm thu

- #36/#37 review/merge trước API adapter; detail/commands cần PR riêng.
- Thống nhất điểm chuyển từ màn Cart của Hiền, tập Variant được chọn và Address
  theo contract; không gửi total hoặc Store ID làm nguồn tính tiền cho Backend.
- Guard USER, lỗi 401/403/404/409/429, hết phiên không mất/ghép intent người khác.
- Test lỗi giá/kho, mất phản hồi, reload/retry không tạo hai đơn, rollback nhiều
  Store, snapshot không đổi, quyền Buyer; có browser evidence trước báo DONE.
- Màu cam local CSS Modules, responsive; không đổi CSS toàn app/Header của Hiền.

## Kiểm chứng

Tests feature chặn mọi `fetch` trực tiếp, kiểm nhãn giả lập, trạng thái, tiền
nguyên đồng, điều hướng và chặn submit lỗi. Các ca này chỉ kiểm UI preview,
**không** phải test chống đơn đôi hay transaction thật.
Kết quả lint/build/full FE tests được ghi khi thực chạy, không suy từ code.

Ngày 09/10 đã thực chạy: frozen install PASS, FE lint PASS, FE build PASS,
full FE tests **33/33 (7 file) PASS**, gồm **10 ca mới** của preview;
`git diff --check` PASS. Dev server chạy trên 127.0.0.1:5174.
Chưa kiểm tra ảnh chụp/browser bằng mắt: công cụ trình duyệt lỗi khởi tạo
`failed to write kernel assets`; không coi test DOM là bằng chứng responsive
đã duyệt. Cần Hiền/Hoàng mở DEV URL để review desktop/mobile trước nối API.

Bổ sung cùng ngày: kịch bản [Checkout/Order xuyên suốt](../testing/checkout-order-journey-verification.md)
đã chuẩn bị; [Seller UI mẫu](seller-order-ui-readiness.md) cũng thuộc Hoàng,
không sửa màn Address/Cart/Admin của Hiền. Full FE tests mới **41/41 (8 file)**,
lint/build/diff-check PASS; đây là kết quả kiểm UI, không transaction.
[Checklist trải nghiệm #40](../testing/buyer-preview-experience-checklist.md)
ghi Browser NOT_RUN do capture lỗi. Cart handoff chỉ giải thích bằng dữ liệu
minh họa; chưa nối Cart API/UI. Detail reset state khi đổi demoId để không giữ
notice/tình huống của đơn trước. Không thay đổi contract nghiệp vụ.
