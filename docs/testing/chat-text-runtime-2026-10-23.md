# Chat TEXT REST — bằng chứng và giới hạn

## Bổ sung inbox REST —23/10/2026

Source `d47a8a5bc5176a15641d9f72e61ea1c82952f13f`: **1278/1278 unit PASS**,
57files,24.54s; **850 E2E PASS /1SKIP/20TODO**,51filesPASS/2SKIP,272.29s trên
QA v943. Chat22/22 là tập con, không cộng dồn; 27 parser unit mới cũng nằm
trong1278. Typecheck/lint/Nest build/diff-check PASS. Không schema/migration
mới so21migration đã kiểm. Các số844/1251 bên dưới là baseline trước inbox.

Thêm GET inbox trên cùng nhánh #110, không sửa hai migration hoặc nhánh Hiền.
22/22 Chat HTTP/PostgreSQL PASS trên QA v941 với runtime role hạn quyền, gồm
6ca inbox mới: membership Buyer/Store, last-message allowlist và zero-write,
timestamp tie/null keyset, cursor giả không mở quyền, unread chỉ tin người kia,
Store tạm khóa vẫn đọc, live pagination refresh, query/body/actor stale và
SELLER có hai ngữ cảnh theo cờ quyền mua. Test tie dùng timestamp synthetic
tường minh; không giả đó là nguồn timestamp production. Generated Swagger
spec xác nhận GET mới có Bearer security.

Gemini Argon Medium, conversation `c2ce1566-5d01-4b30-b7d5-ec231c0ce18e`, chỉ
đọc source service + parser được cung cấp: NO FINDING P1/P2. Không controller,
schema/trigger hoặc runtime test trong lượt Gemini; không approval toàn PR.
Lượt HTTP đầu21PASS/1FAIL do expected Object.keys chưa sort đúng thứ tự; đã
sửa assertion và chạy lại22/22. Unit sandbox ban đầu không collect được test
do EPERM thư mục tạm; không gọi đó là test PASS hoặc lỗi logic đã tái lập.
Full regression bản inbox ghi riêng sau khi chạy, không dùng số baseline844
bên dưới thay chứng cứ source mới.

Không thêm chỉ mục activity trong đợt này: inbox vẫn bounded response/query
timeout5s, chưa có benchmark inbox lớn; cần index/EXPLAIN trên dữ liệu thực khi
mở rộng tải. Inbox live không hứa snapshot nhiều trang hoặc socket delivery.

## Gate cuối sau Swagger

Source `ecd86b36376c73d95ae73454d8bfea9c009c9ae4`: **844 E2E PASS / 1 SKIP /
20 TODO**,51filesPASS/2SKIP,283.33s; **16/16 Chat HTTP + generated Swagger spec**
PASS bằng runtime role hạn quyền. Các kết quả843/15 bên dưới là lượt trước,
không cộng dồn. Fullunit1251 và Nestbuild chạy lại trên ecd86b3; service/SQL
nguyên6dfdc53 được Gemini đọc. Sau mục này chỉ commit Markdown bàn giao.

Source cố định `6dfdc53d43f1cd896ca228ee6611591a1dcc72ec` trên nhánh
`codex/chat-text-runtime`, nền develop `0e6bb41936444fe55661a30109f9fb895f4c8cb1`.
Sau commit nguồn này bổ sung metadata Swagger và ca kiểm generated spec, không
thay logic service/migration. Kết quả bản cuối được bổ sung riêng sau rerun. Chưa merge,
`CHAT_TEXT_ENABLED=false` mặc định; **không Chat UI/realtime DONE**.

## Kết quả

- Full Backend unit: **1251/1251 PASS**,56files,24.89s. Chat subset102PASS/
  4files là tập con, không cộng vào1251.
- Full Backend E2E: **843 PASS / 1 SKIP / 20 TODO**,51filesPASS/2SKIP,260.61s.
  Gồm15Chat tests; TODO/skip nền không tự được đánh dấu hoàn thành.
- Typecheck, lint, Prisma format/validate/generate, Nest build và diff-check PASS.
  Schema-diff giữa DB đã migrate và Prisma: No difference detected.
- Fresh QA21migration: `bckl_order_resolution_test_attributes_20261019_v943`,
  loopback5549. Upgrade thực qua Prisma19→21 trên DB mới v942 có User/Store
  synthetic: so nguyên bản trước/sau, preserved=true,21migration hoàn tất,
  chưa có Message trong DB upgrade. DB cũ/demo không bị reset/drop.
