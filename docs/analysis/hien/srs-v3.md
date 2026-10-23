# Đặc tả yêu cầu phần mềm SRS phiên bản 3

Hệ thống quản lý sàn thương mại điện tử tích hợp tìm kiếm sản phẩm bằng hình ảnh

Mã đề tài: CNTT-KLCN201
Người tổng hợp: Nguyễn Quốc Hiền
Người nhận: Võ Minh Hoàng
Phối hợp Search và dữ liệu: Nguyễn Cao Dũng Đạt
Ngày phát hành bản tổng hợp: 23/09/2026
Ngày cập nhật quyết định: 24/09/2026
Phiên bản tài liệu: 3.1

Bổ sung quyết định ngày 23/10/2026: phạm vi định lượng gồm 7 truy vấn phát triển
× 86 sản phẩm = 602 cặp đủ nhãn; giữ kết quả truy hồi và Precision/Recall@5/10/20.
Không yêu cầu đủ 12 truy vấn để tính tập này; 5 truy vấn thiếu nhãn giữ nguyên,
không chuyển ô trống thành 0. Nhãn có AI hỗ trợ, không phải hai lượt chấm độc lập;
không suy rộng thành chất lượng tìm
ảnh/toàn hệ thống. [Quyết định và giới hạn](../../testing/electronics/evaluation-scope-7q-2026-10-23.md).

## 1 Mục đích và quy ước sử dụng

SRS v3 đặc tả phạm vi, quy tắc nghiệp vụ, luồng thành công và thất bại, dữ liệu cùng tiêu chí nghiệm thu của sàn đa người bán. Đây là bản tổng hợp để nhóm thống nhất yêu cầu và tiếp tục thiết kế, triển khai, kiểm thử. Nội dung kế thừa SRS Đề tài 18 v2, bản phân tích v0.5 của Hiền và bản tham khảo Hoàng gửi ngày 23/09/2026.

Các yêu cầu có căn cứ trong quyết định phạm vi của nhóm được giữ làm nền. Hoàng đã xác nhận D01–D10 ngày 23/09/2026; Đạt xác nhận phần Search của D04/D09 ngày 24/09/2026. Các quyết định này là yêu cầu đích cho bản bảo vệ, không tự chuyển trạng thái triển khai thành CURRENT. Việc hoàn thiện tài liệu không đồng nghĩa chức năng đã được code, kiểm thử hoặc merge.

P0 là nền bắt buộc; P1 là phần cam kết thực hiện sau nền P0 liên quan; cả hai thuộc mục tiêu trước bảo vệ. P2 là mở rộng. FR là mã yêu cầu chức năng, AC là tiêu chí nghiệm thu, UC là tình huống sử dụng và TC là ca kiểm thử. Mã FR cũ được giữ qua bảng truy vết ở mục 18; mã mới dùng để mô tả từng miền rõ hơn, không xóa lịch sử yêu cầu.

Trạng thái triển khai dùng CURRENT khi có bản tích hợp và bằng chứng kiểm thử, IN_PROGRESS khi đang làm trên nhánh/prototype, TARGET khi mới là yêu cầu hoặc thiết kế. Các phần nghiệp vụ của SRS mô tả yêu cầu đích; trạng thái thực tế phải được ghi riêng trong biên bản kiểm thử và release gate, không suy từ mức ưu tiên hoặc số lượng bảng dữ liệu.

Nguồn quyết định được đối chiếu theo thứ tự: quyết định phạm vi và thiết kế đã được nhóm xác nhận; phần phân tích v0.5 đã sửa theo feedback; bản tham khảo ngày 23/09; đề xuất mới của bản tổng hợp. Contract Backend–Search do Hoàng và Đạt quản lý tại PR #8; ví dụ hoặc yêu cầu trong SRS không tự thay thế contract kỹ thuật đó.

Thời gian 17/08–08/11/2026 trong SRS v2 là kế hoạch nội bộ 12 tuần. Tài liệu implementation-scope xác định mục tiêu bảo vệ tháng 12/2026; ngày bảo vệ cụ thể và lịch điều chỉnh phải được ghi vào kế hoạch nhóm, không suy ra ngày bảo vệ từ mốc nội bộ.

### 1.1 Kiến trúc và ràng buộc

Frontend dùng React và TypeScript. Backend dùng NestJS trên Node.js với PostgreSQL. FastAPI Search Service quản lý Elasticsearch, CLIP đa ngôn ngữ, FAISS và RRF. Frontend gọi Backend; Backend xác thực, kiểm tra dữ liệu PostgreSQL và gọi Search Service. Elasticsearch và FAISS là chỉ mục phụ trợ có thể xây lại. Docker đóng gói môi trường; Google Colab có thể được dùng để trích embedding. CLIP dùng pretrained model; fine-tune không phải điều kiện mặc định của bản đầu.

Chuỗi tích hợp cần nghiệm thu: mở Store → đăng và duyệt Product → outbox → Search Service → tìm kiếm trên Web → PostgreSQL kiểm tra kết quả → giỏ hàng → checkout → COD hoặc sandbox → giao mô phỏng → hoàn tất → dashboard, review và hậu mãi.

### 1.2 Các nội dung được chuẩn hóa trong phiên bản 3

- Giữ một tài khoản mua và bán sau duyệt Store; giới hạn một role trong code cũ chỉ là trạng thái chuyển tiếp.
- Phân loại hồ sơ, địa chỉ và thông báo trong ứng dụng ở P0; email verify/reset, Google login và OTP sandbox ở P1 theo implementation-scope.
- Phân biệt Product công khai, Variant mua được và Product DRAFT dùng kiểm thử kỹ thuật.
- Tách Order, Payment, vận chuyển và hậu mãi; bổ sung cạnh tranh, callback đến muộn, hoàn kho và doanh thu thuần.
- Giữ FastAPI sở hữu RRF; loại công thức candidateK, timeout và payload cũ khỏi vai trò contract chuẩn.
- Bổ sung truy vết toàn bộ FR cũ, UC, API, dữ liệu, UI, ca kiểm thử, PR/commit, trạng thái và owner; ghi D01–D10 là quyết định đã xác nhận nhưng không tạo trạng thái PASS giả.

## 2 Bài toán, mục tiêu và ranh giới

Xây dựng sàn nhiều người bán, đa ngành hàng: mở Store, đăng và duyệt sản phẩm, khám phá bằng từ khóa/văn bản/ảnh, mua hàng, giao mô phỏng, hậu mãi, chat, quản trị và đánh giá tìm kiếm. Bản khóa luận có dữ liệu demo, thanh toán sandbox và vận chuyển mô phỏng; không tuyên bố đủ điều kiện kinh doanh thật.

ABO điện tử là nguồn seed/thực nghiệm, không giới hạn sản phẩm của sàn. Seller khác có thể bán sản phẩm có màu, kích thước, dung lượng hoặc thuộc tính khác mà không sửa cấu trúc bảng Product.

| Phạm vi | Yêu cầu |
|---|---|
| P0 | Tài khoản, hồ sơ/địa chỉ, một người vừa mua vừa bán; Store; catalog, sản phẩm/variant/ảnh/duyệt; Search; giỏ/đơn/COD/kho; chat text; review; thông báo trong ứng dụng; Admin/dashboard; kiểm thử |
| P1 | Email verify/reset, Google login, OTP sandbox; VNPay/MoMo sandbox; hậu mãi/hoàn tiền mô phỏng cơ bản; email adapter; hoàn thiện trải nghiệm |
| P2 | Nhiều kho, voucher/flash sale nâng cao, cá nhân hóa, livestream/affiliate, chat media, nhân viên Store, vận chuyển/chi trả production, tranh chấp và hoàn tiền một phần |

Không cắt P1 âm thầm khi thiếu thời gian. Nhóm đánh giá lại lịch và ghi quyết định thay đổi phạm vi. “CRUD xong” không có nghĩa luồng mua bán đã hoàn thành.

## 3 Actor và phân quyền

| Actor | Được làm | Không được làm |
|---|---|---|
| Khách chưa đăng nhập | Xem Store/Product công khai, tìm kiếm | Xem nháp, đơn, địa chỉ hoặc chat riêng |
| Người mua | Quản lý hồ sơ/địa chỉ, mua, chat, đánh giá, yêu cầu hậu mãi của mình | Sửa giá, tự gán trạng thái tiền/đơn, xem đơn người khác |
| Chủ Store | Toàn bộ quyền mua; quản lý Store của mình sau onboarding | Quản lý Store khác, tự duyệt, sửa lịch sử đơn |
| Admin | Quản trị danh mục, duyệt/khóa, xử lý ngoại lệ có lý do, xem thống kê | Đăng ký công khai thành Admin, sửa giao dịch không audit, mặc định đọc chat riêng |
| Search Service | Nhận nội dung hợp lệ, quản lý index, trả ID/rank | Quyết định giá thanh toán, quyền sở hữu hoặc nguồn dữ liệu nghiệp vụ |
| Worker/hệ thống | Retry, timeout, thông báo, đồng bộ theo chính sách | Bỏ qua transaction/ownership hoặc sửa dữ liệu không truy vết |

Backend suy ra actor từ phiên xác thực. Mọi truy cập đối tượng phải kiểm tra ownership, không chỉ kiểm tra role. Ẩn nút trên UI không phải biện pháp phân quyền. Admin có thể xử lý ngoại lệ nhưng không được bỏ qua bất biến tiền/kho.

## 4 Từ điển nghiệp vụ và bất biến

- **User:** danh tính đăng nhập. **Store:** chủ thể bán. Quyền bán phụ thuộc Store được duyệt, không phụ thuộc việc chọn “Seller” khi đăng ký.
- **Product:** nội dung một listing của Store. **Variant/SKU:** lựa chọn mua cụ thể, giữ giá và tồn kho. Không có phân loại vẫn có variant mặc định.
- **Attribute:** thông số mô tả theo danh mục. **Option:** trục phân loại tạo SKU; không đồng nhất hai khái niệm.
- **Order:** đơn của một Store. **OrderItem:** dòng hàng và snapshot bất biến. **Payment**, **Shipment**, **ReturnRequest** có vòng đời riêng.
- PostgreSQL là nguồn chuẩn; FAISS/Elasticsearch có thể xây lại. productId là Int do PostgreSQL sinh; externalId nullable, dạng `<source>:<id>`, chỉ để truy vết import.
- Giá dùng số thập phân chính xác, không floating point cho tính tiền. Tiền tệ demo là VND; quy tắc làm tròn được chốt trước Payment. Tồn kho là số nguyên không âm.
- Không xóa cứng lịch sử đã phát sinh giao dịch. Sửa Product/địa chỉ không làm thay đổi snapshot đơn cũ.
- Request lặp, chạy song song và retry phải được xét ở luồng tiền/kho/duyệt/import/index/chat.
- Dataset thiếu brand được để null; thiếu dữ liệu không được tự tạo sự thật. Giá demo phải được đánh dấu, không trình bày là giá gốc dataset.

## 5 Tài khoản, hồ sơ và địa chỉ

### FR-ACC-01 Đăng ký và phiên đăng nhập (P0)

**Luồng:** khách nhập email/mật khẩu → Backend kiểm tra và chuẩn hóa email → lưu password hash → tạo tài khoản người mua → thông báo thành công → có thể đăng nhập ngay bằng email/password trong P0 → hoàn thiện hồ sơ khi cần. Không bắt điền toàn bộ hồ sơ chỉ để xem sàn.

Login kiểm tra mật khẩu và trạng thái tài khoản, cấp access token và refresh cookie HttpOnly. Refresh phải xoay token; logout thu hồi refresh session hiện tại. Đổi hoặc quên mật khẩu thành công thu hồi toàn bộ refresh session của tài khoản. Chính sách vô hiệu access token đã phát hành phải được công bố rõ, không hứa access token bị thu hồi tức thời khi chưa có cơ chế đó.

**Ngoại lệ:** dữ liệu sai; email trùng; tài khoản khóa; token hết hạn/đã dùng; mất mạng; gửi lặp. Login/reset không trả thông tin giúp dò mật khẩu hoặc danh sách tài khoản. UI không giữ trạng thái đăng nhập giả khi refresh thất bại.

**AC-ACC-01:** đăng ký không tạo Admin/Seller capability; đăng nhập sai bị từ chối; refresh cũ không dùng lại; logout chỉ thu hồi session hiện tại; đổi/quên mật khẩu thu hồi mọi refresh session; tài khoản khóa không thực hiện mutation dù còn token; thử truy cập dữ liệu người khác bị từ chối.

### FR-ACC-02 Xác minh, khôi phục và liên kết (P1)

Email verify/reset có token một lần, hết hạn và giới hạn gửi lại. Reset thành công thu hồi toàn bộ refresh session; token không nằm trong log. Google login xác minh token ở Backend, khóa identity bằng provider+subject. Tài khoản cũ không tự liên kết OAuth và không tự coi email trùng là cùng identity; liên kết yêu cầu xác minh người đang sở hữu. OTP sandbox có thời hạn, giới hạn thử và thông báo rõ là mô phỏng.

**AC-ACC-02:** token hết hạn/đã dùng thất bại; callback OAuth sai audience/issuer bị từ chối; không chiếm tài khoản bằng email trùng; OTP vượt giới hạn bị chặn. Khi P1 verify được bật, browsing/profile vẫn dùng được nhưng checkout và gửi Seller onboarding yêu cầu email đã xác minh; seed/test phải khai báo trạng thái verified rõ ràng.

### FR-ACC-04 Đổi mật khẩu khi đã đăng nhập P0

Người dùng xác thực lại bằng mật khẩu hiện tại hoặc cơ chế tương đương trước khi đặt mật khẩu mới. Backend băm mật khẩu, thu hồi toàn bộ refresh session của tài khoản, ghi audit an toàn và không lộ password/token. Đây là đổi mật khẩu chủ động; luồng quên mật khẩu dùng token ở FR-ACC-02.

