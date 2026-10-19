# Đề xuất contract health Search cho Admin

Ngày 16/10/2026. Người chuẩn bị: Đạt, có Codex AI hỗ trợ rà code.
Trạng thái: **PROPOSED — chờ Hoàng/Đạt thống nhất và Hiền review hiển thị. Chưa triển khai.**
Baseline đã đọc từ Git: develop `035656be3d1ce43e936ddd4f45e5ea8c01047cf8`.

**Delta 17/10:** Đạt xác nhận review Hoàng 5546401582 về endpoint, envelope,
token nội bộ, hard cycle budget và aggregate. Pydantic/JSON Schema/fixture đã
bổ sung để review contract; chưa có router/auth/scheduler/probe hoạt động mới.
Contract chuẩn có mục mở rộng **PROPOSED, chưa runtime** và liên kết schema.

## 1. Kết quả rà hiện trạng

| Phần | Code hiện có tại baseline | Không được suy ra |
|---|---|---|
| Backend GET /health | AppController gọi prisma.user.count, trả database connected hoặc 503 disconnected | Không phải health FastAPI, ES, CLIP, FAISS hoặc dashboard nghiệp vụ |
| FastAPI GET /health | status chỉ có literal ok; modelLoaded/indexLoaded từ RuntimeState; vectorCount lấy lại từ FaissService nếu có | Không chứng minh inference/search thành công. Không có kiểm tra ES. modelLoaded là chung hai model, không tách image/text |
| CLIP | is_loaded kiểm hai object model khác null; encode_text và encode_image dùng hai model, chung RLock | Đã có object không chứng minh output đúng chiều/hữu hạn hoặc đúng model revision |
| FAISS | load mở IndexIDMap/IndexIDMap2, đọc state; startup so image embedding dimension với index; search có khóa | Không chứng minh đồng bộ mọi productId/version với PostgreSQL, chất lượng retrieval hoặc file còn ghi được |
| ES | is_available chỉ GET root và kiểm HTTP200; ensure_index có thể PUT tạo index | Root200 không chứng minh index sản phẩm tồn tại hoặc đọc được. Không gọi ensure_index trong health vì có side effect |
| Search | /search/text và /search/image dùng CLIP+FAISS; /search/hybrid gọi keyword ES trước, dùng ES lọc semantic khi có filter, rồi RRF | ES lỗi thì hybrid hiện tại không có fallback semantic-only. Backend public Search gọi hybrid rồi hydrate PostgreSQL |

Nguồn code: AI_CLIP/app/routers/health.py, schemas/health.py, services/runtime.py, services/clip_service.py, services/faiss_service.py, services/elasticsearch_service.py, routers/search.py, main.py, config.py; BE/src/app.controller.ts và search/search.service.ts. Tất cả nhận định hiện trạng thuộc SHA trên; không nhận các proposal bên dưới là code đã có.

## 2. Ranh giới và endpoint đề xuất

1. Giữ nguyên shape/status semantics GET /health cũ trong đợt bổ sung. Ghi rõ đây là legacy runtime snapshot, không phải readiness tổng. Không âm thầm thêm enum mới vào field status mà client hiện có có thể kiểm nghiêm.
2. Đề xuất **GET /internal/health/search** tại FastAPI, chỉ dành Backend tin cậy. Endpoint mới trả snapshot schemaVersion1 dưới đây; chưa có route này ở baseline. Không cho browser gọi trực tiếp.
3. Hoàng quyết định tên endpoint Admin, đề xuất **GET /admin/system-health** tại Backend. JWT + current active ADMIN; FE chỉ gọi Backend. Backend tự kiểm PostgreSQL và thu snapshot AI, không cho client truyền service URL/index/probe query/timeout. Phần dashboard đơn/doanh thu là contract khác do Hoàng chốt, không nằm trong tài liệu này.
4. Hoàng đề xuất và Đạt xác nhận auth v1: header `X-Internal-Health-Token`, AI dùng biến `AI_INTERNAL_HEALTH_TOKEN`, Backend dùng `SEARCH_INTERNAL_HEALTH_TOKEN`; secret riêng sinh ngoài repo, không dùng JWT/user token. So sánh constant-time; thiếu cấu hình, header thiếu/trùng/sai đều fail-closed, lỗi sanitized và no-store, không trả snapshot. Chốt wire: thiếu/sai/trùng header khi đã cấu hình ->401 `INTERNAL_HEALTH_UNAUTHORIZED`; server chưa cấu hình ->503 `INTERNAL_HEALTH_NOT_CONFIGURED`, không tiết lộ secret. Hai mã transport không thuộc snapshot errorCode/reasonCodes. Chỉ bảo vệ route mới, không thay auth của legacy/search/index. CORS không thay auth; dev loopback/private, ra ngoài máy phải TLS/private network. Đây là contract chờ review delta, chưa code auth và không gửi giá trị thật qua comment.

