# Accounts khóa/mở — runtime đang triển khai, 24/10/2026

IN_PROGRESS trên `codex/account-status-hardening`, đã đồng bộ develop e543875 sau #113. Chưa merge/chưa nối UI ghi/chưa nghiệm thu Accounts hoàn chỉnh. Thay thế path PATCH yếu cũ bằng strict command; không giữ đường bypass bool-only.

## API và tương thích

JWT/current active ADMIN. Cả lỗi và thành công `Cache-Control: no-store`. GET/PATCH status không nhận query; GET không nhận body.

- `GET /admin/accounts/:id/status` → `{id,isActive,statusRevision}`. Không thêm trường vào GET danh sách exact8fields hoặc PublicUser/Auth response.
- `PATCH /admin/accounts/:id/status` → body exact `{isActive:boolean,expectedRevision:int1..2147483647,reason:string}`. Reason NFC trim 10..500 Unicode code points; không lone surrogate hoặc C0/C1 trừ tab/newline/CR.
- Thành công `{account:{id,isActive,statusRevision},auditId:string|null,searchReconciliation:{jobId:string,status}|null}`. IDs audit/job bigint được gửi dạng chuỗi. Không trả hash, token hoặc credentialVersion.
- Body cũ chỉ có isActive bị400. Accounts Web hiện chỉ đọc; chưa bật command dialog của Hiền trên contract cũ.

## Quy tắc và giao dịch

Serializable, tối đa3attempt và chỉ retry lỗi xác nhận transaction đã abort: P2034 hoặc SQLSTATE40001/40P01 có cấu trúc. Không đoán từ message. Mỗi attempt lấy DB advisory transaction lock `(190311,1)`, khóa User actor/target theo ID tăng, rồi đọc lại actor active/ADMIN/credentialVersion, target và revision. Không khóa RAM hoặc network call trong transaction.

- Stale revision409 `ACCOUNT_REVISION_CONFLICT`, kể cả desired state đã giống.
- No-op revision đúng không ghi User/updatedAt/audit/revoke/job.
- Tự khóa409 `ACCOUNT_SELF_LOCK_FORBIDDEN`; kiểm active Admin count trong cùng giao dịch, không bỏ Admin cuối (`LAST_ACTIVE_ADMIN`). Hai Admin khóa nhau chỉ một bên được commit; bên còn lại phải recheck quyền sau retry.
- Overflow revision/credential409 `ACCOUNT_VERSION_EXHAUSTED`, không reset.
- Một commit: state+revision+credentialVersion, revoke mọi refresh chưa revoke, audit actor/target/before-after/reason/time/version, và durable invalidation khi có Store sở hữu kể cả current role USER. Không đổi Store.status, Product approval, Order/kho/snapshot.
- Audit append-only và target/revision unique; FK RESTRICT bảo toàn actor/target lịch sử. Không bịa audit cho dữ liệu trước migration.
- Xung đột hết retry409 `ACCOUNT_STATUS_IN_PROGRESS`; lỗi khác503 `ACCOUNT_STATUS_UNAVAILABLE`, không suy rollback từ HTTP lỗi, không tự replay từ FE.

## Phiên đăng nhập — dùng nền đã merge #108

Không thêm sessionEpoch song song. Dùng `credentialVersion` mà login/refresh/JWT/password đã cùng kiểm và khóa User. **Cả khóa lẫn mở đều tăng phiên bản và revoke refresh**: mở một tài khoản inactive từ thời code cũ cũng không làm token cũ sống lại. No-op không tăng. JWT không có cv chỉ hợp lệ khi version1 theo rollout cũ; ngay sau thay đổi trạng thái version>=2 nên legacy token bị từ chối. Không đổi secret/claim công khai hoặc password hash.

Request đã vượt guard trước thay đổi không tự hủy; sensitive writer phải recheck trong giao dịch riêng. Không hứa ngắt mọi request đang bay. Các writer quản trị role về sau phải tham gia protocol; direct SQL/seed/maintenance không được quảng cáo là đã được service bảo vệ khỏi mọi thao tác phá dữ liệu.

## Deploy và bàn giao QA

1. Migration mới `20261024180000_account_status_hardening`, không sửa migration cũ. Migrate trước code; nâng đồng bộ tất cả replicas, không chạy writer legacy cùng writer mới.
2. Rollback code cũ có thể bỏ bảo vệ revision/thu hồi phiên; không gọi là rollback an toàn mặc định. Dùng maintenance nếu phải rollback.
3. QA bản kết hợp sau #113 dùng DB mới riêng `bckl_order_resolution_test_attributes_20261019_v948`, 127.0.0.1:5549,24migrations. Launcher local kiểm demo stopped, profile private đúng role/host/database và không có dotenv. Không commit URL/password/token.
4. `test/account-status-hardening.e2e-spec.ts` tự tạo Admin/Buyer/owner bằng dữ liệu tổng hợp; giữ actor/target có audit bất biến trong DB QA. Fixture portable `BE/scripts/account-status-qa.mjs` tạo 5 tài khoản tổng hợp trên đúng QA target, không reset hash/state/audit khi chạy lại. Credential cấp riêng; [hướng dẫn bàn giao](../testing/account-status-handoff-2026-10-25.md).
5. Hiền nối dialog GETrevision→confirmation/reason→PATCH;409 giữ draft, unknown giữ trạng thái khóa và yêu cầu đọc đối chiếu, không tự gửi lại. Audit HTTP reader/chế độ đối chiếu đầy đủ và browser hai phiên còn cần khép trước nghiệm thu toàn luồng UI.

Kiểm thử và giới hạn: [báo cáo tiếp tục 25/10](../testing/account-status-hardening-2026-10-25.md).
