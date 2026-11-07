# OrderCommand/audit foundation — bằng chứng T0

Ngày cập nhật: 10/10/2026. Branch: `codex/order-command-readiness`. Baseline hiện tại develop `bed88a0` (#36/#39/#37 đã merge); các số liệu T0 và lượt sửa `4655407` phía dưới là lịch sử trước đồng bộ #37.
Trạng thái: **IN_PROGRESS, chưa merge; chỉ nền database, không phải API xử lý đơn hoàn chỉnh**.

## Kết quả hiện tại — đồng bộ chính thức sau merge #37 ngày 10/10

Hiền approve #38 tại `4655407`, với điều kiện đồng bộ sau merge #37 và kiểm thử lại tích hợp. #37 đã merge tại `bed88a02bc3984c49bfef9ac3dff31937a322973`. Merge thường develop vào branch #38, không force/rebase; chỉ conflict tài liệu kiến trúc, giữ cả mô tả Order list và OrderCommand/audit. Không đổi SQL migration, helper policy/hash hoặc nghiệp vụ ngoài phạm vi đồng bộ.

| Kiểm tra trên branch kết hợp chính thức | Kết quả thực tế |
|---|---|
| Frozen install / Prisma generate / validate | PASS |
| Migrate deploy và status | PASS; 11 migration, không có migration chờ |
| Backend lint / full typecheck / build | PASS |
| Backend unit | **377/377 PASS, 19 suite** |
| Backend toàn E2E | **331/331 PASS, 20 suite**, 81.55 giây |
| E2E Order schema + migration | 37 ca nằm trong full suite, PASS; có upgrade fixture legacy trong schema riêng |
| E2E Checkout create + Order list | 39 + 32 ca nằm trong full suite, PASS; gồm COD → list Buyer/Seller, hai Store, ownership/privacy và audit/replay hai app |
| Audit migration checksum | Không đổi; SHA-256 file khớp checksum DB |
| Cleanup sau suite | 0 User fixture checkout-create/order-list, 0 OrderCommand, 0 schema order_upgrade_* |
| Whitespace / conflict marker | PASS; không còn conflict marker |

Database duy nhất: `bckl_order_command_20261009_a`; không migrate/seed/reset DB demo. Unit có các log lỗi giả lập timeout/connection; E2E có fault injection để chứng minh rollback/retry, không phải lỗi test. Cảnh báo pg concurrent-query và vite-tsconfig-paths còn tồn tại, không nhận đã sửa.

Đã giữ OrderModule + CheckoutModule, guard Order GET trước JSON parser, cookie/CORS Retry-After và writer history `actorId=buyerId`, `actorType=BUYER` của #38. Replay Checkout giữ nguyên history, receipt, stock/version/outbox; đọc list không mutation hoặc lộ PII. Legacy audit nullable không bị backfill/đoán role. Đây là bằng chứng Backend trên branch kết hợp, không phải browser/UI hoặc Order command runtime; detail/confirm/packing/cancel/hoàn kho/delivery vẫn NOT_RUN. CI phải đối chiếu đúng head sau push, không dùng CI `4655407` thay thế.

## Bằng chứng lịch sử — sửa blocker tích hợp sau review e8d84dc

- Merge thường `origin/develop a2561c1` vào branch tại `0ab2bb8`; #36/#39 đã merge, #37 head `e8cdda6` còn OPEN/APPROVED/CI xanh. Không đưa code #37 vào branch #38.
- Root cause: nullable audit bảo toàn legacy nhưng Checkout writer mới bỏ actorType, nên đơn mới có actorId đúng và actorType=null. Sửa writer ghi enum BUYER cùng actorId từ Buyer đã xác thực, trong transaction hiện tại; không đổi migration hoặc helper policy/hash đã được reviewer chấp nhận.
- Red/green: hai assertion HTTP/PostgreSQL thật trước sửa FAIL đúng actorType=null; sau sửa full suite PASS. Kiểm một Store, mọi đơn của Checkout nhiều Store, replay từ app thứ hai giữ nguyên cả id/timestamp/history và các bảng nghiệp vụ.

| Kiểm tra mới trên branch #38 | Kết quả |
|---|---|
| Frozen install; Prisma generate/validate/deploy | PASS, 11 migration ở DB test |
| Backend lint / full typecheck / build | PASS; 13 lỗi nền cũ đã được #39 sửa |
| Backend unit | 333/333 PASS, 18 suite |
| Backend toàn E2E | 297/297 PASS, 19 suite; gồm 37 schema/migration và 37 Checkout create |
| Migration audit checksum | Không đổi, khớp DB |
| Cleanup DB test sau suite | 0 OrderCommand, 0 schema order_upgrade_*, 0 User fixture checkout-create |

DB duy nhất sử dụng: `bckl_order_command_20261009_a`. Không thao tác DB demo. Log lỗi từ fault injection là ca kiểm thử âm; cảnh báo pg concurrent query và vite-tsconfig-paths vẫn hiện hữu, không báo chúng đã được sửa.

**Giới hạn:** actorType nullable vẫn phục vụ legacy, không default/backfill BUYER/SYSTEM. API detail, runtime OrderCommand, confirm/packing/cancel, hoàn kho và delivery vẫn NOT_RUN. Các test replay Checkout không thay bằng chứng replay OrderCommand. Kiểm thử kết hợp #37 ở checkout tạm được ghi riêng phía cuối tài liệu, không phải dependency đã merge hoặc code xuất bản của #38.

## Nguồn yêu cầu và phạm vi

[Contract #27 mục 7.1/7.2](../api/cart-order-inventory-api-contract.md), [SRS v3.1 FR-ORD-01/FR-CAN-01/D07](../analysis/hien/srs-v3.md) và [readiness](../architecture/order-command-backend-readiness.md).

Thêm OrderCommand (bản ghi kết quả yêu cầu để chống xử lý trùng) và audit (lịch sử ai làm gì). Lượt T0 không sửa Checkout. Lượt sửa blocker tích hợp thêm actorType=BUYER vào writer Checkout đã merge, đúng contract hiện hành; không sửa list #37, FastAPI, Auth hoặc contract HTTP. Không thêm DeliveryAttempt/runtime job/UI trong đợt này.

## Cơ chế và giới hạn bảo vệ

| Cơ chế | Điều được bảo vệ | Phần service còn phải làm |
|---|---|---|
| Unique actorScope/idempotencyKey | Cùng actor không claim cùng key cho hai order/command; hai kết nối DB cạnh tranh chỉ một bản ghi | Canonical hash đầy đủ DTO; cùng hash replay, khác hash conflict; kiểm tra quyền lại |
| Deferred constraint trigger | Kiểm tra trạng thái cuối lúc COMMIT; PROCESSING chưa hoàn tất khiến transaction rollback | Ghi Order, Payment, stock, history, outbox và receipt trong cùng transaction |
| Receipt update trigger | Sau SUCCEEDED không sửa nội dung/identity của receipt | Không có TTL/delete endpoint; không xóa receipt để tái sử dụng key |
| Composite history FK + unique commandId | History chỉ gắn command cùng Order, tối đa một history/command | Bắt buộc có history cho mỗi transition và đúng actor/state; DB chưa bắt buộc mọi receipt có history |
| Nullable audit + checks | Không đoán lịch sử; audit có giá trị phải đúng shape, reason và attempt 1–4 | Không bỏ audit ở writer mới; validate reason allowlist và đúng attempt hiện hành |
| Actor FK RESTRICT | Không tự mất actorId khi xóa User | Chính sách khóa tài khoản, không hard-delete lịch sử giao dịch |

`PROCESSING` chỉ là claim chưa commit, không phải job chờ xử lý. Trigger đọc lại row cuối (không dùng snapshot NEW của INSERT) nên claim rồi hoàn tất trong một transaction hợp lệ. Không dùng khóa trong một process làm bảo đảm unique. JSON receipt chỉ được DB kiểm tra là object; shape response/allowlist và state machine phải có validation ở service sau này.

Các cột audit mới toàn null vẫn hợp lệ để giữ writer cũ hoạt động. Vì vậy migration này **chưa ép mọi Order CANCELLED mới phải có audit**; writer mới và bước siết legacy sau review phải bảo đảm yêu cầu đó. Không thêm UNKNOWN hoặc tự gán BUYER/SYSTEM. Không tạo Payment giả, không dựng option snapshot từ Variant hiện tại.

## Kiểm thử và môi trường

Database riêng: `bckl_order_command_20261009_a`, PostgreSQL container `bckl_postgres`. Không thao tác database demo. Upgrade suite tạo schema `order_upgrade_<uuid>` chỉ trong DB test, không có public fallback; chạy các migration cũ bằng Prisma CLI từ checkout rồi chèn fixture lịch sử trước migration mới. Sau test chỉ dọn schema và thư mục tạm do chính test tạo, có kiểm tra phạm vi. Cleanup giữ lại các lỗi thay vì che mất lỗi trước.

| Kiểm tra thực tế | Kết quả |
|---|---|
| Order schema E2E | 34/34 PASS |
| Order migration E2E, chạy chung suite schema | 3/3 PASS |
| Backend unit | 122/122 PASS |
| Backend toàn bộ E2E | 195/195 PASS, 16 suite |
| Prisma validate | PASS |
| Backend lint | PASS sau sửa cảnh báo cleanup |
| Backend build | PASS |
| Full TypeScript (`tsc --noEmit -p tsconfig.json`) | FAIL: 13 lỗi nền ở file không thuộc diff Order |

13 lỗi gồm: `earlyAccess` không thuộc PrismaConfig (1); import `supertest/types` ở các test cũ (10); assertion `ReconciliationStats.locked` không tồn tại (1); thiếu declaration cho `seed-demo-user.mjs` (1). Không sửa lẫn nhánh quality riêng và không tắt typecheck để nhận PASS. Cảnh báo Vite tsconfig plugin và pg query deprecation hiện hữu không được coi là đã sửa trong T0.

Migration SQL SHA-256: `fb66f310e69c5862a934d9857263b6b6bbe78771834bfeb84f9443bd25a5ab2c`, khớp checksum trong DB test. Không sửa SQL đã áp dụng trong lượt này. Kiểm tra sau lần test hoàn tất cho thấy 0 OrderCommand fixture và 0 schema `order_upgrade_*` còn lại; seed demo nhỏ của suite khác có thể còn trong DB test, không khẳng định DB hoàn toàn trống.

### Phủ test

- Legacy: giữ nguyên snapshot tên/SKU/option JSON không chuẩn, district null, actor null, reason cũ, Payment và stock ledger; audit mới null và không tự sinh command.
- FK khác Order, history trùng command, key trùng khác order/command; actor độc lập được dùng cùng key.
- PROCESSING bị chặn lúc commit; claim→history→SUCCEEDED trong cùng transaction hợp lệ; chưa hoàn tất rollback cả history và receipt.
- Hai kết nối DB độc lập tranh key; key/hash/scope sai bị chặn; SYSTEM không cần User giả.
- Receipt thiếu trường, JSON null/array, HTTP status sai, timestamp sai; receipt đã hoàn tất không đổi dù Order thay trạng thái.
- Audit hủy đầy đủ; actorType không đổi theo role hiện tại; xóa actor bị chặn; attempt ngoài 1–4 bị chặn; `restockable=false` không bị mất.

Đây là **test schema**, không chứng minh replay HTTP sau mất response hoặc rollback toàn Order/Payment/stock/outbox. Những ca đó vẫn NOT_RUN tới PR command. Upgrade dùng fixture tổng hợp, không phải kết luận dữ liệu demo/production sạch.

## Chạy lại

Trỏ DATABASE_URL rõ ràng vào DB test riêng; kiểm tra không có `.env` ở checkout/BE ghi đè. Không copy credential vào tài liệu/log. Dùng migration deploy, không reset/db push:

```text
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE exec prisma validate
pnpm --dir BE test:e2e order-command-schema.e2e-spec.ts order-command-migration.e2e-spec.ts
pnpm --dir BE lint
pnpm --dir BE build
pnpm --dir BE test
pnpm --dir BE test:e2e
pnpm --dir BE exec tsc --noEmit -p tsconfig.json
git diff --check
```

## Điều kiện tiếp tục — trạng thái lịch sử trước đồng bộ

#36/#37 vẫn OPEN tại lần kiểm tra; không tự merge/stack để vượt review. Sau khi người dùng merge các dependency và nền này: đồng bộ develop, test COD tạo→list trên cùng DB riêng, chốt cách trả Payment/audit/options legacy; triển khai detail rồi Seller commands, cancel/stock/outbox, delivery/D07 và UI theo thứ tự. G-CHECKOUT/G-FULFILMENT chưa DONE.

## Bổ sung code chuẩn bị policy/request — 09/10, sau T0

Phạm vi: hai helper và hai suite unit tại `BE/src/order/`, kiến trúc/readiness; không sửa schema, migration, writer Checkout hoặc nối endpoint. Luồng đã chốt trong contract được kiểm thử độc lập để dùng sau khi review nền.

| Kiểm tra chạy lại | Kết quả |
|---|---|
| Unit hai helper | 107 ca mới, gồm đủ 9 OrderStatus với 5 cặp actor/command |
| Toàn Backend unit | 229/229 PASS, 13 suite |
| Toàn Backend E2E | 195/195 PASS, 16 suite, DB `bckl_order_command_20261009_a` |
| Lint / build / Prisma validate | PASS |
| Full TypeScript | FAIL với đúng 13 lỗi baseline kể ở T0; không có diagnostic trong helper/spec mới |

Lượt E2E đầu chỉ đạt 54 ca/skip 139/fail 2 vì môi trường thiếu JWT_ACCESS_SECRET; chưa phải regression chức năng. Đã chạy lại toàn suite với JWT test tạo tạm trong process và DATABASE_URL trỏ rõ DB riêng, kết quả 195/195 ở trên. Không ghi secret vào file hoặc dùng DB demo. Cảnh báo pg/Vite cũ vẫn tồn tại.

Ca mới: quyền Buyer/Seller; nguồn/đích của từng lệnh; trạng thái đích không giả replay; ID đúng Int và không ép string; header ASCII 16–128 (kể cả newline cuối); body/extra field và dữ liệu kế thừa; reason allowlist/text trim; canonical v1 Unicode/thứ tự key; nội dung khác phải đổi hash; key không đổi intent hash; bản chuẩn hóa được copy/freeze; error không echo key/body.

Không có test mới về HTTP replay, nhiều process thực hiện command, cancellation restore, Payment/outbox rollback hoặc transport runtime. Các ca này **NOT_RUN**, không lấy 107 unit hay 195 regression E2E làm bằng chứng chúng đã hoàn thành. Header/body helpers chưa nối router nên chưa thay hành vi API hiện hành.

## Kiểm thử kết hợp list #37 và audit #38 — không xuất bản dependency chưa merge

Checkout riêng `.worktrees/order-audit-list-integration`: nền merge develop của #38 `0ab2bb8` + #37 `e8cdda688e2c6ae6a361c9ddfa13461ec5525d7d`, áp dụng cùng sửa writer và assertion audit BUYER. Merge tạm có conflict tài liệu kiến trúc; giữ nội dung cả hai phần. Không commit/push hoặc merge PR từ checkout thử nghiệm này.

- Frozen install, Prisma generate và full TypeScript: PASS.
- Chạy chung `checkout-create.e2e-spec.ts`, `order-list.e2e-spec.ts`, `order-command-schema.e2e-spec.ts`, `order-command-migration.e2e-spec.ts`: **107/107 PASS, 4 suite** trên cùng DB test `bckl_order_command_20261009_a`.
- Hai integration case có sẵn tại head #37 đi qua HTTP thật Cart → preview → COD create → Buyer/Seller list và Checkout hai Store: snapshot/tiền/ownership/privacy đúng, GET/replay không đổi state. Suite create kiểm actorId và actorType=BUYER của history mới; suite schema/upgrade kiểm migration và legacy audit nullable.
- Đây là bằng chứng tương thích ở checkout tạm, không phải 107 ca mới, không phải full suite trên branch kết hợp, không phải browser/UI nghiệm thu. Regression đầy đủ trên branch xuất bản #38 là 333 unit/297 E2E ở mục hiện tại. Sau #37 merge vẫn cần đồng bộ và chạy lại head tích hợp chính thức.
