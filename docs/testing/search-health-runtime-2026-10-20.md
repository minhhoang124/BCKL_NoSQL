# AI Search health runtime — 20/10/2026

Branch `feat/dat/search-health-runtime`, base `develop 335b455`.
**IN_PROGRESS: AI implementation chờ review; chưa Backend/Admin UI/G-OPERATE DONE.**
Sau sync #70 ở32673c8, bổ sung sửa P2 kiểm khả năng query mapping: text cần index,
filter numeric/boolean cần index hoặc doc_values; full AI317PASS và16ca ES live.
[Red/green, cách tái lập và giới hạn](pr79-es-queryability-fix-2026-10-20.md).
Số280tests và smoke ban đầu bên dưới giữ provenance lịch sử, không thay bằng chứng mới.
Triển khai theo #61 đã merge `0aaaec2`, không đổi wire schema v1 hoặc payload
Product/search/index. Hoàng review Backend–AI, Hiền review cách biểu diễn trạng thái.

## Chạy và quan sát

1. Cài requirements AI như README; cấu hình model/cache và FAISS hợp lệ cho startup
   hiện hành. Model/artifact nằm ngoài Git; probe không tải hay sửa chúng.
2. Sinh secret ngẫu nhiên bằng công cụ quản lý secret, cấp `AI_INTERNAL_HEALTH_TOKEN`
   cho process AI. `.env.example` để trống có chủ đích: route trả503 và không chạy
   probes nếu chưa cấu hình. Không gửi secret trong URL, comment hoặc log.
3. Khởi động một worker Uvicorn như README. Từ Backend tin cậy gửi GET
   `/internal/health/search` với header `X-Internal-Health-Token` cùng secret.
   Dùng HTTP client nhận secret từ môi trường bí mật; không bật shell tracing.
4. GET trả cache ngay. Lúc đầu UNKNOWN/NOT_CHECKED, sau chu kỳ30s có observation.
   HTTP200 có thể chứa UNAVAILABLE/UNKNOWN; xem component/capability, không suy từ status HTTP.
5. Backend `/admin/system-health`, active Admin RBAC, timeout2s/body32KiB/cache15s
   và FE polling30s vẫn thuộc PR Hoàng/Hiền; browser không gọi AI trực tiếp.

Schema dùng đúng `SearchHealthSnapshot`, strict/extra-forbid. Transport thiếu
cấu hình503 INTERNAL_HEALTH_NOT_CONFIGURED; thiếu/sai/trùng header401
INTERNAL_HEALTH_UNAUTHORIZED, sanitized/no-store. Secret dùng SecretStr và
constant-time byte comparison. Legacy `/health` tiếp tục shape/status cũ.

## Cách thực thi

- Thứ tự ES → FAISS → text → image, tất cả dùng một deadline monotonic5s;
  cap1.5/0.5/2/2s chỉ là trần, probe cuối nhận phần thời gian còn lại.
- ES chỉ GET target `_mapping` rồi GET `_search` size1/track_total_hits;
  allow_no_indices=false/ignore_unavailable=false, không redirect/retry. Response
  mỗi request tối đa256KiB. Kiểm mapping hiện hành, timed_out/terminated_early,
  shard failure và shape/ID/score; không cluster-admin hoặc ensure_index.
- CLIP dùng object đã tải, chuỗi cố định và PNG1×1 qua ImageService thật; kiểm
  vector float shape(1,d), hữu hạn/norm>0. Image/text loaded riêng. Không lưu vector.
- FAISS lock/read count/dimension/search1 cùng snapshot; không clone/upsert/delete/save.
  Empty IndexFlatIP pad -FLT_MAX hoặc -inf với id=-1 hợp lệ; hit thật cần ID>0/score hữu hạn.
- Khóa CLIP/FAISS nonblocking; bận trả UNKNOWN/PROBE_BUSY, không giả timestamps mới.
  Native chạy daemon thread đơn lẻ từng lần, không threadpool/queue vô hạn. Khi
  timeout, cycle trả UNKNOWN; pending thật giữ single-flight tới native hoàn tất.
  Không dùng kết quả muộn để đổi observation/TTL/lastSuccessAt. Shutdown không join hung native.
- Background theo nhịp30s; GET chỉ copy/validate/cache snapshot, không lock native.
  TTL60s theo timestamps và monotonic age. Hết hạn cả success/failure thành
  UNKNOWN/SNAPSHOT_STALE, không đổi timestamps. Clock lùi không kéo dài tuổi quan sát;
  timestamps tương lai không hợp lệ được bỏ khỏi wire với UNKNOWN/CLOCK_SKEW,
  giữ nguyên lịch sử riêng trong collector, không dời thời gian để làm mới.
