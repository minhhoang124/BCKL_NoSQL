# Rà màu sắc và nguồn cho mô tả thiếu — ABO 1200

Ngày rà: 16/09/2026. Đây là **đề xuất theo `externalId`**, không thay đổi gói ABO gốc, trạng thái QA hay dữ liệu import. Quyết định Category, Brand và 146 listing `Renewed` vẫn chờ nhóm chốt riêng.

Với `abo:B00GN8WAHE` và `abo:B01FSGT9D4`, Đạt đã rà tên/metadata/ảnh và **đề xuất** `brand = null` vì không đủ bằng chứng gán Amazon/AmazonBasics. CSV QA hiện đã để trống cả `brand` lẫn `proposedBrand`, giữ hai mã ở `SỬA`/`DRAFT_ONLY`; mã thứ hai còn `CATEGORY_MAPPING_PENDING`. Không loại chỉ vì thiếu brand và không đưa vào tìm kiếm công khai khi còn thiếu điều kiện. Hoàng cần xác nhận importer chấp nhận `brandId` rỗng trước khi chốt bản sạch.

## 1. Màu sắc

Nguồn đối chiếu: cột `color` trong `metadata_reference.csv`, tên ở `products.jsonl` và ảnh catalog khi gặp xung đột. Kết quả đầy đủ 1.200 mã: [`abo-electronics-1200-color-proposals.jsonl`](abo-electronics-1200-color-proposals.jsonl).

| Nhóm | Số mã | Cách dùng |
|---|---:|---|
| Có màu đề xuất từ metadata/tên | 635 | Chỉ là ứng viên; 78 mã chỉ dựa vào tên cần đối chiếu ảnh trước import. |
| Không đủ bằng chứng màu | 519 | Giữ trống, không đoán. |
| Cần rà thủ công | 46 | 9 xung đột tên–metadata, 6 giá trị nguồn không phải màu chuẩn, 21 nhãn đa màu chưa rõ, 10 tên có nhiều màu. |

Ảnh đã được xem cho 9 xung đột và 6 giá trị nguồn bất thường. Các trường hợp cần nhóm quyết định quy tắc lưu màu của **sản phẩm chính** hay **bộ kit/phụ kiện đi kèm**:

| `externalId` | Quan sát | Đề xuất xử lý |
|---|---|---|
| `abo:B01F2O1E9E` | Ảnh tai nghe màu hồng; metadata `Pink`, tên ghi `Black`. | Giữ ứng viên màu hồng, sửa tên sau khi xác minh đúng biến thể. |
| `abo:B078H97C75` | Loa xanh, vỏ bảo vệ cam; metadata `Orange`. | Nếu thuộc tính màu nói về loa, dùng `Blue`; lưu màu vỏ riêng nếu cần. |
| `abo:B078H6565T` | Loa cam, vỏ đen. | Nếu thuộc tính màu nói về loa, dùng `Bright Orange`. |
| `abo:B003Y74AXE` | Ốp trong suốt, viền đen. | Cần quy ước đa màu/vật liệu, không ép về `Black` hay `Transparent` đơn lẻ. |
| `abo:B079MS1BTS`, `abo:B079MXD7GW` | Tai nghe trẻ em có hai màu trên cùng sản phẩm. | Có thể dùng `Blue/Green`, `Pink/Orange` sau khi chốt option đa màu. |
| `abo:B07H3RCDS5`, `abo:B07H3TSCKY` | Ốp hồng vàng; chữ `Black` trong tên mô tả lớp chống sốc. | Ưu tiên `Rose Gold` cho màu ốp, không lấy mọi từ màu trong tên làm variant. |
| `abo:B083PB7RMM` | Ốp xanh, phần cửa sổ trong suốt. | `Blue` là màu chính; `Transparent` là tính chất một phần. |

Không tạo cột `color` cố định ở Product. Khi import, ánh xạ thuộc tính/option màu theo Category và ProductVariant đúng với thiết kế miền Product.

## 2. Nguồn mô tả cho 173 mã thiếu

Đã đối chiếu **cùng ASIN** với các shard listing chính thức của [Amazon Berkeley Objects](https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/index.html), ghi URL shard, tiêu đề listing, độ tương đồng tên, ngôn ngữ và trích đoạn bằng chứng trong [`abo-electronics-173-description-sources.jsonl`](abo-electronics-173-description-sources.jsonl).

| Kết quả | Số mã | Bước tiếp |
|---|---:|---|
| Có mô tả/bullet ứng viên từ listing ABO khác, chưa xác nhận biến thể | 44 | Dịch/biên tập và kiểm tra thông số trên đúng ảnh, mẫu mã trước khi điền. |
| Không có thêm mô tả/bullet trong metadata ABO | 123 | Tìm trang/tài liệu hãng theo model chính xác; nếu không xác minh được thì giữ trống và để DRAFT. |
| Đã bị loại trong QA | 6 | Không cần bổ sung mô tả; 2 mã có text trong ABO nhưng vẫn thuộc nhóm loại. |

Các ví dụ phải kiểm tra kỹ trước khi sử dụng: `abo:B01N1OX4D3` có tiêu đề 500 GB nhưng bullet listing đề cập 4 TB; `abo:B07PZ8GHXY` có tiêu đề 5 W nhưng bullet đề cập 10 W. Nhóm Toshiba `abo:B01IIDOWDQ`, `abo:B01IIDP4UG` cũng cần đối chiếu dung lượng/biến thể. Vì vậy **chưa điền `proposedDescription` cho cả 173 mã**; có nguồn ứng viên không đồng nghĩa nội dung đúng. Không suy diễn thông số từ sản phẩm tương tự hoặc bản dịch tự động.

Nguồn ABO công bố [CC BY 4.0 và yêu cầu ghi công Amazon.com](https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/index.html). Nếu biên tập nội dung cho bản demo/báo cáo, ghi nguồn và kiểm tra điều khoản áp dụng trước khi công bố.

## 3. Kiểm chứng và tái lập

- `products.jsonl` gốc: SHA-256 `4c9ec953160e3ceb6aad72acd8a35353fd9fad7d70cf2c326e6f8c919b1a185d`.
- `metadata_reference.csv` gốc: SHA-256 `8dfcaeb3ea2ccbc835b77fd81742d1c99ad4afcc67bba7d91d5faaebcf8f7367`.
- Script trong `scripts/dataset/` tạo manifest từ bản gốc và metadata chính thức; shard tải về cache **ngoài repo**. Không commit ảnh, shard, ZIP hoặc bản ABO gốc.
- Mọi đề xuất chờ Hiền–Đạt rà trước khi trở thành clean dataset. Bản ghi chưa đủ mô tả/Category/Brand vẫn ở DRAFT theo thiết kế import.
