# Client readiness cho Checkout — 12/10/2026

Baseline: develop dc52d92, đã có Address #49 và Auth #52. Branch:
codex/checkout-client-readiness. IN_PROGRESS, chưa nghiệm thu Checkout UI.

## Vì sao cần bước này

Checkout WIP có phân biệt lỗi nghiệp vụ bằng code và giới hạn refresh, nhưng
client WIP cũ chưa có bảo vệ phiên đã merge của #52. Không ghi đè common client
bằng WIP đó. PR nhỏ này bổ sung hai khả năng cần thiết trên nền #52 chính thức;
giữ nguyên file WIP trong checkout Order để review/tích hợp riêng sau này.

## Thay đổi

- ApiError thêm code tùy chọn, tương thích mọi caller chỉ truyền message/status.
- Parser lỗi giữ code dạng chuỗi, không tự chuyển object thành mã nghiệp vụ.
  Body lỗi null hoặc malformed vẫn trả ApiError/status thay vì TypeError.
- Refresh ghép AbortController hủy theo phiên với AbortSignal.timeout(15000).
  Giữ single-flight, kiểm chủ token và thế hệ phiên; không retry vô hạn.
- Không đổi Backend/Prisma/lockfile/API contract, AuthProvider, UI Address/Cart
  hoặc code Order WIP. Không gọi database hoặc sửa dữ liệu demo.

## Kiểm tra thực tế

- FE lint: PASS.
- Full FE Vitest: 75/75 PASS, 10 file, gồm 5 ca mới ở apiClient.test.ts.
- FE build (tsc -b + Vite): PASS.
- git diff --check: PASS.

Test mới: PRICE_CHANGED 409 không retry; hai dạng malformed error envelope;
refresh stalled bị tín hiệu timeout hủy và không replay write; lỗi
CHECKOUT_IN_PROGRESS vẫn giữ code sau một lần refresh/retry hợp lệ.
Test timeout chủ động kích hoạt signal để chạy xác định, kiểm timeout được
cấu hình 15000 ms; không phải đo wall-clock 15 giây hoặc test Backend thật.
Toàn bộ test #52 delayed 401/đổi phiên/đổi cookie/same-session refresh cùng chạy.

## Giới hạn và bước tiếp theo

- Chưa chạy browser/Backend/PostgreSQL/integration ở PR này; không lấy mock
  fetch làm bằng chứng tạo đơn, chống đặt trùng hoặc rollback database.
- Không thêm retry nghiệp vụ do timeout/409/5xx. Chỉ cùng phiên 401 được một
  refresh/retry như contract client hiện có; Endpoint/Auth có thể tắt retry.
- Timeout được truyền xuống fetch chuẩn. Không bảo đảm adapter tùy biến bỏ qua
  AbortSignal sẽ bị dừng, không bảo đảm giới hạn wall-clock khi event loop treo.
- Không tự xóa checkout intent, không tự tạo idempotency key mới vì timeout.
- Khi #50 merge và client được review/merge, tách Checkout receiver từ WIP,
  nối repeated variantId → đọc Cart/Address → preview → cùng key/body tạo COD
  và recovery. Nối Order detail/command sau khi Backend tương ứng được merge.
- CI phải đối chiếu đúng commit sau push, không lấy kết quả local thay CI.

Thuật ngữ: single-flight = nhiều yêu cầu cùng phiên dùng chung một lần refresh;
intent = ý định mua gồm payload và mã chống tạo trùng; recovery = tra lại/tiếp
tục ý định đó sau mất phản hồi; malformed = dữ liệu không đúng cấu trúc dự kiến.
