# Bảng phân công công việc khóa luận

## Thông tin chung

- Đề tài: Hệ thống quản lý sàn thương mại điện tử có tích hợp tìm kiếm sản phẩm bằng hình ảnh.
- Mã đề tài: CNTT-KLCN201.
- Thời gian kế hoạch nội bộ ban đầu: 04/09/2026–08/11/2026. Buổi bảo vệ khóa luận dự kiến **tháng 12/2026**; ngày chính xác chưa được ghi trong repo. Các mốc tháng 10–11 là checkpoint/đóng băng dự kiến, không phải lý do chuyển P0/P1 sang hướng phát triển.
- Thành viên: Nguyễn Cao Dũng Đạt, Võ Minh Hoàng, Nguyễn Quốc Hiền.

## Quyết định đã chuẩn hóa

Quyết định tích hợp chính thức của nhóm là:

```json
{
  "productId": 125,
  "externalId": "abo:B07ABC123"
}
```

- `productId`: số nguyên do PostgreSQL sinh, dùng xuyên suốt Backend, API, Elasticsearch và FAISS.
- `externalId`: mã truy vết tùy chọn dạng `<source>:<source-id>` cho dữ liệu import; prefix phụ thuộc nguồn, còn sản phẩm Seller tạo có giá trị null.
- `docs/api/ai-service-contract.md` là nguồn chuẩn cho contract hiện hành.
- `docs/project/implementation-scope.md` là nguồn chuẩn cho phạm vi phải chạy trước bảo vệ tháng 12 (P0/P1), phạm vi sau bảo vệ để thương mại hóa (P2) và release gates. Hoàng đã xác nhận một tài khoản có thể mua và, sau onboarding Store, bán trong bản bảo vệ; Hiền review nghiệp vụ/migration/Auth, Đạt review khi ảnh hưởng Product/Search. Không coi mục tiêu mới là chức năng đã code.

## Mục tiêu hợp nhất

### Điều chỉnh phân công ngày 03–04/10/2026

