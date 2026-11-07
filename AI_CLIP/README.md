# AI Service

## Health nội bộ — nhánh triển khai 20/10/2026

`GET /internal/health/search` dùng contract #61 đã duyệt. Cấu hình riêng
`AI_INTERNAL_HEALTH_TOKEN` qua môi trường bí mật; Backend sau này dùng cùng giá trị
ở `SEARCH_INTERNAL_HEALTH_TOKEN`. Không dùng token người dùng hoặc giá trị mẫu trong Git.
Thiếu cấu hình trả503; thiếu/sai/trùng header `X-Internal-Health-Token` trả401.
Mọi phản hồi route mới có `Cache-Control:no-store`. Không thay auth các route cũ.

Scheduler bắt đầu sau startup khi có token, mỗi30s; GET đọc cache, không force
inference. Snapshot đầu có thể UNKNOWN; HTTP200 chỉ nghĩa là envelope đọc được.
TTL60s, cycle5s, cap ES1.5s/FAISS0.5s/mỗi CLIP2s; native quá hạn vẫn giữ
single-flight tới khi kết thúc, không cập nhật từ kết quả muộn. Index rỗng hợp
lệ trả READY + EMPTY_INDEX, không phải bằng chứng đã đồng bộ dữ liệu.

Nhánh này **IN_PROGRESS/chờ review**, chưa nối Backend/Admin UI. Những mốc PR#8
và số129tests bên dưới là lịch sử. Xem [báo cáo health runtime](../docs/testing/search-health-runtime-2026-10-20.md)
để chạy, kiểm chứng và hiểu phạm vi thực sự đã kiểm.

FastAPI service cho CLIP, FAISS và các chức năng tìm kiếm của đề tài.

## Trạng thái

Phần khởi động Giai đoạn 2 đã có:

- Cấu trúc ứng dụng tách router, schema và service.
- `GET /health` để kiểm tra tiến trình AI Service.
- Swagger tại `/docs` và OpenAPI tại `/openapi.json`.
- Cấu hình qua biến môi trường có tiền tố `AI_`.
- Tự nạp hai model CLIP và FAISS index khi service khởi động.
- Kiểm tra số chiều của model và index trước khi nhận request.
- Giới hạn OpenMP một luồng để tránh xung đột PyTorch/FAISS trên macOS.
- `POST /search/text` để tìm kiếm ngữ nghĩa bằng văn bản.
- `POST /search/image` để nhận ảnh JPEG/PNG, tạo vector CLIP và tìm ứng viên
  gần nhất trong FAISS.
- `POST /search/hybrid` lấy ứng viên keyword từ Elasticsearch và semantic từ
  CLIP/FAISS, áp cùng bộ lọc lên cả hai nhánh trước khi xếp hạng bằng RRF.
- `POST /index/product` để thêm mới hoặc cập nhật vector của một sản phẩm.
- `POST /index/products` tạm vô hiệu hóa cho tới khi chốt contract batch hai index.
- `DELETE /index/product/{productId}?version=...` để xóa vector sản phẩm.
- Ghi FAISS index và trạng thái phiên bản xuống đĩa bằng cách thay file nguyên tử.
- Bỏ qua sự kiện cũ hoặc gửi lại nhờ cặp `productId` + `version`.
- Test nền móng không cần tải model CLIP.

`POST /index/product` và `DELETE /index/product/{productId}` hiện đồng bộ cả
Elasticsearch lẫn FAISS. Service lưu version, operation, fingerprint và trạng
thái riêng của từng index để xử lý `STALE`, `NOOP`, `VERSION_CONFLICT`, lỗi một
phần và retry cùng event mà không ghi trùng vector. `/search/hybrid` đã hợp nhất
nhánh keyword Elasticsearch và semantic CLIP/FAISS bằng RRF, đồng thời áp dụng
filter category, brand, giá và tồn kho trước khi xếp hạng.

