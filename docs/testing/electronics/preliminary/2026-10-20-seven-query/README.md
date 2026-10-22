# Kết quả Search sơ bộ trên 7 query — 20/10/2026

Trạng thái: **DRAFT / PRELIMINARY_INTERNAL_REVIEW_ONLY**. Refs #32, #25.

Đây là tài liệu chia sẻ để Hiền kiểm tra phép tính và cách diễn giải, không phải
kết quả đánh giá chính thức hoặc bằng chứng nghiệm thu. Không thay
[quy trình publication](../../evaluation-completion-v2.md) hoặc
[lock v2](../../evaluation-lock-v2.json). Pipeline chính thức chưa được chạy cho
bộ nhãn này; không ghi exhaustive/consensus giả để vượt gate.

## File bàn giao

- [Bảng Excel có công thức](results.xlsx): bốn sheet Kết quả, Chi tiết, Nhãn, Xếp hạng.
- [Bảng tổng hợp CSV](metrics-summary.csv): 18 dòng, hai ngưỡng × ba hệ thống × ba K.
- [Chi tiết từng query CSV](metrics-per-query.csv): 126 dòng.
- [Provenance](provenance.json): hash đầu vào, commit/model/revision/tham số, phạm vi và giới hạn.
- [Verifier độc lập](verify_review_package.py) và [SHA256SUMS](SHA256SUMS).

Không đưa corpus, ảnh, model/cache, FAISS, embedding, môi trường/secret, log runtime
hoặc đường dẫn máy cá nhân vào Git. Workbook chỉ mang snapshot nhãn và373 kết quả
thuộc7 query để đối chiếu; không phải gói raw retrieval thay thế gói đã bàn giao.

## Phạm vi và nguồn nhãn

- Corpus ABO v1b cố định86 sản phẩm; raw retrieval từ PR #8 tại
  `c4fb2eb9055163c3e089a45ddb6dd8102023856e`.
- `topK=20`, `candidateK=100`, `rrfK=60`. Hai model/revision bất biến và
  SHA corpus/mapping/index/query/result nằm trong provenance.
- Ground truth hiện có975/1.032 nhãn cuối và57 unjudged. Giữ toàn bộ1.032 hàng
  trong workbook; ô trống không phải0. Không sửa nhãn hoặc chạy retrieval lại.
- Chỉ Q1, Q2, Q4, Q5, Q6, Q10, Q11 đủ86/86 nhãn được đưa vào phép tính
  (602 cặp). Chọn theo độ phủ nhãn, không chọn theo điểm retrieval.
- Q3 còn7, Q7 còn21, Q8 còn1, Q9 còn18, Q12 còn10 unjudged. Loại cả query
  khỏi phép tính, không chỉ bỏ các kết quả khó trong Top-K.
- Nhãn có AI hỗ trợ. 192 nhãn lấy từ file consensus trước;754 nhãn trùng được
  Đạt chấp nhận và báo Hiền cũng đồng ý qua chat. Đây là thông tin do Đạt cung cấp,
  không phải chữ ký mới trực tiếp trong file Hiền.29 nhãn mới do Đạt ủy quyền
  phân xử bằng AI, không ghi là Hiền đã duyệt.
- Hai bản đã đối chiếu nhãn nhau nên không gọi là hai lượt gán nhãn độc lập.
  Tập query development/smoke và việc rà sau retrieval không thành held-out test.

## Quy tắc tính

- Chính: chỉ `relevance=2` là liên quan, cùng ngưỡng của lock hiện hành.
- Phân tích độ nhạy riêng: `relevance>=1`. Không đổi ngưỡng chính chỉ vì điểm đẹp.
  Ngưỡng này không phải kết quả hợp lệ của publication pipeline v2 hiện hành.
- `P@K = số sản phẩm liên quan ở rank<=K / K`. Keyword trả ít hơnK hoặc0 vẫn
  giữ mẫu sốK. Không bổ sung result giả và không bỏ query rỗng.
- `R@K = số sản phẩm liên quan ở rank<=K / tổng liên quan trong toàn corpus86
  của query đủ nhãn`, không dùng số positive chỉ có trong Top20 làm mẫu số.
- Macro là trung bình đều theo query, cùng7 query cho cả ba hệ thống và hai ngưỡng.
- Không có positive: Recall để `n.a.`, không tự ghi0; báo riêng số query Recall
  hợp lệ. Trong lượt này cả7 query đều có positive ở cả hai ngưỡng.
- Thiếu nhãn trong query đang tính: workbook hiển thị `n.a.` cho chỉ số và macro
  liên quan. Muốn thay cohort phải chạy kiểm tra lại, không sửa khóa công bố.
- Rank gốc được giữ nguyên; không sort lại theo score hoặc so sánh score giữa các hệ thống.

