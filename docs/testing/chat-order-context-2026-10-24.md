# Chat Order context — kiểm thử 24/10/2026

PR #113, nhánh `codex/chat-order-context` từ `develop f5490e3` sau #112. Chưa merge;
runtime và hai cờ mới mặc định false. Không nhận toàn Chat hoặc marketplace DONE.
Backend/PostgreSQL thật ở QA loopback **5549**, database mới riêng **v945**;
demo `bckl_postgres` vẫn dừng. Không dùng .env, không reset/drop dữ liệu cũ.

## Kết quả cuối — source runtime cff9462, driver 4247bd7

| Kiểm tra | Kết quả thực tế |
|---|---|
| Backend unit | 1283 PASS, 58 files, 37.36s |
| Toàn Backend E2E | 883 PASS / 1 SKIP / 20 TODO, 54 files PASS / 2 SKIP, 295.26s |
| Riêng Chat HTTP/Socket | 55 PASS / 4 files, 21.66s; gồm 13 Order context cases |
| Toàn Frontend | 1323 PASS / 6 live SKIP, 73 files PASS / 1 SKIP, 145.53s |
| Riêng Chat Frontend | 65 PASS / 5 files, 13.56s |
| Chrome cuối | 4/4 nhóm PASS, 16 PNG, source 4247bd7 |
| BE lint/typecheck/build, Prisma validate/diff, git diff-check | PASS |
| FE lint/build default và build bật Chat Order | PASS; 5 cảnh báo Admin nền |

E2E lần đầu 882PASS/1FAIL tại test Swagger cũ chỉ kỳ vọng hai loại tin. Đã bổ
sung literal ORDER_CONTEXT vào assertion, giữ đầy đủ TEXT/Product, chạy lại
cả 55Chat rồi toàn883E2E đạt. Không lấy lần FAIL hoặc chỉ targeted rerun làm
bằng chứng toàn suite. Lần fixture đầu thiếu shippingFee, setup chưa chạy được
11case, cũng không nhận PASS; đã sửa đúng dữ liệu và chạy lại trên DB thật.
Không sửa timeout, skip hoặc assertion nghiệp vụ để làm xanh.

Runtime/schema/FE không đổi giữa cff9462 và 4247bd7; commit sau chỉ siết browser
driver (chờ Seller lịch sử rỗng rồi nhận mới, so exact HTTP key/body lúc retry).
Các commit bàn giao sau đó chỉ tài liệu, không thay source đã kiểm. Không có
claim đã chạy AI Ruff/Pytest trong task này: AI không đổi.

CI run `40081204621` head cff9462: mọi job có steps rỗng; annotation xác nhận
**job không được started vì payment/spending limit**, không phải xanh hoặc
assertion code thất bại. Không fake approval/GitHub review. PR vẫn Draft.

## Database và giới hạn phép kiểm

- Fresh database: đủ **23 migration** áp thành công, không sửa 22 migration cũ.
- Actual SQL22→23: giữ TEXT/Product/hash/read cursor và trigger immutable.
  Probe dùng schema mới giữ lại, prerequisite User/Store PK tổng hợp; không
  nhận là full Prisma app restart/crash migration proof. Script
  `BE/scripts/test-chat-order-upgrade.mjs`, chỉ nhận QA v945/5549.
- Prisma schema diff: không lệch. Backend lint/build đạt; Web build/lint đạt,
  còn 5 cảnh báo Admin nền, không sửa ngoài phạm vi.
- Enabled Web bundle 516.91KB (gzip152.28KB); chưa tách chunk/load benchmark,
  không thay giới hạn cảnh báo để che kích thước.

`BE/test/chat-order-context.e2e-spec.ts` dùng HTTP tạo COD thật trước chia sẻ;
fixture legacy chỉ dùng cho đơn trái quyền/sai Store/lịch sử cần phủ. Kiểm:
Buyer/Seller mở cùng cặp không tự gửi; foreign/missing cùng404; Admin403;
concurrent same-key một tin/sequence/push; changed payload/type409;
malformed/extra400; snapshot không đổi sau Product sửa; allowlist không PII;
GET không đổi Order/stock/outbox/read; bound Message/Conversation;
kill-switch/new vs replay; owner locked; SUSPENDED đúng mốc; CLOSED read-only;
fresh actor/JWT; DB CHECK/immutability/rollback parent.

Frontend test: strict Message/card, money string, unknown extra/private fields,
identity immutable, journal CAS (chỉ xóa đúng raw đã lưu), mất phản hồi/reload,
không auto gửi, bấm đôi, giữ draft; viewer link; account/session/prop change,
cached card bị xóa sau phiên hết hạn trong poll.

