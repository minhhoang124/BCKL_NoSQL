# Phạm vi triển khai và mức độ hoàn thiện

Tài liệu này là nguồn chuẩn để cả nhóm và coding agent phân biệt chức năng bắt buộc, chức năng triển khai cơ bản và nội dung chỉ đề xuất mở rộng. Mục tiêu là bảo đảm nội dung báo cáo khớp với phần mềm có thể chạy, kiểm thử và trình diễn.

Chat trực tiếp User-Seller được bổ sung vào phạm vi bắt buộc theo decision record dưới đây. Nếu tài liệu kế hoạch cũ chưa nhắc đến Chat, tài liệu này và `docs/architecture/chat-domain-design.md` được ưu tiên cho phạm vi hiện hành sau khi PR #7 được reviewer nghiệp vụ chấp thuận.

| Decision ID | Quyết định | Người xác nhận/chịu trách nhiệm | Ngày | Điều kiện bảo vệ tiến độ |
|---|---|---|---|---|
| `SCOPE-CHAT-001` | Chat văn bản User-Seller là P0 của bản bảo vệ | Võ Minh Hoàng xác nhận phạm vi và chịu trách nhiệm triển khai; Nguyễn Quốc Hiền review nghiệp vụ/test qua PR #7; Nguyễn Cao Dũng Đạt chỉ xác nhận ranh giới với Product/Search | 11/09/2026 | Thiết kế sớm nhưng chỉ code sau Auth, Store và Product; không được làm trễ Product, Search, Cart/Order/COD. Nếu tiến độ rủi ro, giữ đúng MVP text/history/realtime/read-state và không mở rộng tính năng P2. |
| `SCOPE-PAYMENT-001` | VNPay/MoMo sandbox là P1 cam kết triển khai | Võ Minh Hoàng chịu trách nhiệm Payment model, Backend và tích hợp sandbox; Nguyễn Quốc Hiền cập nhật SRS/Use Case/ERD/sequence/test case; Nguyễn Cao Dũng Đạt không phụ trách miền Payment | 11/09/2026 | Chỉ triển khai sau khi Order, COD và Payment model ổn định. Phạm vi dừng ở môi trường sandbox, xác minh callback và cập nhật trạng thái idempotent; production, hoàn tiền trực tuyến, ví Seller và đối soát thật vẫn là P2. Credential/secret thử nghiệm chỉ nằm trong `.env` và không được commit. |

## 1. Nguyên tắc báo cáo trung thực

- Chức năng được trình bày là **đã xây dựng** phải chạy được trên bản tích hợp, có dữ liệu demo và có bằng chứng kiểm thử.
- Chức năng mới có schema, giao diện tĩnh hoặc tài liệu nhưng chưa hoàn thành luồng không được mô tả là đã triển khai.
- Chức năng chưa đủ thời gian phải ghi rõ là **thiết kế dự phòng**, **giới hạn hiện tại** hoặc **hướng phát triển**.
- Ưu tiên hoàn thiện luồng end-to-end hơn việc tạo nhiều màn hình không hoạt động.
- Không mở rộng chức năng nếu làm ảnh hưởng các luồng bắt buộc hoặc mốc đóng băng chức năng.

## 2. P0 - Bắt buộc hoàn thiện và demo được

### 2.1 Nền móng và tài khoản

- React gọi được NestJS Backend.
- Backend kết nối PostgreSQL và có migration tái lập được.
- Đăng ký, đăng nhập, access token, refresh token và đăng xuất.
- Phân quyền `USER`, `SELLER`, `ADMIN`; client không được tự nâng quyền.
- Swagger/API documentation, validation và xử lý lỗi nhất quán.

### 2.2 Store và sản phẩm đa ngành hàng

- Seller tạo và quản lý Store của mình.
- Admin quản lý cây Category cha-con và thuộc tính theo Category.
- Seller tạo, sửa, lưu nháp, gửi duyệt và ẩn Product.
- Product hỗ trợ ảnh, thuộc tính mô tả, nhóm phân loại và ProductVariant.
- Giá và tồn kho nằm ở ProductVariant; sản phẩm không phân loại có variant mặc định.
- Admin duyệt, từ chối hoặc đóng băng Product và lưu lý do.
- Chỉ Product đủ điều kiện và được duyệt mới xuất hiện công khai.

Thiết kế chi tiết được quản lý tại `docs/architecture/product-domain-design.md` sau khi PR tương ứng được review và merge.

### 2.3 Tìm kiếm truyền thống và AI

