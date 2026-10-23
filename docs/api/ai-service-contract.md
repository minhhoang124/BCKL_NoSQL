# Backend–Search Service API contract

**21/10/2026 — Backend Admin aggregation IN_PROGRESS:** implementation riêng
theo #61/#79, không đổi envelope AI hoặc Search/index wire. Response Backend,
phân quyền, timeout/cache và cách tách snapshot gốc khỏi freshness projection
được ghi tại [Admin system health](admin-system-health.md). Chưa merge hoặc nối
health UI; smoke unloaded runtime không thay bằng chứng all-ready deployment.

## Mở rộng health nội bộ v1 — contract đã duyệt, AI runtime IN_PROGRESS

Contract #61 đã merge tại `0aaaec2`. Nhánh `feat/dat/search-health-runtime`
ngày20/10/2026 triển khai phần FastAPI để Hoàng review: endpoint/token, cached
read-only probes và single-flight/deadline. **Chưa merge hoặc nghiệm thu Backend/FE**.
GET /health legacy và payload search/index giữ nguyên. Schema/fixture v1 không
đổi cấu trúc; [bằng chứng, cách chạy và giới hạn](../testing/search-health-runtime-2026-10-20.md).

- Đường dẫn chốt hướng: FastAPI `GET /internal/health/search`, Backend
  `GET /admin/system-health`. Browser chỉ gọi Backend/current active ADMIN từ DB.
- Token server-to-server riêng: `X-Internal-Health-Token`, biến AI
  `AI_INTERNAL_HEALTH_TOKEN` và Backend `SEARCH_INTERNAL_HEALTH_TOKEN`.
  Constant-time compare, fail-closed; không secret trong repo/URL/log.
  Thiếu/sai/trùng header ->401 INTERNAL_HEALTH_UNAUTHORIZED; thiếu cấu hình
  server ->503 INTERNAL_HEALTH_NOT_CONFIGURED. Đây là transport error riêng,
  không trả snapshot. Chưa áp token mới vào legacy/search/index.
- Snapshot HTTP200 chỉ xác nhận envelope hợp lệ: schemaVersion1, generatedAt,
  components đúng clipImage/clipText/faiss/elasticsearch; capabilities đúng
  semanticText/imageSearch/hybridText. Không overall tùy ý; strict extra-forbid.
- Component có loaded nullable độc lập với READY/DEGRADED/UNAVAILABLE/UNKNOWN,
  checkedAt/expiresAt/lastSuccessAt UTC, durationMs hữu hạn, mã allowlist.
  Null khác0; vectorCount0 không đồng nghĩa lỗi hoặc đã đồng bộ đủ.
- Delta18/10: generatedAt>=expiresAt bắt buộc UNKNOWN/SNAPSHOT_STALE, kể cả
  quan sát lỗi cũ; không refresh timestamp lịch sử. Component reason NOT_CHECKED,
  PROBE_BUSY, PROBE_TIMEOUT, SNAPSHOT_STALE, CLOCK_SKEW chỉ được UNKNOWN.
  Capability vẫn ưu tiên failure chắc còn hạn của dependency khác nếu có.
  Đây là invariant liên trường của validator, không chỉ JSON Schema structural.
- Dimension mismatch chỉ là failure hiện tại khi cả model và FAISS có quan sát
  thành công READY/DEGRADED còn hạn tại generatedAt; loaded/dimension lịch sử
  trên UNKNOWN (stale/timeout) không được kéo capability thành UNAVAILABLE.
  ES failure còn hạn vẫn chặn riêng hybrid theo dependency; không dời timestamp.
- Deadline cycle5s tính lock/queue; mỗi probe min(cap,remaining), trần CLIP2s
  mỗi model/ES1.5s/FAISS0.5s. Không dispatch khi hết budget. Chưa chạy do bận
  ->UNKNOWN/PROBE_BUSY hoặc NOT_CHECKED; đã chạy quá hạn ->UNKNOWN/PROBE_TIMEOUT.
  Native task chưa kết thúc giữ single-flight, completion muộn không refresh TTL.
- Capability UNAVAILABLE đã biết ưu tiên hơn UNKNOWN, dimension mismatch fail
  closed; RRF_CONFIG_INVALID chỉ hybrid. ES lỗi không suy semantic/image lỗi,
  nhưng hybrid hiện không fallback và Backend public hybrid còn cần hydrate DB.
- Nếu cần aggregate ở Backend: allREADY->READY; bất kỳ READY/DEGRADED khi không
  allREADY->DEGRADED, kể cả allDEGRADED; không usable+cóUNKNOWN->UNKNOWN;
  allUNAVAILABLE->UNAVAILABLE. Không thêm aggregate vào envelope AI hiện tại.
