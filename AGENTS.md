# Hướng dẫn dành cho AI và coding agent

## Ngữ cảnh chung Codex–Gemini–Claude

Trước khi nhận task hoặc tiếp tục sau gián đoạn, bắt buộc đọc `docs/agent-context/README.md`, `CURRENT.md`, `DECISIONS.md`, `WORKBOARD.md` và `PROTOCOL.md` trong cùng thư mục. Bộ này lưu quyết định owner, bằng chứng và bàn giao; kiểm lại branch/HEAD/working tree trước sửa. Không lấy checkpoint cũ làm trạng thái runtime hiện tại. Không sao chép secret vào ngữ cảnh. Tiếp tục đọc các tài liệu bắt buộc bên dưới khi task liên quan.

Trạng thái tạm dừng/đang làm xem CURRENT.md; owner đã yêu cầu thực thi kế hoạch cuối ngày30/10. Thực hiện trong phạm vi đã giao, không hỏi lại quyền đã có. Trong lúc quota bị giữ, không push/merge/kích Actions; không tự gửi mail, mở tunnel hay tạo resource chỉ vì checklist ghi bước tiếp theo. Argon/Claude tối đa Medium, Flash tối đa High (lịch sử; **thay bởi D19 ngày 01/11**: Codex Astra Low, Codex khác Medium, Antigravity mạnh ≤ Medium, Antigravity nhẹ Medium, Claude leader ≤ Medium; Claude là coordinator hiện hành). D04 trong DECISIONS ghi phạm vi review AI owner đã cho phép; không miễn kiểm thử hoặc mặc nhiên duyệt mọi thay đổi contract/migration tương lai.

Trước khi sửa source của candidate, đối chiếu `docs/agent-context/CANDIDATE_BASELINE.json` và Git diff. Baseline gắn source commit91f4d90 sau QA Seller/SKU; hash lệch phải xác định thay đổi có chủ đích, không reset/restore tự động. `WIP_BASELINE.json` là snapshot lịch sử MEM01 của8Sellerfiles trước commitc18, không phải khóa WIP hiện tại. Coordinator cập nhật baseline khi bàn giao đã kiểm chứng; không dùng thay CI. Quyền theo từng ca email/provider/TOS vẫn giữ giới hạn riêng.

Trước khi sửa code, phải đọc theo thứ tự:

1. `README.md`
2. `docs/architecture/system-architecture-overview.md`
3. `docs/project/work-assignment.md`
4. `docs/project/implementation-scope.md`
5. `docs/analysis/marketplace-business-processes.md` nếu task liên quan phân tích nghiệp vụ, SRS, ERD, test case hoặc báo cáo
6. `CONTRIBUTING.md`
7. `docs/git/team-task-delivery-guide.md`
8. `docs/api/ai-service-contract.md` nếu task liên quan sản phẩm hoặc tìm kiếm
9. `docs/architecture/product-domain-design.md` nếu task liên quan sản phẩm, database, Seller, giỏ hàng, đơn hàng hoặc dataset
10. `docs/architecture/product-implementation-plan.md` nếu task triển khai schema, migration, API, import hoặc đồng bộ tìm kiếm của miền Product
11. `docs/architecture/chat-domain-design.md` nếu task liên quan Chat, WebSocket hoặc inbox

Quy tắc bắt buộc:

- Không commit trực tiếp vào `main` hoặc `develop`.
- Không tự merge pull request.
- Giữ nguyên thay đổi ngoài phạm vi task và công việc của thành viên khác.
- Không dùng `git reset --hard`, `git clean -fd` hoặc `git push --force`.
- Không commit `.env`, secret, dataset lớn, ảnh upload, model weight, embedding hoặc FAISS index.
- Không mô tả một chức năng trong báo cáo là đã triển khai nếu chưa có luồng chạy, dữ liệu demo và bằng chứng kiểm thử theo `docs/project/implementation-scope.md`.
- PostgreSQL là nguồn dữ liệu nghiệp vụ chính; Elasticsearch và FAISS là index phụ trợ.
- `productId` là số nguyên do PostgreSQL sinh và dùng xuyên suốt Backend, API, Elasticsearch và FAISS.
- `externalId` là mã truy vết tùy chọn của dữ liệu import, có dạng `<source>:<source-id>` như `abo:B07ABC123`; prefix phụ thuộc nguồn, còn sản phẩm Seller tạo có giá trị null.
- Database sản phẩm phải đa ngành hàng; giá và tồn kho thuộc ProductVariant, giỏ hàng tham chiếu variant, đơn hàng lưu snapshot.
- Thay đổi database phải tạo migration mới; không sửa migration đã được merge và dùng chung.
- Thay đổi contract Backend–AI phải cập nhật `docs/api/ai-service-contract.md` và được Hoàng, Đạt cùng review.
- Chạy kiểm tra phù hợp và báo kết quả trước khi bàn giao.

Nếu tài liệu cũ có ví dụ `productId: "P001"`, quyết định mới trong `docs/api/ai-service-contract.md` và file này được ưu tiên: dùng `productId: 125`; khi `P001` đến từ nguồn import thì lưu dưới dạng có namespace, ví dụ `internal:P001`.
