# Seller onboarding — API v1,26/10/2026

Nhánh `codex/seller-onboarding`, base169df59. Theo SCOPE-ROLE-001/STORE-002,
[thiết kế và rollout](../architecture/seller-onboarding-runtime.md). Hồ sơ
liên hệ/địa chỉ cơ bản; không KYC, thuế, ngân hàng hoặc giấy tờ thật.

## Rollout và tương thích

Áp dụng migration28 `20261026120000_seller_onboarding` trước Backend mới.
Thêm Application/audit/command/grant; không sửa dữ liệu hoặc tự suy grant của
Store legacy. Security event thêm SELLER_GRANTED, giữ PASSWORD_CHANGED.

Mặc định SELLER_ONBOARDING_ENABLED=false, VITE_SELLER_ONBOARDING_ENABLED=false.
Trong deployment QA cùng bật ACCOUNT_BUYER_ACCESS_ENABLED và
VITE_ACCOUNT_BUYER_ACCESS_ENABLED trước mở onboarding. Cờ build Web cần build
lại. Mọi replica phải thống nhất mode, không đổi giữa giao dịch đang chạy.
Không tắt Buyer gate khi còn tài khoản promoted hoặc journal Buyer chờ.
Tắt Backend onboarding chặn cả đọc/reconcile; phải drain/đối chiếu trước rollback,
không xóa metadata để né gate. Web tắt ghi mới vẫn giữ đọc/phục hồi khi Backend
còn phục vụ. Không tự đổi `.env` demo để chạy QA.

Khi mode bật, đăng ký accountType=SELLER vẫn trả USER. Role SELLER chỉ là
projection tương thích sau duyệt, kèm grant bền vững; không tạo Admin công khai.
SELLER legacy chưa có Store được gửi hồ sơ mới, duyệt không rotate nếu đã SELLER.
Store legacy có sẵn tiếp tục luồng cũ, không tự chuyển thành hồ sơ mới. Endpoint
mới trả409 LEGACY_STORE_WORKFLOW_REQUIRED; API legacy từ chối Store có Application
bằng409 STORE_APPLICATION_WORKFLOW_REQUIRED kể cả khi rollout tắt.

## Đọc và quyền

JWT bắt buộc; active/role/cv đọc lại trong DB. OWNER chỉ USER/SELLER, ownership
theo JWT; ADMIN chỉ quản trị, không kế thừa Buyer hoặc Owner. Mọi response kể
cả lỗi có Cache-Control:no-store. GET/HEAD không body; POST không query.

| API | Kết quả |
|---|---|
| GET `/account/store-application` | **JSON `{application:View|null}`**; null rõ ràng khi chưa có Store, không body rỗng |
| GET `/admin/store-applications` | `{items,nextAfterId}`, item chỉ id/ownerId/name/status/revision |
| GET `/admin/store-applications/:id` | View cho Store thuộc quy trình mới |

List `limit`1..50 default20, `afterId` int32 dương exclusive; id tăng. Owner
GET và Admin detail dùng `limit`, `beforeRevision` để đọc lịch sử mới nhất trước,
revision giảm; trả nextBeforeRevision. Unknown/duplicate/bracket/leading-zero/
decimal/overflow bị400. Mỗi trang là snapshot RepeatableRead READ ONLY riêng,
không nhận là snapshot bất biến xuyên các trang.

View gồm store{id,name,description,status}, ownerId, revision, profile
{contactName,contactPhone,pickupAddress,returnAddress}, grant{adminId,createdAt}
hoặc null, history và nextBeforeRevision. History có id(bigint string), actorId,
action, from/toRevision, from/toStatus, reason, createdAt. Không passwordHash,
token, refresh hoặc địa chỉ User. Dữ liệu liên hệ chỉ ở endpoint có quyền,
không thêm vào payload public Store/Product/Search.

## Ghi và fingerprint

| POST | Action/scope |
|---|---|
| `/account/store-application` | submit / OWNER, targetId=actorId |
| `/account/store-application/:storeId/edit` | edit / OWNER |
| `/account/store-application/:storeId/resubmit` | resubmit / OWNER |
| `/admin/store-applications/:storeId/review` | review / ADMIN |

