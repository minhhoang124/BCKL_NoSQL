# Nền phục hồi yêu cầu Order trên Web — 15/10/2026

Trạng thái **IN_PROGRESS / FOUNDATION ONLY**, branch `codex/order-command-recovery` đồng bộ develop `09daae0` sau merge #54/#55 ngày 16/10/2026. Giữ Checkout và module list/detail đã merge; không route hoặc HTTP mới trong #56. Không sửa Auth/Backend/schema/contract AI. Bổ sung `orderCommandCoordinator.ts` điều phối journal và adapter được inject cho bước nối sau này; chưa có adapter HTTP thật ở PR này. Các mô tả chờ #55 bên dưới là trình tự thiết kế ban đầu; dependency nay đã merge, không còn cần chờ nền đọc.

## Vì sao cần lưu yêu cầu

Timeout hoặc tab reload không chứng minh server rollback. Một GET thấy Order đã đổi trạng thái cũng không xác nhận đúng lệnh của ta đã thành công. Phải giữ cùng Order/command/body/key và nhận biên nhận đã kiểm cấu trúc trước khi giải phóng yêu cầu. Backend PostgreSQL vẫn là nguồn chuẩn, client journal không phải khóa database hoặc quyền truy cập.

`orderIntentJournal.ts` là thư viện độc lập không gọi HTTP. **Journal** = bản ghi yêu cầu còn chờ; **intent** = ý định xử lý cố định; **acknowledgement** = xác nhận từ receipt đã được runtime validator kiểm tra; **fail closed** = dữ liệu không chắc chắn thì chặn thay vì đoán.

## Dữ liệu / quy tắc

- `sessionStorage` của tab, namespace theo numeric actorId; mỗi account tối đa một lệnh chưa giải quyết trong tab. Role không nằm trong namespace để đổi role không bỏ qua lệnh cũ.
- Chỉ schemaVersion1, actorId/role/orderId/command/idempotencyKey/createdAt. Không token/cookie/tên/địa chỉ/nội dung hàng/receipt hoặc body chứa lý do.
- V1 chỉ Seller confirm/start-packing/ready-to-ship và Buyer complete, tất cả body cố định `{}` theo contract. Cancel/confirm-returned chưa được hỗ trợ, không giả phục hồi các body có lý do/chứng từ.
- Persist + đọc lại thành công **trước** dispatch. Storage lỗi, ghi không thành công hoặc dữ liệu sai schema/identity đều chặn lệnh mới. Không xóa dữ liệu hỏng hoặc reset key tự động.
- Reload/remount cùng actor khôi phục cùng key; command/order khác bị chặn khi còn pending. Không tự resend; không TTL tự hết hạn, không tự xóa khi logout, không dùng GET làm ack.
- `acknowledge` chỉ xóa khi actor/intent hiện còn lưu khớp và có orderId/command/commandId dương từ receipt đã validate. Callback cũ không xóa được intent mới. Đây là guard tránh lỗi lập trình, không chữ ký/mốc bảo mật: caller phải validate cả envelope/result/actor của Backend trước.

## Trình tự nối sau #55 merge (chưa code trong PR này)

**Phần điều phối đã chuẩn bị bằng code, chưa nối runtime:** `createOrderCommandCoordinator` yêu cầu `confirmed=true`, chụp actor/role/version của phiên đã xác minh, giữ click latch đồng bộ và persist intent trước khi gọi `sendValidated`. Response hoặc lỗi đến muộn sau logout/đổi actor/đổi role/cùng actor nhưng phiên mới bị chuyển thành lỗi session-changed, không acknowledge. Mọi lỗi adapter giữ pending và không tự gửi lại; retry phải gọi rõ ràng, cùng intent/key. Latch chỉ có phạm vi một coordinator, không thay DB idempotency hoặc khóa nhiều tab. Caller phải giữ coordinator bên ngoài panel, bỏ cập nhật UI của phiên cũ và cung cấp timeout cho adapter. Module không tự refresh token hay xác minh JWT/receipt toàn phần.