- FastAPI Search Service quản lý Elasticsearch, CLIP/FAISS và RRF; NestJS gọi endpoint hợp nhất rồi hydrate/lọc dữ liệu hiện hành bằng PostgreSQL.
- Keyword search bằng Elasticsearch.
- Tìm kiếm ngữ nghĩa văn bản và tìm kiếm bằng ảnh qua CLIP + FAISS.
- RRF hợp nhất kết quả và trả về `productId` thống nhất.
- Bộ lọc tối thiểu theo Category, Brand và khoảng giá.
- Product tạo/sửa/ẩn được đồng bộ sang hoặc loại khỏi index phụ trợ.
- Có search log, click log và thời gian phản hồi.
- Có thực nghiệm Precision@K, Recall@K tại các K đã chốt và thời gian phản hồi.

### 2.4 Giỏ hàng, tồn kho và đơn COD

- CartItem tham chiếu `variantId`.
- Kiểm tra lại giá, trạng thái và tồn kho khi checkout.
- Tạo Order và OrderItem snapshot trong transaction.
- Đơn nhiều Store được tách theo Store hoặc có quy tắc xử lý rõ ràng.
- COD có trạng thái thanh toán tách khỏi trạng thái đơn hàng.
- Seller xác nhận, chuẩn bị, giao và hoàn tất đơn.
- User xem danh sách, chi tiết và lịch sử trạng thái đơn.
- Hủy đơn cơ bản có lý do và hoàn tồn kho đúng một lần.
- Có lịch sử thay đổi trạng thái; client không tự gán trạng thái tùy ý.

### 2.5 Chat trực tiếp User-Seller

- User bắt đầu chat với Store từ trang Product.
- User và Seller gửi/nhận tin nhắn văn bản thời gian thực.
- PostgreSQL lưu lịch sử; tải lại trang không mất tin nhắn.
- Có danh sách hội thoại, phân trang tin nhắn, trạng thái đã đọc và số chưa đọc.
- Chỉ User trong hội thoại và Seller sở hữu Store được truy cập; nhân viên/`StoreMember` chưa thuộc MVP.
- Thiết kế và tiêu chí nghiệm thu nằm tại `docs/architecture/chat-domain-design.md`.

### 2.6 Đánh giá, Admin và Dashboard

- User chỉ đánh giá OrderItem đủ điều kiện; một OrderItem không bị đánh giá lặp trái phép.
- Seller phản hồi đánh giá; Admin có thể ẩn nội dung vi phạm.
- Admin quản lý User, Seller, Category và kiểm duyệt Product.
- Seller Dashboard có doanh thu ngày/tháng/quý và số liệu đơn hàng cơ bản.
- Admin có thống kê tổng quan và quan sát được trạng thái dịch vụ tìm kiếm ở mức phù hợp.

### 2.7 Hoàn thiện và bàn giao

- Giao diện User và Seller responsive ở các màn hình chính.
- Docker Compose khởi động được các thành phần bắt buộc.
- Migration, seed nhỏ, `.env.example` và hướng dẫn chạy fresh checkout đầy đủ.
- Có unit/integration/e2e test phù hợp, test case nghiệp vụ, bug report và demo script.
- Không commit secret, dataset lớn, ảnh runtime, model weight, embedding hoặc FAISS index.

## 3. P1 - Cam kết triển khai sau khi nền P0 liên quan ổn định

### Thanh toán VNPay/MoMo sandbox

- Dùng chung `Payment`/`PaymentTransaction` với COD; trạng thái thanh toán tách khỏi `OrderStatus`.
- Backend tự lấy `orderId`, số tiền và nội dung thanh toán từ PostgreSQL; không tin số tiền do client gửi lên.
- Backend tạo phiên thanh toán sandbox và lưu mã giao dịch/tham chiếu cần thiết để đối chiếu.
- Chỉ cập nhật thanh toán thành công sau khi xác minh chữ ký callback/IPN hợp lệ; trang redirect phía trình duyệt không phải bằng chứng thanh toán cuối cùng.
- Callback gửi lặp phải được xử lý idempotent, không ghi nhận thanh toán hoặc thay đổi đơn hàng hai lần.
- Có luồng thất bại, hủy, hết hạn và thanh toán đang chờ; không đồng nhất mọi lỗi thanh toán với hủy Order.
- Chỉ dùng môi trường sandbox, không giao dịch tiền thật. Production, hoàn tiền trực tuyến, ví Seller và đối soát thật không thuộc phạm vi triển khai này.
- API key, secret và test credential chỉ cấu hình qua `.env`; `.env.example` chỉ chứa tên biến và giá trị mẫu không nhạy cảm.
- Hiền cập nhật SRS, Use Case, ERD, sequence và test case theo phạm vi trên; chỉ ghi **đã triển khai** sau khi có code chạy, dữ liệu demo và bằng chứng kiểm thử.

