# Chat Web/realtime — kiểm thử và điểm dừng 24/10/2026

## Gate sau merge #110 —24/10

#110 đã squash vào develop `85881cb765c5b92c1dd396a41d1ee297325ef1e3`.
#111 merge nền tại `a8359a4`; `git diff bec6c6f HEAD --exit-code` =0, không
thay runtime/test/schema/config khi giải conflict. Trên nền mới chạy lại:
33/33ChatHTTP/socket/PG PASS,28/28ChatFE PASS, Chrome4/4nhóm PASS tại
`artifacts/chat-web-browser-20261024/r1792812858086/` (head/hash đúng a8359a4).
Full BE trên cùng cây source trước sync:1282unit/26.28s;861E2E/1SKIP/20TODO,
52filesPASS/2SKIP/337.46s. Typecheck/lint/build/diff đạt. Full FE1286/6liveSKIP
ở lượt trước cùng runtime, không giả vừa chạy lại fullsuite sau sync.

Gemini Argon Medium SQL review conversation
`c1442583-3bd7-4833-93d6-9e73c4090cec`: không thấy blocker trong2migration với
canonical membership/service + SERIALIZABLE/parent lock. Lượt CLI dài trước
`9d95de53-c74d-4d8a-b116-5a487a359879` hết180s, response rỗng, không tính review.
Không human approval mới. Annotations CI xác nhận job không khởi chạy do
billing/spending limit, không gọi CI xanh. Người dùng cấp ngoại lệ cho Codex/
Gemini review/QA rồi merge phần đủ điều kiện, không bỏ branch protection.
Default-off giữ nguyên; chưa Product context/Order/media/video/benchmark/
multi-replica push hoặc toànChat hoàn thành. Các mục Draft/pause cũ là lịch sử.

## Tiếp tục 24/10: đối kháng lớp kiểm phản hồi Web

Source sửa `8aec49f`; full FE **1286PASS/6liveSKIP**,70filesPASS/1SKIP,
139.23s. Chat28 là tập con, không cộng thêm. Build/typecheck/lint đạt trên
source sửa; commit tiếp chỉ bổ sung số liệu này, không đổi runtime.

Người dùng đã yêu cầu tiếp tục; các đoạn tạm dừng bên dưới là lịch sử.
Gemini Argon Medium review chỉ file chatApi.ts, conversation
`76297d25-e3a2-406f-8d34-bf0d6a276b73`. Không coi các nhãn HIGH của review
snippet là exploit đã chứng minh: caller hiện parse history theo conversation,
Backend kiểm membership, và TEXT được trim canonical. Không đổi contract vì
giả định Backend lưu whitespace; `beforeSequence=1` trả trang rỗng là hợp lệ.

Đã tái lập **5 test FAIL trước sửa**, sau sửa **28/28 Chat FE PASS** (gồm
6 test mới, có đối chứng mở hội thoại hợp lệ và read cursor tiến ở tab khác):
- So tên trường theo số lượng/own-property, không join bằng dấu phẩy; kiểm
  metadata ngày/sequence của open thay vì chỉ buyer/store/id.
- Unread không vượt khoảng sequence sau read cursor; read receipt cùng
  sequence phải đúng Message ID. Cursor đã tiến xa hơn vẫn hợp lệ.
- Merge kiểm cả lịch sử cũ và mới, không trộn conversation/duplicate identity;
  so các trường bất biến, không phụ thuộc thứ tự key JSON.

Đây là hardening boundary, không bằng chứng Backend thật trả dữ liệu sai hoặc
đã rò rỉ hội thoại. Không schema/API/Auth/Search mới. Giữ pending khi response
không hợp lệ. Lint/build đạt (5warning Admin nền), diff-check đạt.
Chạy lại **33/33 HTTP/socket/PostgreSQL PASS** trước sửa FE; BE nguyên byte.
Chrome bản FE sửa **4/4 nhóm PASS**,8PNG:
`artifacts/chat-web-browser-20261024/r1792809063933/`. Report có head trước
commit và hash source thực tế của working tree; không nhầm head cũ là source
không đổi. Lượt trước sửa cùng ngày cũng4/4 tại `r1792808811923`.
Database QA5549/v941, demo stopped, không reset/xóa dữ liệu. Chưa merge #110/#111,
chưa Product context/Order card/media/video hoặc toàn Chat DONE.

## Lượt chốt trên source cố định

Source `627e6270f9b337d0b7832a293a87e1efc7a3110f`; commit kế chỉ Markdown.
Backend **1282unit PASS**/58files/24.59s; **861E2E PASS/1SKIP/20TODO**,
52filesPASS/2SKIP/292.17s. Frontend **1280PASS/6liveSKIP**,70filesPASS/1SKIP,
142.42s. Chat33HTTP/socket,4gatewayunit và22FE là tập con, không cộng thêm.
FE/BE lint, typecheck, build và diff-check PASS; FE còn5warning Admin nền.
Peer tsconfck TypeScript6/pg.query warnings không được nhận đã sửa.

