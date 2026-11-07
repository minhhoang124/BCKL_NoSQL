# Admin #28 — bàn giao QA có giới hạn, 16/10/2026

> Bổ sung sau review: [sửa mất draft Catalog và đồng bộ develop `035656b`](admin-catalog-draft-fix-sync-2026-10-16.md). Báo cáo này giữ nguyên baseline QA `abe4a14`, không phải kết quả runtime bản sửa mới.

**Trạng thái: QA PARTIAL; đề nghị Hoàng review phần có bằng chứng, chưa nghiệm thu toàn bộ Admin hoặc giai đoạn 3.**

## 1. Baseline và cách đọc bằng chứng

- Nhánh `feat/hien/admin-ui-orange-v1`; source chạy QA: `abe4a14a11f4c2190fcc121e32732d4e4bb16394`.
- Source này hợp nhất `071f28a` với `develop 09daae0`, sau #54/#55; không gồm #56/#57. Tại lúc chuẩn bị bàn giao, remote develop vẫn là `09daae0`.
- Đối chiếu Git với `071f28a`: Admin code/CSS/test, Auth, shared API client/guard, Address/Cart, toàn Backend/AI và lockfile không đổi. Router chỉ thêm Checkout guard USER, giữ route Admin/Address/Cart; các module Checkout/Order mới thuộc phần nền đã merge.
- Đối chiếu từ `1260a47` cũng không có delta ở Admin code/CSS, Backend Store và shared API client liên quan bằng chứng Store suspend/reactivate.
- Commit bổ sung báo cáo này chỉ sửa Markdown; không thay source ứng dụng hoặc ghi dữ liệu QA. Không đổi nhãn kết quả cũ thành lượt chạy mới vì thay commit tài liệu.
- Dựa trên [phân công](../project/work-assignment.md), [phạm vi triển khai](../project/implementation-scope.md), [nghiệp vụ](../analysis/marketplace-business-processes.md), [kế hoạch QA Admin](admin-ui-backend-qa.md), UI thực tế và snapshot PostgreSQL trước/sau. PostgreSQL là nguồn chuẩn; trạng thái trên màn hình không tự chứng minh history/idempotency.

## 2. Kết quả trên source `abe4a14`

| Kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| FE hồi quy | 284 PASS, 4 live SKIP; 23 files PASS / 1 suite SKIP; lint/typecheck/Vite build PASS | Lint còn 5 warning nền; không tính live suite là PASS, không frozen-install mới |
| Backend / quyền đọc | Build, health/DB và 13 migration đạt; guest 401, Buyer/Seller 403; hai Admin đọc queue/detail/Store/catalog khớp DB | API smoke không thay browser RBAC mọi route; login tạo session, snapshot chỉ so trường nghiệp vụ đã chọn |
| Product 58 duyệt | PENDING v5 → APPROVED v6; history 0 → 1, đúng Admin A | Native confirm do Hiền bấm; chưa full browser HTTP trace |
| Product 58 đóng băng | APPROVED v6 → FROZEN v7; thêm một history, đúng reason; reason chỉ dấu cách khóa nút | Không nghiệm thu gỡ FROZEN hoặc mọi lỗi validation |
| Product 59 từ chối | PENDING v5 → REJECTED v6; một history, đúng reason; rỗng/dấu cách khóa nút | Không suy ra mọi race/double-submit đã bao phủ |
| Store 9 / 10 | PENDING → ACTIVE / REJECTED; mỗi Store history 1 → 2, reason UI/DB khớp; thiếu reason bị chặn, DB không đổi | Chưa kiểm toàn vòng Seller sửa/nộp lại |
| Product 60 hủy xác nhận | Hiền bấm Cancel; vẫn PENDING v5, history 0; snapshot nghiệp vụ đã chọn không đổi | Không có trace chứng minh mọi request mạng bằng 0 |
| Hai Admin / phiên bản cũ | B duyệt Product 60 → APPROVED v6; A giữ v5 bị báo phiên bản thay đổi và khóa quyết định; GET thử lại thấy v6; DB chỉ một history actor B | Chrome ẩn danh B do Hiền thao tác; trợ lý kiểm A + DB, chưa tự capture cookie-isolation/Chrome B hoặc raw HTTP 409; không gọi automated two-browser E2E |
| Đăng xuất → reload → mở thẳng `/admin` | Ba bước đều về Login, không Admin shell/data; 5 API Admin không token trả 401; snapshot nghiệp vụ trước/sau khớp | Không chứng minh access JWT cũ bị revoke ngay, logout mọi thiết bị hoặc token expiry |
| Ảnh/detail fixture mới | Product 58 tải ảnh thật 640×640, giá/kho/kiện hàng hiển thị đúng dữ liệu | Fixture cũ có URL sai cổng chưa được nhận là đã sửa hết |