- Snapshot TTL60s/probe30s, Backend timeout2s/body32KiB/cache15s/no retry hay
  redirect, FE poll30s vẫn chờ implementation Backend/FE. AI đã có scheduler30s/TTL60s
  trên nhánh runtime; thiếu token server thì không chạy background probes.
  Read-only: không ensure_index/refresh/write/sentinel/model download;
  health đọc không chứng minh ghi bền, outbox synced hoặc chất lượng retrieval.

Chi tiết field/error enum/clock skew/auth-network/ma trận runtime NOT_RUN ở
[đề xuất health](search-health-proposal.md). [Fixture](examples/search-health-proposed-v1.json)
là dữ liệu minh họa, không live. [JSON Schema](examples/search-health-proposed-v1.schema.json)
được sinh từ Pydantic SearchHealthSnapshot; schema tests không thay runtime tests.
Router nội bộ dùng schema này; không sửa Product/index/search payload.

Trạng thái: **contract Hoàng–Đạt đã thống nhất; Search Service PR #8 đã merge**. Tài liệu này mô tả giao tiếp giữa NestJS Backend và FastAPI Search Service. PR #8 đã triển khai và kiểm thử các endpoint, đồng bộ Elasticsearch–FAISS, version/idempotency, retry lỗi một phần và hybrid RRF. PR #23 đã có bằng chứng tích hợp local Backend outbox–FastAPI–hydrate; CI xuyên dịch vụ và giao diện Web vẫn là các bước nghiệm thu riêng.

PostgreSQL là nguồn chuẩn của Product, Variant, giá, tồn kho và trạng thái công khai. FastAPI quản lý Elasticsearch, CLIP/FAISS và RRF như các chỉ mục/phép xếp hạng phụ trợ. Backend không gọi Elasticsearch trực tiếp; Backend gọi Search Service, sau đó đọc lại PostgreSQL để loại sản phẩm không còn hợp lệ và giữ thứ tự kết quả còn lại.

## Định danh và đồng bộ

- `productId`: JSON number nguyên dương do PostgreSQL sinh, dùng làm cùng một ID trong Backend, Elasticsearch và FAISS. ID 1–1200 của prototype ABO không phải ID production.
- `externalId`: mã nguồn như `abo:B003MAJHB8`, chỉ dùng khi import/rebuild để nhận mapping `externalId → productId`; không dùng làm ID tìm kiếm. Sản phẩm Seller tạo có thể không có `externalId`.
- `version`: số nguyên dương tăng mỗi khi dữ liệu cần đồng bộ tìm kiếm thay đổi. Backend tăng Product.version và ghi outbox target `SEARCH_SERVICE` trong **cùng transaction**. Outbox gửi UPSERT hoặc DELETE kèm version mới sau thay đổi.
- FastAPI lưu **bền vững theo từng `productId`**: `latestVersion`, `operation` (`UPSERT`/`DELETE`), fingerprint/hash của payload event và trạng thái đồng bộ riêng của Elasticsearch, FAISS. Không chỉ lưu một version chung rồi bỏ qua mọi request có version bằng nhau.
- `version < latestVersion`: không cập nhật chỉ mục; trả HTTP 200 với `outcome=STALE` để Backend hoàn tất outbox cũ. DELETE phải giữ version/tombstone bền vững để UPSERT cũ đến muộn không làm sản phẩm xuất hiện lại.
- `version == latestVersion` với cùng operation và payload: chỉ chạy lại chỉ mục đang `FAILED` hoặc chưa hoàn tất. Chỉ mục đã thành công trả `ALREADY_APPLIED`; nếu cả hai đã hoàn tất, request là `NOOP`.
- `version == latestVersion` nhưng khác operation hoặc payload: trả HTTP 409 với mã lỗi `VERSION_CONFLICT`. Backend phải phát đúng một nội dung event cho mỗi cặp `productId/version` và retry nguyên nội dung đó.
- `version > latestVersion`: ghi nhận event/version mới vào trạng thái bền vững **trước khi** cập nhật hai chỉ mục. Event mới được phép thay thế event cũ kể cả khi event cũ mới thành công một phần. UPSERT với version mới hơn có thể kích hoạt lại sản phẩm.
- Khi Product bị ẩn, đóng băng hoặc không còn đủ điều kiện công khai, Backend phát DELETE với version mới. Ngay cả khi chỉ mục đồng bộ chậm, Backend vẫn phải loại Product đó khi hydrate kết quả từ PostgreSQL.

