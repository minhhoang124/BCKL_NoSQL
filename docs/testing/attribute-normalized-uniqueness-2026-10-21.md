# Attributes: chống trùng tên/value ở PostgreSQL — 21/10/2026

## Phạm vi thật

Nhánh `codex/attribute-normalized-uniqueness`, nền chính thức `be568e0` sau
#86/#73. Bổ sung migration **mới** theo contract #65 và chuyển lỗi unique đã
biết của hai API definition cũ thành 409 an toàn. Không lấy code #83/#91/#87
chưa merge làm dependency chính thức. Không coi phần này là Backend Attributes
ghi hoàn chỉnh, không bật editor ghi của Hiền.

## Cách hoạt động và ý nghĩa biến

| Tên | Ý nghĩa |
|---|---|
| `normalizedAttributeNameKey` | Hàm TypeScript tạo khóa so sánh theo contract; chỉ là helper, không thay ràng buộc DB |
| `attribute_normalized_key_v1` | Hàm PostgreSQL được expression index sử dụng khi INSERT/UPDATE |
| `attribute_vi_v1` | Quy tắc chuyển chữ thường ICU tiếng Việt tường minh, không kế thừa locale tùy máy |
| `categoryId` | Phạm vi duy nhất của tên definition; hai Category khác nhau được dùng cùng tên |
| `attributeDefinitionId` | Phạm vi duy nhất của option value; hai definition khác nhau được dùng cùng value |
| `revision` | Phiên bản cấu hình; migration không tăng/reset hoặc viết lại dữ liệu cũ |
| `ATTRIBUTE_NAME_CONFLICT` | 409 khi tên definition trùng khóa chuẩn hóa, dù slug khác |
| `ATTRIBUTE_OPTION_VALUE_CONFLICT` | Mã mapper dành cho unique value; chưa có API ghi option mới trong PR này |

Chuẩn hóa: NFC → bỏ khoảng trắng đầu/cuối → gộp chính xác tập whitespace của
ECMAScript thành một dấu cách → lowercase `vi-VN`, **giữ dấu**. `Kết  nối`
và ` KẾT NỐI ` trùng; `Màu` khác `Mau`; không dùng NFKC để gộp ký tự fullwidth.
Index so byte bằng collation C sau chuẩn hóa. Inactive vẫn giữ chỗ; muốn dùng lại
phải mở bản ghi cũ theo workflow đã duyệt, không tạo bản sao để né lịch sử.

Migration khóa ghi hai bảng trong giao dịch (lock timeout5s/statement60s), kiểm
nhóm trùng rồi tạo hai UNIQUE expression indexes. Nếu trùng, cả DDL rollback,
log chỉ số nhóm; không sửa tên/value, FK, ProductValue, revision, timestamps,
audit hoặc tự gộp bản ghi. Legacy key quá2000 bytes dừng rõ ràng trước tạo index,
không cắt/hash mất ý nghĩa. Migration mới không sửa migration dùng chung.

Nhãn/value gốc vẫn được lưu để hiển thị. Không thêm cột response mới; Prisma
không biểu diễn expression index nên schema chỉ chú thích, SQL migration là
nguồn chuẩn cho hai index này. Không dùng `db push` thay migration vì có thể
không bảo toàn index/trigger SQL không mô hình hóa trong Prisma.

Hai API definition cũ giữ nguyên transaction/policy. Mapper chỉ nhận P2002 với
tên constraint/target allowlist; không phân tích câu SQL hoặc biến lỗi DB bất kỳ
thành 409. Unique rollback cả revision/job trước response. Đây **không phải**
thay thế CAS/confirmation/reason/usage/audit đầy đủ của contract #65.

## Kiểm thử thực chạy

QA PostgreSQL17 riêng, loopback5549, role không superuser; chốt target trước
collection, checkout không `.env`. Demo `bckl_postgres` giữ tắt trong đợt này.
Không nối/test/migrate/dọn hoặc đổi cấu hình DB demo. Profile/mật khẩu không
commit; dữ liệu kiểm thử không dùng dữ liệu kinh doanh/demo.

| Kiểm tra | Kết quả |
|---|---|
| Frozen offline pnpm install | PASS,585 packages, không đổi lockfile |
| 16 migrations rồi upgrade17 trên QA v905 | PASS |
| Fresh17 migrations trên DB QA v906 mới | PASS |
| Full Backend unit | **784 PASS**,36 files,17.41s |
| Full Backend E2E source cuối | **685 PASS /20TODO**,37 files PASS/1SKIP,181.10s |
| Riêng SQL migration/concurrency | 12 PASS, nằm trong full E2E trên |
| Riêng HTTP PostgreSQL | 3 PASS, nằm trong full E2E trên |
| TypeScript, Backend lint/build, Prisma validate | PASS |
| Diff whitespace / migration cũ | PASS / không thay đổi |