Chạy trên database QA riêng, không reset database demo/manual QA; không tạo Order. Search/repair/reconciliation/auto-complete workers tắt, nên outbox phát sinh không phải bằng chứng Search end-to-end. Fixture mới được tạo qua API, không đổi schema/source hoặc reset fixture cũ. Các hộp xác nhận native có Hiền phối hợp; không dùng mock thay quyết định thật.

## 3. Bằng chứng lịch sử được giữ đúng baseline

| Phần | Baseline và kết quả đã có | Không suy rộng |
| --- | --- | --- |
| Access hết hạn / refresh | `071f28a`: TTL QA process-only 20s/60s, access hết hạn thật → queue 401 → refresh 200 → queue 304; DB xác nhận rotation | Không phải lượt chạy mới trên `abe4a14`; không bao phủ account bị khóa hoặc tự ẩn khi idle |
| Refresh hết hạn | `071f28a`: queue 401 / refresh 401 → Login; reload/direct Admin vẫn Login; đã khôi phục TTL mặc định | Không nhận mọi thiết bị/phiên đã revoke |
| Mất phản hồi sau commit | `071f28a`: proxy cắt response sau upstream 200; UI khóa quyết định; GET lỗi 503 rồi phục hồi; DB một history, log một POST | Không bao phủ lỗi trước commit hoặc mọi double-submit |
| Category/Brand | `071f28a`: tạo cây cha/con và Brand, validation/trùng slug, Category rename, bật/tắt/reload; UI chặn cycle | Thiếu snapshot DB đúng thời điểm cycle; fixture không liên kết Product, không nghiệm thu public/index |
| Responsive/dark preference | `071f28a`: viewport 360/390 và desktop Catalog 1366, màn Admin chính; chữ/nút chính đọc được khi Admin giữ nền sáng | Không phải thiết bị cảm ứng thật, full keyboard/screen reader/zoom/WCAG hoặc kiểm sáng đối chứng |
| Store suspend/reactivate | `1260a47`: ACTIVE → SUSPENDED → ACTIVE, history 6 → 7 → 8, reason đúng | Cùng code liên quan nhưng chưa rerun trên `abe4a14` |
| Backend unit / PostgreSQL E2E | `071f28a`: 594 unit; 560 E2E / 28 suites, fresh DB riêng migrate 13 → seed → test, exit 0 | Backend tree không đổi; không ghi thành test vừa chạy hoặc cộng các baseline thành một lượt |

Nhật ký, snapshot DB, log và ảnh gốc được giữ local. Báo cáo này là tóm tắt đã lọc, không chứa tài khoản/mật khẩu/token/config hoặc ảnh fixture có dữ liệu đăng nhập. Kết quả lịch sử đã có không tự chuyển thành NOT_RUN chỉ vì đổi baseline; chỉ retest chọn lọc khi có delta/rủi ro cụ thể cần kiểm.

## 4. Phần chưa hoàn thiện / chưa đủ bằng chứng

Chức năng chưa đủ để nhận toàn bộ Admin: account list/status UI, attribute editor, hậu mãi Admin, dashboard/doanh thu/health thực, Brand sửa tên/slug. Không tự bỏ hoặc hạ ưu tiên P0/P1 đã chốt vì đang xin review một phần.

Bằng chứng còn thiếu: attribute false/0/options; Catalog có Product và tác động public/index; account mất quyền khi đang mở trang; double-submit có quan sát mạng; lỗi trước commit/race tổng quát; touch/keyboard/screen reader/zoom/contrast đầy đủ. Login/Header khó đọc ở dark preference đã quan sát, nằm ngoài delta Admin; cần task CSS/phân công riêng, không tự sửa Auth/theme toàn hệ thống.

CI đúng head được push, fresh-checkout và review của thành viên khác phải kiểm riêng. Local PASS không thay CI hoặc quyết định nghiệm thu. Không dùng hồ sơ Admin này để xác nhận Checkout/Order/Search Web end-to-end hoặc Precision/Recall.

## 5. Đề nghị Hoàng review

1. Review đúng head được push và code/bằng chứng của hàng chờ, Product moderation, Store và Catalog hiện có; chốt phần có thể chấp nhận với giới hạn trên.
2. Nếu cần bổ sung runtime evidence, chỉ rõ ca/rủi ro và baseline cần kiểm; không mặc định chạy lại toàn checklist đã đạt trên code không đổi.
3. Chốt API/phân công cho các chức năng còn thiếu và task CSS dùng chung; không tự đổi contract/schema trong lượt bàn giao này.

Giữ Draft / G-ADMIN PARTIAL; không tự merge hoặc nhận toàn bộ giai đoạn 3 DONE. Báo cáo trước đồng bộ tại [mốc sau Checkout/Order](admin-ui-post-checkout-sync-2026-10-16.md) và [QA Admin lịch sử/kế hoạch](admin-ui-backend-qa.md) vẫn giữ nguyên ý nghĩa theo thời điểm.
