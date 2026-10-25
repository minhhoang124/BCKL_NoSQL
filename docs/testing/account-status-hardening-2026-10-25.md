# Accounts status — kết quả tiếp tục ngày 25/10/2026

Nhánh `codex/account-status-hardening`, base `f5490e3`; chưa merge hoặc nghiệm thu toàn Accounts. Báo cáo này cập nhật số liệu sau lượt gián đoạn; không tính lượt E2E mất kết quả là PASS.

## Bản kết hợp sau #113 — kết quả mới nhất

Ngày25/10 đã đồng bộ develop `e543875` (#113) vào nhánh. Conflict chỉ ở exact QA allowlists và phần ghi nhận kiến trúc; giữ đủ Chat/Accounts. Không đổi runtime service Accounts. DB mới v948/5549 đủ24migrations; không tái sử dụng/reset DB cũ. Full Backend unit **1324 PASS/60 files,31.28s**; full E2E **899 PASS/1SKIP/20TODO**,56filesPASS/2SKIP,289.03s. Typecheck/lint/build đạt. SQL upgrade hiện chạy23→24, giữ dữ liệu nền gồm migration Order context; bằng chứng22→23 phía dưới thuộc lượt trước đồng bộ.

Gemini Argon Medium review delta gỡ conflict trả NONE cho P1/P2; đây chỉ source review. Log riêng local accounts-post113-unit-20261025.log và accounts-post113-e2e-20261025.log, không commit log/profile. Bản trước đồng bộ ở bảng dưới không thay số liệu kiểm bản kết hợp.

Kiểm thêm bản kết hợp bằng app role trên v948: **21/21 Accounts HTTP/service PASS**,9.00s; fixture target guards2/2PASS. Giữ runtime Auth service/input/SQL classifier nguyên byte so37a0efe; thay đổi sau đồng bộ chỉ gồm nền Chat, QA allowlists/migration count và tài liệu.

CI run40164182114 trên127180b đã thực sự chạy (AI PASS), không còn là billing-only. Repository checks có897PASS/2SKIP/20TODO nhưng1FAIL: migration probe chưa chấp nhận exact database QA không suffix của workflow. Đã thêm đúng pathname `/bckl_order_resolution_test_attributes_20261019`, vẫn giữ127.0.0.1:5549 và global fail-closed guard; targeted SQL upgrade v948 chạy lại1/1PASS. Bốn job evaluation cũng FAIL do historical protocol hash trỏ vào tài liệu sống đã đổi từ #107; sửa riêng trên nhánh provenance, không nới assertion/đổi input hashes. Không merge #114 chỉ bằng quyền ngoại lệ billing khi còn CI lỗi thật.

## Lượt trước đồng bộ — lịch sử bằng chứng

| Kiểm tra | Kết quả |
|---|---|
| Full Backend unit | 1323 PASS / 60 files, 25.13s; gồm 48 Accounts service/input/retry tests |
| Full E2E bản cuối | 886 PASS / 1 SKIP / 20 TODO; 55 files PASS / 2 SKIP; 305.11s, QA v947 |
| Accounts HTTP/PostgreSQL bằng app role hạn quyền | 21 PASS / 2 files, 9.06s, QA v946 |
| SQL upgrade + fixture/hardening trước bổ sung barrier | 14 PASS / 2 files, 5.95s; các ca mới cũng có trong full E2E cuối |
| Fixture target guards | 2 Node tests PASS, không kết nối DB |
| Typecheck/lint/Nest build | PASS; oxlint 0 errors / 0 warnings |

Full E2E dùng migrator cho các suite có DDL; riêng 21 Accounts tests chạy lại bằng app role không superuser/CREATEDB/CREATEROLE, được cấp quyền bảng/sequence. Không gọi toàn 886 tests là least-privilege runtime proof. Demo `bckl_postgres` giữ dừng, QA loopback 5549; không load dotenv. Log local lưu tại deliverables/accounts-e2e-final-20261025.log, accounts-unit-final-20261025.log, accounts-app-role-final-20261025.log; không commit runtime log hoặc profile.

## Bằng chứng mới

- Hai yêu cầu cùng revision chỉ một transition/audit; hai Admin khóa nhau bảo toàn Admin hoạt động và recheck actor. No-op không ghi User/token/audit/job; revision cũ vẫn bị từ chối khi state đã giống.
- Khóa/mở đều tăng credentialVersion và revoke refresh. Legacy inactive unlock không hồi sinh token cũ.
- Controlled login barrier giữ lần đọc User ban đầu rồi cho lệnh khóa commit; login tiếp tục bị 401 và không tạo refresh còn hiệu lực.
- Controlled refresh barrier giữ sau verify chữ ký, cho khóa commit rồi tiếp tục transaction; refresh bị 401, không mint phiên mới. Đây là fault scheduling trong cùng process + PostgreSQL thật, không multi-process crash proof.
- Enqueue fault trên PostgreSQL hoàn tác state/revision/credential/refresh/audit và giữ nguyên Store SUSPENDED. Audit UPDATE/DELETE bị DB từ chối.
- Upgrade test dựng đủ 22 migration SQL nền trong schema QA mới riêng, thêm active Admin/inactive Seller/Store SUSPENDED/refresh; áp SQL migration Accounts 23: toàn trường cũ giữ nguyên, statusRevision=1, không fabricated audit. Schema kiểm thử giữ lại; không sửa public. Đây là actual SQL upgrade, không phải Prisma deploy/restart trên bản sao production.
- Fixture tạo/rerun qua chính module portable: thay trạng thái bằng service, chụp toàn User/hash/Store/audit, rerun với hash khác, dữ liệu giữ nguyên. CLI guard kiểm role/target và password; chưa có lượt end-to-end CLI cấp credential riêng cho máy Hiền.
- Gemini Argon Medium bounded source review trả NONE cho P1/P2 của service/input/SQL classifier/migration (25/10). Chỉ source review, không phải GitHub approval hoặc độc lập chạy full QA.

## Lỗi tìm thấy khi kiểm thử và đã sửa

- Lượt cũ: SELECT advisory lock trả void không decode qua adapter; sửa integer projection, giữ regression. P2010 bọc structured 40001/40P01 trước bị 503; thêm classifier/retry toàn transaction, giữ assertion 409.
- Full suite đầu sau thay session policy dùng lại Seller JWT đã bị revoke; fixture phải đăng nhập lại sau mở, đồng thời assert token cũ 401. Không nới auth để làm test xanh.
- Upgrade probe đầu gộp ALTER TYPE ADD VALUE và sử dụng enum trong một pg query batch, gây unsafe enum use. Tách riêng các dòng ALTER TYPE ADD VALUE để commit trước dùng, không sửa SQL migration đã merge hoặc bỏ kiểm bảo toàn.
- Refresh barrier đầu đặt vào JwtService module khác nên timeout. Dùng đúng verifier được inject vào AuthService, không tăng timeout hoặc skip ca.
- Các log lỗi injected fault/pg deprecation trong full suite không phải test FAIL; giữ kết quả SKIP/TODO nền minh bạch.

## Chưa nghiệm thu

UI ghi/Chrome hai phiên và audit HTTP reader/outcome reconciliation; actor đổi mật khẩu đúng lúc status writer chờ khóa; physical packet loss/restart/crash; Search AI/index propagation thật. Audit/revoke fault riêng hiện có unit mock, PostgreSQL enqueue fault chứng minh rollback chung. Không nhận toàn marketplace/Accounts DONE hoặc CI xanh do test local.

[Bàn giao QA cho Hiền](account-status-handoff-2026-10-25.md), [contract/rollout](../api/account-status-runtime.md), [nhật ký trước](account-status-hardening-2026-10-24.md).
