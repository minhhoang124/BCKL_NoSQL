# Phạm vi triển khai và mức độ hoàn thiện

Tài liệu này là nguồn chuẩn để cả nhóm và coding agent phân biệt **phải chạy trong bản bảo vệ khóa luận tháng 12/2026** với **điểm mở rộng sau bảo vệ trên mọi miền nghiệp vụ**. Đợt phát triển dự kiến 12 tuần; các mốc 25/10–08/11 trong bảng phân công là mốc kế hoạch nội bộ cũ, không phải ngày bảo vệ. **P0 và P1 đều là mục tiêu triển khai trước buổi bảo vệ; P1 không đồng nghĩa với “chỉ đề xuất”.** P2 là hướng phát triển tiếp, không phải phần mặc định phải hoàn thành trong 12 tuần. Bản khóa luận phải tích hợp các luồng nhiều Seller bằng tài khoản và dữ liệu demo, có kiểm thử và đánh giá tìm kiếm; khả năng mở rộng về sau là tiêu chí thiết kế, không phải lời khẳng định đã sẵn sàng vận hành thương mại công khai.

Chat trực tiếp User-Seller được bổ sung vào phạm vi bắt buộc theo decision record dưới đây. Nếu tài liệu kế hoạch cũ chưa nhắc đến Chat, tài liệu này và `docs/architecture/chat-domain-design.md` được ưu tiên cho phạm vi hiện hành sau khi PR #7 được reviewer nghiệp vụ chấp thuận.

| Decision ID | Quyết định | Người xác nhận/chịu trách nhiệm | Ngày | Điều kiện bảo vệ tiến độ |
|---|---|---|---|---|
| `SCOPE-CHAT-001` | Chat văn bản User-Seller là P0 của bản bảo vệ | Võ Minh Hoàng xác nhận phạm vi và chịu trách nhiệm triển khai; Nguyễn Quốc Hiền review nghiệp vụ/test qua PR #7; Nguyễn Cao Dũng Đạt chỉ xác nhận ranh giới với Product/Search | 11/09/2026 | Thiết kế sớm nhưng chỉ code sau Auth, Store và Product; không được làm trễ Product, Search, Cart/Order/COD. Nếu tiến độ rủi ro, giữ đúng MVP text/history/realtime/read-state và không mở rộng tính năng P2. |
| `SCOPE-PAYMENT-001` | VNPay/MoMo sandbox là P1 cam kết triển khai | Võ Minh Hoàng chịu trách nhiệm Payment model, Backend và tích hợp sandbox; Nguyễn Quốc Hiền cập nhật SRS/Use Case/ERD/sequence/test case; Nguyễn Cao Dũng Đạt không phụ trách miền Payment | 11/09/2026 | Chỉ triển khai sau khi Order, COD và Payment model ổn định. Phạm vi dừng ở môi trường sandbox, xác minh callback và cập nhật trạng thái idempotent; production, hoàn tiền trực tuyến, ví Seller và đối soát thật vẫn là P2. Credential/secret thử nghiệm chỉ nằm trong `.env` và không được commit. |
| `SCOPE-CORE-001` | Hồ sơ/địa chỉ, Seller onboarding, thông báo, xác thực bổ sung và hậu mãi cơ bản là mục tiêu của bản bảo vệ tháng 12, không chỉ vẽ UI/ERD | Võ Minh Hoàng xác nhận yêu cầu và chịu trách nhiệm tích hợp; Nguyễn Quốc Hiền đối chiếu SRS/Use Case/test và review nghiệp vụ; Nguyễn Cao Dũng Đạt review phần Product/Search bị ảnh hưởng | 15/09/2026 | Review chéo tập trung tính khả thi, dữ liệu, test và thứ tự triển khai; không biến nghiệp vụ này thành P2 chỉ vì code chưa có. Không sửa migration/contract đang ở PR khác chỉ dựa trên bảng này. Tách issue nhỏ và báo rủi ro nếu mốc nội bộ cần điều chỉnh. |
| `SCOPE-ROLE-001` | Một tài khoản User có thể mua hàng và, sau onboarding/duyệt Store, có thêm quyền Seller trong bản bảo vệ; Admin là quyền quản trị riêng, không đăng ký công khai | Võ Minh Hoàng chốt yêu cầu nghiệp vụ và phụ trách Auth/migration; Nguyễn Quốc Hiền review phân quyền/Use Case/test; Nguyễn Cao Dũng Đạt chỉ review nếu payload Product/Search bị ảnh hưởng | 16/09/2026 | Schema hiện có một `Role` duy nhất nên phải có migration mới và kế hoạch tương thích tài khoản cũ. Reviewer chốt cách triển khai kỹ thuật, không phải bỏ yêu cầu nghiệp vụ. Không tự nâng quyền theo email trùng hoặc seed; PR Auth/Product hiện hành không bị sửa lén. |
| `SCOPE-STORE-002` | Store bị từ chối được sửa hồ sơ và nộp lại trên chính bản ghi Store cũ; Store bị tạm khóa không tự mở lại | Võ Minh Hoàng chốt vòng đời/API; Nguyễn Quốc Hiền đồng bộ SRS, ERD và test phân quyền | 16/09/2026 | Trạng thái đích tối thiểu là `PENDING/ACTIVE/REJECTED/SUSPENDED`. Mỗi lần duyệt lưu actor, thời gian và lý do trong history. Nộp lại chỉ hợp lệ từ `REJECTED` về `PENDING`; chỉ Admin được khôi phục `SUSPENDED`. Không tạo Store thứ hai để né quyết định trước. Đây là TARGET cần migration/API riêng, không sửa lén PR schema đang review. |
| `SCOPE-RETURN-002` | Hậu mãi P1 dùng bút toán hoàn tiền và hoàn kho riêng, idempotent; không sửa ngược OrderStatus | Võ Minh Hoàng chốt transaction/API; Nguyễn Quốc Hiền đồng bộ Use Case, ERD, dashboard và test | 16/09/2026 | Hoàn toàn bộ một `OrderItem` đủ điều kiện theo số tiền snapshot do Backend tính. `REFUND_ONLY` không tăng tồn kho; `RETURN_AND_REFUND` chỉ tăng kho sau khi ghi nhận đã nhận lại hàng và hàng `RESTOCKABLE`. Dashboard ghi doanh thu thuần bằng doanh thu đã ghi nhận trừ refund adjustment đúng một lần. Hoàn tiền một phần trong một OrderItem, logistics hoàn thật và tranh chấp nhiều cấp là P2. |