## 3. Trạng thái và dữ liệu thiếu

Mỗi component có hai tín hiệu độc lập:

- `loaded: true|false|null`: chỉ dùng cho clipImage, clipText, faiss. True là object đang được báo đã tải trong process; false là chưa tải; null là chưa quan sát được. ES dùng null vì không có khái niệm model/index tải vào process AI.
- `status: READY|DEGRADED|UNAVAILABLE|UNKNOWN`: kết quả hoạt động gần nhất còn hạn. READY=probe đọc/thực thi hợp lệ. DEGRADED=thao tác đọc vẫn được chứng minh chạy nhưng có cảnh báo cụ thể không chặn đọc. UNAVAILABLE=probe đã thất bại hoặc đã biết dependency thiếu. UNKNOWN=chưa probe, kết quả hết hạn, đang bận chưa có kết quả mới hoặc response không kiểm chứng được. Không biến UNKNOWN thành READY.

Trường chung bắt buộc: `checkedAt`, `expiresAt`, `lastSuccessAt` là UTC ISO8601 hoặc null; `durationMs` là finite number >=0 hoặc null; `errorCode` là allowlist string hoặc null; `warningCodes` là mảng enum không trùng. Không gửi raw exception/message/stack/HTTP body/secret/path/hostname nội bộ.

`checkedAt` là thời điểm hoàn tất lần thử thật gần nhất, kể cả thất bại. `expiresAt` là checkedAt+TTL theo policy, không cập nhật chỉ vì FE poll/cache HIT. `lastSuccessAt` giữ mốc thành công cũ qua các lần lỗi; không dùng mốc đó làm trạng thái xanh. Không có quan sát thì cả ba null. `loaded` cũng là observation theo snapshot, không là phép kiểm trực tiếp từ browser.

Response envelope: `schemaVersion:1`, `generatedAt` UTC là thời điểm phát response, `components` gồm đúng `clipImage`, `clipText`, `faiss`, `elasticsearch`; `capabilities` gồm đúng `semanticText`, `imageSearch`, `hybridText`. Trường/component lạ hoặc thiếu bị Backend từ chối an toàn, không tự mặc định xanh. generatedAt mới không làm checkedAt cũ thành mới.

**Sửa invariant 18/10:** tại `generatedAt >= expiresAt`, mọi quan sát cũ,
kể cả lỗi UNAVAILABLE, chỉ được biểu diễn bằng UNKNOWN/SNAPSHOT_STALE.
Không dời checkedAt/expiresAt/lastSuccessAt để làm mới lỗi hoặc thành công cũ;
validator từ chối payload không nhất quán, không tự sửa response đầu vào.
Các mã component NOT_CHECKED/PROBE_BUSY/PROBE_TIMEOUT/SNAPSHOT_STALE/CLOCK_SKEW
chỉ đi với UNKNOWN, không chứng minh failure. ES_TIMEOUT là lỗi ES quan sát
được, khác PROBE_TIMEOUT là hết budget kiểm tra. Capability tính lại từ dependency:
lỗi chắc còn hạn vẫn ưu tiên hơn UNKNOWN của dependency khác; không buộc mọi
capability UNAVAILABLE phải loại mã UNKNOWN khỏi danh sách lý do hỗn hợp.

Metadata riêng:
- clipImage/clipText: `dimension` positive integer|null.
- faiss: `dimension` positive integer|null, `vectorCount` integer>=0|null.
- elasticsearch: `indexExists` boolean|null, `readable` boolean|null. Không trả URL hoặc index name ra browser.

Không hard-code vectorCount=86 hoặc dimension512 như điều kiện health chung. So dimension thực của từng model đang kiểm với index đang phục vụ; model text/image khác revision vẫn có thể cùng vector space đã được chốt riêng. Health đúng chiều không chứng minh tương thích ngữ nghĩa/model provenance.

