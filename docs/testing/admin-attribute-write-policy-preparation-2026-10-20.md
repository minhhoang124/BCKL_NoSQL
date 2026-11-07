# Chuẩn bị phần ghi thuộc tính — 20/10/2026

## Ranh giới chính xác

Branch `codex/admin-attribute-write-policy`, base `develop 335b455`. Chỉ thêm
module thuần và unit test; chưa import module vào controller/service chạy thật.
Không lấy schema/source #77 chưa merge làm nền, không sửa API legacy, FE Hiền,
Auth, Product/Search, Prisma schema, migration hoặc lockfile. Không database
runtime bị thay đổi. Đây là PREPARATION có code/test, chưa Write API.

Tại lần kiểm GitHub: #77 head `dd8e5b3`, Đạt đã APPROVE sửa P2 đúng head và hai
CI SUCCESS; vẫn Draft/Open, chưa merge. Approval này chỉ foundation/read,
không phải approval write safety hoặc thay review nghiệp vụ/migration của Hiền.

## Phần code đã làm

`BE/src/catalog/attribute-write-policy.ts`:

- Strict object/allowlist từng create/patch definition/option; không nhận
  ID/actor/category/time/correlation từ client, null/extra/coercion không hợp lệ.
- NFC/trim/gộp whitespace và key lowercase tiếng Việt giữ dấu. Đây là helper,
  chưa unique constraint. Migration phải audit trùng dữ liệu cũ và chứng minh
  normalized key tại DB khớp quy tắc này trước bật ghi.
- Name/value 2–120 Unicode code points, slug 2–140 đúng regex, số nguyên bounded,
  boolean thật; defaults theo #65. Không MULTI_SELECT hoặc thay SKU options.
- Reason NFC/trim 10–500 code points, chặn control ngoài newline/tab; có reason
  trên mutation vô hại vẫn validate. Policy thật cần cả confirm và reason.
- Chặn type/slug/ý nghĩa option đang được ProductValue dùng; options inactive
  vẫn cản đổi khỏi SELECT. Không convert/xóa ProductValue.
- Revision stale bị chặn kể cả no-op; mutation thật tại Int max bị chặn,
  no-op không tăng revision hoặc tạo yêu cầu Search mới.
- Required SELECT khi tạo/bật/đổi rule phải có custom hoặc option active.
  Theo AT16 vẫn cho tắt option đang dùng với consent, kể cả option cuối;
  Product thiếu required sẽ bị canonical predicate loại ở phần runtime sau.
- Kế hoạch trả metadata allowlist/changed/searchMayBeAffected, không ghi DB hay
  phát event. Coarse job (job phạm vi danh mục) sau này vẫn phải skip Product
  payload/eligibility không đổi; flag này không phải index đã đồng bộ.
- Parsed mutation có marker private, entity và operation; tránh dùng PATCH
  thiếu field giả thành CREATE hoặc nhầm option/definition trong caller.

## Test và kết quả thực tế

- Frozen offline install PASS, không đổi dependency/lockfile.
- 90 test mới: parser/Unicode/reason, strict body, revision/no-op/exhaustion,
  type/usage/option gates, policy consent, Search decision và metadata allowlist.
- Full Backend unit **743/743 PASS**, 29 files, 4.85s.
- Backend lint **PASS, 0 warning/error**, typecheck và Nest build PASS.
- Lượt policy ban đầu chưa HTTP/DB E2E mới, browser, deadlock test, migration mới hoặc ES/FAISS.
  Không dùng 90 unit test để nhận các ca AT HTTP/DB/concurrency đã PASS.
- Fault-injection log trong unit nền được phân biệt với assertion failure.

## Điểm nối còn phải triển khai sau foundation merge

1. Đọc lại head develop sau #77 merge; giữ migration cũ bất biến. Chạy audit
   duplicate normalized name/value trước migration unique mới; có trùng thì
   dừng với báo cáo ID, không tự gộp/xóa/backfill ProductValue.
2. Nối parser vào Admin routes với error envelope/quota/body-limit nhất quán.
   Actor phải từ JWT + current account, không từ parser metadata.
3. Chốt và chứng minh lock ordering bằng nhiều connection: khóa definition
   cha trước option child; serialize required-definition creation với Seller
   submit để không lọt phantom rule. Không khóa một process làm bảo đảm.
4. Usage/revision đọc bên trong transaction; metadata + revision + audit +
   durable reconciliation job cùng commit. Retry bounded chỉ lỗi transaction
   được phân loại, không tự retry business409 bằng revision mới.
