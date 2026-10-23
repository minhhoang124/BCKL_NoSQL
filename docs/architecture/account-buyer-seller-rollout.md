# Một tài khoản mua và bán — chuyển đổi theo từng đợt

Ngày 23/10/2026. Yêu cầu đã chốt `SCOPE-ROLE-001`, không đề nghị bỏ hoặc hạ P0.
Nền triển khai `develop 06eb4fd`. Hoàng phụ trách, Hiền review Auth/dữ liệu/nghiệp vụ;
Đạt review khi đổi điều kiện public/index. Không sửa các PR đang chờ review.

## 1. Kết quả audit

| Miền | Chốt quyền hiện tại | Việc cần làm |
|---|---|---|
| Đăng ký | `accountType=SELLER` cấp role SELLER trực tiếp | Tách đăng ký tài khoản khỏi cấp quyền bán; giữ tương thích rõ ràng với UI/client cũ |
| Store | Controller chỉ SELLER, tạo Store PENDING; duyệt không bổ sung quyền tài khoản | USER cần được gửi/xem/sửa hồ sơ Store của mình; cấp quyền bán gắn duyệt atomic |
| Buyer Backend | Guard và service đều so role USER | Đợt A: quyền Buyer riêng, opt-in cho SELLER; không tạo role hierarchy toàn cục |
| Buyer Web | Nền develop kiểm USER ở route/menu/pages/hooks/workspace | Nhánh này đã nối policy UI sau cờ QA; chưa bật trên develop |
| Order recovery | Buyer/Seller là hai ngữ cảnh, receipt/hash/actorScope có contract riêng | Giữ actorType BUYER của đơn mua dù tài khoản còn quyền SELLER; không đổi receipt/hash cũ |
| Product/Search | Store ACTIVE + chủ tài khoản hợp lệ + policy Product | Khi chuyển membership phải cập nhật toàn bộ điều kiện public cùng outbox/reconciliation |
| Chat | Policy phân vai USER/SELLER, chưa runtime | Sau chuyển quyền dùng membership Conversation/ownership, không suy bên hội thoại chỉ từ role |
| Admin | Role ADMIN riêng, Accounts filter theo enum cũ | Không mở đăng ký Admin; cập nhật bộ lọc/nhãn khi membership được tích hợp |

## 2. Đợt A — Backend đã triển khai trên nhánh riêng

Không thay schema hoặc dữ liệu, JWT, đăng ký, Store và quyền quản trị. Không
thêm role mới, không đổi `RolesGuard` thành SELLER luôn kế thừa mọi USER route.

`ACCOUNT_BUYER_ACCESS_ENABLED=false` mặc định. Khi đúng literal `true`,
`canActAsBuyer(role)` nhận USER hoặc SELLER; ADMIN/giá trị khác bị từ chối.
`@BuyerAccess()` chỉ đánh dấu các endpoint Buyer đã audit. Guard chỉ mở SELLER
khi endpoint có marker này **và** danh sách quyền gốc có USER. Service đọc lại
role/isActive trong transaction hiện hành và dùng cùng policy; không tin role
từ body/query hoặc claim cũ. Cờ là cấu hình deployment, không phải API bật/tắt
trong khi giao dịch chạy; không được đổi động giữa các replica.
Tắt cờ không hoàn tác giao dịch đã commit. Trước khi rollback deployment phải
đối chiếu/drain các yêu cầu Buyer của Seller còn chờ; không xóa journal để né
403 và không tự tạo key mới. Đợt A chỉ bật ở QA, chưa có pending production mới.

Đã nối Address, Cart, Checkout preview/create/lookup, Buyer Order list/detail,
cancel/complete/resolve. Scope SQL vẫn `buyerId=actorId`, không chuyển sang
`Store.sellerId` vì tài khoản có role SELLER. Audit vẫn `actorType=BUYER`.
Quyền Seller/Admin không được nới; Store của người mua bị SUSPENDED không chặn
mua tại Store khác. Khóa tài khoản vẫn chặn cả hai phía bằng DB canonical.

Đây là lát cắt quyền mua bổ sung, **chưa hoàn thành SCOPE-ROLE-001**. Không bật
cờ trên bản dùng chung trước khi review. Không coi cờ Backend là toàn bộ
capability architecture hoặc thay thế quy trình cấp quyền sau duyệt Store.

### Nối Web cùng nhánh, opt-in QA

