# Chạy lại Search thật trên QA riêng

Đây là kiểm thử tích hợp cục bộ, không phải benchmark, giao diện Web hoặc Docker
toàn hệ thống. Không sửa runtime/schema/contract. Tham chiếu #32, #102, #103;
[kết quả 23/10](search-live-2026-10-23.md).

## Điều kiện và ranh giới

- Docker đang chạy; Node24/pnpm theo lockfile; Python3.12 với dependency trong
  `AI_CLIP/requirements.txt`. Cài frozen Node dependency trong **checkout nguồn**.
  Python requirements hiện có khoảng phiên bản, chưa là lock đầy đủ: muốn tái
  lập đúng môi trường reviewer, đối chiếu bảng version trong báo cáo.
- Có hai snapshot Hugging Face ngoài Git, đầy đủ blob/symlink, không chỉ file ref:
  image `327ab6726d33c0e22f920c83f2ff9e4bd38ca37f`, text
  `58edf8cada9e398793dca955574a48cbb7f18be2`. Runner bắt buộc đường dẫn snapshot
  có tên revision40hex, bật offline và không tự tải model. Tên folder không là
  chữ ký xác thực model; người bàn giao phải giữ nguyên cache tin cậy của revision.
- Có một ảnh JPEG thử nghiệm hợp lệ ngoài Git. Ảnh dùng chung cho hai Product
  fixture **chỉ kiểm dây nối/ID/visibility**, không dùng self-match để tính chất lượng.
- Chuẩn bị local Docker images `postgres:17-alpine` và
  `docker.elastic.co/elasticsearch/elasticsearch:8.19.21`; runner ES dùng
  `--pull=never`. Lượt reviewer dùng ES image ID
  `sha256:cbf5cd6cfe5532a9c02d510c66d238bf329cd51fe3d57170a2a880aca7d47419`
  trên ARM64; image kiến trúc khác có thể có ID khác, cần ghi riêng.
- Không root/BE/AI `.env` trong checkout QA. Không dùng DB demo, corpus/index86
  hoặc output evaluation làm dữ liệu ghi của lượt này.
- Cổng QA: PG5549, ES19263/proxy19264, AI8140/proxy8141, Nest3361, ảnh3362;
  đều loopback. Runner từ chối cổng đang bận; không kill dịch vụ khác để lấy cổng.
- Chạy Python không `-O`/`PYTHONOPTIMIZE`, vì preflight dùng assertions.

## PostgreSQL QA trên máy khác

Nếu đã có container reviewer `dat-pr89-85-87-review-20261021` ở trạng thái dừng,
runner dùng mặc định đó. Trên máy mới, tạo **container QA mới** theo mẫu dưới.
Không dùng tên/volume đã có hoặc chạy lệnh reset/drop để làm trống.

```sh
# Nhập mật khẩu QA mới, không đưa giá trị thật vào history/repo/chat.
read -r -s POSTGRES_PASSWORD
export POSTGRES_PASSWORD
docker create --name dat-search-live-qa-local \
  -p 127.0.0.1:5549:5432 \
  -e POSTGRES_USER=qa_bootstrap -e POSTGRES_PASSWORD -e POSTGRES_DB=postgres \
  --mount type=volume,source=dat-search-live-qa-local-data,target=/var/lib/postgresql/data \
  postgres:17-alpine
unset POSTGRES_PASSWORD
```

Container phải đang **dừng**, port binding chính xác127.0.0.1:5549→5432. Tên mới
phải dạng `dat-search-live-qa-*`. Bootstrap được phép tạo role/database; role
ứng dụng được runner tạo riêng NOSUPERUSER/NOCREATEDB/NOCREATEROLE. Không chia sẻ
Docker inspect/env chứa mật khẩu bootstrap. Runner không ghi mật khẩu role/JWT
ra file, không cần gửi credential cho người nhận; chạy lại sẽ tạo role/DB mới.

## Chạy

Giữ hai checkout: một chứa bộ công cụ này, một chứa đúng source commit cần kiểm.
Chạy `pnpm install --frozen-lockfile` trong checkout nguồn trước; không copy `.env`.
Những đường dẫn dưới là chỗ thay bằng đường dẫn tuyệt đối trên máy nhận.

```sh
python3 scripts/qa/run_search_live.py \
  --checkout /absolute/source-checkout \
  --head FULL_SOURCE_COMMIT_SHA \
  --run-name qa20261025a \
  --output /absolute/new-evidence-directory \
  --python /absolute/AI_CLIP/.venv/bin/python \
  --image /absolute/query-fixture.jpg \
  --image-model /absolute/snapshots/327ab6726d33c0e22f920c83f2ff9e4bd38ca37f \
  --text-model /absolute/snapshots/58edf8cada9e398793dca955574a48cbb7f18be2 \
  --pg-container dat-search-live-qa-local
```

Thay `FULL_SOURCE_COMMIT_SHA` bằng SHA40hex từ `git rev-parse HEAD` trong
checkout nguồn, không phải SHA của bộ công cụ nếu dùng hai checkout khác nhau.
Để kiểm gateway ảnh trên commit đã có #102, thêm `--image-gateway`, dùng
**run-name/output mới**. `3cc0e9fe961062cfb5eb1b94186b91006d41e724` và
`06eb4fd072c409a173ee2b239ef9c8c364bade9e` chỉ là các source lịch sử đã báo cáo.
Không cherry-pick gateway lên develop rồi ghi là develop nguyên bản, hoặc dùng
kết quả lịch sử để nhận commit mới đã đạt.

