# Đối chiếu SRS với triển khai — 23/10/2026

## Căn cứ và giới hạn

Đối chiếu SRS v3.1 (`docs/analysis/hien/srs-v3.md`), implementation-scope,
schema, controller/service và route/page thực tế. Nền remote mới nhất kiểm được:
`develop a91db91e74fc686863d27dbcebf04bd4fe5f009b`, đã merge #94 lúc
06:39:05 UTC ngày 23/10. Khi bắt đầu rà còn ở `06eb4fd`; báo cáo đã cập nhật sự kiện
merge, không tính #94 là còn thiếu Backend ghi. Không merge hoặc chạy lại test
nghiệp vụ trong lượt audit này. Đây không phải kiểm toán bảo mật đầy đủ.

Các PR còn mở lúc chốt: #97, #101, #102, #104, #105, #106. Code/bằng chứng trên
nhánh không tự trở thành chức năng chính thức trên develop. Không quy số test
thành phần trăm hoàn thiện hoặc tự hạ P0/P1 xuống P2.

## 1. Chưa đáp ứng đầy đủ trong phạm vi phải làm

| Yêu cầu | Phạm vi | Tình trạng / phần thiếu | Bằng chứng code chính |
|---|---|---|---|
| ACC-01, STO-01/02: một tài khoản mua/bán và onboarding | P0 | Develop còn một role; đăng ký SELLER trực tiếp; USER chưa gửi hồ sơ Store rồi được duyệt cấp quyền. #106 mới opt-in Seller hiện có mua hàng, chưa sửa signup/onboarding/membership. | `BE/src/auth/auth.service.ts`, `BE/src/store/store.controller.ts`, `BE/prisma/schema.prisma`, PR106 |
| ACC-03: cập nhật hồ sơ | P0 | Sổ địa chỉ có thật; chưa có luồng sửa hồ sơ tài khoản tương ứng tên/liên hệ/avatar. UserAddress.phone không phải số liên hệ hồ sơ. | User model; `BE/src/auth/auth.controller.ts`; `FE/src/pages/AccountPage.tsx` |
| ACC-04: đổi mật khẩu khi đăng nhập | P0 | Không thấy endpoint xác thực mật khẩu cũ → đổi mật khẩu → thu hồi mọi refresh session. | Auth controller/service |
| STO-01: hồ sơ Store đầy đủ | P0 | Có tên/mô tả, trạng thái/history, từ chối–nộp lại; thiếu liên hệ và địa chỉ lấy/hoàn theo SRS. Không được gọi toàn onboarding đã xong. | Store model; create/update Store DTO |
| STO-02: trang Store công khai | P0 | Có lọc Product theo storeId; chưa thấy route/page hồ sơ Store công khai hoàn chỉnh. Lọc theo Store không thay trang Store. | `FE/src/routes/AppRouter.tsx`, marketplaceApi, public Product controllers |
| PRD-01: Seller hoàn thiện Product đa ngành | P0 | Backend có attributes/options/variants/ảnh/shipping; UI Seller mới có form cơ bản, thêm variant với optionValueIds rỗng, ảnh chính và weight. Chưa editor đủ thuộc tính, nhóm/lựa chọn SKU, chỉnh từng SKU và quản lý ảnh theo lựa chọn. | `FE/src/pages/SellerDashboardPage.tsx`, ProductService/controller |
| CAT-01: Admin ghi Attributes xuyên suốt | P0 | Backend #94 vừa merge. UI đọc/DEV/preparation đã có, nhưng editor ghi production và nghiệm thu hai Admin/mất phản hồi còn phải nối, không báo toàn chức năng DONE từ API. | AdminDashboardPage/Catalog; features admin-category-attributes; PR94 |
| MED-01, D09: ảnh nháp private, URL nội bộ có hạn | P0 | Upload có decode/staging/compensation/repair; main vẫn phục vụ UPLOAD_ROOT bằng static `/uploads/` không kiểm auth tại đường này. Chưa thấy signed/expiring media flow theo SRS. Đây là khoảng thiếu bảo vệ media từ code, chưa chạy khai thác URL trong lượt rà. | `BE/src/main.ts`, ProductImageStorageService |
| SRC-01: tìm bằng ảnh trên Web chính thức | P0 | Gateway #102 và Web #104 còn Draft/chưa merge, Web mặc định tắt. #105 báo QA loaded CLIP/FAISS/dual-index nhưng chưa browser Search UI; cần review bằng chứng, không gọi thiếu toàn AI runtime. | SearchController develop; AppRouter/HomePage; PR102/104/105 |
| CHT-01: Chat | P0 | Mới policy/validation và thử nghiệm SQL; chưa Conversation/Message/ReadState, module/REST/WebSocket/inbox runtime. Chưa gửi text/lưu lịch sử/realtime/đã đọc. | `BE/src/chat/`, Prisma models, FE routes |
| REV-01: đánh giá sản phẩm | P0 | Chưa model/API/UI Review gắn OrderItem COMPLETED, Seller phản hồi và Admin ẩn/audit. Review Store hiện có là xét duyệt Store, không đánh giá sao. | Prisma models; BE/FE routes |
| NOT-01: thông báo trong ứng dụng | P0 | Chưa thấy notification persistence/inbox/unread/event-recipient dedupe hoặc luồng nhận thông báo sau giao dịch. Toast trên UI không thay inbox bền vững. | Prisma models, controllers, FE routes |
| ADM-01: khóa/mở Accounts an toàn | P0 | Có GET danh sách và PATCH isActive, có job Search theo chủ Store; còn thiếu reason/audit/revision, bảo vệ tự khóa/Admin cuối cùng và UI thao tác tương ứng. Không giao viết lại API danh sách đã có. | AdminAccountController; AuthService.updateAccountStatus; AdminAccountsReader |
| RPT-01: Dashboard nghiệp vụ | P0 | Có tổng số/hàng chờ quản trị cơ bản; chưa API/bảng doanh thu Seller ngày/tháng/quý và đối chiếu gross/net từ COMPLETED/refund. Trang SellerDashboard hiện chủ yếu Store/Product, tên file không chứng minh có doanh thu. | SellerDashboardPage; OverviewPage; thiếu reporting controller/model projection |
| SRC logging / RPT-02 | P0 log cơ bản; P1 thống kê Store | Chưa thấy SearchLog/ClickLog nghiệp vụ và API thống kê query/strategy/rank theo Store. Log vận hành/CSV benchmark không thay tracking trong app. | Prisma models; BE controllers |
| ACC-02: verify/reset/Google/OTP | P1 | Chưa luồng token một lần, OAuth identity/provider-subject, OTP sandbox/rate-limit/expiry. Đăng nhập email @gmail không phải Google OAuth. | Auth controller/User/RefreshToken; FE routes |
| PAY-01: VNPay/MoMo sandbox | P1 | Có Payment COD và enum provider; chưa PaymentAttempt/Transaction, tạo phiên sandbox/callback ký số, timeout giữ kho, xử lý callback muộn/thu trùng. | Payment model; không payment controller/provider adapters |
| RET-01: hậu mãi | P1 | Chưa ReturnRequest/refund adjustment, API Buyer–Seller–Admin, hạn mức OrderItem/hoàn tiền/hoàn kho theo RESTOCKABLE. Admin returns đang disabled/UnsupportedPage. Giao thất bại quay về không thay hậu mãi sau giao. | Prisma; AdminDashboardPage; FE routes |
| NOT-01 email | P1 | Chưa adapter/queue gửi email sau commit và retry có kiểm soát. | BE modules/controllers/schema |
| NFR-OPS/PERF: đóng gói, phục hồi, tải | P0 mục tiêu nghiệm thu | Compose chung mới có PostgreSQL; toolkit QA riêng không thay full-stack Compose. Chưa xác minh đủ backup/restore DB+ảnh hoặc bộ đo 100 request/10 client theo SRS trong lượt này; ghi chưa đủ bằng chứng, không khẳng định mọi thử nghiệm đều chưa từng làm. | `docker-compose.yml`, tài liệu/script testing hiện có |

