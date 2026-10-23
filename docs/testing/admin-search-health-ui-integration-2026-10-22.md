# Admin Search Health UI — integration sau #89, 22/10/2026

## Phạm vi

- Rebase hai commit chuẩn bị của Hiền lên `develop e394c9e`, sau khi Backend
  Search Health #89 đã merge tại `8a0968e`.
- Route `/admin/system-health` dùng API client/AuthProvider hiện có và chỉ gọi
  `GET /admin/system-health`. Browser không giữ internal health token, không gọi
  FastAPI, Elasticsearch hoặc FAISS trực tiếp.
- Parser fail-closed cho envelope v1; UI giữ nguyên nghĩa READY, DEGRADED,
  UNAVAILABLE và UNKNOWN do Backend trả về. Readiness không được trình bày thành
  bằng chứng index đã đồng bộ đủ hoặc Precision/Recall đạt.
- Không nối Attributes write. `develop` hiện chỉ có API đọc; PR #94
  `codex/admin-attribute-write-api` tại `01b4c88` chưa merge và CI đang lỗi.

## Kết quả kiểm tra trên đúng source đã đồng bộ

| Nhóm | Kết quả | Ý nghĩa |
|---|---:|---|
| Search Health + Admin page targeted | 29 PASS | Endpoint Backend duy nhất, quyền FE, READY/UNKNOWN/stale/index trống/refresh và route tích hợp |
| Toàn Frontend | 952 PASS, 6 live SKIP | Không có regression test tự động trên FE |
| Frontend lint | PASS, 5 warning cũ | Không phát sinh warning từ Search Health |
| Frontend production build | PASS | TypeScript và bundle production đạt |
| Backend Health + Attributes read E2E | 20 PASS | PostgreSQL QA riêng; guest/Buyer/forged role/inactive/revoke bị chặn, cache/timeout/payload sai fail-closed; Attributes GET không mutation |
| FastAPI thật, runtime chưa tải model/index | 1 PASS | Nest → FastAPI process thật → PostgreSQL; snapshot canonical, không lộ secret, không ghi SearchOutbox |
| FE Attributes/Search Health targeted | 103 PASS | Attributes chỉ đọc hồi quy và bốn trạng thái Search Health render đúng nghĩa |

PostgreSQL 17 chạy trong container QA riêng, chỉ bind loopback `5549`; database
mới `bckl_order_resolution_test_attributes_20261019_v9222`, đủ 17 migration.
Không dùng database demo cổng 5432. Secret JWT/internal health chỉ sinh trong
process kiểm thử và không ghi vào repository hoặc bằng chứng.

## Ma trận trạng thái

| Trạng thái | UI/contract | Backend/FastAPI thật lượt này |
|---|---|---|
| READY | PASS | NOT_RUN với model + index + ES thật |
| DEGRADED | PASS | NOT_RUN với deployment suy giảm có kiểm soát |
| UNAVAILABLE | PASS | PASS trong runtime thật chưa tải model/index (assertion chấp nhận UNAVAILABLE/UNKNOWN theo thời điểm probe) |
| UNKNOWN | PASS | PASS cho upstream mất kết nối, payload sai, timeout/stale |

Ảnh desktop/mobile trước đây vẫn chỉ là fixture PREPARATION và không được đổi
nhãn thành live. Lượt này chưa mở browser loaded-runtime riêng; bằng chứng quyền
và status thật đến từ HTTP E2E trên PostgreSQL/FastAPI cô lập.

## Attributes và bước chờ Hoàng

- API đọc thực tế trên `develop`: list/detail/options dưới
  `/admin/categories/:categoryId/attributes`; hồi quy UI → Backend → PostgreSQL
  đạt và không làm đổi revision/audit/Search job.
- Full Admin write controller/service chỉ mới xuất hiện ở PR #94. Không bật nút
  tạo/sửa/tắt hoặc gọi route write trước khi PR này CI xanh, được review và merge.
- Sau khi Hoàng bàn giao commit merge + fixture QA, Hiền mới rebase editor, nối
  write API và chạy policy/transaction/uniqueness/Seller coherence/race/rollback.

## Chưa được tuyên bố

- Chưa all-ready Search deployment, chưa kiểm model tải thật, FAISS/ES chứa
  corpus chính thức hoặc trạng thái DEGRADED live.
- Chưa nghiệm thu Attributes CRUD, Dashboard, hậu mãi hoặc toàn giai đoạn 3.
- Health không thay cho kiểm outbox, chất lượng tìm kiếm hoặc Precision/Recall.
