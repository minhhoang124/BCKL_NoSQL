# Quy ước đóng góp

Hướng dẫn chi tiết cho việc bàn giao một task, gồm cả cách làm Git thủ công và cách nhờ AI thực hiện, nằm tại [Quy trình hoàn thành task và đẩy code lên GitHub](docs/git/team-task-delivery-guide.md).

## Quy trình làm việc

1. Cập nhật `develop` từ remote.
2. Tạo một branch mới cho một issue.
3. Commit nhỏ, có ý nghĩa theo Conventional Commits.
4. Push branch và mở pull request vào `develop`.
5. Yêu cầu tối thiểu một thành viên khác review.
6. Squash merge sau khi kiểm thử đạt yêu cầu.
7. Xóa branch đã merge.

## Tên branch

```text
feat/hoang/auth-jwt
feat/dat/image-search-api
feat/hien/admin-users
fix/hoang/order-stock-transaction
docs/hien/initial-erd
test/hien/order-workflow
```

## Commit

```text
feat(auth): implement JWT login
fix(order): prevent negative stock
docs(api): define product indexing contract
test(search): add image search test cases
chore(docker): add PostgreSQL service
```

## Điều kiện hoàn thành

- Có acceptance criteria kiểm tra được.
- Validation và phân quyền đã được xử lý.
- Test liên quan chạy thành công.
- API hoặc tài liệu được cập nhật nếu contract thay đổi.
- Không chứa secret, dataset lớn hoặc artifact sinh tự động.

## Quy tắc tích hợp

- `productId` phải đồng nhất giữa PostgreSQL, Elasticsearch và FAISS.
- Thay đổi API Backend–AI phải được Hoàng và Đạt cùng review.
- Thay đổi database phải có migration mới và được Hiền review nghiệp vụ.
- Không sửa migration đã dùng chung; tạo migration tiếp theo.
- Hợp nhất và chạy luồng end-to-end tối thiểu vào thứ Tư và Chủ Nhật.