**AC-ACC-04:** mật khẩu hiện tại sai không đổi được; mật khẩu mới dùng đăng nhập được; mật khẩu cũ không còn hợp lệ; người khác không đổi mật khẩu thay chủ tài khoản.

### FR-ACC-03 Hồ sơ và sổ địa chỉ (P0)

Người dùng sửa tên hiển thị, liên hệ và avatar tùy chọn; thêm/sửa/xóa địa chỉ nhận hàng và chọn một mặc định. Địa chỉ có người nhận, điện thoại, địa chỉ chi tiết và đơn vị hành chính theo danh mục được cấu hình, không đóng cứng vào schema một hệ thống địa giới có thể thay đổi. Đổi email/điện thoại xác thực cần xác minh lại.

**AC-ACC-03:** địa chỉ của A không chọn được bởi B; chỉ một địa chỉ mặc định; xóa mặc định yêu cầu chọn lại hoặc để chưa có; đơn đã tạo giữ địa chỉ cũ; thiếu địa chỉ hợp lệ không checkout.

## 6 Seller onboarding và Store

### FR-STO-01 Mở Store (P0)

**Tiền điều kiện:** người dùng đăng nhập, tài khoản hợp lệ, chưa sở hữu Store khác. **Luồng:** nhập tên/mô tả Store, liên hệ và địa chỉ lấy/hoàn → xem lại → gửi hồ sơ PENDING → Admin kiểm tra → ACTIVE hoặc REJECTED kèm lý do → người dùng nhận thông báo. Một tài khoản sở hữu tối đa một Store trong bản khóa luận, vẫn tiếp tục mua hàng bằng chính tài khoản đó.

REJECTED được sửa và gửi lại trên cùng Store. SUSPENDED không tự nộp lại để né khóa. Không thu giấy tờ thật trong demo. Quyền tạo hồ sơ không đòi sẵn capability Seller, tránh vòng lặp “chưa mở Store thì không được xin mở Store”.

### FR-STO-02 Duyệt, đình chỉ và hồ sơ công khai (P0)

| Từ → Đến | Actor | Điều kiện/kết quả |
|---|---|---|
| Chưa có → PENDING | User | Hồ sơ hợp lệ, unique chủ Store |
| PENDING → ACTIVE/REJECTED | Admin | Kiểm tra phiên bản hồ sơ; từ chối có lý do |
| REJECTED → PENDING | Chủ Store | Sửa và gửi lại; giữ lịch sử |
| ACTIVE → SUSPENDED | Admin | Lý do bắt buộc; chặn bán mới |
| SUSPENDED → ACTIVE | Admin | Xác nhận khắc phục; không tự mở Product FROZEN |

Store công khai chỉ lộ thông tin cần thiết, không lộ địa chỉ cá nhân/email nội bộ. Store SUSPENDED không tạo/sửa/public listing mới và không nhận Order mới. Nếu account chủ Store còn ACTIVE, chủ Store vẫn được xử lý Order, ReturnRequest và Chat gắn với giao dịch cũ; nếu account bị khóa, Admin/support tiếp nhận bằng command có audit. Buyer vẫn xem lịch sử và hậu mãi của Order cũ. Thay đổi hồ sơ nhạy cảm có kiểm tra lại, không tự chuyển quyền sở hữu Store.

**AC-STO-01/02:** hai yêu cầu tạo Store song song chỉ tạo một bản ghi; hai quyết định duyệt cạnh tranh chỉ một thành công; chủ Store khác không truy cập; từ chối–nộp lại giữ ID/history; khóa Store loại listing khỏi mua mới nhưng không mất snapshot.

## 7 Catalog, đăng sản phẩm và kiểm duyệt

### FR-CAT-01 Danh mục, thương hiệu, thuộc tính (P0)

Admin quản lý cây danh mục không chu trình, tên/slug, trạng thái; định nghĩa thuộc tính có kiểu, đơn vị, required và option. Giai đoạn đầu chỉ áp definition gắn trực tiếp vào category lá, chưa kế thừa ngầm từ category cha. Seller chọn danh mục lá hoạt động; các tổ tiên cũng phải hoạt động. Brand không rõ để null, không biến “không có bằng chứng” thành tên hãng. Không xóa dữ liệu đang được tham chiếu. Theo quyết định Category hiện có, từ chối tắt Category khi còn con hoạt động hoặc Product tham chiếu; không tự nới quy tắc này. Brand còn tham chiếu không bị xóa cứng. Khi Admin thêm hoặc bật required definition, hệ thống phải kiểm tra Product bị ảnh hưởng, không tự sinh giá trị; Product public thiếu required được đánh dấu cần cập nhật, ngừng public, thông báo Seller rồi phát SearchOutbox phù hợp.

**AC-CAT-01:** từ chối cây chu trình, category bị khóa, option của thuộc tính khác; chỉ validate definition trực tiếp của category lá; khi thay category hoặc thêm required phải revalidate Product, chặn submit thiếu dữ liệu và loại Product public không còn hợp lệ khỏi public/Search.

### FR-PRD-01 Tạo và hoàn thiện nháp (P0)

**Luồng Seller:** chọn Store → tạo tên/category → lưu nháp → nhập mô tả/brand → upload/chọn ảnh chính → nhập attribute → tạo option và các SKU thực sự bán → nhập giá/kho → nhập kiện hàng → xem preview → gửi duyệt.

Draft có thể thiếu mô tả, ảnh, variant và kiện hàng; Store/name/category phải đáp ứng contract hiện hành. Chưa ánh xạ category thì giữ ở staging, không chèn ID đoán vào DB. Seller được chọn subset tổ hợp SKU thực sự bán; mỗi SKU được tạo phải chọn đủ một value của mỗi option group áp dụng và không trùng optionSignature.

Tối đa 2 nhóm phân loại, 9 ảnh là cấu hình demo kế thừa thiết kế, không giới hạn cố định của schema. SKU nội bộ do hệ thống sinh; sellerSku nếu có unique trong Store. Giá >0 khi bán, stock ≥0. Variant không dùng nữa được ngừng bán; không xóa lịch sử OrderItem.

**AC-PRD-01:** lưu nháp thiếu ảnh thành công nhưng submit thất bại; option/ảnh/variant không tham chiếu Product khác; tối đa một ảnh chính khi lưu nháp và bắt buộc đúng một ảnh chính hợp lệ khi submit; SKU trùng bị chặn; sản phẩm không phân loại dùng đúng một default variant.

### FR-PRD-02 Submit, duyệt và sửa sau duyệt (P0)

Submit kiểm tra Store/tài khoản hoạt động; category lá hợp lệ; tên/mô tả theo chính sách; ảnh chính; required attributes; ít nhất một variant hoạt động giá hợp lệ; kiện hàng có weight>0. Stock bằng 0 không chặn duyệt hoặc hiển thị nếu các điều kiện public khác đạt; UI phải báo “Hết hàng” và checkout phải từ chối mua.

Admin xem đúng phiên bản đã submit, approve hoặc reject có lý do. Sửa nháp chưa gửi không đồng nghĩa approve. FROZEN chỉ Admin giải quyết. Mọi quyết định có actor/time/reason/version; approve một phiên bản cũ sau khi Seller sửa phải bị chặn.

Sửa name, description, category, brand, attribute, option/SKU structure, ảnh hoặc shipping profile đưa nội dung về DRAFT/NOT_SUBMITTED và ngừng public cho tới khi duyệt lại; đơn cũ không đổi. Price/stock chỉ được tách khỏi re-review khi có command chuyên biệt, audit, version và outbox. PR #18 hiện dùng chính sách chặt hơn thì giữ nguyên cho tới khi có PR riêng, không nới trong tài liệu này. Sửa cấu trúc SKU không dùng chung command chỉnh kho.

| sellerStatus / moderationStatus | Ý nghĩa |
|---|---|
| DRAFT / NOT_SUBMITTED | Đang soạn, không công khai |
| ACTIVE / PENDING | Mong muốn bán nhưng đang chờ duyệt, không công khai |
| ACTIVE / APPROVED | Chỉ công khai nếu đủ điều kiện chung |
| HIDDEN / APPROVED | Seller tạm ẩn, không công khai |
| bất kỳ / REJECTED | Sửa và gửi lại, không công khai |
| bất kỳ / FROZEN | Khóa bởi Admin, Seller không tự mở |

**AC-PRD-02:** thiếu required, primary image hoặc weight bị chặn; từ chối có lý do; sửa nội dung APPROVED không lộ trước duyệt; hai request edit/approve không ghi đè; giá/stock cập nhật không đổi snapshot đơn.

### FR-PRD-03 Xem công khai và mua được (P0)

Một predicate chung cho public list/detail/Store/Search: tài khoản bán hợp lệ, Store ACTIVE, sellerStatus ACTIVE, moderation APPROVED, category/ancestor hợp lệ, ảnh/attribute/kiện hàng/variant đạt chính sách, không hidden/frozen. Listing có variant active giá hợp lệ nhưng stock bằng 0 vẫn có thể hiển thị “Hết hàng”; **mua được** còn yêu cầu chính variant đã chọn hoạt động và đủ stock. Không coi ACTIVE hoặc có vector là bằng chứng được công khai.

Hide, freeze, khóa Store hoặc tài khoản phải chặn kết quả ở PostgreSQL ngay cả khi index chưa cập nhật. Không lộ dữ liệu nháp qua route public hoặc cache. Backend gửi thông báo thay đổi cho chủ Store.

**AC-PRD-03:** list/detail/Store/Search cùng chặn Product không đủ điều kiện; Variant mua được phải còn hoạt động và đủ stock; ẩn hoặc khóa Store có hiệu lực ngay tại Backend dù index chưa cập nhật. Chính sách hiển thị hết hàng theo D04.

### FR-MED-01 Vòng đời ảnh (P0)

Ảnh query nhận trực tiếp qua multipart, chỉ cho JPEG/PNG tối đa 5 MB, xử lý trong bộ nhớ và mặc định không lưu nội dung lâu dài. Product có tối đa 9 ảnh theo cấu hình demo. Ảnh draft là private; Seller/Admin truy cập theo quyền, Search worker dùng signed/expiring URL do Backend phát và hostname thuộc allowlist cấu hình. Contract hiện chưa gửi custom service-auth header; nếu chọn cơ chế đó phải mở thay đổi contract/implementation riêng. Kiểm tra phải decode ảnh thật, không chỉ extension hoặc magic bytes. Tên lưu do server sinh, chống traversal. Upload có staging; lỗi DB/filesystem không để file công khai không có bản ghi. Xóa ảnh phải làm URL gốc không còn phục vụ từ ứng dụng. Cấu hình demo: staging lỗi tối đa 1 giờ, trash cleanup 24 giờ, metadata log 30 ngày và audit nghiệp vụ 90 ngày; đây là cấu hình môi trường, không phải cột schema cố định.

**AC-MED-01:** upload giả ảnh, ảnh có header đúng nhưng dữ liệu cắt/hỏng hoặc ảnh quá lớn đều thất bại; transaction fail không công khai ảnh; delete rồi GET URL trả không tìm thấy; hai request cạnh tranh không mất ảnh hợp lệ; URL draft hết hạn hoặc host ngoài allowlist không được Search worker tải.

## 8 Khám phá, tìm kiếm và đồng bộ AI

### FR-SRC-01 Search và hiển thị kết quả (P0)

Khách nhập từ khóa/văn bản hoặc ảnh → Backend validate → FastAPI tìm keyword/semantic/image, RRF khi phù hợp → trả ID/rank → Backend hydrate và kiểm tra quyền công khai ở PostgreSQL → UI hiển thị ảnh, tên, Store, giá và tình trạng. Bộ lọc tối thiểu category/brand/khoảng giá; xóa bộ lọc, không kết quả và lỗi dịch vụ có UI rõ.

FastAPI quản lý Elasticsearch, CLIP/FAISS và RRF; NestJS không triển khai một RRF khác. Elasticsearch dùng minPrice, maxPrice và inStock tổng hợp từ Variant để tạo tập ứng viên; các trường tổng hợp không tự chứng minh điều kiện ghép. Sau Search, Backend bắt buộc hydrate PostgreSQL và kiểm tra trên **cùng một Variant active** rằng giá nằm trong khoảng và, khi `inStock=true`, stock > 0; giữ candidateK/over-fetch để giảm thiếu kết quả sau lọc lại. Không đổi payload chỉ bằng SRS; dùng contract PR #8. Rating chưa vào contract cho tới khi có nguồn aggregate chuẩn. Dữ liệu nội bộ không đưa vào index Product công khai.

**AC-SRC-01:** hidden/DRAFT không trả qua public dù còn index; kết quả không trùng productId; giữ rank tương đối sau hydrate; filter giá/inStock chỉ nhận sản phẩm khi cùng một Variant active thỏa toàn bộ điều kiện; ảnh lỗi không thành HTTP500 không kiểm soát; lỗi một engine báo degraded theo contract hoặc lỗi có kiểm soát, không dựng kết quả giả.

### FR-SRC-02 Đồng bộ bền vững (P0)

Transaction Product tăng version và tạo outbox đúng một trạng thái cuối. Worker gửi UPSERT hoặc DELETE theo version; retry lỗi tạm thời, ghi lỗi vận hành, có replay có kiểm soát. Sự kiện cũ không phục hồi listing đã xóa/ẩn; thành công một index không được báo hoàn tất cả hai. Store/category/account thay đổi phải gây đồng bộ các Product ảnh hưởng, không chỉ thay Product trực tiếp.

**AC-SRC-02:** AI mất kết nối không rollback sửa Product; phục hồi dịch vụ xử lý được backlog; request trùng/cũ không gây sai index; public vẫn lọc ngay trong thời gian chờ; kiểm tra luồng Backend→AI→DB→Web, không chỉ gọi Swagger FastAPI.

### FR-DAT-01 Import, mapping và chất lượng dữ liệu (P0)