## Health check

`GET /health`

Endpoint này chỉ chứng minh tiến trình FastAPI sẵn sàng nhận request; trạng thái Elasticsearch/FAISS cần được báo riêng nếu muốn dùng health check để giám sát đầy đủ.

## Lập chỉ mục sản phẩm

`POST /index/product` để UPSERT một Product; `POST /index/products` để UPSERT batch. Mỗi phần tử batch có cùng cấu trúc như ví dụ dưới. Chỉ Backend/importer tin cậy gọi các endpoint này; dữ liệu không lấy trực tiếp từ client/Seller.

```json
{
  "productId": 125,
  "version": 4,
  "name": "Wireless Bluetooth Headphones",
  "description": "Over-ear wireless headphones",
  "categoryId": 12,
  "categoryName": "Headphones",
  "categoryPathIds": [1, 5, 12],
  "brandId": 8,
  "brandName": "Sony",
  "imageUrls": [
    "http://backend:3001/uploads/products/125/1.jpg"
  ],
  "minPrice": "1290000.00",
  "maxPrice": "1590000.00",
  "inStock": true,
  "attributes": {
    "color": ["Black"],
    "connectivity": ["Bluetooth"]
  }
}
```

- `categoryId` là danh mục lá chính thức trong PostgreSQL; `categoryPathIds` đi từ gốc đến lá và kết thúc bằng `categoryId`. Các nhãn category của dataset ABO không được dùng thay cho ID này trước khi Backend ánh xạ.
- `brandId`/`brandName` là thông tin thương hiệu Backend đã xác minh; khi chưa có thương hiệu, cần cho phép `null` và không tự đoán từ dataset. `description` có thể rỗng nếu nguồn không cung cấp.
- `minPrice`/`maxPrice` là chuỗi số thập phân do Backend tính từ các Variant đang hoạt động. FastAPI không tự đọc Variant hoặc tính lại giá. `inStock=true` khi có ít nhất một Variant đang hoạt động với `stock > 0`. Giá/tồn kho ở index chỉ phục vụ tìm/lọc; Backend kiểm tra lại giá và tồn kho hiện hành trước khi trả kết quả cho khách.
- `attributes` chứa thuộc tính đã chuẩn hóa và được phép công khai; giá trị là mảng chuỗi. Không tự suy diễn thuộc tính thiếu từ tên/ảnh.
- `imageUrls` là URL ảnh đã được Backend kiểm tra, lưu và phục vụ, không phải đường dẫn tương đối trong gói ABO, link Google Drive hay đường dẫn trên máy cá nhân. FastAPI chỉ tải ảnh từ scheme/host nằm trong allowlist cấu hình; phải giới hạn redirect, timeout và kích thước ảnh để tránh truy cập tài nguyên ngoài phạm vi.

Địa chỉ Backend để FastAPI tải ảnh phải cấu hình bằng biến môi trường; không hard-code hostname hoặc cổng trong code. Ví dụ theo cách triển khai:

| Cách chạy | Base URL ví dụ |
| --- | --- |
| Backend trên máy, FastAPI trong Docker | `http://host.docker.internal:3001/` |
| Cả hai trong Docker Compose, khi đã có service `backend` | `http://backend:3001/` |
| Trình duyệt hoặc FastAPI chạy local ngoài Docker | `http://localhost:3001/` |

Backend hiện dùng cổng **3001**. Ví dụ `backend:3001` là kiến trúc Compose hướng tới; Compose hiện chưa có service Backend nên chưa phải hostname chạy được ở mọi môi trường. Allowlist phải khớp môi trường đang chạy.

### Kết quả cập nhật chỉ mục

UPSERT và DELETE dùng chung cấu trúc response (DELETE có `operation="DELETE"`):

```json
{
  "productId": 125,
  "version": 4,
  "operation": "UPSERT",
  "outcome": "APPLIED",
  "indexes": {
    "elasticsearch": { "status": "SUCCEEDED", "version": 4 },
    "faiss": { "status": "SUCCEEDED", "version": 4 }
  }
}
```