| Phải chạy trước bảo vệ tháng 12 (`P0 + P1`) | Mở rộng/thương mại hóa sau bảo vệ (`P2`) |
|---|---|
| Một tài khoản mua và mở Store sau duyệt; hồ sơ/địa chỉ; email login/verify/reset, Google login, phone OTP sandbox | Facebook/Apple/passkey bổ sung, SMS production, KYC/giấy tờ Seller thật và quy trình pháp lý |
| Store/Product đa ngành hàng, variant/ảnh/kho/kiểm duyệt; keyword, semantic, image search và RRF | Livestream, affiliate, quảng cáo, gợi ý cá nhân hóa, nhiều kho/phân bổ tồn theo khu vực |
| Giỏ, Order snapshot, COD, VNPay/MoMo sandbox, vận chuyển mô phỏng, hủy/hoàn kho | Thanh toán/vận chuyển production, đối soát/chi trả Seller, thuế và phí sàn thực tế |
| Chat văn bản, review, thông báo, Admin/Dashboard và hậu mãi/hoàn tiền mô phỏng cơ bản | Chat đa phương tiện, voucher/flash sale phức tạp, tranh chấp/hoàn tiền thật nhiều cấp |

Bảng này là **phân loại mục tiêu**, không phải checklist chức năng đã hoàn thành. Trạng thái triển khai thật phải xem release gates và bằng chứng trên `develop`.

## 1. Nguyên tắc báo cáo trung thực