Gói JSONL versioned + ảnh tương đối → dry-run → báo lỗi theo externalId → import đúng tập được duyệt dạng DRAFT → ingest ảnh → xác minh PostgreSQL → xuất mapping và hash. Import lặp không nhân bản hay ghi đè sửa tay của Seller. Chưa rõ category giữ staging; Renewed tách riêng đến khi có condition model được duyệt; excluded không import/index. sourceDescriptionCandidate là ghi chú QA, không tự thành mô tả công khai.

**AC-DAT-01:** chạy hai lần không đổi ID/số row ngoài dự kiến; brand null hợp lệ; path traversal/symlink thoát gốc bị chặn; mapping chỉ chứa bản ghi đã commit; checkpoint lỗi cho phép chạy lại; corpus smoke DRAFT tách khỏi public index.

### FR-EVAL-01 Thực nghiệm và đánh giá tìm kiếm (P0/P1)

So sánh keyword, CLIP và RRF trên cùng corpus/query/ground truth được đóng phiên bản. Tách exact-product và similar-product; query độc lập và hard negative; ghi model, cấu hình, seed nếu có, phần cứng, cold/warm và latency. Precision@K/Recall@K tại K=5/10/20 dùng định nghĩa relevance và mẫu số ground truth công bố; query không có relevant phải có chính sách riêng. Không lấy ảnh catalog tự match rank1 làm chất lượng thực tế. Không dùng số candidate QA như số sản phẩm public-ready.

P0 chuẩn bị corpus/query/nhãn và baseline tái lập; P1 hoàn tất báo cáo so sánh, các thử nghiệm fusion và bảng kết quả học thuật. Cả hai phải có trước nghiệm thu bảo vệ, không hạ đánh giá thành P2. FR-AI03 về early/late fusion và FR-AI09 về báo cáo Việt/Anh được giữ ở mục 18.

Với query q, Rq là tập relevant đã gán nhãn và Lq,K là tối đa K kết quả đầu: Precision@K = số relevant trong Lq,K chia K; vị trí thiếu do ít kết quả được tính không relevant. Recall@K = số relevant trong Lq,K chia kích thước Rq khi Rq không rỗng. Báo macro trung bình trên tập query hợp lệ cùng số mẫu. Query không có relevant báo riêng khả năng trả rỗng/false positive, không tự cho Recall bằng 1. Định nghĩa exact-product và similar-product phải được gán nhãn riêng, không trộn mẫu số.

Nếu chỉ gán nhãn bằng pooling chưa phủ hết corpus, ghi rõ recall trên tập relevant đã đánh giá và tỷ lệ phủ nhãn; không gọi là recall toàn corpus. Bộ nhãn mốc của 12 truy vấn văn bản trong lịch sử không đủ làm mẫu số Recall. Theo quyết định ngày 23/10, phần định lượng chốt trên 7 truy vấn đủ 86 nhãn/truy vấn (602 cặp), chọn theo độ đầy đủ nhãn chứ không theo điểm. Giữ kết quả truy hồi, phép tính và nêu giới hạn của tập phát triển có nhãn AI hỗ trợ; không cần đủ 12 truy vấn mới được tính tập này. Năm truy vấn thiếu nhãn giữ nguyên ngoài phép tính, không gán ô trống thành 0. Có 11 ảnh truy vấn ngoài tập 86, chưa đủ để đánh giá ảnh trên lần import 86 sản phẩm. Báo cáo 86 vector/512 chiều và kết quả tự tìm lại ảnh ở hạng 1 của ID 58, 125, 143 tại commit `9b754fb` là bằng chứng kỹ thuật lịch sử, không thay bằng chứng chất lượng ảnh hoặc khả năng phục vụ công khai.

**AC-EVAL-01:** có corpus/query/nhãn đóng phiên bản, relevance và mẫu số công bố; chạy các nhánh trên cùng tập; lưu cấu hình, số mẫu, kết quả Việt–Anh và latency; dữ liệu chưa đủ nhãn chỉ được báo smoke hoặc metric có giới hạn phủ nhãn rõ ràng.

### FR-SRC-03 Embedding và thử nghiệm fusion (P0/P1)

P0 dùng CLIP đa ngôn ngữ để biểu diễn văn bản và ảnh trong cùng không gian, chuẩn hóa vector theo cấu hình đã chọn; lưu model/version, chiều vector và cách tổng hợp. FAISS bản đầu dùng một vector ảnh chính cho mỗi productId số nguyên. Khi thử nhiều vector mỗi sản phẩm, phải có vectorId riêng và gom theo productId trước khi trả kết quả. P1 so sánh early fusion và late fusion theo FR-AI03 trên cùng tập đánh giá; không nhầm thử nghiệm fusion embedding với quy tắc RRF đã chốt.

**AC-SRC-03:** rebuild lặp từ cùng dữ liệu/cấu hình cho số vector và tập ID dự kiến; tập FAISS ID đối chiếu mapping PostgreSQL; lưu cấu hình từng nhánh và bảng chất lượng/latency Việt–Anh; không báo kết quả nếu nhãn chưa đủ.

## 9 Giỏ hàng, checkout, tiền và tồn kho

### FR-CAR-01 Giỏ hàng (P0)

Người mua chọn variant và số lượng → thêm giỏ → nhóm theo Store → tăng/giảm/xóa/chọn dòng checkout. Giỏ lưu trên tài khoản; giá trong giỏ không phải giá cam kết. Dòng bị ẩn/hết hàng được báo không khả dụng, không tự đổi sang SKU khác.

**AC-CAR-01:** unique cart+variant; quantity nguyên dương; không sửa giỏ người khác; refresh giữ giỏ; giá mới được cảnh báo; chủ Store không thêm hoặc checkout Variant của chính Store mình.

### FR-CHK-01 Checkout nhiều Store (P0)

**Tiền điều kiện:** tài khoản đủ điều kiện, các variant và địa chỉ thuộc phạm vi hợp lệ. **Luồng:** Backend lập bản xem trước giá/phí → người mua xác nhận → kiểm tra lại trạng thái/giá/stock → transaction tạo một Order mỗi Store, snapshot người nhận, sản phẩm, option, giá, quantity, phí và tổng → trừ kho khả dụng → ghi stock movement → xác nhận đơn → thông báo sau commit.

Một checkout nhiều Store tạo các Order trong cùng transaction: một dòng lỗi thì chưa tạo đơn nào. Mỗi Order có một Payment riêng; UI hiển thị trạng thái thanh toán theo từng Order. Giá thay đổi trả yêu cầu xác nhận lại, không âm thầm thu khác. Retry cùng idempotency key và cùng payload trả kết quả cũ; key giống/payload khác trả conflict. API đối chiếu trạng thái khi client timeout.

**AC-CHK-01:** hai người mua SKU stock=1 chỉ một thành công; lỗi giữa transaction không mất kho/đơn mồ côi; double click không tạo đơn đôi; snapshot không đổi sau edit; Backend không tin total do client gửi; tất cả Order đúng Store.

### FR-PAY-01 COD và sandbox (P0/P1)

COD UNPAID → PAID khi xác nhận DELIVERED trong vận chuyển mô phỏng. Sandbox tạo PaymentAttempt từ số tiền DB, chuyển khách tới provider; callback server xác minh chữ ký, mã tham chiếu, currency, amount và kết quả trước ghi nhận. Browser redirect không quyết định PAID. Payment thành công không tự thành COMPLETED Order.

Đơn sandbox chờ tiền giữ kho đã trừ trong thời hạn cấu hình, mặc định demo 15 phút; timeout chưa trả tiền thì hủy và hoàn kho đúng một lần. Tiền VND lưu/tính theo số nguyên đồng và client không tự làm tròn. Callback thành công đến sau hủy không hồi sinh Order hoặc trừ kho lại: ghi trạng thái ngoại lệ để Admin xử lý/hoàn mô phỏng. Payment retry tạo attempt mới, nhưng một Order chỉ được ghi nhận thanh toán thành công hợp lệ một lần; giao dịch thu trùng phải được lưu để đối chiếu. Phí ship chỉ hoàn khi quyết định hậu mãi ghi rõ.

**AC-PAY-01:** sai chữ ký/amount bị từ chối; callback trùng không ghi tiền hai lần; callback cạnh tranh timeout có kết quả nhất quán; fail/cancel không xóa lịch sử attempt; không chuyển tiền thật.

## 10 Xử lý đơn, giao mô phỏng và hủy

### FR-ORD-01 Vòng đời đơn (P0)

| Chuyển trạng thái | Actor đích | Điều kiện |
|---|---|---|
| PENDING_CONFIRMATION → CONFIRMED | Seller của Order | COD hợp lệ hoặc sandbox PAID |
| CONFIRMED → PACKING → READY_TO_SHIP | Seller | Ghi chuẩn bị hàng và thông tin vận chuyển |
| READY_TO_SHIP → SHIPPING | Adapter vận chuyển mô phỏng/Admin được cấp quyền | Có mã vận đơn và bàn giao; không cho khách tự đặt |
| SHIPPING → DELIVERED / DELIVERY_FAILED | Adapter mô phỏng | Ghi lần giao, actor/time; COD cập nhật tiền khi giao thành công |
| DELIVERED → COMPLETED | Người mua hoặc job theo hạn D07 | Hoàn tất fulfillment; hậu mãi giữ vòng đời riêng |
| DELIVERY_FAILED → SHIPPING | Adapter mô phỏng/Admin được cấp quyền | Thử giao lại, tối đa 3 lần theo cấu hình demo |

Mọi chuyển trạng thái có lịch sử, kiểm tra trạng thái nguồn và cạnh tranh. Không cho PATCH enum tự do. Seller chỉ chuẩn bị và bàn giao; adapter mô phỏng hoặc Admin được cấp quyền cập nhật SHIPPING/DELIVERED. Sau DELIVERED, buyer xác nhận hoặc job tự chuyển COMPLETED sau 3 ngày theo cấu hình demo. Không để Seller tự khai “đã giao” trên UI thật mà không thể hiện rõ đang mô phỏng.

### FR-CAN-01 Hủy và hoàn kho (P0)

Người mua hủy PENDING_CONFIRMATION; Seller hủy PENDING_CONFIRMATION/CONFIRMED có lý do. Từ PACKING không hủy trực tiếp theo luồng thường. Hủy cập nhật trạng thái và stock movement đúng một lần; sandbox đã trả tiền phải tạo xử lý hoàn mô phỏng riêng, không coi Order CANCELLED là tiền đã trả lại.

Nếu hàng đã rời kho rồi giao thất bại, không cộng kho chỉ vì nhãn CANCELLED hoặc DELIVERY_FAILED. Hàng mất/hỏng chỉ đóng theo quyết định Admin; chỉ tăng kho khi hàng thực tế đã quay về và được ghi nhận RESTOCKABLE. Không dùng chung quy tắc này với hoàn kho do hủy trước xuất hàng.

**AC-ORD-01/CAN-01:** buyer không hủy đơn người khác; Seller không giao đơn Store khác; confirm và cancel chạy song song chỉ một chuyển hợp lệ; retry cancel không hoàn kho hai lần; giao thất bại chưa nhận hàng về không tăng stock; người mua xem được lịch sử nhưng không lộ dữ liệu người khác.

## 11 Hậu mãi và đánh giá

### FR-RET-01 Trả hàng/hoàn tiền cơ bản (P1)

Người mua chọn OrderItem đã giao trong hạn → gửi lý do/mô tả → Seller chấp thuận hoặc từ chối có lý do → khách có thể đề nghị Admin xem lại → quyết định REFUND_ONLY, RETURN_AND_REFUND hoặc DENIED → nhận hàng nếu cần → ghi hoàn tiền mô phỏng → đóng yêu cầu. Không đổi ngược OrderStatus để biểu diễn hậu mãi.

P1 hoàn toàn bộ lineTotal của một OrderItem đã được thanh toán hoặc COD đã ghi nhận PAID khi giao thành công; không tạo refund cho khoản chưa thu. P1 không hoàn một phần quantity. Backend tính từ snapshot, không tin amount client. Tổng hoàn không vượt lineTotal trên tất cả request/attempt. Một request đang xử lý giữ quyền trên OrderItem; hai key khác nhau không vượt hạn mức. Request PENDING/APPROVED giữ quyền xử lý trên OrderItem; REJECTED/CANCELLED chỉ giải phóng khi chưa refund. Khi có request giữ quyền hoặc tổng refund thành công bằng lineTotal, từ chối request mới với ORDER_ITEM_ALREADY_FULLY_REFUNDED theo scope đã chốt. Khóa theo OrderItem xuyên các request/key, không chỉ chống trùng từng request.

REFUND_ONLY không tăng kho. RETURN_AND_REFUND chỉ tăng kho khi ITEM_RECEIVED và RESTOCKABLE, đúng một lần. Refund tạo adjustment; trước COMPLETED chưa ghi doanh thu âm do doanh thu gốc chưa được ghi, khi COMPLETED áp dụng gross và adjustment nhất quán. Phí ship không tự hoàn cùng lineTotal; chỉ hoàn khi quyết định hậu mãi ghi rõ.

**AC-RET-01:** request trùng/cạnh tranh không hoàn đôi; hàng hỏng không nhập kho; khách sai/ngoài hạn bị từ chối; hoàn trước/sau COMPLETED không sai doanh thu; timeline ghi đủ actor/reason; UI nói “mô phỏng”, không nói tiền thật đã về tài khoản.

### FR-REV-01 Đánh giá (P0)

Chỉ người mua OrderItem thuộc đơn COMPLETED tạo một review cho dòng hàng, điểm 1–5 và nội dung hợp lệ. Cửa sổ tạo/sửa review cấu hình mặc định 30 ngày từ COMPLETED. Seller có tối đa một phản hồi và không được xóa/sửa điểm của khách. Refund không tự xóa Review; UI có thể hiển thị trạng thái giao dịch đã hoàn. Admin chỉ ẩn nội dung vi phạm với reason/audit. Điểm tổng hợp chỉ tính review hợp lệ đang hiển thị.

