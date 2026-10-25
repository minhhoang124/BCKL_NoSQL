# Accounts status — nhật ký kiểm thử 24/10/2026

Nhánh codex/account-status-hardening; base f5490e3. Chưa merge hoặc đủ gate toàn Accounts. Kết quả đang cập nhật, không dùng số liệu lượt cũ thay lượt mới.

## Đã chạy

- Fresh DB QA riêng v946 trên loopback5549:23migrations thành công, không DB demo, không dotenv override.
- Hai file service/input unit đầu tiên38PASS. Đây là mock/parser, không chứng minh rollback PostgreSQL.
- Hai suite HTTP/service PostgreSQL Accounts sau sửa:18PASS (12 hardening+6 ownership). Có no-store/auth, legacy body/query reject, self-lock, same-revision race, hai Admin khóa nhau, stale/no-op, lock→unlock access/refresh cũ401/login mới, legacy inactive unlock, enqueue rollback và audit immutable.
- Typecheck lượt sau cập nhật fixture và call sites đã đạt; lint đầu có1warning control-regex, đã đổi sang code-point validation, cần chạy lại trước chốt.
- Full Backend unit/E2E đang chạy; chưa nhận PASS khi chưa có kết quả.

## Lỗi phát hiện và sửa thật

- E2E đầu 4PASS/13FAIL: pg advisory lock trả kiểu void mà Prisma adapter không decode. Ca chẩn đoán raw SQL tái lập đúng thông báo; sửa SELECT trả integer từ function, không bỏ khóa.
- E2E tiếp17PASS/1FAIL: Prisma bọc serialization raw-query bằng P2010; helper cũ chỉ nhận P2034/direct-adapter nên trả503. Thêm classifier mã SQLSTATE có cấu trúc40001/40P01, retry toàn transaction; không nới assertion409 thành503.
- Sau sửa18/18đạt. Giữ regression integer projection và classifier, không gọi các lượt lỗi là xanh.

## Chưa nghiệm thu

Browser/UI commands, refresh/login in-flight được điều phối barrier, actor password-change race, runtime app role hạn quyền cho suite mới, restart/mất response thực, migration nâng cấp dữ liệu cũ và fixture portable bàn giao Hiền. Không suy fresh migration là upgrade proof hoặc test một process là multi-process crash proof.

Audit lỗi/revoke lỗi đã có unit injected failure nhưng chưa có PostgreSQL fault riêng; enqueue injected fault trong PostgreSQL chứng minh rollback state/version/refresh/audit. Full Search index chưa chạy trong lượt này; ownership reconciliation/outbox là bằng chứng Backend, không AI loaded index.
