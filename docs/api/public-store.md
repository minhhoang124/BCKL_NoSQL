# Store công khai

Ngày 28/10/2026. Triển khai trên nhánh riêng từ `532d79d`; chưa tính tích hợp khi chưa merge.

## Giao diện và API

- Web `/stores/:storeId`, mở từ tên Store trong chi tiết Product. Khách không cần đăng nhập; đọc hồ sơ và sản phẩm công khai, tải thêm bằng nút riêng. Không tự tạo hội thoại hoặc gửi tin khi tải trang.
- `GET /stores/:storeId?limit=24&afterId=123`: `storeId` và `afterId` là số nguyên dương đến 2147483647, không số 0 đầu; `limit` từ 1 đến 48, mặc định 24. Web lấy 24. Từ chối query lạ, trùng, dạng mảng và body GET/HEAD.
- Response `{store:{id,name,description},items:[...publicProduct],nextCursor:number|null}`. Không trả tài khoản chủ Shop, email, điện thoại, địa chỉ lấy hàng, hồ sơ đăng ký, lý do kiểm duyệt hoặc audit.
- Store phải ACTIVE, chủ tài khoản đang hoạt động. Store không tồn tại hoặc không công khai cùng trả 404. Store chưa có Product công khai vẫn có hồ sơ và danh sách rỗng.
- Product dùng nguyên evaluator/projection của `/products`: trạng thái duyệt, danh mục và tổ tiên, Brand, thuộc tính bắt buộc, ảnh, biến thể, giá, kiện hàng. Product hết hàng có thể hiển thị với nhãn chính xác.
- Một transaction PostgreSQL `RepeatableRead`, `READ ONLY`, timeout truy vấn 5 giây. Không tạo Order, điều chỉnh kho hoặc Search job. `Cache-Control: no-store` áp dụng cả lỗi.
- Phân trang theo ID tăng, tối đa 200 ứng viên mỗi lần. Trang rỗng có thể còn cursor; client vẫn cho tải tiếp. Mỗi lần đọc là snapshot riêng, không cam kết tổng số hoặc ảnh chụp nhất quán xuyên nhiều lần đọc.
- Web không gửi cookie/token, không refresh Auth, không tự retry. Chặn cùng nhịp tải thêm, hủy/loại response cũ khi đổi route, xóa dữ liệu hiển thị nếu lần đọc tiếp thất bại; người dùng chọn tải lại.

## Giới hạn

Không migration mới, không sửa Backend–AI/index contract hoặc shared Product policy. Chưa bộ lọc riêng trong Store, đánh giá Store hoặc số liệu marketing. API dùng giới hạn truy vấn và scan; chưa tuyên bố chịu tải production. Chat giữ cờ triển khai hiện hành.
