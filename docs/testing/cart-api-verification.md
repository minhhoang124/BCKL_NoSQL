# Buyer Cart API — kiểm chứng và bàn giao

Ngày 03/10/2026; cập nhật tích hợp 05/10/2026. Branch `codex/buyer-cart-api`, base ban đầu `c0a7d48` (PR #27), đã sync `develop efd86a3` sau khi Address #30 merge. PR #31 đã được người dùng merge tại `6663fab` ngày 05/10: **CURRENT ở Backend**; Backend API không đồng nghĩa hoàn thành giao diện hoặc gate G-CHECKOUT.

## Phạm vi và nguyên tắc

- USER active dùng GET `/cart`, PUT `/cart/items/:variantId` `{quantity:2}`, DELETE cùng path. Dùng JWT Bearer; Swagger tag `buyer-cart`.
- Quantity tuyệt đối 1–99, mặc định cấu hình `CART_MAX_QUANTITY=99`; không chấp nhận numeric string/body thừa. `CART_RATE_LIMIT_PER_MINUTE=60` dùng chung một bucket cho ba route theo User.
- Giỏ không giữ/trừ kho, không cam kết giá; hai Buyer vẫn có thể thêm SKU cuối cùng. Checkout là bước sau kiểm tra và cam kết kho.
- Đọc policy public chung, kiểm tra riêng Variant chọn; che metadata Product đã ẩn và metadata Variant không hợp lệ. Tiền dùng Decimal chính xác, không tính bằng JS number.
- GET không tạo Cart; DELETE thiếu dòng trả 204, không tạo row. PUT trả 200 toàn giỏ; gửi lại cùng quantity không đổi dòng hoặc updatedAt.
- Ghi giỏ Serializable + khóa User trong database; retry tối đa 5 lần/backoff chỉ cho serialization/deadlock. Lỗi khác rollback, không retry bừa. Hết retry trả CART_WRITE_CONFLICT.
- Không thay Product lifecycle/version/outbox, FastAPI hay UI. Theo review dependency, #30 Address đã merge trước rồi đồng bộ develop vào #31: giữ cả hai module/config, schema district nullable và migration mới của #30; không tạo hoặc sửa migration cũ trong đợt tích hợp Cart.

## Ma trận bằng chứng

| Yêu cầu | Bằng chứng |
|---|---|
| Empty/lazy/idempotent/ownership | `BE/test/cart.e2e-spec.ts`: GET rỗng, DELETE thiếu, absolute PUT, giỏ hai User cùng Variant |
| Current price + Decimal + nhóm Store | Giá lớn, hai Store, đổi giá, mixed available/unavailable, lineCount/totalQuantity/subtotal |
| Không giữ kho/movement/outbox | Hai Buyer thêm SKU stock=1; stock/Product/version không đổi, không tạo Checkout/StockMovement/SearchOutbox |
| Privacy + eligibility | HIDDEN/DRAFT/FROZEN, Store/Seller/root/Brand/required attribute/image/shipping invalidation; chỉ bốn trường tối thiểu |
| Variant được chọn | Sibling public không hợp thức hóa Variant inactive/zero-price/missing option links; thứ tự label và null Brand |
| Auth + validation | Thiếu/hết hạn token, sai role/tài khoản inactive, self-purchase, ID overflow/scientific notation, quantity 0/100/string/null, extra body/query |
| Rate limit | GET+PUT+DELETE chung ngưỡng, 429/Retry-After/no-store; User khác không bị dùng chung quota |
| Cạnh tranh thật | Hai Nest application có hai Prisma client độc lập: first Cart/line, hai Variant, PUT cạnh tranh DELETE |
| Rollback | Inject lỗi sau ghi trước đọc response: first create và update quantity rollback trên PostgreSQL thật |
| Retry/backoff/config | `BE/src/cart/cart.spec.ts`: P2034 retry, lỗi không retry, hết 5 lần, giới hạn config, rate-window expiry |
| Swagger | Schema response, các path/HTTP 200/204/409 có trong document thật |
| Address + Cart cùng ứng dụng | Ca HTTP mới trong cart.e2e-spec.ts: tạo hai Address và PUT Cart qua hai app/Prisma client, đọc lại cả hai API, một default/district null, ownership riêng và không đổi stock/version/outbox/Checkout |

Fixture public được tạo trong database kiểm thử để khóa policy Cart, không phải bằng chứng UI hoặc quy trình moderation chạy qua Cart. Ca rollback cố tình inject lỗi service nội bộ; không mock HTTP hay transaction database.

## Chạy lại

Dùng database riêng (local kiểm chứng: `bckl_cart_test_20261003`) và `DATABASE_URL` trỏ database đó. Secret Auth cấu hình qua môi trường, không commit `.env`. Database demo không bị thay đổi. Bộ E2E tự tắt worker polling và chỉ xóa fixture của mình.

```powershell
pnpm install --frozen-lockfile
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE exec prisma validate
pnpm --dir BE exec prisma migrate status
pnpm --dir BE lint
pnpm --dir BE test
pnpm --dir BE build
pnpm --dir BE exec vitest run --config ./vitest.config.e2e.ts test/cart.e2e-spec.ts
pnpm --dir BE test:e2e
git diff --check
```

Kết quả local ở bản bàn giao ban đầu ngày 03/10 (không dùng thay kết quả bản tích hợp mới):

| Kiểm tra | Kết quả |
|---|---|
| Fresh `pnpm install --frozen-lockfile` | PASS, Prisma Client tự generate, lockfile không đổi |
| Prisma migrate deploy/validate/status | PASS, 8 migration đã merge, database riêng up-to-date |
| BE lint/build | PASS |
| BE unit | 78/78, 9 file; gồm 35 test mới của Cart |
| BE E2E toàn bộ | 135/135, 13 file; gồm 30 test Cart |
| Cart E2E riêng | Lượt đầu 29/29; bổ sung 1 mixed-cart case và chạy lại toàn bộ đạt 30/30 |
| Whitespace diff | PASS |

CI GitHub là kiểm tra riêng sau push, không suy ra xanh từ kết quả local. Các log lỗi trong ca fault injection là kết quả chủ đích kiểm tra rollback; không phải test thất bại. Các cảnh báo `pg client.query` và `vite-tsconfig-paths` là cảnh báo dependency hiện có; không nâng dependency trong PR Cart.

## Bản tích hợp Address + Cart ngày 05/10/2026

Đã đồng bộ `develop efd86a3` sau #30; giải quyết ba conflict ở `.env.example`, `BE/src/app.module.ts`, đầu contract. Giữ AddressModule/CartModule và cả ba biến ADDRESS_MAX_PER_USER/CART_MAX_QUANTITY/CART_RATE_LIMIT_PER_MINUTE. Schema và migration trong bản tích hợp giống develop đã merge, không tạo migration mới hoặc sửa lịch sử.

- Local: frozen install, Backend lint/build và Prisma validate PASS; unit 122/122 trong 11 file (bao gồm Address và Cart).
- Bổ sung một ca HTTP chạy hai app/Prisma client: tạo Address và ghi Cart cùng Buyer, đọc lại cả hai API, kiểm ownership/default/district nullable và không đụng stock/version/outbox/Checkout. Đây là kiểm tra tích hợp trong cùng suite, không phải đo tải production hay chứng minh nhiều process độc lập.
- Local E2E/migrate deploy/status **NOT_RUN** trong lượt này vì Docker engine chưa chạy. CI có PostgreSQL 17 riêng, chạy migrations và toàn Backend E2E; kết quả phải xem đúng head mới, không lấy 135/135 cũ làm bằng chứng bản tích hợp.
- Kiểm tra bổ sung `tsc --noEmit --incremental false` trên toàn BE **FAIL** do lỗi nền: PrismaConfig.earlyAccess, import `supertest/types`, assertion ReconciliationStats.locked và thiếu declaration seed-demo-user.mjs. Đã tái hiện cùng nhóm lỗi trên worktree Address trước tích hợp; build Backend theo cấu hình hiện hành vẫn PASS. Không sửa ngoài phạm vi hoặc tuyên bố toàn repo type-check sạch.

[CI head 979ef58](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/actions/runs/37256392693) đã SUCCESS cả hai checks: 122 unit, 158 Backend E2E (31 Cart/22 Address), 129 Python. Hiền APPROVE đúng head, người dùng merge #31 tại `6663fab`; agent không tự merge. Đây là bằng chứng API, không phải Checkout/UI đã chạy.

## Giới hạn / bước tiếp

- In-memory rate limiter không đồng bộ quota giữa replica hoặc restart; shared limiter cần khi triển khai nhiều instance. Map giới hạn 10.000 User active-window để chặn tăng bộ nhớ vô hạn, không evict bucket còn sống để reset quota.
- GET/PUT phản ánh snapshot trong transaction, không hứa Product/giá/kho bất biến sau response; UI phải tải lại và Checkout revalidate.
- Ảnh dùng URL công khai đã lưu và policy hiện có; không kiểm tra filesystem/đổi storage trong Cart. Private-media là task riêng.
- Cart GET toàn giỏ theo contract P0; giới hạn tổng số dòng/pagination/performance tải lớn cần chốt trước vận hành production, không tự thêm rule cắt giỏ.
- Chưa Frontend/browser evidence, chưa đặt COD/Order/giữ kho. Address/Cart đã merge; sau contract Checkout #29 được re-review, triển khai preview/create/lookup, snapshot và transaction chống bán vượt kho.
