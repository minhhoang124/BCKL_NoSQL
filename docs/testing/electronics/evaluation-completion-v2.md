# Hoàn thiện bộ đánh giá giai đoạn 2

Ngày chuẩn bị: 29/09/2026.

## Kết luận hiện tại

- Corpus import v1b có 86 `externalId` duy nhất. Cả 12 query text consensus đều có anchor trong corpus này.
- Mapping chính thức đã được Hoàng báo có 86 cặp duy nhất với SHA-256 `C705EF318320CA0A0C8765E5AD2C321A5C57763C77A908CF417BC0070B46D359`, nhưng file mapping không nằm trong repository/workspace hiện tại nên chưa được gắn `productId`.
- 12 nhãn text đã được Hiền và Đạt đồng thuận ở PR #21, nhưng đều có `exhaustive=false`. Chúng chỉ là seed/anchor; Recall toàn corpus chỉ được tính sau khi review đủ `12 x 86 = 1.032` cặp query–sản phẩm.
- 11 query ảnh độc lập đều nằm ngoài corpus 86. Corpus 86 chỉ có một ảnh chính cho mỗi sản phẩm và không có spin 360 độ trong metadata hiện có. Vì vậy không thay ảnh catalog thành ảnh độc lập giả.
- Chưa được công bố Precision@K hoặc Recall@K.

Nguồn khóa và hash nằm tại `evaluation-lock-v2.json`.

## Việc cần Hoàng bàn giao

1. Gửi file mapping JSONL chính thức có đúng hai trường tối thiểu `externalId` và `productId`.
2. Xác nhận SHA-256 file bằng giá trị đã công bố và giữ nguyên corpus 86 trong lượt đánh giá.
3. Nếu nhóm muốn đo ảnh độc lập trong giai đoạn này, chọn một trong hai phương án:
   - import thêm 11 anchor ảnh độc lập và xuất mapping/index mới; hoặc
   - bàn giao ảnh query độc lập mới cho sản phẩm đã nằm trong corpus 86, có nguồn, quyền sử dụng và hash.

PR #23 không chặn phép đo Search Service offline. PR #23 chỉ cần cho bằng chứng Web/Backend hydrate end-to-end.

## Việc cần Đạt chạy

1. Dùng đúng PR #8 commit `c4fb2eb9055163c3e089a45ddb6dd8102023856e` hoặc thay bằng merge commit và cập nhật lock trước khi chạy.
2. Dùng đúng model, index, mapping và tham số trong `evaluation-lock-v2.json`.
3. Ghi `run-manifest.json` gồm commit Search Service, revision bất biến của hai model, SHA-256 snapshot index, SHA-256 mapping/query, danh sách hệ thống, `topK`, `rrfK`, `candidateK` và hash canonical của từng file kết quả. Các giá trị phải khớp lock; caller không được thu hẹp danh sách hệ thống.
4. Với từng query text, xuất Top-20 riêng cho keyword, semantic text và hybrid RRF theo JSONL. Rank phải là số nguyên dương, duy nhất và liên tiếp `1..N`; một hệ thống được trả ít hơn 20 kết quả nhưng Precision@K vẫn dùng K làm mẫu số:

```json
{"queryId":"TEXT-V1-001","system":"keyword","items":[{"productId":125,"rank":1,"score":1.2}]}
```

5. Chạy `build_evaluation_pool.py` để tạo ma trận review toàn bộ 86 sản phẩm cho mỗi query. Top-20 chỉ cung cấp rank; sản phẩm ngoài Top-20 vẫn phải được review và không tự động bị gán negative.

## Việc Hiền và Đạt cùng làm

1. Gán độc lập `relevance=2/1/0` cho toàn bộ 1.032 dòng trong ma trận full-corpus.
2. Giải quyết mọi bất đồng và ghi `reviewedBy`, `adjudicationStatus`, `reviewEvidence`.
3. Chỉ đặt `exhaustive=true` khi đủ `labeledBy`, một `reviewedBy` khác người gán, `consensusBy` có ít nhất hai người, `adjudicationStatus=AGREED/RESOLVED` và `reviewEvidence`. Giữ unjudged riêng, không đổi thành 0.
4. Chạy công cụ metric. Công cụ phải dừng nếu query còn nhãn thiếu hoặc chưa exhaustive. Các giá trị K và ngưỡng relevance lấy từ lock; tham số CLI nếu được truyền phải khớp chính xác lock.

