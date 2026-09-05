# Hướng dẫn dành cho AI và coding agent

Trước khi sửa code, phải đọc theo thứ tự:

1. `README.md`
2. `docs/project/work-assignment.md`
3. `CONTRIBUTING.md`
4. `docs/git/team-task-delivery-guide.md`
5. `docs/api/ai-service-contract.md` nếu task liên quan sản phẩm hoặc tìm kiếm

Quy tắc bắt buộc:

- Không commit trực tiếp vào `main` hoặc `develop`.
- Không tự merge pull request.
- Giữ nguyên thay đổi ngoài phạm vi task và công việc của thành viên khác.
- Không dùng `git reset --hard`, `git clean -fd` hoặc `git push --force`.
- Không commit `.env`, secret, dataset lớn, ảnh upload, model weight, embedding hoặc FAISS index.
- PostgreSQL là nguồn dữ liệu nghiệp vụ chính; Elasticsearch và FAISS là index phụ trợ.
- `productId` là số nguyên do PostgreSQL sinh và dùng xuyên suốt Backend, API, Elasticsearch và FAISS.
- `externalId` là mã chuỗi từ dataset như `P001`, có thể null với sản phẩm do Seller tạo.
- Thay đổi database phải tạo migration mới; không sửa migration đã được merge và dùng chung.
- Thay đổi contract Backend–AI phải cập nhật `docs/api/ai-service-contract.md` và được Hoàng, Đạt cùng review.
- Chạy kiểm tra phù hợp và báo kết quả trước khi bàn giao.

Nếu tài liệu cũ có ví dụ `productId: "P001"`, quyết định mới trong `docs/api/ai-service-contract.md` và file này được ưu tiên: dùng `productId: 125`, còn `P001` là `externalId`.