**AC-REV-01:** chưa mua/chưa hoàn tất hoặc ngoài cửa sổ cấu hình không review; hai request chỉ một review; Store khác không phản hồi; refund không tự xóa review; ẩn review cập nhật điểm tổng hợp; snapshot giao dịch vẫn nguyên.

## 12 Chat, thông báo và vận hành

### FR-CHT-01 Chat khách–Store (P0)

Khách đăng nhập bấm Chat tại Product → lấy/tạo một Conversation cho cặp buyer–Store → hiển thị ngữ cảnh Product → gửi text → lưu DB → phát realtime → người nhận đọc và cập nhật read cursor. Store khác hoặc người ngoài không join/read/send. Không tự chat Store của mình. Admin không mặc định xem nội dung.

REST dự phòng và WebSocket dùng cùng service, membership và clientMessageId chống trùng. Cursor chỉ tiến, message phải thuộc conversation. Reconnect lấy tin sau cursor; client deduplicate messageId. Lịch sử phân trang ổn định; tin nhắn hỗ trợ TEXT và PRODUCT_CONTEXT theo Chat domain, ngữ cảnh Product phải thuộc Store; không hứa exactly-once delivery của mạng, chỉ bảo đảm không nhân bản bản ghi logic. Giới hạn text 2.000 ký tự, rate limit, render text an toàn. Media là P2.

**AC-CHT-01:** hai trình duyệt nhận realtime; restart không mất lịch sử; resend một ID không nhân đôi; người ngoài bị chặn cả REST/socket; expired token không gửi được; unread không đếm tin mình gửi.

### FR-NOT-01 Thông báo (P0; email P1)

Thông báo duyệt Store/Product, đơn, hủy và hậu mãi được tạo cho đúng actor sau giao dịch; thất bại gửi ngoài không rollback giao dịch. Inbox có chưa đọc/đã đọc và link kiểm tra lại quyền. Khóa theo event+recipient+channel để retry không spam; nội dung không chứa secret/địa chỉ không cần thiết.

**AC-NOT-01:** gửi lặp không tạo bản sao; người khác không xem được; email lỗi có retry nhưng đơn vẫn tồn tại; bấm link đối tượng đã hết quyền không lộ dữ liệu.

### FR-RPT-02 Thống kê tìm kiếm theo Store (P1)

Seller xem số lượt Product của Store mình xuất hiện và được nhấp trong tìm kiếm theo kỳ. SearchLog và ClickLog phải liên kết được query/strategy, productId, rank và thời gian; chỉ báo số liệu ghi nhận thực tế. Admin xem tổng hợp toàn sàn. Không lộ query ảnh thô, thông tin riêng của người mua hoặc số liệu Store khác. Lọc bot/lượt trùng, thời hạn giữ log và cách tính lượt hiển thị phải được công bố cùng báo cáo.

**AC-RPT-02:** một bộ query/click fixture cho tổng đúng, Seller A không đọc thống kê B, truy vấn không kết quả không tạo click giả; luồng thiếu dữ liệu trả trạng thái chưa có dữ liệu.

### FR-ADM-01 Admin và audit (P0)

Quản lý account/Store, taxonomy, hàng chờ duyệt, đóng băng và hậu mãi. Hành động nhạy cảm có xác nhận và lý do. Audit ghi actor, entity, command, trạng thái trước/sau, thời gian, correlation ID; không log mật khẩu/token. Không cho Admin cuối cùng tự khóa làm mất toàn bộ khả năng quản trị nếu chưa có phương án khôi phục.

### FR-RPT-01 Dashboard và đối chiếu (P0)

Seller xem số đơn theo trạng thái, số sản phẩm, doanh thu ngày/tháng/quý của Store mình. Admin xem tổng hợp toàn sàn và lỗi đồng bộ. Gross revenue ghi từ Order COMPLETED; net = gross − refund adjustment có hiệu lực. Tiền hàng, phí vận chuyển và số tiền thu hộ hiển thị riêng; không gọi GMV là lợi nhuận/tiền Seller đã nhận. Múi giờ báo cáo Asia/Ho_Chi_Minh, lưu timestamp nhất quán; bảng chi tiết đối chiếu được với số tổng.

**AC-ADM-01/RPT-01:** Seller A không xem số liệu B; hủy không thành doanh thu; refund không trừ hai lần; ranh giới ngày/tháng đúng timezone; audit và bảng tổng đối chiếu cùng bộ đơn kiểm thử.

## 13 Yêu cầu phi chức năng và giao diện

Các ngưỡng dưới đây là **mục tiêu đề xuất cần đo**, không phải kết quả đã đạt.

| ID | Yêu cầu | Cách nghiệm thu |
|---|---|---|
| NFR-SEC-01 | Backend kiểm tra auth/ownership/state mọi command; cookie/session bảo vệ CSRF phù hợp; CORS allowlist | Test trái quyền, giả ID/role, request cross-origin; rà cấu hình |
| NFR-SEC-02 | Upload/search image có giới hạn size/type; image fetch nội bộ chống SSRF, timeout và redirect không an toàn | Input giả, URL nội bộ trái phép, file quá lớn bị chặn |
| NFR-INT-01 | Tiền/kho/history bất biến trước request lặp/cạnh tranh | E2E song song, rollback và retry cho checkout/cancel/refund |
| NFR-PERF-01 | Đề xuất API thường p95 ≤1s, search warm p95 ≤3s trên cấu hình demo công bố | Đo ít nhất 100 request/luồng, 10 client; ghi corpus, lỗi, cold/warm; không đo build time thay latency |
| NFR-REL-01 | Dịch vụ AI/email lỗi không phá dữ liệu đã commit | Inject timeout; khôi phục/retry, có trạng thái lỗi và queue quan sát được |
| NFR-OPS-01 | Fresh checkout và backup/restore demo tái lập được | Máy/DB sạch chạy migration/seed; restore DB+ảnh phù hợp và kiểm tra liên kết |
| NFR-UX-01 | Responsive các trang chính; keyboard, label, focus, tương phản và error rõ | Kiểm tra desktop/mobile, bàn phím và form lỗi; không chỉ screenshot đẹp |
| NFR-OBS-01 | Có request ID, health/readiness, lỗi rút gọn và thời gian xử lý | Truy vết một sự cố không cần in token/PII |
| NFR-PRIV-01 | Thu thập tối thiểu, không public địa chỉ/chat; query ảnh có chính sách lưu/xóa | D09 chốt TTL và người được đọc; kiểm thử quyền và cleanup |

Các màn hình bắt buộc: public home/search/detail/Store; register/login/verify/reset/profile/address; cart/checkout/payment result/orders/return/review; chat; Seller onboarding/dashboard/listing editor/variants/orders/inbox; Admin review Store/Product/category/users/returns/dashboard. Mỗi màn hình có loading, empty, error, success, forbidden; giữ input form khi lỗi an toàn; thao tác tiền/duyệt không chỉ có nút bấm mà phải có trạng thái xác nhận.


## 14 Dữ liệu và điều kiện nghiệm thu tích hợp

### 14.1 Mô hình dữ liệu logic

Các quan hệ dưới đây kế thừa ERD v0.5 và bổ sung miền hồ sơ, phiên, vận chuyển, hậu mãi. Đây là mô hình yêu cầu đích, không xác nhận toàn bộ bảng đã tồn tại. Tên bảng, kiểu enum và migration cụ thể thuộc thiết kế kỹ thuật được review; P2 không được lẫn vào schema triển khai bắt buộc.

| Quan hệ | Lực lượng | Bất biến |
|---|---|---|
| User và Store | Một User sở hữu 0 hoặc 1 Store | Store duy nhất theo chủ; duyệt Store không làm mất quyền mua |
| User và Address hoặc Session hoặc Identity | Một User có 0 đến nhiều bản ghi | Ownership theo User; identity duy nhất theo provider và subject; không ghép account theo email trùng |
| Store và Product | Một Store có 0 đến nhiều Product; mỗi Product thuộc một Store | Không đổi chủ Store qua payload client; giữ tham chiếu đơn cũ |
| Category và Category con | Một Category có 0 đến nhiều con; con có tối đa một cha | Không chu trình; category lá và toàn bộ tổ tiên phải hợp lệ |
| Category và thuộc tính mô tả | Một Category có nhiều definition trực tiếp; definition có option chuẩn | Giai đoạn đầu chỉ lấy definition trực tiếp của category lá; ProductAttributeValue đúng kiểu và option đúng definition |
| Product và Brand | Product có 0 hoặc 1 Brand | Thiếu bằng chứng thương hiệu được để null |
| Product và Variant | Product DRAFT có 0 đến nhiều Variant | Bán được cần ít nhất một Variant hợp lệ; sản phẩm không phân loại có default variant |
| Product và OptionGroup và OptionValue | Một Product có nhiều group; group có nhiều value | Tất cả thuộc cùng Product; Variant chọn đủ một value mỗi group áp dụng |
| Product và Image hoặc ShippingProfile | Nhiều ảnh; tối đa một profile kiện hàng | Tối đa một ảnh chính, đúng một trước submit; weight dương; ảnh theo option đúng Product |
| Cart và CartItem và Variant | Một cart mỗi User; nhiều dòng theo Variant | Unique cart và variant; quantity nguyên dương; cart không giữ kho |
| Checkout và Order và OrderItem | Một Checkout thành công có ít nhất một Order; mỗi Order có ít nhất một dòng | Một Order thuộc một Store; tạo cả nhóm trong transaction; snapshot bất biến |
| Order và Payment và PaymentAttempt | Một Order có payment logic và lịch sử nhiều lần thử | Ghi nhận thanh toán hợp lệ một lần; giữ được giao dịch trùng để đối chiếu |
| Order và Shipment và History | Một đơn có vận chuyển mô phỏng và nhiều mốc | Không dùng PaymentStatus hoặc ReturnStatus làm OrderStatus |
| OrderItem và ReturnRequest | Một dòng có nhiều request trong lịch sử | Tối đa một request giữ quyền xử lý; tổng hoàn không vượt lineTotal |
| Refund và RevenueAdjustment | Một refund thành công có một adjustment | Unique theo refund; ghi và áp dụng idempotent theo thời điểm ghi doanh thu |
| Variant và StockMovement | Một Variant có nhiều bút toán nhập hoặc xuất | Có nguyên nhân, tham chiếu và khóa chống lặp; tồn không âm |
| OrderItem và Review và Reply | Tối đa một Review mỗi OrderItem; tối đa một phản hồi Seller | Người mua đủ điều kiện; Seller sở hữu Store; Admin ẩn có audit |
| User và Store và Conversation | Unique theo cặp User mua và Store | Chủ Store không tự chat; Product context không tạo hội thoại thứ hai |
| Conversation và Message và ReadState | Nhiều Message; một read state mỗi thành viên | Unique conversation, sender, clientMessageId; cursor thuộc conversation và chỉ tiến |
| Product và SearchOutbox | Nhiều version/event theo Product | Tạo cùng transaction thay đổi nghiệp vụ; không công nhận hoàn tất khi chỉ một index thành công |
| SearchLog và ClickLog | Một lần tìm kiếm có 0 đến nhiều click | Có strategy, productId, rank và thời gian; metadata log giữ 30 ngày theo cấu hình demo, không lưu ảnh query thô mặc định |
| Event và Notification và Audit | Nhiều người nhận, mỗi kênh một bản ghi logic | Unique event, recipient, channel; audit không chứa secret |

### 14.2 Từ điển dữ liệu và ràng buộc trọng tâm

| Nhóm | Trường tối thiểu về mặt nghiệp vụ | Ràng buộc |
|---|---|---|
| Product | productId, externalId, storeId, categoryId, brandId, nội dung, sellerStatus, moderationStatus, version | productId Int PostgreSQL; externalId nullable và unique khi có; trạng thái bán và duyệt độc lập |
| ProductVariant | variantId, productId, storeId, skuCode, sellerSku, optionSignature, price, stock, isActive | skuCode unique toàn sàn; sellerSku nullable unique trong Store; unique productId và signature; không dùng float tính tiền |
| ProductVariantOptionValue | variantId, productId, optionGroupId, optionValueId | Khóa/FK hoặc transaction chứng minh cùng Product và một value mỗi group |
| Checkout | userId, idempotencyKey, requestHash, danh sách Order | Unique user và key; cùng key khác nội dung là conflict; hash chỉ từ dữ liệu chuẩn hóa |
| OrderItem | variantId, productId, tên/SKU/option snapshot, unitPrice, quantity, lineTotal | Không tính lại đơn cũ từ Product; khóa dòng khi checkout/refund cạnh tranh |
| Order | buyerId, storeId, trạng thái, địa chỉ snapshot, subtotal, shippingFee, total, completedAt | Total do Backend tính; thông tin phí riêng, không lấy total từ client |
| Payment và transaction | orderId, provider, amount, currency, status, providerTransactionId, idempotencyKey | Mã giao dịch unique trong provider; xác minh callback; không mất lịch sử fail/timeout |
| ReturnRequest và Refund | orderItemId, resolution, status, reason, amount, idempotencyKey, history | Hoàn toàn lineTotal P1, không quá hạn mức xuyên request; actor/reason/time đầy đủ |
| RevenueAdjustment | refundId, orderItemId, amount, thời điểm có hiệu lực/áp dụng | Unique refund; trước COMPLETED chưa trừ projection; sau COMPLETED áp đúng một lần |
| StockMovement | variantId, quantity delta, reason, sourceId, idempotencyKey | Checkout giảm; hủy trước giao hoàn; return chỉ tăng khi đã nhận và bán lại được |
| SearchOutbox | productId, version, operation, payload, attempts, trạng thái, nextRetry, lastError | Payload/version ổn định khi retry; fingerprint và lỗi theo contract Search được duyệt |
| Message | conversationId, senderId, clientMessageId, type, text, contextProductId, createdAt | Sender từ JWT; TEXT hoặc PRODUCT_CONTEXT; text tối đa 2.000 ký tự |