## Definition of done

- Mapping đúng hash, đủ và một-một; mọi `productId` nguyên dương.
- Query, corpus, mapping, model/index và tham số có hash/commit cố định.
- Mỗi query metric-eligible có kết quả Top-20 của ba hệ thống và nhãn cho đủ 86 sản phẩm trong corpus.
- Có consensus Hiền–Đạt và `exhaustive=true` cho từng cặp query–sản phẩm.
- Có file kết quả thô, metric tại K=5/10/20 và run log ghi thời gian/môi trường.
- Query ảnh ngoài corpus không được đưa vào mẫu số.

## Lệnh chuẩn bị

```powershell
python scripts/dataset/prepare_evaluation_ready_v2.py `
  --lock docs/testing/electronics/evaluation-lock-v2.json `
  --corpus C:/path/abo-electronics-v1b/products.jsonl `
  --mapping C:/path/postgres-mapping.jsonl `
  --queries docs/testing/electronics/text-queries-import-v1.jsonl `
  --labels docs/testing/electronics/text-product-labels-consensus-v1.jsonl `
  --output-dir C:/path/evaluation-ready

python scripts/dataset/build_evaluation_pool.py `
  --lock docs/testing/electronics/evaluation-lock-v2.json `
  --run-manifest C:/path/run-manifest.json `
  --evaluation-manifest C:/path/evaluation-ready/evaluation-manifest.json `
  --mapping C:/path/postgres-mapping.jsonl `
  --queries docs/testing/electronics/text-queries-import-v1.jsonl `
  --seed-judgments C:/path/evaluation-ready/labels-mapped.jsonl `
  --results C:/path/keyword.jsonl C:/path/semantic.jsonl C:/path/hybrid.jsonl `
  --output C:/path/evaluation-ready/review-pool.jsonl

python scripts/dataset/compute_retrieval_metrics.py `
  --lock docs/testing/electronics/evaluation-lock-v2.json `
  --run-manifest C:/path/run-manifest.json `
  --evaluation-manifest C:/path/evaluation-ready/evaluation-manifest.json `
  --mapping C:/path/postgres-mapping.jsonl `
  --queries docs/testing/electronics/text-queries-import-v1.jsonl `
  --results C:/path/keyword.jsonl C:/path/semantic.jsonl C:/path/hybrid.jsonl `
  --judgments C:/path/evaluation-ready/review-pool-consensus.jsonl `
  --k 5 10 20 `
  --output C:/path/evaluation-ready/metrics.json
```

## Quy tắc hash và provenance

- Corpus và mapping bàn giao ngoài Git dùng `raw-sha256`; byte và xuống dòng phải giữ nguyên.
- Query/nhãn/kết quả JSONL dùng `canonical-jsonl-v1`: parse từng JSON object, sắp xếp key, serialize UTF-8 compact và một ký tự LF. Vì vậy checkout LF hay CRLF cho cùng hash.
- Lock là bắt buộc ở cả ba bước. Evaluation manifest do bước prepare sinh và run manifest là bắt buộc ở bước tạo pool/tính metric. Downstream đối chiếu lock hash, corpus hash/count, mapping, query IDs/hash, ba hệ thống `keyword/semantic/hybrid`, `topK=20`, `metricKValues=[5,10,20]` và `relevanceThreshold=2`; caller không thể đổi chính sách metric ngoài lock. Thay corpus, mapping, query, model revision, index snapshot, tham số hoặc file kết quả mà không cập nhật/duyệt lock mới sẽ bị từ chối.
- `Recall@K` trong output là Recall trên toàn corpus 86 đã khóa, không phải pooled Recall. Công cụ không xuất Recall nếu thiếu dù chỉ một cặp nhãn.