`VITE_ACCOUNT_BUYER_ACCESS_ENABLED=false` mặc định, tách khỏi cờ Backend.
Khi cùng bật hai cờ trong QA, `hasBuyerAccess` cho tài khoản SELLER active vào
Cart/Checkout/Address/đơn mua; Header có cả Giỏ hàng và Kênh người bán. Guard
route vẫn phải có prop `buyerAccess` riêng, không nới `hasRole` toàn cục.
Account/page/hook/workspace dùng cùng policy UI, không chỉ mở router.

Auth user và JWT vẫn role SELLER. Trong Buyer recovery, trường `actor.role=USER`
giữ nghĩa **ngữ cảnh Buyer** của contract/journal cũ, không sửa Auth state hoặc
giả token. `authSessionVersion`, actorId và proof validators vẫn kiểm phiên thật;
receipt/history dùng BUYER. Không đổi hash, key hay xóa pending cũ khi chuyển khu.
Một pending của Seller ở slot chung có thể chặn Buyer và ngược lại: fail-closed,
không tách storage bằng cách bỏ qua mã cũ. Nhiều pending độc lập là đợt riêng.

## 3. Các đợt tiếp theo và điều kiện tích hợp

1. Review đợt A, kết quả hồi quy và cách giữ namespace Order; ghép QA riêng.
2. Web đã nối sau cờ QA; tiếp tục review lớp kiểm quyền Buyer cho router/menu/pages/hooks; giữ nguyên
   identity phiên thật. Journal lưu ngữ cảnh BUYER/SELLER, không giả tài khoản
   đổi role và không xóa pending cũ. Kiểm thao tác hai phía trên cùng tài khoản,
   reload, đổi tài khoản, cùng key khác command và response cũ về muộn.
3. Chốt membership bền vững: BUYER là quyền cơ bản; quyền bán bổ sung qua Store
   được duyệt, quyền Admin độc lập. Giữ cột role cũ trong giai đoạn tương thích.
   Migration mới, không sửa checksum cũ; không đoán lịch sử duyệt của tài khoản
   SELLER legacy chỉ từ enum. Lập danh sách legacy thiếu bằng chứng để review.
4. Registration/onboarding: tài khoản mới không tự được quyền bán theo
   `accountType`; người chưa có Store được gửi hồ sơ PENDING. Duyệt phải ghi
   Store/history/membership và durable Search work cần thiết trong cùng giao dịch.
   SUSPENDED không tự mở lại; REJECTED nộp lại cùng Store; không tạo Store né khóa.
5. Kiểm upgrade trên dữ liệu cũ, fresh DB, token cũ, khóa/mở tài khoản/Store,
   hai Admin duyệt đồng thời và rollback audit/job lỗi trước khi chuyển mặc định.

**Không chạy migration membership trước review kỹ thuật của Hiền** theo kế
hoạch Product. Yêu cầu nghiệp vụ đã xác nhận; gate này chốt phương án và tương
thích dữ liệu, không phải xin xác nhận lại việc một tài khoản vừa mua vừa bán.

Giữ quy tắc SRS AC-CAR-01/D05: không mua sản phẩm của chính Store mình.
Cart, Checkout preview và Checkout create hiện đã chặn bằng
`SELF_PURCHASE_FORBIDDEN`; quyền Buyer bổ sung không được bỏ qua chốt này.
Không thay luật hoặc tạo ngoại lệ cho tài khoản vừa mua vừa bán trong đợt A.

## 4. Kiểm chứng

Unit: bảng quyền/cờ strict, chỉ marker Buyer được nới, không USER→SELLER hoặc
SELLER→ADMIN. HTTP/PostgreSQL trên DB QA mới loopback5549: Seller có Store đang
bị khóa vẫn mua ở Store khác; Address→Cart→preview→COD; replay cùng key qua app
thứ hai; Buyer/Seller SQL scope riêng; hủy hoàn một lần; giao mô phỏng rồi Buyer
hoàn tất và resolver trả COMMITTED; tài khoản khóa và mặc định tắt.

Các fixture catalog có nhãn; giao Admin mô phỏng qua HTTP, không vận chuyển
thật. Giữ receipt/fence bất biến, không dọn DB demo. Replay qua hai app không
được mô tả thành đã cắt socket thật hoặc kiểm crash OS process.

Chrome19ca đã kiểm tài khoản SELLER dùng Buyer Order thật; Checkout fixture được
tạo qua HTTP, chưa thao tác toàn giỏ/Checkout bằng Chrome. Chưa kiểm onboarding
mới, membership migration, rollback membership, Search loaded-index, Chat đa quyền.
Kết quả số lượng/lệnh
thực chạy được ghi trong báo cáo QA cùng ngày, không suy từ unit thành tích hợp.