### 14.3 Release gate và bằng chứng

| Gate | Phạm vi cần chạy | Bằng chứng và người phối hợp |
|---|---|---|
| G-ACCOUNT | Register/login/refresh/logout, đổi mật khẩu, profile/address, multi-capability; xác thực bổ sung P1 | UI + test phiên/ownership/identity; Hoàng triển khai, Hiền QA |
| G-SELLER | User mở Store, Admin duyệt, vẫn mua được; từ chối/nộp lại/đình chỉ | Luồng hai role và lịch sử cùng Store; Hoàng và Hiền |
| G-LISTING | Draft, thuộc tính, SKU, ảnh, submit, duyệt, public, sửa/ẩn | API/UI + test cạnh tranh, ảnh, trạng thái; Hoàng và Hiền |
| G-DISCOVERY | Outbox, Elasticsearch thật, FAISS, hydrate PostgreSQL, Web | Mapping/version, log tích hợp, query độc lập; Đạt và Hoàng, Hiền đối chiếu |
| G-CHECKOUT | Nhiều Store, tranh kho, snapshot, COD, VNPay và MoMo sandbox | E2E transaction, retry, callback; Hoàng và Hiền |
| G-FULFILMENT | Đơn, giao mô phỏng, hủy, giao thất bại, thông báo | Timeline/tiền/kho đúng trước lỗi và retry; Hoàng và Hiền |
| G-AFTERSALE | Hậu mãi, review và chat | Refund race, doanh thu, restock, realtime và trái quyền; Hoàng và Hiền |
| G-OPERATE | Dashboard, CI, môi trường sạch, backup/restore và báo cáo thực nghiệm | Fixture đối chiếu, hướng dẫn tái lập, số liệu có nguồn; cả nhóm |

Mỗi gate phải lưu commit, môi trường, dữ liệu đầu vào, kết quả thực tế và log/ảnh kiểm chứng. Bản SRS này không tự đánh dấu gate PASS. Việc mapping có 86 cặp ID hoặc CI repository xanh không thay thế các gate public và giao dịch.

## 15 Quyết định nghiệp vụ đã xác nhận

Hoàng xác nhận D01–D10 ngày 23/09/2026 trên PR #5. Đạt xác nhận D04/D09 ngày 24/09/2026 theo contract PR #8. Đây là yêu cầu đích cho bản bảo vệ; cột trạng thái dưới đây không thay thế bằng chứng code merge và test.

| Quyết định | Chính sách đã chốt | Xác nhận và trạng thái triển khai |
|---|---|---|
| D01 Phiên và xác minh | P0 cho đăng nhập email/password ngay sau đăng ký. Khi P1 verify bật, browsing/profile vẫn dùng được; checkout và Seller onboarding yêu cầu verified. Logout thu hồi session hiện tại; đổi/quên mật khẩu thu hồi mọi refresh session. Không tự liên kết OAuth theo email trùng. | Hoàng 23/09. TARGET cho phần verify/identity và chính sách nhiều session; CURRENT chỉ theo code/test Auth đã merge. |
| D02 Sửa Product | Name, description, category, brand, attribute, option/SKU structure, ảnh và shipping profile phải về DRAFT/NOT_SUBMITTED, ngừng public và duyệt lại. Price/stock chỉ được tách khi có command, audit, version và outbox. Seller chọn subset SKU nhưng mỗi SKU đủ option group và không trùng signature. | Hoàng 23/09. PR #18 IN_PROGRESS và đang dùng chính sách chặt hơn; không tự nới. |
| D03 Thuộc tính Category | Giai đoạn đầu dùng definition trực tiếp của category lá, không kế thừa ngầm. Thêm/bật required phải revalidate Product; không tự sinh giá trị; Product public thiếu required phải ngừng public, thông báo Seller và đồng bộ Search. | Hoàng 23/09. TARGET cho revalidation/public gate cho tới khi có implementation và test. |
| D04 Public và bộ lọc | Hết kho vẫn có thể hiển thị nhưng không mua. Elasticsearch chỉ tạo ứng viên; Backend hydrate PostgreSQL và kiểm tra giá/inStock trên cùng một Variant active. Giữ over-fetch; rating chờ aggregate chuẩn. | Hoàng 23/09, Đạt 24/09 xác nhận tương thích PR #8 và không đổi payload. Backend hydrate/filter E2E vẫn TARGET/IN_PROGRESS. |
| D05 Tự mua và review | Chặn mua Store của chính mình. Một Review mỗi OrderItem COMPLETED; cửa sổ tạo/sửa mặc định 30 ngày. Seller có một phản hồi, không sửa điểm; refund không tự xóa Review; Admin ẩn vi phạm có reason/audit. | Hoàng 23/09. TARGET cho Cart/Order/Review implementation. |
| D06 Thanh toán nhiều Store | Checkout tạo một Order mỗi Store trong transaction, mỗi Order có một Payment. Giữ kho sandbox mặc định 15 phút; VND dùng số nguyên đồng. Callback muộn không hồi sinh Order; khoản thu trùng lưu đối chiếu; phí ship chỉ hoàn khi quyết định ghi rõ. | Hoàng 23/09. TARGET/P1 cho sandbox Payment và ngoại lệ callback. |
| D07 Giao mô phỏng | Seller chuẩn bị/bàn giao; adapter mô phỏng hoặc Admin cập nhật SHIPPING/DELIVERED. Tối đa 3 lần giao lại. Buyer xác nhận hoặc job tự COMPLETED sau 3 ngày. DELIVERY_FAILED không tự hoàn kho; chỉ nhập khi hàng quay về và RESTOCKABLE. | Hoàng 23/09. TARGET cho Order/Shipment; thời hạn là cấu hình demo. |
| D08 Store đình chỉ | SUSPENDED chặn bán mới nhưng account ACTIVE còn xử lý Order, ReturnRequest và Chat của giao dịch cũ. Account khóa thì Admin/support tiếp nhận có audit. Buyer vẫn xem lịch sử và hậu mãi. | Hoàng 23/09. Store lifecycle cơ bản CURRENT; quyền giới hạn giao dịch cũ là TARGET. |
| D09 Ảnh và lưu dữ liệu | Ảnh draft private; Search worker dùng signed/expiring URL từ Backend với host allowlist. Ảnh query multipart tối đa 5 MB, xử lý trong bộ nhớ và không lưu mặc định. Product tối đa 9 ảnh; staging 1 giờ, trash 24 giờ, metadata log 30 ngày, audit 90 ngày theo cấu hình demo. | Hoàng 23/09, Đạt 24/09 xác nhận signed URL phù hợp PR #8. Custom auth header cần PR contract riêng. PR #18 còn blocker decode ảnh thật. |
| D10 Lịch và phạm vi | Giữ P0+P1 theo implementation-scope; bảo vệ dự kiến tháng 12/2026, chưa có ngày cụ thể. Giữ mốc quản lý 27/09, 11/10, 18/10, 25/10; không tự bỏ VNPay/MoMo sandbox hoặc hậu mãi P1. | Hoàng 23/09. Mốc phải cập nhật khi trường chốt lịch; owner: Hoàng Web/DB, Đạt Search/AI, Hiền SRS/Admin/QA/dataset. |

Các thông số demo trên phải nằm trong cấu hình trước nghiệm thu. Nếu implementation chưa có, test vẫn ở NOT_RUN hoặc BLOCKED; fixture không được trình bày thành trạng thái CURRENT.

## 16 Đặc tả Use Case và luồng liên thông

Các UC-HT01 đến UC-HT10 giữ mã từ v0.5. Luồng chi tiết được thực hiện cùng FR/AC ở phần nghiệp vụ; các UC mở rộng được thêm mã mới để tránh nhét hậu mãi hoặc thanh toán vào cùng trạng thái đơn.

### UC-HT01 Tài khoản và phiên đăng nhập

Actor là khách hoặc User. Khách đăng ký tài khoản người mua và có thể đăng nhập ngay bằng email/password trong P0; User đăng nhập, refresh, logout hoặc đổi mật khẩu. Khi P1 verify bật, checkout và gửi Seller onboarding yêu cầu email verified. Logout thu hồi session hiện tại; đổi/quên mật khẩu thu hồi mọi refresh session. Backend tự lấy actor và kiểm tra account hợp lệ. Email trùng, mật khẩu sai, refresh đã dùng và tài khoản khóa phải bị chặn; không trả secret hoặc tự liên kết OAuth theo email. Liên quan FR-ACC-01/02/04.

### UC-HT02 Tra cứu và xem sản phẩm

Actor là khách/User; tiền điều kiện để nghiệm thu là có fixture Product public và query có nhãn phù hợp. Frontend gửi text hoặc ảnh multipart cho Backend; Backend validate rồi gọi FastAPI. Text hybrid dùng Elasticsearch và CLIP/FAISS rồi RRF; ảnh dùng embedding và FAISS. Elasticsearch chỉ tạo ứng viên; Backend lấy ID đã xếp hạng, hydrate PostgreSQL, kiểm tra public và điều kiện giá/inStock trên cùng một Variant active, loại mục không hợp lệ rồi giữ thứ tự tương đối. Ảnh query tối đa 5 MB, xử lý tạm và không lưu mặc định. Timeout, ảnh lỗi, ID không còn tồn tại và không kết quả có phản hồi riêng. FR-SRC-01/02/03 và FR-EVAL-01.

### UC-HT03 Quản lý giỏ hàng

User chọn variant và quantity, Backend kiểm tra public/ownership và chặn Variant thuộc Store của chính User, thêm hoặc cập nhật cùng cartItem rồi hiển thị nhóm theo Store. Giỏ không giữ kho; mỗi lần xem/checkout phải lấy lại giá và tính khả dụng. Hết hàng/ẩn/đổi giá có thông báo, không tự đổi SKU và không tin total từ client. Hậu điều kiện cart lưu trên tài khoản, unique cart và variant. FR-CAR-01.

### UC-HT04 Checkout và theo dõi đơn mua

User đăng nhập chọn các dòng giỏ, địa chỉ của mình và COD hoặc provider sandbox. Backend tạo preview, yêu cầu xác nhận lại nếu giá đổi, kiểm tra public/kho và idempotency. Trong cùng transaction, tạo nhóm Checkout và một Order mỗi Store, lưu snapshot, Payment, trừ kho và stock movement. Sau commit xóa đúng dòng đã mua, phát thông báo và tạo phiên provider nếu cần. Một dòng lỗi rollback cả nhóm; gửi lặp cùng key/nội dung trả nhóm cũ, key khác payload trả conflict. Client mất phản hồi tra lại trạng thái thay vì đặt mới. User xem timeline hoặc hủy đúng trạng thái. FR-CHK-01, PAY-01, ORD-01, CAN-01; thanh toán từng Order và timeout theo D06.

### UC-HT05 Đánh giá và phản hồi

Người mua chọn OrderItem thuộc Order COMPLETED, nhập rating 1–5 và nội dung; Backend kiểm tra ownership và unique trước lưu. Seller tạo/cập nhật tối đa một phản hồi cho review thuộc Store; Admin ẩn/hiện có lý do. Chưa mua, sai Store, gửi trùng và quyền sai bị từ chối. Điểm tổng hợp dùng review hợp lệ đang hiển thị; snapshot đơn vẫn nguyên. FR-REV-01; D05 xác định sửa review và chính sách sau refund.

### UC-HT06 Quản lý Store và đăng sản phẩm

User nộp hồ sơ Store, Admin ACTIVE hoặc REJECTED có lý do; REJECTED được sửa/nộp lại cùng ID, SUSPENDED chỉ Admin khôi phục. Seller tạo Product DRAFT, chọn category, nhập thuộc tính mô tả, option/variant, ảnh chính và kiện hàng; gửi duyệt sau khi đủ điều kiện. Admin kiểm tra đúng version và duyệt; Product public theo toàn bộ predicate. Cập nhật Product và outbox cùng transaction; lỗi Search không mất dữ liệu nghiệp vụ. Trái quyền, SKU/tổ hợp trùng, option khác Product, thiếu dữ liệu submit và review cạnh tranh bị chặn. FR-STO-01/02, CAT-01, PRD-01/02/03, MED-01; D02/D03/D04 áp dụng phần bổ sung.

### UC-HT07 Xử lý đơn và doanh thu Store

Seller xem Order của Store, xác nhận đơn hợp lệ, chuẩn bị và bàn giao hàng. Adapter mô phỏng hoặc Admin được cấp quyền cập nhật SHIPPING/DELIVERED; tối đa 3 lần giao lại theo cấu hình. Buyer xác nhận hoặc job tự COMPLETED sau 3 ngày. COD ghi PAID khi DELIVERED. Dashboard chỉ cộng gross khi COMPLETED; hủy trước giao hoàn tồn đúng một lần. DELIVERY_FAILED chưa nhận lại hàng RESTOCKABLE không tăng kho. Store SUSPENDED có account ACTIVE chỉ xử lý giao dịch cũ; account khóa thì Admin/support tiếp nhận có audit. Refund xử lý ở UC-HT12 và adjustment, không lùi OrderStatus. FR-ORD-01, CAN-01, RPT-01.

### UC-HT08 Quản trị thống kê và vận hành

Admin xem tổng hợp, Seller xem riêng Store, chọn khoảng thời gian để đọc đơn/doanh thu và tìm kiếm/click. Mỗi số tổng đối chiếu được các đơn/movement/adjustment nguồn. Health lỗi hiển thị thời điểm kiểm tra và trạng thái thực, không trả số liệu thành công giả. Tài khoản sai quyền không xem báo cáo khác phạm vi. FR-ADM-01, RPT-01/02 và NFR-OBS-01.

### UC-HT09 Danh mục và kiểm duyệt

