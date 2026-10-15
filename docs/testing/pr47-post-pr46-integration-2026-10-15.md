# PR #47 — tích hợp sau merge #46, 15/10/2026

## Nền và phạm vi

- Nền chính thức `develop 11a0da7` sau merge #46; head #47 trước sync `b64bad1`.
- Giải quyết ba conflict: `configure-app.ts`, `order.module.ts`, kiến trúc. Giữ list/detail/Seller preparation/cancellation/delivery/returned controllers, providers và SearchModule.
- Thứ tự HTTP: guard Order GET → Seller command → cancellation → delivery → returned → Checkout → parser mặc định. CORS/cookie/ValidationPipe giữ nguyên.
- Không sửa returned service/request/receipt/policy, schema/migration/FastAPI/FE/lockfile. Không đưa #48/#54/#55 chưa merge vào nhánh này. Không thao tác DB demo.

## Bằng chứng HTTP mới

Ca `real Checkout/Seller/delivery-failed → returned restores once, preserves snapshots and reads audit through detail` dùng hai ứng dụng Nest và PostgreSQL thật, không mock HTTP nghiệp vụ:

1. Catalog, ảnh URL và địa chỉ là fixture có nhãn, Product APPROVED, Variant giá 10.000 đồng và kho 5.
2. PUT Cart quantity=2, POST Checkout COD tạo Order/ledger thật, kho còn 3.
3. Seller confirm → start-packing → ready-to-ship bằng API.
4. Admin ship → delivery-failed bằng API #46. Kho/ledger/version/outbox/Payment không thay đổi ở bước giao thất bại.
5. Seller confirm-returned với chứng từ và restockable=true: CANCELLED/COD CANCELLED, kho về 5, ledger -2/+2 của OrderItem, một version và một UPSERT mới.
6. Buyer và Seller GET detail thấy CANCELLED, snapshot hàng/địa chỉ gốc dù địa chỉ hiện hành đã đổi, audit chứng từ/lần giao/tracking chính xác; Buyer không nhận actorId nội bộ. Không trả hash/key/commands.
7. Replay cùng key qua instance khác trả receipt gốc, toàn DB snapshot không đổi. Key mới sau CANCELLED và retry-delivery bị 409, không hoàn kho thêm. Replay Checkout trả 200 và checkoutId gốc, không tạo đơn/trừ kho lần hai.

20 ca returned cũ tiếp tục kiểm nhiều Variant/một Product, exact full UPSERT/DELETE, restore cũ, overflow, quyền sau receipt thật và SQL fault rollback. Ca mới bổ sung kiểm tích hợp #46, không thay các assertions full payload cũ.

## Kết quả thực tế

Database mới `bckl_pr47_post46_20261015`, PostgreSQL QA loopback port 5549, tách khỏi demo port 5432.

| Kiểm tra | Kết quả |
|---|---|
| Fresh migrate deploy | PASS, 12 migration |
| Prisma validate | PASS |
| Backend typecheck/lint/build | PASS |
| Backend unit | **567/567 PASS**, 24 suites, maxWorkers=1 |
| Backend full HTTP/PostgreSQL E2E | **532/532 PASS**, 26 suites, 138.14 giây |
| Returned suite trong full E2E | **21/21 PASS** |
| Rerun returned riêng sau full | **21/21 PASS**, 3.58 giây; typecheck chạy lại PASS |
| Frontend test/lint/build | **122/122 PASS**, 15 files; không thay FE |
| Diff-check | PASS |

SQL sau lượt cuối: Orders=0, StockMovement=0, SearchOutbox=0; Product fixture returned=0 và User có marker returned=0. Cleanup dùng ID fixture và thứ tự FK, không xóa rộng dữ liệu khác hoặc seed của full suite.

Lượt đầu ca mới có hai expected sai contract: Search decimal-string là `10000` chứ không bắt buộc `10000.00`; Checkout replay trả HTTP 200 chứ không phải 201. Chỉ sửa expected test; không nới validator hoặc đổi production. Full E2E ở trên chạy sau hai sửa này. Lệnh format đầu gọi ở root thiếu executable; chạy lại từ BE thành công.

Warning pg client.query/Vite config nền vẫn còn. ERROR do fault injection/response hỏng trong negative tests có chủ đích, không bị bỏ qua để nâng PASS.

## Giới hạn và review

- Chưa browser/Order UI, chưa đối soát tiền thật, refund P1 hay G-FULFILMENT DONE.
- Không serving ảnh hoặc gọi FastAPI/Elasticsearch/FAISS trong ca mới; chỉ chứng minh stock → version → outbox ở PostgreSQL. Không báo chất lượng tìm kiếm.
- CI và approval trên head cũ không thay kiểm tra head mới. Cần CI và Hiền re-review phần tích hợp; Đạt review assertions stock/outbox. Không tự merge.