- Chức năng được trình bày là **đã xây dựng** phải chạy được trên bản tích hợp, có dữ liệu demo và có bằng chứng kiểm thử.
- Chức năng mới có schema, giao diện tĩnh hoặc tài liệu nhưng chưa hoàn thành luồng không được mô tả là đã triển khai.
- Chức năng chưa đủ thời gian phải ghi rõ là **thiết kế dự phòng**, **giới hạn hiện tại** hoặc **hướng phát triển**.
- Ưu tiên hoàn thiện luồng end-to-end hơn việc tạo nhiều màn hình không hoạt động.
- Không mở rộng P2 nếu làm ảnh hưởng P0/P1 hoặc mốc ổn định trước bảo vệ. Khi một mốc nội bộ cũ không còn phù hợp, cập nhật kế hoạch công khai thay vì âm thầm cắt nghiệp vụ đã chốt.
- Phân biệt `CURRENT` (đã merge và có test), `IN_PROGRESS` (PR/prototype), `TARGET` (chưa code) trong issue, PR, báo cáo và demo. Tài liệu này mô tả **TARGET**, không tự thay đổi trạng thái triển khai của bất kỳ chức năng nào.
- Giữ mô hình đa Store/Seller, đa ngành hàng; dữ liệu ABO điện tử chỉ là corpus seed/thực nghiệm, không quyết định schema hay giao diện toàn sàn.

## 2. P0 - Bắt buộc hoàn thiện và demo được

### 2.1 Nền móng và tài khoản

- React gọi được NestJS Backend.
- Backend kết nối PostgreSQL và có migration tái lập được.
- Đăng ký, đăng nhập, access token, refresh token và đăng xuất.
- Hồ sơ tài khoản: xem/sửa tên hiển thị, số liên hệ và ảnh đại diện tùy chọn; User lưu nhiều địa chỉ giao hàng, chọn địa chỉ mặc định, Order giữ snapshot địa chỉ đã chọn.
- Seller onboarding sau khi tạo tài khoản: điền tên và thông tin liên hệ Store, địa chỉ lấy/hoàn hàng; trạng thái đích gồm `PENDING/ACTIVE/REJECTED/SUSPENDED`. Admin chấp thuận, từ chối hoặc tạm khóa với lý do và history. Store `REJECTED` được Seller sửa rồi nộp lại về `PENDING` trên cùng bản ghi; Store `SUSPENDED` chỉ được Admin khôi phục. Không coi đăng ký role `SELLER` là đã mở Store đủ điều kiện bán và không tạo Store mới để né lịch sử từ chối/tạm khóa.
- Cùng một tài khoản có thể mua như User và nộp yêu cầu mở Store; sau khi được duyệt mới thao tác Seller. Quyền Admin độc lập và không được cấp qua đăng ký công khai. `Role` đơn hiện tại là **CURRENT**, không phải kiến trúc đích; đổi sang capability/membership hoặc mô hình tương đương bằng migration/Auth/API/test được review.
- Tài khoản bị khóa không được thao tác mới nhưng Order, Chat, Review và audit cũ vẫn được bảo toàn. Các thao tác thay email/số điện thoại/quyền phải xác minh lại, không tự nối hoặc nâng quyền tài khoản chỉ bằng địa chỉ email trùng.
- Swagger/API documentation, validation và xử lý lỗi nhất quán.

### 2.2 Store và sản phẩm đa ngành hàng

- Seller tạo và quản lý Store của mình.
- Có trang Store công khai với hồ sơ cơ bản và danh sách sản phẩm được duyệt; User có thể xem Product theo Store và liên hệ Seller.
- Admin quản lý cây Category cha-con và thuộc tính theo Category.
- Seller tạo, sửa, lưu nháp, gửi duyệt và ẩn Product.
- Product hỗ trợ ảnh, thuộc tính mô tả, nhóm phân loại và ProductVariant.
- Giá và tồn kho nằm ở ProductVariant; sản phẩm không phân loại có variant mặc định.
- Admin duyệt, từ chối hoặc đóng băng Product và lưu lý do.
- Chỉ Product đủ điều kiện và được duyệt mới xuất hiện công khai.
- Seller thao tác tồn kho/giá trên từng SKU và xem lý do từ chối; hệ thống giữ lịch sử dữ liệu đã phát sinh Order thay vì xóa cứng.

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
- User lưu/đổi địa chỉ trước checkout; Order snapshot địa chỉ, tiền hàng, phí vận chuyển mô phỏng, giảm giá nếu có và tổng tiền, không tính lại đơn cũ theo giá Product mới.
- Hủy đơn cơ bản có lý do và hoàn tồn kho đúng một lần.
- Có lịch sử thay đổi trạng thái; client không tự gán trạng thái tùy ý.
- User và Seller nhận thông báo trong ứng dụng khi đơn/hủy/duyệt sản phẩm có thay đổi quan trọng; việc gửi thông báo lỗi không được làm rollback giao dịch chính.

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

