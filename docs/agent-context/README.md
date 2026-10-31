# Bộ nhớ chung Codex – Gemini – Claude

Đây là ngữ cảnh lưu bằng file cho ba agent của dự án BCKL_ThuongMaiDienTu. Không phải cơ chế chia sẻ toàn bộ hội thoại hoặc cam kết model tự nhớ giữa các phiên. File entry hỗ trợ khám phá; coordinator vẫn phải truyền context hoặc yêu cầu đọc rõ ràng khi gọi CLI.

## Mỗi phiên đọc trước

1. `CURRENT.md`: mốc hiện tại, việc dở, trạng thái đã và chưa kiểm.
2. `DECISIONS.md`: quyết định owner còn hiệu lực.
3. `WORKBOARD.md`: ưu tiên, phân công, phạm vi file và điều kiện đóng.
4. `PROTOCOL.md`: cách giao việc, review và cập nhật bộ nhớ.
5. Tài liệu miền bắt buộc được liệt kê trong `AGENTS.md` ở root checkout.

Trước khi sửa code candidate hoặc giao worker sửa, đối chiếu `CANDIDATE_BASELINE.json` (source094d455). `WIP_BASELINE.json` giữ nguyên snapshot lịch sửMEM01 trước Sellerc18; không đối chiếu nó như baseline hiện tại. Nếu hash lệch, dừng ghi vào các file liên quan, xác định thay đổi và báo coordinator; không reset, tự restore hay cập nhật hash để che sai lệch. Có bản snapshot riêng 8 file tại root máy `machine-local/shared-context-20261030/seller-wip-snapshot/`, không phải bản backup offsite hoặc quyền tự phục hồi.

Kiểm branch, HEAD, working tree; nếu làm runtime thì kiểm health và DB đích trước. Bản ghi là bằng chứng lịch sử có ngày, không phải phép đo trực tiếp của phiên mới.

## Nơi lưu

| File | Vai trò | Người cập nhật |
|---|---|---|
| CURRENT.md | Tóm tắt ngắn để bắt đầu lại | Coordinator sau khi kiểm bằng chứng |
| CANDIDATE_BASELINE.json | SHA256 source candidate Seller/SKU, gắn source094d455 và provenanceQA | Coordinator sau checkpoint kiểm chứng |
| WIP_BASELINE.json | SHA2568Sellerfiles lịch sửMEM01 trướcc18, không phải WIP hiện tại | Giữ lịch sử |
| DECISIONS.md | Quyết định và giới hạn được owner xác nhận | Coordinator; chỉ ghi nguồn và phạm vi thực |
| WORKBOARD.md | Task, phụ thuộc và file ownership | Coordinator trước/sau giao việc |
| PROTOCOL.md | Quy trình chung | Coordinator sau review |
| HANDOFF_TEMPLATE.md | Mẫu bàn giao cho từng lượt | Worker điền bản riêng trong `handoffs/` |
| handoffs/*.md | Bàn giao thực tế từng agent | Chỉ agent được giao file đó |

Với reviewer read-only/sandbox, coordinator lưu output thay reviewer, kèm model/effort, phạm vi snapshot và hash; không giả reviewer đã ghi file hoặc chạy kiểm thử.

Các file này được thiết kế không có secret và có thể review trong Git; được commit local sau review; **chưa push/merge**. Artifact riêng, log provider và credentials vẫn ở `machine-local/` ngoài Git. Không chuyển chúng vào đây. Đọc thêm báo cáo owner tại `C:/Vo Minh Hoang/BCKL_2026/BAO_CAO_CHANG_CUOI_2026-10-30.md` khi cần; link đó chỉ có trên máy này.

Khi chuyển máy: mang bộ nhớ cùng code; mang riêng cấu hình/backup theo hướng dẫn migration. Khi đổi checkout: coordinator phải ghi lại root đang dùng, không âm thầm sửa nhiều checkout.
