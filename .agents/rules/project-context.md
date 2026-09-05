# Bối cảnh và quy tắc project

Trước mọi task, đọc `AGENTS.md` ở thư mục gốc và các tài liệu mà file đó chỉ định. Bảng phân công chính thức nằm tại `docs/project/work-assignment.md`.

Chỉ làm trong phạm vi thành viên và task được giao. Không tự mở rộng kiến trúc, sửa module của người khác, commit lên `main` hoặc `develop`, hay tự merge pull request.

Quy ước dữ liệu chính thức: `productId` là số nguyên PostgreSQL; mã dataset dạng `P001` là `externalId`. PostgreSQL là nguồn dữ liệu chính; FAISS và Elasticsearch là index phụ trợ.

