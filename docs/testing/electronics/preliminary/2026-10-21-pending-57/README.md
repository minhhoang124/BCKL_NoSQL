# Rà 57 cặp còn trống — 21/10/2026

Đã rà đủ 57 cặp. Có **3 đề xuất nhãn mới**, 54 cặp vẫn chưa đủ bằng chứng.
Giữ nguyên 975 nhãn đã có và đủ 1.032 cặp; không sửa kết quả retrieval.

Đây là đề xuất có AI hỗ trợ, chưa ghi thành xác nhận mới của Hiền hoặc consensus.
Không yêu cầu chấm lại 975 nhãn chỉ để nhận gói này. Chưa tính lại metric.

## Kết quả có thể kiểm tra ngay

| Query | productId | externalId | Đề xuất | Bằng chứng |
|---|---:|---|---:|---|
| Q12 | 64 | abo:B00JZVPJD8 | 0 | Manual BTV2 liệt kê ASIN ở cover; cảnh báo tránh mưa/ẩm trang 12 |
| Q12 | 65 | abo:B00JZVPKE6 | 0 | Cùng manual BTV2, cover và trang 12 |
| Q12 | 69 | abo:B00MJEYM5O | 0 | Manual đúng ASIN ở cover; cảnh báo tránh mưa/ẩm trang 13 |

Q12 đang dùng ranh giới loa ngoài trời **kháng nước**. Ba model trên có điều kiện
sử dụng của hãng trái với nhu cầu này, nên đề xuất 0; không suy từ thiếu chữ IPX.
Không áp dụng cảnh báo của một model sang model khác.

Nguồn gốc: [BTV2](https://images-na.ssl-images-amazon.com/images/I/919Mu1igz0S.pdf),
[BTV3_2](https://images-na.ssl-images-amazon.com/images/I/81g4LKuxBaS.pdf).
URL, SHA-256 và trang bằng chứng nằm trong `review.json`, mục `sources`.
PDF đã tải và kiểm trang tại lượt rà; không đưa tài liệu hãng vào Git.

## Phần còn thiếu sau khi nhận ba đề xuất

| Query | Trước lượt rà | Có đề xuất mới | Vẫn chưa đủ bằng chứng |
|---|---:|---:|---:|
| Q3 | 7 | 0 | 7 |
| Q7 | 21 | 0 | 21 |
| Q8 | 1 | 0 | 1 |
| Q9 | 18 | 0 | 18 |
| Q12 | 10 | 3 | 7 |
| Tổng | 57 | 3 | 54 |

- Q3: “nhẹ” chưa có nguồn đúng model; riêng ID92 đã có lightweight nhưng màu còn
  chưa rõ. Không đặt ngưỡng gram sau khi xem dữ liệu để gán đủ nhãn.
- Q7: USB charging/hoạt động khi đang sạc chưa chứng minh đường cấp nguồn USB
  vận hành theo tiêu chí hiện có. ID139/142 còn ranh giới hệ thống dùng ampli;
  không thêm điều kiện nối trực tiếp PC để gán 0.
- Q8/82: nguồn và primary image xác nhận in-ear có dây màu đen, nhưng không cho
  thấy đầy đủ jack/control để xác minh có hay không micro.
- Q9: chưa xác minh công dụng Party/PA; không đổi mọi loa Bluetooth thành loa tiệc,
  micro đàm thoại thành MIC IN, hoặc đèn trạng thái thành đèn tiệc.
- Q12: shower/IPX4 không tự chứng minh outdoor; portable không tự chứng minh kháng
  nước. Nguồn R28BT US chưa đọc được/không rõ phiên bản UK nên bị loại khỏi căn cứ.

Manual BTV2 còn xác nhận AUX và sạc USB khi ON, nhưng thông tin này chưa đủ đóng
Q7. Bản scan manual shower đúng ASIN xác nhận IPX4 và cổng sạc, vẫn chưa đóng Q12.
Các tóm tắt dạng manual do website sinh, review người mua và model gần giống không
được dùng để lấp chỗ trống.

## File và cách đọc

- `ground-truth-57-cap-AI-ra-soat-2026-10-21.xlsx`: bảng rà 57 cặp và snapshot đủ
  1.032 nhãn gốc. Sheet nguồn giữ 975 nhãn cũ; cột đề xuất riêng. Cột “Nhãn nếu
  nhận đề xuất” là kịch bản, không phải chữ ký hay ground truth cuối cùng.
- `review.json` / `review.csv`: từng cặp, nhãn đề xuất hoặc null, lý do, điều còn
  thiếu và mã nguồn. `hienConfirmed=false`, `humanFinalConfirmation=false`.
- `baseline-labels.jsonl`: 1.032 khóa query–product và nhãn cũ; đối chiếu từng
  giá trị với workbook đã đưa lên PR #82 tại `96a2d5c`.
- `verify_review.py` / `SHA256SUMS`: kiểm gói và phạm vi thay đổi.

Ba đề xuất được nhận sẽ cho 978 nhãn số / 54 unjudged, nhưng không có query mới
nào đủ 86 nhãn. Vì vậy gói [7 query trước](../2026-10-20-seven-query/README.md)
giữ nguyên, không chạy lại retrieval hoặc metric để tạo một kết quả khác.

```sh
python3.12 docs/testing/electronics/preliminary/2026-10-21-pending-57/verify_review.py
python3.12 docs/testing/electronics/preliminary/2026-10-20-seven-query/verify_review_package.py
python3.12 scripts/dataset/tests/test_evaluation_v2.py
```

Quy trình phù hợp nguồn nhãn thực tế được chuẩn bị riêng tại
[đề xuất AI-assisted evaluation](../../ai-assisted-evaluation-protocol-proposal-2026-10-21.md).
Lock/gate v2 vẫn nguyên trạng; không đặt `exhaustive=true` hoặc `precisionRecallAllowed=true`.
