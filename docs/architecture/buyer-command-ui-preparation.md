# Buyer hủy/hoàn tất — giao diện chuẩn bị độc lập

Ngày 22/10/2026. Branch `codex/buyer-order-command-ui-preparation`, từ develop
`e394c9eb3c13c8f96bfe40f5be97d5efb97d192e`. Không lấy code #95 đang review.
Đây là component chưa mount, không phải Buyer Web đã giao dịch được.

## Thành phần và thuật ngữ

| Thành phần/biến | Vai trò |
| --- | --- |
| `BuyerCommandReview` | Hộp xác nhận thao tác mới, thông báo đang gửi/unknown/GET lỗi |
| `BuyerRecoveryConsent` đã merge | Đồng ý đối chiếu mã cũ, không phải đồng ý thực hiện một lệnh mới |
| `binding.actorId/sessionVersion/readKey` | Chủ phiên, thế hệ đăng nhập và identity của lần GET do parent nạp; không phải bằng chứng quyền sở hữu |
| `fresh` | Parent đã xác minh đang dùng kết quả GET mới của đúng phiên/đơn |
| `pending` | `clear` mới xét lệnh mới; `present/blocked` khóa, kể cả mã đang chờ thuộc đơn khác |
| `connected` | Mặc định tắt; chỉ callback được nối có chủ đích mới nhận yêu cầu xác nhận |
| `onConfirm` | Giao ý định đã xác nhận cho bộ điều phối; Promise resolve không chứng minh thành công |
| `onReload` | Chỉ tải GET sau khi đã xác minh biên nhận nhưng không tải được đơn |
| `latch` | Chốt đồng bộ trong component chống click trùng; không thay khóa/idempotency Backend hoặc journal |

`readKey` phải gắn với dữ liệu Buyer GET đã validate và cùng thế hệ phiên.
OrderDetail không trả buyerId; không suy owner từ timeline hoặc profile.
Parent tương lai phải đọc đúng API Buyer, giữ session binding và Backend vẫn
kiểm quyền trong transaction. Truyền object giả vào component không cấp quyền.

## Quy tắc hiển thị và xác nhận

- Cancel: PENDING_CONFIRMATION, COD/UNPAID, paidAt null, amount bằng total VND.
  Lý do CHANGED_MIND/OTHER, mô tả sau trim dài 1..500 UTF-16 code units theo
  helper đã merge; không NFC, không âm thầm cắt chuỗi dài.
- Complete: DELIVERED/PAID, paidAt ISO hợp lệ, amount bằng total VND. Yêu cầu
  người mua xác nhận đã thực sự nhận hàng; body `{}`, không lý do hủy.
- Payment thiếu không suy COD. Store bị khóa không tự chặn Buyer xem/hủy đơn cũ.
- Đổi lý do/code xóa consent. Đổi read/session/order/command/status/payment/
  total/fresh/pending/phase remount nội dung, bỏ lý do RAM/consent cũ.
- Đóng hộp trước gửi không tạo key hoặc request. Sau dispatch, khóa cả form/
  dismiss; lỗi callback vẫn giữ khóa và báo chưa rõ kết quả, không tự retry.
- `onConfirm` nhận snapshot request/body frozen trước await. Không key/hash,
  token/địa chỉ/receipt trong payload của view; lý do chỉ trong React RAM.
- Phiên sai/đổi role/inactive không render identity đơn cũ. Handler kiểm lại
  thế hệ trước gọi callback; lỗi trả muộn sau unmount/đổi phiên không cập nhật view.

## Bảng trạng thái và điểm nối #95 sau review/merge

| Trạng thái view | Hành động |
| --- | --- |
| confirm-new | Lý do/consent → một callback; default disabled khi chưa connected |
| sending | Không dismiss hoặc lệnh mới; chưa biết server có commit không |
| outcome-unknown | Không replay/new key/clear; parent dùng BuyerRecoveryConsent riêng |
| acknowledged-refreshing | Chỉ chờ GET; không coi Order status tự thay bằng receipt |
| acknowledged-refresh-error | Nút GET-only retry, chốt click trùng; không POST |
| blocked | Không hành động; không xóa storage để né lỗi |

Sau #95 đủ gate/merge, PR tích hợp mới sẽ sở hữu runtime ổn định theo account/
session. Trước execute, parent đối chiếu request.binding/expectedTotal với đúng
GET hiện hành, đọc pending và gọi `runtime.execute` bằng Order snapshot đã validate,
command/body/confirmed. Không dùng callback component làm settlement proof.

Sau timeout/mất phản hồi hoặc reload, đọc journal gốc, không dựng lại reason
đã mất từ form/GET. Pending v2 dùng consent + resolver gốc; legacy/blocked cần
luồng riêng đã quy định, không chuyển định dạng để bỏ pending. Pending của đơn
khác dẫn về đơn đó, không gọi resolver bằng ID đơn hiện tại.

`COMMITTED` dựa biên nhận gốc và proof hợp lệ; `CLOSED_WITHOUT_EXECUTION` chỉ đóng
mã chưa thực thi. Hai nhánh đều cần GET mới trước xét lệnh tiếp. GET lỗi chỉ
reload; không reset runtime/journal để chạy lại POST. Đổi account phải dispose
runtime cũ và remount view; không xóa key của chủ cũ. Component không tự settle.

## Ranh giới

Không sửa router/OrderReadPages/OrderPanels/BuyerRecoveryConsent, API/schema,
Auth/shared client, Seller, Address/Cart/Admin. Không thêm flag Buyer hoặc mount
DEV route. Component không đọc/ghi storage, gọi fetch, tạo key hoặc tự resolve.
Chưa chạy browser/mobile/theme/live Backend/DB cho module UI này; các ca reload
trong test chỉ unmount/remount với metadata giả lập và callback spy. Test #95
không được tính là live/browser của nhánh này. G-FULFILMENT vẫn IN_PROGRESS.

CSS dùng Inter/system và token cam đã merge, panel sáng độc lập trong theme tối,
control min-height44px/focus-visible và breakpoint600px. Chưa nghiệm thu visual
hoặc accessibility bằng browser chỉ từ CSS/jsdom.
