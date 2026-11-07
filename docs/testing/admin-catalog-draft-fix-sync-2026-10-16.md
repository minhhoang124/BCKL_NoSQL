# Admin #28 — sửa draft Catalog và đồng bộ develop, 16/10/2026

**LOCAL / QA PARTIAL.** Sửa finding của Hoàng trước khi xin re-review #28; không thêm attribute editor hoặc nhận toàn bộ Admin đã nghiệm thu.

## Finding và baseline

Review Changes requested của `grumhu124` trên `071f28a`: giữ PATCH Category A pending, chọn B/nhập draft B rồi cho A trả thành công; callback reset form/selectedId làm mất draft B. Control tree/Create/Cancel/input còn dùng khi busy. Form tạo Brand có cùng rủi ro vì reset vô điều kiện sau POST.

Trước sửa, nhánh #28 tại `d37ef1a` (source `abe4a14`, develop `09daae0`). Lượt này lấy `develop 035656b` sau #56/#57, không lấy feature branch chưa merge. Conflict duy nhất là kiến trúc; giữ nội dung Admin cùng Order/read/recovery và các mốc lịch sử. Router giữ Admin shell riêng đồng thời giữ nguyên Checkout, Account/Seller Order, Address và Cart. Backend/AI/lockfile/Auth/client/Address/Cart và Order modules giống develop; không đổi schema/contract.

## Cách sửa

- Khóa tree selection, Create new, Cancel edit, input/select Category, input Brand, tab Catalog, refresh/retry trong lúc write pending; giữ mutation ref chặn bấm nhanh.
- Chỉ reset draft đã khóa sau write thành công. Khi write trả lỗi, giữ name/slug/parent và mở lại chỉnh sửa; không báo thành công giả.
- Theo dõi lần đọc Catalog thành công riêng. Khi refresh lỗi, giữ draft/selectedId và nhãn sửa; khóa write khi chưa tải được dữ liệu. Sau GET thành công nhưng Category đang sửa đã biến mất, vẫn không gửi nhầm POST tạo mới; người dùng phải hủy draft rõ ràng hoặc đối chiếu lại.
- Không refactor Product/Store/Auth hoặc nhập module Brand editor riêng; form Brand được rà trong finding là form **tạo Brand cũ của #28**.

## Kiểm chứng mới

| Kiểm tra | Kết quả |
| --- | --- |
| Test trước sửa | Hai test khóa pending Category/Brand FAIL vì controls chưa disabled; test lỗi save giữ draft PASS |
| Test Admin trên bản sửa/hợp nhất | 15 PASS, gồm 5 hồi quy Catalog mới |
| Full FE `pnpm --dir FE exec vitest run --maxWorkers=1` | 361 PASS / 6 SKIP, 26 files PASS / 1 suite SKIP |
| FE lint | PASS exit 0, còn 5 warning set-state-in-effect nền, không gọi warning-free |
| TypeScript/Vite build | PASS |
| Diff/conflict checks | Không còn marker conflict; giữ đủ route/module đã merge, chỉ Admin shell khác router develop như #28 trước đó |
| Browser với Backend/PostgreSQL thật trên source `ab60dd8` | PARTIAL: Hiền thao tác UI, gửi ảnh lỗi và xác nhận giữ draft; đối chiếu PostgreSQL chỉ đọc như mục dưới. Không ghi pending controls đã được quan sát trên browser |
| Backend unit/E2E, Search runtime | Không rerun, source Backend/AI không đổi; không dùng test lịch sử thay kết quả mới |

Năm hồi quy mới: (1) Category pending khóa selection/Create/Cancel/input/tab/refresh rồi chọn B sau khi A hoàn tất, chỉ một PATCH A; (2) Category save lỗi giữ draft; (3) Brand pending khóa input/tab/refresh; (4) Brand lỗi giữ draft; (5) refresh lỗi hoặc Category mất khỏi GET không làm mất draft/identity hoặc chuyển thành POST tạo mới.

Test pending dùng deferred mock response trong jsdom, không phải HTTP/DB hoặc browser delayed-network. Chưa kiểm thao tác route rời Catalog trong khi ghi, crash/reload giữa write hoặc idempotency/race tổng quát; không mở rộng kết luận beyond finding.

## Giới hạn và bước tiếp theo

### QA Catalog chọn lọc bổ sung ngày 16/10/2026

Docker/PostgreSQL QA riêng đang chạy; frontend và Backend health trả HTTP 200. Không reset database. Tạo fixture Category A `id=8`, B `id=9` và Brand `id=5` qua Admin API; không dùng dữ liệu demo để nhận nghiệm thu production.

- **Danh mục trùng slug:** ảnh Hiền gửi thể hiện lỗi “Slug danh mục đã tồn tại”. Hiền xác nhận ô nhập giữ nguyên sau lỗi. Đây là xác nhận thao tác của người kiểm, không phải ảnh chụp đầy đủ form danh mục sau lỗi.
- **Lưu A sau sửa slug:** PostgreSQL xác nhận A có tên `QA Draft A ab60dd8 update`, slug `qa-draft-ab60dd8-af78e8a4-a-updated`; B vẫn là `QA Draft B ab60dd8`, slug `qa-draft-ab60dd8-af78e8a4-b`. Không kết luận đã quan sát riêng bước reload từ bằng chứng này.
- **Thương hiệu trùng slug:** ảnh thông báo “Slug thương hiệu đã tồn tại”, ảnh form tiếp theo vẫn có tên `QA Draft Brand New` và slug `qa-draft-ab60dd8-af78e8a4-brand`. DB vẫn giữ Brand fixture cũ, tổng 4 Brand; không phát sinh Brand mới.
- **Nguồn đối chiếu:** ảnh và xác nhận Hiền trong chat, snapshot PostgreSQL chỉ đọc sau thao tác lưu tại bộ QA local. Không đưa cấu hình kết nối, tài khoản hoặc token vào repository.
- **Chưa kiểm bằng browser thật:** trạng thái khóa controls trong khoảng HTTP pending, refresh GET lỗi/mất Category, rời route hoặc reload giữa write. Các ca deferred pending/GET lỗi chỉ có test tự động nêu trên; không nâng thành browser PASS.

Giữ Draft/G-ADMIN PARTIAL. Hồ sơ Product/Store/ảnh/refresh/network trước đó ở [bàn giao QA cũ](admin-ui-handoff-2026-10-16.md) giữ baseline `abe4a14`/`071f28a`/`1260a47`; không gọi là retest trên bản hợp nhất này. QA mới chỉ giới hạn Catalog như trên, không tự giao lại toàn checklist cũ.

Backend thuộc tính/lựa chọn do Hoàng nhận PR riêng; Hiền review contract rồi nối UI sau merge. Brand editor, Accounts/Dashboard layout vẫn ở nhánh riêng, không gộp #28. Bản bổ sung này chỉ thay tài liệu trên source `ab60dd8`; kết quả test/lint/build bên trên thuộc source đó. CI head được push cần kiểm riêng. Không tự merge PR hay resolve feedback trên GitHub.
