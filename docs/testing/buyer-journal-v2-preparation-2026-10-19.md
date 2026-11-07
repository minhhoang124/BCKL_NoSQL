# Buyer journal v2 và consent — PREPARATION, 19/10/2026

Base develop622cfb9, contract #69 đã merge. Không lấy #70 hoặc #74 đang review
làm dependency. Không thay Backend, schema, Seller journal/coordinator, Auth,
router, Buyer/Seller page hoặc nút giao dịch hiện có.

## Tại sao tách bước này

Buyer hủy đơn có reasonText. Nếu lưu body đó trong browser storage thì lộ nội
dung người mua; nếu bỏ body rồi tự dựng lại để replay thì có thể đổi nghĩa lệnh.
Vì vậy v2 lưu fingerprint (dấu SHA256) và metadata để đối chiếu key, không tự
replay sau reload. Hash không mã hóa và không phải chữ ký/quyền: lý do ngắn vẫn
có thể bị dò. Chưa có HTTP adapter, settlement hoặc Buyer Web runtime.

## File và luồng

- `buyerCommandFingerprint.ts`: exact body/allowlist, Buyer reasonCode, trim và
  UTF-16 length1..500 như Backend; không NFC/collapse whitespace. WebCrypto SHA256
  của actorScope/body/command/orderId, khớp3vector #69. Normalized body chỉ RAM,
  caller tương lai phải chụp body bất biến trước dispatch, không serialize nó.
- `buyerIntentJournal.ts`: cùng physical slot `bckl-order-command-journal-v1:id`,
  schemaVersion2 exact9fields. Chỉ USER active với thế hệ Auth hiện hành. Latch
  trước await, kiểm session/pending lại sau hash, so raw record trước ghi và đọc
  kiểm lại sau ghi; storage throw/no-op/hỏng thì blocked (khóa thay vì đoán).
- `prepareNew` cần consent và slot trống. Bất kỳ pending nào, kể cả cùng Order/
  command/hash, đều chặn execute mới. Không mint key khác để né pending.
- `upgradeLegacyComplete` chỉ nâng metadata USER complete v1 trong cùng slot,
  giữ key/time/identity. Seller v1 và unknown version không bị chuyển/xóa. V2
  hợp lệ không gửi hay settle; chỉ được đọc lại. Code v1 cũ gặp v2 sẽ fail closed.
- `BuyerRecoveryConsent.tsx`: chưa mount. Phải connected+callback+consent mới gọi
  callback đối chiếu. Reset consent khi pending/phiên đổi; khóa click trùng.
  Callback không phải HTTP proof. COMMITTED/CLOSED rồi GET lỗi chỉ có nút tải
  lại, không biến kết quả đã biết về unknown hoặc gọi lại lệnh giao dịch.

Journal không có remove/ack/settle/reset/HTTP. Đây là chủ ý: chỉ sau receipt
validators #70 và Backend #74 merge mới nối adapter/proof và settlement v2
trong PR tiếp theo; không tạo hàm xóa pending bằng JSON/GET/error409 ở bước này.

## Bằng chứng và giới hạn

- Test storage/hash chạy Node WebCrypto thật với storage giả rõ nhãn, không
  gọi sessionStorage của browser thật. Test component chạy jsdom, không Chrome.
- Kiểm old Seller/v1 compatibility, private reason không persist, role/account
  boundary, async digest/session/pending race, getter/setter throw/no-op,
  consent/double-click/reload-only và callback sau unmount.
- Lượt đầu trên `be77507`: Full FE621 PASS/6live SKIP, 37files PASS/1SKIP. 66test mới gồm49 storage/hash
  và17 component; lint exit0 với5warning Admin nền, TypeScript/Vite build và
  diff-check PASS. Không sửa UI Hiền trong task.
- Browser/Nest/PostgreSQL Buyer Web, lỗi remove/settlement, timeout/malformed200
  và invocation proof vẫn NOT_RUN vì chưa adapter/clear path. Không gọi G-FULFILMENT
  DONE, không lấy snapshot/component test làm bằng chứng giao dịch thật.
- Tab bị đóng/xóa storage vẫn có thể mất pending; không cross-device/global
  journal. Client không chống XSS/DevTools và không là khóa database.

## Gate tiếp theo

Review module này → merge #70/#74 đúng head đã approve+CI → viết Buyer HTTP
adapter với timeout/no-auto-refresh/strictreceipt, requestHash và proof gắn phiên/
invocation → settlement đúng9fields → chỉ GET mới sau kết quả → nối Buyer detail
bằng cờ QA mặc định tắt → test browser/HTTP/DB thật trước bật rộng.

## Sửa P2 theo review Hiền — input thay đổi trong khi hash đang chờ

Review tại `be77507` phát hiện `prepareNew` tính hash bằng đầu vào lúc đầu nhưng
đọc lại `input.orderId/command` sau await để ghi metadata. Đây là lỗi code thật,
không phải lỗi test; báo cáo Gemini không thấy lỗi không thay thế finding tái lập.

Regression dùng Node WebCrypto thật, chỉ giữ promise trả kết quả digest bằng gate:
đổi orderId101→102 hoặc cancel→complete trong lúc chờ. Trên source cũ cả hai
case FAIL, lưu ID/command mới với hash cũ. Hai ca đổi nested body/thay cả body
cũng được giữ làm regression; không gọi HTTP, không DB/browser hoặc giả SHA256.

Bản sửa đọc các primitive identity/consent đúng một lần trước await; validate
orderId/command, chuẩn hóa và freeze clone body trong RAM. Một snapshot được
dùng xuyên suốt hash và candidate metadata. Giữ nguyên latch, phiên, pending,
raw compare và storage readback; không thêm adapter, remove/ACK hoặc settlement.

- Bộ trọng tâm mới70/70 PASS (53hash/storage +17component).
- FE lint PASS với5warning Admin nền; TypeScript/Vite build PASS.
- Full suite bản sửa625 PASS/6live SKIP,37files PASS/1SKIP,67.04s.
  Không tính skip là PASS; đây vẫn là Node/jsdom, chưa browser/HTTP recovery.
- Chờ Hiền re-review đúng head sửa và CI mới; chưa Ready/merge.
