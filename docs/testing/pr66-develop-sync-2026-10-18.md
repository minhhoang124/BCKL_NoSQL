# #66 đồng bộ Chat foundation — 18/10/2026

Input `7db73ec`, develop `aa62c84`. Conflict chỉ kiến trúc, giữ Chat foundation
và toàn nền resolver/Brand/tooling/readiness. Không bỏ một phía; không thay
schema/migration/Auth/Order/ChatModule/API/Socket/inbox. Policy dùng facts từ
server; history của Buyer active vẫn đọc được khi Store owner bị khóa, nhưng
không gửi. Store SUSPENDED chỉ gửi khi có bằng chứng giao dịch đúng cặp; cờ
client không phải bằng chứng. Sequence/read cursor không đi lùi; chưa cấp
sequence hoặc bảo đảm idempotency bằng database.

## Kiểm mới trên cây kết hợp

- 68 policy/request tests gốc PASS trước thêm ca biên; không sửa implementation.
- Thêm9regression tests:6ký tự kết thúc dòng/biên vượt128 bị chặn và3printable
  ASCII boundaries hợp lệ. **Không tái hiện bypass**; không tuyên bố đã fix bug.
- Full Backend **706 PASS /29file**, gồm77Chat tests (không cộng lần nữa).
- Backend lint/typecheck/Nest build PASS; Prisma generate chỉ tạo client local.
- Full FE **432 PASS /6liveSKIP**,30filePASS/1SKIP; lint/TypeScript/Vite build
  PASS,5warning Admin nền giữ nguyên. Backend log lỗi thuộc mock/fault tests.
- Source identity: `chat-policy.ts` và `chat-message-request.ts` nguyên byte so
  7db73ec; Backend domains khác và schema/FE/AI/lockfile từ develop giữ nguyên.

Diff-check/conflict checks trước push; không còn file unmerged. Các số662unit
trong ghi nhận trước là lịch sử, không thay lượt706mới. Browser/DB/REST/Socket
runtime **NOT_RUN**, chưa Chat hoạt động. Hiền review delta mới + CI đúng head
trước quyết định Ready/merge; approval7db73ec không thay bản kết hợp/test mới.
