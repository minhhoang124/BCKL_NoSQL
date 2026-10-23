# Attributes timeout503 và bàn giao QA —22/10/2026

Delta sau #94 `01b4c887fbcc918d1c9e8a42e3a55b5424049b5a`, base develop
`e394c9e`. Chưa merge; approval Product/Search cũ không phải approval delta mới.
Không sửa schema/migration/FastAPI/FE hoặc quy tắc đã duyệt ở #65.

## Nguyên nhân và sửa

Probe reviewer trước sửa giữ Category lock thật hơn1000ms, nhận500/INTERNAL_ERROR.
PostgreSQL55P03 nằm trong structured Prisma P2010; boundary chỉ phân loại
40001/40P01 để retry, nên timeout đi qua nhánh lỗi chung. Filter đã che SQL,
không có bằng chứng rò SQL/mất dữ liệu từ ca này.

`isAttributeDatabaseTimeout` chỉ nhận structured P2010/DriverAdapterError với
55P03/57014, map ServiceUnavailableException→503/ATTRIBUTE_WRITE_UNAVAILABLE,
Retry-After:1/no-store. Không nhận error message hoặc object JSON giả làm mã DB.
Áp dụng cả create và patch/options boundary. **Không retry callback** khi timeout;
serialization/deadlock vẫn retry hữu hạn như trước, stale/unique/business không replay.

## Test và kết quả

| Kiểm tra thực chạy | Kết quả |
|---|---|
| Unit cuối sau decoded-password guard |1.055PASS/48files;8,27s |
| Runtime HTTP suite, gồm2ca lock timeout mới |35/35PASS;9,29s |
| Full Backend E2E sau sửa production |800PASS/1SKIP/20TODO;45filesPASS/2SKIP;216,29s |
| Prisma17fresh migrations trên QA v914 |PASS |
| Typecheck/lint/build/Prisma validate/diff |PASS; typecheck/lint chạy lại sau sửa tooling cuối |
| Portable fixture trên QA v914 |PASS; login4account, CRUD qua HTTP, COD/DB thật; chạy lại sau thêm qaDatabase |
| API chế độ --serve trên v914 |Swagger200;4login;2Admin GET200 và2non-Admin403; child server đã dừng |
| Compose QA từ volume mới |PASS; postgres17 cached, bind127.0.0.1:5549; không pull động |
| Role mới trong Compose |NOSUPERUSER/NOCREATEDB/NOCREATEROLE; đủ quyền migrate đúng DB QA |
| Fresh Compose17migration + seed hai lần |PASS;8User/12audit/2Order COD; hash/role/active của4User lần đầu giữ nguyên |
| API trên Compose mới |Swagger200, child server đã dừng |
| --check-target trên restricted QA v914 |PASS; không mutation |

Full E2E800 gồm2ca HTTP mới, không cộng35subset hoặc fixture vào800. Số test
khác review trước vì không ghép reviewer11probe vào PR và live-health đangSKIP.
20TODO và1SKIP không được gọiPASS. Full E2E chạy sau production fix; các thay
đổi tooling/metadata/format sau đó đã kiểm unit/type/lint/seed riêng, không gọi
lượt full cũ là lượt chạy lại toàn bộ trên mọi byte cuối cùng.

Hai ca lock thật kiểm503/Retry-After/no-store/sanitized response và snapshot
Category/definition/options/ProductValue/Product/audit/jobs bất biến sau lỗi;
nhả khóa rồi gửi chủ động lại mới200/201, đúng1audit và không job optional thừa.
Không suy ra mọi timeout/mất response ở client đều chứng minh rollback.

## Gói bàn giao

- `scripts/run-attributes-handoff-qa.mjs`: opt-in; kiểm target/role/migration,
  từ chối checkout có.env/BE.env; --check-target không ghi; seed tạo bundle mới;
  --serve bind3014 loopback, không bind0.0.0.0. Không reset/migrate/create DB trong runner.
- `BE/test/helpers/admin-attribute-handoff.qa.ts` và config riêng: không tự chạy
  trong default E2E;2Admin/Seller/Buyer,4kiểu thuộc tính, option active/inactive,
  DRAFT và Product đã mua, snapshot COD được tạo bằng Checkout thật.
- Compose/init tách ở tools/attributes-qa; shell giữ LF bằng.gitattributes.
- Hướng dẫn API/role/fixture/error/acceptance ở
  [bàn giao editor](attributes-editor-handoff-2026-10-22.md).
- Password sinh tại máy nhận, không có trong source/ZIP/GitHub. Manifest có
  qaDatabase để không chọn nhầm bundle khi đã seed nhiều DB.

Launcher chỉ nhận loopback5549/tên allowlist/public schema/password thực12ký tự,
không để percent-encoding vượt kiểm độ dài. Quét/refuse unsafe target trước
connect; kiểm mọi migration khớp checkout, không chỉ một marker17. Chặn superuser/
createrole; Compose tạo runtime role thêm NOCREATEDB. Runtime QA riêng hiện có
của Hoàng là migrator có quyền tạo DB; không nhận nó là NOCREATEDB.

## Gemini và giới hạn

Gemini Flash Medium rà chỉ launcher/init, không tool/DB và không thay reviewer
approval. Một điểm defense-in-depth được nhận: redaction cả password riêng và
bản decoded, không chỉ URL đầy đủ/JWTsecret. Hai nhận xét còn lại không được
nhận thành blocker: bindloopback được Compose+API cấu hình và test thực tế;
fixture phải có quyền ghi để tạo dữ liệu, source không chứa reset/drop dữ liệu cũ.
Không cấp read-only role rồi nhận seed đã hoạt động. CLI báo15.727token tổng
cho lượt nhỏ này; không phải giá tiền hoặc số liệu của các lượt trước.

NOT_RUN: editor/browser desktop/mobile/dark, loaded ES/FAISS, UI Seller duyệt bán,
managed image file thật, chạy trên máy Hiền. Approval catalog là setup tổng hợp;
imageURL chỉ metadata. Chưa bàn giao nền merged và chưa Admin/G-LISTING DONE.

## An toàn và lỗi thao tác được giữ lịch sử

QA v914 và Compose DB v1 trên127.0.0.1:5549, không reset/drop/purge audit/receipt.
Demo bckl_postgres trước/sau đều dừng. Compose mới và profile private giữ lại;
chỉ dừng container QA của đợt này, không xóa volume.

Một lệnh formatter gọi nhầm root checkout khiến pnpm đồng bộ dependency cache
sharp theo lockfile và chạy postinstall Prisma generate, có đọc root.env vào
process đó. Không migrate/test/queryDB từ lệnh này; không in nội dung.env.
Đã kiểm root develop không có diff tracked/package/lockfile và demo vẫn dừng.
Các kiểm thử sau đó qua launcher từ chối.env và chốt đúng URL QA; lần formatter
không tìm thấy file không được tínhPASS. Không nhận sự cố.env lịch sử đã được
chứng minh không ảnh hưởng chỉ từ các kiểm tra lượt này.

## Gate

Push delta vào đúng #94, yêu cầu review head mới cho timeout/tooling. Không tự
approve hoặc merge. Hiền có thể dựng QA review từ head PR, chỉ nối editor vào
nền chính thức sau runtime được merge. Không gửi localhost của Hoàng như môi
trường chia sẻ; gói không chứa credential, dataset/model/index hoặc dữ liệu demo.