**Sửa dimension 18/10:** chỉ suy DIMENSION_MISMATCH khi cả model liên quan và
FAISS có quan sát thành công READY/DEGRADED còn hạn tại generatedAt. loaded=true
và dimension có thể được giữ làm metadata lịch sử trên UNKNOWN nhưng không tự
chứng minh mismatch hiện tại, kể cả UNKNOWN/PROBE_TIMEOUT có TTL chưa hết.
Không refresh timestamp hoặc xóa metadata lịch sử để né validator. Mismatch cũ
không làm capability UNAVAILABLE; lỗi ES chắc còn hạn vẫn có thể làm riêng
hybrid UNAVAILABLE, còn semantic/image UNKNOWN theo dependency của chúng.

## 4. Probe hoạt động đề xuất

| Component | Đã tải | Probe tối thiểu để READY | Không làm |
|---|---|---|---|
| clipText | Đọc trạng thái model text riêng, không chỉ is_loaded chung | encode chuỗi cố định vô hại, kiểm shape(1,d), float hữu hạn, norm>0, dimension khớp FAISS nếu index đã tải | Không tải model từ mạng, không reload, không dùng query người dùng, không log embedding |
| clipImage | Đọc trạng thái model image riêng | Decode PNG nhỏ cố định trong bộ nhớ qua ImageService rồi encode_image, kiểm shape/d/norm/hữu hạn | Không download ảnh ngoài, không ghi ảnh probe vào dataset/index |
| faiss | is_loaded, dimension, vectorCount | Search bằng vector chuẩn hóa cố định đúng dimension, k=1; kiểm số phần tử, ID hợp lệ khi có hit, score hữu hạn cho hit hợp lệ | Không upsert/delete/save/rebuild/copy toàn index trong GET |
| ES | loaded=null | Gọi đọc target index: GET mapping kiểm các field cần cho keyword/filter và request _search size1, timeout ngắn, allow_no_indices=false/ignore_unavailable=false; kiểm response/shard failures/timed_out/shape | Không ensure_index, PUT mapping, refresh, tạo document sentinel hoặc yêu cầu cluster toàn cục green |

FAISS ntotal=0 là index hợp lệ: search sentinel id=-1 và score pad -inf không bị kết luận corrupt; không đưa sentinel vào hit thật. READY kèm `warningCodes:["EMPTY_INDEX"]` và vectorCount0; UI hiện “index sẵn sàng, chưa có vector”, không “đã đồng bộ đủ dữ liệu”. Padding không hợp lệ khác hoặc NaN/hit ID sai cần lỗi riêng. Integrity toàn bộ ID/duplicate/tombstone/persistence thuộc audit sâu, không được tuyên bố đã kiểm từ một search1.

ES index tồn tại nhưng không document vẫn có thể READY+EMPTY_INDEX nếu xác minh được count0. Không dùng metadata thiếu để đoán empty. Cluster yellow do replica chưa phân bổ không tự làm search unavailable; chỉ có thể thêm warning nếu có quan sát đủ, không bắt quyền cluster-admin để kiểm readiness index. ES _search trả HTTP200 nhưng timed_out=true hoặc shard failed>0 không được READY; default UNAVAILABLE/ES_QUERY_FAILED vì query không đủ độ tin cậy. Có dữ liệu cũ/replica cảnh báo mà query đầy đủ vẫn chạy thì DEGRADED nếu warning được chốt. Mapping cần giữ đúng predicate hiện hành, không tự sửa mapping trong probe.

`READY` của faiss ở đây là **read/search**, không phải ghi bền. Tương tự ES readable không bảo đảm writable/disk headroom. Indexing endpoint còn phụ thuộc tải ảnh allowlist, sync-state và persistence; contract v1 không phát `indexingReady=true` từ các probe đọc này. Hoàng cần theo dõi outbox backlog/error/last-success riêng; index count bằng nhau không chứng minh version/ID đầy đủ.

## 5. Khả năng phụ thuộc thành phần

