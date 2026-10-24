# Bằng chứng Chat Product context —24/10/2026

## Kết quả cuối source aeec556

- **Backend unit1282PASS**/58files/46.38s, tối đa2worker.
- **Backend E2E870PASS/1SKIP/20TODO**,53filesPASS/2SKIP/335.54s.9ca Product
  context là tập con, không cộng thêm. Có regression kill-switch chỉ chặn mới,
  không ngăn replay receipt đã commit; quyền gửi vẫn kiểm trước replay.
- **Frontend1293PASS/6liveSKIP**,71filesPASS/1SKIP/162.01s, pool threads/1worker.
  Lượt forks fail boot ghi bên dưới không được nhận lại làPASS.
- **Chrome4/4nhóm PASS**,16PNG tại
  `artifacts/chat-web-browser-20261024/r1792830549370/`, report headaeec556 và
  hash service/UI/projection/schema/migration/driver. Ảnh thẻ thật từ QA static
  fixture, lazy-image decode có timeout8s; mất201response/reload/retry giữ1row.
- Typecheck/BEbuild, FE build với cờ context bật và mặc định tắt, lint/diff đạt;
 5warning Admin nền và enabled bundle>500KB warning vẫn ghi nhận.
- Fresh22/Prisma validate/schema diff và SQL21→22 probe đãPASS; migration không
  thay sau các lượt này. Không demo/dev DB hoặc chạy lại AI khi không đổi AI.

Source đã đóng băng; commit tiếp chỉ docs/gate, không runtime mới. Phần mới
chỉ Product reference, không nghiệm thu Order/media/Chat resolver/toànSRS.

## Source chốt và review bổ sung

Source8165d95 thêm chức năng; sourceaeec556 sửa kill-switch: chỉ chặn share mới,
không ngăn replay receipt đã commit sau khi kiểm quyền hiện hành. Gemini Backend
review thật conversation804ad716-28bc-45b1-ac38-4890d3fc13b7 không thấy blocker
ownership/public/replay/atomic/privacy trong source cung cấp; ghi chú vận hành
kill-switch đã được nhận và thêm regression. Không giả human approval hoặc
independent re-review của mọi file sau fix. Target trước fix41/41ChatPASS,
Chrome source8165d95 4/4PASS tại r1792815657251 (hash source). Bản aeec556 đã
typecheck/BEbuild và FE production build với cả2flag bật PASS; enabled bundle
512KB có warning chunk>500KB, chưa benchmark/chunk-splitting. Default-off build
trước đó cũngPASS; không thay ngưỡng warning để giấu.

Một lượt fullFE chốt bị3lỗi **khởi tạo forks worker** (Header, AddressRoute,
ChatProductCard), exit1 dù1278test chạy được PASS: KHÔNG tính fullPASS. Không có
assertion lỗi chức năng trong3file vì worker chưa khởi chạy; chưa khẳng định
nguyên nhân môi trường cụ thể. Chạy lại single-thread pool, không bỏ assertion
hoặc tăng timeout; kết quả cuối ghi riêng sau khi có output.

IN_PROGRESS trên codex/chat-product-context, từ develop7596e0f. Không database
demo/dev, chỉ QA mới bckl_order_resolution_test_attributes_20261019_v944:5549.
Runtime HTTP/socket/browser dùng app role không super/createDB/createRole;
fresh migration/upgrade probe dùng QA migrator. Không dotenv hoặc secret trên Git.

## Đã kiểm trước lượt chốt source

- Fresh Prisma deploy22migration PASS; validate/schema diff không khác code.
- SQL20/21 thực tế →22 trong schema QA mới, TEXT/receipt/read cursor giữ nguyên;
  script BE/scripts/test-chat-product-upgrade.mjs PASS, schema giữ lại. User/Store
  prerequisite PK là synthetic, không gọi fullPrisma19→22/OS crash test.
- Backend1282unit PASS. Full Backend E2E PASS; còn1SKIP/20TODO nền. Output tổng
  bị giới hạn hiển thị nên không suy thêm tổng case từ phép cộng. Product context
  file có8ca trong suite: reference only, concurrent replay, foreign/private/
  missing, cross-type hash, hidden/harddeleted replay, revoked sender, rollback.
- Target trước2ca cuối:39HTTP/socket/PG PASS (33nền+6context); không cộng vào full.
- FE full1293PASS/6liveSKIP trước chỉnh presentation thẻ cuối. Có test projection,
  hostile title, host/path ảnh, prop change, journal, wrong Product receipt,
  explicit consent/doubleclick và giữ TEXT draft. Các probe dùng malformed200 có
  nhãn; không khẳng định Backend thật trả sai.
- Build/typecheck/lint/diff PASS;5warning Admin nền, warning component export mới
  đã xử lý bằng tách projection module. AI không đổi, không nhận đã chạy lại AI.
- Chrome4/4nhóm trước presentation cuối: desktop/mobile390 OS sáng/tối, two-way
  TEXT/reconnect/pagination, chia sẻ thẻ đúngStore, ảnh HTTP thật từ upload fixture,
  hidden redaction; Product context lost201response→reload→same-key retry1row.
  Artifact `artifacts/chat-web-browser-20261024/r1792815414321/`,16PNG/hashsource.
  Head trong report là develop trước commit nhưng hash working tree mới thật;
  không dùng head cũ thay source hash. Ảnh32px tổng hợp QA, không claim upload API.

## Review độc lập và lỗi đã sửa

Gemini Argon Medium conversation a25987fe-03bb-4f07-8e02-33660c6db27f chỉ đọc
FE/API/migration: đã xử lý ảnh host/path, state cũ khi đổi reference, bỏ yêu cầu
caller phải truyền magic placeholder khi gọi adapter. Không nhận suy đoán
`productContext:null`, Product deletion làm mấtStore, hay TEXT cùng placeholder
gây hash collision thành blocker: server omit field cho TEXT/lấyStore từConversation,
hash có type; test HTTP replay/type/harddelete chứng minh ranh giới.

Lượt Chrome có kiểm decode ban đầu kẹt vì lazy img ngoài viewport và test App
chưa serveStatic như main.ts; đã dừng đúngdriver10952/runr1792815180865 và con,
không Chrome người dùng. Sửa cuộn ảnh+timeout8s, static uploads theo bootstrap;
không tính lượt bị dừng làPASS. Lượt đầu E2E có fixture JWT thiếu issuer default
và assertion Swagger cònTEXT-only, FE mock nhận thêmundefined; đã sửa/chạy lại.

## Chưa tính hoàn thành

Chưa Order card/video/media, cluster push/load benchmark/Chat resolver hoặc
mọi acceptance SRS. Unknown outcome giữ pending khi mất quyền; không tự xóa.
Client cũ cần nâng cấp trước bật gửi context, hai cờ mới false.
Xem docs/api/chat-product-context.md cho contract/rollout/giới hạn.
