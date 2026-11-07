# Chuẩn bị tích hợp Checkout → Search — issue #32

Ngày 07/10/2026. Đạt phụ trách Search; Hoàng phụ trách fixture/Checkout/DB/worker.
Baseline Backend `6663fab`, thiết kế [PR #29 tại 6cbaeb1](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29),
[contract AI](../api/ai-service-contract.md). **PREPARATION, CHK-S01–S04 NOT_RUN.**
Checkout chưa có controller trên baseline. Công cụ dưới đây chỉ kiểm tra nền;
unit test của công cụ không phải integration test. Không dùng corpus evaluation 86
hoặc file FAISS evaluation để thử mutation; không tính Precision/Recall ở task này.

## 1. Môi trường riêng và preflight

Mỗi run dùng một runId, DB `bckl_chk_search_<runId>`, Elasticsearch index
`chk-search-<run-id>`, thư mục artifacts/uploads mới và cổng riêng (gợi ý Backend
3301, AI 8108, Elasticsearch 19228). Hoàng tạo DB test, deploy toàn bộ migration
từ commit implementation và tạo fixture; không deploy vào `klcn_ecommerce` demo.
FAISS bắt đầu trống và chỉ chứa Product fixture, dimension 512, một AI worker.
Model/cache có thể dùng cache đã kiểm hash/revision; artifacts trạng thái phải riêng.

Backend: DATABASE_URL đúng DB test (không đưa secret vào log); BACKEND_PORT=3301,
UPLOAD_ROOT riêng, AI_SERVICE_URL=http://127.0.0.1:8108,
SEARCH_SYNC_ENABLED=false và SEARCH_RECONCILIATION_ENABLED=false. Kiểm lại tên
cấu hình reconciliation trên commit chạy; tắt cron theo setup E2E hiện có.
Chỉ gọi SearchSyncWorker.runBatch từ harness Nest/Prisma thuộc DB test khi cần;
không thêm endpoint public để bật worker/fault. Không mock fetch Backend–FastAPI.

AI: AI_SERVER_WORKERS=1, AI_FAISS_INDEX_PATH, AI_FAISS_STATE_PATH,
AI_PRODUCT_SYNC_STATE_PATH trỏ thư mục run; AI_ELASTICSEARCH_URL=http://127.0.0.1:19228,
AI_ELASTICSEARCH_INDEX_NAME=chk-search-<run-id>, AI_RRF_K=60,
AI_IMAGE_URL_ALLOWED_HOSTS khớp Backend fixture. URL ảnh phải đọc được từ process AI.
Ghi model/revision thực đã nạp, không chỉ tên model hoặc cache ref chưa đối chiếu.

Sau khi khởi động Backend/AI/ES và tạo mapping index theo service hiện có, tại root:

```bash
python3 AI_CLIP/scripts/checkout_search_preflight.py \
  --backend http://127.0.0.1:3301 \
  --ai http://127.0.0.1:8108 \
  --elasticsearch http://127.0.0.1:19228 \
  --index chk-search-run-20261007
```

Chỉ GET, timeout 5s/probe, từ chối redirect và URL ngoài loopback. Exit 2 = BLOCKED;
exit 0 = PROBES_READY, **integrationStatus luôn NOT_RUN**. Chưa kiểm DB, cấu hình
process, model revision hoặc tính đúng route chỉ từ OpenAPI. Cần thu riêng migration
status/DB identity, runtime config đã che secret và snapshot artifacts.

## 2. Fixture và thao tác chung

Hoàng tạo Buyer USER active, Seller khác Buyer, Store ACTIVE, Category lá/Brand
active, Product ACTIVE/APPROVED với ảnh chính/thuộc tính/shipping đủ public policy.
Product A có hai Variant hiển thị hợp lệ: A1 giá 100000 stock=1, A2 giá 200000
stock=1. Product B: B1 giá 100000 stock=0, B2 giá 300000 stock=1. ID do PostgreSQL
sinh, ghi manifest; không hard-code ID catalog. Dùng tên/query chứa runId để truy vết.

Đồng bộ baseline bằng outbox/worker thật và xác nhận A/B có mặt trong candidates
FastAPI trước test. Kết quả search có thể không đầy topK; để chứng minh hydrate,
phải có capture FastAPI chứa ID trước khi Backend loại ID. Không kết luận từ list
rỗng nếu không biết fixture từng là candidate. Backend nhận filter ở cấp gốc;
FastAPI nhận cùng filter bên trong `filters`. Giá index là chuỗi, giá filter là number.

Chuẩn bị Address/Cart qua API thật; quantity Checkout phải bằng CartItem. Body
preview/create theo contract #29. Giữ key/body gốc khi replay. Fixture không phải
ground truth; không dùng rank/self-match để kết luận chất lượng retrieval.

## 3. Các ca chạy khi Checkout sẵn sàng

| Ca | Thao tác có kiểm soát | Assertion/bằng chứng |
|---|---|---|
| CHK-13 | Mua A1; sau đó mua A2; thêm subcase mua hai Variant cùng request | Mỗi commit tăng đúng một version/event mỗi Product; giá 100000/200000 vẫn từ toàn bộ Variant hiển thị, inStock true rồi false; APPROVED giữ nguyên; payload.version=event.version |
| CHK-S01 | Dừng cron; index baseline còn cũ; checkout mua hết A; gọi FastAPI và Backend filter inStock=true | Capture FastAPI còn trả A; Backend loại A theo DB. Không stock filter: A vẫn public nếu được trả làm candidate. Query B giá 90000–110000 + stock=true phải bị hydrate loại vì không có cùng Variant đạt cả giá/kho |
| CHK-S01 catch-up | Chạy runBatch thuộc harness, đợi có deadline; ES refresh bằng client kiểm thử rồi query lại | DB outbox SUCCEEDED; ES version/inStock đúng, durable sync-state ES/FAISS đúng version; FAISS ID A xuất hiện đúng một lần. Không giả định FAISS lưu metadata stock trong vector |
| CHK-S02 | Chỉ ES cô lập bị ngắt sau commit, FastAPI/FAISS vẫn chạy; worker gửi event thật | Order/stock vẫn commit; HTTP 503 PARTIAL_FAILURE, FAISS thành công/ES FAILED; outbox chưa SUCCEEDED. Nếu FAISS cũng lỗi thì ca không đạt điều kiện partial, phải điều tra |
| CHK-S02 retry | Khôi phục ES, giữ nguyên event; chờ nextAttemptAt hoặc dùng clock test-only trong harness DB riêng | Payload hash/operation/productId/version không đổi, attemptCount tăng; FAISS ALREADY_APPLIED, ES SUCCEEDED; event hoàn tất; ID/vectorCount không nhân đôi. Thử replay Checkout: không version/event/movement mới |
| CHK-S03 | Harness giữ event vN; cho vN+1 từ checkout khác commit và đồng bộ trước; sau đó giao vN bằng worker thật | HTTP 200 outcome STALE khớp ID/version/operation; vN outbox hoàn tất theo semantics worker; ES/sync-state/FAISS snapshot không bị vN ghi đè. STALE không bắt buộc hai index status SUCCEEDED ở version event cũ |
| CHK-14 | Hoàng inject lỗi DB tại writeOutboxEvent trong transaction test-only | Snapshot stock/version/Cart/Checkout/Order/Item/Payment/history/movement/outbox trở về trước request; không chỉ kiểm HTTP lỗi. Bỏ fault rồi cùng key/body thành công; replay không mutation |
| CHK-S04 | Chờ PR Order/cancel | NOT_RUN/DEFERRED; không nghiệm thu bằng sửa stock SQL trực tiếp |

Fault ES dùng container/proxy riêng, giữ cùng AI process để FAISS không mất context;
không thay HTTP response bằng mock. Giữ trace request/response giữa worker–AI đã
che secret (proxy pass-through hoặc log test-only), không chỉ chụp health.
runBatch không có public filter event: dùng DB chỉ có fixture của run; khi kiểm
reordering Hoàng điều khiển nextAttemptAt/clock bằng harness test-only và ghi rõ
trình tự. Không sửa payload hay reset delivery state của event đã được giao.
Poll tối đa 90s/lần trong harness với timeout mỗi request; nếu vượt backoff hiện có,
đánh dấu BLOCKED/TIMEOUT và chạy tiếp theo lịch retry, không lặp vô hạn hoặc báo PASS.

## 4. Bằng chứng cần bàn giao

Thư mục ngoài Git theo runId gồm:

- manifest: Backend/AI SHA, schema migration list, UTC start/end, OS/Python/Node/ES,
  model IDs + revisions thực, runtime rrfK/candidateK/topK, DB/index/artifact identity,
  runId và fixture IDs; không credential/JWT/raw key/PII.
- Snapshot DB trước commit/sau commit/trước retry/sau retry và hash payload outbox;
  dùng transaction read-only để snapshot nhất quán. Hoàng xuất aggregate/fixture
  rows allowlist, không dump toàn database.
- Checkout/replay/hybrid requests-responses đã che auth/key, worker delivery trace,
  ES document + version, product_sync_state và bản sao FAISS khi process quiescent.
  Dùng faiss.vector_to_array(index.id_map) kiểm ID/duplicate; ghi dimension/count.
  Snapshot trước/sau STALE cần quiescent để hash không đổi có ý nghĩa.
- Từng ca: NOT_RUN/BLOCKED/FAIL/PASS, assertion quan sát, file bằng chứng và SHA-256.
  Thiếu capture một tầng không được nâng thành PASS toàn chuỗi. Kết quả retry/fault
  không thay cho test rollback DB; health không chứng minh ES sẵn sàng.

Cleanup chỉ IDs/DB/index/path đúng run sau khi lưu bằng chứng; không recursive delete
workspace hoặc artifacts evaluation. Owner xác minh đích trước cleanup. DB test có
thể giữ lại để review. Chưa cung cấp runner Checkout tự động vì API/fixture/fault
hook chưa có; Hoàng nối harness Nest khi PR implementation xuất hiện, Đạt kiểm các
capture Search và chạy assertions trên index thật.
