# Bộ query và ground truth điện tử

Ngày chuẩn bị ban đầu: 15/09/2026. Trạng thái review gần nhất: 24/09/2026. Bộ cũ có 20 query ảnh catalog và 20 query tiếng Việt, bám 20 sản phẩm GIỮ trong báo cáo QA. Manifest nằm tại `docs/testing/electronics/queries.jsonl`; nhãn đề xuất tại `ground-truth-proposed.jsonl`. Ảnh gốc được tham chiếu bằng đường dẫn tương đối và SHA-256 trong gói ABO, không commit ảnh.

## Cách dùng và giới hạn

- Đây là bộ development/smoke: ảnh query trùng ảnh catalog nên chỉ kiểm tra pipeline/mapping. Không dùng kết quả này để kết luận khả năng tìm ảnh thực tế hoặc đưa vào kết quả thực nghiệm cuối.
- Text query được viết theo thông tin có trong tên nguồn. Mỗi query có một anchor phù hợp; các sản phẩm khác chưa được đánh nhãn không mặc định là không liên quan.
- Hiền đã gán nhãn vòng một và Đạt đã review độc lập tại PR #21. Không có nhãn bất đồng; các bản consensus và giới hạn sử dụng được ghi tại [`electronics/ground-truth-review-v1.md`](electronics/ground-truth-review-v1.md).
- Nhãn 2: đáp ứng đúng sản phẩm/thông số yêu cầu; 1: cùng loại nhưng thiếu/sai một thuộc tính yêu cầu; 0: không đáp ứng. Precision/Recall nhị phân dùng relevance=2 sau khi chốt quy tắc.
- Chưa tính Recall@K từ danh sách anchor không đầy đủ. Bản đánh giá cuối cần pool kết quả ES/CLIP/RRF cùng sản phẩm đối chứng, rà các sản phẩm phù hợp trong corpus cố định và ghi phạm vi đánh nhãn. Unjudged phải được giữ riêng.
- Bản cuối cần ảnh query độc lập với catalog, có nguồn/quyền sử dụng rõ; chia development/test theo nhóm sản phẩm trùng/biến thể để tránh rò rỉ, khóa test trước tối ưu.
- Bốn nhóm hiện có: audio, camera, computer, mobile_accessory. Bổ sung các nhóm đang chờ taxonomy sau khi QA được chốt; không giả định bộ này đại diện đủ bảy nhóm.

## Ảnh query độc lập đợt thử 16/09

[`electronics/independent-image-queries.jsonl`](electronics/independent-image-queries.jsonl) chứa 11 ảnh 360° của 11 sản phẩm `GIỮ` có `spinId` trong metadata ABO. Đây là góc chụp khác với ảnh catalog: đã mở được cả 11 ảnh, xem đối chiếu từng cặp ảnh và xác nhận SHA-256 của ảnh query khác ảnh catalog. Ảnh được lưu ở thư mục staging **ngoài repo**; manifest có URL ảnh, hash, `spinId`, `externalId` và ghi công [Amazon Berkeley Objects / CC BY 4.0](https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/index.html).

11 ảnh là **pilot** cho pipeline ảnh độc lập, chưa đủ độ đa dạng và chưa là bộ test cuối. Có nhiều biến thể cáp/giá màn hình gần nhau; góc 360° có thể không cho thấy chiều dài cáp hay mọi linh kiện trong bộ. Đạt đã xem trực tiếp 11 cặp ảnh và review 24 ứng viên gần giống; nhãn consensus đã được tạo nhưng chưa công bố chỉ số tổng quát từ pilot.

Theo feedback của Đạt, [`electronics/hard-negative-candidates.jsonl`](electronics/hard-negative-candidates.jsonl) giữ danh sách nguồn 24 cặp query–ứng viên gần giống cho 9 query: cáp Lightning khác màu/độ dài, giá màn hình đen/bạc và tay đỡ một/hai màn hình. Hai mục tiêu đánh giá dùng **hai manifest riêng**:

- [`electronics/exact-product-labels-consensus-v1.jsonl`](electronics/exact-product-labels-consensus-v1.jsonl): positive duy nhất là cùng `externalId` với ảnh query; `externalId` khác màu hoặc cấu hình là negative theo danh tính sản phẩm. Hai query cáp đen `abo:B07DDK15FN` (10 ft) và `abo:B07DDPQ1HZ` (6 ft) có `metricEligible=false`: ảnh không chứng minh được độ dài, nên không dùng chúng để kiểm tra AI phân biệt 6 ft/10 ft. Còn 9 query có thể xem xét cho chỉ số pilot sau khi có mapping chính thức và corpus cố định.
- [`electronics/similar-product-labels-consensus-v1.jsonl`](electronics/similar-product-labels-consensus-v1.jsonl): 22 cặp mức `2` gồm cáp Lightning cùng chuẩn khác màu/chiều dài và giá kê màn hình cùng mẫu khác màu; 2 cặp tay đỡ một/hai màn hình ở mức `1` vì khác cấu hình quan trọng. Hiền và Đạt đã đồng thuận toàn bộ 24 cặp.

