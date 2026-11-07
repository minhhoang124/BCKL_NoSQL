# Admin Accounts — contract đề xuất và kế hoạch bàn giao

19/10/2026, baseline `622cfb9`. **PROPOSED — chưa có API mới/migration trong PR này.**
Hoàng Backend; Hiền review nghiệp vụ và nối Accounts UI sau Backend merge.
Nguồn: SRS v3 FR-ADM-01/FR-ACC-01, implementation-scope, Auth và reconciliation hiện hành.

## 1. Những gì đã có và chưa có

`AdminAccountController` hiện chỉ có PATCH `/admin/accounts/:userId/status`
nhận `{isActive:boolean}`. AuthService transaction ghi account và enqueueSeller
khi roleSELLER; no-op không job. **Chưa** GET list, audit actor/reason, revision,
chống tự khóa/khóa Admin cuối, hoặc chính sách không phục sinh token sau mở khóa.
JWT strategy đã đọc User hiện hành mỗi request và từ chối inactive; đó không phải
epoch phiên: token cũ còn hạn có thể lại hợp lệ sau mở khóa nếu không thêm cơ chế.
Không mô tả API khóa cơ bản là đã hoàn thành quản trị Accounts.

## 2. Phạm vi đầu tiên có thể bàn giao độc lập: danh sách chỉ đọc

GET `/admin/accounts`; JWT + current active ADMIN, guest401/khác quyền403,
`Cache-Control:no-store` cả lỗi. Query allowlist:

- limit: mặc định50, integer1..100.
- afterId: positiveInt <=2147483647, thứ tự ID tăng.
- q: chuỗi NFC trim, tối đa120 code points, tìm chứa email/fullName không phân biệt hoa thường;
  không regex do client điều khiển, không gửi raw SQL và không log nguyên query PII.
- role: USER/SELLER/ADMIN theo enum thực tế; đây là bộ lọc role hiện hành,
  không giả một role là thiết kế capability cuối cùng.
- isActive: chỉ true/false, không nhận1/0. Unknown/duplicate/array/null reject400.

Response `{items,nextCursor:number|null}`. Item allowlist:
`id,email,fullName,role,isActive,createdAt,updatedAt,store:{id,name,status}|null`.
Không passwordHash, token, địa chỉ, số điện thoại hoặc nested orders. Admin được
xem email cho tác vụ quản trị, không chuyển endpoint này sang public/Seller.
Snapshot trang nhất quán, timeout/bounds tương tự Attributes read; không trả
totalCount vô hạn hoặc gọi một trang là toàn bộ user. Không phát audit mutation/job từ GET.

UI bước này chỉ đọc; không bật nút khóa/mở mới dựa vào GET hoặc PATCH cũ chưa đủ bảo vệ.

## 3. Đề xuất củng cố khóa/mở — cần Hiền review trước migration

Giữ path PATCH hiện hành nhưng chuyển body sau khi phối hợp UI:
`{isActive:boolean,expectedRevision:number,reason:string}` strict.
Reason NFC trim10..500 code points, không control ngoại trừ newline/tab;
thay đổi quyền nhạy cảm luôn cần xác nhận UI và lý do server kiểm.
Thêm `statusRevision` positiveInt; tất cả producer trạng thái phải dùng cùng protocol.

- Không tự khóa chính mình (409 ACCOUNT_SELF_LOCK_FORBIDDEN).
- Không vô hiệu Admin active cuối cùng (409 LAST_ACTIVE_ADMIN).
- Hai Admin khóa nhau/khóa hai Admin cuối phải serialize và recheck current actor,
  target và active-admin count; không dựa vào count ngoài transaction hoặc khóa trong một process.
- Dùng Serializable + bounded retry; lock order cố định cho account operations,
  cân nhắc một DB transaction advisory lock dành riêng thay đổi trạng thái Admin
  nếu cần bảo vệ predicate count. Chốt bằng test hai connection trước nhận thiết kế xong.
- Revision sai409 ACCOUNT_REVISION_CONFLICT, exhausted409; không reset.
- No-op với revision đúng không audit/job/revoke mới; stale revision vẫn409.
- Atomic trạng thái/revision, actor/reason/old-new/correlation audit, thu hồi phiên và
  durable Seller invalidation. Audit hoặc enqueue lỗi rollback toàn bộ.
- Seller xác định từ Store sở hữu trong DB, không chỉ tin roleSELLER khi chuyển
  capability sau này. Không xóa Store/Product/Order; khóa account chặn truy cập,
  chặn public/checkout qua predicate chuẩn, worker xử lý derived index.
- Tách khóa account và SUSPENDED Store: không tự đổi Store.status hoặc Order.status;
  mở account không gỡ Store suspension hay tự duyệt Product.

### Phiên sau khóa–mở: quyết định cần review

Đề xuất khóa thu hồi mọi refresh token và tăng sessionEpoch, access JWT kiểm epoch
với DB mỗi request; mở lại không khôi phục sessionEpoch cũ, yêu cầu đăng nhập lại.
Phải xác định thời gian chuyển đổi token cũ không epoch (từ chối/relogin có thông báo),
không deploy nửa cơ chế làm toàn bộ user bị logout bất ngờ hoặc token cũ sống lại.
Chưa thay JWT payload/schema/Auth trong PR tài liệu này. Không suy revoke refresh
token đơn thuần đã ngăn access token cũ sau unlock.

## 4. Acceptance và thứ tự triển khai

1. **Read-only Backend PR:** list/query/allowlist/RBAC/no-store, DB QA riêng, tài khoản
   hai Admin cùng User/Seller. Sau merge Hiền nối danh sách trước, trạng thái chỉ hiển thị.
2. **Status hardening PR:** migration revision/audit/epoch sau review; nâng tất cả writers;
   test legacy token migration, refresh/in-flight races và Seller invalidation.
3. **Hiền UI commands:** confirmation/reason, giữ draft409, unknown write không auto replay;
   bàn giao exact merge commit, cách dựng fixture và cấu hình nhạy cảm gửi riêng.

Test bắt buộc trước nhận Accounts hoàn chỉnh:

| Nhóm | Kết quả cần chứng minh | Hiện tại |
|---|---|---|
| List | guest401, Buyer/Seller403, inactive Admin401, không secret; query/pagination | NOT_RUN mới |
| Status | lý do/revision/current actor, tự khóa/Admin cuối bị chặn | NOT_RUN mới |
| Concurrency | hai Admin khóa nhau/hai Admin cuối, stale request, no-op | NOT_RUN mới |
| Atomicity | audit/job/revoke lỗi rollback, không mất invalidation qua restart | NOT_RUN mới |
| Sessions | lock chặn ngay; unlock không sống lại JWT/refresh cũ; login mới được | NOT_RUN mới |
| Search | Store owner USER/capability tương lai không lọt; canonical chặn trước index | NOT_RUN mới |
| UI | hai Admin độc lập,409 giữ draft, timeout không tự gửi lại | NOT_RUN mới |

Chưa hứa mốc thay Hiền/Đạt; ưu tiên list sau Attributes foundation, ghi sau khi
review chính sách/version/session. Dashboard/thống kê/hậu mãi không thuộc contract này.