- `indexes.*.status`: `SUCCEEDED` (vừa cập nhật), `ALREADY_APPLIED` (đã cập nhật trong lần trước), `FAILED` (chưa hoàn tất do lỗi). `indexes.*.version` là version đã áp dụng ở chỉ mục tương ứng, không mặc định bằng version event khi chỉ mục đó thất bại.
- `outcome`: `APPLIED` khi event hoàn tất sau khi thực hiện cập nhật; `NOOP` khi cùng event đã hoàn tất từ trước; `STALE` khi version cũ đã bị thay thế; `PARTIAL_FAILURE` khi ít nhất một chỉ mục chưa hoàn tất.
- HTTP 200: cả hai chỉ mục đã hoàn tất, đã hoàn tất trước đó, hoặc event cũ đã bị thay thế. HTTP 400/422: payload không hợp lệ. HTTP 409 + `VERSION_CONFLICT`: cùng `productId/version` nhưng khác operation/payload. HTTP 503: ít nhất một chỉ mục lỗi tạm thời; body vẫn có `productId`, `version`, `operation`, `outcome` và trạng thái từng chỉ mục.
- Backend chỉ đánh dấu outbox hoàn tất khi nhận HTTP 200; với HTTP 503, retry **cùng** `productId/version/operation/payload`. Quy tắc này áp dụng cho cả UPSERT và DELETE.

`POST /index/products` áp dụng cùng quy tắc version và kết quả riêng cho từng Product trong batch; hình dạng envelope batch cần được Hoàng–Đạt chốt trước khi Backend phụ thuộc vào endpoint batch. Trong PR #8, endpoint batch hiện trả lỗi chủ động `BATCH_INDEXING_NOT_SUPPORTED`; Backend phải gọi `POST /index/product` cho từng sản phẩm. Với endpoint đơn, các status hai chỉ mục, conflict, stale event, lỗi một phần và retry cùng version đã được triển khai và chạy smoke test với Elasticsearch thật.

### Xóa khỏi chỉ mục

`DELETE /index/product/{productId}?version=N`

Ví dụ: `DELETE /index/product/125?version=5`. DELETE xóa sản phẩm khỏi Elasticsearch và FAISS, đồng thời giữ version/tombstone cuối. Nếu đã có version mới hơn thì bỏ qua DELETE cũ. Khi kích hoạt lại, Backend phát UPSERT với version lớn hơn version DELETE.

## Tìm kiếm

**Image gateway candidate23/10:** Backend đang triển khai proxy multipart tới
endpoint image **đã tồn tại**, không đổi wire/AI runtime. Field image JPEG/PNG
5MiB, topK1..50/default10, candidateK1..150/default min(max(topK*3,30),150).
Response query type=image/topK/candidateK, text bị omit theo exclude-none.
Hydrate vẫn dùng PostgreSQL/public policy. [Giới hạn, validator và test candidate](image-search-gateway.md).
Chưa Web upload hoặc loaded Search acceptance; cần Hoàng–Đạt review alignment.

- `POST /search/image`: truy vấn bằng ảnh; CLIP tạo vector và FAISS tìm ứng viên.
- `POST /search/text`: truy vấn văn bản ngữ nghĩa bằng CLIP/FAISS.
- `POST /search/hybrid`: endpoint hợp nhất cho Backend. FastAPI lấy ứng viên từ Elasticsearch (từ khóa/bộ lọc) và CLIP/FAISS, sau đó dùng RRF để xếp hạng. Endpoint đã được triển khai trong PR #8 và chạy smoke test với Elasticsearch thật; Backend vẫn phải hydrate và kiểm tra trạng thái Product từ PostgreSQL.

Bộ lọc giai đoạn đầu: `categoryIds`, `brandIds`, `minPrice`, `maxPrice`, `inStock`. ID lọc là ID PostgreSQL; giá lọc dùng dữ liệu do Backend tính từ Variant. Rating chưa có schema/code ổn định nên **chưa** là trường bắt buộc; `ratingAverage`, `ratingCount`, `ratingMin` sẽ được thêm bằng thay đổi contract riêng sau khi module Review ổn định.

### Tìm kiếm hybrid bằng văn bản

`POST /search/hybrid` nhận JSON:

```json
{
  "query": "tai nghe bluetooth chống ồn",
  "filters": {
    "categoryIds": [12],
    "brandIds": [8],
    "minPrice": 500000,
    "maxPrice": 2000000,
    "inStock": true
  },
  "topK": 20,
  "candidateK": 100
}
```

- `query` bắt buộc và không được rỗng sau khi trim. `topK` là số kết quả cuối; `candidateK >= topK` là số ứng viên lấy trước RRF. Giới hạn tối đa/default cụ thể của hai tham số phải được validation và tài liệu API của Search Service công bố khi triển khai.
- `rrfK` là cấu hình/tham số thực nghiệm của Search Service, không nhận trực tiếp từ client công khai.
- Bộ lọc áp dụng nhất quán cho **cả** nhánh Elasticsearch keyword và CLIP/FAISS semantic **trước RRF**; không để nhánh nào đưa lại sản phẩm ngoài bộ lọc. Trong `categoryIds` và `brandIds` là OR; giữa các nhóm bộ lọc là AND.
- Giá ở Elasticsearch chỉ là dữ liệu lọc phụ trợ. Backend vẫn kiểm tra Variant, giá, tồn kho và trạng thái công khai hiện hành khi hydrate kết quả từ PostgreSQL.

