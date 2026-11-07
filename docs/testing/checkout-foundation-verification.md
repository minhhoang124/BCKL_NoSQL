# Nền Checkout v1 — kiểm chứng và hướng dẫn đọc

Ngày 08/10/2026. Owner Hoàng; Hiền review DB/nghiệp vụ, Đạt theo dõi điểm nối Search. Baseline `develop c6e0ba1`, sau khi #29 đã được cả hai review và người dùng merge. **Bằng chứng lịch sử của commit nền `f1666b2` trong PR #36, lúc đó chưa có Checkout API.** PR #36 hiện được tiếp nối bằng [preview/lookup chỉ đọc](checkout-read-api-verification.md), vẫn IN_PROGRESS/chưa merge và chưa có luồng tạo đơn. Các câu "chưa có" bên dưới nói về commit nền, không thay trạng thái phần tiếp nối.

## 1. Phạm vi đã thêm

- Migration mới `20261007100000_checkout_hash_receipt`: thêm `hashVersion`, `receiptVersion`, `receiptJson` nullable. Không default/backfill v1 cho row cũ, không sửa migration đã merge.
- Check constraint: version dương khi có, receipt version/JSON phải cùng hiện diện, hash v1 là 64 ký tự hex thường, v1 COMPLETED cần completedAt + receiptVersion=1 + JSON object.
- Trigger chặn UPDATE làm đổi identity/hash/receipt/status/timestamps của v1 đã COMPLETED; UPDATE thật sự no-op vẫn được. Không tạo API xóa hoặc TTL receipt.
- Chuẩn hóa request strict theo contract #29, tối đa 50 Variant riêng biệt, quantity 1–99, COD duy nhất; ID PostgreSQL Int dương; key ASCII 16–128, không trim.
- Decimal VND nguyên đồng, bound `999999999999.00`, kiểm overflow từng dòng/tổng trước write; không dùng float tính tiền.
- SHA-256 v1 bằng UTF-8 JSON key sort cố định, item sort theo variantId, tiền chuẩn `.00`. Không hash key, timestamp hoặc giá/địa chỉ/giỏ hiện hành.
- Receipt strict allowlist; Store sort tăng và không trùng, ID/orderNumber không trùng, total/Payment amount khớp, tổng không tràn. Chỉ receipt gốc, không OrderStatus/PaymentStatus hiện hành.
- Phân loại replay chỉ đọc: sai Buyer 404; hashVersion lạ/null 409 legacy trước so hash; cùng key khác hash 409; PENDING 409; v1 hoàn tất nhưng receipt hỏng 500 an toàn; không tự đặt lại.

**Giới hạn quan trọng:** helper replay chưa phải runtime API; trả null khi không có row không đảm bảo row chưa được request cạnh tranh tạo. Service tương lai phải khóa Buyer và đọc lại bằng transaction client. SQL chưa kiểm mọi field JSON; helper phải được gọi trước lưu/trả receipt ở PR API.

## 2. Luồng đọc code để hiểu

1. Contract `docs/api/cart-order-inventory-api-contract.md`, mục 5.3/5.5 và Q3/Q5/Q6/Q7 của proposal.
2. `BE/prisma/schema.prisma`, model Checkout; migration mới cho lưu trữ và ràng buộc.
3. `BE/src/checkout/checkout-money.ts`: `expectedUnitPrice` là giá Buyer đã nhìn thấy để xác nhận, không phải giá sẽ tin để tính đơn.
4. `checkout-request.ts`: `canonicalRequest` là bản input chuẩn; `requestHash` nhận biết cùng nội dung; `buyerId` từ actor, không client tự chọn.
5. `checkout-receipt.ts`: `receiptJson` là biên nhận tạo đơn ban đầu; `replayed` được thêm khi trả lại, không ghi trong JSON gốc.
6. `checkout-replay.ts`: phân biệt request mới, đang xử lý, replay đúng, xung đột và legacy; không có DB write/stock/outbox ở đây.
7. `checkout-foundation.spec.ts`, `checkout-replay.spec.ts` và `BE/test/checkout-receipt-migration.e2e-spec.ts`: input biên, hash vector độc lập, receipt và DB thực.

## 3. Kiểm thử và cô lập dữ liệu

Database mới riêng `bckl_checkout_foundation_20261008_a` trong container PostgreSQL của đồ án. Xác minh tên chưa tồn tại rồi mới tạo; deploy 10 migration. Không migrate/seed vào `klcn_ecommerce`, không sửa mật khẩu DB hoặc container seminar. Credential đọc từ cấu hình local nhưng chỉ giữ trong môi trường tiến trình; JWT ngẫu nhiên chỉ dùng test, không ghi file/log.

