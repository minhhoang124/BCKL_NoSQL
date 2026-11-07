# Kiểm chứng API chi tiết đơn Buyer/Seller — 10/10/2026

Baseline develop `27e083b` (nền #38 đã merge), branch `codex/order-detail-api`. Trạng thái **IN_PROGRESS, chưa merge/chưa nghiệm thu UI**. [Thiết kế và ý nghĩa từng trường](../api/order-detail-read-contract.md).

## 1. Môi trường và giới hạn

- Windows, Node/pnpm runtime hiện có của repo; PostgreSQL Docker đang chạy.
- Chỉ dùng database riêng `bckl_order_command_20261009_a` ở localhost:5432; 11 migration, không pending. Checkout task không có `.env`/`BE/.env` để tránh override URL về demo. JWT secrets sinh riêng cho lượt test, không lưu vào git.
- Không seed/migrate/update DB demo `klcn_ecommerce`, không sửa schema/SQL migration #38, không đổi FastAPI/FE hoặc worktree khác. Giữ draft chuẩn bị API detail của agent khác ở root nguyên trạng.
- Cron Search sync/reconciliation/image repair tắt theo setup E2E hiện có; worker AI không thuộc bài kiểm thử read-only này.

## 2. Kết quả kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| Backend TypeScript đầy đủ, không dùng incremental cache | PASS |
| Backend lint | PASS |
| Backend build + Prisma generate | PASS |
| Prisma validate | PASS |
| Toàn bộ Backend unit | **408/408 PASS, 20 suite** (31 ca mới) |
| Toàn bộ Backend E2E | **358/358 PASS, 21 suite**, lượt cuối 85.05s (27 ca mới); lượt trước 87.20s cũng PASS |
| E2E chi tiết đơn riêng trước bổ sung concurrency/timeout | 25/25 PASS; bằng chứng lịch sử, không thay kết quả 27 ca mới |
| git diff --check | PASS; cảnh báo LF/CRLF chỉ là normalization, không phải whitespace error |

Lượt đầu fixture mới thất bại do trường `isDefault` không có trong Variant và nested OrderItem không nhận `storeId` vì Prisma lấy FK ghép từ Order cha. Đã sửa theo schema hiện tại, không nới constraint/migration. Kiểm tra kiểu dữ liệu bổ sung bắt được mock generic delegate Prisma trong bài concurrency; test dùng proxy tại ranh giới để xen commit từ kết nối thứ hai, SQL vẫn thật. Không bỏ test để lấy kết quả xanh.

Warning `pg concurrent-query` và `vite-tsconfig-paths` có từ baseline. Các log INTERNAL_ERROR/timeout/forced failure trong negative test là lỗi cố ý được kiểm tra; tổng kết suite không fail hoặc skip. Không nói “không còn warning”.

## 3. Ma trận bằng chứng của 27 ca E2E mới

| Nhóm | Kết quả đã kiểm tra |
|---|---|
| Ownership | Buyer của đơn/Seller Store mình 200; Buyer/Seller khác và ID không tồn tại cùng 404 ORDER_NOT_FOUND |
| Auth | Không token/token hết hạn 401; sai role/Admin ở route Buyer/Seller 403; role/active đọc lại từ DB, không tin claim cũ |
| Lịch sử Store | Store SUSPENDED không cấm Seller active xem đơn cũ; account khóa vẫn 401 |
| Snapshot và tiền | Tên/SKU/options/địa chỉ lúc mua; Decimal(14,2) lớn giữ string chính xác, district/postalCode/note nullable |
| Privacy | Root/nested response theo allowlist; không key/hash/receipt/command ID/profile/JSON thô. Buyer ẩn Seller/Admin/unknown IDs; Seller chỉ actor scope đã chốt |
| Timeline | `(createdAt,id)` tăng ổn định kể cả timestamp bằng nhau; legacy actorType không bị suy thành role hiện hành |
| Cancellation legacy | CANCELLED cũ giữ object audit nullable; không parse cancellationReason tự do thành canonical code/text hoặc tạo Payment |
| Options hỏng | HTTP 500 an toàn, không echo JSON hỏng hoặc lấy catalog mới thay thế |
| Input | 7 ID sai × hai routes; 4 query không được hỗ trợ × hai routes; GET body malformed/{} và route aliases bị chặn trước parser |
| Quota | List/detail chung bucket actor, 429 Retry-After; Seller/Buyer độc lập |
| READ ONLY | PostgreSQL báo read_only=on, repeatable read, statement_timeout=2s; injected write bị DB từ chối |
| Concurrent read | Kết nối thứ hai commit Order status + history trong lúc đọc; request đầu thấy snapshot cũ nhất quán, request sau thấy cả commit |
| Timeout | Truy vấn pg_sleep(4) thực bị statement timeout 2s; HTTP 500 an toàn và kết thúc dưới 5s trong môi trường test |
| Checkout thật → detail | POST /checkouts 201 → Buyer/Seller GET 200, Payment UNPAID/history BUYER; sửa catalog/SKU/giá, xóa địa chỉ không đổi chi tiết đơn |
| Không ghi | GET lặp giữ nguyên Order/Items/Payment/Checkout/commands/history và SearchOutbox đã commit |
| Swagger | Hai route/nested DTO/security/error được đăng ký; cancel/confirm chưa có nên không xuất hiện |

Không mock HTTP Checkout/detail. Một số negative/concurrency tests instrument service/transaction boundary để đặt lỗi hoặc thứ tự; assertions vẫn chạy trên PostgreSQL thật. Fixture audit/history có nhãn là dữ liệu dựng kiểm thử, **không** nhận là Seller command runtime đã có.

## 4. Cách tái lập an toàn

Ở checkout không có file môi trường override, đặt DATABASE_URL trỏ database test riêng và JWT secrets riêng trước khi chạy:

```powershell
pnpm install --frozen-lockfile
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE exec prisma validate
pnpm --dir BE exec tsc --noEmit --incremental false -p tsconfig.json
pnpm --dir BE lint
pnpm --dir BE build
pnpm --dir BE test
pnpm --dir BE test:e2e
git diff --check
```

Không copy URL/secret demo vào báo cáo. Kiểm tra `BE/test/setup-env.ts`: BE/.env có override=true; nếu tồn tại phải chọn checkout test khác, không sửa/xóa .env của người dùng. Fixture cleanup chỉ phạm vi ID/User thuộc test; guard ID undefined tránh broad delete khi beforeAll thất bại. Không reset database hoặc xóa dữ liệu chung.

Sau lượt cuối, truy vấn chỉ đọc xác nhận **0 User fixture detail, 0 Order fixture detail, 0 OrderCommand** còn lại trên DB test. Truy vấn cleanup lần đầu bị lỗi quoting ở PowerShell (không phải E2E fail); đã chạy lại câu SELECT đúng và xác nhận ba số 0. Không thực hiện xóa/reset thủ công để đạt kết quả này.

## 5. Còn thiếu trước nghiệm thu toàn luồng

Review riêng legacy Payment/audit/options và quota chung; CI head mới; merge do người dùng quyết định; nối Buyer/Seller UI. Seller confirm/packing, hủy/hoàn kho, delivery/complete/D07, notification chưa có. Chưa audit legacy DB demo hoặc kiểm tải/multi-replica. Chưa đạt toàn bộ G-CHECKOUT/G-FULFILMENT.