Các luồng trên đã được kiểm thử tự động và chạy smoke test với Elasticsearch
8.19.21 thật. Tuy nhiên đây vẫn là trạng thái **IN_PROGRESS** của PR #8: Backend
outbox chưa gọi FastAPI end-to-end, Backend chưa hydrate kết quả từ PostgreSQL
trên giao diện Web và bộ ground truth độc lập chưa được dùng để công bố
Precision@K/Recall@K. `POST /index/products` vẫn tạm vô hiệu hóa cho tới khi
Hoàng–Đạt chốt envelope batch. Địa chỉ và tên index Elasticsearch cấu hình bằng
`AI_ELASTICSEARCH_URL` và `AI_ELASTICSEARCH_INDEX_NAME`; hằng số RRF dùng
`AI_RRF_K` (mặc định 60).

## Cài đặt

Yêu cầu Python 3.11 trở lên.

```bash
cd AI_CLIP
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Chạy service

```bash
cd AI_CLIP
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Hiện tại chỉ chạy **một Uvicorn worker**. Trạng thái đồng bộ và khóa theo sản phẩm
được giữ trong một tiến trình; không chạy `uvicorn --workers 2` (hoặc nhiều hơn).
Biến `AI_SERVER_WORKERS=1` không tự phát hiện số worker truyền trực tiếp qua CLI.
`POST /index/products` tạm trả HTTP 501 với mã `BATCH_INDEXING_NOT_SUPPORTED` để
tránh ghi riêng vào FAISS. Dùng `POST /index/product` cho từng sản phẩm cho đến khi
batch hai chỉ mục và response riêng từng sản phẩm được thống nhất, triển khai và kiểm thử.

Mở:

- Health: http://127.0.0.1:8000/health
- Swagger: http://127.0.0.1:8000/docs

Trong Swagger, dùng `POST /search/image`, bấm **Try it out**, chọn ảnh JPEG/PNG
tối đa 5 MB rồi bấm **Execute**. `topK` là số kết quả cuối Backend cần;
`candidateK` là số ứng viên FAISS trả về trước khi Backend kiểm tra dữ liệu hiện
hành. Nếu bỏ trống `candidateK`, service tự tính
`min(max(topK * 3, 30), 150)`.

Ngoài giới hạn dung lượng, service mặc định giới hạn ảnh ở 25 triệu pixel để
tránh ảnh nén bất thường làm cạn bộ nhớ. Có thể cấu hình bằng
`AI_MAX_IMAGE_BYTES` và `AI_MAX_IMAGE_PIXELS`.

Bản hiện tại của `/search/image` chỉ hỗ trợ `image`, `topK` và `candidateK`;
chưa áp dụng bộ lọc category/brand. Backend vẫn phải loại sản phẩm ẩn, chưa duyệt
hoặc không còn hợp lệ bằng dữ liệu PostgreSQL.

## Cập nhật FAISS theo sản phẩm

Thêm hoặc cập nhật một sản phẩm bằng `POST /index/product`:

```json
{
  "productId": 125,
  "version": 3,
  "externalId": "abo:B003MAJHB8",
  "name": "Wireless Bluetooth Headphones",
  "description": "Over-ear wireless headphones",
  "categoryId": 12,
  "categoryName": "Headphones",
  "categoryPathIds": [1, 5, 12],
  "brandId": 8,
  "brandName": "Sony",
  "imageUrls": ["http://backend:3001/uploads/products/125/1.jpg"],
  "minPrice": "1290000.00",
  "maxPrice": "1590000.00",
  "inStock": true,
  "attributes": {"color": ["Black"], "connectivity": ["Bluetooth"]}
}
```

Service tải ảnh đầu tiên trong `imageUrls`, dùng CLIP tạo vector và cập nhật
Elasticsearch cùng FAISS theo `productId`/`version`. Nếu một chỉ mục lỗi,
response HTTP 503 ghi trạng thái từng chỉ mục để Backend retry cùng event.
Batch chưa hỗ trợ; Backend gọi `POST /index/product` lần lượt cho từng sản phẩm.