Admin quản lý category/brand/thuộc tính; từ chối chu trình, slug trùng, FK không hợp lệ và tắt category còn ràng buộc. Admin xử lý Store/Product theo version, lưu actor/time/reason. Seller không tự approve hoặc mở Product FROZEN. Khi trạng thái làm mất public, Backend chặn ngay và phát đồng bộ index; retry không ghi quyết định hai lần. FR-CAT-01, STO-02, PRD-02, ADM-01; D03/D08.

### UC-HT10 Chat khách và Store

User mở chat từ Product của Store khác; Backend tạo hoặc lấy conversation duy nhất theo User–Store. TEXT/PRODUCT_CONTEXT được validate, lưu trước khi phát realtime. Client retry dùng clientMessageId; reconnect tải bù và deduplicate messageId. Read cursor phải thuộc conversation, chỉ tiến; unread không đếm tin mình gửi. Người ngoài không join/read/send qua cả REST lẫn socket; JWT hết hạn không gửi được. Admin không mặc định đọc nội dung; media là P2. FR-CHT-01.

### UC-HT11 Thanh toán sandbox

User chọn Order của mình còn đủ điều kiện, Backend lấy amount VND nguyên đồng từ PostgreSQL và tạo PaymentAttempt riêng cho Order. Kho được giữ trong thời hạn cấu hình mặc định 15 phút. Provider sandbox nhận yêu cầu, người mua thao tác và provider gửi callback. Backend xác minh chữ ký, amount/currency/reference trước ghi nhận; browser return chỉ hiển thị kết quả tra từ Backend. Duplicate callback không ghi nhận đôi; callback lỗi giữ lịch sử; callback PAID sau khi Order timeout/cancel được ghi ngoại lệ để xử lý/hoàn mô phỏng và không hồi sinh Order. FR-PAY-01. Tên endpoint/cách ký theo tài liệu provider tại thời điểm tích hợp.

### UC-HT12 Hậu mãi cơ bản

Người mua mở yêu cầu trên OrderItem đã giao, đã ghi nhận thanh toán và trong cửa sổ cấu hình. Seller phản hồi; Admin quyết định bất đồng. Backend khóa OrderItem và kiểm tra mọi request/refund: một quyền xử lý, hoàn tối đa lineTotal từ snapshot. REFUND_ONLY không tăng kho; RETURN_AND_REFUND chỉ nhập khi ITEM_RECEIVED và RESTOCKABLE. Refund/adjustment/movement idempotent và có lịch sử; reject/cancel chỉ giải phóng khi chưa refund. Trước COMPLETED chưa áp doanh thu âm, sau COMPLETED net được điều chỉnh đúng một lần. FR-RET-01, RPT-01; thời hạn/phí D07.

### UC-HT13 Hồ sơ địa chỉ và thông báo

User sửa thông tin của mình, quản lý nhiều địa chỉ và tối đa một mặc định; hệ thống xác minh lại khi thay thông tin dùng xác thực. Đơn đã tạo giữ snapshot cũ. Sau sự kiện đơn/duyệt/hậu mãi commit, hệ thống tạo thông báo đúng người nhận; gửi email lỗi không rollback nghiệp vụ. Link thông báo vẫn kiểm tra quyền tại thời điểm mở. FR-ACC-03, NOT-01; email adapter thuộc P1.

## 17 Ranh giới tích hợp và hợp đồng giao tiếp

### 17.1 Giao diện chức năng giữa các thành phần

Danh sách này mô tả các thao tác phải có, không công bố endpoint đã triển khai. Thiết kế API phải ghi method/path, request/response, quyền, state guard, idempotency, lỗi và FR/TC liên quan. Frontend không tự quyết định quyền, trạng thái tiền, giá hoặc tồn kho.

| Miền API | Thao tác yêu cầu | Quyền và điều kiện quan trọng |
|---|---|---|
| Auth và Profile | Register/login/refresh/logout/me; đổi mật khẩu; profile/address; verify/reset/identity/OTP | Actor từ phiên; token một lần; không tự cấp Admin/Seller; ownership địa chỉ |
| Store | Tạo/sửa/nộp lại; duyệt/từ chối/đình chỉ/khôi phục; xem công khai | Một Store mỗi chủ; REJECTED nộp lại; history và cạnh tranh |
| Catalog | Category/Brand/attribute/option; danh sách gợi ý Seller | Admin quản trị; chống chu trình và phá tham chiếu |
| Product và Media | Draft CRUD; variant/option/giá/kho; upload/primary/delete; submit/review/hide/freeze; public list/detail | Ownership, version, validation submit/public, file lifecycle và audit |
| Search | Text hybrid, image multipart, semantic cho thử nghiệm; health; index UPSERT/DELETE và báo lỗi | FastAPI tạo ứng viên; Backend hydrate/recheck cùng Variant; worker dùng signed URL có thời hạn và allowlist |
| Cart và Checkout | CRUD giỏ; preview; submit checkout; tra kết quả theo key | User sở hữu; server tính tiền; transaction và chống lặp |
| Order và Shipping | Xem đơn/history; confirm/pack/handover; mô phỏng giao; cancel/complete | Command theo trạng thái, actor đã chốt D07, không PATCH enum tự do |
| Payment | Tạo attempt; nhận callback; xem trạng thái và xử lý ngoại lệ | Chữ ký/amount/reference; return URL không ghi PAID |
| Return và Review | Tạo/phản hồi/resolve/nhận hàng/refund; review/reply/moderation | Ownership, hạn mức xuyên request, chỉ nhập kho đủ điều kiện |
| Chat | Lấy conversation, lịch sử, gửi tin, read-state; socket join/send/event | Cùng service và membership cho REST/socket, idempotency logic |
| Admin và Report | Account, moderation, audit, dashboard, lỗi outbox; inbox thông báo | Theo phạm vi dữ liệu; lý do và audit; không lộ secret hoặc nội dung chat riêng |

### 17.2 Search và xử lý lỗi đồng bộ

Các endpoint được nhắc trong thiết kế gồm /search/hybrid, /search/image, /search/text và thao tác index. Hoàng–Đạt chốt tên/method/payload và tham số thực tế trong docs/api/ai-service-contract.md của PR #8. /search/text là nhánh semantic phục vụ thực nghiệm; RRF nằm ở FastAPI, không triển khai thêm một RRF ở NestJS.

Phản hồi phải phân biệt kết quả đầy đủ, degraded hoặc lỗi có kiểm soát theo contract. Outbox chỉ hoàn tất khi tất cả index bắt buộc đã đạt trạng thái tương ứng; retry không thay productId/version/operation/payload. Contract cần thể hiện các trường hợp STALE/NOOP, PARTIAL_FAILURE và VERSION_CONFLICT cùng phản hồi từng index theo bản được Hoàng–Đạt xác nhận; SRS không tự chọn mã HTTP hay thêm filter ngoài contract. Backend luôn kiểm tra public và dữ liệu hiện hành từ PostgreSQL trong lúc index chậm.

### 17.3 Luồng dữ liệu tiền và tồn kho

Checkout transaction ghi Order/Item snapshot, Payment và giảm tồn; lệnh gọi provider nằm ngoài transaction sau commit và có trạng thái phục hồi khi lỗi. Callback vào Backend được xác minh rồi chuyển Payment, ghi lịch sử và phát thông báo; không tự hoàn tất Order. Hủy trước bàn giao hoàn tồn một lần. Sau bàn giao, chỉ nhập kho khi hàng quay lại và đủ điều kiện. Đối chiếu phải dựa trên stock movement và payment/refund record, không suy từ một nhãn OrderStatus.

## 18 Truy vết yêu cầu và kế thừa phiên bản

### 18.1 Mã yêu cầu cũ và mã miền tương ứng

Các mã ở cột cuối được hiểu có tiền tố FR trừ NFR. Alias chỉ nhóm lại cách trình bày; không thay đổi tiêu chí nghiệp vụ gốc khi không có quyết định phạm vi. Dashboard cơ bản thuộc P0 theo implementation-scope; search analytics và báo cáo nâng cao P1. FR-02 chuyển về P1 theo nguồn phạm vi mới hơn, không bỏ chức năng.

| Mã cũ | Nội dung kế thừa | Mã v3 tương ứng |
|---|---|---|
| FR-00 | Đăng ký/đăng nhập/đăng xuất | ACC-01; STO-01 |
| FR-01 | Đổi mật khẩu, quản lý tài khoản | ACC-03; ACC-04; STO-01 |
| FR-02 | Xác minh và khôi phục tài khoản | ACC-02 |
| FR-03 | Hồ sơ, địa chỉ và thông báo | ACC-03; NOT-01 |
| FR-U01 | Tìm kiếm sản phẩm truyền thống | SRC-01; SRC-02 |
| FR-U02 | Tìm kiếm sản phẩm bằng hình ảnh | SRC-01; SRC-03 |
| FR-U03 | Xem chi tiết sản phẩm | PRD-03 |
| FR-U04 | Giỏ hàng | CAR-01 |
| FR-U05 | Đặt hàng và thanh toán | CHK-01; PAY-01 |
| FR-U06 | Quản lý đơn hàng cá nhân | ORD-01; CAN-01 |
| FR-U07 | Đánh giá sản phẩm | REV-01 |
| FR-U08 | Chat với Store | CHT-01 |
| FR-U09 | Yêu cầu hậu mãi | RET-01 |
| FR-S01 | Đăng ký gian hàng/Seller profile | STO-01; STO-02 |
| FR-S02 | Quản lý sản phẩm, thuộc tính và biến thể | CAT-01; PRD-01; PRD-02; MED-01 |
| FR-S03 | Quản lý đơn hàng, giao dịch | ORD-01; CAN-01 |
| FR-S04 | Đối soát doanh thu cửa hàng | RPT-01; RET-01 |
| FR-S05 | Thống kê tìm kiếm cửa hàng | RPT-02 |
| FR-S06 | Quản lý inbox | CHT-01 |
| FR-S07 | Phản hồi đánh giá | REV-01 |
| FR-S08 | Phản hồi hậu mãi | RET-01 |
| FR-A01 | Quản lý User/Seller | ADM-01; ACC-01 |
| FR-A02 | Quản lý Category/Brand và thuộc tính | CAT-01 |
| FR-A03 | Kiểm duyệt sản phẩm | PRD-02; ADM-01 |
| FR-A04 | Giám sát hệ thống | ADM-01; NFR-OBS-01 |
| FR-A05 | Thống kê, báo cáo toàn sàn | RPT-01; RPT-02 |
| FR-A06 | Kiểm duyệt đánh giá | REV-01; ADM-01 |
| FR-A07 | Quyết định hậu mãi bất đồng | RET-01; ADM-01 |
| FR-AI01 | Tiền xử lý và gán nhãn dataset | DAT-01; EVAL-01 |
| FR-AI02 | Trích embedding văn bản và ảnh | SRC-03 |
| FR-AI03 | Kết hợp văn bản–hình ảnh | SRC-03; EVAL-01 |
| FR-AI04 | Lập chỉ mục vector | SRC-02; SRC-03 |
| FR-AI05 | Truy vấn tương đồng | SRC-01; SRC-03 |
| FR-AI06 | Elasticsearch | SRC-01; SRC-02 |
| FR-AI07 | Hợp nhất bằng RRF | SRC-01 |
| FR-AI08 | API tìm kiếm và lập chỉ mục | SRC-01; SRC-02 |
| FR-AI09 | Đánh giá định lượng | EVAL-01 |

### 18.2 Ma trận yêu cầu tới Use Case và kiểm thử

| Miền FR | UC và API hoặc dữ liệu | Ca kiểm thử kế thừa và bổ sung |
|---|---|---|
| ACC-01/02/03/04 | UC-HT01/13; Auth/Profile; User, Session, Identity, Address | TC-01/02/03/38/45/46/58 |
| STO-01/02 | UC-HT06/09; Store command/public; Store, History | TC-34/35/38/52 |
| CAT-01 | UC-HT06/09; Catalog; Category/Brand/Attribute | TC-18/25/36/37/54 |
| PRD-01/02/03 và MED-01 | UC-HT06/09; Product/Media; Product, Variant, Image, ShippingProfile | TC-04/05/21/22/23/24/47/48/49/54 |
| SRC-01/02/03 và DAT-01 | UC-HT02; Search/Index/Import; ProductId, Mapping, Outbox | TC-06/07/08/09/26/27/55/56 |
| EVAL-01 | UC-HT02; thực nghiệm offline; corpus/query/nhãn/config | TC-57; báo cáo P@K/R@K/latency/fusion Việt–Anh |
| CAR-01 và CHK-01 | UC-HT03/04; Cart/Checkout; Variant, Order/Item, StockMovement | TC-10/11/12/13/20/53 |
| PAY-01 | UC-HT11; Payment/callback; PaymentAttempt, Transaction | TC-30/31/32/33/50/51 |
| ORD-01 và CAN-01 | UC-HT04/07; Order/Shipping; History, StockMovement | TC-14/15/16/17/20/52 |
| RET-01 và RPT-01 | UC-HT07/08/12; Return/Report; Refund, Adjustment | TC-19/33/39/40/41/42/43/44/60 |
| REV-01 | UC-HT05; Review/Reply; OrderItem, Audit | TC-53/59 |
| CHT-01 | UC-HT10; REST/socket; Conversation/Message/ReadState | TC-28/29; E2E hai trình duyệt và restart |
| NOT-01 và ADM-01 | UC-HT08/09/13; Notification/Admin; Inbox, Audit | TC-03/35/37/48/52/58/60 |
| RPT-02 | UC-HT08; Search analytics; SearchLog, ClickLog | TC-60; fixture query/click và quyền Store |

### 18.3 Kế thừa yêu cầu phi chức năng

