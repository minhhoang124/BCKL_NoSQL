# Phạm vi đánh giá định lượng đã chốt — 7 truy vấn / 86 sản phẩm

Ngày quyết định: 23/10/2026. Căn cứ: Hoàng chuyển thông báo thống nhất của nhóm
trong yêu cầu cập nhật tài liệu. Đây là quyết định phạm vi và cách diễn giải,
không phải một lượt chấm nhãn, chạy verifier hoặc tính lại chỉ số.

## Phạm vi có hiệu lực

- Đánh giá định lượng trên **7 truy vấn phát triển đã đủ nhãn cho toàn bộ
  86 sản phẩm**, tương ứng **602 cặp query–sản phẩm**.
- Chọn truy vấn theo độ đầy đủ nhãn, **không chọn theo điểm cao/thấp**. Dùng cùng
  7 truy vấn cho keyword, semantic text và hybrid; không đổi cohort giữa các hệ thống.
- Giữ nguyên kết quả truy hồi, thứ tự xếp hạng và phép tính Precision@5/10/20,
  Recall@5/10/20. Không chạy lại/tối ưu retrieval để làm đẹp báo cáo này.
- Năm truy vấn còn thiếu nhãn không tham gia tính chỉ số. Giữ nguyên dữ liệu và
  ô chưa chấm; không thay null/ô trống thành nhãn 0 và không xóa cặp khó.
- **Không yêu cầu đủ 12 truy vấn mới được tính/công bố chỉ số cho phạm vi 7 truy vấn này.**
  Hoàn thiện nhãn cho 12 truy vấn không còn là điều kiện chặn đợt định lượng đã chốt.

## Công thức và truy vết giữ nguyên

Ngưỡng chính relevance=2; phân tích relevance>=1 nếu đã có phải báo riêng.
Precision@K chia K, kể cả khi trả thiếu kết quả. Recall@K chia số relevant đã
chấm trên toàn bộ 86 sản phẩm của từng truy vấn đủ nhãn; không dùng riêng Top-K làm
mẫu số. Query không có relevant phải báo chính sách và số mẫu Recall hợp lệ,
không tự đặt Recall=1. Giữ cách macro-average đã chốt, không đổi để tăng điểm.

Báo cáo/manifest của Đạt ghi rõ danh sách 7 queryId, corpus/mapping, phiên bản nhãn,
hash kết quả thô, model/index/commit/tham số và nguồn/chứng cứ nhãn. Quyết định
này không tự điền các ID/hash còn thiếu hoặc khẳng định đã xác minh 602 nhãn tại
thời điểm cập nhật Markdown. Không sửa `evaluation-lock-v2.json`, raw JSONL,
Excel/CSV, nhãn hoặc chương trình tính chỉ số trong PR tài liệu này.

## Cách trình bày bắt buộc

Đây là **đánh giá trên tập 7 truy vấn phát triển với nhãn có AI hỗ trợ**. Không gọi
là hai lượt chấm độc lập, held-out/blind benchmark, kết quả đủ 12 truy vấn, chất
lượng tìm kiếm ảnh hoặc chất lượng toàn hệ thống. Không gán chữ ký/xác nhận
review từng cặp cho người chưa thực hiện. Giữ nguy cơ thiên lệch vì nhóm đã xem
kết quả truy hồi và giới hạn corpus nhỏ trong phần thảo luận.

Kiểm thử tìm ảnh JPEG/PNG → Backend → CLIP/FAISS → PostgreSQL → Web được trình
bày ở phần kiểm thử chức năng riêng. Pipeline chạy đúng không chứng minh chất
lượng truy hồi; số liệu của 7 truy vấn văn bản cũng không thay đánh giá tìm ảnh độc lập.

## Quan hệ với tài liệu/công cụ cũ

Protocol v2 ngày 29/09 đặt yêu cầu 12 × 86 và hai lượt chấm/đồng thuận là **lịch sử**.
Đề xuất AI-assisted ngày 21/10 từng hướng tới đủ 12 truy vấn cũng đã được thay về phạm vi
định lượng bởi quyết định này. Không giả `exhaustive=true`/independent reviewer
để qua công cụ v2. Công cụ v2 chưa được sửa trong đợt tài liệu này và không được
đem điều kiện cũ của nó làm lý do chặn phép tính của 7 truy vấn đã thống nhất. Nếu cần
công cụ tự động cho cohort mới, Đạt cập nhật riêng, giữ provenance và kiểm phép
tính độc lập; không nới guard âm thầm.

Phạm vi học thuật mới không tự đánh dấu G-DISCOVERY/G-OPERATE hoặc toàn đồ án
DONE. Báo cáo so sánh, latency và các thử nghiệm fusion cam kết khác vẫn phải
ghi kết quả/giới hạn thực tế, không bị xóa chỉ vì đã chốt tập 7 truy vấn.
