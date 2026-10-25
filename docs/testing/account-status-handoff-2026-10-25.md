# Bàn giao Backend Accounts khóa/mở — 25/10/2026

Nhánh `codex/account-status-hardening`, đã đồng bộ `develop e543875` sau #113. Chỉ bàn giao Backend và fixture; chưa có Web dialog ghi/audit reader, chưa nghiệm thu toàn Accounts.

## Dựng QA

- Giữ database demo dừng. Bản kết hợp mới dùng PostgreSQL tại `127.0.0.1:5549`, database mới riêng `bckl_order_resolution_test_attributes_20261019_v948`. v946/v947 chỉ giữ tái lập source trước #113, không coi là schema hiện tại.
- Người vận hành cấp URL riêng cho migrator và app qua biến môi trường; không commit/chụp ảnh URL, mật khẩu, JWT hoặc cookie. Không sao chép `.env` demo. Không chạy E2E vào DB đang dùng để trình diễn.
- Cài dependency theo lockfile, generate Prisma và chạy `prisma migrate deploy` với migrator đã xác minh đúng target. Tổng24migrations sau đồng bộ #113. Không dùng `db push/reset` hoặc sửa migration cũ.
- Chạy app bằng role không superuser/CREATEDB/CREATEROLE; cấp quyền bảng/sequence thích hợp. Migration không tự cấp quyền theo tên role của từng máy. Lượt kiểm mới đã chạy 21 Accounts HTTP/service tests bằng app role hạn quyền trên v946.
- Với URL app QA đã cấp riêng: đặt `QA_ACCOUNT_STATUS_FIXTURE=1`, cung cấp `QA_ACCOUNT_PASSWORD` riêng ít nhất 12 ký tự, rồi chạy `node BE/scripts/account-status-qa.mjs` từ root. Script không đọc dotenv, không in mật khẩu/hash/token. Không dán giá trị biến nhạy cảm vào GitHub.
- Fixture tạo 5 tài khoản tổng hợp `status-qa-{admin-a,admin-b,buyer,seller,inactive}@example.invalid`; Seller có Store ACTIVE. Đọc IDs và trạng thái hiện tại từ output. Chạy lại không cập nhật user/hash/revision/Store/audit; tài khoản đã khóa qua QA vẫn khóa. Nếu fixture có sẵn, mật khẩu lần chạy mới không thay mật khẩu cũ. Không dùng script làm công cụ reset.

## Nối UI

1. GET danh sách Accounts giữ nguyên contract đọc hiện hành. Khi mở dialog ghi, GET `/admin/accounts/:id/status` lấy `{id,isActive,statusRevision}` mới.
2. Hiển thị target và hành động rõ ràng; nhập lý do 10–500 Unicode code points. Chỉ PATCH sau xác nhận người dùng, với đúng `{isActive,expectedRevision,reason}`. Không gửi credentialVersion hoặc role tùy ý.
3. Thành công đọc `account`, `auditId` và `searchReconciliation`. `auditId=null` là no-op, không phải lỗi. Job PENDING chưa chứng minh index đã cập nhật.
4. 409 revision: giữ draft, yêu cầu đọc lại/đối chiếu và xác nhận lại; không tự đổi revision rồi gửi. 401/403: khóa thao tác phiên cũ. 503/timeout/mất phản hồi: kết quả chưa rõ, không replay hoặc báo chắc rollback. Có thể đọc lại trạng thái; chưa có API audit/history hoặc request-key resolver để tự kết luận thao tác nào đã commit.
5. Khóa và mở đều thu hồi phiên của target. Target đăng nhập lại sau mở; Store SUSPENDED/CLOSED không bị chuyển ACTIVE. Không quảng cáo thao tác tài khoản là thao tác duyệt Store.

## Ca bàn giao cần giữ

| Ca | Kết quả yêu cầu |
|---|---|
| Admin A tự khóa | 409, không thay trạng thái/phiên/audit |
| Hai Admin cùng sửa một revision | Chỉ một transition/audit; bên còn lại 409 |
| Hai Admin khóa nhau | Không mất Admin hoạt động cuối; bên bị khóa không tiếp tục ghi |
| No-op đúng revision | Không sửa timestamp, token, audit hoặc job |
| Khóa rồi mở Buyer | Token cũ vẫn 401; đăng nhập mới được phép |
| Seller sở hữu Store SUSPENDED | Thu hồi phiên + enqueue trong cùng transaction, không mở Store |
| Lỗi enqueue | User/revision/token/audit cùng rollback |
| Mất phản hồi | Không tự gửi lại; cần đối chiếu thủ công cho đến khi có UI/audit reader |

Các ca Backend đã kiểm ở báo cáo liên kết; ma trận này chưa phải bằng chứng Chrome của UI ghi. Giữ lịch sử audit, không DELETE fixture đã có audit để dọn DB.

[Kết quả và giới hạn](account-status-hardening-2026-10-25.md), [contract](../api/account-status-runtime.md).
