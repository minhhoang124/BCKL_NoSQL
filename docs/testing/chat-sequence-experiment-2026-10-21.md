# Chat sequence — thử nghiệm SQL trước migration

21/10/2026, `BE/scripts/chat-sequence-probe.mjs`. Không ChatModule/controller,
schema Prisma hoặc migration. Chỉ là bảng fixture trong schema UUID riêng.

## Chạy lại

PostgreSQL17 loopback5549, DB riêng tên đúng
`bckl_order_resolution_test_chat_sequence`. Đặt DATABASE_URL qua môi trường
riêng, không dotenv hoặc in credential. Script chặn host/port/DB ngoài allowlist,
query/hash; không tự tạo database và không truy cập schema public.

`node BE/scripts/chat-sequence-probe.mjs`

Script tạo rồi dọn đúng schema UUID của lần chạy, giữ database trống riêng.
Không xóa dữ liệu demo/DB thành viên. Query có statement timeout3s trong writer.

## Kết quả thực nghiệm

Lượt local PostgreSQL17 thật:4nhóm assertion PASS:

1. 5connection đồng thời gửi một hội thoại:5tin, sequence1..5.
2. Cùng client key/cùng payload trả cùng ID; payload khác bị từ chối, không tin thừa.
3. Lỗi sau INSERT+update parent rollback cả hai. Serial ID có khoảng trống nhưng
   sequence commit vẫn liên tục; không lấy global ID làm cursor hội thoại.
4. Hai trang cursor không trùng/đảo tin; hội thoại thứ hai có sequence riêng.

Writer fixture khóa Conversation FOR UPDATE trước tìm replay/cấp sequence và
ghi message, dùng transaction ReadCommitted. Quyền/eligibility production chưa
được mô phỏng; không suy giao thức này đã giải mọi race Auth/Store suspension.

## Gate còn lại

Đây là bằng chứng cho đề xuất sequence trong chat-implementation-readiness,
không tự thay domain `(createdAt,id)` trước Hiền duyệt. Cần chốt:

- sequence per-conversation cho history/read/recovery, lastReadMessageId resolve
  sang sequence; FK cùng hội thoại, con trỏ chỉ tiến.
- quota và bằng chứng giao dịch cũ khi Store SUSPENDED.
- account bị khóa không gửi/nhận payload mới; đọc lịch sử theo actor/membership.
- video/ảnh/Order context là mở rộng cần contract riêng; chưa triển khai trong #66.

Không API/HTTP/socket/browser/restart/inbox/unread test trong script. Không coi4nhóm
assertion là4E2E Chat production hoặc G-AFTERSALE DONE.
