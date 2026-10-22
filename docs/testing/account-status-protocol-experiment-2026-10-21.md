# Accounts status — SQL prototype 21/10/2026

Mục đích: cung cấp bằng chứng cho protocol trước migration/JWT rollout theo #76.
Script `BE/scripts/account-status-protocol-probe.mjs`, không được import vào app.
Không thay code Accounts runtime của #85/source48477c8.

## Môi trường và cách chạy

PostgreSQL17 riêng loopback5549, database đúng
`bckl_order_resolution_test_account_status_protocol`. Đặt DATABASE_URL riêng,
không .env/credential trên Git. `node BE/scripts/account-status-protocol-probe.mjs`.
Guard chặn host/port/database khác, query/hash; script không tự tạo database.
Mỗi lượt tạo schema UUID, dọn đúng schema này trong finally. Không schema public
hoặc dữ liệu demo5432. Không thay migration đã dùng chung.

## Bằng chứng và thuật ngữ

Fixture account gồm role/active/revision/epoch; token/audit/job là bảng fixture,
không phải JWT/RefreshToken/SearchReconciliationJob production.

Status writer: Serializable + advisory transaction lock + User theo ID tăng;
đọc lại current actor/target. Chỉ retry40001/40P01 tối đa3attempt. SQL experiment
khóa actor/target và tất cả Admin; contention khi số Admin lớn chưa đo, không
tự nhận đây là protocol production tối ưu hoặc bảo vệ mọi writer trực tiếp.
Refresh fixture khóa User trước kiểm epoch và insert token, không đảo thứ tự.

6nhóm assertions PostgreSQL thực:

1. Hai Admin khóa nhau: một CHANGED, một ACTOR_FORBIDDEN, ít nhất1Admin còn active.
2. Hai writer cùng revision: một CHANGED/một STALE. No-op, stale và self-lock
   không phát việc thừa; không nhận riêng nhánh LAST_ADMIN đã được chứng minh.
3. Fault ở audit/job/revoke: rollback state/revision/epoch/tokens/audit/job.
4. Khóa rồi mở: epoch0 cũ bị từ chối, epoch1 mới được cấp fixture token.
5. Giữ lock User ở refresh bằng barrier rồi cho status chạy: token được cấp
   trước bị lock thu hồi; refresh sau lock bị từ chối. Không suy từ đây đã kiểm
   JWT signature/cookie/in-flight HTTP hoặc toàn bộ login races.
6. Revision/epoch int-max: EXHAUSTED, không wrap/reset hoặc partial write.

## Kết quả và giới hạn

Lượt đầu5nhómPASS; sau bổ sung overflow chạy lại6nhómPASS.
Đây không phải6runtimeE2E và không được cộng vào690unit/617E2E của #85.
Không AuthService/HTTP/Prisma migration/JWT claims hoặc session rollover được
thực thi trong script. Không audit-immutability trigger, reason handling,
cross-process crash/restart, global deployment rollback hoặc live Search.

Khi implementation thật vẫn cần test các writer thực, legacy token relogin,
API status-detail không phá list8fields, epoch/audit bất biến và rollback full
trên schema thật. Chưa bật UI khóa/mở hoặc tự chốt contract thay reviewer.