| Mã cũ | Mã v3 | Điều chỉnh và bằng chứng |
|---|---|---|
| NFR-01 | NFR-PERF-01 | Giữ mục tiêu tìm kiếm dưới 3 giây; đo p95/cold/warm; timeout/candidateK theo contract, không khóa lại giá trị 2 giây cũ |
| NFR-02 | NFR-OPS-01 và REL-01 | Tách Backend/Search, Docker, health và khôi phục |
| NFR-03 | NFR-SEC-01/02 và PRIV-01 | Auth/ownership, callback, upload; ảnh query JPEG/PNG tối đa 5 MB là mục tiêu cần đồng bộ validation |
| NFR-04 | NFR-OPS-01 | Module/config/migration/seed và hướng dẫn môi trường sạch |
| NFR-05 | NFR-INT-01 và FR-EVAL-01 | Tiền/kho đúng và phép đo tìm kiếm có thể tái lập |
| NFR-06 | NFR-UX-01 | Màn hình chính ở chiều rộng 360 và 1366 px; loading/empty/error/forbidden và thao tác bàn phím |
| NFR-07 | FR-SRC-02 và NFR-REL-01 | Outbox bền vững, lỗi từng index, retry/version |
| NFR-08 | FR-CHT-01 và NFR-REL-01 | Reconnect, DB history, dedup và read cursor |
| NFR-09 | FR-PAY-01 và NFR-INT-01 | Callback xác minh, retry, trạng thái Payment độc lập |


### 18.4 Ma trận truy vết triển khai

Ma trận này được rà riêng phạm vi Admin gần nhất ngày **22/10/2026**; các miền
khác vẫn giữ baseline lịch sử cho đến lượt đồng bộ riêng. `CURRENT/PASS` chỉ dùng
cho phần đã merge và có bằng chứng runtime phù hợp. `PREPARATION` là code/test
local chưa tích hợp API thật; `NOT_RUN/WAITING_BACKEND` không được trình bày như
chức năng đã hoàn thành trong báo cáo.

| Requirement | Use Case | API | Database | UI | Test | PR/commit | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| ACC-01/02/03/04 | UC-HT01/13 | Auth, profile, address, identity | User, RefreshSession, Identity, Address | Register/login/profile/address | TC-01/02/03/38/45/46/58 | PR #4; PR #17 | CURRENT auth cơ bản; TARGET verify/profile/multi-capability | Hoàng triển khai; Hiền QA |
| STO-01/02, CAT-01 | UC-HT06/09 | Store, Category, Brand, attribute | Store/History, Category, Brand, definition/option | Onboarding; Seller/Admin catalog | TC-18/25/34–38/52/54 | PR #15 | CURRENT Store/Category/Brand cơ bản; TARGET capability và revalidation | Hoàng; Hiền review/QA |
| PRD-01/02/03, MED-01 | UC-HT06/09 | Seller Product/Variant/Image/Shipping/Submit; Admin/Public | Product, Variant, Image, ShippingProfile, Outbox | Seller editor; moderation; public detail | TC-04–06/21–24/47–49/54/56 | PR #18 `ffc89c3` | IN_PROGRESS; Admin moderation/Public/hide/show/outbox chưa hoàn tất | Hoàng; Hiền nghiệp vụ; Đạt Search/import |
| SRC-01/02/03 | UC-HT02 | Search hybrid/image/text; index/health | ProductId mapping, SearchOutbox, ES/FAISS index | Search/filter/results | TC-06–09/26/27/49/56 | PR #8 `0703f23` | IN_PROGRESS; Backend outbox/hydrate E2E chưa nối | Đạt Search; Hoàng Backend; Hiền QA |
| DAT-01, EVAL-01 | UC-HT02 | Import/evaluation offline | Dataset partitions, mapping, query/labels | Không bắt buộc ngoài báo cáo QA | TC-55/57 | PR #14; PR #21 `0cc67fc` | CURRENT QA dataset; consensus pilot approved, chưa là metric tổng quát | Hiền và Đạt |
| CAR-01, CHK-01 | UC-HT03/04 | Cart, preview, checkout | Cart/Item, Checkout, Order/Item, StockMovement | Cart/checkout/result | TC-10–13/20/46/53 | Chưa có PR implementation | TARGET P0 | Hoàng; Hiền QA |
| PAY-01, ORD-01, CAN-01 | UC-HT04/07/11 | Payment/callback; Order/Shipping commands | Payment/Attempt, Order/History, Shipment, StockMovement | Payment result; order timeline; Seller order | TC-14–17/30–33/50–52 | Chưa có PR implementation | TARGET COD P0 và sandbox P1 | Hoàng; Hiền QA |
| RET-01, REV-01, RPT-01 | UC-HT05/07/08/12 | Return/refund/review/dashboard | ReturnRequest, Refund, Adjustment, Review | Return/review/dashboard | TC-19/33/39–44/53/59/60 | Quy tắc PR #12; chưa có implementation | TARGET P0/P1 theo miền | Hoàng; Hiền nghiệp vụ/QA |
| CHT-01, NOT-01 | UC-HT10/13 | Conversation/message/read; notification | Conversation, Message, ReadState, Notification | Chat/inbox/notification | TC-28/29/58 | Thiết kế PR #7; chưa có implementation | TARGET P0, email P1 | Hoàng; Hiền QA |
| ADM-01 — Accounts đọc | UC-HT13 | `GET /admin/accounts` | User, Store; đọc DB QA riêng không mutation | Danh sách/tìm kiếm/lọc/cursor | Quyền, hai profile độc lập, logout/direct route, DB digest | PR #86 merge `e409335`; QA comment #86 | **CURRENT/PASS phạm vi đọc**; khóa/mở NOT_RUN | Hiền FE/QA; Hoàng API |
| ADM-01 — Category Attributes đọc | UC-HT09 | Ba GET Admin theo Category/definition/options | Definition/Option/revision/usage | Reader list/detail/options | Inactive/filter/cursor/role/logout; DB digest | PR #77 merge `bf6f926`; PR #73 merge `be568e0` | **CURRENT/PASS phạm vi đọc**; CRUD/race/job/Search NOT_RUN | Hiền FE/QA; Hoàng API; Đạt Search boundary |
| ADM-01 — Search Health | UC-HT08 | Dự kiến `GET /admin/system-health` qua Backend | PostgreSQL readiness + snapshot AI; không mutation | Route `/admin/system-health`, trạng thái readiness | 833 FE PASS/6 live SKIP; 10/10 test module; fixture desktop/mobile PASS; live QA NOT_RUN | Backend PR #89 chưa merge tại lượt 22/10; FE local chưa push | **PREPARATION**; WAITING_BACKEND/merge #89 | Hiền FE/QA; Hoàng Backend; Đạt AI health |
| ADM-01 — Accounts khóa/mở và Attributes CRUD | UC-HT09/13 | Status hardening; Attributes CRUD theo #65 | Audit/reason/revision/CAS/job/session epoch | Editor và điều khiển ghi chưa bật | ACC-W01–06 và AT ghi/race/rollback/Search | #83/#91/#92 chưa hoàn tất; checklist local `47779bf` | **NOT_RUN/WAITING_BACKEND** | Hiền FE/QA; Hoàng API; Đạt Search boundary |
| ADM-01, RPT-01/02 — Dashboard và hậu mãi | UC-HT08/12 | Chưa có contract/API đủ dùng | Audit, Return/Refund/Adjustment, SearchLog/ClickLog | Chưa nối dữ liệu thật | TC-19/33/39–44/60 | Chưa có PR bàn giao đầy đủ | **NOT_RUN/WAITING_BACKEND** | Hoàng contract/API; Hiền FE/QA; Đạt Search analytics |

## 19 Bộ ca kiểm thử nghiệm thu

Trạng thái mặc định của toàn bộ bảng là NOT_RUN trong bản SRS này. Đây là thiết kế kiểm thử, không phải kết quả thực hiện. Giữ TC-01 đến TC-44 của v0.5, hiệu chỉnh điều kiện hoàn kho/giao thất bại và bổ sung TC-45 đến TC-60. Khi chạy phải bổ sung dữ liệu đầu vào, các bước, kết quả thực tế, commit, môi trường và đường dẫn bằng chứng. TC liên quan D01–D09 phải kiểm tra đúng chính sách đã xác nhận ngày 23–24/09/2026.

