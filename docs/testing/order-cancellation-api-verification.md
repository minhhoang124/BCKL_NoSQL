# C3 — Bằng chứng API hủy COD/hoàn kho ngày 10/10/2026

Nhánh `codex/order-cancellation`, nền develop `27e083b`. Chỉ Backend C3,
không xác nhận toàn bộ G-FULFILMENT. Contract:
[`order-cancellation-contract.md`](../api/order-cancellation-contract.md).

## Môi trường và cách tái lập

Windows/Node/pnpm hiện có, PostgreSQL Docker đang healthy. DB test riêng
`bckl_order_command_20261009_a`, 11 migration up to date. Không chép `.env`
vào worktree; đọc connection local rồi đổi **tên DB test**, kiểm host/tên và
không có `BE/.env` override trước test. Không chạy hoặc sửa DB demo.
CI có database container tạm riêng; guard chỉ cho local bckl_* hoặc DB dịch vụ
GitHub Actions khi GITHUB_ACTIONS=true. Cron Search/repair tắt bởi setup test.

Trong checkout đã cấu hình DB test, chạy từ root:

```powershell
pnpm --dir BE exec prisma migrate status
pnpm --dir BE lint
pnpm --dir BE typecheck
pnpm --dir BE test
pnpm --dir BE build
pnpm --dir BE exec prisma validate
pnpm --dir BE test:e2e
git diff --check
```

Hai Nest HTTP ứng dụng và hai Prisma pool độc lập, không mock cancellation,
Checkout service, outbox producer hoặc PostgreSQL. Server thứ ba mới được tạo
để replay receipt đã commit, không cần giữ cache của instance gốc.

## Kiểm thử mới

16 unit kiểm receipt: shape/extra fields, identity/reason/state/Decimal string,
ISO time, Buyer/Seller allowed source, không trả JSON receipt thô.

49 E2E C3 tại `BE/test/order-cancellation.e2e-spec.ts`:

| Nhóm | Bằng chứng chạy |
|---|---|
| Checkout thật → cancel | Tạo hai Variant cùng Product qua POST /checkouts, trừ hết tồn rồi hủy. Khôi phục từng Item, giữ APPROVED, một version/outbox/Product; Payment/audit/history/receipt cùng commit |
| Replay | Hai HTTP instance và instance mới, result gốc không đổi; key mới không giả replay; key cũ khác reason/Order bị từ chối |
| Ownership/privacy | Buyer khác, Seller Store khác, wrong role, inactive actor, thiếu auth/key, invalid ID, no-store và lỗi an toàn |
| State/rule | Buyer chỉ pending; Seller pending/confirmed; PACKING/shipping/delivery_failed không hoàn kho; Store SUSPENDED/CLOSED đúng actor policy |
| Snapshot | Sau đổi tên/giá catalog, giữ OrderItem và Checkout receipt; không khôi phục dòng Cart đã mua |
| Legacy/overflow/payment | Thiếu/wrong decrement, đã có restore, overflow stock/version, Payment thiếu/PAID/sandbox: không mutation/receipt thừa |
| Request hardening | Strict fields/reason, trim/bounds, query, malformed JSON, 8 KiB; quota 20 request kể cả invalid, 21 trả 429/Retry-After |
| Corrupt receipt | Bản ghi JSON hỏng đã lưu trong DB bị từ chối 500 trước mutation, không lộ secret |
| Concurrency | Cùng key, Buyer/Seller khác key; dùng khóa SQL giữ User và pg_stat_activity xác nhận hai request đang thực sự chờ, không chỉ Promise.all |
| Checkout vs restock | Giữ Product lock, xác nhận cả Checkout/cancel đang chờ DB lock; thả khóa, retry bounded; cuối cùng một đơn mới, tồn 1/2, version/outbox không lost update |
| Rollback | Trigger SQL cố ý lỗi ở movement thứ hai, outbox, Payment, history và finalize receipt. Các bước trước đã chạy bị rollback, DB bằng snapshot trước yêu cầu; sau tháo trigger retry được |
| Timeout/canonical state | Order row lock timeout có Retry-After, cùng key sau thả khóa thành công; writer cập nhật CONFIRMED khiến Buyer cancel đọc lại nguồn mới và từ chối |

Trigger lỗi chỉ lọc ID fixture trên DB riêng, tháo trong finally. Cleanup dùng
prefix user/store của suite, không tìm theo OrderNumber (Checkout tự sinh mã).

## Kết quả

- Lint, full TypeScript (gồm test), build, Prisma validate/status: PASS.
- Full unit: **393/393, 20 suite PASS** (16 mới; nền 377).
- Full E2E lần đầu: 379 PASS, 1 FAIL vì test Swagger list cũ vẫn yêu cầu cancel
  route không tồn tại. Đã thay bằng kiểm route Buyer/Seller cancel hiện có;
  vẫn giữ assertion detail chưa có trong branch độc lập. Không xóa test quyền.
- Full E2E sau sửa: **380/380, 21 suite PASS, 92.58s** (49 C3 mới; nền 331).
- Lint/full TypeScript/diff-check chạy lại sau sửa assertion Swagger đều PASS.
- Không sửa schema/migration/checksum, không reset hoặc backfill legacy/demo.

Warning pg/Vite nền còn tồn tại; ERROR trong các ca fault injection là cố ý,
không có nghĩa luồng bình thường lỗi. Không tự nhận warning đã được giải quyết.

## Chưa chạy / ngoài phạm vi

- HTTP Seller confirm #43 cạnh tranh với cancel và GET detail #42 đọc audit
  cancel: cần tích hợp các nhánh sau merge. Writer SQL kiểm canonical re-read
  không phải bằng chứng API confirm thật.
- Worker → FastAPI → Elasticsearch/FAISS → hydrate sau hoàn kho (CHK-S04),
  cần Đạt phối hợp; outbox test không chứng minh index đã nhận.
- Kill OS process đúng thời điểm commit, distributed quota, browser UI,
  sandbox refund, DeliveryAttempt/confirm-returned/complete/notification.
- Store policy/quota và timeline receipt một command đã được Hiền chấp thuận
  ở C2 #43; phạm vi COD/ledger fail-closed của C3 vẫn cần review riêng.
