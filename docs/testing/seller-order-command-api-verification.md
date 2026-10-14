# Kiểm chứng Seller chuẩn bị đơn — C2, 10/10/2026

Branch `codex/seller-order-commands`, baseline develop **27e083b** (#38 đã merge).
IN_PROGRESS/chưa merge; không coi đây là nghiệm thu G-FULFILMENT hoặc UI.
[Contract C2](../api/seller-order-command-contract.md) dựa FR-ORD-01/UC-HT07,
contract Cart–Order–Inventory mục 7.1; detail #42 là PR độc lập.

## Kết quả thực tế

| Kiểm tra | Kết quả |
|---|---|
| Backend lint | PASS |
| Full Backend typecheck (source/test/config) | PASS |
| Backend build | PASS |
| Backend unit | **411/411 PASS, 20 suite**; 34 ca mới |
| C2 E2E riêng | **54/54 PASS**, 7.47s trước chỉnh CI DB guard |
| Full Backend E2E sau chỉnh guard/cleanup | **385/385 PASS, 21 suite, 86.33s**; 54 ca mới |
| Prisma validate / migrate status | PASS; 11 migration up to date, không đổi schema/SQL |
| Git diff check | PASS trước bàn giao; kiểm lại staged trước commit |

Database duy nhất trong lượt này: `bckl_order_command_20261009_a` trên PostgreSQL
local. Không migrate/seed/reset/ghi DB demo `klcn_ecommerce`. JWT test tạo tạm
trong process, không ghi file. Checkout task không có `.env` hoặc `BE/.env` vì
Prisma/test setup có thể override DATABASE_URL bằng các file đó.

SELECT sau full suite: **0 User fixture C2, 0 OrderCommand, 0 test trigger,
0 schema upgrade**. Checksum migration audit vẫn
`fb66f310e69c5862a934d9857263b6b6bbe78771834bfeb84f9443bd25a5ab2c`.
Frozen install đạt, lockfile không đổi.

Các log ERROR trong fault-injection (cố tình gây lỗi để kiểm hoàn tác) và warning
pg/Vite nền vẫn xuất hiện. Không kết luận “không warning”; không có test fail
hoặc skip trong full run cuối. Lượt đầu phát hiện lỗi fixture/cleanup và cách
gửi gzip bằng Supertest; đã sửa, dọn đúng fixture trên DB test, chạy lại cả suite.

## Bằng chứng mới

| Nhóm | Chứng minh |
|---|---|
| Ba bước chuẩn bị | HTTP chuyển đúng từng bước; một command/một history, receipt typed SELLER |
| Store/account | SUSPENDED Store xử lý đơn cũ; PENDING/REJECTED/CLOSED chặn lệnh mới; tài khoản khóa/role thay đổi chặn cả replay |
| Ownership | Buyer/Admin/Seller khác không có quyền; sai chủ/ID vắng đều 404, không lộ đơn |
| Replay | Cùng key trả snapshot gốc sau các bước sau; app thứ hai/restart đọc receipt DB, không ghi lại nghiệp vụ |
| Conflict | Cùng key khác command/Order/hash 409; key mới ở state đích không giả replay |
| Đồng thời | Hai app/client PostgreSQL riêng, giữ khóa thật + đợi cả request bị chặn; same key/same Order, khác key/same Order, same key/hai Order |
| Atomic/rollback | SQL trigger gây lỗi lúc insert history hoặc finalize receipt; không đổi Order/Payment/history/command; retry cùng key sau gỡ lỗi thành công |
| Bounded wait | Khóa Order thật quá timeout → 409 Retry-After, không mutate; thả khóa và gửi lại cùng key thành công |
| Payment | COD UNPAID/paidAt null; PAID sandbox fixture có paidAt; thiếu Payment hoặc amount/state sai chặn từng bước, không tạo Payment bù |
| Receipt hỏng | Strict allowlist, identity, hash/version, tiền/timestamp; receipt persisted sai không dựng từ Order hoặc lộ JSON nội bộ |
| HTTP safety | Không query/body thừa/key sai/ID ép kiểu; JSON lỗi, route alias, raw chunked/gzip vượt 8 KiB → lỗi an toàn |
| Quota | 20 ingress gồm replay và cả ba đường; 429 Retry-After, quota riêng không chặn đọc Order |
| Checkout tích hợp | HTTP tạo COD thật → ba command; stock/StockMovement/Payment/OrderItem/Checkout/Cart/Product.version/outbox giữ nguyên sau chuẩn bị |
| Swagger | Ba route 200, header Idempotency-Key bắt buộc, empty JSON, ID có giới hạn |

E2E là HTTP NestJS và PostgreSQL thật, không dùng mock transaction để chứng minh
concurrency. Restart tạo ứng dụng NestJS khác dùng cùng DB; không kill OS đúng
điểm commit. Mất response được mô phỏng bằng gửi lại key của lệnh đã commit,
không phải fault-injection mạng sau COMMIT. Test PAID chỉ policy fixture, không
chứng minh callback VNPAY/MOMO hoặc sandbox đã triển khai. Không gọi AI/index
vì ba command này không làm đổi document/tồn kho.

## Chạy lại an toàn

1. Dùng checkout riêng không chứa `.env`/`BE/.env`; kiểm URL trước chạy. Không
   chạy full E2E từ root nếu file BE/.env đang override DB demo.
2. Tạo một DB local có tên `bckl_...` riêng với quyền tạo fixture/trigger;
   đặt DATABASE_URL trong process tới DB đó, JWT_ACCESS_SECRET/JWT_REFRESH_SECRET
   tạm đủ mạnh; không in secret hoặc lưu vào Git.
3. `pnpm install --frozen-lockfile`; `pnpm --dir BE exec prisma migrate deploy`;
   `pnpm --dir BE exec prisma migrate status`; `pnpm --dir BE exec prisma validate`.
4. `pnpm --dir BE lint`; `pnpm --dir BE typecheck`; `pnpm --dir BE build`;
   `pnpm --dir BE test`; `pnpm --dir BE test:e2e`; `git diff --check`.
5. Riêng C2: `pnpm --dir BE exec vitest run --config vitest.config.e2e.ts test/seller-order-command.e2e-spec.ts`.
6. Cleanup chỉ fixture email/store theo marker riêng, gồm Order tạo bằng
   Checkout HTTP (orderNumber do Backend sinh không mang marker). Đóng cả hai
   app trong finally. Kiểm lại không còn User fixture/command/SQL test trigger.

Guard suite từ chối local DB không có prefix `bckl_`. Ngoại lệ duy nhất là
GitHub Actions (`GITHUB_ACTIONS=true`), database `klcn_ecommerce` của PostgreSQL
service tạm trong workflow hiện hành; không coi tên này là DB demo trên runner.

## Giới hạn và điểm review

- Hoàng đã chốt SUSPENDED Store được xử lý đơn cũ; Hiền review chính sách/trace
  SRS. Không nới quyền account khóa, Store khác, create Product hoặc Checkout.
- Result receipt v1 có timeline **một transition của command**, không toàn lịch
  sử; GET detail #42 phục vụ lịch sử mới nhất. Cần Hiền review allowlist này.
- Quota 20/actor/phút theo instance, không chia sẻ nhiều replica; chống xử lý
  trùng dựa DB, không dựa quota hoặc memory mutex. Actor-wide lock có thể giảm
  throughput cho Seller xử lý nhiều đơn, đổi lock strategy cần regression concurrency.
- Chưa hủy/hoàn kho, shipping/DeliveryAttempt, tự hoàn thành, thông báo bền vững
  hay Buyer/Seller UI nối API. Không có migration mới trong C2.
- Sau #42 merge, đồng bộ develop/giữ cả controller và chạy lại test tích hợp;
  kết quả hai branch độc lập không thay bằng chứng head đã kết hợp.