## 3. P1 - Cam kết triển khai trong 12 tuần, sau khi nền P0 liên quan ổn định

### Xác thực và khôi phục tài khoản phù hợp sàn hiện đại

- Xác minh email khi đăng ký hoặc trước thao tác nhạy cảm; có luồng quên/đặt lại mật khẩu với token một lần, hết hạn và không làm lộ tài khoản tồn tại.
- Ít nhất một nhà cung cấp đăng nhập liên kết (ưu tiên Google) với token được Backend xác minh. `@gmail.com` trong form email/mật khẩu không phải đăng nhập bằng Google. Liên kết tài khoản có sẵn phải xác minh chủ sở hữu, không tự ghép theo email trùng hoặc tự đổi role.
- Số điện thoại được xác minh bằng mã một lần qua adapter SMS; môi trường demo có thể dùng provider sandbox/mock được đánh dấu rõ, có rate limit và thời hạn mã. Không tuyên bố đã gửi SMS thật nếu chỉ dùng mock.
- Username là bí danh hiển thị/tìm kiếm tùy chọn; không cần tạo một cơ chế xác thực thứ tư trong bản đầu. Facebook/Apple và passkey có thể dùng cùng kiến trúc IdentityProvider sau này nhưng không được đánh dấu hoàn thành nếu chưa tích hợp thật.

### Hậu mãi cơ bản

- User tạo yêu cầu trả hàng/hoàn tiền gắn `OrderItem` đã giao, chọn lý do và mô tả; có thời hạn cấu hình, không sao chép cứng thời hạn của sàn khác.
- Seller chấp thuận/từ chối có lý do; Admin xem và quyết định trường hợp bất đồng cơ bản. Mọi bước có actor, thời gian, trạng thái và lịch sử; không dùng `OrderStatus` thay toàn bộ vòng đời hậu mãi.
- P1 chỉ hoàn toàn bộ một `OrderItem` đủ điều kiện; số tiền dùng `lineTotal`/snapshot đã lưu và do Backend tính, client không tự gửi số tiền quyết định. Hoàn một phần số lượng hoặc số tiền trong cùng OrderItem là P2.
- Quyết định `REFUND_ONLY` ghi hoàn tiền mô phỏng nhưng không tăng tồn kho. Quyết định `RETURN_AND_REFUND` chỉ tạo stock movement hoàn kho sau khi Seller/Admin xác nhận hàng đã nhận lại và `RESTOCKABLE`; hàng hỏng/không bán lại được không nhập kho.
- Refund tạo payment/refund record và revenue adjustment âm đúng một lần. Dashboard tính doanh thu thuần từ doanh thu Order đã `COMPLETED` trừ các adjustment đã ghi; không xóa doanh thu gốc và không sửa ngược `OrderStatus`.
- Mỗi `OrderItem` chỉ được hoàn tối đa toàn bộ `lineTotal` snapshot một lần trên **tất cả** `ReturnRequest`, không chỉ trong cùng một idempotency key. Backend khóa/kiểm tra `OrderItem` trong transaction: khi đã có request `PENDING`/`APPROVED` giữ quyền xử lý, hoặc tổng refund thành công đã bằng `lineTotal`, request mới phải bị từ chối với mã `ORDER_ITEM_ALREADY_FULLY_REFUNDED`. Request `REJECTED`/`CANCELLED` không giữ hạn mức. Hai request cạnh tranh chỉ một request được tạo refund, revenue adjustment và stock movement; test phải bao phủ hai request có ID/idempotency key khác nhau.
- Mỗi bước refund/restock có idempotency key và history riêng; callback/request lặp không được hoàn tiền hoặc hoàn kho hai lần. Bản COD/sandbox chỉ ghi nhận **mô phỏng**, không tự chuyển tiền thật.
- Nếu refund thành công sau `DELIVERED` nhưng trước `COMPLETED`, vòng đời fulfillment vẫn được phép chuyển `COMPLETED` và hậu mãi tiếp tục ở trạng thái riêng. Refund transaction/adjustment được tạo đúng một lần ngay khi refund thành công, nhưng projection Dashboard chưa áp dụng adjustment thành doanh thu âm trước khi doanh thu gốc được ghi nhận. Khi Order chuyển `COMPLETED`, projection ghi gross revenue và áp dụng adjustment đã có một cách idempotent trong cùng kỳ tính; `OrderItem` hoàn đủ đóng góp doanh thu thuần bằng `0`. Nếu refund xảy ra sau `COMPLETED`, adjustment có hiệu lực ngay. Test phải chứng minh không có doanh thu âm tạm thời và không cộng/trừ hai lần.
- Hỗ trợ bằng chứng ảnh an toàn là tùy chọn của đợt đầu; tranh chấp nhiều cấp, hoàn tiền một phần và logistics hoàn hàng thật vẫn là P2.

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

