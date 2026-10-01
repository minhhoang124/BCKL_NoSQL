# Kiểm tra khả năng tái lập PR 8

Ngày kiểm tra: 29/09/2026
Nhánh: `feat/dat/ai-fastapi-service`
Commit kiểm tra: `333b33080711b6be6eccac3b99ff2bb559aac60e`
Trạng thái: **IN_PROGRESS**, PR #8 chưa merge.

## Kết luận

Search Service có thể cài đặt và chạy lại từ một checkout sạch bằng Python
3.12.14. Gói FAISS bàn giao nạp được 86 vector và giữ đúng tập `productId` số
nguyên trong metadata. FastAPI chạy được với model lấy từ cache cục bộ;
Elasticsearch 8.19.21 chạy bằng Docker và `/search/hybrid` trả kết quả RRF.

Phép thử này chưa phải Web Search end-to-end. Backend outbox, PostgreSQL hydrate
và React chưa được chạy chung trong lượt kiểm tra này. Precision/Recall cũng chưa
được thực hiện.

## Môi trường sạch

- Clone cục bộ mới, detached tại commit `333b330`.
- Tạo virtual environment mới bằng Python 3.12.14.
- Cài lại toàn bộ `AI_CLIP/requirements.txt` từ package registry.
- Không dùng `.venv` của checkout làm việc.
- Dùng Elasticsearch 8.19.21 trong container tạm, security tắt cho smoke test.

Kết quả kiểm tra mã nguồn:

- Ruff: đạt.
- Pytest: `129 passed`, có 4 warning từ dependency.
- CI được ghi nhận theo bằng chứng dự án: CI #128 đạt.

## Gói FAISS 86 sản phẩm

Gói kiểm tra nằm ngoài Git tại `AI_smoke86_handoff_20260920`. Script
`AI_CLIP/scripts/verify_handoff_bundle.py` xác minh thành công:

```text
Verified FAISS handoff: 86 vectors, purpose=SMOKE_NON_PRODUCTION
```

Kiểm tra trực tiếp index và metadata cho kết quả:

- Index: `IndexIDMap2` trên `IndexFlatIP`.
- Số vector: 86.
- Số chiều: 512.
- Có 86 `productId` duy nhất, đều là số nguyên dương.
- Tập ID trong FAISS khớp chính xác tập `productId` trong
  `smoke86_metadata.json`.
- Ảnh `abo:B0050SXMNE` trả `productId=58` ở hạng 1.
- Ảnh `abo:B07MJKKS5T` trả `productId=125` ở hạng 1.

Hai ảnh trên là catalog self-match, chỉ xác minh mapping và khả năng nạp index.
Không dùng chúng để kết luận Precision/Recall hoặc chất lượng tìm kiếm tổng quát.

## Biến môi trường và FastAPI

Các biến đã dùng:

```text
HF_HUB_OFFLINE=1
OMP_NUM_THREADS=1
AI_FAISS_INDEX_PATH=<bundle>/artifacts/smoke86.faiss
AI_FAISS_STATE_PATH=<bundle>/artifacts/faiss_state.json
AI_PRODUCT_SYNC_STATE_PATH=<bundle>/artifacts/product_sync_state.json
AI_IMAGE_URL_ALLOWED_HOSTS=127.0.0.1,localhost
AI_ELASTICSEARCH_URL=http://127.0.0.1:19218
AI_ELASTICSEARCH_INDEX_NAME=products-pr8-repro
AI_DEVICE=cpu
AI_SERVER_WORKERS=1
```

FastAPI khởi động thành công với đúng một worker. `/health` trả:

```json
{"status":"ok","modelLoaded":true,"indexLoaded":true,"vectorCount":86}
```

Khi Elasticsearch chưa chạy, `/search/hybrid` trả HTTP 503 và mô tả lỗi kết
nối. Khi Elasticsearch 8.19.21 chạy và index tạm đã được tạo, hybrid search trả
HTTP 200; query `tai nghe có dây USB` đưa `productId=58` lên hạng 1 bằng RRF.

## Thành phần ngoài GitHub

Repository chỉ giữ `AI_CLIP/artifacts/.gitkeep`. Máy mới phải có hoặc tải thêm:

1. Gói `AI_smoke86_handoff_20260920`, gồm FAISS index, metadata, state và hai ảnh
   smoke. Manifest của gói được tạo ở commit `9b754fb`, cũ hơn head `333b330`;
   script verify tại head hiện tại vẫn xác minh được gói.
2. Model `sentence-transformers/clip-ViT-B-32` và
   `sentence-transformers/clip-ViT-B-32-multilingual-v1`. Gói bàn giao không chứa
   model weight. Máy mới cần Internet lần đầu hoặc cache Hugging Face tương ứng.
3. Python packages trong `requirements.txt`. Cài sạch cần truy cập package
   registry và tải các dependency ML lớn.
4. Docker image Elasticsearch 8.19.21 nếu máy chưa có sẵn.
5. Mapping gốc `externalId -> productId`, dataset ABO lớn và secret không nằm
   trong gói bàn giao.

## Giới hạn trạng thái

- PR #8: **IN_PROGRESS**, chưa merge.
- PR #23: đã được Đạt approve tại `2a9e388`, nhưng vẫn **IN_PROGRESS** vì chưa
  merge.
- Web Search end-to-end: chưa hoàn thành.
- Precision/Recall: chưa chạy và không được ghi là hoàn thành.
- Gói 86 sản phẩm: `SMOKE_NON_PRODUCTION`, không phải index public/production.
