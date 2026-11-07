# NoSQL #24 – Giỏ hàng Redis: thiết kế A v3 (đã duyệt)

Ngày 07/11/2026. Branch `feat/nosql-24-redis-cart`, base HEAD `07c3841`. Writer: Claude (Medium). Reviewer đối kháng: Codex.

## Duyệt của owner (Hoàng, 07/11)

- Bắt đầu code theo phương án A v3. Giỏ guest ngoài phạm vi.
- Migration mới: sequence `cart_line_seq` (CACHE 1, NO CYCLE) và bảng `cart_consumed_lines`.
- Claude triển khai, Codex review đối kháng. Kiểm read-only quyền sequence trên DB QA.
- Kiểm thử trên PostgreSQL và Redis QA riêng; nghiệm thu gồm ca Redis, hồi quy liên quan và `USE_REDIS_CART=false`.
- Commit, push, merge chờ owner duyệt riêng. Không merge vào main trước khi nộp khóa luận (08/11).
- Lệnh quản trị `GREATEST(...) + 1` phải kiểm tràn bigint và báo lỗi rõ.

Lịch sử review: v1 (Claude) → Codex 6 điểm → v2 → Codex 3 điểm → v3 → Codex 4 chỉnh sửa → chốt.

## Phạm vi giữ nguyên

PUT số lượng tuyệt đối; replay receipt kiểm TRƯỚC khi đọc Redis; kiểm quyền/giá/kho/tự mua trên PostgreSQL; giữ dòng chưa mua; hoàn kho theo ledger PostgreSQL (`order-cancellation.service.ts` không đụng giỏ). PostgreSQL vẫn là nguồn của đơn, thanh toán, kho, receipt. FE không đổi contract (`CartPage.run` đã đặt `ready=false` và buộc tải lại sau lỗi khác 400).

## Dữ liệu

- PostgreSQL `SEQUENCE cart_line_seq AS bigint CACHE 1 NO CYCLE`. Seq lấy bằng `nextval(...)::text`, chỉ gọi SAU khi giữ `users ... FOR UPDATE` của user.
- PostgreSQL `cart_consumed_lines(buyer_id, variant_id) PK, consumed_seq bigint, checkout_id, updated_at`. Ghi trong cùng transaction tạo đơn bằng `GREATEST(consumed_seq, seq đã đọc)`.
- Redis `cart:{userId}` Hash: field `variantId` → `qty|seq|addedSeq`; field `_hw` = seq lớn nhất từng được nhận. TTL `REDIS_CART_TTL_SECONDS` (mặc định 604800).
- Dòng hiệu lực: qty > 0 và `seq > consumed_seq` (không có fence = 0).
- Seq/addedSeq là chuỗi thập phân. JS so sánh bằng `BigInt`. Lua kiểm `^[1-9]%d*$`, dài ≤ 19, dài 19 thì ≤ `9223372036854775807`; so độ dài trước rồi thứ tự từ điển. Không dùng `tonumber` cho seq.

## Ghi giỏ (PUT/DELETE)

Transaction Serializable, khóa users, kiểm actor; PUT kiểm biến thể/quyền bán/tự mua/kho như cũ. Đọc dòng Redis: PUT cùng số lượng trên dòng hiệu lực → không làm gì; DELETE dòng không hiệu lực/không có → không làm gì.

Ngược lại: `nextval`; guard: nếu seq ≤ max(`_hw`, MAX(consumed_seq) của user) → 503 `CART_SEQUENCE_BEHIND`, log, không `setval`. Ghi Redis qua Lua (bước cuối trước commit): chỉ nhận khi `seq > _hw`, đặt `_hw`, HSET/HDEL, gia hạn TTL. Lệnh bị từ chối không tạo key/không gia hạn TTL.

Lỗi sau khi đã gửi lệnh Redis = kết quả chưa xác định (contract): giỏ có thể đã đổi hoặc chưa; retry PUT tuyệt đối hội tụ; checkout luôn kiểm lại.

