# Đề xuất quy trình đánh giá với nhãn có AI hỗ trợ

**Cập nhật hiệu lực ngày 23/10/2026:** nhóm đã chốt [phạm vi 7 truy vấn/602 cặp](evaluation-scope-7q-2026-10-23.md).
Mục 5–6 đã được cập nhật để thay yêu cầu cũ phải đủ 12 truy vấn. Trạng thái chưa
xác nhận của bản đề xuất ngày 21/10 chỉ còn là lịch sử, không chặn chỉ số của
7 truy vấn đã đủ nhãn.
Giữ nhãn có AI hỗ trợ, không gọi là hai lượt chấm độc lập; 5 truy vấn thiếu nhãn
không đưa vào phép tính, không đổi null thành 0.
Không thay retrieval, công thức hoặc khóa dữ liệu cũ trong đợt cập nhật này.

Trạng thái: **DRAFT_PROPOSAL**, 21/10/2026. Phạm vi: nghiên cứu thử nghiệm text
retrieval trên corpus ABO v1b 86 sản phẩm và 12 query đã khóa. Đạt yêu cầu chuẩn bị
phương án này; chưa có xác nhận mới của Hiền hoặc thay đổi protocol chính thức.

## Vấn đề cần sửa trong cách mô tả

975 nhãn đã được Đạt chấp nhận gồm nguồn hai bên trước đây và các lượt phân xử
có AI hỗ trợ; hai bản đã đối chiếu nhau. Đây không phải hai lượt gán nhãn độc lập.
Không cần xóa các nhãn đó hoặc bắt đầu lại chỉ vì tên quy trình cũ không còn mô tả
đúng dữ liệu thực tế. Tuy nhiên không được thêm danh tính/chữ ký người chưa xác nhận.

Precision/Recall tính mức khớp với bộ nhãn tham chiếu. Công thức không bắt buộc hai
người gán độc lập. Hai lượt độc lập là yêu cầu chất lượng do nhóm đặt ở protocol v2;
muốn dùng thiết kế khác phải nêu rõ thay đổi và giới hạn, không đánh dấu giả để qua gate.

## Phương án đề xuất

1. Gọi bộ dữ liệu là **nhãn tham chiếu có AI hỗ trợ, do Đạt tổ chức/phân xử**;
   giữ nguồn xác nhận Hiền ở đúng các hàng đã có bằng chứng trước đó.
2. Giữ 975 nhãn hiện tại cùng lịch sử/nguồn. Lượt rà mới chỉ đề xuất cho 57 ô trống;
   không gọi AI là người chấm độc lập thứ hai hoặc biến lời ủy quyền thành một lượt
   người dùng tự xem/chấm từng cặp.
3. Giữ nguyên nghĩa 0/1/2 và tiêu chí từng query hiện dùng. Nhãn 0 phải có căn cứ
   loại/không phù hợp; nhãn 1 có liên quan một phần với căn cứ rõ; nhãn 2 khớp đủ
   yêu cầu. Thiếu thông số không tự thành 0 hoặc 1. Chưa rõ thì `relevance=null`.
4. Nếu nhóm thay đổi cách hiểu “nhẹ”, USB operating power, Party/PA hoặc outdoor,
   ghi quyết định trước khi tính và áp nhất quán cho đủ 86 sản phẩm của query bị
   ảnh hưởng; không chỉ thay những cặp khó hoặc những kết quả Top-K.
5. Theo quyết định ngày 23/10, phạm vi định lượng chốt trên **7 × 86 = 602 cặp**
   đã đủ nhãn. Mỗi query được tính Recall trên corpus 86 đã chấm đầy đủ, giữ
   provenance và không bỏ riêng cặp khó khỏi mẫu số. Không cần đủ 12 query.
6. Báo rõ đây là tập 7 truy vấn phát triển có nhãn AI hỗ trợ, chọn theo độ đầy
   đủ nhãn chứ không theo điểm. Năm truy vấn thiếu nhãn giữ ngoài phép tính,
   không gán trống thành 0; không đổi tên thành kết quả đủ 12 query hoặc kết
   quả chất lượng tìm ảnh/toàn hệ thống.

## Cấu hình và phép tính giữ nguyên

- Corpus, mapping, query, raw Top-20, commit PR #8 `c4fb2eb`, hai revision model,
  FAISS hash, `rrfK=60`, `candidateK=100`, ba nhánh keyword/semantic/hybrid giữ khóa.
- Ngưỡng chính là `relevance=2`; `relevance>=1` là phân tích độ nhạy tách riêng.
- P@K có mẫu số K kể cả kết quả rỗng/thiếu; Recall dùng số positive trong toàn 86
  sản phẩm của query đủ nhãn. K = 5, 10, 20; macro trên cùng cohort cho ba hệ thống.
- Query không có positive báo Recall n.a. và số query Recall hợp lệ; không giấu
  bằng cách gán 0 hoặc bỏ khỏi báo cáo mà không giải thích.
- Nhãn mới được rà theo bằng chứng, không chọn theo rank hoặc điểm của hệ thống.
  Việc nhóm đã xem retrieval trước đây vẫn là nguy cơ thiên lệch phải nêu trong báo cáo.

## Dữ liệu provenance cần có cho từng cặp

`queryId`, `productId`, `externalId`, nhãn cũ/nhãn mới, nguồn đúng model/ASIN,
trang hoặc mục bằng chứng, URL/hash nếu có, lý do quyết định, phần còn chưa rõ,
`annotationMethod=AI_ASSISTED`, người/AI thực hiện đúng thực tế và trạng thái review.
Không tự ghi `independent=true`, Hiền đã duyệt hoặc human-reviewed từng hàng.

## Điều kiện chuyển sang kết quả dùng trong báo cáo

- Nhóm đã xác nhận phạm vi 7 query/602 cặp theo quyết định 23/10; giữ cách nêu
  giới hạn AI-assisted, không giả hai lượt chấm độc lập. Việc cập nhật tài liệu
  không tự chứng minh dữ liệu hoặc từng phép tính đã được kiểm lại.
- Chốt nhãn số cho query muốn đánh giá theo tiêu chí đã thống nhất; giữ unjudged
  trong nguồn, không biến thành negative.
- Tạo phiên bản protocol/lock/label manifest riêng đã review; công cụ xác minh
  thiết kế mới phải kiểm đúng schema/provenance, không bỏ hoặc nới gate v2 âm thầm.
- Chạy verifier, tính metric, đối chiếu độc lập phép tính và xuất CSV/biểu đồ sau
  khi đầu vào thỏa thiết kế đó. Báo rõ corpus nhỏ, query development, AI-assisted,
  chưa chấm mù/độc lập, chưa là held-out benchmark hoặc đánh giá image search.

## Trạng thái lượt này

Đã rà 57 cặp; có 3 đề xuất nhãn 0 ở Q12/64, Q12/65, Q12/69. Nếu nhận ba đề xuất
thì 978/1.032 cặp có nhãn số, 54 còn trống; vẫn chỉ 7 query đủ 86/86.
975 nhãn trước giữ nguyên. Không chạy retrieval/metric mới, không sửa
`evaluation-lock-v2.json` hoặc các công cụ publication v2, không tự công bố kết quả.
