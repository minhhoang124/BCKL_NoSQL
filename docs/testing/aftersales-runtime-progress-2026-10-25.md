# Hậu mãi runtime — checkpoint25/10/2026

Mốc mới26/10: đã có migration/API Backend và QA trên cùng nhánh; xem
[báo cáo hiện tại](aftersales-runtime-2026-10-26.md). Nội dung dưới là checkpoint
policy trước triển khai, không còn dùng làm trạng thái runtime mới nhất.

IN_PROGRESS trên `codex/aftersales-runtime`, tiếp nối contract #117. Chưa có
schema/migration/REST, chưa nối UI, chưa ghi refund hoặc hoàn kho trong DB.
Không dùng kết quả dưới đây để nghiệm thu API hậu mãi/Dashboard.

Đã viết shared policy `BE/src/aftersales/aftersales-policy.ts`: tiền Decimal
canonical chuyển sang bigint cents, kiểm tổng toàn Order/Payment, full-line
refund không gồm shipping, thời điểm adjustment, cửa sổ từ deliveredAt, state
transitions theo actor và date range UTC+7. Không đăng ký provider/controller.

42 unit test PASS, TypeScript PASS, lint mục tiêu PASS. Các test gồm số tiền lẻ,
aggregate vượt int32, net âm kỳ sau, malformed/exponent money, snapshot lệch,
duplicate item IDs, payment sai, deadline+1ms, chuyển trạng thái sai actor,
completion/refund timeline và ngày không tồn tại. Gemini Argon Medium rà source
và contract độc lập: SUCCESS/NONE P1/P2. Review tĩnh không thay PostgreSQL QA.

Việc kế tiếp cần hoàn thiện cùng lát cắt runtime trước mở PR:

1. Migration mới sau25 cho ReturnRequest/history/command/refund/adjustment;
   partial unique reservation và unique refund/movement trên mọi request.
2. Service transaction canonical actor/Store/OrderItem, receipt/reconcile và
   các API tạo/rút/bất đồng/quyết định/nhận hàng; không dùng policy làm quyền.
3. Hook completion Buyer/system để kích hoạt adjustment chờ cùng Order lock.
4. Outbox khi hoàn kho; PostgreSQL concurrency/rollback/replay/upgrade probes,
   full regression và review độc lập đúng source. Chỉ dùng QA5549 riêng,
   không dotenv/demo; chưa cho launcher cũ chạy branch này khi chưa whitelist.
5. Dashboard aggregate read-only dùng cùng financial predicates, fixture đối
   chiếu gross/refund/net và invalid-data exclusion; sau đó mới nối UI.

Không mở PR chỉ chứa policy rồi tính là đã khép hậu mãi. Checkpoint này giữ công
việc có thể tiếp tục sau gián đoạn; chưa bật endpoint hoặc viết dữ liệu demo.
