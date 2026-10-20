# Chuẩn bị kiểm tra biên nhận Buyer — 18/10/2026

Trạng thái: **PREPARATION, chưa nối UI/HTTP/journal**. Nền `develop 39e8343`,
nhánh `codex/buyer-receipt-validation`. Không phụ thuộc source #68 hoặc contract
resolver đề xuất #69. Không thay Backend, schema, migration, router hoặc Auth.

## 1. Tại sao cần kiểm tra biên nhận?

**Receipt (biên nhận)** là kết quả gốc server trả về khi một lệnh đã thành công,
không phải toàn bộ lịch sử ở GET chi tiết đơn. **Replay** là server trả lại biên
nhận đó khi nhận lại cùng yêu cầu. **Validator** là hàm kiểm dữ liệu lúc chạy;
TypeScript chỉ kiểm kiểu khi biên dịch, không bảo đảm JSON từ mạng luôn đúng.

Luồng chuẩn bị trong task này:

`JSON chưa tin cậy + kỳ vọng từ lần gọi → kiểm envelope → kiểm result → trả kiểu đúng hoặc lỗi an toàn`.

Chưa có HTTP, không đổi trạng thái đơn, không ghi storage, không xóa pending,
không mount UI. Hợp lệ về dữ liệu **không đồng nghĩa** biên nhận đã được đối
chiếu đúng key/phiên đăng nhập. Các bước đó thuộc integration sau này.

## 2. File và nguồn đối chiếu

| File | Vai trò |
|---|---|
| `FE/src/types/buyerOrderReceipt.ts` | Kiểu riêng cancel/complete, không ép theo Seller receipt |
| `FE/src/services/buyerOrderReceipt.ts` | Hai hàm kiểm tra thuần, không gọi mạng |
| `FE/src/services/buyerOrderReceipt.test.ts` | Fixture giả lập và kiểm thử dữ liệu đúng/sai |

Nguồn chuẩn đã merge:

- `BE/src/order/order-command-request.ts`: Buyer reason allowlist, `.trim()`, 1–500 UTF-16 code units.
- `BE/src/order/order-cancellation-receipt.ts`: shape cancel, COD/CANCELLED, actor/reason/history.
- `BE/src/order/order-completion-receipt.ts`: shape complete, PAID, thời gian và BUYER/SYSTEM.
- `BE/src/order/order-cancellation.service.ts`, `order-completion.service.ts`: envelope first/replay và kiểm quyền/giao dịch phía server.
- [Contract hủy](../api/order-cancellation-contract.md), [contract hoàn tất](../api/order-completion-runtime-contract.md).

Không coi ghi chú trạng thái lịch sử IN_PROGRESS trong contract cũ là hiện trạng
merge; lượt này đối chiếu source nền `39e8343`.

## 3. Tham số người gọi phải giữ

| Biến | Chứa gì / lấy từ đâu |
|---|---|
| `value` | Response chưa tin cậy, kiểu `unknown` |
| `expected.orderId` | ID đơn dự định thao tác, không lấy từ response |
| `expected.actorId` | Buyer đã xác thực khi bắt đầu gọi; không lấy từ response |
| `expected.total` | Tổng tiền Order snapshot đã tải trước yêu cầu, chuỗi Decimal chuẩn |
| `requestedReason` | Body lý do gốc còn trong RAM; không đọc lại từ chính receipt để giả đối chiếu |
| `commandId` | ID biên nhận server sinh, số nguyên dương trong miền PostgreSQL Int |
| `replayed` | Boolean first/replay; chấp nhận cả hai, không ép replayed=true như resolver |

Người nối API sau này phải chặn callback phiên cũ; validator này không đọc
AuthContext/session. Không persist reason, token hoặc receipt. Khi reload không
còn lý do gốc thì **không** gọi validator cancel với lý do đoán/nhập lại; cần
luồng recovery được duyệt riêng. Không tính lại total từ giá sản phẩm hiện tại.

## 4. Điều kiện kiểm tra

