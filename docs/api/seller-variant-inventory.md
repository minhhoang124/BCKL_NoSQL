# Seller sửa giá và tồn kho SKU

Quyết định owner ngày30/10/2026 (D13): giá/kho áp dụng ngay; nội dung sản phẩm vẫn theo quy trình duyệt. Không đổi `moderationStatus`, `sellerStatus`, danh tính SKU hoặc snapshot đơn đã đặt khi sửa giá/kho.

`PATCH /seller/products/:productId/variants/:variantId`, JWT Seller đang hoạt động. Store phải ACTIVE và thuộc actor; Product/Variant phải cùng Store. Actor/CV được đọc lại dưới khóa trong transaction. Buyer/Admin403, không đăng nhập401, sản phẩm/SKU khác quyền404. PENDING/FROZEN409.

Body chỉ gồm sáu trường:

```json
{
  "expectedProductVersion": 3,
  "expectedPrice": "10000.00",
  "expectedStock": 5,
  "price": "12000.00",
  "stock": 7,
  "reason": "Đối chiếu kho thực tế"
}
```

Giá là chuỗi VND nguyên dương, tối đa12 chữ số phần nguyên, có thể thêm `.00`; stock/expectedStock là số nguyên0..2147483647; version1..2147483646; reason sau trim1..500ký tự. Không thay đổi cả giá và kho400; unknown field/query bị từ chối. Hiện không hỗ trợ sửa SKU có giá lẻ phần đồng từ dữ liệu cũ; không âm thầm làm tròn hoặc di trú giá.

Response200 chỉ gồm `productId`, `variantId`, `version` mới, `price` chuẩn hai số thập phân và `stock`. Đây là projection xác nhận lần ghi thành công, không phải durable receipt truy vấn theo command key.

## Bất biến và đồng thời

- Serializable, khóa User→Store→Product→Variant; đối chiếu cả version, giá và tồn cũ. Không rebase kỳ vọng khi retry. Checkout hiện cũng tăng Product.version; expectedStock vẫn được đối chiếu độc lập.
- Nếu snapshot đã đổi:409 `PRODUCT_VARIANT_CHANGED`, không có mutation. Hai edit cùng snapshot chỉ một yêu cầu thắng; checkout/edit có thể xung đột và yêu cầu tải lại. Không ghi đè kho vừa bán.
- Cập nhật Variant, tăng Product.version, ghi MANUAL_ADJUSTMENT khi delta khác0 và ghi SearchOutbox cùng transaction. Movement key `SKU_EDIT:<productId>:<expectedProductVersion>:<variantId>`, delta đúng `newStock-oldStock`, balanceAfter đúng tồn mới. Price-only không tạo movement0.
- Outbox dùng public-listing policy hiện có: UPSERT nếu công khai, DELETE nếu draft/hidden; version/payload bất biến. Ghi outbox lỗi rollback cả giá, kho, version và movement. Không thay đổi contract Backend–AI.
- Khóa/statement/transaction/wait/deadline có giới hạn; retry tối đa3. Bao gồm serialization40001/deadlock40P01 được Prisma bọc trong P2010. Không trả lỗi SQL thô cho client.

## UI và triển khai

`VITE_SELLER_VARIANT_INVENTORY_ENABLED` mặc địnhfalse; chỉ bật sau khi Backend tương ứng đã có. Seller chọn SKU, xem giá/kho cũ→mới, xác nhận rồi lưu. Không tự PATCH sau lỗi,401 hoặc reload. Epoch phiên đăng nhập và singleflight chặn response cũ/bấm trùng.

Nếu mất response, giao diện yêu cầu GET mới và người dùng kiểm lại trước thao tác tiếp theo. GET chỉ là quan sát hiện tại; không chứng minh yêu cầu trước chưa hoặc đã chạy. CAS ngăn late request ghi đè một phiên bản đã thay đổi; không cam kết giao dịch mới luôn thắng yêu cầu cũ còn đang chạy. Chưa có durable command resolver cho sửa SKU.

Không cần migration mới; dùng schema40 hiện có. Kiểm SearchOutbox enqueue không đồng nghĩa đã nghiệm thu tiêu thụ event vào ES/FAISS thật. Xem [QA SKU](../testing/seller-variant-inventory-2026-10-30.md).
