# Quy tắc giao task và chọn model — owner 01/11/2026

Nguồn: owner trực tiếp yêu cầu Codex ghi thêm nguyên tắc phân công và mức sử dụng model. Tài liệu bàn giao cho coordinator Claude; chưa sửa cấu hình CLI hoặc file context mà Claude đang giữ quyền ghi.

## Vai trò

- Claude là leader/coordinator hiện hành, owner trao đổi trực tiếp với Claude. Thay vai trò đồng leader trước đây trong việc điều phối hiện tại.
- Claude chia task cho Codex và Antigravity theo năng lực, độ khó và phạm vi file. Codex/Antigravity trả kết quả và review theo task; không tự giành coordinator.
- Chỉ một writer trên mỗi file; worker không tự giao tiếp vòng lặp hoặc gọi tiếp agent khác trừ khi leader giao quyền cụ thể và giới hạn rõ.

## Chọn model và effort

Chọn model phù hợp độ khó; không mặc định dùng model mạnh nhất cho mọi việc. “Low/Medium” là mức effort, không phải hạn mức tài khoản hay lời hứa về số token.

| Công cụ | Quy tắc hiện hành |
|---|---|
| Codex — Astra | Effort Low (“nhẹ nhàng” theo yêu cầu owner) |
| Codex — các model còn lại | Effort Medium (“mức vừa” theo yêu cầu owner); chọn model phù hợp task |
| Antigravity — model mạnh như Argon/Claude | Effort không vượt Medium; ưu tiên Low cho phần đơn giản nếu CLI/model hỗ trợ |
| Antigravity — model nhẹ | Effort Medium theo yêu cầu “tương tự” mới; không mặc định Flash High như ghi chú lịch sử |
| Claude Code leader | Effort không vượt Medium; được giao hỗ trợ khi cần, nhưng không mở phiên writer trùng file |

Nếu mức effort hoặc model không có sẵn, báo coordinator và chọn cấu hình có sẵn trong giới hạn; không giả cờ có hiệu lực. Không tự nâng High/xhigh/max để giải quyết lỗi. Ghi model và effort thực tế trong handoff.

## Nội dung bắt buộc khi giao task

1. Task ID, mục tiêu cụ thể, lý do ưu tiên và tiêu chí đạt.
2. Checkout/branch/base và snapshot WIP liên quan; prompt không giả HEAD bao gồm thay đổi chưa commit.
3. File được sửa, file chỉ đọc; xác nhận quyền writer trong WORKBOARD.
4. Model/effort được chọn và phạm vi review hay triển khai.
5. Lệnh kiểm phù hợp, QA DB/port riêng nếu có mutation, giới hạn thời gian/lượt gọi.
6. Cấm đọc secret ngoài nhu cầu đã cấp, cấm bypass permissions/sandbox, cấm ghi dữ liệu Demo/provider ngoài phạm vi.
7. Kết quả phải có diff/file hash, test đã chạy và kết quả thật, lỗi/giới hạn còn lại, hướng resume.
8. Người viết và reviewer khác nhau khi xử lý quyền, tiền, kho hoặc chống ghi trùng. Leader chỉ đóng task sau đối chiếu bằng chứng; thiếu PG/Chrome không được tự thay bằng unit PASS.

Quyền push/merge/deploy, mở tunnel, gửi email và cloud vẫn theo authorization riêng, không được mở rộng bởi thay đổi vai trò/model.

## Tiếp nhận

Claude coordinator đọc tài liệu này, ghi nhận vào DECISIONS/PROTOCOL/WORKBOARD khi an toàn với writer hiện tại. Giữ lịch sử và đánh dấu quy tắc model cũ bị thay thế ở phần tương ứng. Codex không tự sửa những file coordinator đang viết trong lượt bàn giao này.
