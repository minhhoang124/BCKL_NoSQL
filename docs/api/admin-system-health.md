# Admin system health — Backend implementation v1, đã merge #89

21/10/2026. Triển khai điểm nối Backend theo contract #61 và AI runtime #79.
Nhánh riêng từ develop `fa85f66`; không đổi payload Search/index hoặc schema DB.

## Quyền và request

`GET /admin/system-health` — JWT của **Admin đang hoạt động trong PostgreSQL**.
Guest/inactive trả401; Buyer/Seller hoặc Admin đã bị đổi quyền trả403. Không tin
role cũ trong JWT; service đọc lại quyền trước và sau khi chờ upstream/cache.
Nếu DB/auth lỗi thì request thất bại, không hạ quyền để trả dashboard.

Không query, không GET body, không force refresh/URL/index/timeout từ client.
Middleware `no-store` chạy trước guard/parser, áp dụng cả HEAD/hoa-thường/slash
cuối/lỗi. Frontend chỉ gọi Backend, không cầm token health nội bộ.

## Response HTTP200

- `schemaVersion: 1`.
- `collectedAt`: thời điểm Backend thu kết quả AI (giữ nguyên khi cache HIT).
- `servedAt`: thời điểm trả lần đọc này; không phải mốc probe mới.
- `postgresql: {status: "READY", checkedAt: <UTC>}` chỉ xác nhận DB vừa phục vụ
  kiểm quyền; không phải backup, writability hay kiểm tra mọi bảng/replica.
- `search.status`: READY/DEGRADED/UNAVAILABLE/UNKNOWN, tổng hợp ba capability.
- `search.errorCode`: null khi nhận snapshot đúng chuẩn; AI_TIMEOUT,
  AI_UNREACHABLE hoặc AI_INVALID_RESPONSE khi không kiểm chứng được upstream.
- `search.snapshot`: nguyên envelope AI đã validate, hoặc null khi transport/
  cấu trúc/clock không hợp lệ. Không giả snapshot AI mới khi mất FastAPI.
- `search.effectiveCapabilities`: capability sau đối chiếu hạn dùng ở Backend,
  hoặc null khi không có snapshot; không ghi đè các timestamp/status quan sát gốc.

All READY → READY. Có capability usable (READY/DEGRADED) nhưng không all READY
→ DEGRADED. Không usable và có UNKNOWN → UNKNOWN. All UNAVAILABLE → UNAVAILABLE.
Trạng thái Search không có nghĩa outbox đã xử lý đủ hoặc Precision/Recall đạt.

Snapshot sai field/enum/nullability/finite number/TTL/timestamp/dependency/reason
phải bị từ chối trước projection. Đối chiếu canonical Pydantic trong
`AI_CLIP/app/schemas/search_health_contract.py`; fixture/schema đã merge tại
`docs/api/examples/search-health-proposed-v1.*`. Không tải schema động.

## Kết nối và thời gian

- Cùng secret riêng ở AI `AI_INTERNAL_HEALTH_TOKEN` và Backend
  `SEARCH_INTERNAL_HEALTH_TOKEN`; gửi bằng `X-Internal-Health-Token`.
  Tự sinh ngoài repository; không dùng JWT User hoặc gửi giá trị lên GitHub.
- `AI_SERVICE_URL` là cấu hình server HTTP(S) đã kiểm; không credential/query/hash.
  Token cấu hình phải ASCII không khoảng trắng/control, tối đa4096 ký tự.
  Thiếu/sai cấu hình không gửi request và trả UNKNOWN/AI_UNREACHABLE.
- GET duy nhất, không retry/redirect; deadline **2000ms bao gồm body**, giới hạn
  **32768 byte sau giải nén**. Dừng stream vượt giới hạn. Không đọc health bằng
  truy vấn khách hàng hoặc tạo sentinel/index/model download.
- Cache AI15s theo monotonic clock (đồng hồ đo khoảng thời gian), single-flight
  (nhiều request chia sẻ một lần thu). Quyền và kết quả DB không cache theo Admin.
- Mỗi lần trả kiểm lại expiry; không kéo dài TTL probe chỉ vì FE poll/cache HIT.
  Timestamp tương lai quá5s hoặc clock Backend lùi khiến snapshot không tin cậy
  → UNKNOWN/AI_INVALID_RESPONSE. Giới hạn TTL producer60s giữ nguyên.
- FE có thể poll30s. Nhánh tích hợp của Hiền nối UI qua đúng endpoint Backend;
  trình duyệt không bật deep probe và không gọi FastAPI trực tiếp.

## Đọc code và bằng chứng

`configure-app.ts` → `AdminSystemHealthController` → `AdminSystemHealthService`
→ validate/current projection trong `search-health-contract.ts`. Module health
riêng nhập Auth/Passport, tránh vòng phụ thuộc Auth–Search.

Đọc [kiểm thử/giới hạn](../testing/admin-system-health-runtime-2026-10-21.md).
API này chưa phải dashboard doanh thu hoặc toàn G-OPERATE; không dùng số lượng
test unit hay health UNAVAILABLE smoke để nhận all-ready deployment đã nghiệm thu.