**CONFIRMED_BY_HIEN — cập nhật ngày 05/10/2026:** Hoàng giao Hiền trực tiếp CODE hai màn Buyer UI Address/Cart ngày 04/10 để chia tải ngoài Admin, không chỉ review mockup. Hiền đã [xác nhận nhận task ngày 04/10 trên PR #29](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-5978048696). Không chuyển toàn bộ Frontend sang Hiền. Hoàng giữ Backend Address/Cart, Checkout/COD/Order, Buyer UI Checkout/Order, Seller UI, Chat và tích hợp. Đạt giữ AI/Search/thực nghiệm. Hiền giữ phân tích/SRS/QA và Admin. Chưa có cam kết lịch cụ thể hoặc bằng chứng hai màn UI hoàn thành.

Hiền đã xác nhận tách Address và Cart thành các PR riêng, không gộp Admin #28; có thể chuẩn bị layout/state trước, chỉ nối API thật sau khi Backend tương ứng (#30/#31) merge vào develop. Thứ tự/lịch giữa Admin và hai màn mới còn cần cập nhật, không coi lời nhận task hoặc approval tài liệu là bằng chứng đã code/cam kết thời hạn. Nếu thiếu thời gian, báo lại để nhóm điều chỉnh, không âm thầm bỏ phần Admin hoặc nghiệm thu. Contract #27 đã duyệt/merge; cập nhật 05/10: Address #30 đã merge tại efd86a3, Hiền có thể bắt đầu nối Address API; Cart Backend #31 đã merge tại 6663fab, Hiền có thể nối cả Address và Cart API trên develop. UI mock phải có nhãn và không được coi là bằng chứng tích hợp, không tự đổi Backend contract.

Phạm vi file, dependencies, acceptance và lịch checkpoint đề xuất ở [Phân công tăng tốc Address/Cart và tích hợp](../project/address-cart-delivery-assignment-2026-10-03.md). Thời hạn trong tài liệu là checkpoint đề xuất, không phải cam kết thay các thành viên. Checklist cho bước Backend tiếp theo ở [Checkout/COD readiness](../architecture/checkout-cod-backend-readiness.md).

Ba thành viên phát triển ba phần có thể chạy và kiểm thử độc lập, sau đó hợp nhất thành một website thương mại điện tử hoàn chỉnh.

Luồng bắt buộc:

```text
Seller tạo sản phẩm
→ Backend lưu PostgreSQL
→ FastAPI Search Service cập nhật Elasticsearch và CLIP/FAISS
→ User tìm sản phẩm bằng từ khóa hoặc hình ảnh
→ User xem chi tiết, thêm giỏ hàng và đặt COD
→ Seller xử lý đơn hàng
→ Admin quản lý và xem thống kê
```

## Mốc hợp nhất

| Ngày | Mốc | Kết quả |
|---|---|---|
| 13/09/2026 | Hoàn thành giai đoạn nền móng | Các module có prototype chạy độc lập |
| 20/09/2026 | Hợp nhất thử lần 1 | React–Backend–PostgreSQL và AI trả productId |
| 27/09/2026 | Hợp nhất sản phẩm và AI | Sản phẩm Seller tạo xuất hiện trong tìm kiếm |
| 11/10/2026 | Hợp nhất chính | Luồng User–Seller–Admin và tìm kiếm hoạt động |
| 18/10/2026 | Kiểm thử tích hợp | Bug được ghi nhận, phân loại và giao sửa |
| 25/10/2026 | Đóng băng chức năng | Có bản đủ chức năng để bảo vệ |
| 01/11/2026 | Bản nộp dự kiến | Source, Docker, dữ liệu mẫu, báo cáo và slide |
| 02–08/11/2026 | Dự phòng | Sửa lỗi, hoàn thiện tài liệu và luyện bảo vệ |

# Nguyễn Cao Dũng Đạt

Phụ trách AI và hệ thống tìm kiếm.

## Giai đoạn 1 Prototype CLIP và FAISS

Thời gian: 04/09–13/09/2026.

Công việc:

- Dùng ABO Electronics làm dataset chính; prototype thời trang cũ chỉ giữ làm bằng chứng thử kỹ thuật, không dùng làm dữ liệu chính hoặc kết quả thực nghiệm cuối.
- Chuẩn hóa corpus prototype 1.200 sản phẩm điện tử.
- Dùng CLIP pretrained, chưa fine-tune.
- Sinh embedding ảnh và thử embedding mô tả.
- Chuẩn hóa vector, xây FAISS `IndexFlatIP`.
- Tìm Top-K bằng ảnh và thử câu truy vấn tiếng Việt.
- Thống nhất `productId` với Hoàng.

Bàn giao:

- Dataset JSONL có `externalId` theo namespace và mapping sang `productId` chính thức sau khi Backend import.
- Script sinh embedding.
- FAISS index mẫu và mapping dữ liệu.
- Luồng ảnh truy vấn → CLIP → FAISS → Top-10 `productId`.

## Giai đoạn 2 FastAPI Search Service

Thời gian: 14/09–27/09/2026.

Công việc:

- Đóng gói bằng FastAPI.
- API tìm kiếm ảnh và văn bản ngữ nghĩa.
- API thêm, cập nhật, xóa sản phẩm trong index.
- Ghi thời gian phản hồi và tài liệu request/response.

API dự kiến:

```text
GET    /health
POST   /search/image
POST   /search/text
POST   /search/hybrid
POST   /index/products
POST   /index/product
DELETE /index/product/{productId}
```

Bàn giao:

- FastAPI và Swagger chạy độc lập.
- Tìm kiếm trên ít nhất 1.000 sản phẩm.
- Response có `productId`, `score`, `rank`, `responseTimeMs`.

## Giai đoạn 3 Elasticsearch và RRF

Thời gian: 28/09–11/10/2026.

- Lập chỉ mục tên, mô tả, category và thương hiệu.
- Keyword search và bộ lọc category, giá, thương hiệu.
- Cài đặt RRF, hợp nhất Elasticsearch với CLIP/FAISS.
- Cung cấp API tìm kiếm chung cho Backend.

Bàn giao: keyword search, semantic text search, image search và danh sách RRF thống nhất để Hoàng tích hợp.

## Giai đoạn 4 Thực nghiệm

Thời gian: 12/10–25/10/2026.

Cập nhật ngày 23/10: định lượng chốt trên 7 truy vấn phát triển đã đủ nhãn cho
86 sản phẩm (602 cặp), không cần đủ 12 truy vấn mới tính chỉ số. Giữ retrieval
và Precision/Recall@5/10/20; 5 truy vấn thiếu nhãn giữ nguyên ngoài phép tính,
không chuyển ô trống thành 0. Nhãn có AI hỗ trợ, không gọi hai lượt chấm độc
lập; kiểm thử chức năng tìm ảnh tách riêng. Xem
[quyết định phạm vi](../testing/electronics/evaluation-scope-7q-2026-10-23.md).

- So sánh Elasticsearch, CLIP và RRF.
- Thử early fusion và late fusion.
- Precision và Recall tại K = 5, 10, 20.
- Đo thời gian phản hồi trung bình.
- Xuất CSV, biểu đồ và ghi model/tham số/quy trình tái lập.

Bàn giao cuối: FastAPI Search Service, pipeline dữ liệu, script embedding, cấu hình index, RRF, API, script đánh giá, kết quả thực nghiệm và nội dung chương kỹ thuật.

# Võ Minh Hoàng

Phụ trách Web thương mại điện tử.

## Giai đoạn 1 Nền móng hệ thống

Thời gian: 04/09–13/09/2026.

- Khởi tạo React Frontend và Node.js Backend.
- Kết nối PostgreSQL, cấu trúc source, migration và seed.
- Đăng ký, đăng nhập, JWT và vai trò User/Seller/Admin.
- API sản phẩm cơ bản.

Bàn giao: React gọi Backend, Backend kết nối PostgreSQL, đăng ký/đăng nhập, phân quyền và danh sách sản phẩm mẫu hoạt động.

## Giai đoạn 2 Seller và sản phẩm

Thời gian: 14/09–27/09/2026.

- Quản lý cửa hàng và cây danh mục cha–con.
- Tách đăng ký tài khoản khỏi Seller onboarding: hồ sơ Store, liên hệ, địa chỉ lấy/hoàn hàng, trạng thái chờ Admin duyệt. Trang Store công khai chỉ hiện sản phẩm đủ điều kiện.
- Lên kế hoạch migration/Auth để một tài khoản mua hàng có thể nộp yêu cầu mở Store và được cấp quyền Seller sau duyệt, vẫn giữ dữ liệu tài khoản cũ; không tự nâng quyền theo email trùng.
- Thêm, sửa, ẩn sản phẩm; upload nhiều ảnh.
- Quản lý giá, tồn kho và trạng thái embedding.
- Phát outbox/job tới Search Service khi sản phẩm công khai thay đổi.
- Trang danh sách và chi tiết sản phẩm.

Bàn giao: Seller tạo/cập nhật sản phẩm → PostgreSQL → Search Service → sản phẩm xuất hiện trong tìm kiếm.

## Giai đoạn 3 Mua hàng và tìm kiếm

Thời gian: 28/09–11/10/2026.

- Giỏ hàng, tổng tiền, đơn hàng và COD.
- Hồ sơ/địa chỉ User và snapshot địa chỉ Order; thông báo trong ứng dụng cho các thay đổi đơn, duyệt và hủy quan trọng.
- Theo dõi trạng thái; Seller xác nhận, giao và hoàn tất.
- Chat trực tiếp User-Seller theo thời gian thực, có lịch sử và trạng thái đã đọc.
- Giao diện tìm từ khóa, bộ lọc, upload ảnh và kết quả RRF.

Bàn giao: User tìm → xem chi tiết/chat với Seller → thêm giỏ → đặt COD → Seller xử lý → User xem lịch sử và trạng thái.

## Giai đoạn 4 Hoàn thiện Web

Thời gian: 12/10–25/10/2026.

- Đánh giá sản phẩm, Dashboard Seller, doanh thu ngày/tháng/quý.
- Theo phạm vi P1 mới: email verify/reset, một OAuth provider, phone OTP sandbox, VNPay/MoMo sandbox và ReturnRequest/hoàn tiền mô phỏng cơ bản. Tách issue/PR theo dependency; không đưa tất cả vào cùng PR Product hoặc Auth.
- Search log, click log, responsive và xử lý lỗi.
- Docker hóa Frontend, Backend, PostgreSQL.
- Hỗ trợ Hiền tích hợp Admin.

Bàn giao cuối: React, Backend, PostgreSQL/migration/seed, API docs, User/Seller UI, giỏ hàng, đơn hàng, COD, AI Search, Dashboard và Docker Compose.

# Nguyễn Quốc Hiền

Phụ trách phân tích, Admin, dữ liệu và kiểm thử.

## Giai đoạn 1 Phân tích hệ thống

Thời gian: 04/09–13/09/2026.

- Hoàn thiện SRS, Use Case, FR và NFR.
- Đối chiếu luồng hồ sơ/địa chỉ, Seller onboarding, thông báo, identity liên kết và hậu mãi cơ bản khi bản phạm vi mở rộng được review. Ghi riêng `CURRENT` và `TARGET` để báo cáo không nhận nhầm chức năng chưa code.
- Cùng Hoàng thiết kế ERD.
- Đặc tả luồng quan trọng và trạng thái đơn hàng.
- Lập danh sách API.

Bàn giao: SRS, Use Case tổng quát, đặc tả đăng nhập/sản phẩm/tìm kiếm/giỏ hàng/đặt hàng, ERD và danh sách API.

## Giai đoạn 2 Dataset và kiểm thử

Thời gian: 14/09–27/09/2026.

- Hỗ trợ làm sạch dataset; phát hiện ảnh hỏng, trùng và thiếu.
- Chuẩn hóa category, màu, thương hiệu và mô tả.
- Chuẩn bị query ảnh/văn bản và ground truth.
- Viết test case Web.

Bàn giao: dataset đã kiểm tra, danh sách dữ liệu loại, bộ query, ground truth và test case nghiệp vụ.

## Giai đoạn 3 Module Admin

Thời gian: 28/09–11/10/2026.

- Danh sách User/Seller, khóa/mở tài khoản.
- Admin xét duyệt/từ chối/tạm khóa Store và xử lý yêu cầu hậu mãi cơ bản khi API/ERD tương ứng được chốt với Hoàng.
- Quản lý danh mục, kiểm duyệt và ẩn sản phẩm.
- Thống kê tổng quan và trạng thái Search Service/FAISS/Elasticsearch.

Hoàng tạo cấu trúc/API và review; Hiền trực tiếp hoàn thành module Admin.

## Giai đoạn 4 Kiểm thử và báo cáo

Thời gian: 12/10–25/10/2026.

- Kiểm thử ba vai trò, phân quyền, giỏ hàng, đơn hàng, Chat, trạng thái và tìm kiếm.
- Kiểm thử release gates ở `docs/project/implementation-scope.md`: xác minh/liên kết tài khoản, onboarding Store, snapshot địa chỉ, thông báo và ReturnRequest; kiểm tra seed Admin không nâng quyền User trùng email.
- Ghi bug, phân loại mức độ và retest.
- Tổng hợp thực nghiệm, chụp giao diện và viết phần phân tích/thiết kế/kiểm thử.
- Chuẩn bị kịch bản demo.

Bàn giao cuối: SRS, Use Case, ERD, Sequence/Activity Diagram, Admin, dataset/ground truth, test case, bug report, demo script và chương phân tích–kiểm thử.

# Kế hoạch hợp nhất chi tiết

## 20/09 Hợp nhất thử lần 1

- React gọi Backend.
- Backend đọc PostgreSQL.
- Search Service nhận ảnh và trả `productId` từ CLIP/FAISS.
- Kiểm tra ID và cấu trúc API; sửa sai khác trong 21–27/09.

## 27/09 Hợp nhất sản phẩm và AI

Seller thêm sản phẩm → Backend lưu PostgreSQL → gọi AI → sinh embedding/cập nhật FAISS → tìm được sản phẩm mới. Đây là mốc kiến trúc quan trọng nhất.

## 11/10 Hợp nhất chính

Seller tạo sản phẩm; User tìm bằng chữ/ảnh, xem chi tiết, chat với Seller, thêm giỏ và đặt COD; Seller xử lý đơn; Admin quản lý và thống kê. Sau mốc này không thiết kế lại kiến trúc.

## 18/10 Kiểm thử tích hợp

- Nghiêm trọng: đăng nhập, mất dữ liệu, sai đơn hàng, tìm kiếm không hoạt động.
- Trung bình: sai quyền, sai trạng thái, bộ lọc không chính xác.
- Nhẹ: giao diện, thông báo, căn chỉnh.

Đạt và Hoàng sửa lỗi; Hiền retest.

## 25/10 Đóng băng chức năng

Không thêm chức năng lớn, đổi kiến trúc/database/model tùy tiện. Chỉ sửa lỗi, tối ưu, hoàn thiện tài liệu và giao diện.

## 01/11 Bản nộp dự kiến

Phải có source hợp nhất, Docker Compose, migration/seed, dataset mẫu, script tạo embedding/index, Search Service/API docs, thực nghiệm, báo cáo, slide và video demo dự phòng.

## 02–08/11 Dự phòng

Chỉ sửa lỗi, chỉnh báo cáo/trích dẫn, hoàn thiện slide, luyện thuyết trình/demo và kiểm tra video dự phòng.

# Quy ước tích hợp

FastAPI Search Service trả:

```json
{
  "items": [
    { "productId": 125, "rank": 1, "score": 0.91 }
  ],
  "responseTimeMs": 132
}
```

Backend gửi:

```json
{
  "productId": 125,
  "version": 3,
  "externalId": "abo:B07ABC123",
  "name": "Wireless Bluetooth Headphones",
  "description": "Over-ear wireless headphones",
  "category": "Headphones",
  "brand": "Sony",
  "imageUrls": ["http://backend:3000/uploads/products/125/1.jpg"]
}
```

- `productId` giống nhau trong PostgreSQL, Backend, Elasticsearch và FAISS.
- FastAPI Search Service quản lý Elasticsearch, CLIP/FAISS và RRF; NestJS gọi `POST /search/hybrid`, sau đó hydrate/kiểm tra dữ liệu hiện hành từ PostgreSQL và giữ thứ tự kết quả hợp lệ.
- Hợp nhất source ít nhất hai lần mỗi tuần; không để branch tách biệt quá lâu.
- Mỗi task có người phụ trách, deadline, kết quả kiểm tra được, reviewer và trạng thái.
- Đạt viết CLIP/embedding/FAISS/Elasticsearch/RRF/thực nghiệm.
- Hoàng viết kiến trúc Web/CSDL/xây dựng chức năng/triển khai.
- Hiền viết khảo sát/yêu cầu/Use Case/thiết kế/kiểm thử.
- Cả ba cùng viết mở đầu, kết luận, hạn chế, hướng phát triển và slide.

# Tiêu chí hoàn thành cuối cùng

- User, Seller và Admin đăng nhập, sử dụng đúng quyền.
- User quản lý hồ sơ/địa chỉ; Seller qua onboarding Store và Admin duyệt trước khi mở bán. Xác thực mở rộng P1 chỉ tính đạt khi provider/OTP/reset đã được kiểm thử trên bản tích hợp.
- Seller quản lý sản phẩm và đơn hàng.
- User tìm bằng từ khóa/hình ảnh và đặt COD.
- Có thanh toán sandbox P1, thông báo trong ứng dụng và hậu mãi cơ bản với quyết định/hoàn tiền mô phỏng; không mô tả là thanh toán hoặc hoàn tiền production.
- User và Seller chat trực tiếp, nhận tin gần thời gian thực và xem lại lịch sử.
- Elasticsearch, CLIP, FAISS và RRF hoạt động.
- Đo được Precision@K, Recall@K và thời gian phản hồi.
- Admin quản lý và xem thống kê.
- Docker Compose khởi động toàn hệ thống.
- Có test case, báo cáo kiểm thử, thực nghiệm, báo cáo, slide và kịch bản demo.
