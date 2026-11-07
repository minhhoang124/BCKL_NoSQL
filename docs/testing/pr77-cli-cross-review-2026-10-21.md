# PR #77 — kiểm bản kết hợp và rà độc lập qua CLI

Ngày 21/10/2026. Phạm vi: foundation/revision/audit table và ba API Admin GET
Attributes; không nhận Backend ghi hoặc toàn bộ Admin đã hoàn thành.

## Nguồn và bản kết hợp

- Source được chạy full Backend: `4cad89d413526a4b89e2701cbe6ea7ac3f90e119`.
- Develop sau merge Accounts UI #81: `76a62c9c365e63425a293fe96412a8356db33298`.
- Merge cục bộ sạch: `a6d423c`; Backend source và Prisma không khác byte so
  `4cad89d`, Frontend source không khác develop `76a62c9`.
- Chỉ nhận #81 đã merge, không lấy runtime Buyer #74 hoặc journal #75 đang mở.
- Discussion P2 no-store cũ đã resolved; không tự resolve một finding mới.

## Kiểm thử thực chạy

PostgreSQL 17 trên container QA riêng, chỉ loopback `127.0.0.1:5549`.
Database: `bckl_order_resolution_test_attributes_20261019_v31021`.
Không dùng DB demo 5432, DB của reviewer hoặc container seminar.

| Kiểm tra | Kết quả | Baseline |
|---|---|---|
| Fresh migrations | 15/15 PASS | `4cad89d` |
| Backend unit | 709 PASS, 32 files, 5.77s | `4cad89d` |
| Full Backend E2E | 633 PASS / 20 TODO, 33 files PASS / 1 SKIP, 184.99s | `4cad89d` |
| Backend lint/typecheck/build/diff-check | PASS | `4cad89d` |
| Attributes HTTP + migration | 21/21 PASS, 2 files, 5.07s | `a6d423c` |
| Full Frontend tests | 721 PASS / 6 live SKIP, 40 files PASS / 1 SKIP, 95.82s | `a6d423c` |
| Frontend TypeScript/Vite build, diff-check | PASS | `a6d423c` |

Hai suite trọng tâm: `admin-attribute-read.e2e-spec.ts` và
`attribute-read-migration.e2e-spec.ts`. Không cộng lại subset vào tổng E2E.
Một lượt chọn nhầm tên migration suite chỉ chạy 12 HTTP tests; kết quả 21 ở
bảng là lượt chạy lại đúng cả hai file. Lượt bootstrap đầu dùng tên DB không
khớp allowlist đã dừng, không tính PASS; không nới guard hoặc giả GITHUB_ACTIONS.
Không tính TODO/SKIP là kiểm thử đạt. Migration upgrade test dùng predecessor
tối thiểu, không phải snapshot production đầy đủ.

## Gemini CLI: kết quả thực tế, không phóng đại

Gemini CLI consumer Google login không sử dụng được; dùng Antigravity CLI
`agy 1.0.6`, chọn rõ model `gemini-3.8-flash-high`, sandbox bật.
Không dùng chế độ bỏ qua quyền. Lượt yêu cầu đọc checkout bị từ chối quyền
command trong headless mode; hai lượt gửi bundle source hết thời gian không
trả kết luận. Các lượt đó **không phải independent review hoàn tất**.

Lượt cuối chỉ gửi một tình huống khóa cụ thể, không cấp tool/file access và
không yêu cầu chạy test. Gemini trả về nhận định:

> Giao thức này có nguy cơ deadlock do nâng cấp khóa: hai transaction có thể
> cùng giữ KEY SHARE trên parent sau INSERT option, rồi cùng cần FOR UPDATE.
> Writer phải khóa parent FOR UPDATE trước khi INSERT child. Scope hiện tại
> mới là Admin GET/foundation, chưa write endpoints.

Đây là rà lý luận phạm vi hẹp, xác nhận lại rủi ro đã biết; **không phải** Gemini
đã đọc toàn PR hoặc chạy unit/E2E. Các kết quả kiểm thử ở bảng do Codex thực chạy.
Không dùng câu trả lời này để nhận toàn PR không có lỗi ngầm.

## Gate và việc tiếp theo

- Đạt đã approve source `4cad89d`; Hiền đã đọc foundation ở `dd8e5b3`, không
  phát hiện source blocker nhưng yêu cầu sync/test bản kết hợp. Không ghi Hiền
  đã approve head mới. Hoàng cho phép Codex hỗ trợ review/test và quyết định
  merge thay trong phạm vi đủ điều kiện; không giả danh reviewer khác.
- Đã rà lại controller/query/read service/migration và delta: không thấy blocker
  mới trong phạm vi đọc. Cần CI xanh đúng head sau push trước Ready/merge.
- Không đổi migration cũ; không bật editor ghi #73. Bảng audit chưa có producer;
  normalized uniqueness, expectedRevision/reason/usage gates, metadata+audit+
  durable reconciliation atomic và Seller coherence vẫn là PR write tiếp theo.
- Writer phải thống nhất khóa cha trước con, retry hữu hạn, rollback sạch và
  kiểm bằng nhiều connection; ghi chú hoặc SQL prototype không thay proof runtime.
- Chưa browser/editor hoặc live FastAPI–Elasticsearch–FAISS trong lượt này.
  Merge foundation không làm G-ADMIN/G-LISTING/G-DISCOVERY chuyển DONE.