Xóa sản phẩm:

```text
DELETE /index/product/125?version=4
```

Version khi xóa được giữ lại như một tombstone để sự kiện cập nhật cũ không thể
vô tình đưa sản phẩm đã xóa trở lại FAISS. Cách truyền `version` bằng query
parameter đã được ghi trong contract; DELETE cũng trả trạng thái hai chỉ mục.

Backend chỉ retry khi FastAPI trả HTTP 503 và phải gửi lại nguyên
`productId/version/operation/payload`. FastAPI không tự retry request ghi sang
Elasticsearch vì retry ở hai lớp làm mờ trạng thái từng index. Timeout tải ảnh
và Elasticsearch cấu hình bằng `AI_IMAGE_DOWNLOAD_TIMEOUT_SECONDS` và
`AI_ELASTICSEARCH_TIMEOUT_SECONDS`; cả hai phải lớn hơn 0 và không quá 60 giây.

Vì service chủ động tải ảnh từ URL do Backend gửi, mặc định chỉ các host
`backend`, `localhost`, `127.0.0.1` và `::1` được phép. Cấu hình thêm bằng biến
`AI_IMAGE_URL_ALLOWED_HOSTS`, liệt kê host cách nhau bằng dấu phẩy. Chỉ hỗ trợ
ảnh JPEG/PNG, tối đa 5 MB và không tự đi theo redirect.
Backend hiện dùng cổng **3001**. Nếu FastAPI trong Docker gọi Backend đang chạy
trên máy, cấu hình allowlist thêm `host.docker.internal`; không hard-code URL
hoặc giả định service `backend` đã tồn tại trong Docker Compose.

Khi nạp artifact mẫu thành công, Health trả:

```json
{
  "status": "ok",
  "modelLoaded": true,
  "indexLoaded": true,
  "vectorCount": 1200
}
```

## Kiểm tra

```bash
cd AI_CLIP
ruff check app tests
pytest
```

Trạng thái kiểm tra gần nhất trên nhánh PR #8:

- Ruff: đạt.
- Pytest: **129 passed**.
- Smoke test Elasticsearch thật: keyword/filter, RRF hybrid, đồng bộ hai index,
  version/idempotency và retry sau lỗi một phần đều đạt.
- Gói FAISS 86 sản phẩm dùng `productId` PostgreSQL thật đã chạy được trên máy
  Hoàng; hai ảnh catalog kiểm tra đều self-match đúng ID ở hạng 1.

Các kết quả trên chứng minh Search Service chạy độc lập và có thể tích hợp;
chúng chưa chứng minh luồng Web end-to-end hoặc chất lượng tìm kiếm trên query
độc lập.

Các payload chuẩn khóa contract nằm trong `tests/fixtures/backend_contract/`.
`tests/test_backend_contract.py` kiểm tra request index, filter hybrid, response
đồng bộ và response tìm kiếm, gồm decimal giá, trường dư, khoảng giá và điều kiện
`candidateK >= topK`. Đây là contract test phía FastAPI; Backend vẫn phải dùng
cùng fixture hoặc chạy test HTTP xuyên dịch vụ trước khi gọi tích hợp là hoàn tất.

## Artifact

`AI_CLIP/artifacts/` dùng cho embedding, FAISS index và mapping khi chạy local.
Nội dung thư mục này không được commit; chỉ `.gitkeep` được giữ để tạo cấu trúc.
File `faiss_state.json` được tạo lúc API index chạy để lưu version/tombstone và
cũng không được commit.

Tạo lại artifact từ bộ mẫu local:

```bash
cd AI_CLIP
.venv/bin/python scripts/encode_products.py \
  --metadata ../datasets/processed/abo_electronics_1200.csv \
  --embeddings-out artifacts/image_embeddings.npy \
  --metadata-out artifacts/products_metadata_clean.csv

.venv/bin/python scripts/build_faiss_index.py \
  --embeddings artifacts/image_embeddings.npy \
  --metadata artifacts/products_metadata_clean.csv \
  --index-out artifacts/products.faiss \
  --mapping-out artifacts/products_mapping.json
```

