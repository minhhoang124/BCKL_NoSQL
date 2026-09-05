# Bảng phân công công việc khóa luận

## Thông tin chung

- Đề tài: Hệ thống quản lý sàn thương mại điện tử có tích hợp tìm kiếm sản phẩm bằng hình ảnh.
- Mã đề tài: CNTT-KLCN201.
- Thời gian kế hoạch: 04/09/2026–08/11/2026.
- Thành viên: Nguyễn Cao Dũng Đạt, Võ Minh Hoàng, Nguyễn Quốc Hiền.

## Quyết định đã chuẩn hóa

Tài liệu phân công ban đầu minh họa `productId` bằng chuỗi như `P001`. Quyết định tích hợp chính thức của nhóm là:

```json
{
  "productId": 125,
  "externalId": "P001"
}
```

- `productId`: số nguyên do PostgreSQL sinh, dùng xuyên suốt Backend, API, Elasticsearch và FAISS.
- `externalId`: mã gốc của dataset, có thể null với sản phẩm Seller tạo.
- `docs/api/ai-service-contract.md` là nguồn chuẩn cho contract hiện hành.

## Mục tiêu hợp nhất

Ba thành viên phát triển ba phần có thể chạy và kiểm thử độc lập, sau đó hợp nhất thành một website thương mại điện tử hoàn chỉnh.

Luồng bắt buộc:

```text
Seller tạo sản phẩm
→ Backend lưu PostgreSQL
→ AI Service sinh embedding và cập nhật FAISS/Elasticsearch
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

- Chọn dataset sản phẩm thời trang.
- Chuẩn hóa 100–200 sản phẩm mẫu.
- Dùng CLIP pretrained, chưa fine-tune.
- Sinh embedding ảnh và thử embedding mô tả.
- Chuẩn hóa vector, xây FAISS `IndexFlatIP`.
- Tìm Top-K bằng ảnh và thử câu truy vấn tiếng Việt.
- Thống nhất `productId` với Hoàng.

Bàn giao:

- Dataset mẫu có `productId` thống nhất.
- Script sinh embedding.
- FAISS index mẫu và mapping dữ liệu.
- Luồng ảnh truy vấn → CLIP → FAISS → Top-10 `productId`.

## Giai đoạn 2 AI Service

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

- So sánh Elasticsearch, CLIP và RRF.
- Thử early fusion và late fusion.
- Precision và Recall tại K = 5, 10, 20.
- Đo thời gian phản hồi trung bình.
- Xuất CSV, biểu đồ và ghi model/tham số/quy trình tái lập.

Bàn giao cuối: AI Service, pipeline dữ liệu, script embedding, cấu hình index, RRF, API, script đánh giá, kết quả thực nghiệm và nội dung chương kỹ thuật.

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
- Thêm, sửa, ẩn sản phẩm; upload nhiều ảnh.
- Quản lý giá, tồn kho và trạng thái embedding.
- Gọi AI Service khi sản phẩm thay đổi.
- Trang danh sách và chi tiết sản phẩm.

Bàn giao: Seller tạo/cập nhật sản phẩm → PostgreSQL → AI Service → sản phẩm xuất hiện trong tìm kiếm.

## Giai đoạn 3 Mua hàng và tìm kiếm

Thời gian: 28/09–11/10/2026.

- Giỏ hàng, tổng tiền, đơn hàng và COD.
- Theo dõi trạng thái; Seller xác nhận, giao và hoàn tất.
- Giao diện tìm từ khóa, bộ lọc, upload ảnh và kết quả RRF.

Bàn giao: User tìm → xem chi tiết → thêm giỏ → đặt COD → Seller xử lý → User xem lịch sử và trạng thái.

## Giai đoạn 4 Hoàn thiện Web

Thời gian: 12/10–25/10/2026.

- Đánh giá sản phẩm, Dashboard Seller, doanh thu ngày/tháng/quý.
- Search log, click log, responsive và xử lý lỗi.
- Docker hóa Frontend, Backend, PostgreSQL.
- Hỗ trợ Hiền tích hợp Admin.

Bàn giao cuối: React, Backend, PostgreSQL/migration/seed, API docs, User/Seller UI, giỏ hàng, đơn hàng, COD, AI Search, Dashboard và Docker Compose.

# Nguyễn Quốc Hiền

Phụ trách phân tích, Admin, dữ liệu và kiểm thử.

## Giai đoạn 1 Phân tích hệ thống

Thời gian: 04/09–13/09/2026.

- Hoàn thiện SRS, Use Case, FR và NFR.
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
- Quản lý danh mục, kiểm duyệt và ẩn sản phẩm.
- Thống kê tổng quan và trạng thái AI/FAISS/Elasticsearch.

Hoàng tạo cấu trúc/API và review; Hiền trực tiếp hoàn thành module Admin.

## Giai đoạn 4 Kiểm thử và báo cáo

Thời gian: 12/10–25/10/2026.

- Kiểm thử ba vai trò, phân quyền, giỏ hàng, đơn hàng, trạng thái và tìm kiếm.
- Ghi bug, phân loại mức độ và retest.
- Tổng hợp thực nghiệm, chụp giao diện và viết phần phân tích/thiết kế/kiểm thử.
- Chuẩn bị kịch bản demo.

Bàn giao cuối: SRS, Use Case, ERD, Sequence/Activity Diagram, Admin, dataset/ground truth, test case, bug report, demo script và chương phân tích–kiểm thử.

# Kế hoạch hợp nhất chi tiết

## 20/09 Hợp nhất thử lần 1

- React gọi Backend.
- Backend đọc PostgreSQL.
- AI nhận ảnh và trả `productId` từ CLIP/FAISS.
- Kiểm tra ID và cấu trúc API; sửa sai khác trong 21–27/09.

## 27/09 Hợp nhất sản phẩm và AI

Seller thêm sản phẩm → Backend lưu PostgreSQL → gọi AI → sinh embedding/cập nhật FAISS → tìm được sản phẩm mới. Đây là mốc kiến trúc quan trọng nhất.

## 11/10 Hợp nhất chính

Seller tạo sản phẩm; User tìm bằng chữ/ảnh, xem chi tiết, thêm giỏ và đặt COD; Seller xử lý đơn; Admin quản lý và thống kê. Sau mốc này không thiết kế lại kiến trúc.

## 18/10 Kiểm thử tích hợp

- Nghiêm trọng: đăng nhập, mất dữ liệu, sai đơn hàng, tìm kiếm không hoạt động.
- Trung bình: sai quyền, sai trạng thái, bộ lọc không chính xác.
- Nhẹ: giao diện, thông báo, căn chỉnh.

Đạt và Hoàng sửa lỗi; Hiền retest.

## 25/10 Đóng băng chức năng

Không thêm chức năng lớn, đổi kiến trúc/database/model tùy tiện. Chỉ sửa lỗi, tối ưu, hoàn thiện tài liệu và giao diện.

## 01/11 Bản nộp dự kiến

Phải có source hợp nhất, Docker Compose, migration/seed, dataset mẫu, script tạo embedding/index, AI Service/API docs, thực nghiệm, báo cáo, slide và video demo dự phòng.

## 02–08/11 Dự phòng

Chỉ sửa lỗi, chỉnh báo cáo/trích dẫn, hoàn thiện slide, luyện thuyết trình/demo và kiểm tra video dự phòng.

# Quy ước tích hợp

AI Service trả:

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
  "externalId": "P001",
  "name": "Áo hoodie nam màu đen",
  "description": "Áo nỉ có mũ phong cách thể thao",
  "category": "Hoodie",
  "brand": "Local Brand",
  "imageUrls": ["..."]
}
```

- `productId` giống nhau trong PostgreSQL, Backend, Elasticsearch và FAISS.
- Hợp nhất source ít nhất hai lần mỗi tuần; không để branch tách biệt quá lâu.
- Mỗi task có người phụ trách, deadline, kết quả kiểm tra được, reviewer và trạng thái.
- Đạt viết CLIP/embedding/FAISS/Elasticsearch/RRF/thực nghiệm.
- Hoàng viết kiến trúc Web/CSDL/xây dựng chức năng/triển khai.
- Hiền viết khảo sát/yêu cầu/Use Case/thiết kế/kiểm thử.
- Cả ba cùng viết mở đầu, kết luận, hạn chế, hướng phát triển và slide.

# Tiêu chí hoàn thành cuối cùng

- User, Seller và Admin đăng nhập, sử dụng đúng quyền.
- Seller quản lý sản phẩm và đơn hàng.
- User tìm bằng từ khóa/hình ảnh và đặt COD.
- Elasticsearch, CLIP, FAISS và RRF hoạt động.
- Đo được Precision@K, Recall@K và thời gian phản hồi.
- Admin quản lý và xem thống kê.
- Docker Compose khởi động toàn hệ thống.
- Có test case, báo cáo kiểm thử, thực nghiệm, báo cáo, slide và kịch bản demo.