### Hoàn thiện trải nghiệm vận hành

- Email thông báo được gửi qua adapter/queue sau khi sự kiện nghiệp vụ đã commit; bản demo có thể dùng provider thử nghiệm, nhưng thông báo trong ứng dụng thuộc P0 và phải hoạt động.
- Giao diện User/Seller/Admin có trạng thái đang tải, rỗng, lỗi, thành công và không đủ quyền; thao tác quan trọng có xác nhận và cách phục hồi. Ảnh đánh giá là tùy chọn nếu không ảnh hưởng các luồng chính.
- Hủy đơn và đánh giá **cơ bản** đã nằm trong P0; không tạo hai định nghĩa nghiệm thu khác nhau cho cùng nghiệp vụ.

## 4. P2 - Thiết kế dự phòng hoặc hướng phát triển

Các nội dung sau không được mô tả là đã triển khai nếu chưa có luồng chạy và kiểm thử:

- Tranh chấp nhiều cấp, hoàn tiền một phần, đối soát và chuyển tiền hoàn thật; yêu cầu hậu mãi và quyết định/hoàn tiền mô phỏng cơ bản thuộc P1.
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
| Buyer UI Address/Cart — CODE hai màn, Hoàng giao và [Hiền xác nhận ngày 04/10/2026](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-5978048696) | Hiền | Hoàng review và tích hợp; không chuyển Buyer Checkout/Order hoặc toàn bộ FE; lịch cụ thể chưa chốt |
| Hồ sơ/địa chỉ, Seller onboarding, IdentityProvider, email/OTP sandbox | Hoàng | Hiền review luồng/xác minh, test và an toàn tài khoản |
| Hậu mãi cơ bản, Payment sandbox, thông báo | Hoàng | Hiền đặc tả SRS/ERD/Use Case, test và Admin xử lý |
| SRS, Use Case, ERD, Admin, test case, dataset QA | Hiền | Hoàng review khả năng triển khai |
| CLIP, FAISS, Elasticsearch, RRF, thực nghiệm | Đạt | Hoàng review tích hợp Backend |
| Dataset metadata và ground truth | Hiền + Đạt | Hoàng review khả năng import |
| Contract Backend-AI | Hoàng + Đạt | Hiền đối chiếu tài liệu |
| Product domain và migration dùng chung | Hoàng | Hiền review nghiệp vụ; Đạt review phần search/import |

Đạt không phải thiết kế chi tiết COD, Chat hoặc trạng thái giao hàng. Đạt phải tham gia khi thay đổi ảnh hưởng metadata, Product công khai, payload index, filter, search log, `productId`, `externalId` hoặc `version`.

## 6. Release gates theo luồng người dùng