Dataset điện tử và script của Giai đoạn 1 được mô tả tại
`datasets/abo-electronics.md`.

## Smoke test xây lại FAISS từ mapping `externalId → productId`

`scripts/rebuild_faiss_from_abo.py` nhận `products.jsonl`, thư mục ảnh và file mapping
JSONL (`--mapping-jsonl` dạng `{"externalId": "...", "productId": 58}`) hoặc CSV
(`--mapping-csv` có header `externalId,productId`). Script tự động nhận diện định dạng,
kiểm tra ID nguyên dương/duy nhất, ảnh hợp lệ, rồi tạo FAISS `IndexIDMap2` với
**productId từ file mapping**. Nếu truyền file QA có cột `externalId,status`, các dòng
`LOẠI` được bỏ qua. Tuyệt đối không tự sinh ID hay lấy số thứ tự prototype 1–1200.

Ví dụ chạy với mapping JSONL (chọn tên output chưa tồn tại trong `artifacts/`):

```bash
cd AI_CLIP
export OMP_NUM_THREADS=1
export HF_HUB_OFFLINE=1
.venv/bin/python scripts/rebuild_faiss_from_abo.py \
  --products-jsonl ../datasets/processed/abo_dataset_review_1200/products.jsonl \
  --images-dir ../datasets/processed/abo_dataset_review_1200 \
  --mapping-jsonl /path/to/mapping.jsonl \
  --index-out artifacts/smoke-new.faiss \
  --metadata-out artifacts/smoke-new.json
```

Ví dụ chạy với CSV:

```bash
cd AI_CLIP
export OMP_NUM_THREADS=1
.venv/bin/python scripts/rebuild_faiss_from_abo.py \
  --products-jsonl ../datasets/processed/abo_dataset_review_1200/products.jsonl \
  --images-dir ../datasets/processed/abo_dataset_review_1200 \
  --mapping-csv artifacts/test_mapping.csv \
  --index-out artifacts/smoke-new.faiss \
  --metadata-out artifacts/smoke-new.json
```

Script từ chối ghi đè output đã tồn tại. Nó **chỉ** tạo artifact
`SMOKE_NON_PRODUCTION`, kể cả khi mapping chứa ID PostgreSQL thật; không dùng
output này làm index công khai. Bản dataset sạch, mapping chính thức và quy trình
xuất bản index an toàn vẫn chờ bàn giao/kiểm thử tích hợp. File `.faiss`, metadata
sinh ra, mapping JSONL/CSV và ảnh local không được commit. Nếu model đã có trong
cache nhưng máy không có mạng, thêm `HF_HUB_OFFLINE=1` trước lệnh Python để bỏ bước
kiểm tra Hugging Face Hub.

## Kiểm tra gói bàn giao FAISS 86 sản phẩm

Gói 86 sản phẩm là artifact bàn giao ngoài Git và phải có `manifest.json`. Sau
khi giải nén, kiểm tra SHA-256 và số vector trước khi chạy:

```bash
cd AI_CLIP
.venv/bin/python scripts/verify_handoff_bundle.py /path/to/AI_smoke86_handoff_20260920
```

Kết quả hợp lệ là
`Verified FAISS handoff: 86 vectors, purpose=SMOKE_NON_PRODUCTION`. Sau đó đặt
`AI_FAISS_INDEX_PATH`, `AI_FAISS_STATE_PATH` và
`AI_PRODUCT_SYNC_STATE_PATH` theo README trong gói, chạy đúng một Uvicorn worker,
rồi kiểm tra `/health` có `vectorCount=86`. Gói không chứa model weight; máy mới
cần tải model một lần hoặc có cache tương ứng. Hai ảnh catalog chỉ là smoke
self-match để xác nhận mapping `productId`; không được dùng để kết luận
Precision@K/Recall@K.