- lastSuccessAt giữ qua failure/timeout; dimension mismatch chỉ từ hai observation
  thành công còn hạn, ES failure chỉ chặn hybrid; RRF lỗi chỉ hybrid.

## Bằng chứng tự động

Lệnh từ AI_CLIP (venv Python3.12 hiện có, không đổi dependencies):

```sh
python -m ruff check app tests scripts
python -m pytest -q
python scripts/export_search_health_schema.py
git diff --check
```

48 ca runtime mới gồm probe validation, real FAISS, ES MockTransport,
clock/barrier/deadline/scheduler/auth/cache và100GET đồng thời. Model unit là
stub encode, không nhận là CLIP inference thật. ES fault cases dùng MockTransport,
không nhận là lỗi network thật. Các test timing dùng clock/barrier kiểm dispatch,
remaining budget, late completion và single-flight; không lấy sleep chọn winner.
Thay test cũ “contract không cài route” bằng assert OpenAPI schema mới + legacy route:
đó là thay đổi được yêu cầu khi chuyển từ contract-only sang implementation.

Kết quả bản cuối local: full AI **280/280 PASS**, 5 dependency deprecation
warnings; Ruff app/tests/scripts PASS; exporter chạy và JSON Schema giữ nguyên
byte; diff-check PASS. Không chạy lại FE/BE tests local cho diff chỉ AI/docs/config.
CI đúng head theo dõi trên PR, không lấy CI develop làm kết quả branch mới.
Môi trường local: Python3.12.14, FastAPI0.141.1, Pydantic2.13.5, httpx0.28.1,
sentence-transformers5.7.0, torch2.14.0, faiss-cpu1.12.0, numpy2.5.3,
pytest9.1.1, Ruff0.16.6. Đây là môi trường sẵn có; requirements không đổi.

## Smoke thật local

20/10/2026, CPU/OMP_NUM_THREADS1, HF_HUB_OFFLINE=1/TRANSFORMERS_OFFLINE=1.
Hai model nạp bằng cache snapshot path thực, không gọi Hub trong probe:

- image revision `327ab6726d33c0e22f920c83f2ff9e4bd38ca37f`;
- text revision `58edf8cada9e398793dca955574a48cbb7f18be2`.

FAISS IndexIDMap2/FlatIP512 tạm rỗng; Elasticsearch8.19.21 container riêng
loopback19220/index QA riêng rỗng. Harness setup tạo index ES ngoài lượt probe;
probe trace chỉ hai GET mapping/search. Một cycle cho cả3capability READY,
FAISS/ES READY+EMPTY_INDEX; không Product sentinel hoặc corpus đánh giá.
Đo tại02:51:59–02:52:00UTC (09:51:59–09:52:00giờ VN): ES14.84ms,
FAISS3.11ms, text379.77ms, image767.90ms. Đây là một smoke run, không p95/SLA.
HTTP route qua ASGI:401 khi thiếu token,200 khi token đúng, no-store/body1297bytes;
GET không tăng trace probe. FAISS file hash giữ nguyên, không tạo state file;
ES mapping không đổi, count0→0. Không dùng dữ liệu/DB/index demo.
Container Elasticsearch QA đã dừng sau smoke, không xóa dữ liệu demo.

## Phạm vi còn lại

- Chưa Uvicorn socket/Backend Admin/FE integration hoặc RBAC user qua Backend;
  không chuyển cả12nhóm proposal thành PASS từ test AI. Auth nội bộ được kiểm;
  guest/Buyer/Seller/inactive Admin vẫn phải được Hoàng kiểm ở Backend.
- Chưa live outage/shard faults, multi-process/kill OS hoặc stress. Một worker
  vẫn bắt buộc; native giữ GIL/lỗi OS có thể trì hoãn event loop, asyncio timeout
  không phải cơ chế preempt native. Native kẹt giữ single-flight tới khi kết thúc
  hoặc process được vận hành khởi động lại; không cố giết thread.
- Readiness đọc khác writable/persistence, outbox backlog/ID/version sync và
  chất lượng retrieval. Không tính/công bố Precision/Recall từ các probe này.
- Snapshot codec giữ nguyên cấu trúc đã duyệt; Backend vẫn phải kiểm cross-field
  semantics, freshness và bounded transport. CI và approval phải kiểm đúng commit PR.
