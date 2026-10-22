# Accounts status — kế hoạch implementation cần review

20/10/2026. Đầu vào #76; không đổi API/schema trong tài liệu này. #85 chỉ sửa
ownership invalidation. Phần dưới chưa là runtime hoặc acceptance đã PASS.

## 1. Ranh giới tương thích cần giải quyết trước code

GET /admin/accounts hiện exact8fields, adapter #81 reject extra fields. Không
tự thêm statusRevision/sessionEpoch vào list hoặc Auth response để làm UI hỏng.
Đề xuất GET riêng `/admin/accounts/:id/status` cho command dialog, trả allowlist
id/isActive/statusRevision; cần Hiền chốt contract trước khi controller triển khai.
Không expose sessionEpoch, audit reason hoặc token trong list/publicUser.

PATCH body mới theo #76: isActive,expectedRevision,reason. Khi phát hành phải
đồng bộ UI; body cũ thiếu revision/reason bị400, không có nhánh bypass legacy.

## 2. Lock protocol đề xuất

Status transaction Serializable, tối đa3attempt chỉ serialization/deadlock;
global transaction-level advisory lock cố định cho account-status operations
(không khóa trong một process), rồi khóa actor/target theo ID tăng. Sau khóa
đọc current actor active ADMIN, target, revision và count active ADMIN trong
transaction; không tin JWT role/count ngoài transaction. Actor và target trùng
khi deactivate trả ACCOUNT_SELF_LOCK_FORBIDDEN. Last Admin phải được chặn kể cả
writer nội bộ về sau; stale/no-op/exhaustion có outcome riêng.

Advisory lock không làm mới Serializable snapshot: overlapping writer có thể
phải retry toàn transaction, không chỉ query cuối. Kiểm nhiều connection và
đảo thứ tự request trước nhận là an toàn. Role-management chưa có API; khi thêm
phải tham gia cùng protocol, không quảng cáo bảo vệ mọi direct SQL writer.

Login/refresh cũng khóa user trước đọc active/epoch và persist refresh token.
Không giữ lock khi chờ bcrypt hoặc network; sau bcrypt phải đọc lại trạng thái
trong transaction. Lock order user→refresh token, không đảo thành refresh→user.

## 3. Migration và audit TARGET

Migration mới: User.statusRevision positiveInt default1; sessionEpoch integer
>=0 default0; bảng account-status history lưu actor,target,before/after,revision,
NFC reason và thời gian. Không audit giả cho dữ liệu cũ. Audit bất biến, FK không
cascade xóa lịch sử. Quy định overflow rõ, không reset epoch/revision.

Atomic một transaction: trạng thái/revision + audit + revoke refresh/tăng epoch
khi khóa + durable ownership reconciliation. No-op revision đúng không ghi các
phần này; stale dù desired state đã giống vẫn409. Enqueue/audit/revoke lỗi rollback.
Không đổi Store.status/Order, không tự duyệt lại Product khi unlock.

## 4. Token rollout TARGET

Đề xuất lúc phát hành buộc đăng nhập lại với token thiếu epoch: access và refresh
JWT mới đều có claim integer epoch, kiểm với User canonical. Không fallback
epoch0 cho JWT thiếu claim vĩnh viễn. Không đổi secret/token contract âm thầm;
thông báo trước việc đăng nhập lại và deploy backend/FE QA thống nhất.

Migration trước, code sau; không chạy code epoch trước khi cột tồn tại. Có thể
deploy staging/QA trước. Rollback code cũ sau khi đã phát token epoch sẽ bỏ bảo vệ
revocation; cần rollback plan/maintenance, không gọi là rollback an toàn mặc định.

Lock tăng epoch và revoke refresh; unlock không hạ epoch hoặc hồi sinh token.
Refresh thắng trước lock: token vừa tạo bị revoke/epoch mismatch sau lock.
Lock thắng trước refresh: refresh thất bại. Login race với lock phải có cùng
khóa User. Request đã được xác thực trước lock không tự hủy; sensitive writers
phải recheck actor trong transaction. Không hứa mọi GET đang bay bị thu hồi.

## 5. Acceptance phải có trước bàn giao UI ghi

- Hai Admin khóa nhau: chỉ actor còn active được commit, không mất hết Admin.
- Cùng target/revision: một thay đổi/audit/job; stale request409.
- No-op không audit/revoke/job; overflow không mutation.
- Audit/enqueue/revoke lỗi: rollback state/revision/epoch/refresh/history.
- Lock→unlock: JWT/refresh cũ vẫn401; login mới hợp lệ.
- Refresh/login đang bay với lock: đúng hai thứ tự, không refresh sống lại.
- Ownership job cả role USER; Store SUSPENDED giữ nguyên; hydrate/Cart/Checkout
  chặn canonical khi index chưa catch up. Live index integration thuộc Đạt riêng.
- GET list/Accounts adapter giữ tương thích; dialog revision/reason/409 draft;
  timeout không tự replay mutation hoặc tự tăng revision.

Tất cả ca TARGET trên hiện NOT_RUN cho implementation hardening. Đề xuất này
không thay kết quả #85 (ownership transaction đã kiểm riêng).