| Capability | Cần kết quả còn hạn | Nếu ES hỏng |
|---|---|---|
| semanticText | clipText + faiss READY, dimension khớp | Có thể READY ở FastAPI /search/text; không tự suy Backend có route semantic public |
| imageSearch | clipImage (gồm decode probe) + faiss READY, dimension khớp | Có thể READY ở FastAPI /search/image |
| hybridText | elasticsearch + clipText + faiss READY, dimension khớp | UNAVAILABLE; implementation hiện tại không fallback |

Capability dùng `status` enum như component và `reasonCodes` allowlist. Không có dependency thiếu thì không tự UNAVAILABLE: dependency UNAVAILABLE -> UNAVAILABLE; không lỗi chắc nhưng có UNKNOWN/stale -> UNKNOWN; đủ READY/DEGRADED -> READY hoặc DEGRADED nếu dependency DEGRADED. Mismatch dimension đã biết -> UNAVAILABLE cho capability liên quan.

Đây là dự báo khả năng từ probe nhẹ, không phải đã chạy một truy vấn nghiệp vụ end-to-end/hydrate/đo chất lượng. RRF không có model cần tải; rrfK phải integer>=1 (không bool). Nếu process quan sát được cấu hình sai, hybrid UNAVAILABLE với `RRF_CONFIG_INVALID`, không ảnh hưởng semantic/image; không tạo component thứ năm. Config sai làm process không start thì Backend chỉ báo AI_UNREACHABLE/UNKNOWN theo quan sát, không đoán nội dung cấu hình từ lỗi mạng.

Nếu Hoàng cần tổng thể UI: giữ `apiReachability`/PostgreSQL và Search capabilities riêng; không ép mọi thứ vào một đèn. Tổng Search ở Backend: tất cả capabilities READY -> READY; còn ít nhất một READY **hoặc DEGRADED**, nhưng không phải tất cả READY -> DEGRADED (bao gồm cả ba DEGRADED); không capability usable và có UNKNOWN -> UNKNOWN; cả ba UNAVAILABLE -> UNAVAILABLE. Đây là aggregate khả dụng một phần, khác dependency rule: trong một capability, UNAVAILABLE đã biết ưu tiên hơn UNKNOWN/stale. Không thêm field overall vào envelope AI v1. Mỗi component vẫn giữ lỗi thật, không giấu ES đỏ dưới tổng vàng. Tổng Backend public Search phụ thuộc PostgreSQL+AI hybrid, không dùng tổng AI vàng để nhận public Search sẵn sàng.

## 6. Budget, cache và HTTP semantics đề xuất

Các số sau là proposal cần chốt, không phải cấu hình đã có:

- Background/single-flight probe mỗi30s, snapshot TTL60s, tối đa1 probe instance, không chồng nhiều lần refresh. Deep inference không chạy theo từng poll FE. GET trả cache sẵn nhanh, không chặn để warm-up, không retry tự động.
- ES toàn probe tối đa1500ms; mỗi CLIP tối đa2000ms; FAISS read tối đa500ms. Đây là **trần từng probe, không cộng thành SLA**. Cycle có hard deadline5000ms bằng monotonic clock, tính cả lock/queue/wait. Budget trước mỗi probe = min(trần probe, remaining cycle); không có remaining thì không dispatch. Có thể chưa đủ budget để chạy mọi thành phần, không nới deadline để lấy đủ kết quả.
- Probe chưa bắt đầu/inference chưa chạy vì lock/queue/cycle hết budget -> UNKNOWN với PROBE_BUSY hoặc NOT_CHECKED; không ghi checkedAt/duration như đã thực thi. Probe thực sự bắt đầu nhưng quá hạn -> UNKNOWN/PROBE_TIMEOUT, không kết luận model hỏng. Probe lỗi nghiệp vụ thực mới UNAVAILABLE với mã tương ứng. Trạng thái cũ đã hết hạn -> UNKNOWN/SNAPSHOT_STALE; lastSuccessAt chỉ giữ lịch sử.
- Inference/native search chạy trong thread không chắc hủy được bằng async timeout. Cycle kết thúc đúng deadline, nhưng single-flight giữ “còn chạy” tới khi native task thật kết thúc; không spawn probe/thread thay thế hoặc xếp hàng vô hạn, không giữ global lock trong endpoint HTTP. Completion muộn không sửa snapshot/checkedAt/expiresAt/lastSuccessAt và không phục hồi READY; cycle mới sau khi task cũ kết thúc mới được xuất quan sát mới. Trước implementation phải có test deterministic clock/barrier cho contention/hung task/late completion, không dùng chỉ sleep/Promise để tuyên bố deadline đã bảo đảm.
- Backend gọi AI snapshot: timeout2000ms, body tối đa32KiB, không redirect, không retry, URL từ cấu hình server đã kiểm; cache aggregate15s. Không gọi /search/hybrid để test bằng query khách hàng. FE polling30s, không POST “force/deep probe” từ browser.
- HTTP200 của snapshot endpoint nghĩa là **đã đọc được envelope**, không phải mọi component READY. Khi ES hỏng vẫn trả200 với ES/hybrid UNAVAILABLE để Backend hiển thị chi tiết. AI process không trả lời -> Backend tự tạo UNKNOWN component/capability, code AI_TIMEOUT/AI_UNREACHABLE, không giả snapshot mới của AI. Envelope sai -> AI_INVALID_RESPONSE. Mọi generatedAt/collectedAt do Backend sinh phải tách biệt mốc probe AI.
- Nếu có readiness endpoint cho orchestrator thì tách riêng với policy 200/503, không thay legacy /health. Chi tiết orchestrator ngoài scope bản đề xuất này. Endpoint Admin vẫn trả401/403 khi chưa đủ quyền; lỗi auth/database không được hạ bảo vệ chỉ để render health. FE nhận HTTP/auth lỗi thì hiển thị lỗi tải, không coi đó là “mọi dịch vụ đỏ” đã probe.
- Header Cache-Control:no-store cho response Admin và internal; server-side cache trong tiến trình có TTL riêng, không mâu thuẫn với no-store ở browser/proxy. Giữ key cache theo môi trường/process, không dùng cache response người dùng khác có PII.

