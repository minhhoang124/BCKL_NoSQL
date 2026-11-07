# Giỏ hàng Redis (NoSQL #24)

Thiết kế đầy đủ và lịch sử review: `docs/agent-context/handoffs/2026-11-07-NOSQL24-redis-cart-design-v3.md`.

## Tóm tắt

- `USE_REDIS_CART=false` (mặc định): giỏ ở PostgreSQL (`carts`, `cart_items`) như trước.
- `USE_REDIS_CART=true`: giỏ chính ở Redis, key `cart:{userId}` (Hash). PostgreSQL vẫn là nguồn của đơn, thanh toán, kho, receipt và **fence** `cart_consumed_lines`.
- API không đổi: `GET /cart`, `PUT /cart/items/:variantId` (số lượng tuyệt đối), `DELETE /cart/items/:variantId`, preview và tạo checkout.

| Thành phần | Vai trò |
|---|---|
| `cart_line_seq` (PostgreSQL, CACHE 1, NO CYCLE) | Cấp seq cho mỗi lần ghi giỏ, gọi sau khi đã khóa `users ... FOR UPDATE` |
| `cart:{userId}` field `variantId` | `qty\|seq\|addedSeq` |
| `cart:{userId}` field `_hw` | Seq lớn nhất từng được nhận; Lua từ chối mọi lệnh có seq ≤ `_hw` |
| `cart_consumed_lines` | Mốc seq đã mua theo (buyer, variant), ghi cùng transaction tạo đơn |

Dòng hiệu lực = qty > 0 và seq > `consumedSeq`. Dọn Redis sau checkout chỉ là best-effort.

Mọi PUT/DELETE thành công ở chế độ Redis đều cấp seq mới và nâng `_hw`, kể cả khi dữ liệu không đổi (PUT cùng số lượng chỉ nâng `_hw`, giữ seq/addedSeq của dòng; DELETE dòng vắng vẫn nâng `_hw`). Nhờ vậy một lệnh cũ đang bay không thể ghi đè ý định mới hơn đã trả thành công.

## Mã lỗi mới

| Mã | HTTP | Ý nghĩa |
|---|---|---|
| `CART_STORE_UNAVAILABLE` | 503 | Redis lỗi/timeout. Với PUT/DELETE: **kết quả chưa xác định** (giỏ có thể đã đổi). FE tải lại giỏ; PUT tuyệt đối gửi lại sẽ hội tụ. Checkout mới không tạo đơn. |
| `CART_SEQUENCE_BEHIND` | 503 | Sequence lùi dưới `_hw`/fence (PostgreSQL crash/restore). Cần chạy `bump-sequence`. |
| `CART_READ_CONFLICT` | 409 | Giỏ đổi liên tục trong 3 lần đọc có phiên bản. Tải lại. |

Replay checkout cùng khóa/body vẫn trả receipt khi Redis tắt hoặc giỏ đã hết TTL.

## Vận hành

Chạy Redis: `docker compose up -d redis` (AOF `everysec`, `noeviction`, healthcheck, chỉ bind 127.0.0.1). AOF `everysec` có thể mất tối đa khoảng 1 giây sửa giỏ khi Redis crash; fence vẫn chặn mua lặp. Không FLUSH Redis khi backend đang chạy.

Cấu hình: `REDIS_URL`, `REDIS_CART_TTL_SECONDS` (mặc định 604800), `REDIS_COMMAND_TIMEOUT_MS` (mặc định 500; backend từ chối khởi động nếu không nhỏ hơn `CHECKOUT_LOCK_TIMEOUT_MS`, mặc định 1000). Khi `true`, backend kiểm cấu hình và ping Redis lúc khởi động; cấu hình sai thì không khởi động. Mọi instance phải cùng giá trị cờ.

Client ioredis không xếp hàng và không gửi lại lệnh (`enableOfflineQueue:false`, `maxRetriesPerRequest:0`, `autoResendUnfulfilledCommands:false`). Giả định vận hành: không có lệnh cũ được thực thi sau cửa sổ TTL.

### Lệnh quản trị (dừng backend trước)

```bash
pnpm --dir BE build
# Dry-run (mặc định), rồi thêm --apply
DATABASE_URL=... REDIS_URL=... pnpm --dir BE cart:redis-admin import
DATABASE_URL=<role migrator/owner> REDIS_URL=... pnpm --dir BE cart:redis-admin bump-sequence --apply
```

- `import`: chuyển `cart_items` → Redis một chiều. Chỉ tạo key chưa tồn tại (chạy lại an toàn). Giữ dòng hết hàng/ngừng bán. Bỏ qua và báo: số lượng ngoài `1..CART_MAX_QUANTITY`, biến thể không còn, dòng có fence mới bằng hoặc hơn `cart_items.updatedAt`. Thứ tự theo `cart_items.id`. Không ghi PostgreSQL ngoài cấp seq.
- `bump-sequence`: đặt sequence lên `GREATEST(giá trị hiện tại, MAX fence, MAX _hw) + 1`; không bao giờ hạ; báo lỗi rõ khi chạm giới hạn bigint. Bắt buộc chạy sau mỗi lần PostgreSQL crash/restore, trước khi bật backend.

### Chuyển chế độ

- `false → true`: dừng backend, `import` dry-run, `import --apply`, bật cờ, khởi động.
- `true → false`: **không phải rollback bằng biến môi trường**. Các dòng chỉ có trong Redis sẽ không hiện ở PostgreSQL; không có đồng bộ ngược. Nếu sau đó bật lại `true`, chạy `import` (key còn tồn tại được giữ nguyên).
- Restore PostgreSQL về bản cũ: fence và đơn cùng lùi; dòng đã mua trong các đơn bị mất có thể hiện lại trong giỏ (khớp PostgreSQL). Chạy `bump-sequence` trước khi bật backend.
- **Tạo database PostgreSQL mới (hoặc restore sang database khác): BẮT BUỘC dùng Redis sạch hoặc Redis database index riêng trước khi bật backend.** User id được cấp lại từ đầu nên có thể trùng key `cart:{id}` của người dùng cũ. Guard sequence chỉ chặn **ghi** (`CART_SEQUENCE_BEHIND`); nó không chặn **đọc**: nếu giữ Redis cũ, `GET /cart`, preview và checkout có thể đọc giỏ cũ của một người dùng khác trùng id. Cách làm: dừng backend, xóa các key `cart:*` (hoặc trỏ `REDIS_URL` sang index trống), rồi mới khởi động.

## Ngoài phạm vi

Giỏ khách chưa đăng nhập, Redis Cluster/Sentinel, đồng bộ ngược Redis → PostgreSQL.