## Checkout

Khóa users → tra receipt → khóa product → đọc Redis + fence → kiểm như cũ → tạo đơn/trừ kho/upsert fence/receipt → commit. Hai checkout khác khóa chọn cùng dòng bị khóa users xếp tuần tự; lần sau thấy fence → `CART_ITEM_NOT_FOUND`. Sau commit dọn Redis best-effort: Lua HDEL field có seq ≤ consumed, không hạ `_hw`, không gia hạn TTL. Redis lỗi ở lần mua mới → 503 `CART_STORE_UNAVAILABLE`, rollback.

## Đọc (GET /cart, preview)

Không có snapshot chung PostgreSQL–Redis. Đọc có phiên bản: HGETALL (nhớ `hw1`) → transaction PostgreSQL (câu đầu đọc fence, sau đó actor/catalog cùng snapshot) → đọc lại `_hw`; khác thì làm lại tối đa 3 lần, quá thì 409 `CART_READ_CONFLICT`. Variant không còn → `unavailableItems`. Redis lỗi → 503.

## Redis client và hạ tầng

ioredis: `enableOfflineQueue:false`, `maxRetriesPerRequest:0`, `autoResendUnfulfilledCommands:false`, không `reconnectOnError`; retry ứng dụng luôn lấy `nextval` mới. Timeout lệnh nhỏ hơn lock/transaction timeout PostgreSQL.

Giả định vận hành: không có lệnh cũ được thực thi sau cửa sổ TTL 7 ngày. Lệnh đã gửi mà timeout có kết quả chưa xác định. Compose: Redis có healthcheck, `appendonly yes`, `appendfsync everysec` (có thể mất ≤ ~1 giây sửa giỏ; fence vẫn chặn mua lặp), `maxmemory-policy noeviction`.

Cờ: `USE_REDIS_CART=false` mặc định; `true` kiểm `REDIS_URL`, TTL và ping khi khởi động. Mọi instance cùng giá trị cờ.

## Quản trị

- Phục hồi sequence (dừng backend): `setval` = `GREATEST(giá trị hiện tại, MAX fence, MAX _hw qua SCAN) + 1`, kiểm tràn bigint → lỗi rõ. Chạy sau mọi lần PostgreSQL crash/restore trước khi bật backend.
- Import `cart_items` → Redis (cửa sổ bảo trì, dừng backend): dry-run; theo user dưới khóa users; chỉ khởi tạo khi key chưa tồn tại; giữ dòng hết hàng/ngừng bán; bỏ qua và báo: qty ngoài 1..`CART_MAX_QUANTITY`, variant không còn, `fence.updated_at >= cart_items.updated_at`; `addedSeq` theo `cart_items.id`. Không ghi PostgreSQL.
- Tắt cờ là chuyển chế độ cần thao tác dữ liệu, không phải rollback bằng biến môi trường; không đồng bộ ngược.

## Test bắt buộc

| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| R1 | PUT 101 trễ, DELETE 102, cleanup, PUT 101 đến | Từ chối, dòng không hiện lại |
| R2 | PUT 101 trễ, checkout tiêu thụ seq 100, PUT 101 đến | Từ chối nếu đã có lệnh mới hơn; nếu 101 là lệnh cuối thì là R5 |
| R3 | PUT 101 trễ, PUT 103 thêm lại cùng SKU, 101 đến | Từ chối, qty theo 103 |
| R4 | Hai checkout khác khóa cùng dòng, cleanup lỗi | 1 đơn, trừ kho 1 lần, lần sau `CART_ITEM_NOT_FOUND` |
| R5 | PUT ghi Redis rồi transaction timeout | API lỗi, GET xác định, PUT lại hội tụ |
| R6 | GET đọc Redis, checkout commit, GET đọc fence | Không hiện dòng đã mua |
| R7 | `_hw` đổi giữa hai lần đọc | Đọc lại, không trộn trạng thái |
| R8a | Redis trống, fence 1000, sequence 900, hai user ghi đồng thời | Cả hai 503; Redis, fence không đổi; sequence tăng theo số lần nextval; không setval |
| R8b | Lệnh quản trị trong bảo trì | Sequence > mọi fence và `_hw`; ghi tiếp được |
| R9 | Bigint quanh 2^53 | Lua/JS so sánh đúng; giá trị tối đa test riêng trên DB dùng một lần |
| R10 | Commit xong, cleanup lỗi, replay cùng khóa/body | Receipt, không tạo đơn/trừ kho lần hai; khác body bị từ chối |
| R11 | Replay sau hết TTL hoặc Redis tắt | Receipt |
| R12 | Redis tắt, checkout mới | 503, không tạo đơn/trừ kho |
| R13 | Import chạy 2 lần, có dòng đã mua sau lần sửa cuối | Không ghi đè, không hồi sinh, giữ thứ tự |
| R14 | Hủy đơn lặp/tranh chấp ở chế độ Redis | Hoàn kho đúng 1 lần |
| R15 | Lệnh đã gửi, Redis restart trước phản hồi | Lỗi, không gửi lại, GET xác định |
| R16 | Import: updated_at bằng nhau, qty ngoài khoảng, variant mất | Bỏ qua và báo; dòng hết hàng vẫn import |
| R17 | Redis giữ seq S, sequence đặt < S (mô phỏng crash) | Ghi tiếp 503; sau lệnh quản trị ghi được; lệnh quản trị báo lỗi khi tràn bigint |

Kèm: toàn bộ test cũ với `USE_REDIS_CART=false` (BE unit, cart/checkout/cancellation e2e).

## Trạng thái — implementation local (Claude, 07/11), CHƯA commit/push, chờ Codex review

Base HEAD `07c3841`, working tree chưa commit. File: `BE/src/redis/{redis.module,redis.service}.ts`; `BE/src/cart/{cart-line-store,cart-redis-protocol,redis-cart-admin,redis-cart-admin.cli}.ts` + 3 spec; sửa `cart.service.ts`, `cart.module.ts`, `checkout-read.service.ts`, `checkout-create.service.ts`, `checkout.module.ts`; `prisma/schema.prisma` + migration `20261107120000_redis_cart_fence`; `BE/package.json` (ioredis ^5.11.1, script `cart:redis-admin`), `pnpm-lock.yaml`, `.env.example`, `docker-compose.yml`; `BE/test/cart-redis.e2e-spec.ts`; `docs/architecture/redis-cart.md`.

Kết quả (máy local, PostgreSQL `bckl_machine_pg17` 127.0.0.1:5549, DB QA mới dùng một lần, role app DML-only; Redis QA `bckl_qa_redis_nosql24` 127.0.0.1:6380):

- BE typecheck, lint (chỉ 2 cảnh báo cũ ở search-image-url-policy), build PASS. BE unit 2170/2170 (2150 cũ + 20 mới).
- Redis e2e `cart-redis.e2e-spec.ts` 15/15, hai lượt: `machine-local/final-day-20261030/nosql24-redis-qa-1794028210972`, `…236136`. Lượt đầu `…175874` 13/15 do test giả định sai mã (replay 200, seller 403) — đã sửa test, giữ lịch sử.
- Chế độ PostgreSQL (cờ không đặt) `…236079`: cart 31, checkout-create 42, checkout-read 41, cart-order-inventory-schema 9, order-cancellation 54 PASS. `checkout-receipt-migration` KHÔNG chạy được: suite cần `CREATE SCHEMA`, role app không có quyền CREATE (đã kiểm `has_database_privilege=false`); không liên quan thay đổi, chưa có kết quả.
- CLI QA `machine-local/final-day-20261030/nosql24-cli-qa-1794028304932/report.json` 15/15: role app có USAGE, không có UPDATE trên `cart_line_seq`; sequence CACHE 1 NO CYCLE; import dry-run/apply/re-import (R13, R16); bump-sequence: role app bị từ chối, dry-run không đổi, đặt trên max(_hw, fence, hiện tại), không hạ, báo lỗi ở bigint max (R8b, R17).
- Phủ R1–R17: R1 R2 R3 R4 R5 R6 R7 R8a R9 R10 R11 R12 R14 R15 R17 (e2e), R8b R13 R16 R17 (CLI), R9 R7 R8a (unit). R9 giá trị tối đa test bằng Lua trực tiếp, không dùng sequence.