## 2. Đã có nền/luồng thật, không nên giao viết lại

- Auth email/password, access/refresh rotation, logout và kiểm account hiện hành.
- Address/Cart/Checkout COD, tách Order theo Store, snapshot, stock ledger,
  rollback/replay; Buyer Order list/detail/hủy/hoàn tất và Seller chuẩn bị trên Web.
- Backend giao mô phỏng, lần giao, giao lại và tác vụ tự hoàn tất; Web Admin giao
  hàng, Seller hủy/nhận hàng hoàn chưa khép như các màn Buyer hiện có.
- Product domain đa ngành, CRUD/draft/submit/moderation/public policy, worker
  outbox/reconciliation/repair; keyword/hybrid Backend và Web nền đã có.
- Admin xét duyệt Store/Product, danh mục/Brand và danh sách Accounts đã có.
- Chặn tự mua Store của mình **đã có trong Cart, preview và create Checkout**
  (`SELF_PURCHASE_FORBIDDEN`), đúng AC-CAR-01/D05. Không liệt kê là thiếu.

## 3. Tài liệu có chỗ mô tả lỗi thời hoặc cần sửa cách đọc

1. SRS mục 15 D02/D04/D07/D09 còn ghi PR #18/Backend hydrate/Order/decode ở
   trạng thái TARGET/IN_PROGRESS hoặc lỗi chặn cũ. Phải ghi rõ đây là ảnh chụp
   trạng thái ngày 23–24/09 hoặc cập nhật bằng chứng; không coi các dòng đó là
   trạng thái code ngày 23/10.
