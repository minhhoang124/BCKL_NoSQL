# Seller onboarding — kiểm thử ngày 26/10/2026

Base `develop 169df599d0fe8ffceb44dd324e05f7729198ea8a`, nhánh
`codex/seller-onboarding`. Đây là bằng chứng trên nhánh triển khai; không thay
thế trạng thái merge hoặc bật rollout. API: `docs/api/seller-onboarding-runtime.md`.

## Phạm vi đã chạy

User đăng ký vẫn là USER, gửi hồ sơ PENDING, Admin từ chối, Owner sửa và nộp
lại trên cùng Store, Admin duyệt mới cấp quyền Seller. Audit, revision, grant,
credentialVersion, thu hồi refresh và Search job commit/rollback cùng giao dịch.
Store bị tạm khóa không tự mở lại; Admin khôi phục giữ grant cũ. Legacy Store
không được tự chuyển sang luồng mới hoặc bị backfill chứng cứ duyệt giả.

Browser giữ UUID/hash và kỳ vọng biên nhận, không giữ hồ sơ, lý do, token hoặc
body ghi. Timeout phải đối chiếu có đồng ý; không tự gửi lại. Khi đã cấp quyền,
chủ Store đăng nhập lại để dùng quyền mới và phục hồi mã cũ.

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Backend lint, typecheck, build | PASS; lint 0 lỗi/cảnh báo |
| Backend unit | 66 files, **1466 PASS** |
| Full Backend HTTP/PostgreSQL E2E sau bản sửa cuối | 62 files, **981 PASS / 1 SKIP / 20 TODO**, 316.83s |
| Onboarding HTTP/PostgreSQL riêng, app-role không đặc quyền | **22 PASS** |
| Web journal, parser, consent, UI và session | **36 PASS** sau sửa nhãn cuối |
| Full FE trước chỉnh nhãn truy cập cuối | 86 files PASS, 1 file SKIP; **1492 PASS / 6 live SKIP** |
| Web lint/build sau chỉnh nhãn | PASS; 0 lỗi, 5 cảnh báo Admin nền và 1 cảnh báo cleanup ref; bundle >500kB là cảnh báo |
| Fresh migration | **28 migrations PASS**, DB v953 |
| Upgrade dữ liệu cũ 27→28 | PASS, DB v954; legacy rows/checksum không đổi, không tự cấp grant |
| Prisma schema diff sau migrate | Không có khác biệt |
| Chrome thật + Nest + PostgreSQL, 9 nhóm | **PASS**, desktop/mobile sáng; đã xem 4 ảnh |

SKIP/TODO có sẵn được giữ rõ, không tính là đã kiểm thử. Full FE ghi đúng thời
điểm trước thay đổi aria-label cuối; focused test/build và Chrome chạy sau đó.

## Đối kháng và lỗi đã sửa

1. Gemini Argon Medium tìm thấy TOCTOU ở legacy Seller chưa có Store: kiểm
   application ngoài transaction rồi PATCH có thể chen sau first-submit và sửa
   Store không tăng revision/audit. Barrier test ban đầu RED (200 thay vì 404/409).
   Đã sửa khóa User trước, đọc/khóa Store và kiểm application trong cùng transaction;
   regression và bộ HTTP đều đạt, Argon review delta không còn P1/P2.
2. Chrome phát hiện GET Owner trả bare null bị HTTP serialize thành body rỗng,
   khiến UI hiểu sai là dữ liệu hỏng. Sửa contract `{application: View|null}`,
   bổ sung HTTP literal JSON và parser tests. Static review trước đó không phát
   hiện lỗi này; không dùng kết quả static để thay bằng chứng Chrome.
3. Lỗi validation trước khi lưu intent từng khóa nhầm draft. Đã phân biệt lỗi
   trước/sau khi lưu intent, test giữ bản nháp sửa được đạt.
4. Những lượt Chrome dừng ở locator hoặc kiểm upstream quá sớm là lỗi harness;
   đã chờ response thật và đặt nhãn truy cập rõ. Không ghi các lượt đó thành PASS.
   Một lượt full E2E đầu thiếu build CLI đã thất bại; build và full suite sau đạt.

