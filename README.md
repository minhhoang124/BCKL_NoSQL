# BCKL Thuong Mai Dien Tu

Hệ thống thương mại điện tử đa vai trò tích hợp tìm kiếm sản phẩm bằng từ khóa, văn bản ngữ nghĩa và hình ảnh.

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

## Khởi động

Các ứng dụng sẽ được bổ sung trong giai đoạn nền móng. Sao chép `.env.example` thành `.env` và không commit `.env`.

## Mốc chính

- 13/09/2026: hoàn thành nền móng.
- 20/09/2026: hợp nhất thử lần 1.
- 27/09/2026: hợp nhất dữ liệu sản phẩm và AI.
- 11/10/2026: hợp nhất chính.
- 18/10/2026: kiểm thử tích hợp.
- 25/10/2026: đóng băng chức năng.
- 01/11/2026: bản nộp dự kiến.
- 08/11/2026: hoàn thành cuối cùng.

