# Kế hoạch đồng bộ toàn bộ giao diện — 30/10/2026

Owner xác nhận sửa toàn bộ và đồng bộ mọi màn. Tài liệu này chốt thứ tự và
điều kiện nghiệm thu, chưa nhận đã thiết kế lại. Giữ logic theo
[bất biến chức năng](ui-redesign-functional-contract-2026-10-29.md).
Hạn nộp08/11; mục tiêu đóng code05/11. Không dồn đổi toàn bộ vào một PR lớn.

## Thứ tự thực hiện

|Đợt|Màn/phạm vi thực tế|Điều kiện đóng|
|---|---|---|
|U0|Inventory và nền tảng dùng chung:layout,navigation,button,input,dialog,table,loading/empty/error/forbidden|Thống nhất màu/chữ/khoảng cách;keyboard/focus/label;desktop/mobile;dữ liệu mô phỏng có nhãn|
|U1|Home,Search chữ/ảnh,ProductDetail,PublicStore|Kết quả/ảnh đúng ProductID;SKU/giá/hết hàng rõ;lọc thực;không render nháp/giá cache sai|
|U2|Cart,Checkout,Address,BuyerOrder list/detail|Desired quantity đúng;preview;giữ intent/reconcile;server price;timeout không tự tạo đơn lần hai|
|U3|Login/Register,Account,verify/reset,Google/phone,Store application|Giữ Origin/cookie/session fences;collision/LINK có consent;OTP/phone mô phỏng ghi rõ|
|U4|Seller Dashboard/listing/options/attributes/SKU/orders/review/aftersales|Typed SINGLE_SELECT/false/0;2axes trước SKU;refresh selected Product;đúng Store;giá/kho không đổi vì đổi layout|
|U5|Admin shell/users/stores/categories/products/orders/aftersales/review/dashboard/health|Action xác nhận/lý do/audit;role guard;không lộ PII;gross/refund/net và kỳ đúng|
|U6|Chat/Product/Order card,Review,Notifications và trạng thái xuyên hệ thống|Text an toàn;chia sẻ chủ động;allowlist thẻ Order;unread/dedupe/session fences|
|U7|Hồi quy xuyên hệ thống và ảnh báo cáo|Chrome desktop/mobile,sáng/tối;login→Search→SKU→COD→Seller→Buyer→hậu mãi/Chat;ảnh cùng release cuối|

Các route công khai `/products/:id`,`/stores/:storeId`;Buyer orders là
`/account/orders`,không phải `/orders` của Web. API đọc đơn vẫn `/orders`.
`/dev/*` là preview fixture, không dùng làm bằng chứng nghiệp vụ và không
đưa vào điều hướng demo công khai. Kiểm từng route theo AppRouter hiện hành.

## Cách chia việc và review

- Codex giữ contract,session/intent,quyền và kiểm API/DB;Antigravity đọc scope
  chọn lọc,đề xuất hoặc review theo từng đợt. Không cho hai bên sửa cùng file
  đồng thời;reviewer không tự nhận test đã chạy.
- Argon/Claude tối đaMedium cho logic/quyền/giao dịch và review cuối;FlashHigh
  cho inventory,copy,state matrix và soát tính nhất quán. Không cần gọi nhiều
  model cho cùng một nhận xét;response rỗng/timeout không tính review.
- Mỗi PR ghi màn thay đổi,ảnh trước/sau,actor/dữ liệu,bằng chứng regression
  và giới hạn. Ưu tiên sửa sai tiền/kho/lộ dữ liệu trước tính thẩm mỹ.
- Đổi shell trước rồi từng nhóm màn;không đổi API/schema chỉ để khớp mockup.
  Shared component nhận data/handlers,không tự phát sinh business mutation.

## Bốn tiêu chí owner yêu cầu

1. **Ổn định:** trạng thái rõ,reload/retry an toàn,không mất phiên hoặc ghi trùng.
2. **Thực tế:** hiển thị phí/trạng thái/giới hạn đúng dữ liệu;không giả provider
   hoặc logistics;cho người dùng biết kết quả chưa xác định và cách đối chiếu.
3. **Dễ mở rộng:** shared primitives,tokens và feature components;không chép
   logic giá/quyền vào từng page hoặc đóng schema theo một dataset.
4. **Cẩn thận:** actor/store/session fences,không lưu PII/secret trong journal,
   review độc lập và kiểm phản ví dụ sau mỗi thay đổi.

Chưa chọn mỹ thuật cuối hoặc tự đổi brand ở tài liệu này. Ngày30/10 ưu tiên
nghiệm thu và chốt inventory;triển khai visual theo đợt riêng sau checkpoint.