- Hồi quy rộng chế độ PostgreSQL `…1794028362802`: 15 suite order/address/auth/notification/dashboard/account 279/279 PASS, source-stable.

Giới hạn còn lại: chưa chạy toàn bộ 88 file e2e; chưa chạy FE/Chrome với cờ bật; chưa chạy `docker compose --profile app` với Redis; ngắt kết nối Redis trong R11/R12 dùng `client.disconnect()` của một instance, không dừng container; R15 dùng `CLIENT PAUSE WRITE` + `CLIENT KILL`, không restart container. `BE/dist` trong checkout đã build lại từ nhánh này; DB Demo chưa có migration 43 (cờ false thì không truy vấn bảng mới).

## Sau review Codex (REQUEST_CHANGES 07/11) — Claude sửa, chờ Codex review lại

Báo cáo Codex: `C:/Vo Minh Hoang/BCKL_2026/outputs/NOSQL24_REVIEW_CODEX_2026-11-07.md`. Bằng chứng lỗi trước sửa: `machine-local/final-day-20261030/codex-redis-review-20261107/no-op-race.json` (không chạy lại script của Codex vì nó ghi đè file này và dùng thứ tự tham số Lua cũ).

- F1 (P1) sửa: Lua write nhận `op` = `set|del|hw`. Mọi PUT/DELETE thành công ở Redis mode cấp seq và nâng `_hw`; PUT cùng số lượng chỉ `hw` (giữ seq/addedSeq dòng); DELETE luôn `del` (dòng vắng/đã tiêu thụ vẫn nâng `_hw`). PostgreSQL mode không đổi. E2E mới "F1" qua HTTP/PG/Redis: lệnh cũ sau PUT cùng số lượng và sau DELETE dòng vắng đều bị từ chối.
- F2 (P2) sửa: R15 khởi chạy request bằng `.then()`, barrier = spy xác nhận `cartWrite` đã gửi + `CLIENT LIST` thấy `cmd=evalsha` bị giữ (flag b) dưới `CLIENT PAUSE WRITE`, rồi mới `CLIENT KILL`; kiểm `_hw` không đổi sau reconnect. Thêm R15b: `docker restart -t 0` container Redis QA khi lệnh đang bị giữ; AOF giữ dữ liệu trước đó, lệnh không chạy và không gửi lại, ghi tiếp được. Helper báo lỗi ngay nếu response về trước barrier (lượt `…548437`/`…612967`/`…674237` treo do test đặt qty 7 > tồn 5 — lỗi test, đã sửa).
- F3 (P2) sửa: `redisCartConfig` từ chối `REDIS_COMMAND_TIMEOUT_MS >= CHECKOUT_LOCK_TIMEOUT_MS` (đọc bằng `checkoutConfigInt`, cùng mặc định 1000). Unit `redis.service.spec.ts`.

