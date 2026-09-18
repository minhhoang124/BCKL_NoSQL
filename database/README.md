# Database

Chứa migration và seed dùng chung. Không sửa migration đã được merge và sử dụng; tạo migration mới cho mỗi thay đổi schema.

Chạy migration và seed từ thư mục gốc:

```bash
pnpm prisma:migrate
pnpm prisma:seed
```

Seed chỉ tạo dữ liệu demo nhỏ, có thể chạy lặp lại và không chứa dữ liệu ABO, ảnh, secret hoặc artifact tìm kiếm. Hai tài khoản local dùng mật khẩu `Demo123!`:

- `seller.demo@example.com`
- `admin.demo@example.com`

Sản phẩm seed dùng `externalId = internal:demo-electronics-001`, luôn ở trạng thái nháp và chỉ phục vụ kiểm tra schema/API local.