| Gate | Luồng phải chạy trên bản tích hợp | Mức | Chủ trì |
|---|---|---|---|
| `G-ACCOUNT` | Đăng ký/xác thực → cập nhật hồ sơ/địa chỉ → đăng nhập lại không mất dữ liệu; liên kết provider không chiếm tài khoản khác; cùng tài khoản có thể trở lại luồng mua sau khi mở Store | P0 + P1 | Hoàng; Hiền test |
| `G-SELLER` | User đang mua hàng nộp thông tin Store → Admin duyệt/từ chối → cùng tài khoản có quyền Seller cho đúng Store; Store bị khóa không tạo giao dịch mới nhưng vẫn xem lịch sử mua | P0 | Hoàng + Hiền |
| `G-LISTING` | Seller tạo nháp Product/Variant/ảnh/giá/kho → gửi duyệt → Admin xử lý → User xem được đúng thông tin công khai | P0 | Hoàng; Hiền review |
| `G-DISCOVERY` | Product được duyệt xuất hiện trong keyword/text/image search → filter/RRF → Backend đối chiếu PostgreSQL; ẩn Product bị loại ngay | P0 | Đạt + Hoàng |
| `G-CHECKOUT` | User chọn Variant/địa chỉ → giỏ/checkout → Order snapshot, trừ kho đúng một lần → COD hoặc sandbox trả trạng thái đúng | P0 + P1 | Hoàng; Hiền test |
| `G-FULFILMENT` | Seller xác nhận/giao mô phỏng → User theo dõi, hủy hợp lệ/hoàn kho đúng một lần → thông báo đúng actor | P0 + P1 | Hoàng; Hiền test |
| `G-AFTERSALE` | User chat/đánh giá đúng quyền; tạo ReturnRequest hợp lệ → Seller phản hồi → Admin quyết định → ghi hoàn tiền mô phỏng, không ghi trùng | P0 + P1 | Hoàng + Hiền |
| `G-OPERATE` | Admin/Seller xem số liệu đúng; fresh checkout/Docker/test/backup demo; tìm kiếm đo chất lượng và thời gian phản hồi tái lập | P0 + P1 | Cả ba |

Gate không tự chuyển sang `DONE` khi mới có schema, API đơn lẻ, PR Draft, trang Figma hoặc dữ liệu seed. Mỗi gate phải có test case/bằng chứng và được người khác review. Issue nhỏ có thể hoàn thành trước, nhưng gate vẫn ở `IN_PROGRESS` cho đến khi luồng tích hợp chạy.

## 7. Definition of Done cho chức năng báo cáo

Một chức năng chỉ được đánh dấu hoàn thành khi:

1. Acceptance criteria kiểm tra được đã được chốt.
2. Database/migration, Backend và Frontend cần thiết đều có trên nhánh tích hợp.
3. Phân quyền, validation, trạng thái lỗi và ownership đã được kiểm tra.
4. Có test tự động phù hợp hoặc test case thủ công có bằng chứng.
5. Fresh checkout có thể chạy theo tài liệu.
6. API/ERD/SRS đã khớp với code hiện tại.
7. CI thành công và có ít nhất một reviewer khác chấp thuận.
8. Demo script chỉ sử dụng dữ liệu và chức năng tồn tại thật.
9. Có kiểm tra luồng lỗi và request lặp đối với thanh toán, tồn kho, đồng bộ tìm kiếm, hậu mãi và thông báo; dữ liệu lịch sử không bị đổi khi Product/địa chỉ/hồ sơ bị sửa.
10. Chức năng có thể dùng trên màn hình thật của đúng actor; không lấy một response Swagger hoặc trang Figma làm bằng chứng hoàn thành luồng người dùng.

## 8. Thiết kế có thể mở rộng toàn hệ thống sau bảo vệ

Ưu tiên của 12 tuần là **hoàn thành bản khóa luận chạy được và có bằng chứng kiểm thử**, không phải xây ngay một sàn đủ điều kiện kinh doanh thật. Mỗi miền dưới đây cần có ranh giới dữ liệu/API rõ và triển khai P0/P1 theo các mục trên; cột mở rộng là định hướng thiết kế, **không phải checklist code của đợt bảo vệ**.