### Vận chuyển

- Snapshot địa chỉ giao hàng trong Order.
- Khối lượng kiện hàng, mã vận đơn và đơn vị vận chuyển mô phỏng.
- Các trạng thái chuẩn bị hàng, đang giao, đã giao và giao thất bại.
- Không bắt buộc tích hợp API của hãng vận chuyển thật.

### Hủy đơn

- User/Seller chỉ hủy ở trạng thái được phép.
- Có người thực hiện, lý do, thời gian và lịch sử.
- Khôi phục tồn kho trong transaction và chống hoàn kho lặp.

### Đánh giá

- Điểm 1-5, nội dung và phản hồi Seller.
- Ảnh đánh giá là tùy chọn nếu không ảnh hưởng tiến độ.

## 4. P2 - Thiết kế dự phòng hoặc hướng phát triển

Các nội dung sau không được mô tả là đã triển khai nếu chưa có luồng chạy và kiểm thử:

- Trả hàng, hoàn tiền một phần/toàn phần, tranh chấp và bằng chứng.
- Voucher, flash sale và chương trình khuyến mãi phức tạp.
- Nhiều Warehouse và phân bổ tồn kho theo khu vực.
- Tích hợp đơn vị vận chuyển thật và tính phí vận chuyển thực tế.
- Thanh toán trực tuyến production, hoàn tiền trực tuyến, ví Seller, đối soát và rút tiền. VNPay/MoMo sandbox cơ bản thuộc P1 theo `SCOPE-PAYMENT-001`.
- Kiểm duyệt thương hiệu, giấy phép và hồ sơ pháp lý chuyên sâu.
- Livestream, affiliate, quảng cáo và gợi ý cá nhân hóa.
- Chat gửi file/ảnh, gọi thoại/video, thu hồi tin, typing indicator và chatbot.

Nếu một mục P2 được chọn làm điểm cộng, phải có issue, acceptance criteria, người phụ trách và không làm chậm P0.

## 5. Phân công và điểm giao

| Phạm vi | Người chính | Phối hợp/review |
|---|---|---|
| Database, API, User/Seller, Cart/Order/COD, Chat | Hoàng | Hiền review nghiệp vụ và test |
| SRS, Use Case, ERD, Admin, test case, dataset QA | Hiền | Hoàng review khả năng triển khai |
| CLIP, FAISS, Elasticsearch, RRF, thực nghiệm | Đạt | Hoàng review tích hợp Backend |
| Dataset metadata và ground truth | Hiền + Đạt | Hoàng review khả năng import |
| Contract Backend-AI | Hoàng + Đạt | Hiền đối chiếu tài liệu |
| Product domain và migration dùng chung | Hoàng | Hiền review nghiệp vụ; Đạt review phần search/import |

Đạt không phải thiết kế chi tiết COD, Chat hoặc trạng thái giao hàng. Đạt phải tham gia khi thay đổi ảnh hưởng metadata, Product công khai, payload index, filter, search log, `productId`, `externalId` hoặc `version`.

## 6. Definition of Done cho chức năng báo cáo

Một chức năng chỉ được đánh dấu hoàn thành khi:

1. Acceptance criteria kiểm tra được đã được chốt.
2. Database/migration, Backend và Frontend cần thiết đều có trên nhánh tích hợp.
3. Phân quyền, validation, trạng thái lỗi và ownership đã được kiểm tra.
4. Có test tự động phù hợp hoặc test case thủ công có bằng chứng.
5. Fresh checkout có thể chạy theo tài liệu.
6. API/ERD/SRS đã khớp với code hiện tại.
7. CI thành công và có ít nhất một reviewer khác chấp thuận.
8. Demo script chỉ sử dụng dữ liệu và chức năng tồn tại thật.

## 7. Thứ tự triển khai khuyến nghị

```text
Foundation + Auth
→ Product domain
→ Store/Category/Product/Variant/Image
→ Product moderation
→ Cart + stock transaction
→ Order + COD + shipping cơ bản
→ VNPay/MoMo sandbox
→ AI Search integration
→ Chat User-Seller
→ Review + Admin + Dashboard
→ Docker + E2E + báo cáo + demo
```

Chat được thiết kế sớm nhưng chỉ bắt đầu code khi Auth, Store và Product đã ổn định vì Conversation phụ thuộc `userId`, `storeId` và có thể mang ngữ cảnh `productId`.
