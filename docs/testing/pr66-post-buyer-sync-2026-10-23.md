# Chat foundation #66 — kiểm lại 23/10/2026

Nhận develop `9969f58` sau Buyer #95/#96/#99, race tests #98 và QA #51.
Integration tree `1aa467bbf25b8b825bf458d72c3473024e782317`.
Conflict chỉ overview, giữ đủ hai phía. Chat policy/request/SQL experiment
nguyên byte `8fd194a`; BE/Prisma ngoài Chat, FE, AI và lockfile không đổi nền.

Kiểm mới:

- Full Backend sau Buyer sync: **1113unit PASS/49files,24.52s**, gồm79Chat
  cases, không cộng subset vào tổng; lint/typecheck/Nest build PASS.
- Sau nhận QA #51: **79/79 Chat cases PASS**,2files,811ms; **10/10 guard
  Node tests PASS**. Chỉ thêm QA script/package/CI từ nền chính thức, production
  BE/Prisma/FE/AI source không đổi nên không nhận chạy full lần nữa.
- 17migrations nền deploy trên DB QA mới riêng
  `bckl_order_resolution_test_chat_20261023_v920`, loopback5549; Prisma generate
  PASS. Đây **không phải migration Chat** hoặc bằng chứng Message đã lưu.
- Diff-check PASS; no schema/AppModule/controller/socket/inbox mới, không
  Chat runtime/E2E/browser mới, không demo hoặc thay đổi Search contract.

Thiết kế #41 đã merge `aa62c84`: Hiền chốt bằng chứng giao dịch ở Store
SUSPENDED, account-lock/recipient boundary, per-Conversation sequence và quota
20send/10open/60read mỗi phút. Nội dung PROPOSED cũ của readiness là lịch sử,
không lý do phải tiếp tục chờ tài liệu cho các quyết định đã được duyệt.
Runtime tiếp theo phải cập nhật domain từ cursor(createdAt,id) sang sequence,
thêm migration/unique/FK và chứng minh cạnh tranh bằng PostgreSQL thật.

Policy hiện theo Auth một roleUSER/SELLER đã có, không tự mở khả năng Seller
mua ở Store khác trong foundation. Capability đa vai vẫn là target theo scope,
không được nhận đã giải quyết bởi module này. Admin không mặc định đọc chat;
giao dịch cũ là fact server, không clientboolean/tuổi Conversation.

Hoàng cho phép exact-head owner exception không cần chờ humanRV khi kiểm đủ.
Không nhận approval cũ thành approval mới hoặc dùng CI billing như CI xanh.
Merge nền này không có nghĩa Chat/G-AFTERSALE DONE hoặc bật tính năng media.