Test migration tạo schema riêng tên ngẫu nhiên trong một transaction, clone **cấu trúc cột/defaults** của bảng Checkout, tạo ba fixture legacy PENDING/COMPLETED/FAILED, chạy chính SQL migration rồi kiểm trước/sau. Không clone dữ liệu thật hoặc full FK/index; tính hợp lệ của full schema được kiểm bằng migrate deploy trên fresh DB và suite schema hiện có. afterAll ROLLBACK xóa schema/fixtures transaction; không phát Search worker hoặc sửa demo.

So timestamp bằng giá trị PostgreSQL lưu trước/sau, không dựa vào cách pg đổi timestamp-without-time-zone thành Date theo múi giờ máy. Ca UPDATE timestamp dùng giá trị thực sự khác: `now()` cố định trong transaction có thể chỉ là no-op. Đây là hai lỗi assertion đã được sửa sau lượt E2E đầu, không bỏ test để báo xanh.

## 4. Kết quả ngày 08/10

| Kiểm tra | Kết quả/phạm vi |
|---|---|
| Prisma validate | PASS |
| Fresh DB migrate deploy/status | PASS, 10/10 migration, up-to-date; chỉ DB test |
| Backend lint/build | PASS |
| Backend unit | PASS, 196/196, gồm 74 test nền Checkout mới |
| Migration E2E riêng | PASS, 24/24; legacy giữ nguyên và constraints/trigger/no-op đúng |
| Backend E2E toàn bộ sau sửa | PASS, 182/182 trong 15 file; gồm 24 test migration mới, chạy trên DB test riêng |
| TypeScript toàn bộ `tsc --noEmit` | FAIL: 13 diagnostics đã tái hiện ở baseline không có Checkout mới; không nhận toàn repo typecheck PASS |

13 diagnostics baseline: `earlyAccess` trong prisma.config không còn trong type PrismaConfig; 10 import `supertest/types`; field `locked` không tồn tại trên ReconciliationStats; thiếu declaration cho seed-demo-user.mjs. Chưa sửa các file này trong PR nền Checkout. Build riêng loại test/config vẫn PASS không có nghĩa chúng hợp lệ; cần task chất lượng riêng.

## 5. Cách chạy lại

Từ root checkout đúng branch, cung cấp DATABASE_URL của **DB test riêng** và hai JWT test trong môi trường tiến trình. Kiểm không có BE/.env ghi đè sang demo trước khi chạy setup-env. Không chép secrets vào tài liệu.

```powershell
pnpm install --frozen-lockfile
pnpm --dir BE exec prisma validate
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE exec prisma migrate status
pnpm --dir BE lint
pnpm --dir BE test
pnpm --dir BE build
pnpm --dir BE test:e2e
git diff --check
```

Không chạy migrate trên demo theo lệnh mẫu khi chưa chọn/kiểm tra DB. Nếu test fail, giữ output/exit code, sửa rồi chạy lại; không sửa migration đã được nhóm merge.

## 6. Chưa triển khai/không nghiệm thu ở commit nền f1666b2

- Chưa có `/checkout/preview`, `/checkouts`, `/checkouts/by-key`, CheckoutModule hoặc nối AppModule.
- Chưa có transaction COD/stock/Cart consumption/Order snapshot/Payment/history/movement/version/outbox, concurrency retry hoặc timeout runtime.
- Chưa có HTTP guards cho role/quota/body 64 KiB/no-store/Retry-After/log redaction của Checkout; helpers không thay thế chúng.
- CHK/QCHK end-to-end và CHK-S01–S03 thật **NOT_RUN**; CHK-S04 chờ Order/cancel. Unit/hash/DB constraint tests chỉ hỗ trợ một phần Q3/Q5/Q6, không tick cả gate.
- UI Checkout/Order, Order lifecycle, cancel/restore, payment sandbox và notification là task tiếp theo; G-CHECKOUT chưa DONE.

Thuật ngữ: **canonical** = đã chuẩn hóa theo quy tắc; **hash** = dấu kiểm nội dung; **receipt** = biên nhận kết quả tạo đơn; **replay** = lấy lại kết quả cũ của cùng yêu cầu; **legacy** = dữ liệu cũ chưa đủ bằng chứng dùng quy tắc mới; **constraint** = ràng buộc PostgreSQL; **trigger** = logic PostgreSQL tự chạy khi ghi; **migration** = thay đổi cấu trúc DB có phiên bản. `Checkout.hashVersion` không phải `Product.version`.