5. Đặc biệt `ProductService.upsertAttributeValue` hiện đọc definition và gọi
   `normalizeAttributeValue` trước `runSerializable`; submit đọc required
   configuration/values trước transaction. Phải chuyển/revalidate bằng tx và
   protocol tương thích, không chỉ khóa phía Admin rồi gọi là an toàn.
6. Đồng bộ optional inactive projection giữa publicProduct và payload Search;
   giữ NUMBER0/BOOLEANfalse, canonical eligibility và Order snapshots nguyên.
7. HTTP/DB E2E: hai Admin cùng revision, Admin–Seller overlap, option inserts
   nhiều connection không deadlock, duplicate uniqueness, audit/job rollback,
   Search no-op và retry, migration fresh/upgrade. Sau đó Hiền/Đạt review và UI.

## Thuật ngữ để đọc code

- `values`: metadata đã kiểm tra, không bao gồm quyền/actor hoặc DB identity.
- `expectedRevision`: phiên bản client đã đọc; phải so với revision DB còn mới.
- `usage`: thống kê tham chiếu do server đọc trong giao dịch, không nhận client.
- `changed`: metadata thực sự khác, không chỉ body có field.
- `searchMayBeAffected`: có thể cần job đánh giá lại; không phải UPSERT/DELETE
  quyết định sẵn hoặc bằng chứng đã ghi SearchOutbox.
- `next`: metadata dự kiến sau sửa; chưa được lưu, không có revision mới tự đoán.

Không đánh dấu toàn Attributes hoặc Admin DONE. Chưa commit/push/PR tại thời
điểm ghi báo cáo; Gemini đang review độc lập Buyer và chuẩn bị ma trận test,
không chỉnh code nhánh này.

## Bổ sung công cụ migration preflight — cùng ngày

Thêm `attribute-normalization-audit.ts` và CLI
`BE/scripts/audit-attribute-normalization.mjs`. CLI dùng normalizer đã build từ
chính module policy, không chép công thức khác vào script. Chỉ nhận URL explicit
trỏ DB QA tên chuẩn trên localhost/127.0.0.1:5549; không dotenv, không DB demo,
remote hoặc options/search_path tùy ý. Không in URL/password/nhãn nguyên văn.

Reader dùng một connection với REPEATABLE READ READ ONLY, schema public rõ,
statement timeout5s và giới hạn20.000rows mỗi bảng; vượt giới hạn thì thất bại,
không báo dữ liệu sạch từ kết quả bị cắt. Scan cả inactive, group theo Category
cho name và theo definition cho option value. Báo scope/IDs trùng và ID có key
rỗng; không UPDATE/DELETE/DDL/rename/merge. Exit0 khi scan không thấy vấn đề,
exit2 khi có collision/keyrỗng, exit1 khi target/read/build lỗi.

```powershell
pnpm --dir BE build
# Đặt DATABASE_URL đến DB QA được phép bằng kênh cấu hình riêng, không commit.
node BE/scripts/audit-attribute-normalization.mjs
```

Kết quả mới:

- 18 unit audit mới; tổng **108 test mới**, full Backend **761/761 PASS**,
  30files,14.17s; lint/typecheck/build PASS,0warning/error.
- DB mới riêng `bckl_order_resolution_test_attr_audit_1020`, loopback5549,
  fresh14migrations từ develop (không lấy migration #77 chưa merge).
- **4/4 PostgreSQL/CLI tests PASS**,1.38s: collision NFC/case/space kể cả
  inactive, audit lặp không đổi dữ liệu, CLI exit2 với collision, demo-port URL
  bị từ chối trước connection và không lộ credential.
- Suite chỉ tạo/xóa fixture Category/definition/options riêng của nó; auditor
  không sửa dữ liệu. CLI chạy lại sau cleanup exit0 trên DB trống. Đây KHÔNG
  phải xác nhận dữ liệu dev/demo/dataset hiện tại không trùng.
- Trên CI, DB reader vẫn chạy trên service DB riêng; chỉ ca CLI collision
  dành riêng loopback5549 SKIP có nhãn. Build phải chạy trước E2E (workflow
  hiện có đúng thứ tự); không dùng mock read tests làm proof PostgreSQL.
- Chưa full Backend E2E trong nhánh preparation này, chưa migration unique,
  lock protocol/HTTP writes hoặc nghiệm thu concurrency. Cần chạy lại trên
  foundation chính thức sau #77 merge trước nối write API.

Nhánh preparation đã được lưu commit local và nhận develop `6d682e4` sau
merge #70; conflict chỉ kiến trúc, giữ đủ hai phía. Không thay code BE/migration
qua lượt sync. Chưa push/mở PR cho phần preparation này.
