# C4.1 — kiểm chứng API giao mô phỏng

Ngày10/10/2026. Base develop f267399 (#45 đã merge), branch
codex/order-delivery-commands. Database riêng bckl_order_delivery_20261010_a,
12 migration đúng checksum; không thao tác DB demo.

## Phạm vi bằng chứng

77 unit mới (request/hash/state-policy/strict receipt/quota).
21 E2E mới qua HTTP Nest thật + PostgreSQL thật + hai app/pool:

- Ship → failed → retry → delivered: typed history/receipt/identity, COD atomic;
  failure không stock/ledger/version/outbox; delivered chưa COMPLETED.
- 4 attempts/3 retries, cùng tracking được phép; lần thứ5 bị chặn.
- Late failed/delivered, tracking mismatch, legacy null identity, replay gốc
  trước kiểm tra attempt mới; khác key/payload/order/command conflict.
- Hai app cùng key, hai Admin failed-vs-delivered, retry cạnh tranh.
- JWT/current role/inactive/anonymous/Buyer/Seller, Store suspended.
- Payment thiếu/sai trạng thái/amount và sandbox prepaid giữ paidAt.
- SQL fault injection tại receipt finalize thật: rollback ship attempt/counter
  hoặc delivered Order/Payment/history/claim, retry cùng key thành công.
- Restart app vẫn replay receipt; lock wait thật trả409+Retry-After.
- Body/query/id/key/JSON/content-type/gzip raw HTTP inflated8KiB; Swagger route.

Không mock HTTP/DB trong E2E cuối. DDL fault chỉ fixture order, trigger/function
xóa trong finally. Cleanup history/command/Payment/item/attempt/Order cùng
transaction rồi các fixture phụ; không xóa dữ liệu không thuộc suite.

## Kết quả hiện tại

- Unit toàn Backend:454/454 (20 suite), PASS.
- E2E riêng delivery:21/21, PASS.
- Full E2E:373/373 (22 suite,85.57s), PASS.
- Full TypeScript/lint/build/Prisma validate/diff-check: PASS. Không đổi schema,
  migration, package/lockfile hoặc contract FastAPI; FE không đổi, không test lại FE.
- SELECT sau cleanup:0 fixture User/0 Order/0 OrderCommand/0 DeliveryAttempt/
  0 fault trigger/0 schema upgrade còn lại trên database kiểm thử.
- Lượt đầu: fixture OrderItem sai trường storeId; sửa theo schema thật.
- Lượt tiếp: test Supertest biến Buffer thành JSON thay gzip thật; chuyển
  sang raw HTTP bytes. 21/21 PASS sau sửa. Không bỏ test để lấy xanh.
- Log ERROR ở hai ca SQL fault là cố ý, không lỗi runtime còn treo.
- Warning Vite tsconfig-paths và pg concurrent-query deprecation của nền còn;
  không có test fail/skip, không gọi toàn project hoàn hảo chỉ vì các suite xanh.

NOT_RUN: Checkout/Seller/detail/hủy head kết hợp vì #42/#43/#44 chưa merge,
shipping UI/browser, real carrier/callback, confirm-returned, complete/job,
notification, Search index integration. Không gọi G-FULFILMENT DONE.