12 SQL tests dùng schema QA duy nhất, fixture bảng tiền điều kiện tối thiểu và
**migration revision/audit thật**; không nhận đây là toàn bộ lịch sử schema.
Fresh17/upgrade17 trên DB thực là bằng chứng migration pipeline riêng. Test
chụp trước/sau metadata/options/ProductValue/audit, gồm timestamp/revision;
collision/oversize không để lại function/collation/index hoặc sửa dữ liệu.
36 chuỗi parity kiểm cả whitespace ECMAScript, NFC/NFD, dấu Việt, Greek sigma,
Turkish dotted-I, astral/emoji và ký tự không phải whitespace. Không nhận corpus
parity này là chứng minh mọi phiên bản Unicode/ICU trên mọi hệ điều hành.

Hai kết nối thật được điều khiển để quan sát `pg_blocking_pids` trước commit:
hai alias khác slug chỉ một dòng thắng; option khóa cha trước FK insert, đúng
một lần tăng revision, loser23505. Đây là proof DB UNIQUE, **chưa phải** chứng
minh mọi writer production đã theo shared fence của #91.

HTTP login/Nest/Prisma/PostgreSQL thật kiểm CREATE alias inactive, PATCH alias
NFD và slug trùng:409 đúng mã, snapshot definitions/audits/jobs không đổi. Không
mock thành công HTTP/DB. Chưa browser, ES/FAISS hoặc giao diện ghi Attributes.

Lượt đầu SQL test có lỗi escape trong fixture (chưa collect); đã sửa. Lượt đầu
HTTP fixture ký JWT qua provider chưa cấu hình secret, lỗi setup; đã chuyển
login HTTP thật. Hai lượt lỗi không tính PASS. Full E2E685 là lần chạy lại sau
sửa HTTP mapper/fixture, không dùng682 E2E của source trước thay thế.

CLI reviewer độc lập model Opus Thinking chỉ đọc source đã được gọi, nhưng
hai lượt hết180s trước kết luận đầy đủ. Có partial nhận xét về whitespace/case;
không nhận đó là full review, kiểm thử độc lập, “0 blocker” hoặc approval.
Vẫn cần Hiền/Đạt review migration/ý nghĩa Product/Search và CI đúng head.

## Tái lập và cổng tích hợp

1. Dùng checkout sạch, `pnpm install --frozen-lockfile`, PostgreSQL17 UTF8 có
   ICU. Cấu hình URL qua process environment theo tài liệu chốt QA của #88;
   local chỉ127.0.0.1:5549 và namespace Attributes QA, không copy `.env` demo.
2. Trên DB QA trống: `pnpm --dir BE exec prisma migrate deploy`. Chạy kiểm tra
   preflight dữ liệu cũ bằng auditor #83 khi PR đó được duyệt/merge; không chạy
   thử migration trên demo để tìm xung đột. Nếu migrate thật gặp collision,
   giữ nguyên dữ liệu, lập quyết định xử lý rồi theo quy trình failed migration
   của Prisma; không tự `resolve --applied`, reset hoặc sửa migration để vượt.
3. `pnpm --dir BE test`, `pnpm --dir BE test:e2e`, `pnpm --dir BE typecheck`,
   `pnpm --dir BE lint`, `pnpm --dir BE build`, Prisma validate, diff-check.
4. Nối #83 dùng cùng helper (thay bản chuẩn hóa lặp), #91 cho giao dịch,
   #87/shared writers cho Seller/Admin/import/submit; triển khai endpoints
   mới theo contract. Việc này còn cần review đúng head và PR implementation.
5. Bàn giao Hiền commit đã merge + API response/errors + QA fixture riêng rồi
   mới nối ghi editor, kiểm browser/rollback/race/Search end-to-end.

**Giới hạn vận hành:** cần quyền CREATE COLLATION/ICU ở DB migration. Giữ hàm
v1 bất biến; không CREATE OR REPLACE hàm dưới index đã xây. Khi nâng ICU/Unicode,
audit trùng và parity lại, xây/reindex có kế hoạch; chỉ refresh collation version
không sửa index cũ. Khoảng lock timeout phải lên kế hoạch trước triển khai dữ liệu
lớn. Không công bố hệ thống đã an toàn production từ kiểm thử QA này.

## Nguồn thiết kế

PostgreSQL hỗ trợ UNIQUE expression index để ràng buộc khóa biến đổi mà không
thay dữ liệu hiển thị: [Indexes on Expressions](https://www.postgresql.org/docs/17/indexes-expressional.html).
NFC cần UTF8, lower phụ thuộc locale: [String Functions](https://www.postgresql.org/docs/17/functions-string.html).
Quy tắc case/ICU và lưu ý version: [Collation Support](https://www.postgresql.org/docs/17/collation.html).
Quy tắc nghiệp vụ của nhóm nằm ở [contract #65](../api/admin-category-attributes-contract.md),
không tự thêm quy tắc từ tài liệu PostgreSQL.