Tất cả trả200 khi có receipt. Body exact allowlist:

- Mọi action: commandId UUIDv4 lowercase, confirmed=true, reason10..500codepoints.
- Ngoài submit: expectedRevision int32 dương.
- Submit/edit: name3..120, description0..1000, contactName2..100,
  contactPhone regex `^\+?[0-9]{9,15}$`, pickupAddress/returnAddress10..500.
- Review: status ACTIVE/REJECTED/SUSPENDED, không tự ép array/object/string số.

Text chuẩn hóa NFC/trim, từ chối Cc/Cs; nhập địa chỉ/lý do một dòng.
Fingerprint SHA256 UTF8 lowercase hex của JSON.stringify:
`{schemaVersion:1,scope,action,targetId,body}`. Body insertion order:
confirmed, reason, expectedRevision nếu có; name, description, contactName,
contactPhone, pickupAddress, returnAddress nếu có; status nếu review. UUID,
Auth role/cv và thời gian không nằm trong hash để đối chiếu sau promotion.

Owner sửa PENDING/REJECTED/ACTIVE; REJECTED nộp lại PENDING cùng Store, có
revision mới. Admin PENDING→ACTIVE/REJECTED, ACTIVE→SUSPENDED,
SUSPENDED→ACTIVE. Owner SUSPENDED/CLOSED không sửa/nộp lại/tạo Store mới.
Một revision chung tăng1 mỗi command ghi; mỗi ý định có audit, kể cả nội dung
giống lần trước khi người dùng cố ý gửi lại với key/revision mới.

Duyệt lần đầu vào ACTIVE: grant một lần; USER→SELLER, cv+1, revoke mọi refresh,
security event, history và Search job cùng transaction. Chủ đăng nhập lại;
grant của Store tạm khóa được giữ, chỉ Admin khôi phục. Không rotate hoặc cấp
lại khi restore. Enqueue Search bền vững không có nghĩa index đã đồng bộ xong.

## Receipt và phục hồi

`{commandId,outcome:'APPLIED',receipt:{storeId,ownerId,revision,status,auditId,
grantCreated,reauthenticationRequired}}`. AuditId là bigint string. Đây là
kết quả lịch sử của đúng command; đọc View hiện tại để xem trạng thái mới nhất.
UUID cùng actor và cùng scope/action/target/hash trả lại receipt, không chạy lại;
khác intent409 STORE_COMMAND_ID_REUSED. Không dùng receipt để bypass quyền hiện hành.

POST `/account/store-application/commands/:action/:targetId/reconcile` hoặc
`/admin/store-applications/:storeId/reconcile` nhận exact
`{commandId,requestHash,confirmed:true}`. Không nhận profile/reason hoặc tự thực
thi lệnh. Đã xử lý trả APPLIED; chưa chạy ghi CLOSED, receipt null. Writer đến
muộn cùng key bị409 STORE_COMMAND_CLOSED. Sau USER→SELLER cần đăng nhập lại
trước đối chiếu key Owner cũ, giữ metadata nguyên vẹn.

Server khóa User actor/owner theo id trước Store, kiểm lại cv/role/active và
ownership, Serializable với tối đa3attempt cho40001/40P01. Row User có thật
tuần tự hóa first submit; không dựa vào khóa hàng Store chưa tồn tại. Legacy
profile PATCH dùng cùng khóa User và kiểm application trong transaction để
không chen giữa kiểm chưa có Store và submit. Lỗi bất định503 giữ mã; không tự
retry lỗi mạng. Giới hạn30command đã commit/phút/actor, không phải rate limit
đầy đủ cho traffic thất bại hoặc HTTP flood.

Web giữ metadata tại `store-application-pending:v1:<actorId>`, không lưu profile,
reason/body/token. Xác nhận gắn với action/target/draft version; mutation trong
lúc SHA256 không đổi payload đã snapshot. Chỉ xóa đúng raw key sau receipt hợp
lệ; timeout/storage hỏng/đổi tài khoản không tự replay hoặc xóa key.