Response:

```json
{
  "query": {
    "type": "hybrid_text",
    "text": "tai nghe bluetooth chống ồn"
  },
  "items": [
    { "productId": 125, "rank": 1, "score": 0.0325 }
  ],
  "responseTimeMs": 132
}
```

`score` của hybrid là **điểm RRF**, không phải cosine similarity. Rank của từng nhánh nên lưu trong search log/debug để phục vụ thực nghiệm, chưa bắt buộc trả cho frontend. PR #8 đã triển khai endpoint này; PR #23 có kiểm chứng local qua Backend, còn CI xuyên dịch vụ và đánh giá bằng ground truth độc lập vẫn là bước riêng.

Kết quả tìm kiếm công khai trả `productId` dạng number cùng thứ tự và điểm xếp hạng, không trả dữ liệu Product/giá/tồn kho từ index như nguồn chuẩn. Ví dụ cấu trúc kết quả hiện có cho `/search/image` và `/search/text`:

```json
{
  "items": [
    { "productId": 125, "rank": 1, "score": 0.91 }
  ],
  "responseTimeMs": 132
}
```

Backend lấy Product từ PostgreSQL theo các `productId` này, loại bản ghi bị ẩn/đóng băng/chưa duyệt hoặc không còn hợp lệ, kiểm tra lại giá/tồn kho, rồi giữ thứ tự tương đối của các kết quả còn lại. FastAPI không trả `externalId` làm khóa kết quả.

## Contract test và giới hạn timeout/retry

Các ví dụ JSON khóa contract đơn hiện tại nằm tại
`AI_CLIP/tests/fixtures/backend_contract/` và được kiểm tra bởi
`AI_CLIP/tests/test_backend_contract.py`. Fixture bao phủ UPSERT Product, hybrid
search, response đồng bộ hai index và response hybrid. Payload index Product giữ
giá dưới dạng chuỗi decimal; filter của `POST /search/hybrid` dùng JSON number như
payload Backend hiện tại. FastAPI chuyển cả hai qua `Decimal` khi validation rồi
chỉ chuyển sang số cho Elasticsearch DSL. `categoryIds`/`brandIds` là mảng ID PostgreSQL,
`inStock` là boolean JSON và response không được có trường ngoài schema đã chốt.

FastAPI giới hạn timeout tải ảnh và Elasticsearch trong khoảng `(0, 60]` giây.
FastAPI không tự retry thao tác ghi Elasticsearch. Backend sở hữu retry outbox:
chỉ retry lỗi tạm thời/HTTP 503 với nguyên event; không retry HTTP 400/422/409 và
không tạo version mới chỉ để thử lại. Contract test trong PR #8 chứng minh phía
FastAPI nhận/trả đúng schema; PR #23 kiểm tra nghiêm response và có bằng chứng HTTP
xuyên dịch vụ local. Việc tự dựng toàn bộ chuỗi này trong CI vẫn là điều kiện riêng.

## Bằng chứng tích hợp Backend–Search Service

Ngày 28/09/2026, PR #23 được kiểm chứng local trên PostgreSQL riêng,
Elasticsearch 8.19.21 index cô lập và FastAPI từ PR #8. Luồng chạy thật là:

```text
Product mutation → SearchOutbox → SearchSync worker
→ FastAPI → Elasticsearch + FAISS
→ POST /search/hybrid → PostgreSQL hydrate
```

Các trạng thái `approve v4 → UPSERT`, `hide v5 → DELETE`, `show v6 → UPSERT`
và `freeze v7 → DELETE` đều tạo outbox `SUCCEEDED` ở lần thử đầu. Backend trả
Product sau approve/show và loại Product sau hide/freeze; trạng thái cuối không
còn document Elasticsearch hoặc vector FAISS của Product thử nghiệm. Test hai
service còn bao phủ NOOP, STALE, VERSION_CONFLICT và retry phần index còn thiếu.

Đây là bằng chứng tích hợp local có kiểm soát, không phải kết quả đánh giá chất
lượng tìm kiếm. CI vẫn chưa tự dựng toàn bộ PostgreSQL–Backend–FastAPI–Elasticsearch
và Web Search/Precision–Recall thuộc các bước nghiệm thu riêng.
