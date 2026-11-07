# Quyết định của Đạt: dùng nhãn có AI hỗ trợ cho phân tích sơ bộ

Ngày 21/10/2026. Protocol riêng: `dat-ai-assisted-text-pilot-v1`.
Trạng thái: **DAT_AUTHORIZED_EXPLORATORY_ONLY**. Refs #82, #32, #25.

Đạt đã yêu cầu thực hiện mà không chờ ý kiến Hiền. Quyết định này có hiệu lực
trong phần phân tích sơ bộ của Đạt; không phải xác nhận của Hiền, consensus của
nhóm, hoặc quyền tự merge PR. Quy trình review của repository vẫn áp dụng.
Không cần yêu cầu Hiền xác nhận lại 975 nhãn để thực hiện phạm vi này.

## Những gì đã chốt

1. Dùng tên **nhãn tham chiếu có AI hỗ trợ, do Đạt tổ chức/phân xử**. AI không là
   người gán nhãn độc lập thứ hai. Đạt ủy quyền không có nghĩa tự xem từng hàng.
2. Giữ nguyên từng giá trị và provenance của 975 nhãn cũ. Nhận ba đề xuất nhãn 0
   Q12/product64,65,69 từ [lượt rà 57 cặp](../2026-10-21-pending-57/README.md),
   dưới thẩm quyền Đạt, không thêm chữ ký Hiền. Đúng ASIN/manual và cảnh báo
   tránh mưa/ẩm được giữ qua `review.json`; không suy từ thiếu thông số.
3. Sau quyết định: **978/1.032 cặp có nhãn, 54 unjudged**. Không bỏ 54 cặp hoặc
   thay chúng bằng 0/1; không đổi corpus 86 sản phẩm thành mẫu nhỏ hơn.
4. Cho phép dùng kết quả **sơ bộ** trên Q1/Q2/Q4/Q5/Q6/Q10/Q11, mỗi query đủ
   86 nhãn (602 cặp). Chọn theo độ phủ, không chọn theo điểm retrieval. Cả ba
   nhãn mới thuộc Q12 còn thiếu nên không đổi cohort, mẫu số hay metric hiện có.
5. Chưa có kết quả đủ 12 query. Không bật publication gate v2, không thay yêu cầu
   independent/consensus của protocol cũ, không ghi G-OPERATE hoặc #32 DONE.

Đây là phiên bản quyết định riêng kế thừa các quy tắc kỹ thuật của
[đề xuất trước](../2026-10-21-pending-57/protocol-proposal.snapshot.md).

Snapshot này phục hồi nguyên byte từ commit `98a14b4`, SHA-256
`eb9ccd85c724f3c643b6cc4b0fb65611a6d968f901e37b0e0f261f8c50380e56`,
đúng inputSha256 đã chốt trong decision.json ngày21/10. Verifier kiểm bản chụp
lịch sử này thay vì tài liệu sống đã đổi theo quyết định phạm vi7query ngày23/10.
Không đổi hash đã chốt, nhãn, retrieval, chỉ số hoặc publication gate. Quyết định
ngày23/10 vẫn nằm ở [tài liệu hiện hành](../../evaluation-scope-7q-2026-10-23.md);
các yêu cầu12query trong snapshot chỉ là lịch sử, không có hiệu lực mới.
Tài liệu/gói cũ được giữ bất biến để kiểm lịch sử; chữ DRAFT trong đề xuất cũ
không phủ nhận quyết định riêng của Đạt ở phiên bản này.

## Quy tắc đo và giới hạn

- Giữ nguyên corpus/mapping/query/model/index/raw retrieval và provenance của
  PR #8 `c4fb2eb`; `rrfK=60`, `candidateK=100`, `topK=20`. Không chạy lại dịch vụ.
- Chính: nhãn 2. Nhãn 1/2 chỉ là phân tích độ nhạy riêng. P@K giữ mẫu số K khi
  thiếu/rỗng; Recall dùng positive trên toàn 86 sản phẩm của query đủ nhãn;
  K=5/10/20, macro cùng cohort cho keyword/semantic/hybrid. Không positive thì
  Recall n.a. và báo số query hợp lệ, không gán 0 để giấu trường hợp đó.