Envelope và mọi object lồng nhau có đúng allowlist, không thiếu/thừa field;
không nhận array, instance hoặc metadata nội bộ/symbol. HTTP JSON bình thường
được parse thành plain object. Không thực hiện coercion string→number/boolean.

### Hủy Buyer

- Đúng order/command `cancel`; actor BUYER đúng ID ở cancellation và timeline.
- Status CANCELLED; payment COD/CANCELLED/VND, paidAt null.
- Amount chuỗi đúng `0.00` hoặc số nguyên không leading zero, tối đa 12 chữ số
  rồi `.00`, bằng expected.total. Không float/exponent/newline/currency khác.
- Reason CHANGED_MIND/OTHER và text bằng body gốc sau trim, 1–500 ký tự theo JS.
- Đúng một history PENDING_CONFIRMATION→CANCELLED; reason/actor/time khớp audit.
  Không nhận Seller cancel từ CONFIRMED hoặc history GET nguyên danh sách.

### Hoàn tất Buyer

- Đúng order/command `complete`; status COMPLETED.
- COD/VNPAY/MOMO đã PAID/VND, amount chuỗi bằng total, paidAt hợp lệ.
- Timestamp ISO UTC millisecond chuẩn; deliveredAt ≤ completedAt,
  paidAt ≤ completedAt; history time = completedAt.
- Đúng một history DELIVERED→COMPLETED, actor BUYER đúng ID, không SYSTEM/Admin/Seller.
- Không tự thêm luật paidAt phải ≥ deliveredAt: sandbox có thể trả tiền trước
  khi giao. Không bắt Buyer chờ ba ngày, không so với đồng hồ trình duyệt.

Zero amount vẫn được nhận theo validator receipt Backend hiện có; không tự
chuyển thành quy tắc tạo Order miễn phí. Max money/ID kiểm bằng chuỗi/số nguyên,
không cộng/trừ tiền bằng float. Replay là snapshot gốc, không so trạng thái
Order hiện hành hoặc dựng timestamp từ updatedAt.

## 5. Lỗi và giới hạn

Sai dữ liệu/kỳ vọng ném `ApiError`, status502, code `INVALID_ORDER_RESPONSE`,
message cố định không kèm reason/receipt/ID. Lỗi không chứng minh server chưa
commit. Code gọi sau này phải giữ yêu cầu chưa rõ kết quả; không tự tạo key mới.

Hàm trả dữ liệu đã kiểm nhưng không tạo proof hay đóng băng JSON; caller phải
giữ ranh giới phiên/yêu cầu và không sửa dữ liệu sau kiểm. Không dùng kết quả
validator này làm quyền xóa journal hoặc bằng chứng DB.

## 6. Kiểm chứng đợt này

- 98 test mới PASS: first/replay, reason trim/allowlist, provider, malformed
  envelope/fields/types/money, khác order/actor, history, SYSTEM, lỗi context,
  reason và các biên max ID/money/time equality.
- FE build (TypeScript/Vite) PASS; lint PASS, 5 warning Admin nền không sửa.
- Fixture tổng hợp từ shape đã merge, **không phải response HTTP/DB thật**.
- Full FE hồi quy: **499 PASS / 6 opt-in live SKIP**, 29 file PASS / 1 file SKIP.
  Bao gồm 98 test mới, không lấy test từ #68 cộng vào. Nền này chưa có code #68
  nên số lượng không bằng suite của #68; đây không phải mất test.
- Backend E2E, browser, HTTP thật, cancel→hoàn kho/outbox và recovery: **NOT_RUN**.

Chạy lại: `pnpm --dir FE exec vitest run src/services/buyerOrderReceipt.test.ts`,
`pnpm --dir FE run test`, `pnpm --dir FE run lint`, `pnpm --dir FE run build`.
Không cần credentials hoặc DB để chạy bộ kiểm dữ liệu này.

Bước sau: reviewer đối chiếu shape/điều kiện với Backend; sau contract Buyer
recovery đã chốt mới chuẩn bị adapter/journal/settlement riêng và nối UI.
