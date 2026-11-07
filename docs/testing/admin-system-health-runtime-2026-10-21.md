# Backend Admin health — verification, 21/10/2026

Branch `codex/admin-search-health-runtime`, base `develop fa85f66`. Đã đọc
contract #61, canonical Pydantic thật và AI runtime #79 đã merge. Không dùng
schema/code tải động, không đổi FastAPI/schema/migration/Product/Search writes.

## Runtime

Active Admin → JWT/current DB role → middleware no-store/no-query/no-body →
health service kiểm quyền trong read-only transaction → lấy cache hoặc GET
FastAPI nội bộ → đọc/validate tối đa32KiB trong deadline2s → kiểm quyền lần nữa
→ snapshot gốc + effective capabilities theo đồng hồ Backend. Không gọi API
search/index hoặc probe sâu theo từng poll, không giả READY khi AI không rõ.

Module riêng nhập Auth/Passport, không tạo vòng phụ thuộc Auth↔Search.
`collectedAt` giữ thời điểm thu, `servedAt` khác mốc quan sát AI. Server cache
15s dùng monotonic clock, một flight chia sẻ; authorization không cache.
Consumer hết hạn/clock lùi không ghi đè timestamp producer. Missing token/config,
timeout/network/malformed HTTP200 có mã an toàn, không raw body/host/secret.

## Kiểm đã chạy

| Kiểm | Kết quả thực |
|---|---|
| Frozen/offline install | PASS, không đổi lockfile |
| Full Backend unit | **798 PASS**,35files,6.13s;47health cases nằm trong tổng |
| 47 health validator/service cases | PASS: canonical fixture, schema/extra/enum/null/finite/TTL/time/reason/dependency, stale mismatch, clock rollback, cache15s/single-flight/copy safety, revocation, malformed/oversize, deadline cả headers/body |
| HTTP + PostgreSQL, upstream Node fixture | **8 PASS**,6.78s; JWT role freshness/401/403, read-only/outbox unchanged, real socket deadline2s, malformed200, GET body/query/HEAD/case/slash |
| Native FastAPI integration opt-in | **1 PASS**,6.11s: real Python/FastAPI process from checkout, Backend→FastAPI HTTP không mock, canonical snapshot được chấp nhận, không lộ token/outbox mutation |
| Full Backend E2E | **678 PASS / 1 opt-in live SKIP / 20 TODO**,36filesPASS/2SKIP,182.83s;8newHTTP cases nằm trong678; live case đã chạy riêng, không cộng hai lần |
| Fresh dedicated QA migrations | 16/16 PASS, DB mới trên loopback5549 |
| Lint / TypeScript / Nest build | PASS; lint cuối không còn warning mới |
| Prisma validate / diff-check | PASS; schema/migration/AI source nguyên develop |
| AI Ruff / full Pytest | Ruff PASS, **317 PASS**,31.83s; AI source giữ nguyên develop |

Lượt HTTP đầu thất bại vì module chưa đăng ký Passport options; đã bổ sung cùng
cơ chế Catalog hiện hữu, rerun8/8 đạt. Typecheck bắt các lỗi kiểu mock/optional
Prisma trong harness mới; đã sửa rồi chạy lại, không bỏ typecheck hoặc nới guard.

## Môi trường và giới hạn

- DB QA mới `bckl_order_resolution_test_attributes_20261019_v323`, port5549,
  schema đủ16migrations. Checkout sạch không `.env` root/BE; URL và JWT test
  được inject riêng. Không truy cập hoặc cleanup DB demo trong task health.
- Upstream Node fixture là HTTP thật nhưng **không FastAPI**; tách khỏi smoke
  FastAPI thật. Smoke bật `AI_LOAD_RUNTIME_ON_STARTUP=false`, offline model
  flags, ES target không phục vụ riêng, sync-state path tạm riêng, cổng động,
  token ngẫu nhiên không in; harness đóng child khi xong. Không model download,
  không tải index/dataset hoặc chạm ES chung.
- Smoke chứng minh wiring/token/canonical UNKNOWN hoặc UNAVAILABLE. **Chưa**
  live all-ready CLIP image/text + FAISS + ES, outage trên deployment thật,
  clock nhiều máy, Admin browser/health UI hoặc hiệu năng nhiều process.
- Two-second body timeout đã được kiểm bằng stream giả có kiểm soát; real socket
  timeout kiểm upstream không gửi headers. Không nhận tất cả kiểu socket failure
  từ một ca; cache/single-flight là per-process, không phải distributed lock.
- Không dashboard doanh thu, indexing readiness/outbox backlog hoặc Precision/
  Recall từ health. PostgreSQL READY chỉ là truy vấn quyền vừa thành công.
- Gemini source-only review nhận source TS + Pydantic nhưng hết deadline khi
  đang suy luận; không có verdict độc lập hoàn chỉnh, không tính là approval/test.

## Handoff

API và field giải thích tại `docs/api/admin-system-health.md`. Hiền chỉ nối UI
sau API được review/merge, poll30s và phân biệt UNKNOWN/stale/error/zero; không
gọi trực tiếp AI từ browser. Đạt review parity Pydantic/time/dependencies và
phối hợp all-ready integration; không giao Revenue/Accounts sang Đạt.

Chạy native smoke tái lập từ checkout: cấu hình Python đã cài dependencies,
`PYTHON_HEALTH_QA_EXECUTABLE`, `RUN_LIVE_SEARCH_HEALTH=true`, QA URL/JWT riêng,
rồi chạy `BE/test/admin-system-health-live.e2e-spec.ts` qua Vitest E2E. Không đặt
GITHUB_ACTIONS giả hoặc gửi configuration/credential qua GitHub.
# Sau #88 — baseline mới

Đã nhận develop `d84381a`, source health/contract giữ nguyên `273fad8` đã duyệt.
812unit/678fullE2E PASS (1opt-inSKIP,20TODO), native health chạy riêng1/1PASS;
lint/typecheck/build/Prisma/diff PASS. Chi tiết và giới hạn ở
[báo cáo sau #88](pr89-post88-sync-2026-10-21.md). Các số trước đó giữ baseline
lịch sử, không dùng thay lượt kiểm mới.
