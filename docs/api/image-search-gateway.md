# Backend image search gateway — candidate 23/10/2026

## Ranh giới

Nhánh `codex/image-search-gateway` từ develop06eb4fd. Đây là Backend runtime
candidate; **chưa merge/chưa Web upload/chưa loaded CLIP–FAISS nghiệm thu**.
Không đổi thuật toán, Pydantic models, router FastAPI hoặc schema PostgreSQL.

Public `POST /search/image`, multipart/form-data:

| Trường | Quy tắc |
| --- | --- |
| image | Chính xác1JPEG/PNG, không rỗng, tối đa5MiB. MIME phải khớp magic bytes; decode thật Sharp, tối đa25triệu pixel và2s native timeout, không ảnh nhiều trang. |
| topK | Số kết quả tối đa; optional, chuỗi số nguyên dạng chuẩn1..50, mặc định10. |
| candidateK | Số ứng viên FAISS xét trước khi cắt kết quả; optional1..150, >=topK; mặc định min(max(topK*3,30),150), đúng FastAPI hiện tại. |

Không nhận URL ảnh, query string, filter, field/file lạ hoặc lặp. Đây là truy
vấn, **Backend không lưu ảnh vào uploads/DB/disk/log**. Không chuyển filename của client
sang AI; dùng query.jpeg/query.png. FormData tự tạo boundary, không tự gắn
Content-Type sai. Không cookie/JWT chuyển sang AI hoặc theo redirect.
Bytes ảnh vẫn được gửi tới AI nội bộ; chưa scrub EXIF hoặc khẳng định multipart
parser FastAPI không spool tạm. Không ghi nó thành media/catalog hoặc index mới.

Luồng:

`ingress quota → Multer memory bound → validate/decode → FastAPI /search/image → validate envelope → shared PostgreSQL hydrate → public Product`.

Mỗi IP10lượt/phút, map tối đa10.000key;2handler ảnh đồng thời trong1process,
tính cả parsing. 429/503 có Retry-After.
Upload chưa nhận xong trong15s bị destroy input stream và nhả slot đúng1lần;
không cho stream gửi nhỏ giọt chiếm chỗ mãi. Deadline này không phải timeout
của toàn bộ PostgreSQL hydrate. Đây là bảo vệ **local**, không quota
phân tán; triển khai nhiều replica cần gateway/rate-limit chung và timeout
upload của reverse proxy. Không tin trực tiếp X-Forwarded-For; không bật trust
proxy tùy ý. Native timeout best-effort của Sharp không phải sandbox native.

## Wire thực tế và phản hồi Backend

FastAPI multipart image/topK/candidateK đã tồn tại. Canonical query trên wire
là `{type:"image",topK,candidateK}`; **không text:null** vì router dùng
response_model_exclude_none=True. items chứa productId/rank/score; thời gian
responseTimeMs hữu hạn không âm. ID phải vừa PostgreSQLint32, rank1..topK,
score hữu hạn (âm có thể hợp lệ), số item<=topK, echoed limits phải khớp request.

Gateway kiểm exact keys trước hydrate. Pydantic SearchResponse/SearchQuery hiện
mặc định **ignore extra input**, không extra-forbid như Hybrid; không giả rằng
hai schema giống nhau. Gateway cố ý chặt hơn tại trust boundary, nhưng nhận đúng
output router hiện tại. Fixture/schema sinh từ models thật và fingerprint
models+router bằng `AI_CLIP/scripts/export_image_search_contract.py`; Pytest
và Backend test báo drift. Không tải code/schema từ GitHub lúc chạy.

Response Backend giữ envelope giống hybrid hydrated:
`{items:[{productId,rank,score,product}],responseTimeMs}`. Product là projection
công khai từ PostgreSQL, giá decimalstring/Variant, không lấy nội dung từ index.
Shared hydrate dùng RepeatableRead, public policy, dedupe và giữ relative rank.
Index stale có thể làm ít kết quả hơn topK; không bịa kết quả hoặc gọi đó là
phân trang đầy đủ. Image endpoint chưa có structured filters; không áp bộ lọc
hybrid vào một phía hoặc tự đổi FastAPI.

## Lỗi và tài nguyên

- 400: thiếu ảnh, field sai/lặp, ảnh hỏng hoặc vượt pixel/decoder limit.
- 413: vượt5MiB; 415: không JPEG/PNG hoặc MIME sai.
- 429: quota IP; 503: hai handler đang bận, timeout/network/upstream lỗi.
- 502: HTTP200 nhưng wire/JSON/Content-Type/shape sai, response>64KiB.
- Không retry tự động. AI_SEARCH_TIMEOUT_MS mặc định10s, cấu hình ảnh tối đa30s;
  một signal tính từ trước decode tới hết response body, kể cả stalled body.
  Không dùng response.text/json không giới hạn; stream đọc có cap và cancel.
- Cache-Control:no-store trong interceptor kể cả lỗi do interceptor/parser.
  Không log ảnh, filename, upstream body hoặc credential. Search query không
  ghi Product/version/SearchOutbox/Order.

## Bằng chứng và việc tiếp theo

47test mới gồm canonical export/drift, malformed shape, multipart thật,
MIME/magic/decode, file/response limits, timeout headers/body, redirect, quota
và concurrency/deadline upload chậm15s thật.3E2E trên PostgreSQL QA kiểm draft/privacy/dedupe/rank/current
Seller và zero-mutation. HTTP retrieval fixture trong những test này **không
phải loaded FastAPI/CLIP**; không dùng làm bằng chứng chất lượng retrieval.

Chờ review Backend/AI contract alignment của Hoàng–Đạt và QA của Hiền. Bước
tiếp theo là Web chọn ảnh/hủy/lỗi/loading, rồi test với FastAPI/model/index
cô lập thật; không nhận Backend gateway là cả chức năng tìm ảnh đã xong.

Thuật ngữ: gateway là cổng trung gian Backend; wire là dữ liệu gửi trên HTTP;
hydrate là đọc lại nội dung Product chuẩn từ PostgreSQL; quota là hạn mức số
request; rank là thứ hạng, score là điểm giống ảnh (không phải điểm RRF hybrid).
## Cập nhật đồng bộ 23/10/2026

Nhận develop `a91db91` sau #94; conflict chỉ ở tổng quan kiến trúc, giữ cả
ghi chú miền tính năng và Attributes. Không thay runtime của tính năng trong
lượt đồng bộ; không dùng approval head cũ thay review bản kết hợp.

Backend unit: 1.184 PASS/52 file; toàn bộ Backend E2E PASS trên DB QA v928; Nest build và lint PASS. E2E gồm các ca cố ý bơm lỗi; log lỗi fixture không phải lỗi suite. Chưa chạy lại loaded AI/Chrome ở head đồng bộ.
