# Hướng dẫn dành cho AI và coding agent

Trước khi sửa code, phải đọc theo thứ tự:

1. `README.md`
2. `docs/project/work-assignment.md`
3. `docs/project/implementation-scope.md`
4. `docs/analysis/marketplace-business-processes.md` nếu task liên quan phân tích nghiệp vụ, SRS, ERD, test case hoặc báo cáo
5. `CONTRIBUTING.md`
6. `docs/git/team-task-delivery-guide.md`
7. `docs/api/ai-service-contract.md` nếu task liên quan sản phẩm hoặc tìm kiếm
8. `docs/architecture/product-domain-design.md` nếu task liên quan sản phẩm, database, Seller, giỏ hàng, đơn hàng hoặc dataset
9. `docs/architecture/product-implementation-plan.md` nếu task triển khai schema, migration, API, import hoặc đồng bộ tìm kiếm của miền Product
10. `docs/architecture/chat-domain-design.md` nếu task liên quan Chat, WebSocket hoặc inbox

Quy tắc bắt buộc:

- Không commit trực tiếp vào `main` hoặc `develop`.
- Không tự merge pull request.
- Giữ nguyên thay đổi ngoài phạm vi task và công việc của thành viên khác.
- Không dùng `git reset --hard`, `git clean -fd` hoặc `git push --force`.
- Không commit `.env`, secret, dataset lớn, ảnh upload, model weight, embedding hoặc FAISS index.
- Không mô tả một chức năng trong báo cáo là đã triển khai nếu chưa có luồng chạy, dữ liệu demo và bằng chứng kiểm thử theo `docs/project/implementation-scope.md`.
- PostgreSQL là nguồn dữ liệu nghiệp vụ chính; Elasticsearch và FAISS là index phụ trợ.
- `productId` là số nguyên do PostgreSQL sinh và dùng xuyên suốt Backend, API, Elasticsearch và FAISS.
- `externalId` là mã truy vết tùy chọn của dữ liệu import, có dạng `<source>:<source-id>` như `abo:B07ABC123`; prefix phụ thuộc nguồn, còn sản phẩm Seller tạo có giá trị null.
- Database sản phẩm phải đa ngành hàng; giá và tồn kho thuộc ProductVariant, giỏ hàng tham chiếu variant, đơn hàng lưu snapshot.
- Thay đổi database phải tạo migration mới; không sửa migration đã được merge và dùng chung.
- Thay đổi contract Backend–AI phải cập nhật `docs/api/ai-service-contract.md` và được Hoàng, Đạt cùng review.
- Chạy kiểm tra phù hợp và báo kết quả trước khi bàn giao.

Nếu tài liệu cũ có ví dụ `productId: "P001"`, quyết định mới trong `docs/api/ai-service-contract.md` và file này được ưu tiên: dùng `productId: 125`; khi `P001` đến từ nguồn import thì lưu dưới dạng có namespace, ví dụ `internal:P001`.

