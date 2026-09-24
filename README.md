# BCKL Thuong Mai Dien Tu

Hệ thống sàn thương mại điện tử nhiều người bán, đa ngành hàng, tích hợp tìm kiếm sản phẩm bằng từ khóa, văn bản ngữ nghĩa và hình ảnh. Mục tiêu của 12 tuần là hoàn thiện, tích hợp và kiểm thử các luồng tài khoản–Store–đăng bán–tìm kiếm–mua hàng–hậu mãi–chat–quản trị để bảo vệ khóa luận tháng 12/2026. Thiết kế tách các miền nghiệp vụ và giữ điểm mở rộng cho toàn hệ thống sau bảo vệ; khả năng mở rộng không đồng nghĩa với việc phải triển khai mọi tính năng kinh doanh thật trong đợt này.

## Thành viên và phạm vi chính

| Thành viên | Phạm vi |
|---|---|
| Nguyễn Cao Dũng Đạt | CLIP, FAISS, FastAPI, Elasticsearch, RRF và thực nghiệm |
| Võ Minh Hoàng | React, Node.js, PostgreSQL, User/Seller và tích hợp hệ thống |
| Nguyễn Quốc Hiền | Phân tích, Admin, dataset, ground truth và kiểm thử |

## Cấu trúc repository

```text
AI_CLIP/       AI service và thực nghiệm tìm kiếm
BE/            Backend Node.js/NestJS
FE/            Frontend React
database/      Migration và seed dùng chung
datasets/      Hướng dẫn dữ liệu và dữ liệu mẫu nhỏ
docs/          SRS, sơ đồ, API contract và kiểm thử
scripts/       Script hỗ trợ phát triển
uploads/       Dữ liệu upload khi chạy local, không commit
```

## Nhánh

- `main`: phiên bản ổn định, có thể demo.
- `develop`: nhánh tích hợp.
- Nhánh công việc: `feat/<ten>/<cong-viec>`, `fix/<ten>/<cong-viec>`, `docs/<ten>/<cong-viec>` hoặc `test/<ten>/<cong-viec>`.

Không commit trực tiếp vào `main` hoặc `develop`. Mọi thay đổi đi qua pull request và tối thiểu một người review.

Xem [quy trình hoàn thành task và đẩy code lên GitHub](docs/git/team-task-delivery-guide.md) để làm thủ công hoặc sử dụng prompt dành cho AI.

Mọi thành viên và AI hỗ trợ phải đọc:

- [Tổng quan kiến trúc và trạng thái hệ thống](docs/architecture/system-architecture-overview.md) để hiểu thành phần, luồng dữ liệu, phần đã merge và phần còn đang phát triển trước khi đọc code.
- [Bảng phân công và kế hoạch hợp nhất](docs/project/work-assignment.md) trước khi bắt đầu một task.
- [Phạm vi triển khai, release gates và mức độ hoàn thiện](docs/project/implementation-scope.md) để không nhầm mục tiêu P0/P1 với chức năng đã có code hoặc hướng phát triển P2. Mở bán/thanh toán production chỉ sau khi các điều kiện vận hành riêng được đáp ứng.
- [Khảo sát và áp dụng nghiệp vụ sàn thương mại điện tử](docs/analysis/marketplace-business-processes.md) để cập nhật SRS, Use Case, ERD, test case và báo cáo.
- [Thiết kế miền sản phẩm đa ngành hàng](docs/architecture/product-domain-design.md) nếu task liên quan sản phẩm, database, Seller, giỏ hàng, đơn hàng hoặc dataset.
- [Kế hoạch triển khai Store và Product](docs/architecture/product-implementation-plan.md) nếu task triển khai schema, migration, API, import hoặc đồng bộ tìm kiếm của miền Product.
- [Thiết kế Chat User-Seller](docs/architecture/chat-domain-design.md) nếu task liên quan Chat, WebSocket hoặc inbox.

## Khởi động

Các ứng dụng sẽ được bổ sung trong giai đoạn nền móng. Sao chép `.env.example` thành `.env` và không commit `.env`.

## Mốc kế hoạch nội bộ ban đầu

Các mốc sau được lập trước khi xác nhận buổi bảo vệ dự kiến **tháng 12/2026**. Ngày bảo vệ chính xác chưa được ghi trong repo; kế hoạch 12 tuần và mốc đóng băng cần được nhóm cập nhật khi chốt lịch. P0/P1 tại [phạm vi triển khai](docs/project/implementation-scope.md) là mục tiêu trước bảo vệ, không phải phần mở rộng sau này.

- 13/09/2026: hoàn thành nền móng.
- 20/09/2026: hợp nhất thử lần 1.
- 27/09/2026: hợp nhất dữ liệu sản phẩm và AI.
- 11/10/2026: hợp nhất chính.
- 18/10/2026: kiểm thử tích hợp.
- 25/10/2026: đóng băng chức năng.
- 01/11/2026: bản nộp dự kiến.
- 08/11/2026: kết thúc kế hoạch nội bộ ban đầu, tiếp tục kiểm thử/ổn định và chuẩn bị bảo vệ tháng 12 theo lịch được chốt.