## Chrome thật

Driver `scripts/test-chat-order-browser.mjs`: Chrome riêng + Vite + Nest +
PostgreSQL QA, tài khoản tổng hợp, không credential demo. 4 nhóm desktop/mobile,
OS color scheme light/dark; giữ palette marketplace đã chốt, **không tự nhận
đã xây riêng một dark theme toàn sàn**. Luồng:

HTTP COD → Order Web → explicit mở Chat → explicit chia sẻ → hai phía nhận thẻ
→ doubleclick một tin → mất real HTTP201 sau server commit → reload/key cũ
→ replay không thêm tin → đổi tài khoản bị từ chối. So sánh business snapshot,
stock/outbox trước/sau không đổi bởi Chat. Ảnh/report giữ ở artifacts Git-ignored.

Run đầu `r1792832407608`: các assertion chức năng đạt nhưng ảnh mobile phát
hiện card dùng nhầm cột ảnh Product và CSS li lồng nhau. Đã sửa class riêng và
selector direct-child, thêm assertion độ rộng/overflow; **không dùng run này
để nghiệm thu visual cuối**.

Run cuối `artifacts/chat-web-browser-20261024/r1792833539216/`: report.json
ghi head **4247bd7f7f79ea306358c8afdcb9bff1a12547c0** và SHA-256 từng file
runtime/schema/driver/lockfile; 16PNG. Đã xem ảnh mobile kiểm bố cục sau sửa.
Run trung gian `r1792833122899` cũng4/4 nhưng chưa siết assertion driver cuối.
Không commit screenshot, credentials, upload hoặc DB dump vào repo.

## Review độc lập và quyết định

Gemini **Argon Medium**, read-only source (không DB, không sửa/merge):

- `8b75f64c-c56c-4d11-a6a4-602eeb068326` Backend: không tìm bypass cặp Buyer/Store;
  nhận góp ý mở hội thoại cũ read-only, đã sửa/test. Không nhận suy đoán 403
  ownership transfer vì `assertCanReadChat` trả404 và Admin bị chặn trước lookup.
  Cờ không tắt hydrate history là chủ ý có contract, không sửa thành mất history.
- `c65ebb57-5a1f-4c12-9f3d-bfa571f4f03b` FE: nhận hardening cached-card/session
  và bind expectedViewer từ route nguồn; thêm test. Không ép legacy zero-line
  thành lỗi giả khi Backend hỗ trợ lịch sử thiếu dòng.
- Re-review `3969c8af-ed77-49b2-aed4-d8a342e9b6fd` đã kiểm source sửa và tests,
  không còn concrete blocker trong delta FE. Đây không phải GitHub human
  approval hoặc bằng chứng Gemini tự chạy DB/browser.

## Tái lập

Tạo QA mới cổng5549 theo toolkit QA hiện có, không dùng DB demo5432; đúng tên
v945 và role runtime không superuser/createDB/createRole. Không đặt .env trong
checkout; truyền DATABASE_URL/secret QA riêng qua launcher, không in token.
Apply migration bằng role migrator riêng rồi grant DML/sequence cho app role;
không cấp DDL cho runtime. Các đường dẫn dưới là repo-relative:

1. `pnpm install --frozen-lockfile --offline` nếu cache đã đủ; không đổi lockfile.
2. `pnpm --dir BE run lint`, `typecheck`, `test`, `build`; Prisma validate và
   schema diff sau migrate. E2E chạy tuần tự theo config, không chạy cùng browser.
3. `pnpm --dir BE exec vitest run --config vitest.config.e2e.ts` với QA guard.
4. `pnpm --dir FE exec vitest run --pool=threads --maxWorkers=1`, lint/build.
5. `node scripts/test-chat-order-browser.mjs --playwright-module <absolute-module>
   --output <new-artifact-folder>` sau BE build; cần Chrome đã cài. Script tự
   tạo tài khoản tổng hợp, chạy Backend/Vite loopback và đóng trong finally.
6. `node BE/scripts/test-chat-order-upgrade.mjs` dưới cùng QA migrator; không
   drop schema sau kiểm, không coi unique schema probe là full application upgrade.

Launcher private trên máy Hoàng chỉ đọc profile ngoài repo, hardcode v945,
refuse demo đang chạy/dotenv/target sai. Muốn máy khác tái lập phải dựng profile
QA tại máy đó, không gửi profile có secrets hoặc URL localhost của máy Hoàng.

Giới hạn còn lại xem [contract](../api/chat-order-context.md): một pending/tab,
chưa Chat resolver, media/video, benchmark hoặc nghiệm thu toàn SRS.
