# Admin Accounts — đối chiếu API trước nối UI, 16/10/2026

**LOCAL / PREPARATION — chưa nối API, chưa gửi GitHub.** Đối chiếu `develop 035656b` sau fetch remote ngày 16/10. Giữ nguyên layout và mọi nhánh khác; không đổi Backend/schema/Auth hoặc dùng SQL để thay API danh sách.

## Căn cứ và kết quả kiểm tra chỉ đọc

- `docs/project/work-assignment.md`, giai đoạn 3 Hiền: danh sách User/Seller, khóa/mở; Hoàng hỗ trợ cấu trúc/API và review.
- `docs/project/implementation-scope.md`: account khóa không thao tác mới, giữ dữ liệu lịch sử; layout/API đơn lẻ không đủ nghiệm thu.
- `docs/analysis/hien/srs-v3.md`, FR-ADM-01: xác nhận/lý do cho hành động nhạy cảm; audit actor/entity/command/trước-sau/thời gian/correlation; bảo vệ Admin cuối cùng khi chưa có phương án khôi phục.
- `BE/src/auth/admin-account.controller.ts`: chỉ có `PATCH /admin/accounts/:userId/status`, guard JWT + ADMIN. Không có GET list/detail tại controller này. Rà các controller còn lại không thấy API danh sách User/Seller thay thế; `/auth/me` chỉ đọc tài khoản hiện tại, `/admin/test` chỉ thử quyền.
- `BE/src/auth/dto/update-account-status.dto.ts`: chỉ nhận boolean `isActive`. Không tự gửi reason, actorId, expectedVersion hoặc commandId chưa có contract.
- `BE/src/auth/auth.service.ts`, `updateAccountStatus`: update isActive trong transaction; Seller đổi trạng thái tạo reconciliation job. Chưa nhận actor/reason, chưa ghi audit quyết định account hoặc kiểm tự khóa/Admin cuối cùng trong hàm này. Không xóa Order/Cart/Store trong hàm, nhưng đây là đọc code, không phải kiểm DB bảo toàn mọi miền.
- Response PATCH hiện không đồng nhất trường: khi trạng thái đã giống yêu cầu trả id/role/isActive + job null; khi có thay đổi trả publicUserSelect + job. Không giả định luôn có fullName/email trong response status để viết đè toàn row UI.
- `jwt.strategy.ts` đọc user hiện hành và từ chối inactive; login/refresh cũng kiểm isActive. Không đồng nghĩa các refresh token đã bị thu hồi vĩnh viễn khi khóa: updateAccountStatus chưa revoke token. Chính sách khi mở lại cần chốt, không tự nhận phải đăng nhập mới hoặc phiên cũ dùng lại được.
- Test hiện có trong `BE/test/search-hydrate.e2e-spec.ts` gọi khóa/mở Seller và kiểm outbox khi chạy worker. Chưa rerun test đó trong lượt chỉ đọc này; không thay bằng chứng nghiệm thu Accounts UI.

## Những điểm cần Hoàng chốt / bổ sung

Đây là danh sách câu hỏi triển khai, **không phải contract đã được duyệt**, không tự đặt endpoint/payload mới.

1. **Đọc tài khoản:** route/method list (detail nếu cần), allowlist id/name/email/role/status, search/filter User/Seller và active/locked, phân trang ổn định, limit/tổng số, lỗi và quyền. Tuyệt đối không trả password hash/refresh token/identity secrets. Không dùng lọc client trên một trang dữ liệu rồi gọi là tìm toàn hệ thống.
2. **Phạm vi thao tác:** đề xuất màn này chỉ quản lý USER/SELLER; Backend phải kiểm đối tượng chứ không dựa vào việc UI ẩn ADMIN. Hoàng chốt quy tắc self-lock/Admin cuối cùng và thao tác nhạy cảm tương ứng SRS; không tự mở quản lý role.
3. **Lý do và audit:** contract reason/validation; actor lấy từ JWT, không từ body client; dữ liệu trước/sau, thời gian và correlation ghi cùng transaction với quyết định/job hoặc quy tắc đã review. Lý do trên preview hiện chỉ minh họa, chưa lưu được qua API cũ.
4. **Cạnh tranh / kết quả chưa rõ:** chốt expected state/version hoặc cơ chế tương đương; lỗi xung đột, replay/no-op và response ổn định. Không tự gọi boolean PATCH là an toàn để gửi lại: request khóa cũ có thể chạy sau một quyết định mở mới. Nếu chưa có resolution/receipt thì UI phải giữ trạng thái chưa rõ, không auto replay khi timeout/5xx.
5. **Phiên và dữ liệu lịch sử:** khóa phải chặn request mới của user; chốt thu hồi token và chính sách mở lại. Order/Store/Cart/history không bị xóa hoặc thay snapshot. Với Seller, job chỉ xác nhận được tạo, không chứng minh ES/FAISS đã đồng bộ.
6. **Điểm tích hợp:** sau khi contract/Backend đủ, thống nhất route/menu Admin và nền #28. Nhánh layout riêng không tự nhập #28 hoặc sửa router/Auth/client dùng chung.