Runner tự migrate/generate/build, tạo FAISS `IndexIDMap2(IndexFlatIP(512))` rỗng,
khởi động FastAPI/model thật và ES mới, chạy Nest/HTTP thật, rồi dừng dịch vụ.
Không persist ảnh query vào catalog; fixture Product lấy ảnh từ HTTP loopback.
Backend cron tắt, harness chủ động gọi worker thật trên DB chỉ có fixture.
ES proxy chỉ chuyển tiếp hoặc ngắt TCP; không giả ACK thành công. Retry chờ
đủ backoff30s thật; không giảm timeout/backoff hoặc sửa payload event.

## Kết quả mong đợi

| Nhóm | Điều kiện đạt |
| --- | --- |
| Khởi tạo | Toàn bộ migration đúng tên/checksum của commit nguồn, không thiếu/thừa/lỗi; role false:false:false; CLIP và FAISS tải, vectorCount0 |
| UPSERT | Hai productId do PostgreSQL sinh xuất hiện đúng ở ES/FAISS512, không trùng |
| Image candidate | JPEG/PNG200; ảnh hỏng400; GIF415; AI ngắt kết nối503; no-store; không đổi các hàng nghiệp vụ đã snapshot |
| Stale image | AI vẫn trả Product A bị ẩn bằng fixture SQL; Backend loại A, giữ B trước khi index cập nhật |
| Checkout | Mua hết hai Variant của A qua Cart/preview/Checkout HTTP; index inStock=false và search có filter loại A |
| Cancel/replay | Hủy qua HTTP hoàn kho đúng1lần,1version/event; replay không đổi DB; trước dispatch có thể thiếu A vì index cũ |
| Partial/retry | Ngắt ES thật → FAISS v3 thành công/ES lỗi, outboxFAILED; chờ backoff; retry nguyên payload,FAISS ALREADY_APPLIED,ES SUCCEEDED,không thêm vector |
| STALE | Giữ lịch gửi Bv2 trước dispatch, Bv3 tới trước; v2 đến muộn trảSTALE,byte FAISS/state và docsES không đổi |
| DELETE/tombstone | Store fixture SUSPENDED rồi hủy → DELETE v5; ES/FAISS bỏ A; UPSERT v3 cũ không hồi sinh |

Đây là6nhóm cơ bản,8nhóm khi thêm `--image-gateway`, **không phải số test
toàn repo**. Mutation fixture SQL về visibility/Store là fault setup có nhãn,
không thay test Seller/Admin HTTP của các suite khác. Mọi purchase/cancel và
Outbox→AI→hai index đều thật.

## Kiểm tra và bàn giao

```sh
python3 scripts/qa/verify_search_live.py /absolute/new-evidence-directory \
  --checkout /absolute/source-checkout --head FULL_SOURCE_COMMIT_SHA
python3 -m unittest discover -s scripts/qa -p 'test_*.py' -v
node --check scripts/qa/search-live.mjs
```

Output có `manifest.json` (khác publication run-manifest của #25), log lệnh/exit,
snapshot DB allowlist, trace HTTP không token/ảnh multipart, proof ID/hash/state,
runtime FAISS và `SHA256SUMS.json`. Verifier đối chiếu các file/invariants đã lưu,
không là chữ ký của bên thứ ba hoặc thay cho chạy lại dịch vụ.

Runner mới ghi `migration-provenance.json`: danh sách migration và SHA-256 SQL
từ Git commit `--head`, cùng tên/checksum/trạng thái thực trong `_prisma_migrations`.
Không cố định 17, 19 hay 25. Verifier đọc lại đúng Git object của SHA đã kiểm,
không lấy số migration từ HEAD hiện tại hoặc chỉ tin vào tổng tự khai trong JSON.
Máy nhận cần có commit đó trong checkout/repository Git (fetch trước nếu thiếu).
SQL checkout được đối chiếu trước khi mở Docker; chỉ chấp nhận byte Git hoặc
chuyển LF sang CRLF của checkout sạch, không chấp nhận sửa nội dung SQL.
Thiếu/thừa/trùng tên, checksum sai, migration chưa xong/đã rollback đều bị từ chối.

Gói lịch sử không có provenance này phải kiểm bằng verifier lịch sử tương ứng,
hoặc chạy một lượt mới bằng runner mới. Không tự thêm provenance, đổi số 17
thành số hiện tại hoặc sửa hash gói cũ để nhận đó là bằng chứng mới.

Giữ nguyên gói lỗi và gói đạt riêng, không ghi đè để làm xanh. Runner giữ DB,
container ES đã dừng, FAISS/state/output để kiểm chứng; không tự xóa dữ liệu.
Một số cảnh báo pg concurrent query/resource_tracker có thể còn; ghi đúng log,
không diễn giải exit0 thành đã sửa nguyên nhân warning.

Không commit output/log/runtime/ảnh/model/FAISS hoặc mật khẩu. Đưa source runner,
hướng dẫn và kết luận lên PR; log đã lọc có thể bàn giao qua comment hoặc artifact
riêng được kiểm tra trước. Không gọi bộ này là full-stack Compose, browser search,
load/concurrency đa replica hoặc Precision/Recall. Không đổi protocol #25.