22 HTTP cases còn kiểm: guest/role/IDOR, no-store, query/body lạ, hai submit
đồng thời, hai Admin approve/reject chỉ một thắng, replay cùng mã, khác payload,
đóng mã chưa chạy và writer đến muộn; quyền/cv mới; legacy bypass kể cả rollout
tắt; Search enqueue lỗi hoàn tác toàn bộ; DB chặn sửa audit/grant/receipt,
đổi owner, nhảy revision và status thiếu audit.

## Chrome và dữ liệu QA

Chỉ container QA `bckl-safe-qa-20261021`, binding `127.0.0.1:5549`.
Demo `bckl_postgres` dừng. Không dùng dotenv checkout, không reset/drop DB.
App-role không SUPERUSER/CREATEDB/CREATEROLE; migrator riêng chỉ dùng migration
và full suite cần tạo DB test con. Credentials lấy từ private profile ngoài Git,
không đưa vào tài liệu hoặc log. v953/v954 và dữ liệu tổng hợp được giữ lại.

Chrome report local: `artifacts/seller-onboarding-browser-20261026/r1793021225266/report.json`.
Trong đó có SHA-256 các source đã chạy; 4 ảnh Owner/Admin desktop/mobile cùng thư mục.
Harness: `scripts/test-store-onboarding-browser.mjs`, cần DATABASE_URL app-role QA
v953 qua launcher kiểm an toàn, `--output <new-absolute-directory>` và
`--playwright-module <absolute-module-path>`; phải build Backend trước khi chạy.
Không chạy browser đồng thời với E2E trên cùng DB. Harness từ chối DB khác,
dotenv, role không đúng, worker đang bật và thư mục output đã tồn tại.

Các nhóm: đăng ký USER + same-tick submit một POST + abort sau upstream200;
reload/đối chiếu không trùng Store; reject/edit/resubmit v1→4; approve rồi abort,
reload và đối chiếu chỉ một grant/session rotation; đăng nhập SELLER và đọc Cart;
suspend/chặn Owner/restore không cấp lại grant; 4 viewport không tràn vùng form.
Cuối cùng v7, 7 audit, 6 status history, 1 grant. Hash các bảng Order/Payment/
Refund/Adjustment/ProductVariant/Stock/SearchOutbox trước và sau không đổi.

Abort là can thiệp có kiểm soát sau response upstream 200, không phải mô phỏng
mất gói vật lý. Cart chỉ đọc, không thay kiểm thử Checkout/COD. Browser Admin
tuần tự, cạnh tranh được kiểm ở HTTP/PostgreSQL. Chưa nghiệm thu dark mode,
KYC, thuế, ngân hàng thật, thông báo tự động hoặc toàn dự án.

## Review AI và giới hạn

Gemini CLI `gemini-4-argon-medium`, effort Medium: review thiết kế, Backend,
Web, delta khóa legacy và delta envelope/validation. Đây là review kỹ thuật
theo ủy quyền, không giả làm approval của thành viên. Lượt source review đầu
timeout là PARTIAL, chỉ lượt hoàn chỉnh sau đó dùng làm bằng chứng.

Log local trong `deliverables/seller-onboarding-*20261026*`: full Backend,
unit, full FE, upgrade, schema diff, Chrome r1–r6 và Argon JSON. Không commit
private profile, log thô, credentials hoặc ảnh có dữ liệu thực. P3 còn ghi nhận:
rate limit chỉ đếm command đã commit, SQL ràng buộc kiểu bool của receipt còn
binding giá trị do service verify; DB writer đặc quyền nằm ngoài API boundary.

## Bàn giao và rollout

Hai cờ `SELLER_ONBOARDING_ENABLED` và `VITE_SELLER_ONBOARDING_ENABLED` mặc định
false. Migrate trước; bật Buyer capability Backend/Web trước khi duyệt hồ sơ.
Bật onboarding đồng nhất các replica, dùng tài khoản tổng hợp, kiểm register
trả USER và luồng approve/đăng nhập lại. Không tắt cờ lúc còn journal đang chờ;
drain/đối chiếu trước rollback, không thu hồi Buyer capability của tài khoản đã
được nâng quyền. GET sau receipt lỗi chỉ tải lại dữ liệu, không gửi lại lệnh.

Màn Owner `/account/store-application`; Admin `/admin/store-applications`.
SRS P0 cơ bản được thực hiện trong phạm vi này, không nhận đã có KYC thương mại.
Review, thông báo, Auth P1 và sandbox thanh toán vẫn là các công việc tiếp theo.
