# Chat Product context —24/10/2026

Lát cắt riêng từ develop7596e0f. Chưa toàn Chat DONE; Order card/media/video
không nằm trong PR này. Không sửa API FastAPI hoặc phát thêm Search job.

## Gửi và lưu

POST `/chat/conversations/:id/messages` hoặc socket message:send dùng body
`{clientMessageId,type:"PRODUCT_CONTEXT",contextProductId:125}`. Không content,
title/price/image hoặc sender/store client để cấp quyền. User được lấy từ JWT;
Buyer/Seller phải là thành viên hiện hành, Store phải cho gửi theo policy cũ.
Trong cùng Serializable transaction và khóa Conversation: lookup replay/hash,
đọc Product + Category ancestors bằng public-listing policy; Product phải thuộc
đúng Store và công khai. Cùng key/payload trả receipt gốc, khác type/ID409.
Nhánh mới chỉ chạy khi `CHAT_PRODUCT_CONTEXT_ENABLED=true`; mặc định false.

Migration22 thêm `contextProductId` nullable, không FK Product hoặc snapshot.
Không sửa migration20/21, không backfill/đổi Message TEXT cũ. Check DB bắt ID>0
và placeholder cố định khi tham chiếu có giá trị; history immutable bảo vệ cả
tham chiếu mới. Type phân biệt bằng nullable reference và hash payload có type,
không dựa trên chuỗi placeholder. TEXT có cùng chuỗi vẫn là TEXT khác hash.
Rollback append giữ counter/history nhất quán. Không tồn tại Product thì không
gửi mới; replay sau ẩn/xóa vẫn chỉ trả reference cũ, không tên/ảnh/giá nháp.

## Đọc và Web

TEXT response giữ7field như trước. Chỉ reference message thêm
`productContext:{productId,storeId}`; storeId lấy Conversation, không JOIN Product
đã xóa. Inbox/history/send dùng chung projection. Socket push chỉ là hint và
placeholder, Web tải lại history có sequence như cũ.

Product detail dẫn `/messages?storeId=N&productId=M`; mở hội thoại không tự gửi.
Người dùng bấm Chia sẻ; khóa doubleclick, giữ bản nháp TEXT chưa gửi. Journal
chỉ thêm Product ID cùng key/placeholder, không lưu snapshot. Timeout/mất
response/reload không tạo key mới; explicit retry gửi cùng type/ID/key.
Receipt phải đúng conversation/sender/Product ID rồi mới xóa journal đúng raw.

Thẻ tải GET public `/products/:id`, kiểm ID/Store và dữ liệu, không gọi Seller
draft endpoint. Chỉ dùng ảnh upload cùng Backend, chặn host lạ/dot segments.
Đổi reference remount state; response cũ không gắn title vào link mới. HTTP lỗi/
Productẩn trả unavailable, không lưu localStorage/cache snapshot. Refresh30s
khi tab hiển thị; không hứa xóa hồi tố thông tin công khai người dùng đã thấy.
Giá là **giá hiện tại**, không thay Order snapshot hoặc xác nhận giá Checkout.

## Rollout và giới hạn

Migrate trước BE; deploy FE hiểu field mới trước bật
`CHAT_PRODUCT_CONTEXT_ENABLED` và `VITE_CHAT_PRODUCT_CONTEXT_ENABLED`. Cả hai
mặc định false, cùng gate Chat. Client TEXT cũ strict có thể từ chối reference;
không bật khi còn client cũ chưa nâng cấp. Kill-switch ngừng gửi context mới,
không xóa lịch sử cũ hoặc chặn replay receipt đã commit. Replay vẫn kiểm quyền
gửi hiện hành; kill-switch không khôi phục quyền đã thu hồi.

Một unknown pending/actor/tab vẫn chặn gửi mới. Nếu Product/Store mất quyền,
giữ mã chờ thay vì đoán request trước rollback; chưa có Chat resolver giống
Order. Không tự đổi key để thoát khóa. Tab đóng có thể mất pending như nền cũ.
Thẻ public tải riêng từng message, chưa batch/dedup hoặc benchmark lịch sử lớn.
Đây là giới hạn mở rộng cần tối ưu bằng projector có kiểm quyền, không dùng
snapshot nháp để né tải. Không tính proof Product upload hoặc chất lượng Search.

## Biến

- `contextProductId`: ID tham chiếu tùy chọn trong chat_messages, không tên/giá.
- `productContext.storeId`: Store bất biến của Conversation, không gửi trong body.
- `sharedProduct`: khóa UI chống bấm liên tiếp lại cùng thẻ sau receipt trong mount.
- `clientMessageId/payloadHash`: mã gửi lại/hash canonical cũ, có type/Product ID.