2. Tài liệu mới trong PR106 có câu “SRS chưa chốt cấm tự mua” là **không chính
   xác**: AC-CAR-01/D05 đã chốt và code đã chặn. Cần sửa mô tả PR106, giữ nguyên
   luật đang có; đây không phải đề xuất mở tự mua hoặc lỗi runtime đã tái lập.
3. “Đủ 12 truy vấn mới tính chỉ số” đã được nhóm thay bằng quyết định 7 truy vấn/602 cặp.
   [Phạm vi mới](../testing/electronics/evaluation-scope-7q-2026-10-23.md) giữ
   kết quả truy hồi/phép tính; 5 truy vấn thiếu không tính và không gán 0. Nhãn AI hỗ trợ,
   không hai lượt chấm độc lập; không suy chất lượng ảnh/toàn hệ thống.
4. Một số dòng implementation-scope mô tả Seller “giao và hoàn tất” cần đọc
   theo SRS D07 chi tiết: Seller chuẩn bị/bàn giao; Admin/adapter mô phỏng ghi
   giao; Buyer/job hoàn tất. Không mở thêm quyền Seller tự đánh dấu DELIVERED.
5. Các bảng CURRENT/PR cũ trong architecture/SRS là lịch sử, không thay trạng
   thái develop/SHA và bằng chứng mới. P1 vẫn là cam kết, không tự thành P2.

## 4. Thứ tự khép khoảng thiếu

1. Review/tích hợp an toàn quyền mua-bán #106, tiếp tục onboarding/cấp quyền;
   bàn giao Backend Attributes #94 đã merge cho Hiền nối editor production.
2. Khép gateway+Web tìm ảnh #102/#104 với đầu vào QA #105 của Đạt; tách kiểm
   chức năng khỏi đánh giá định lượng của 7 truy vấn. Review ảnh nháp/private media.
3. Khép Seller Product editor, hồ sơ/đổi mật khẩu và trang Store công khai;
   song song Chat persistence→REST→realtime/inbox, Review và notification cơ bản.
4. Hiền nối Admin/Accounts/UI trên API được bàn giao; Hoàng bổ sung status
   hardening, reporting và các API còn thiếu, không giao Hiền tự đoán schema.
5. P1: identity/reset/OTP, sandbox payment, hậu mãi/refund và email; chuẩn bị
   Compose/backup/restore/load evidence xuyên suốt, không để đến ngày demo.

Đây là danh sách khoảng thiếu thực tế, không kết luận tất cả có thể hoàn tất
trong một ngày. Cần cập nhật kế hoạch và mốc đóng băng công khai thay vì báo
“gần xong” hoặc chỉ đếm số PR/test.