Hai manifest được sinh từ manifest query và ứng viên bằng `scripts/dataset/prepare_image_pilot_labels.py`; Hiền chỉ cập nhật trường review, không sửa ảnh hoặc bộ ABO gốc. Precision@K/Recall@K của mục tiêu đúng sản phẩm chỉ có ý nghĩa trong phạm vi pilot đã chốt và cần báo rõ số query hợp lệ, K, corpus, mapping, phiên bản index/model. Với mục tiêu tương tự, chưa tính chỉ số trước khi có nhãn đồng thuận và pool đánh giá đủ phạm vi.

## Query text trên tập import v1

[`electronics/text-queries-import-v1.jsonl`](electronics/text-queries-import-v1.jsonl) chứa 12 query tiếng Việt có anchor thuộc 86 sản phẩm DRAFT của gói import v1b. [`electronics/text-product-labels-consensus-v1.jsonl`](electronics/text-product-labels-consensus-v1.jsonl) chứa 12 nhãn đồng thuận mức `2`. Đây là nhãn không exhaustive và chỉ dùng development/smoke; sản phẩm chưa được gán nhãn không mặc định là negative.

[`electronics/text-query-readiness-import-v1.jsonl`](electronics/text-query-readiness-import-v1.jsonl) ghi cả 12 anchor chưa có `productId` trong đầu vào review của nhánh này. Mapping không được tự sinh hoặc thay bằng ID prototype. Khi đưa mapping thật vào phiên chạy, phải kiểm tra quan hệ một-một với PostgreSQL trước.

## Mapping và chạy thử

Sau khi Backend import và xuất mapping chính thức, join theo externalId, kiểm tra mỗi anchor có đúng một productId nguyên dương và tồn tại trong PostgreSQL. Dừng nếu thiếu/trùng mapping hoặc sản phẩm đã LOẠI. Không dùng thứ tự dòng, FAISS row index hay ID prototype 1–1200 để thay thế.

```powershell
python scripts/dataset/prepare_evaluation.py docs/data-quality/abo-electronics-1200-status.csv C:/data/abo_dataset_review_1200 docs/testing/electronics
```

Chạy riêng keyword/filter, semantic text, image và hybrid theo API đã chốt với Hoàng/Đạt. Log queryId, commit/model/index/mapping hash, tham số, kết quả xếp hạng, thời gian và lỗi. Với filter giá dùng giá Variant hiện hành từ Backend; không suy giá từ ABO. So sánh cùng corpus và cùng tập query tại K=5/10/20 sau khi nhãn đủ điều kiện.

## Checklist và mốc bàn giao

- [x] Chuẩn bị manifest, query văn bản và ground truth anchor đề xuất.
- [x] Kiểm tra anchor thuộc GIỮ, ảnh tồn tại, queryId duy nhất; không gán productId.
- [x] Hiền hoàn tất nhãn vòng một cho 12 query text, 11 query ảnh exact và 24 cặp similar.
- [x] Đạt review độc lập và cùng Hiền tạo nhãn consensus; không có ca bất đồng.
- [ ] Nhận/đối chiếu mapping chính thức, chạy smoke từng nhánh và hybrid.
- [x] Tạo pilot 11 ảnh query 360° khác ảnh catalog và lưu nguồn/hash theo `externalId`.
- [ ] Mở rộng ảnh độc lập, nhãn đủ phạm vi và test case tích hợp có bằng chứng.

Đây là kế hoạch bàn giao, không phải kết quả test đã chạy trên dịch vụ.

## Gói hoàn thiện ngày 29/09/2026

Trạng thái khóa dữ liệu và các bước còn thiếu được chốt tại
[`electronics/evaluation-completion-v2.md`](electronics/evaluation-completion-v2.md). Các hash của
corpus, query, nhãn, mapping dự kiến, model và commit Search nằm trong
[`electronics/evaluation-lock-v2.json`](electronics/evaluation-lock-v2.json). Bộ script mới chỉ cho
phép tính Precision@K/Recall@K khi toàn bộ query đã có nhãn hợp lệ và được xác nhận
`exhaustive=true`; vì vậy hiện tại chưa có chỉ số nào được công bố.
