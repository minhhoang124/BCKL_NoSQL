# Kiểm chứng C4.0 — DeliveryAttempt foundation

Ngày: 10/10/2026. Nền develop `27e083b`; nhánh `codex/order-delivery-foundation`.
Phạm vi: migration/schema, không có shipping API/job/UI trong PR này.

## Môi trường và an toàn

- Docker `bckl_postgres` healthy; database mới **bckl_order_delivery_20261010_a**.
- 12 migration thực từ repository chạy thành công trên DB mới, không dùng db push/reset.
- Suite upgrade tạo schema `delivery_upgrade_<uuid>`, chạy 11 migration trước đó
  bằng Prisma migrate engine, chèn dữ liệu lịch sử rồi áp migration C4.0 thực tế.
- Không có fallback `public` khi schema fixture thiếu bảng; cleanup kiểm tra tên
  schema và đường dẫn temporary workspace trước xóa. Không sửa DB demo.
- Các command dùng DATABASE_URL hướng vào DB test và JWT tạm từ môi trường;
  checkout không chứa `.env`/`BE/.env` để tránh override sang demo.

## Kết quả thực chạy

| Kiểm tra | Kết quả |
|---|---|
| Prisma format/validate/generate | PASS |
| Fresh migrate deploy 12 migration | PASS |
| Migrate status / Prisma DB-vs-schema diff | Up to date / no difference |
| Backend lint | PASS |
| Full typecheck (source + tests + Prisma config) | PASS |
| Backend build | PASS |
| Backend unit | **377/377, 19 suite** |
| Backend E2E | **352/352, 21 suite**, 82.90s |
| Suite Delivery foundation mới (nằm trong full E2E) | **21/21** |
| git diff --check | PASS |

Sau full E2E: 0 Order, 0 OrderCommand, 0 DeliveryAttempt và 0 schema fixture
delivery_upgrade/order_upgrade còn sót trên DB test riêng.

Số unit giữ nguyên: không lấy 393 test của nhánh C3 #44 làm số của nhánh này.
E2E nền develop 331 + 21 ca mới = 352, không gồm feature chưa merge.
Log ERROR của các ca cố ý gây lỗi và cảnh báo Vite/pg có sẵn không là test fail;
không tuyên bố môi trường hoàn toàn không có warning.

## Các ca mới chứng minh gì?

- Upgrade bảo toàn Order snapshots/status, OrderItem/option JSON, Payment,
  StockMovement/stock, Checkout, history và receipt OrderCommand cũ.
- History cũ ghi attempt=4 vẫn giữ nguyên; Order nhận null/null và không sinh
  DeliveryAttempt bằng cách đoán từ số đó.
- Chuỗi 1..4 hợp lệ, retryCount=3; attempt 5 bị chặn. Vận đơn được lặp.
- Cặp counters nửa null, sai quan hệ hoặc ngoài range bị từ chối.
- Order sở hữu đúng attempt, số attempt không trùng trong cùng Order;
  hai Order được dùng cùng số/vận đơn; Order không tồn tại bị chặn.
- Counter không được nhảy/giảm/reset. Thiếu identity hoặc thiếu counter làm
  commit thất bại; cập nhật Payment thử trong cùng transaction cũng rollback.
- Tracking/number/order/id/createdAt bất biến; delete/reinsert không đổi được
  tracking khi Order còn tồn tại. No-op UPDATE vẫn hợp lệ.
- Hai kết nối độc lập cạnh tranh cùng attempt: một commit, bên đến muộn bị unique
  constraint từ chối; counters không tăng hai lần. Không dùng khóa trong process.
- Schema upgrade riêng dùng đúng trigger trong schema fixture; cleanup hết fixture.

## Chạy lại

Trên checkout này, đặt DATABASE_URL vào **database test riêng**, không copy secret
vào command/file commit. Kiểm tra không có `.env` override và tên DB trước khi chạy:

```powershell
pnpm --dir BE exec prisma validate
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE lint
pnpm --dir BE typecheck
pnpm --dir BE build
pnpm --dir BE test
pnpm --dir BE test:e2e
git diff --check
```

## Chưa chứng minh / bước tiếp theo

- Chưa có HTTP ship/failed/retry/delivered, replay receipt shipping, chống callback
  stale tại runtime, kiểm tra quyền/state/Payment hay confirm-returned.
- Chưa có Buyer complete/job tự complete 3 ngày, luồng Web giao hàng hoặc vận chuyển thật.
- Test PostgreSQL không phải acceptance test G-FULFILMENT; không gọi tính năng đã DONE.
- Migration nâng cấp trên fixture có dữ liệu không thay audit/backup/triển khai DB demo.
- CI phải kiểm tra đúng head PR sau push; local PASS không tự suy CI PASS.

Hiền review dữ liệu/luồng theo [thiết kế C4.0](../architecture/order-delivery-foundation.md)
và SRS/contract. Sau merge các nền cần test toàn luồng tích hợp, không chỉ từng PR.