| Miền nghiệp vụ | Bản khóa luận tháng 12 (P0/P1) | Điểm mở rộng sau bảo vệ (P2) |
|---|---|---|
| Tài khoản và quyền | Đăng ký/đăng nhập, hồ sơ, địa chỉ, một người mua và mở Store sau duyệt | Thêm nhà cung cấp xác thực, thành viên Store, quy trình định danh Seller |
| Store và catalog | Nhiều Seller, Category, Product, Variant, ảnh, thuộc tính và duyệt bán | Cấu hình thuộc tính chuyên ngành, nhập dữ liệu từ nhiều nguồn, công cụ Seller nâng cao |
| Tồn kho | Tồn theo Variant/SKU, kiểm tra khi đặt hàng, hoàn kho khi hủy | Nhiều kho, phân bổ tồn theo địa điểm, đối soát kho |
| Tìm kiếm và dữ liệu | Keyword, semantic, image search, RRF, đồng bộ index và thực nghiệm | Thêm mô hình/index mới, gợi ý cá nhân hóa, xếp hạng và phân tích nâng cao |
| Giỏ và đơn hàng | Cart, Order snapshot, COD, vòng đời đơn và các luồng lỗi | Khuyến mãi phức tạp, tách đơn/fulfillment và quy tắc bán hàng nâng cao |
| Thanh toán và vận chuyển | Thanh toán sandbox, COD, trạng thái giao hàng mô phỏng | Đổi adapter sang đối tác production, đối soát, giao hàng thật |
| Hậu mãi và đánh giá | Review, yêu cầu trả/hoàn và hoàn tiền mô phỏng cơ bản | Tranh chấp nhiều cấp, hoàn tiền và xử lý hậu mãi thật |
| Chat và thông báo | Chat văn bản User–Seller, lịch sử/read state, thông báo cơ bản | Ảnh/file/video, đa kênh và tự động hóa chăm sóc khách hàng |
| Admin và vận hành | Duyệt Store/Product, dashboard, log, test và Docker Compose | Kiểm duyệt nâng cao, audit, giám sát, backup/restore và mở rộng tải |

Không đóng cứng quy tắc của một sàn tham khảo hoặc dataset ABO vào schema. PostgreSQL giữ dữ liệu nghiệp vụ; Elasticsearch/FAISS là index có thể xây lại. Tách vòng đời Order, Payment, Shipment và ReturnRequest; các tích hợp bên ngoài đi qua adapter để thay được mà không viết lại nghiệp vụ lõi. Tính năng P2 chỉ chuyển thành task triển khai khi nhóm chốt issue, acceptance criteria và nguồn lực, không ngầm nhận là đã có.

Nếu sau bảo vệ muốn cho Seller ngoài nhóm mở bán và dùng giao dịch thật, cần một đợt đánh giá riêng về pháp lý/chính sách, định danh và hỗ trợ người bán, thanh toán–vận chuyển production, bảo mật, dữ liệu, giám sát và khả năng vận hành. Điều kiện này áp dụng cho **toàn sàn**, không chỉ riêng thanh toán, và không làm tăng phạm vi bắt buộc của bản khóa luận.

## 9. Thứ tự triển khai khuyến nghị

```text
Foundation + Auth hiện có
→ Product schema được review + migration/Auth đa quyền được review + Store/Category/Product/Variant/Image + Seller onboarding cơ bản
→ Product moderation + Product→Search (mốc 27/09)
→ Public catalog/UI + Cart/stock transaction + Order/COD/hủy + AI Search integration (mốc 11/10)
→ Chat + Review + Admin/Dashboard + thông báo trong ứng dụng
→ Email verify/reset + Google login + phone OTP sandbox + Payment sandbox + ReturnRequest cơ bản
→ Docker toàn hệ thống + E2E + kiểm thử hiệu năng + báo cáo/demo (trước bảo vệ tháng 12)
```

Các lane có thể chạy song song: Đạt hoàn thiện Search và thực nghiệm; Hiền đồng bộ SRS/ERD/test với P0/P1 mới; Hoàng xây FE cùng API. Chat được thiết kế sớm nhưng chỉ bắt đầu code khi Auth, Store và Product đã ổn định vì Conversation phụ thuộc `userId`, `storeId` và có thể mang ngữ cảnh `productId`. Mốc 25/10 đóng băng chức năng và 08/11 hoàn thành trong kế hoạch cũ cần được nhóm ước lượng/review lại theo ngày bảo vệ tháng 12. Không tự dùng việc dời mốc để ngừng kiểm thử, và không âm thầm bỏ một P1 rồi vẫn báo là hoàn thành.