Tham khảo định nghĩa: [NIST trec_eval Precision](https://github.com/usnistgov/trec_eval/blob/main/m_P.c),
[NIST trec_eval Recall](https://github.com/usnistgov/trec_eval/blob/main/m_recall.c).
Quy ước Recall không xác định ở trên là quy ước minh bạch của phân tích này.

## Kết quả chính — nhãn2

| Hệ thống | K | Macro Precision | Macro Recall |
|---|---:|---:|---:|
| keyword | 5 | 17.14% | 71.43% |
| keyword | 10 | 10.00% | 85.71% |
| keyword | 20 | 5.00% | 85.71% |
| semantic | 5 | 8.57% | 42.86% |
| semantic | 10 | 5.71% | 57.14% |
| semantic | 20 | 2.86% | 57.14% |
| hybrid | 5 | 14.29% | 64.29% |
| hybrid | 10 | 7.14% | 64.29% |
| hybrid | 20 | 5.71% | 100.00% |

## Phân tích độ nhạy — nhãn1 hoặc2

| Hệ thống | K | Macro Precision | Macro Recall |
|---|---:|---:|---:|
| keyword | 5 | 51.43% | 25.74% |
| keyword | 10 | 42.86% | 34.47% |
| keyword | 20 | 33.57% | 47.96% |
| semantic | 5 | 40.00% | 7.82% |
| semantic | 10 | 41.43% | 17.91% |
| semantic | 20 | 42.14% | 32.01% |
| hybrid | 5 | 54.29% | 15.76% |
| hybrid | 10 | 54.29% | 27.44% |
| hybrid | 20 | 52.14% | 58.99% |

## Diễn giải và giới hạn

- Theo nhãn2, keyword tốt hơn hybrid tại K=5 và10 trên tập này. Không kết luận
  RRF luôn hơn keyword hoặc CLIP chỉ từ kết quả này.
- Hybrid Recall@20=100% nhưng chỉ có tổng8 cặp query–sản phẩm nhãn2 trên7 query.
  Mỗi query chỉ1–2 positive nên P@10/P@20 có trần thấp ngay cả khi thu hồi đủ.
- Q5/product81: keyword rank2, hybrid rank17. Q11/product136: keyword rank1,
  hybrid rank12. Đây là điểm cần phân tích xếp hạng tiếp, chưa kết luận nguyên nhân.
- Ngưỡng1/2 cho thấy hybrid P@10=54.29%, keyword42.86%; đây là câu hỏi đánh giá
  rộng hơn, không thay thế phép tính chính với nhãn2.
- Không có kiểm định thống kê, không đủ7 query để khẳng định tổng quát.
  Không đại diện cho12 query, toàn sàn, ảnh query độc lập hoặc chất lượng trên develop mới.
- Không báo latency/throughput mới. Không dùng self-match ảnh catalog.
- Test PASS xác nhận kiểm tra và phép tính, không chứng minh ground truth khách quan
  hay chất lượng tìm kiếm đã nghiệm thu.

## Kiểm tra và tái lập phần tính

Từ thư mục này, Python3 chuẩn, không cần GPU/model/dịch vụ:

```bash
python3 verify_review_package.py
```

Verifier kiểm hash gói, snapshot nhãn/rank trong XLSX và tính lại toàn bộ126 dòng
cùng18 dòng macro trong CSV. Đây là kiểm tra gói review độc lập, không phải
`compute_retrieval_metrics.py`, không tạo exhaustive và không chứng nhận publication gate.

Có thể tải Excel rồi xem công thức từ Kết quả → Chi tiết → Nhãn/Xếp hạng.
15 hash gói raw,3 hash canonical result và hash workbook nhãn gốc đã được kiểm local.
Trước khi chia sẻ:10 unit test phép tính PASS,126 dòng đối chiếu độc lập PASS,
373 phép join rank–nhãn PASS,57 unjudged giữ nguyên, formula error scan0.
Công thức đã được kiểm trong engine tạo bảng và cached XLSX được đọc lại độc lập;
chưa kiểm thao tác/recalculation bằng ứng dụng Excel desktop thật.
Raw bundle đầy đủ/model/index không nằm trong PR này nên verifier tại đây không
tự kiểm lại byte của các artifact bên ngoài; dùng provenance để đối chiếu gói gốc.

## Nhờ Hiền review

1. Kiểm nguồn nhãn/provenance, mẫu số, query rỗng và cách chia cohort7 query.
2. Kiểm phép tính chính nhãn2 và ngưỡng1/2 được báo cáo tách biệt.
3. Kiểm cách diễn giải không gọi đây là kết quả chính thức hoặc nghiệm thu12 query.
4. Giữ57 unjudged và trạng thái publication gate hiện tại. Nếu cần công bố chính thức,
   thống nhất lại protocol/nguồn nhãn với nhóm trong PR riêng trước khi chạy gate.

Không đóng issue #32, không tick thực nghiệm/ground truth toàn bộ là DONE từ gói này.