Clock/freshness: Backend ghi collectedAt, so checkedAt/expiresAt AI và giới hạn TTL tối đa60s, reject timestamp tương lai lệch quá5s như AI_INVALID_RESPONSE/CLOCK_SKEW. Không tự sửa timestamp AI thành hiện tại. Nếu clock máy chưa đồng bộ, UNKNOWN + cảnh báo clock; không xanh giả.

## 7. Allowlist mã lỗi và cách FE hiển thị

| Nhóm | Mã đề xuất |
|---|---|
| chung | NOT_CHECKED, SNAPSHOT_STALE, PROBE_BUSY, PROBE_TIMEOUT, CLOCK_SKEW |
| CLIP | MODEL_NOT_LOADED, ENCODE_FAILED, INVALID_EMBEDDING, DIMENSION_MISMATCH |
| FAISS | INDEX_NOT_LOADED, INDEX_SEARCH_FAILED, INVALID_INDEX_RESULT |
| ES | ES_UNREACHABLE, ES_TIMEOUT, ES_AUTH_FAILED, ES_INDEX_MISSING, ES_MAPPING_INVALID, ES_QUERY_FAILED |
| cấu hình hybrid | RRF_CONFIG_INVALID |
| Backend khi gọi AI | AI_TIMEOUT, AI_UNREACHABLE, AI_INVALID_RESPONSE |
| warning | EMPTY_INDEX, ES_REPLICA_WARNING (chỉ khi được kiểm thật) |

Các lỗi probe không trả raw details. Mapping về câu tiếng Việt cố định tại Backend/FE; mã lạ hoặc shape sai -> UNKNOWN với AI_INVALID_RESPONSE. Backend log server theo correlationId không nhạy cảm, redact credential; không forward log ra FE. Response errorCode=null khi READY; warning không thay error. Thiếu kết quả lastSuccessAt không hiển thị ngày1970 hoặc “vừa kiểm xong”.

AI snapshot `errorCode` và capability `reasonCodes` dùng đúng enum gồm các mã
chung/CLIP/FAISS/ES/cấu hình hybrid trên, không chứa AI_TIMEOUT/AI_UNREACHABLE/
AI_INVALID_RESPONSE (đó là lỗi Backend gọi AI, ngoài envelope AI). reasonCodes
không trùng; UNKNOWN/UNAVAILABLE phải có lý do; READY/DEGRADED reasonCodes rỗng,
warning đọc ở component. Lý do capability phải có trong quan sát dependency,
hoặc DIMENSION_MISMATCH đã đối chiếu dimension, hoặc RRF_CONFIG_INVALID chỉ hybrid.

