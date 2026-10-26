# Review Backend — kiểm thử ngày 26/10/2026

Base `develop 76a5d7145c70c5c9178c35319ea9cbc218965720`, nhánh
`codex/order-item-reviews`. Chỉ Backend runtime, chưa nối Web và chưa coi chức
năng Review hoàn chỉnh. Contract: `docs/api/product-review-runtime.md`.

## Kết quả đã xác minh

| Kiểm tra | Kết quả |
|---|---|
| Parser, Unicode, query, hash, config | **44 PASS** |
| Toàn Backend unit | **1510 PASS / 67 files** |
| Review HTTP/PostgreSQL với app-role không đặc quyền | **22 PASS**, bản sửa audit privacy cuối, 9.76s |
| Typecheck, lint và build | PASS; lint 0 lỗi/cảnh báo |
| Fresh migrate QA v955 | **29 migrations PASS** |
| Nâng cấp 28→29, QA v956 | PASS, legacy User/Store/history và checksum migration cũ giữ nguyên; không tạo review giả |
| Prisma schema diff với QA | Không khác biệt |
| Full Backend E2E sau source freeze | **1003 PASS / 1 SKIP / 20 TODO**, 61 files PASS/2 SKIP, 338.95s |
| Chrome/Web Review | NOT_RUN / chưa triển khai |

Unit suite chạy trước hai thay đổi cuối về phân quyền audit và kiểm reply trong
receipt; hai phần này đã chạy lại HTTP/PG riêng và full suite cuối trên source
đóng băng đều đạt. Lint/typecheck/build chạy sau bản sửa. Không đổi FE/AI.

## Đối kháng HTTP/PG

Guest, role sai, Buyer khác, Seller Store khác, credentialVersion cũ, tài khoản
khóa đều bị chặn. API công khai chỉ trả author cố định, reviewId và nội dung
cho phép; không Order/Item/User/email/contact/reason. Admin detail giữ lý do
kiểm duyệt, lịch sử Buyer bỏ lý do nội bộ và báo historyTruncated khi quá50.

Hai create cùng item chỉ một thành công; hai edit cùng revision và reply/hide
đồng thời chỉ một thắng. Một Seller reply, chung revision/audit. Admin hide
loại cả review/reply khỏi page và aggregate; Buyer edit không tự mở lại hidden.
Store SUSPENDED hỗ trợ giao dịch cũ; CLOSED chặn reply mới nhưng trả lại receipt
đã commit. Review quá hạn/Order chưa COMPLETED/config sai bị chặn. Receipt cũ
vẫn đối chiếu được sau hết hạn, Buyer capability tắt hoặc Store đóng.

Reconcile unused key chỉ đóng mã, không tạo Review. Cùng key/body trả receipt
cũ, khác payload hoặc key mới không tạo trùng. Receipt hợp lệ về kiểu nhưng
sai rating bị503, không đổi Review. Lỗi audit được chèn có kiểm soát giữa giao
dịch gây500 và rollback cả Review/receipt. SQL chặn sửa/xóa audit/command,
rating ngoài1..5, nhảy revision/đổi identity và update không có audit khớp.

Ca tích hợp dùng API hậu mãi thật tạo REFUND_ONLY rồi Seller approve: refund
SIMULATED vẫn giữ Review, public chỉ thêm isRefunded, Buyer còn sửa được trong
window. Order/item/payment snapshot và tồn kho bất biến qua thao tác Review.
Không claim hoàn tiền thật, stock/refund service mới hoặc đồng bộ rating AI.

## DB và an toàn

Demo `bckl_postgres` dừng; chỉ QA `bckl-safe-qa-20261021`, `127.0.0.1:5549`.
v955 runtime và v956 upgrade là DB mới, không reset/drop/ghi đè DB cũ. Dedicated
22 tests dùng `bckl_qa_app_20261021` không SUPERUSER/CREATEDB/CREATEROLE. Full
suite dùng migrator không SUPERUSER/CREATEROLE, cần CREATEDB cho test D07 con;
không gọi full suite là app-role. Không dotenv checkout, credential ngoàiGit.

Upgrade script `BE/scripts/test-product-review-upgrade.mjs` là bằng chứng local
với baseline checkout `seller-onboarding-20261026` chứa đúng28migration; không
phải script deploy production. Proof chỉ chứa synthetic legacy User/Store/
history, không nhận đã kiểm tất cả dữ liệu giao dịch lịch sử. Digest trước/sau:
`3a52f41360c8437e9947420161d190a22d8ad4779dc5bbb11bcf5c8c1f759a01`.

Lượt provision upgrade đầu đã từ chối vì mapping còn trỏ DB v955 đang tồn tại;
không overwrite. Sau sửa mapping, v956 mới chạy proof thành công. Full E2E
lượt1 chạy khi source/test còn bị sửa, dẫn một test privacy không khớp phiên
bản đã load; kết quả đó bị loại, không tính PASS. Đã đóng băng source và chạy
lại full suite. Lượt HTTP đầu phát hiện thiếu PassportModule.register trong
module mới; sửa wiring, tất cả22case sau đó đạt. Giữ log thất bại, không xóa dấu.

Sau QA chỉ bỏ một dòng trống EOF dư của migration chưa merge để diff-check sạch;
đã đối chiếu toàn bộ nội dung SQL sau TrimEnd bằng nhau. Không sửa checksum
trong QA v955/v956 hoặc migrate lại các DB đó. CI fresh ở head PR phải xác nhận
file cuối; không gọi hash byte cũ là hash file sau chỉnh whitespace.

## Gemini và phạm vi chứng cứ

Gemini CLI `gemini-4-argon-medium`, effort Medium: review proposal và source.
Đã chốt cùng hướng khóa User→Store→Order hiện có, chung revision cho reply,
window/cursor/privacy/replay rõ ràng. Source review góp ý privacy audit và độ
chặt của reply receipt; đã sửa và test. Nhận xét thiếu header/parser là do
snapshot đầu thiếu configure-app middleware; bổ sung source, không thay bằng
đoán. Re-review cuối trả **NONE P1/P2**. Đây là review AI kỹ thuật được ủy quyền,
không giả thành approval thành viên trên GitHub.

P3: DB trusted service boundary chưa có trigger buộc mọi audit phải kèm command/
reply; runtime ghi cùng transaction, receipt kiểm lại reply. Seller inbox join
có thể cần index bổ sung khi lớn; category visibility hiện dùng predicate chung
quét cây Category; JSON body dùng giới hạn mặc định Nest trước parser nội dung.
Không đưa các điểm này thành claim sẵn sàng vận hành thương mại.

Log local `deliverables/product-review-*20261026*`: source/delta Argon, unit,
HTTP r1–r4, full Backend r1/r2, build, schema diff và upgrade. Private profile
và dữ liệu DB không commit. Chưa có Chrome/Web hoặc thông báo tự động.

## Việc nối tiếp

Sau merge Backend: Buyer completed OrderItem → form tạo/sửa; Product → list/
aggregate; Seller → reply; Admin → moderation/audit. Journal metadata/actor,
không body/reason/token, xác nhận draftversion và explicit reconcile; test
double click, timeout, reload, session switch, mất GET sau receipt trên Chrome.
`PRODUCT_REVIEWS_ENABLED=false` mặc định; bật QA có kiểm soát, chưa tự mở trên
demo. Sau khi khép Web Review mới làm thông báo theo sự kiện đã commit, rồi
Auth P1 và thanh toán sandbox; không giảm phạm vi P0/P1.