| Mã | Tình huống hoặc thao tác | Kết quả mong đợi | Liên kết |
|---|---|---|---|
| TC-01 | Đăng nhập tài khoản hoạt động bằng mật khẩu đúng | Có token, thông tin an toàn và đúng vai trò | FR-00 |
| TC-02 | Đăng nhập sai mật khẩu | Không có token; thông báo chung | FR-00 |
| TC-03 | Khóa tài khoản (`isActive=false`) rồi gọi API bằng JWT cũ | API từ chối | FR-00, FR-A01 |
| TC-04 | Seller A sửa sản phẩm Seller B | Bị từ chối; sản phẩm không đổi | FR-S02 |
| TC-05 | Tạo variant có SKU/tổ hợp trùng, giá âm hoặc tồn kho âm | Bị từ chối; không có dữ liệu variant lỗi | FR-S02 |
| TC-06 | Tạo sản phẩm khi Search Service đang tắt | Sản phẩm lưu được; đồng bộ báo lỗi/chờ; phục hồi và thử lại được | FR-S02, FR-AI08 |
| TC-07 | Gửi ảnh hỏng, giả đuôi ảnh hoặc >5 MB | Lỗi đầu vào; không chạy suy luận | FR-U02, NFR-03 |
| TC-08 | Tìm ảnh hợp lệ có sản phẩm liên quan | Kết quả có productId số nguyên, thứ hạng, không trùng | FR-U02, FR-AI05 |
| TC-09 | Admin ẩn sản phẩm còn trong FAISS | Backend không trả sản phẩm trong danh sách công khai | FR-A03 |
| TC-10 | Hai User đồng thời đặt cùng variant còn tồn=1 | Chỉ một đơn thành công; tồn variant=0 | FR-U05, NFR-05 |
| TC-11 | Gửi hai lần checkout cùng Idempotency-Key | Một nhóm đơn duy nhất; trừ tồn một lần | FR-U05 |
| TC-12 | Giá variant thay đổi sau khi thêm vào giỏ | Yêu cầu xác nhận giá mới; không âm thầm đặt theo giá cũ | FR-U04, FR-U05 |
| TC-13 | Checkout hai Seller nhưng một mặt hàng hết tồn | Không tạo đơn hoặc trừ tồn dở dang | FR-U05, NFR-05 |
| TC-14 | User hủy đơn chờ xác nhận rồi gửi lại | Đơn vẫn hủy; tồn variant chỉ hoàn một lần | UC-HT04 |
| TC-15 | Chuyển `PENDING_CONFIRMATION` thẳng sang `COMPLETED` | Bị từ chối; lịch sử không có chuyển sai | FR-S03 |
| TC-16 | `DELIVERY_FAILED` rồi xác nhận hàng đã trả về và hủy | Chỉ hoàn tồn đúng một lần sau xác nhận hàng quay về và bán lại được; không tăng stock chỉ từ nhãn CANCELLED | UC-HT04 |
| TC-17 | User xem đơn của User khác | Không lộ dữ liệu đơn | FR-U06, NFR-03 |
| TC-18 | Tạo quan hệ danh mục làm thành chu trình | Bị từ chối | FR-A02 |
| TC-19 | Đối chiếu doanh thu với đơn hoàn tất và đơn hủy | Chỉ cộng đơn hoàn tất đúng kỳ | FR-S04, FR-A05 |
| TC-20 | Chạy lại toàn bộ luồng Seller → hybrid search → COD → hoàn tất → Admin | Dữ liệu, trạng thái và thống kê nhất quán | FR-U01–FR-A05, FR-S02–FR-S04, FR-A01–FR-A05 |
| TC-21 | Import sản phẩm thiếu thuộc tính hoặc variant bắt buộc | Lưu DRAFT để bổ sung; không suy đoán giá trị từ dataset và không công khai | FR-S02 |
| TC-22 | Chuyển sản phẩm DRAFT chưa có variant hợp lệ sang ACTIVE | Bị từ chối; DRAFT vẫn được lưu để bổ sung | FR-S02, FR-A03 |
| TC-23 | Một Variant chọn hai ProductOptionValue của cùng ProductOptionGroup | Backend từ chối trong transaction; không lưu dở dang | FR-S02 |
| TC-24 | Tạo variant thứ hai có cùng tổ hợp option nhưng thứ tự gửi khác | Backend tạo cùng optionSignature; UNIQUE(product_id, option_signature) từ chối | FR-S02 |
| TC-25 | Seller tạo ProductOptionGroup trong Product khác hoặc Admin tạo CategoryAttributeDefinition trùng tên chuẩn hóa | Bị từ chối; không tạo liên kết sai Product và không sinh thuộc tính mô tả trùng | FR-A02, FR-S02 |
| TC-26 | Tìm từ khóa qua `/search/hybrid`, trong danh sách xếp hạng có sản phẩm vừa bị ẩn | Search Service thực hiện Elasticsearch + CLIP/FAISS + RRF; Backend loại sản phẩm ẩn từ PostgreSQL và giữ thứ tự các mục còn lại | FR-U01, FR-AI06–FR-AI08 |
| TC-27 | Search Service cập nhật Elasticsearch thành công nhưng FAISS lỗi | Phản hồi nêu trạng thái từng index; Backend giữ outbox chưa hoàn tất và retry cùng productId/version; version cũ không ghi đè | FR-AI04, FR-AI06, FR-AI08, NFR-07 |
| TC-28 | User/Seller đọc, join hoặc gửi vào Conversation không thuộc mình | Bị từ chối; không lộ lịch sử hoặc unread | FR-U08, FR-S06, NFR-03 |
| TC-29 | Gửi lại cùng `clientMessageId`, reconnect rồi cập nhật read cursor cũ | Chỉ có một Message; tải lại đủ lịch sử; con trỏ đọc không lùi | FR-U08, FR-S06, NFR-08 |
| TC-30 | Thanh toán VNPay/MoMo sandbox thành công với callback hợp lệ | Amount khớp Order; Payment chuyển `PAID` đúng một lần; lưu PaymentTransaction | FR-U05, NFR-09 |
| TC-31 | Callback lặp, giả, sai chữ ký hoặc sai số tiền | Callback lặp không ghi hai lần; callback không hợp lệ không đổi Payment và được ghi lỗi an toàn | FR-U05, NFR-03, NFR-09 |
| TC-32 | User hủy, giao dịch thất bại hoặc phiên sandbox hết hạn | Payment chuyển đúng `CANCELLED`, `FAILED` hoặc `EXPIRED`; Order/Payment không bị đồng nhất sai | FR-U05, NFR-09 |
| TC-33 | Payment đã `PAID` nhưng Order chưa `COMPLETED` | Dashboard chưa ghi doanh thu; chỉ ghi nhận khi Order đạt `COMPLETED` | FR-S04, FR-A05, FR-U05 |
| TC-34 | Seller tạo Store rồi Admin từ chối có lý do, Seller sửa/nộp lại | Cùng `storeId`; `PENDING → REJECTED → PENDING`; history đủ actor, thời gian, lý do | FR-S01, UC-HT06 |
| TC-35 | Seller thử sửa Store `SUSPENDED` hoặc tự chuyển `SUSPENDED → ACTIVE`; hai Admin duyệt cạnh tranh | Bị từ chối; chỉ một update hợp lệ và một history tương ứng | FR-S01, FR-A01 |
| TC-36 | Admin tắt Category có con hoạt động hoặc Product tham chiếu; khách truy vấn con có tổ tiên tắt | Không tắt Category đang bị ràng buộc; public không thấy nhánh không đủ điều kiện | FR-A02, UC-HT09 |
| TC-37 | Admin tạo/sửa/xóa Brand, Category dưới role Seller hoặc dùng slug trùng | 403 với Seller, 409/validation với slug trùng; không phá tham chiếu Product | FR-A02 |
| TC-38 | User đã mua đăng ký Store rồi được duyệt bán trên cùng tài khoản | TARGET/P0: vẫn mua được và có quyền Seller sau duyệt; chưa PASS khi migration/Auth chưa có | FR-00, FR-S01 |
| TC-39 | Hậu mãi `REFUND_ONLY` cho OrderItem đã giao, gửi request lặp | TARGET/P1: hoàn toàn dòng theo snapshot, không tăng kho, một refund và một adjustment âm; OrderStatus không đổi | FR-S04, UC-HT07 |
| TC-40 | `RETURN_AND_REFUND` trước/sau `ITEM_RECEIVED`, hàng không/có `RESTOCKABLE` | TARGET/P1: chỉ nhập kho khi đủ cả hai điều kiện; retry không nhập lần hai; doanh thu thuần trừ adjustment một lần | FR-S04, UC-HT07 |
| TC-41 | Hai ReturnRequest khác ID/key cạnh tranh cho cùng OrderItem | TARGET/P1: một request giữ quyền; request còn lại bị từ chối với ORDER_ITEM_ALREADY_FULLY_REFUNDED; tổng refund ≤ lineTotal; tối đa một refund/adjustment/restock hợp lệ | FR-U09, FR-S08, UC-HT07 |
| TC-42 | Tạo request mới khi request cũ PENDING/APPROVED, REJECTED/CANCELLED hoặc đã hoàn đủ | TARGET/P1: chặn khi giữ quyền/đã hoàn đủ; trạng thái từ chối/hủy giải phóng khi chưa refund; retry cùng thao tác không ghi trùng | FR-U09, UC-HT07 |
| TC-43 | Refund toàn dòng sau DELIVERED, trước COMPLETED, rồi hoàn tất đơn và retry | TARGET/P1: chưa có doanh thu âm; lúc COMPLETED ghi gross và áp adjustment cùng kỳ đúng một lần; net dòng hoàn đủ bằng 0 | FR-S04, UC-HT07 |
| TC-44 | Refund sau COMPLETED hoặc refund cạnh tranh với hoàn tất đơn | TARGET/P1: adjustment có hiệu lực đúng lúc gross tồn tại, không mất/nhân đôi; request lặp không cộng/trừ hoặc hoàn kho hai lần | FR-S04, UC-HT07 |
| TC-45 | Verify/reset token hết hạn hoặc đã dùng; OAuth sai issuer/audience; link email trùng; account chưa verify checkout/onboarding khi P1 bật | Từ chối đúng trường hợp; browsing/profile vẫn dùng được; không chiếm account; token/secret không vào log | ACC-02 |
| TC-46 | Chọn địa chỉ người khác, xóa địa chỉ mặc định, sửa địa chỉ sau đặt | Không dùng địa chỉ trái quyền; mặc định nhất quán; snapshot đơn không đổi | ACC-03 |
| TC-47 | Ảnh giả, header đúng nhưng dữ liệu cắt/hỏng, quá 5 MB; draft URL hết hạn/host ngoài allowlist; DB rollback; delete/cleanup cạnh tranh | Decode lỗi bị chặn; Search worker chỉ dùng signed URL hợp lệ; không public mồ côi; URL xóa không phục vụ; không xóa nhầm file hợp lệ | MED-01 |
| TC-48 | Seller sửa Product đã duyệt trong lúc Admin approve version cũ | Version cũ bị từ chối; nội dung mới không public trước duyệt; lịch sử/outbox nhất quán theo D02 | PRD-02 |
| TC-49 | SKU A giá trong khoảng nhưng hết kho, SKU B còn kho nhưng ngoài khoảng; lọc giá kèm inStock=true | Không ghép điều kiện từ hai SKU; chỉ khớp khi cùng một Variant active vừa đúng giá vừa stock>0; Backend recheck DB | SRC-01 |
| TC-50 | Payment callback thành công đến sau thời hạn giữ kho mặc định 15 phút và Order đã timeout/cancel | Không hồi sinh Order hoặc giảm kho lần nữa; ghi giao dịch ngoại lệ và xử lý/hoàn mô phỏng | PAY-01 |
| TC-51 | Hai attempt thanh toán thành công cho cùng Order, callback lặp | Chỉ một lần ghi nhận hợp lệ; giao dịch thu trùng vẫn lưu để đối chiếu; không bỏ lịch sử tiền | PAY-01 |
| TC-52 | Store SUSPENDED hoặc account chủ Store bị khóa trong lúc có Order/Return/Chat cũ | SUSPENDED chặn bán mới nhưng account ACTIVE còn xử lý giao dịch cũ; account khóa bị chặn và Admin/support tiếp nhận có audit; buyer vẫn xem lịch sử | STO-02 |
| TC-53 | Chủ Store tự mua; tạo/sửa review ngoài 30 ngày; refund sau review | Chặn self-purchase; review ngoài cửa sổ cấu hình bị từ chối; refund không tự xóa review | CAR-01, REV-01 |
| TC-54 | Thêm required definition trực tiếp vào category lá; definition chỉ ở category cha; chọn option sai Product/definition | Không kế thừa ngầm từ cha; revalidate Product bị ảnh hưởng; thiếu required thì ngừng public/thông báo/outbox; không tự bịa giá trị | CAT-01, PRD-01 |
| TC-55 | Import cùng gói hai lần; sửa tay rồi chạy import; mapping khi transaction fail | Không nhân bản/ghi đè trái phép; productId ổn định; mapping chỉ gồm dữ liệu commit; path an toàn | DAT-01 |
| TC-56 | ES thành công FAISS lỗi; retry cùng version; gửi version cũ; khóa Store khi index trễ | Không báo hoàn tất giả; retry đúng index theo contract; event cũ không hồi sinh public; DB vẫn chặn | SRC-02 |
| TC-57 | Nhãn positive chưa đủ; query ngoài corpus; self-match catalog; tập test hoàn chỉnh | Ba trường hợp đầu chỉ báo smoke/giới hạn; chỉ công bố metrics khi bộ nhãn và mẫu số hợp lệ | EVAL-01 |
| TC-58 | Gửi event notification hai lần, email fail, mở link sau khi mất quyền; đổi mật khẩu rồi thử mọi refresh session cũ | Không nhân bản thông báo; giao dịch giữ nguyên; link kiểm tra quyền; mật khẩu cũ và toàn bộ refresh session cũ không còn hợp lệ | NOT-01, ACC-04 |
| TC-59 | Hai review cùng OrderItem; Seller khác phản hồi; Admin ẩn review | Một review; trái quyền bị chặn; điểm tổng hợp chỉ tính nội dung hợp lệ đang hiển thị | REV-01 |
| TC-60 | Tổng hợp cuối ngày/tháng, refund trước/sau COMPLETED, xem report Store khác | Số tổng đối chiếu fixture; timezone đúng; adjustment một lần; trái quyền bị chặn | RPT-01/02 |

### 19.1 Bộ dữ liệu thử tối thiểu

Fixture nghiệp vụ có hai người mua, hai chủ Store và một Admin; Store ACTIVE/REJECTED/SUSPENDED; category hợp lệ/không hợp lệ; Product DRAFT/PENDING/APPROVED/HIDDEN/FROZEN; variant stock=0/1/nhiều; giá thay đổi; đơn từng trạng thái; Payment COD/sandbox; ReturnRequest cạnh tranh; review và chat thuộc nhiều người. Chỉ dùng dữ liệu demo, không dùng thông tin người thật làm điều kiện test.

Fixture Search tách rõ tập DRAFT dùng mapping/index smoke với tập public đã qua moderation để chạy Web. Mapping phải có version/hash, 86 cặp externalId và productId duy nhất nếu kiểm tra đúng gói 86 đã trao đổi; đối chiếu trực tiếp PostgreSQL hoặc artifact xuất DB có commit/run/hash rõ. Không suy ra sự khớp DB chỉ từ việc hai file có cùng số dòng.

### 19.2 Điều kiện bàn giao triển khai

Một chức năng chỉ chuyển sang đã hoàn thành khi có code tích hợp, dữ liệu demo, luồng end-to-end và bằng chứng kiểm thử tương ứng. CI xanh là điều kiện hỗ trợ; ảnh màn hình, schema hoặc self-match không đủ riêng lẻ. Khi phát hiện sai khác, ghi bug/GAP gắn FR và bằng chứng; không sửa yêu cầu để hợp thức hóa hành vi lỗi.

## 20 Nguồn đối chiếu và quản lý thay đổi

### 20.1 Nguồn nội bộ

| Nguồn | Vai trò trong bản v3 | Phạm vi áp dụng |
|---|---|---|
| SRS_DeTai18_v2.docx | Đề cương nền và mã FR/NFR | Giữ dấu vết các yêu cầu học thuật, không giữ kiến trúc hoặc phạm vi cũ đã bị quyết định mới thay thế |
| system-analysis-v0.5.md tại PR #5, commit b358beb | Bản phân tích của Hiền sau feedback gần nhất đã đối chiếu | Kế thừa FR/UC/TC, Product/Store, hậu mãi và CURRENT/TARGET; DOCX ngày 15/09 cũ hơn nguồn này |
| srs-marketplace-review-draft.md và comment PR #5 ngày 23/09/2026 của Hoàng | Bản tham khảo và quyết định D01–D10 đã xác nhận | Bổ sung ngoại lệ, tiêu chí nghiệm thu, ownership, media và vận hành; trạng thái code vẫn theo bằng chứng merge/test |
| docs/project/implementation-scope.md | Nguồn phân loại P0/P1/P2 và decision record | P0/P1 trước bảo vệ tháng 12; tài khoản mua/bán, hậu mãi và hai provider sandbox |
| docs/architecture/product-domain-design.md | Mô hình đa ngành hàng | Attribute mô tả khác option SKU; giá/kho ở variant; productId và externalId |
| docs/architecture/chat-domain-design.md | Phạm vi Chat bắt buộc | Conversation User–Store; TEXT/PRODUCT_CONTEXT, ownership, unread/read, retry |
| Huong_dan_Hien_phan_loai_chuc_nang_va_thanh_toan_sandbox.txt ngày 11/09 | Hướng dẫn Hoàng giao Hiền | Thanh toán sandbox, traceability, test; phần hậu mãi cũ được cập nhật theo scope 16/09 |
| Tin nhắn Hoàng trong ảnh người dùng cung cấp | Mục đích bàn giao | Hoàng đề nghị Hiền tham khảo, tổng hợp và chốt bản SRS để tiếp tục làm |
| Trao đổi mapping và Search commit 9b754fb | Bối cảnh kiểm chứng 86 DRAFT | Ghi rõ self-match và nhãn chưa đầy đủ; không chuyển thành số liệu chất lượng |

Các website sàn được dẫn trong bản tham khảo của Hoàng chỉ là bối cảnh tham khảo của nguồn đó. Bản v3 không dùng chúng làm chính sách áp dụng và không sao chép thời hạn hoặc tuyên bố tuân thủ pháp lý. Contract thanh toán và Search phải được đối chiếu đúng phiên bản khi triển khai.

### 20.2 Cập nhật và xác nhận tài liệu

Hoàng đã xác nhận D01–D10 ngày 23/09/2026; Đạt đã xác nhận giới hạn Search của D04/D09 ngày 24/09/2026 và không yêu cầu đổi payload PR #8. Mọi thay đổi tiếp theo phải ghi lý do, người xác nhận, ngày và các FR/UC/API/schema/TC bị ảnh hưởng. Trạng thái CURRENT chỉ cập nhật khi có code merge và bằng chứng kiểm thử.

Khi thay yêu cầu, phải ghi lý do, FR/UC/TC ảnh hưởng, dữ liệu cũ, API/schema và người xác nhận. Khi chỉ hoàn thiện implementation, cập nhật biên bản kiểm thử và bằng chứng thay vì đổi nghĩa SRS. Phiên bản 3.1 cập nhật quyết định ngày 24/09/2026; lịch sử v2/v0.5 và các file nguồn được giữ nguyên.