Kết quả sau sửa:
- BE unit 2174/2174; typecheck, build PASS; lint chỉ 2 cảnh báo cũ.
- Redis e2e 17/17 hai lượt: `nosql24-redis-qa-1794029703329`, `…30135887` (gồm F1, R15 có barrier, R15b restart thật).
- PostgreSQL mode cart/checkout-create/checkout-read/cart-order-inventory-schema/order-cancellation 177/177 `…29755344`.
- `checkout-receipt-migration` 24/24 `…30131524` — chạy với role migrator (`--ddl-runtime`) trên DB dùng một lần vì suite cần CREATE SCHEMA.
- CLI QA 15/15 `nosql24-cli-qa-1794030162395`.
- Chrome thật, cờ bật: `machine-local/acceptance-20261031/redis-checkout-1794029849863` 4/4 kịch bản (desktop/mobile × sáng/tối: đổi giá, đổi tồn, mất phản hồi cùng khóa, hủy hoàn kho), driver bản sao `machine-local/qa-scripts/test-checkout-browser-redis.mjs` (thay đếm cart_items bằng GET /cart, kiểm hash Redis và cart_items = 0). Lượt `…790479` lỗi biến trong driver bản sao; lượt `…825124` 503 `CART_SEQUENCE_BEHIND` do DB PG mới dùng lại user id trong khi Redis db12 còn key cũ — guard đúng; launcher nay FLUSHDB db12 QA trước mỗi lượt.
- Compose `--profile app` cờ bật, project riêng `nosql24_smoke` (cổng 55432/56379/3402/8482, image `nosql24-*:smoke`): `machine-local/nosql24-compose/run-1794030090105/report.json` 18/18 — migration, AOF/noeviction, đăng ký, địa chỉ, giỏ ở Redis (cart_items 0), restart container Redis giữ giỏ, checkout + fence + trừ kho 1 lần, replay, web /cart; `down --volumes` sạch. Lượt `…999198` lỗi SQL seed của script (đã sửa).

Giới hạn còn lại: chưa chạy đủ 88 file e2e; Chrome mới chạy lane checkout (chưa three-role/fe-orange-buyer với cờ bật); container QA `bckl_qa_redis_nosql24` và image `nosql24-*:smoke` vẫn còn trên máy.

## Review Codex lượt 2 (07/11): F1, F3 đạt; P1 helper R15 — Claude sửa

Lỗi: `pendingPut` là async và `return response`, nên `await pendingPut()` đợi HTTP kết thúc; KILL/restart chạy sau HTTP. Lượt trước 503 đến từ command timeout dưới `CLIENT PAUSE`, không phải mất kết nối — kết quả R15/R15b các lượt `…29703329`, `…30135887` KHÔNG chứng minh được ca mất kết nối.

Sửa: helper trả `{ timeline, fault(), response }` (không await HTTP); `fault()` assert HTTP còn mở; ghi timeline `sent → held → fault → clientClosed → writeRejected → httpEnded`; assert đúng thứ tự và lý do reject không phải timeout. Kết quả (Redis QA thật, `--verbose`, dòng `R15-TIMELINE` trong `run.stdout.private.log`):
- `nosql24-redis-qa-1794030552547` (chỉ R15/R15b) 2/2; `…30572815` và `…30590012` cả bộ 17/17.
- R15 (CLIENT KILL): held 22–30 ms → fault ngay sau → client đóng sau ~1,2 ms → reject "max retries per request (0)" → HTTP 503 sau ~1 ms nữa. R15b (docker restart -t 0): client đóng sau ~85–97 ms từ fault, HTTP 503 sau ~4 ms; đều xa command timeout 900 ms. `_hw` không đổi sau reconnect; AOF giữ dữ liệu.

Runbook `docs/architecture/redis-cart.md`: tạo PostgreSQL mới phải dùng Redis sạch/index riêng trước khi bật backend; guard chỉ chặn ghi, không chặn đọc.

## Review Codex lượt 3 (07/11): ĐẠT trong phạm vi NoSQL #24

Codex đóng F1–F3 (gồm lỗi helper R15/R15b), đối chiếu SHA-256 `cart-redis.e2e-spec.ts` 74f6cb77… và timeline ba lượt QA; không chạy lại suite. Chấp nhận điều kiện vận hành "PostgreSQL mới phải đi với Redis sạch/index riêng" cho môi trường QA cô lập; namespace trong code để cho bước triển khai dùng chung hạ tầng. Ngoài lượt: full E2E 88 file, nghiệm thu giao diện ba vai trò với cờ bật. Commit/push/merge chờ owner duyệt; main giữ theo mốc nộp khóa luận.
