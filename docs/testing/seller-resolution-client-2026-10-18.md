# Seller resolver client và xác nhận — 18/10/2026

**Mốc lịch sử chuẩn bị:** #67 nay đã merge tại `39e8343`; phần route QA opt-in
được nối sau đó. Trạng thái mới và bằng chứng thật ở
[Seller Web runtime](seller-order-web-runtime-2026-10-18.md). Những mô tả chưa
mount/NOT_RUN bên dưới phản ánh lượt chuẩn bị 11:14, không thay trạng thái mới.

## 1. Phạm vi và trạng thái

Nhánh `codex/seller-resolution-client`, nền develop `9956379` gồm #55/#56/#58/
#60/#62/#63 đã merge. #67 là Backend resolver **đang review**, không lấy code
hoặc migration từ PR đó. Chỉ chuẩn bị FE theo contract #62, chưa mount route,
chưa bật giao dịch; không nhận G-FULFILMENT DONE.

Không sửa Backend, schema, shared Auth/apiClient, router/menu hoặc màn của Hiền.

## 2. Luồng và ý nghĩa

1. Đọc pending intent từ journal đúng tài khoản; không tự tạo key để đối chiếu.
2. Người dùng đồng ý rõ: nếu lệnh cũ chưa thực thi, resolver sẽ đóng mã cũ.
3. POST resolver dùng `Idempotency-Key` gốc và `{command}`, timeout 30 giây,
   no-store, không retry/refresh POST sau 401 hoặc tự gửi khi mount/reload.
4. Validate response allowlist, identity, timestamp/ID và toàn receipt nếu có.
5. Kiểm phiên hiện tại và toàn bộ pending trước giải phóng; không clear theo GET.
6. GET detail mới. GET lỗi không phủ nhận settlement hoặc cho POST mới.

| Kết quả | Journal | Bước tiếp |
|---|---|---|
| COMMITTED | Acknowledge bằng receipt gốc hợp lệ | GET mới, không gửi lại lệnh |
| CLOSED_WITHOUT_EXECUTION | Settle bằng proof của chính lần gọi/key/phiên đó | GET mới; ý định mới cần consent/key mới |
| Lỗi HTTP/mạng/timeout/200 hỏng | Giữ pending/key | Đối chiếu lại có xác nhận, không auto retry |
| Đổi phiên/tài khoản | Không acknowledge response cũ | Không lộ Order cũ sang tài khoản mới |
| Xóa storage thất bại hoặc no-op | Bị khóa, không báo đã clear | Không bỏ qua khóa để gửi lệnh khác |
| GET lỗi sau settlement | Không đổi outcome đã xác minh | Chỉ retry GET; chưa mở bước tiếp |

Đóng mã yêu cầu **không phải hủy đơn**. Receipt là kết quả lệnh đã commit, không
phải trạng thái Order hiện tại. Một key đã đóng không được tái dùng để thực thi.

## 3. File và điểm kiểm soát

- `FE/src/services/orderResolutionApi.ts`: prepare handle bất biến với key bắt
  buộc, send và validate hai envelope. COMMITTED bắt buộc replayed=true và tái
  dùng validator receipt. CLOSED không nhận commandId/result/extra fields.
- WeakSet giữ handle hợp lệ; WeakMap giữ proof đã validate theo invocation.
  Đây là chống nhầm luồng FE, **không là quyền bảo mật phía server** hoặc chữ ký.
- `orderIntentJournal.ts`: `settleClosedIntent` kiểm current/expected intent,
  actor/key/order/command và proof, xóa rồi đọc kiểm lại; không giả thành công.
- `orderCommandCoordinator.ts`: resolve dùng cùng latch với execute; không
  prepare ý định mới; so đầy đủ metadata pending và session generation.
- `sellerCommandRecovery.ts`: nối adapter bằng key trong journal, không tạo UUID.
- `sellerResolutionFlow.ts`: một controller/view theo phiên; settlement xong
  mới GET, lỗi GET chỉ read-retry. `canStartNext` chỉ là freshness/recovery gate,
  không thay kiểm quyền, trạng thái, Payment hoặc consent cho command tiếp theo.
- `SellerResolutionReview.tsx`: component chưa mount, dùng CSS module cam sẵn
  có, không callback thì disabled. Bấm hai lần chỉ một callback; đổi identity
  reset consent; kiểm generation ngay khi click, kể cả trước React rerender.

## 4. Kiểm thử và ranh giới bằng chứng

Các file test mới:
- `orderResolutionApi.test.ts`: contract strict, nested receipt, original key,
  handle/proof giả hoặc JSON clone, no retry 4xx/5xx, phiên cũ, timeout/abort.
- `sellerResolution.test.ts`: journal/coordinator/adapter thật trong FE với HTTP
  giả lập; clear đúng identity, key cũ qua reload, latch chung, storage lỗi,
  pending thay giữa request, logout/login, GET lỗi sau settlement và GET hỏng.
- `SellerResolutionReview.test.tsx`: jsdom; consent, double click, lỗi callback,
  read-only retry, key mới reset consent và view cũ không dispatch phiên mới.

Regression giữ `OrderReadPages.test.tsx`/`OrderPanels.test.tsx`: route Seller GET
chưa cấp dispatcher, nút command disabled. Không sửa pages/router để bật ngầm.

**Kết quả cuối 11:14 ngày 18/10/2026:** FE **492 PASS/6 live SKIP**, 31 file PASS,
1 file live SKIP; tăng 91 test so với nền 401 PASS. Build (gồm TypeScript) PASS;
lint không lỗi, 5 warning Admin nền `set-state-in-effect` không thuộc diff.
Diff-check sạch. Không sửa Admin chỉ để xóa warning.

Đã dùng dependency frozen-lockfile/offline, không đổi package hoặc lockfile.
Full FE test là unit/component với mock HTTP, không phải giao dịch Backend thật.

**NOT_RUN/chưa triển khai:** browser desktop/mobile/sáng-tối, live resolver/DB,
route Seller command controller, xử lý end-to-end qua #67, Buyer cancel/complete,
multi-tab/multi-device recovery. sessionStorage chỉ theo tab; không TTL hoặc
clear-on-logout. Không cam kết khôi phục dữ liệu storage bị xóa ngoài ứng dụng.

Chạy lại: `pnpm --dir FE test`, `pnpm --dir FE lint`, `pnpm --dir FE build`,
`git diff --check`. Không cần Docker/credential để chạy các test chuẩn bị này.

## 5. Sau review/merge #67

1. Review client này; xác minh contract không đổi ở head Backend được merge.
2. PR runtime riêng mount Seller detail và giữ một controller ổn định theo phiên,
   phản ánh state bằng React; không tạo lại controller mỗi render để bỏ latch.
3. Chỉ bật command hợp lệ khi GET mới, policy cho phép, không pending và có consent.
4. QA browser + Nest + PostgreSQL riêng: confirm → packing → ready, mất phản hồi,
   resolver COMMITTED/CLOSED, reload, đổi tài khoản, lỗi storage, GET lỗi sau ack.
5. So OrderCommand/history/fence trước/sau để chứng minh một hiệu ứng, không chỉ
   nhìn toast. Sau review mới xét gate tích hợp, không tự merge.