## Checklist nghiệm thu để chạy sau khi có contract/API

Tất cả ca dưới đây **NOT_RUN** trong lượt này. Kỳ vọng có điều kiện theo contract được Hoàng chốt; không coi mã lỗi/payload đề xuất là API hiện hành.

| ID | Ca | Cần quan sát |
| --- | --- | --- |
| ACC-01 | Admin active đọc list | Đúng trang/filter/sort theo API; allowlist không có secret, DB khớp các row được phép |
| ACC-02 | Guest, USER, SELLER hoặc Admin inactive đọc/ghi | Backend từ chối theo contract; UI không giữ dữ liệu Admin của phiên cũ |
| ACC-03 | Query/filter/phân trang, rỗng và lỗi GET | Không nhầm chưa tải thành 0; không lọc giả toàn hệ thống; stale response không ghi đè query mới |
| ACC-04 | Xác nhận khóa/mở và Hủy | Hủy không gửi request; reason đúng contract; trong pending khóa điều khiển, chỉ một write |
| ACC-05 | Khóa USER bằng UI | DB đổi trạng thái đúng, audit đúng actor/trước-sau/lý do; token trước khóa bị chặn ở request mới |
| ACC-06 | Mở USER | Login/refresh theo chính sách đã chốt; dữ liệu lịch sử không mất; UI đọc lại từ Backend |
| ACC-07 | Khóa/mở SELLER | Giữ Store/Product/Order lịch sử; job đúng transaction. Public/Search eligibility kiểm riêng, không báo index DONE từ job |
| ACC-08 | Sai ID, reason sai, cùng trạng thái, mục tiêu ADMIN/self-lock | Backend bảo vệ theo quyết định đã chốt; không thay DB/audit/job ngoài quy tắc |
| ACC-09 | Hai Admin quyết định cạnh tranh | Kết quả xung đột/replay theo contract; một response cũ không đảo quyết định mới ngoài quy tắc |
| ACC-10 | Response bị mất sau commit, timeout/5xx, GET lại lỗi | Không gửi lại write tự động; giữ lý do/draft và thông báo chưa rõ; không tự coi GET là receipt |
| ACC-11 | Logout/login actor B khi GET/write A đang chờ | Không hiển thị response/draft cũ trong B; không dùng token B gửi lại command A |
| ACC-12 | Desktop/mobile/keyboard | Dialog/focus/validation dùng được; không tràn ngang, không rò thông tin đăng nhập trong ảnh |

Môi trường cần: PostgreSQL riêng, hai Admin active, USER và SELLER fixture độc lập, dữ liệu lịch sử mẫu nếu kiểm bảo toàn lịch sử, worker/index riêng nếu nghiệm thu tác động Search. Không dùng Admin cuối cùng hoặc tài khoản đang demo làm mục tiêu khóa. Credential chỉ gửi private.

## Việc Hiền có thể làm ngay / phần chờ

- Đã có layout/bộ lọc/dialog preview và 14 test lịch sử trên nhánh này; không coi là runtime. Báo cáo [layout](admin-accounts-layout-preparation-2026-10-16.md) giữ nguyên baseline/kết quả cũ.
- Lượt này chỉ đọc code và chuẩn bị readiness/checklist; không chạy lại test layout vì không sửa code. Không gọi Backend để khóa tài khoản thử, không sửa DB, không commit/push/comment.
- Chờ Hoàng chốt sáu mục API ở trên để nối adapter/page thật. Không tạo adapter list với endpoint đoán hoặc lấy dữ liệu private từ SQL đưa thẳng lên UI.
