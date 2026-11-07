# Admin Search Health UI — bản chuẩn bị 22/10/2026

Trạng thái: **PREPARATION trên nhánh local**, chưa phải nghiệm thu tích hợp.
Nền: `develop be568e0`. Dependency Backend là PR #89
`codex/admin-search-health-runtime`; tại thời điểm chuẩn bị chưa merge vào develop.

## Phạm vi đã chuẩn bị

- Route Admin `/admin/system-health`, chỉ dành cho Admin active theo guard chung.
- FE chỉ gọi `GET /admin/system-health` qua API client hiện có; không giữ internal
  health token và không gọi trực tiếp FastAPI, Elasticsearch hoặc FAISS.
- Parse allowlist envelope `schemaVersion: 1`; thiếu/thừa field, enum lạ hoặc
  metadata sai kiểu bị chặn thay vì hiển thị xanh.
- Hiển thị riêng PostgreSQL, aggregate Search, ba capability và bốn component.
- Có trạng thái loading, lỗi quyền, lỗi transport/shape, UNKNOWN/stale, refresh
  thủ công và polling 30 giây. Thay đổi phiên hủy/bỏ kết quả request cũ.
- Giao diện có breakpoint mobile; màu chữ/nền được khóa trong phạm vi module.
- Nhắc rõ readiness không chứng minh outbox đã xử lý hết, index đầy đủ hoặc
  Precision/Recall đạt.

Không có trong bản này: Backend/API #89, internal token, deep probe, sửa index,
Dashboard doanh thu, hậu mãi, dữ liệu mẫu gắn nhãn live hoặc QA PostgreSQL/AI thật.

## Checklist QA sau khi #89 merge

| ID | Ca kiểm | Kỳ vọng | Hiện tại |
|---|---|---|---|
| SH-UI01 | Guest/Buyer/Seller/inactive Admin mở route hoặc gọi GET | 401/403; không lộ snapshot; UI không giữ dữ liệu cũ | NOT_RUN |
| SH-UI02 | Admin active, PostgreSQL + AI đều sẵn sàng | UI hiện đúng READY từng phần; timestamp lấy response thật | NOT_RUN |
| SH-UI03 | ES lỗi nhưng CLIP/FAISS còn đọc được | hybrid UNAVAILABLE; semantic/image không bị tô đỏ sai; aggregate theo Backend | NOT_RUN |
| SH-UI04 | FastAPI timeout/unreachable/response sai | Search UNKNOWN + mã cố định; PostgreSQL vẫn tách riêng; không bịa component | NOT_RUN |
| SH-UI05 | Snapshot hết hạn/clock lệch | Hiện UNKNOWN/stale; polling/cache không kéo dài mốc probe | NOT_RUN |
| SH-UI06 | FAISS hoặc ES index trống hợp lệ | Hiện cảnh báo “index trống”; không gọi là lỗi hoặc “đồng bộ đủ” | NOT_RUN |
| SH-UI07 | Đổi Admin/đăng xuất khi GET đang chờ | Response cũ không render; mở thẳng route sau logout quay về đăng nhập | NOT_RUN |
| SH-UI08 | Desktop/mobile + dark preference | Nội dung đọc được, badge/chi tiết không tràn, không đổi theme toàn hệ thống | NOT_RUN |
| SH-UI09 | Network trace | Browser chỉ gọi Backend `/admin/system-health`; không có internal token/AI URL | NOT_RUN |
| SH-UI10 | Đối chiếu server logs/snapshot | UI không sửa nghĩa status/reason/timestamp và không làm mutation | NOT_RUN |

Điều kiện chạy: #89 merge, FE rebase/sync đúng develop mới, PostgreSQL QA riêng,
Admin active, FastAPI health runtime + Elasticsearch + FAISS cấu hình thật và
internal token gửi riêng. Không chép credential/URL nhạy cảm lên GitHub.

## Bằng chứng code local

- Unit/component tests bao phủ endpoint Backend duy nhất, parser fail-closed,
  quyền actor, UNKNOWN không bịa dữ liệu, render capability/component, refresh
  và khóa sau 401/403.
- Trên source local ngày 22/10/2026: **833 test PASS / 6 live SKIP**; lint hoàn
  tất với 5 cảnh báo `set-state-in-effect` có sẵn trong `AdminDashboardPage`;
  production build PASS. Bộ test riêng Search Health có 10/10 PASS.
- Fixture visual QA đủ desktop/mobile và tám trạng thái được ghi tại
  `admin-search-health-ui-visual-qa-2026-10-22.md`; mọi ảnh đều ghi rõ không phải
  dữ liệu live.
- Đây là bằng chứng PREPARATION trước #89. Sau khi sync bản merge phải chạy lại;
  không dùng kết quả hoặc ảnh của source này để nhận bản tích hợp mới.

## Thứ tự bàn giao

1. Hoàng merge #89 và cung cấp hướng dẫn dựng health runtime/fixture QA.
2. Hiền đồng bộ develop vào nhánh này, xử lý delta và chạy full FE test/lint/build.
3. Chạy SH-UI01–10 với dịch vụ thật; lưu expected/actual, commit và bằng chứng đã
   che nhạy cảm.
4. Chỉ sau đó push/mở PR integration và nhờ Hoàng/Đạt review. Không tự merge.