1. Nối Buyer/Seller list/detail GET với guard đúng actor, loading/error/empty, filter/cursor và route ID hợp lệ. Các nút POST vẫn khóa.
2. Controller bên ngoài panel đọc journal **sau khi Auth đã xác nhận user/role/isActive**. Dữ liệu pending giữ qua route unmount, không bỏ quên khi panel đóng. Không ghi session generation của process trước vào journal như quyền truy cập.
3. Với lệnh mới: xác nhận trên dialog → chuẩn hóa body `{}` → lưu intent → chụp thế hệ phiên hiện hành → gọi adapter POST với retryOnUnauthorized=false và deadline. Không auto replay sau 401, không gửi intent userA bằng token userB.

   Với Seller adapter ở #55, bản ghi JSON journal không phải `PreparedSellerCommand` trong WeakSet. Sau khi xác minh lại cùng actor/role, caller phải dùng factory `prepareSellerCommand(orderId, command, actorId, idempotencyKey)` tạo handle mới của phiên hiện hành với **key cũ**. Không cast JSON sang handle hoặc lưu lại generation của phiên cũ. Buyer complete còn cần adapter/validator riêng trước runtime.
4. Timeout/abort/5xx/response200 hỏng/409 chưa giải quyết/404 không tự giải phóng intent. Refresh/login lại phải xác minh actor, hiện thông báo và cho gửi lại có kiểm soát cùng key/body. GET chỉ làm mới màn hình, không xóa trạng thái chưa rõ kết quả.
5. Receipt đúng contract/actor/order/command → acknowledge intent → GET detail/list hiện hành. Stale callback/session phải bị chặn trước cả cập nhật UI và acknowledge. Lỗi GET sau receipt phải báo đã ghi nhận nhưng tải lại lỗi, không báo thao tác chưa chạy.
6. Cần đặc tả riêng cách giải phóng lệnh bị từ chối chắc chắn trước commit; foundation này chưa cho xóa pending theo mã lỗi. Không mở giao dịch thật khi chưa hoàn thiện route/controller React, adapter/validator Backend thật và xử lý phần từ chối này.

## Giới hạn bắt buộc

- Không tự có quyền gửi lại khi cùng actorId; Backend current role/ownership/state và frontend session fencing vẫn bắt buộc.
- sessionStorage tồn tại qua reload, nhưng đóng tab/xóa storage hoặc browser chặn/mất dữ liệu có thể mất intent. Bản sao tab có thể có bản sao key; Backend idempotency mới là chống ghi trùng cuối cùng. Chưa có durable cross-device recovery/lookup endpoint cho OrderCommand; không hứa phục hồi sau đóng tab hoặc mọi lỗi lưu trữ.
- Không thực hiện tự xóa intent khi lỗi validation hoặc role bị thay đổi; phải xử lý qua đặc tả điều phối/operator trước khi bật nút. Không dùng nút “bỏ qua” để vượt unknown outcome.
- Thư viện không chống XSS/DevTools sửa dữ liệu, không thay bảo mật server. Idempotency key không đưa URL/log/bằng chứng công khai.
- Unit/jsdom chỉ mô phỏng remount/reload bằng storage giữ nguyên, không phải kiểm chứng browser/HTTP/PostgreSQL thật.

## Ma trận nghiệm thu bước tích hợp (NOT_RUN)

| Ca | Kỳ vọng |
|---|---|
| List/detail Buyer và Seller thật | Guard/ownership, dữ liệu snapshot và cursor đúng; không dữ liệu mẫu |
| Response mất sau commit + F5 | Sau Auth xác minh, giữ key/body, gửi lại có xác nhận, một receipt/history |
| Đổi actor khi POST pending | Không lộ dữ liệu, callback cũ không clear journal hoặc update phiên mới |
| GET xong nhưng command chưa rõ | Không mở key/nút mới |
| Storage bị chặn/hỏng | Không dispatch HTTP, hiển thị cần xử lý, không tự xóa |
| Backend200 malformed | Không ack, giữ intent; không dùng state hiện hành làm bằng chứng thành công |
| Receipt hợp lệ rồi GET lỗi | Không gửi lại lệnh mới, phân biệt ghi nhận thành công/tải lại thất bại |

Kết quả kiểm thử foundation phải ghi trong PR; chưa có luồng Web để nghiệm thu G-FULFILMENT.
