# PR #79 — sửa P2 Elasticsearch false READY, 20/10/2026

## Lỗi và phạm vi

Phản hồi của Hoàng tại head `32673c8`:
[review 5582066236](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/79#pullrequestreview-5582066236).
Probe cũ chỉ so kiểu mapping rồi đọc match_all. `name`/`description` vẫn có thể
type=text nhưng index=false: probe báo readable/EMPTY_INDEX trong khi keyword
multi_match thật HTTP400. Đây là thiếu kiểm tra khả năng query, không phải lỗi
Backend hoặc kết luận về chất lượng retrieval.

Bản sửa không đổi INDEX_MAPPING, Product schema/productId, request/response
search/index, schema health v1, deadline/TTL, dependency hoặc lockfile.

## Thay đổi

- Hai field full-text name/description phải có index bật (mặc định true).
- productId/categoryId/categoryPathIds/brandId/minPrice/maxPrice/inStock phải
  có index hoặc doc_values để thực hiện terms/range/term. Không cấm bừa
  index=false trên numeric/boolean: doc-values-only vẫn query được.
- Không bắt categoryName/brandName/version có index: DSL hiện hành không query
  chúng. attributes vẫn object/enabled=false theo hợp đồng đã có.
- Root mapping hoặc _source bị disabled bị từ chối; không báo index sẵn sàng
  cho pipeline đọc productId chỉ vì nó đang rỗng.
- Vi phạm trả ES_MAPPING_INVALID trước request _search, không EMPTY_INDEX giả.
  Collector chuyển ES/hybrid thành UNAVAILABLE; semantic/image không bị kéo lỗi.
- Giữ nguyên probe read-only: mapping + search size1 trên cấu hình tốt, một GET
  mapping khi cấu hình không dùng được; không field_caps, retry, sửa mapping,
  refresh hoặc sentinel trong probe. Không tăng số request hoặc budget1.5s.

Theo tài liệu hãng: [index](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/mapping-index),
[doc_values](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/doc-values).
Đã kiểm lại trực tiếp trên Elasticsearch8.19.21, không chỉ suy từ docs hiện tại.

## Red/green và tự động

- Viết35 regression mới trước sửa: **11 FAIL /24 PASS** trên code cũ. Hai text,
  bảy filter tắt cả index/doc_values, root và _source disabled tái hiện false READY.
- Sau sửa35/35 PASS. Thêm2 collector tests chứng minh ES/hybrid UNAVAILABLE khi
  text không query được nhưng semantic/image vẫn READY.
- Full AI **317/317 PASS**, 5 dependency deprecation warnings. Ruff app/tests/scripts
  PASS; exporter schema chạy lại byte-identical; git diff --check PASS.
- Không sửa assertion cũ hoặc skip test. Hai file test mới/cập nhật không gọi
  Elasticsearch thật; MockTransport không được nhận là bằng chứng live.

## Kiểm chứng Elasticsearch thật, QA riêng

Container riêng `dat-pr79-p2-es-20261020`, loopback19222, image8.19.21
ID `sha256:cbf5cd6cfe5532a9c02d510c66d238bf329cd51fe3d57170a2a880aca7d47419`.
Không PostgreSQL/model/FAISS/index demo hoặc dữ liệu ground truth.

Đã nạp đúng code cũ từ Git `32673c8` vào helper QA ngoài repo: index rỗng có
cả hai text index=false → probe cũ readable=true/EMPTY_INDEX, keyword thật400.
Không đổi source cũ để làm counterexample; index QA này đã dọn.

Script tái lập được commit: `AI_CLIP/scripts/verify_search_health_mapping.py`.
Lượt local trước commit 08:08:56–08:08:58UTC (15:08:56–15:08:58giờ VN) **16/16 PASS**:

| Cấu hình | Số ca | Probe mới | Query production DSL |
|---|---:|---|---|
| Chuẩn rỗng / có một Product QA | 2 | READY, EMPTY_INDEX chỉ khi count0 | 200, đúng0/1 hit |
| Một hoặc cả hai text index=false | 3 | ES_MAPPING_INVALID | 400 |
| Bảy filter, mỗi lần một field tắt index và doc_values | 7 | ES_MAPPING_INVALID | 400 |
| Bảy filter cùng doc-values-only | 1 | READY | 200, đúng ID125 |
| Ba metadata field không query bị tắt index/doc_values | 1 | READY | 200, đúng ID125 |
| Root / _source disabled, index rỗng | 2 | ES_MAPPING_INVALID | 200 không chứng minh readiness |

Ở mỗi ca, đối chiếu mapping + match_all hits/source trước/sau probe byte-equivalent
qua canonical JSON; trace chỉ GET (2 tốt/1 invalid). Business query kiểm riêng
dùng build_elasticsearch_query thật, keyword + category + brand + min/maxPrice +
inStock + productId restriction. Không dùng match_all làm bằng chứng keyword.

Setup có PUT mapping/document và refresh=true cho fixture có dữ liệu; cleanup
DELETE chỉ đúng tên random đã tạo thành công. Các write đó **ngoài probe**;
không lấy fixture Product làm kết quả truy hồi đánh giá. 16 index QA đã dọn,
container sẽ dừng sau kiểm exact-head. JSON/log live giữ local ngoài Git.

## Chạy lại

Từ AI_CLIP, dùng môi trường Python/requirements hiện có. Trước đó khởi động
Elasticsearch QA riêng trên loopback cổng không mặc định; không trỏ máy demo.

```sh
python -m pytest -q
python -m ruff check app tests scripts
python scripts/export_search_health_schema.py
python scripts/verify_search_health_mapping.py --url http://127.0.0.1:19222 --output /tmp/pr79-health-mapping.json
```

Script chỉ nhận HTTP127.0.0.1 với cổng khác80/9200, không credential; namespace
random chỉ cho QA. Assertion fail vẫn cleanup đúng index script đã tạo.

## Giới hạn / review

Không rerun live CLIP/FAISS, Backend/PostgreSQL E2E hoặc browser cho thay đổi AI
mapping check này. Test schema và cache/timeout/single-flight vẫn chạy trong317.
Không chứng minh mọi analyzer/runtime field hoặc tất cả query/data tương lai;
khả năng ghi, persistence/outbox sync và Precision/Recall vẫn ngoài readiness.
Các flag index/doc_values mặc định được diễn giải theo mapping ES8.19 hiện hành.
Nếu thay DSL/field type thì phải cập nhật kiểm tra và regression tương ứng.
CI mới phải kiểm đúng head sửa; CI#349 của32673c8 chỉ là lịch sử. Hoàng re-review
mới có thể gỡ Request changes; Đạt không tự approve/resolve/Ready/merge.