- Thiếu bằng chứng giữ null. Không đổi rubric “nhẹ”, USB vận hành, Party/PA hoặc
  outdoor riêng cho cặp khó/Top-K; thay rubric cần phiên bản mới và áp đủ 86 cặp
  của query liên quan trước khi đo lại.
- Có AI hỗ trợ, hai bản đã đối chiếu nhau và đã nhìn kết quả retrieval; có nguy
  cơ thiên lệch. Chưa chấm mù/độc lập, chưa held-out benchmark, không đánh giá
  image search bằng self-match và không chứng minh chất lượng develop hiện tại.
- Chỉ 7 query development trên corpus nhỏ; có 8 cặp nhãn 2. Không kết luận
  hybrid luôn tốt hơn keyword, không nhận nghiệm thu từ test PASS.

## Bảng kết quả dùng cho phần sơ bộ

Dùng nguyên [bảng chính và độ nhạy](../2026-10-20-seven-query/README.md#kết-quả-chính--nhãn2),
[CSV tổng hợp](../2026-10-20-seven-query/metrics-summary.csv),
[CSV từng query](../2026-10-20-seven-query/metrics-per-query.csv) và
[Excel](../2026-10-20-seven-query/results.xlsx). Gói đó là snapshot 975/57 cũ,
không phải snapshot 978/54 mới; các nhãn thuộc 7 query không đổi, nên phép tính
vẫn đúng và không cần tạo số mới. Hash và phép tính được kiểm lại ở lượt này.

Phần mô tả nên ghi: “Thực nghiệm sơ bộ trên 7 truy vấn có nhãn đầy đủ trong
corpus ABO v1b gồm 86 sản phẩm. Bộ nhãn tham chiếu có AI hỗ trợ, được Đạt tổ
chức/phân xử; không phải hai lượt chấm độc lập. Năm truy vấn chưa đủ nhãn không
đưa vào phép tính. Kết quả không đại diện cho toàn bộ 12 truy vấn.”

## Tái lập và kiểm tra

`decision.json` là overlay quyết định, không sửa snapshot cũ. Script ghép nhãn
trong bộ nhớ; giữ provenance cũ, thêm lý do/nguồn của đúng ba cặp được nhận.
Có thể xuất toàn bộ 1.032 bản ghi bằng `--labels` ra stdout nếu cần chuyển giao;
không gọi output đó là ground truth độc lập hoặc đầu vào publication v2.

```sh
python3.12 docs/testing/electronics/preliminary/2026-10-21-dat-decision/verify_decision.py
python3.12 docs/testing/electronics/preliminary/2026-10-21-dat-decision/verify_decision.py --labels
python3.12 docs/testing/electronics/preliminary/2026-10-21-dat-decision/test_portability.py
python3.12 scripts/dataset/tests/test_evaluation_v2.py
```

Verifier kiểm hash đầu vào, 1.032 khóa, 975 nhãn giữ nguyên, chỉ ba thay đổi được
ủy quyền, 54 null còn nguyên, cohort không đổi; gọi lại cả hai verifier gói cũ
và đối chiếu 126 dòng per-query/18 macro. Có negative probes từ chối sửa nhãn
cũ, lấp null, thêm xác nhận Hiền, đổi sang 12 query hoặc nhận chấm độc lập.
Không cần model, ES, DB hay artifact ngoài Git cho kiểm tra phép tính này.
CI có job riêng `Evaluation bytes` trên Ubuntu/Windows, mỗi OS chạy checkout
`core.autocrlf=false/true`, ba verifier và kiểm byte stdout thực tế. Kết quả phải
xem đúng head; không dùng CI trước bản sửa portability thay cho job mới.

`.gitattributes` pin LF cho các gói text có hash và giữ XLSX binary. `--labels`
ghi UTF-8/LF qua binary stdout, không phụ thuộc codepage hoặc newline Windows.
Không đổi hash dữ liệu theo OS hoặc bỏ kiểm hash. Đọc chi tiết tại
[bản sửa Windows](../../pr82-windows-byte-portability-2026-10-21.md).

Muốn mở rộng đủ 12 query vẫn cần bằng chứng cho 54 cặp, hoặc một thiết kế mới
được ghi rõ và kiểm lại; quyết định này không tự giải quyết phần thiếu đó.
