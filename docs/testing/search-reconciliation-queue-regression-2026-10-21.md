# Search E2E: không giả định hàng đợi trống — 21/10/2026

## Phạm vi

Nhánh riêng từ develop `be568e0323833e5ea0a5d7fb8b5b10fd86253c02`.
Chỉ sửa test và tài liệu; không lấy code #83/#87/#91/#92 pending làm nền, không
đổi production worker, batch20, lease/backoff/retry, schema/migration hoặc AI.

## Root cause và tái lập

Test gọi Store mutation rồi một lần `SearchReconciliationWorker.runBatch()` và
assert Product đã có DELETE. Worker thật chọn20 job đủ điều kiện cũ nhất. Khi
QA có các job từ fixture khác, Store job mới còn PENDING; test thất bại trước
khi mở lại Store, kéo theo7case sau bị403. Không phải bằng chứng worker làm
mất durable work hoặc Product bị sửa sai ở production.

Đã thấy full #91 E2E698 PASS/8FAIL/20TODO; Search chạy lại riêng48PASS sau các
lượt worker đã tiêu thụ backlog. Không dùng rerun-green để phủ nhận lỗi.

Probe cuối chèn21job CATEGORY của một Category rỗng **do chính suite tạo**,
createdAt1970, nextAttemptAtNULL; sau đúng một batch thấy20SUCCEEDED, Store job
PENDING/attempt0. Assertion version tăng lập tức **FAIL:6 không lớn hơn6**.
Probe đầu chưa dùng Category rỗng đã bị chính Category job reconcile Product,
nên không tách được giả định cần thử; không tính probe đầu là RED hợp lệ.

## Sửa gì

- Lấy `jobId` thật từ response Store/Category/Brand/Seller/required-attribute.
- Chờ đúng ID bằng worker runtime thật và đọc trạng thái PostgreSQL thật.
- Giới hạn100batch, không ngủ chờ vô hạn, không đổi clock hoặc nextAttemptAt
  ngoài bước retry fixture vốn có; job mất hoặc hết budget phải FAIL rõ.
- Chạy batch trước khi đọc terminal state, để FAILED đã được tái-eligible thực
  sự được retry, không coi FAILED cũ là kết quả thành công của lượt mới.
- Mặc định đòi SUCCEEDED; FAILED chỉ được chấp nhận ở ca cố ý bơm lỗi. DEAD
  không được coi là success. Không mock kết quả/claim/checkpoint hoặc bỏ assert.
- Restart/concurrent-worker test vẫn dùng hai worker instance/pool thật và
  chờ cả job retry lẫn job cập nhật mới, giữ canonical-state/outbox assertions.
- Teardown chỉ xóa21job/Category fixture theo ID đã ghi nhận của suite, không
  xóa hàng đợi cũ/audit hoặc nới guard QA để làm xanh.

## Bằng chứng thực thi

DB QA riêng loopback5549/v903,16migration chính thức, role không superuser;
demo container dừng, launcher từ chối checkout có .env và chốt identity trước
kết nối đích. Không khẳng định DB QA là mới ở mỗi lượt; audit fixture cũ giữ lại.

| Kiểm tra | Kết quả |
| --- | --- |
| RED deterministic backlog trên chỗ assert cũ | 1 FAIL/47 unselected, expected version6>6 |
| Search sau sửa | 48/48 PASS,22.90s |
| Full Backend E2E | 670 PASS/20TODO,35files PASS/1SKIP,187.95s |
| Full Backend unit | 765 PASS/34files,16.65s |
| Backend lint/typecheck/build | PASS |
| git diff --check | PASS |

Các ERROR log trong ca cố ý response hỏng/outbox lỗi/repair lỗi không thay
verdict assertion. Đây E2E NestJS→PostgreSQL, không phải bằng chứng live
FastAPI/Elasticsearch/FAISS hoặc browser nghiệm thu Search. CI vẫn cần chạy thật khi account quota/billing
được giải quyết. Không merge bằng approval cũ hoặc nhận chức năng mới từ test.
