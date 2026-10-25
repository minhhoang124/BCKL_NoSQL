# Accounts: audit, durable command và đối chiếu — IN_PROGRESS

Nhánh `codex/account-status-audit-recovery` từ develop `d508c61` sau #114. Chưa merge/chưa nghiệm thu toàn Accounts. Migration mới thứ25 `20261025150000_account_status_command_receipts`; không sửa migration24 đã dùng chung. Giao diện thật nằm sau `VITE_ADMIN_ACCOUNT_STATUS_ENABLED=false` mặc định, không phải dữ liệu minh họa/Figma.

## Phạm vi và tương thích

Giữ GET danh sách exact8fields và status GET cũ. PATCH exact3fields `{isActive,expectedRevision,reason}` vẫn dùng đủ bảo vệ #114 nhưng **không có durable recovery**. Client mới gửi thêm `commandId` UUIDv4 lowercase, body chỉ có4fields. Web mới luôn dùng commandId; không được bỏ ID để né CLOSED/MISMATCH. Không tuyên bố POST đối chiếu có thể đóng các lệnh legacy không mang ID.

Giữ tự khóa/Admin cuối, revision monotonic, actor active/ADMIN/credentialVersion recheck, cả khóa/mở revoke phiên và durable Search-owner invalidation cùng PostgreSQL transaction. Không sửa Store.status, Order hoặc kho. Không có network/broker call trong transaction.

## Fingerprint và quyền

Reason như #114: NFC→trim,10–500 Unicode codepoints, từ chối surrogate/control không cho phép. `reasonDigest=SHA256(UTF8(normalizedReason))`, lowercase64hex. `requestHash=SHA256(UTF8(JSON.stringify({targetId,expectedRevision,isActive,reasonDigest})))` với đúng thứ tự khóa này; writer/reconcile dùng cùng helper server. Không đưa actorId do browser khai vào quyền; actor lấy từ JWT/current DB. Unique `(actorId,commandId)`; cùng UUID do Admin khác dùng là namespace khác, không được đọc receipt của nhau.

## PATCH `/admin/accounts/:id/status`

Sau advisory gate `(190311,1)` và User locks theo ID tăng, kiểm actor/target rồi tìm command trước revision:

- Chưa có: kiểm revision/state; APPLIED ghi User/version/revoke/audit/job/command một commit. NOOP đúng revision chỉ ghi command receipt, không đổi User/timestamp/session/audit/job.
- Có record: so khớp actor,target,UUID,requestHash và các thành phần. Sai409 `ACCOUNT_COMMAND_MISMATCH`; CLOSED409 `ACCOUNT_COMMAND_CLOSED`.
- APPLIED/NOOP khớp trả receipt gốc, dù trạng thái hiện tại đã đổi; không revoke/audit/enqueue thêm. Kiểm lại audit identity/revision/reasonDigest và receipt shape; Search job nếu có phải đúng scopeSELLER/target. Receipt hỏng503 `ACCOUNT_COMMAND_RECEIPT_INVALID`, không ghi đè/xóa record hoặc bịa fence mới.

Body thành công của client mới: `{commandId,account,auditId,searchReconciliation}`. `account` là snapshot lúc xử lý; job status cũng là receipt snapshot, không chứng minh Search index đã xong. Legacy giữ đúng shape3fields cũ.

## POST `/admin/accounts/:id/status/reconcile`

Đây là thao tác **có thể ghi fence**, không phải GET đọc thuần. Exact body `{commandId,expectedRevision,isActive,reasonDigest}`; không reason plaintext, amount/role hoặc actor tùy ý. Không nhận query. Current active Admin, timeout và gate/User locks/retry giống writer; đầu vào được snapshot trước await.

- Có command đúng fingerprint: kiểm receipt/audit rồi trả kết quả đã lưu.
- Chưa có: tạo record CLOSED trong transaction. Không thực thi hành động khóa/mở, không tăng revision/credentialVersion, không audit trạng thái, không revoke hoặc enqueue. Mã cũ đến sau bị writer từ chối.
- Response HTTP200: `{commandId,outcome:APPLIED|NOOP|CLOSED,current:{id,isActive,statusRevision},receipt:null|{account,auditId,searchReconciliation}}`. `current` và receipt có thể khác; UI hiển thị riêng ý nghĩa lịch sử với trạng thái hiện tại.
- SERIALIZABLE tối đa3attempt cho confirmed40001/40P01; lock timeout/unknown503, hết retry409. Lỗi không chứng minh rollback hoặc cho phép tự resend. Reconcile lặp chủ động cùng metadata là idempotent và không thay record cũ.

## GET `/admin/accounts/:id/status/history`

Current active Admin; RepeatableRead READ ONLY, statement timeout5s, no-store. Exact query `limit` mặc định20/max50; `beforeRevision` int1..2147483647 exclusive; từ chối lạ/trùng/bracket/ép kiểu. Không có cursor thì bao gồm revisionMAX hợp lệ. GET/HEAD không nhận body.

Response `{account,items,nextBeforeRevision}`; mỗi item exact `{id:string,actorId,targetId,beforeActive,afterActive,fromRevision,toRevision,reason,createdAt}`. IDbigint gửi string; không hash/token/credentialVersion/command metadata. Sắp `toRevision DESC`, take+1; cursor là revision cuối trang khi còn dữ liệu. Mỗi trang là snapshot riêng; tải lại từ đầu để thấy audit mới. Không bịa lịch sử trước migration24.

## Web và rollout

- Khi mở dialog, đọc history+current cùng response, hiển thị target, lý do và xác nhận riêng. Đổi lý do bỏ tick; sau terminal đối chiếu yêu cầu lý do/xác nhận mới. Self-lock không có nút gửi. Reload/target/session fence ngăn phản hồi cũ cập nhật form mới.
- Trước PATCH: WebCrypto snapshot identity/body, giữ một pending intent mỗi Admin trong sessionStorage gồm actorId/targetId/UUID/revision/desired/reasonDigest. Không reason/email/token. Có pending/corrupt storage/quota lỗi thì chưa gửi lệnh mới. Bấm đôi dùng sync latch; không tự retry mutation hoặc refresh để đổi actor.
- Timeout/malformed response/reload giữ mã. Chỉ **Đối chiếu kết quả** mới POSTreconcile, không PATCHreplay. Chỉ xóa đúng raw journal sau response strict đã xác minh, CAS mismatch không xóa yêu cầu khác. Old actor callback không xóa mã sau đổi phiên.
- Ghi đã xác nhận nhưng reload GET lỗi: báo đã ghi nhận, không gửi lại, khóa form đến khi đọc được trạng thái. Không nhận history bị lùi revision dưới receipt/current đã biết. Sau terminal refresh danh sách bằng đọc lại, không tự gán trạng thái trong bảng.
- Migrate25 trước Backend mới, nâng đồng bộ các replica rồi mới bật FE flag. Giữ cờ false nếu còn server cũ. Không rollback về writer legacy khi Web còn command đang chờ; cần kế hoạch maintenance thay vì giả an toàn.
- QA mới v949/loopback5549, demo giữ dừng; app role hạn quyền, không dotenv/reset. Audit/command append-only và FKRESTRICT; giữ fixture được tham chiếu, không cleanup bằng DELETE audit.

Chưa nhận browser/cạnh tranh nhiều process/crash/AI propagation đạt chỉ vì source/unit xanh. Bằng chứng QA cập nhật theo đúng source, tách fault injection khỏi mất gói mạng vật lý. Snapshot dữ liệu UI offline vẫn chỉ là thiết kế.
