# Quy ước review ground truth v1

Trạng thái tại ngày 24/09/2026: Hiền đã hoàn tất lượt gán nhãn vòng một; Đạt đã review độc lập và approve toàn bộ nhãn tại PR #21 trên commit `e7906f6`. Không có ca bất đồng. Các file consensus vẫn thuộc phạm vi pilot/development và không được dùng để công bố Precision/Recall trước khi có mapping `externalId -> productId`, corpus cố định và log chạy thật.

## Thang nhãn

| Nhãn | Ý nghĩa |
|---|---|
| `2` | Rất liên quan: đúng sản phẩm hoặc sản phẩm tương tự gần, tùy mục tiêu của manifest. |
| `1` | Có liên quan nhưng khác một cấu hình quan trọng, không thay thế trực tiếp. |
| `0` | Không đáp ứng mục đích hoặc khác loại/chức năng. |
| `null` | Chưa đủ bằng chứng hoặc chưa có tiêu chí để quyết định. |

Không suy nhãn từ `productType`, thứ tự dòng, FAISS row index hoặc ID prototype. Mọi nhãn và mapping đều truy vết bằng `externalId`.

## Ba tập đang review

### Text product match

- Query: [`text-queries-import-v1.jsonl`](text-queries-import-v1.jsonl), 12 query tiếng Việt.
- Nhãn vòng một: [`text-product-labels-import-v1.jsonl`](text-product-labels-import-v1.jsonl), 12 anchor mức `2`.
- Nhãn đã đồng thuận: [`text-product-labels-consensus-v1.jsonl`](text-product-labels-consensus-v1.jsonl), 12/12 anchor mức `2` và `exhaustive=false`.
- Cả 12 anchor có mặt trong `products.jsonl` của gói import v1b, nhưng `productId` thật không được commit vào repo.
- Query được biên soạn từ tên nguồn, nhãn chưa exhaustive và chỉ phù hợp development/smoke. Sản phẩm chưa được gán nhãn không mặc định là không liên quan.

### Exact product image search

- Query: [`independent-image-queries.jsonl`](independent-image-queries.jsonl), 11 ảnh query 360 độ khác hash ảnh catalog.
- Nhãn vòng một: [`exact-product-labels.jsonl`](exact-product-labels.jsonl).
- Nhãn đã đồng thuận: [`exact-product-labels-consensus-v1.jsonl`](exact-product-labels-consensus-v1.jsonl).
- Positive là cùng `externalId`; biến thể khác `externalId` là negative cho mục tiêu tìm đúng danh tính sản phẩm.
- Hai query cáp đen `abo:B07DDK15FN` và `abo:B07DDPQ1HZ` có `metricEligible=false`: ảnh không chứng minh được chiều dài 10 ft hay 6 ft.
- Cả 11 anchor đang nằm ngoài 86 sản phẩm import v1 nên chưa chạy được trên corpus v1 hiện tại.

### Similar product image search

- 24 cặp trong [`similar-product-labels.jsonl`](similar-product-labels.jsonl) là lượt gán nhãn của Hiền; bản đã đồng thuận nằm tại [`similar-product-labels-consensus-v1.jsonl`](similar-product-labels-consensus-v1.jsonl).
- 20 cặp cáp Lightning và 2 cặp giá kê màn hình khác màu được gán `2`: cùng công dụng, cùng loại và là sản phẩm tương tự gần.
- 2 cặp tay đỡ một màn hình/hai màn hình được gán `1`: cùng loại nhưng khác cấu hình sử dụng quan trọng.
- Chiều dài cáp không được suy ra từ ảnh. Thuộc tính này chỉ dùng khi có metadata đáng tin cậy và không dùng để đánh giá khả năng nhìn ảnh phân biệt chiều dài.

## Kết quả review độc lập

1. Đạt đồng ý 12/12 anchor text mức `2` và việc giữ `exhaustive=false`.
2. Đạt đồng ý 9 query exact đủ điều kiện pilot và 2 query cáp đen không đủ bằng chứng phân biệt chiều dài.
3. Đạt đồng ý 22 cặp similar mức `2` và 2 cặp tay đỡ một/hai màn hình mức `1`.
4. Không có ca `NEEDS_ADJUDICATION`; các bản consensus ghi `adjudicationStatus=AGREED` và dẫn chiếu review tại PR #21.
5. Chỉ thay `externalId` bằng `productId` sau khi kiểm tra mapping chính thức: mỗi anchor có đúng một `productId` nguyên dương và sản phẩm tồn tại trong PostgreSQL.
6. Chỉ tính chỉ số sau khi khóa corpus, phiên bản model/index, mapping và tập query. Bộ pilot không đại diện kết quả tổng quát.
