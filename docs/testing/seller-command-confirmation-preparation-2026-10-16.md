# Chuẩn bị khung xác nhận Seller — 16/10/2026

Trên nhánh #60, base develop035656b. #58/#60 chưa có reviewer phản hồi tại lúc
bắt đầu đợt này. Không có Backend resolution hoặc quyền bật POST mới.

## Đã làm

`SellerCommandReview` là component trình bày, chưa import/mount trong route.
Nó không import adapter, không đọc/ghi storage, không tạo key, không gọi HTTP.
Callback để trống mặc định khiến checkbox và nút xác nhận bị khóa. Nhãn
“BẢN CHUẨN BỊ” giữ nguyên để không nhầm với chức năng đã tích hợp.

| Phase (trạng thái giao diện) | Hiển thị / điều kiện |
|---|---|
| confirm-new | Mã đơn + đúng hành động; checkbox xác nhận riêng; fresh=false khóa gửi; có Hủy xác nhận nếu parent cung cấp |
| outcome-unknown | Chưa rõ kết quả; chỉ đề xuất gửi lại cùng yêu cầu có xác nhận; không nút bỏ qua/xóa pending |
| sending | Khóa thao tác; không suy rollback từ mất kết nối |
| acknowledged-refreshing | Đã ghi nhận lệnh, đang GET lại; không gửi lệnh kế tiếp |
| acknowledged-refresh-error | Báo rõ lệnh đã ghi nhận; chỉ callback tải lại GET, không POST mới |
| blocked | Không xác minh được pending; không nút bypass |

Component chỉ nhận ba command chuẩn bị Seller. Actor/role/active/session không
khớp thì không hiện Order cũ. Khi đổi Order/command/phiên/phase, confirmation
cũ không được tái dùng. Latch đồng bộ khóa double click, lỗi callback vẫn giữ
khóa; parent phải quyết định chuyển sang unknown/blocked. Không tự sửa trạng thái.

## Caller tương lai bắt buộc làm gì

- Lấy Auth/Store đã xác minh; Backend vẫn quyết định ownership/state/Payment.
- Giữ coordinator instance ổn định, generation check cả trước/sau async và unmount.
- New command: kiểm orderActions + detail/Store mới trước confirmation và dispatch.
- Replay: phải lấy intent thực từ journal và dùng key cũ. Không lấy GET thấy trạng
  thái đích làm receipt; không dùng prop của component thay kết quả đọc storage.
- Full receipt validator → acknowledge đúng pending → GET mới. GET lỗi hiển thị
  acknowledged-refresh-error, không gọi là POST thất bại hoặc mở bước kế tiếp.
- Callback Promise của component không có quyền tự clear pending; settlement khi
  bị từ chối vẫn chờ #58 chốt và Backend triển khai trong PR riêng.

## Kết quả và giới hạn

- 19 component tests mới (jsdom, callback spies; không HTTP/DB/browser).
- Tổng FE 386 PASS /6 opt-in live SKIP,27filesPASS/1SKIP.
- Bao phủ default-disabled,3commands, confirmation/cancel, fresh gate, unknown
  replay, sending/refreshing/blocked, receipt-success/GET-fail,5loại phiên sai,
  đổi Order/command reset checkbox, callback reject không mở submit mới.
- Lint/build và diff-check phải kiểm trên head bàn giao; không dùng jsdom làm
  bằng chứng giao dịch thật hoặc full accessibility.
- Không đổi router/OrderReadPages/Backend/schema/Auth/contract/lockfile, không
  bật onAction trong OrderDetailPanel. #59 UI cam không là dependency bắt buộc;
  component dùng token có fallback, không copy code unmerged từ #59.

## Checklist khi đủ điều kiện nối runtime — tất cả NOT_RUN trong đợt này

1. Buyer tạo COD thật → Seller mở đúng Store/Order; từng bước confirm/packing/ready
   có confirmation riêng, một receipt/history, kho/Payment/outbox không đổi.
2. Click+Enter/bấm đôi, hai tab/hai request cùng key; server chỉ một effect.
3. Cắt response sau server commit → reload → không auto resend → xác nhận replay
   với key cũ → receipt gốc, không transition/history lần hai.
4. Timeout trước/đang xử lý; không suy server rollback, không tạo key mới.
5. Logout/login khác account và cùng account phiên mới khi POST còn chờ; callback
   cũ không clear pending, đổi UI hoặc hiển thị Order cũ cho phiên mới.
6. Receipt hợp lệ rồi GET lỗi: báo đã ghi nhận/chưa tải lại; retry chỉ GET.
7. HTTP lỗi/200malformed/storage lỗi: không clear/bypass; đối chiếu theo gate #58.
8. Pending cho Order khác khóa lệnh mới; không xóa khi chuyển route hoặc logout.
9. Store SUSPENDED xử lý đơn cũ; Seller inactive/sai owner bị chặn, không gửi chéo.
10. Hai key cạnh tranh, rollback history/receipt và protocol resolution phải kiểm
    qua PostgreSQL/hai process, không coi latch React là bảo đảm tồn kho/giao dịch.
