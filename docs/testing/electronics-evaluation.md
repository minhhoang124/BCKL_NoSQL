# Bộ query và ground truth điện tử đợt đầu

Ngày chuẩn bị: 15/09/2026. Có 20 query ảnh và 20 query tiếng Việt, bám 20 sản phẩm GIỮ trong báo cáo QA mới. Manifest nằm tại `docs/testing/electronics/queries.jsonl`; nhãn đề xuất tại `ground-truth-proposed.jsonl`. Ảnh gốc được tham chiếu bằng đường dẫn tương đối và SHA-256 trong gói ABO, không commit ảnh.

## Cách dùng và giới hạn

- Đây là bộ development/smoke: ảnh query trùng ảnh catalog nên chỉ kiểm tra pipeline/mapping. Không dùng kết quả này để kết luận khả năng tìm ảnh thực tế hoặc đưa vào kết quả thực nghiệm cuối.
- Text query được viết theo thông tin có trong tên nguồn. Mỗi query có một anchor phù hợp; các sản phẩm khác chưa được đánh nhãn không mặc định là không liên quan.
- Ground truth hiện là PROPOSED, chưa phải nhãn hai người đã thống nhất. Đạt review độc lập từng query/anchor; lưu người review và lý do sửa. Bất đồng được Hiền–Đạt đối chiếu lại ảnh/tên.
- Nhãn 2: đáp ứng đúng sản phẩm/thông số yêu cầu; 1: cùng loại nhưng thiếu/sai một thuộc tính yêu cầu; 0: không đáp ứng. Precision/Recall nhị phân dùng relevance=2 sau khi chốt quy tắc.
- Chưa tính Recall@K từ danh sách anchor không đầy đủ. Bản đánh giá cuối cần pool kết quả ES/CLIP/RRF cùng sản phẩm đối chứng, rà các sản phẩm phù hợp trong corpus cố định và ghi phạm vi đánh nhãn. Unjudged phải được giữ riêng.
- Bản cuối cần ảnh query độc lập với catalog, có nguồn/quyền sử dụng rõ; chia development/test theo nhóm sản phẩm trùng/biến thể để tránh rò rỉ, khóa test trước tối ưu.
- Bốn nhóm hiện có: audio, camera, computer, mobile_accessory. Bổ sung các nhóm đang chờ taxonomy sau khi QA được chốt; không giả định bộ này đại diện đủ bảy nhóm.

## Mapping và chạy thử

Sau khi Backend import và xuất mapping chính thức, join theo externalId, kiểm tra mỗi anchor có đúng một productId nguyên dương và tồn tại trong PostgreSQL. Dừng nếu thiếu/trùng mapping hoặc sản phẩm đã LOẠI. Không dùng thứ tự dòng, FAISS row index hay ID prototype 1–1200 để thay thế.

```powershell
python scripts/dataset/prepare_evaluation.py docs/data-quality/abo-electronics-1200-status.csv C:/data/abo_dataset_review_1200 docs/testing/electronics
```

Chạy riêng keyword/filter, semantic text, image và hybrid theo API đã chốt với Hoàng/Đạt. Log queryId, commit/model/index/mapping hash, tham số, kết quả xếp hạng, thời gian và lỗi. Với filter giá dùng giá Variant hiện hành từ Backend; không suy giá từ ABO. So sánh cùng corpus và cùng tập query tại K=5/10/20 sau khi nhãn đủ điều kiện.

## Checklist và mốc bàn giao

- [x] Chuẩn bị manifest, query văn bản và ground truth anchor đề xuất.
- [x] Kiểm tra anchor thuộc GIỮ, ảnh tồn tại, queryId duy nhất; không gán productId.
- [ ] 18/09: Đạt review nhãn và cùng Hiền chốt taxonomy/brand/condition.
- [ ] 20/09: nhận mapping chính thức, chạy smoke từng nhánh và hybrid.
- [ ] 27/09: bổ sung ảnh độc lập, nhãn đủ phạm vi và test case tích hợp có bằng chứng.

Đây là kế hoạch bàn giao, không phải kết quả test đã chạy trên dịch vụ.