Chrome nguồn này **4/4groups PASS**,8PNG tại
`artifacts/chat-web-browser-20261024/r1792777847583/`. Report có checkoutHead
và SHA256 của gateway/service/UI/journal/parser/CSS/driver/lockfile. Đã xem ảnh
desktop/mobile, gồm ảnh OS dark sau khi sửa contrast theo storefront chọn light.
Mọi lượt QA đã kết thúc; DB demo không được chạy hoặc thao tác; không xóa QA.
Tạm dừng theo yêu cầu người dùng, chưa merge hoặc bật feature.

Nhánh `codex/chat-web-realtime` từ #110 `5b443da`, không phải develop đã có
Chat. Không migration mới trong delta. Default-off, chưa merge; người dùng yêu
cầu xong đợt này tạm dừng, không mở việc mới/auto-merge.

## Bằng chứng đã có trước lượt chốt cuối

- Backend Chat HTTP/socket/PostgreSQL:33/33 PASS trên QA5549/v941 bằng role
  không superuser/createDB/createRole. Gồm22REST +11socket; không cộng dồn với
  fullsuite. Unit4lịch có điều khiển của gateway đã PASS: expiry sau DBwait,
  destroy khi handshake chờ, leave thắng slowjoin, credentials đổi trước ack.
- FE Chat22/22 PASS: strict contract/bounds/sequence gap, journal CAS/silent
  failure, StrictMode/double submit, lost response/reload samekey, session cũ,
  GET lỗi sau receipt, XSS text và membership bị thu hồi xóa nội dung cũ.
- Full FE trước2regression bổ sung:1278PASS/6liveSKIP; full BE trước4unit và
  các sửa cuối:1278unit PASS, E2E PASS (chưa dùng số suy từ test mới làm bằng chứng).
  Lượt chốt source cố định sẽ bổ sung riêng; không nhận số cũ thay source mới.
- Chrome4nhóm PASS trên QA thật:desktop/mobile390, OS light/dark; Buyer→Seller
  và reply về dưới5s không manual refresh; double click một Message; read cursor
  khớp DB; hủy response SAU forwarding POSTcommit → reload không tự gửi → same
  body/key retry chỉ một Message; offline/reconnect tải bù; pagination fixture
 31tin ghi bằng service có nhãn, không giả31UI gửi; logout/login outsider không
  thấy history. 8ảnh/bundle; container demo vẫn dừng.

## Review độc lập và phản biện

Gemini Argon Medium thực sự đọc Gateway (conversation
`f7d4f298-1f5d-4650-ab31-6dd97ee5ed2d`) và nêu expiry-after-DB, stalejoin/leave,
postdestroy registration và fanout. Đây là rà tĩnh, không human approval.
Đã thêm hậu kiểm expiry, authorization fence có khóa ở PostgreSQL, postaction
auth, subscription generation, pending/destroy fences, queue/batch có giới hạn
và4unit lịch lỗi +HTTP/socket regressions. Một phần schedule expiry ở socket đã
có timer bảo vệ; không chép nguyên severity P1 thành exploit production đã chứng minh.
Các lượt CLI stdin không có nguồn/trả rỗng/REVIEW_READY không tính là code review.

## Lỗi QA đã gặp, không che bằng runtime

- Fixture ProductVariant nested ban đầu nhận dư storeId → Prisma validation;
  sửa fixture dùng relation parent hiện có, không sửa schema/contract.
- Driver getByText trùng sidebar preview/history → scope vào list tin nhắn.
- Thiếu jsdom annotation khiến14test fail trước setup; đã sửa môi trường test.
- Testmock void thiếu undefined khiếnTS lỗi; đã sửa fixture, không bỏ typecheck.
- Đọc ảnh thấy dark title thiếu tương phản do theme cục bộ khác shell; đã dùng
  palette `--market-*` và thêm assertion heading/section foreground đồng nhất.
- Warning nền tsconfck TypeScript6/pg.query và5Admin lint không nhận đã sửa.

## Chạy lại / giới hạn

Không dùng .env demo. Inject cấu hình QA qua launcher riêng và guard target.
`scripts/test-chat-browser.mjs --playwright-module <installed-path> --output
<ignored-artifacts-path>` chỉ nhận v941/5549 và từ chối dotenv checkout. Driver
ghi head/source SHA256, report/PNG không credentials. Không xóa Chat immutable
history hoặc QA DB để làm xanh. Frontend flagtrue, Backend flagtrue chỉ trongQA.

Chưa Product context/media/Order card hoặc toànChat DONE. Không distributed
push/benchmark/OScrash. Sau khi nghỉ: review đúng source→#110 đủ gate mới tích
hợp nền→sync Web/realtime→kiểm lại bản kết hợp. Không dùng approval66 cho110
hoặc số local PASS làm CI xanh.