- Chat HTTP riêng trên v941 dùng runtime role không superuser/createDB/createRole;
  migration/provision dùng role khác. Lượt15ca nguồn6dfdc53 đạt **3lần liên tiếp**,
  không cộng thành45ca mới; gồm cạnh tranh, quota/restart, role capability.
  Fullsuite v943 dùng migrator QA để các migration suites thực thi schema riêng;
  không nhận đó là chứng minh least-privilege của toàn bộ53suites.
- Gemini Argon Medium đọc độc lập ChatService + migration đầu tại6dfdc53:
  NO FINDING cụ thể, static-only2file. Không chạy test, không đọc controller/
  migration parent fence/helper; không gán là human approval hoặc review toànPR.

## Các ca Chat chạy thật

1. Mở đồng thời cùng cặp:1Conversation, không sinh Message/context ngầm.
2. Guest401/no-store, Admin403, outsider404, không tự chat/forged sender.
3. TEXT trim/Unicode và response allowlist, không lộ key/hash/internal Store.
4. Same scoped key+payload replay đúngID; khác payload409, không thêm sequence.
5. Hai sender cạnh tranh và hai request cùng key: thứ tự1..N, không nhân tin.
6. History trước/sau theo sequence, read ID đúng conversation; read không lùi,
   unread không đếm tin của chính actor.
7. Unknown/duplicate query, control/body rỗng/extra fields và read ngoài scope bị chặn.
8. INSERT lỗi sau parent trigger rollback counter; SQL không sửa/xóa history,
   rewind read cursor, reset/advance counter rỗng hoặc đổi participant.
9. Store SUSPENDED không proof→read-only; owner inactive không gửi/replay dù có
   receipt cũ; Buyer vẫn đọc lịch sử, Seller inactive JWT401.
10. Checkout COD thật của đúng cặp trước history SUSPENDED→cho hỗ trợ; Buyer khác
    không được mượn Order của người kia. Catalog/history suspension là fixture
    QA có nhãn, không dựng lịch sử production.
11. Đóng/tạo lại Nest app rồi đọc history vẫn còn. Đây không phải kill OSprocess,
    power loss hay browser reconnect acceptance.
12. Quota send20/min/actor, request kế429/Retry-After60; bounded memory một instance.
13. USER đổi role SELLER: theo cờ mua #106 vẫn Buyer của đúng hội thoại, senderType
    BUYER, không đổi role DB hoặc mở self-chat. Feature Chat mặc định tắt.

## Các lượt lỗi được giữ đúng nhãn

- App bootstrap đầu thiếu import Auth/Passport:10SKIP, không có runtime proof.
  Đã nối theo module pattern sẵn có; không sửa Auth để né guard.
- Hai sender từng ra201/500: lỗi40001 ở Prisma driverAdapterError.cause.originalCode
  chưa được retry. Đã sửa structured classifier, unit cácSQLSTATE và HTTP cạnh tranh.
- Fullsuite đầu trên DB mang tênChat:9suite bị chặn bởi allowlist Attributes,
  711PASS/132SKIP/20TODO, **FAIL**. Không nới guard hoặc spoof GITHUB_ACTIONS;
  tạo DB QA mới đúng tên allowlist hiện có rồi rerun full đạt kết quả trên.
- DeprecationWarning pg concurrent client.query và vite-tsconfig-paths có sẵn
  được giữ nhãn warning; logs forced errors trong fault suites không phải Chat
  production crash. Không sửa ngoài miền để che chúng.

## Chạy lại

Không copy .env demo. Dùng DB QA5549 riêng, tên đúng allowlist trong test hoặc
GitHub disposable PostgreSQL `klcn_ecommerce`5432 qua safety helper hiện có.
Inject DATABASE_URL/JWT secrets từ cấu hình riêng; migrate deploy, generate,
build rồi `pnpm --dir BE run test:e2e -- test/chat-text-runtime.e2e-spec.ts`.
Không commit credentials/artifacts/model/index. Test tạo marker UUID mới và
giữ immutable Chat history trong DB QA, không có broad cleanup/delete.

## Chưa chạy/chưa triển khai

Web Buyer/Seller, Socket.IO/send/read/reconnect, actual socket-loss
proxy, OS-crash/restart, recipient token-expiry push, Product/media/Order-sharing
và notification chưa được chứng minh. Không tuyên bố toàn FR-CHT-01 hoặc
G-AFTERSALE hoàn thành; API đơn lẻ không thay release gate của chức năng.
Hai migration mới vẫn cần review nghiệp vụ/schema trước merge/deploy.