## 8. Kế hoạch kiểm thử trước nghiệm thu (tất cả NOT_RUN)

1. Legacy /health giữ nguyên envelope và status semantics; test contract cũ không hỏng.
2. Hai model tải được nhưng encode lỗi: loadedtrue, statusUNAVAILABLE đúng nhánh.
3. Text/image sai dimension/nonfinite/zero norm: reject; không giữ capabilityREADY.
4. FAISS không tải, search lỗi, emptyIndex sentinel, validhit/invalidID/NaN được phân biệt.
5. ES root200 nhưng index404; mapping sai;401/403;timeout;shardfailed/timed_out; cluster yellow nhưng query tốt; emptyindex.
6. ES outage không tô đỏ semantic/image FastAPI nếu probe đó tốt; hybrid/currentBackendSearch không xanh giả.
7. Fresh success -> failure giữ lastSuccessAt, không giữ READY; TTL hết và timestamp sai -> UNKNOWN; cache không dời checkedAt.
8. Concurrent GET không tăng số deep probe; hung native work không tạo thêm thread; lock contention không làm HTTP timeout hàng loạt.
9. HTTP200 chứa component fail vẫn hiển thị đúng; mất FastAPI/shape dư/thiếu/unknownenum/oversize không bị parse thành khỏe.
10. Guest/Buyer/Seller/nonactiveAdmin không đọc chi tiết; expiredAuth/DBdown không bypass guard.
11. Chụp network chứng minh probe không PUT/POST ghi index, không download externalimage, không thay FAISS/state/outbox; không tạo Product sentinel.
12. API_READY khác indexing writability/backlog và khác Precision/Recall; FE không gắn nhãn “đồng bộ xong” từ vectorCount.

Đây là test matrix runtime proposal, không phải kết quả đã chạy. Delta17/10 chỉ
có schema/contract tests và fixture, không mở dịch vụ/DB hoặc đo health live.
Test schema mới không thay 12 nhóm probe/auth/cache/scheduler runtime này.

## 9. Phân công và quyết định cần review

- Đạt: schema snapshot, probes/readiness của clipImage/clipText/faiss/ES; error allowlist, freshness/budget, tests AI. Không nhận dashboard doanh thu hoặc Admin RBAC thay Hoàng.
- Hoàng: chốt endpoint Backend Admin, activeAdmin/session validation, aggregation/caching/error mapping, PostgreSQL/outbox/dashboards và cách FE gọi; chốt internal auth/network cùng Đạt.
- Hiền: review semantics cho UI loading/unknown/stale/error/empty và acceptance; không gắn số liệu mẫu thành dữ liệu live.
- Hai bên phải duyệt tên endpoint, envelope/enum/HTTP semantics, auth, cache/budget, mappingread và readiness trước code. Sau thống nhất mở PR riêng, cập nhật docs/api/ai-service-contract.md cùng fixture/schema test mới. Không tự sửa contract chuẩn đang dùng, migration hoặc Product schema.

[JSON kèm theo](examples/search-health-proposed-v1.json) là **fixture thiết kế minh họa**, không kết quả health thật. Trạng thái ES lỗi để minh họa tổng degraded nhưng hybrid unavailable, semantic/image vẫn ready. Không đưa số fixture lên dashboard dưới nhãn live.


Nguồn chuẩn vẫn là [contract Backend–AI](ai-service-contract.md); phần mở rộng
health trong đó được gắn PROPOSED, không thay các endpoint đang chạy trước review.
Schema có thể tái sinh bằng `python scripts/export_search_health_schema.py` từ
AI_CLIP; [JSON Schema](examples/search-health-proposed-v1.schema.json) khớp model
`AI_CLIP/app/schemas/search_health_contract.py`. Pydantic strict/extra-forbid kiểm
đúng 4 component/3 capability, UTC millisecond, TTL<=60s, số hữu hạn, nullable
unknown khác0, tính nhất quán capability. SchemaVersion là integer1, không bool.
Không wiring model mới vào router/OpenAPI hiện hành trong PR này.

JSON Schema xuất chỉ mô tả cấu trúc; các ràng buộc timestamp/status/reason và
dependency liên trường do Pydantic validators thực thi, phải được Backend kiểm
tương ứng. Chạy lại exporter không nhất thiết đổi schema khi chỉ sửa validators.
