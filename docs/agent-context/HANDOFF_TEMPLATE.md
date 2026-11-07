# <TASK-ID> — <agent> — <YYYY-MM-DD HH:mm Asia/Saigon>

- Trạng thái: PLANNED / IN_PROGRESS / BLOCKED / SOURCE_REVIEWED / TESTED_LOCAL / DONE / PAUSED.
- Yêu cầu và acceptance criteria:
- Checkout, branch, HEAD:
- WIP file SHA256 hoặc diff hash (HEAD không chứa WIP):
- Worker / reviewer, model / effort:
- File được giao / thực tế đã đổi:
- Môi trường: DB riêng, actor giả lập/thật, ports; KHÔNG credentials:
- Đã thực thi: lệnh an toàn + kết quả PASS/FAIL/SKIP/TODO và artifact sanitized:
- Review: CONFIRMED / HYPOTHESIS / OPTIONAL; xử lý và source sau sửa:
- Bằng chứng state/ledger nếu liên quan tiền/kho/quyền/replay:
- Chưa chạy, giới hạn và ca bị thay thế (không xóa fail cũ):
- Blocker cần owner (nếu có, chỉ rõ vì sao):
- Bước tiếp theo và người nhận:
- Lệnh có mutation/mail/provider/chi phí: đánh dấu rõ; KHÔNG chạy tự động khi resume.
- Tuyên bố được phép: local / integrated / staging / sandbox; không vượt mức bằng chứng.

Worker lưu bản điền tại `handoffs/<date>-<task>-<agent>.md`, không sửa template hoặc CURRENT. Coordinator kiểm chứng rồi cập nhật ngữ cảnh chung.
