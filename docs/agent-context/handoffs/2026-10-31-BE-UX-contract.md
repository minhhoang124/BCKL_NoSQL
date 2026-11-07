# BE-UX contract — Claude (Opus Medium) — checkpoint 1: BE-UX-01

Ngày 31/10/2026. Checkout `release-integration`, branch `feat/hoang/sku-management-final`, HEAD `60f2091` + WIP chưa commit (không commit/push/merge).

## Trạng thái (cập nhật sau QA HTTP/PostgreSQL — 31/10)

| API | Nhãn | Bằng chứng |
|---|---|---|
| `GET /orders`, `GET /seller/orders` — preview | **API_ACCEPTED (local HTTP/PG QA)** | Lượt 2 `be-ux01-qa-1793439827030`: order-list 33/33, seller-buyer-access 7/7, order-detail 28/28 (có ca list với snapshot hỏng). Source khớp 100% với provenance |
| `GET /orders/:id`, `GET /seller/orders/:id` — `items[].imageUrl` | **API_ACCEPTED (local HTTP/PG QA)** | Lượt 2: order-detail 28/28 |
| Tài khoản SELLER đọc `/orders` theo chính sách BUYER | **API_ACCEPTED (local HTTP/PG QA)** | Lượt 2: seller-buyer-access 7/7, checkout thật. Flag `ACCOUNT_BUYER_ACCESS_ENABLED` chỉ bật bằng `vi.stubEnv` trong file đó |
| `GET /cart` (cùng `PUT`) — `lineTotal` | **API_ACCEPTED (local HTTP/PG QA)** | Lượt 3 `be-ux01-qa-1793440773058`: cart 31/31 trên source cuối |
| `POST /checkout/preview` | Không đổi | Cart e2e đối chiếu `totals.total` của preview bằng đúng `lineTotal` của giỏ |

Phạm vi: QA DB local mới, role app chỉ có DML, không gọi provider. Đây **không** phải nghiệm thu staging/production/browser, cũng chưa có Chrome flow của FE.

## Hợp đồng cho Antigravity

### Quy tắc chung
- `productName`, `options`, `sku`, `unitPrice`, `quantity`, `lineTotal` trong đơn là **snapshot lúc mua**. Không bao giờ lấy từ Product hiện tại; Product bị đổi tên/giá thì đơn vẫn giữ nguyên.
- `imageUrl` trong đơn là **ảnh minh họa hiện tại** của Product, không phải ảnh lịch sử. Có thể là `null`; khi đó FE dùng ảnh fallback và vẫn hiển thị dòng đơn.
- Định dạng `imageUrl` giống `/cart` và Product public: giữ nguyên giá trị lưu trữ, thường là đường dẫn tương đối `/uploads/...` hoặc URL http(s). FE resolve theo cùng cách đang dùng cho ảnh cart/PDP.
- Tiền là chuỗi thập phân 2 chữ số (`"20000.00"`), VND. Không tính lại bằng `Number` để quyết định giá trị nghiệp vụ.
- Chính sách ảnh **theo scope endpoint, không theo role tài khoản**:
  - `/orders*` (BUYER): chỉ trả ảnh khi Product đang `ACTIVE` + `APPROVED`, Store `ACTIVE`, tài khoản seller còn hoạt động, có ảnh chính hợp lệ. Ngược lại `null`.
  - `/seller/orders*` (SELLER): trả ảnh chính của Product thuộc Store của chính seller, ở mọi trạng thái (kể cả ẩn/bị từ chối).
  - Tài khoản SELLER mua hàng (khi bật buyer access) đọc `/orders` theo chính sách BUYER.
- URL ảnh không hợp lệ (ngoài `/uploads/`, có `..`, query, ký tự điều khiển, có user:pass, javascript:/data:, dài hơn 2048 ký tự) → `null`. Validator tái sử dụng `normalizeSearchImageUrl` ở chế độ chỉ kiểm, không fetch ảnh.

### `GET /orders` và `GET /seller/orders` — thêm trường vào mỗi `items[]`
Các trường cũ, phân trang (`limit` ≤ 50, `afterId`, `nextCursor`), `status`, quyền và mã lỗi giữ nguyên.

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `itemPreview` | array, tối đa **3** | Các dòng đơn đầu tiên, sắp theo id dòng tăng dần |
| `itemPreview[].orderItemId` | number | ID dòng đơn |
| `itemPreview[].productId` / `variantId` | number | Dùng để dựng link PDP nếu Product còn bán |
| `itemPreview[].productName` | string | Tên snapshot |
| `itemPreview[].options` | string[] \| null | Phân loại snapshot, có thể rỗng. `null` chỉ khi snapshot đã lưu bị hỏng (đơn legacy): FE hiển thị “Xem chi tiết” thay cho phân loại, không lấy từ catalog |
| `itemPreview[].quantity` | number | Số lượng đã mua |
| `itemPreview[].unitPrice` / `lineTotal` | string | Giá lúc mua / thành tiền dòng |
| `itemPreview[].imageUrl` | string \| null | Ảnh minh họa hiện tại |
| `itemCount` | number | Tổng số dòng của đơn (có thể > 3) |
| `totalQuantity` | number | Tổng số lượng mọi dòng |
| `hasMoreItems` | boolean | `itemCount > itemPreview.length` → FE hiển thị “và N sản phẩm khác” |

Không trả SKU, địa chỉ, SĐT hay buyer trong list. Đơn legacy không có dòng sẽ trả `itemPreview: []`, `itemCount: 0`.

Ví dụ (dữ liệu giả, không chứa PII):
```json
{
  "items": [{
    "id": 123, "orderNumber": "ORD-20261031-0001", "status": "CONFIRMED",
    "store": { "id": 4, "name": "Cửa hàng A" }, "total": "60000.00",
    "payment": { "provider": "COD", "status": "UNPAID", "amount": "60000.00", "currency": "VND", "paidAt": null },
    "createdAt": "2026-10-31T08:00:00.000Z", "updatedAt": "2026-10-31T08:05:00.000Z",
    "itemPreview": [
      { "orderItemId": 501, "productId": 88, "variantId": 301, "productName": "Tai nghe X",
        "options": ["Đen"], "quantity": 2, "unitPrice": "20000.00", "lineTotal": "40000.00",
        "imageUrl": "/uploads/products/88/main.webp" },
      { "orderItemId": 502, "productId": 90, "variantId": 310, "productName": "Cáp USB-C",
        "options": [], "quantity": 1, "unitPrice": "10000.00", "lineTotal": "10000.00",
        "imageUrl": null }
    ],
    "itemCount": 4, "totalQuantity": 5, "hasMoreItems": true
  }],
  "nextCursor": 122
}
```

### `GET /orders/:id`, `GET /seller/orders/:id`
Chỉ thêm `items[].imageUrl: string | null` theo quy tắc ở trên. Các trường cũ (`productName`, `sku`, `options`, `unitPrice`, `quantity`, `lineTotal`, địa chỉ snapshot, timeline, cancellation) không đổi.

### `GET /cart` (và `PUT /cart/items/:variantId`, vốn trả cùng projection)
Thêm `groups[].items[].lineTotal?: string` = `currentUnitPrice × quantity` tính bằng Decimal theo **giá hiện tại**. Trường này có mặt mỗi khi có `currentUnitPrice`, kể cả dòng hết hàng/thiếu kho; dòng `VARIANT_UNAVAILABLE` và `unavailableItems` không có. Giá/tổng cuối cùng vẫn lấy từ `POST /checkout/preview`. Các trường đã có từ trước: store, productId, productName, imageUrl, optionValues, currentUnitPrice, stock, available, unavailableReason.

## Thực thi và hiệu năng
- List: tổng số query cố định cho mỗi trang. Gồm actor; orders (limit+1); **một** raw query tham số hóa bằng `Prisma.sql`/`Prisma.join`, chỉ với ID các đơn thực sự trả về (bỏ dòng thăm dò +1), dùng `ROW_NUMBER() ≤ 3` theo `orderId`, `COUNT`/`SUM` ép `::int` trong SQL và kiểm safe-integer khi map; **một** `product.findMany` batched cho ảnh. Tối đa 150 dòng preview. Không N+1.
- Detail: thêm đúng một `product.findMany`.
- Mọi đọc vẫn chạy trong transaction `READ ONLY` hiện có. Không đổi tiền, kho hay trạng thái.
- Không migration, không đổi Search, FE, lockfile hay Demo DB.

## File đổi (SHA256; source cuối = provenance lượt 3)
```
c5a5c49dd73d6b2421b7e816db31141b354b64dfec0d46da0eccf9960b2cb532 BE/src/order/order-item-image.ts (mới)
c30f30d1de22b5505fcc7c06feb15e3f9d808c379d5ad6889cad83504566f6fb BE/src/order/order-item-image.spec.ts (mới)
86f4880fea1b2b6a7517bb766242276c1b5f49efbf2b4fc9b4c78cd6324a22f3 BE/src/order/order-item-preview.ts (mới)
69d45d32a095e4ed2e2da4b8e6386351d7332f84d921ceb5daec19b016d6db3c BE/src/order/order-item-preview.spec.ts (mới)
d2eb8e3770a257330066ebcaa67df64cac8323ad3c5c30e5d90b1270037ca61b BE/src/order/order-list.service.ts
b1e12038867457bf32478425233d90d00df57016d84617e00a4a40d70efbadc0 BE/src/order/order-list.dto.ts
2f1a38cbdd27d1adf25c63158d1ecbb527672b570c469bcc8dc969680556dac5 BE/src/order/order-detail.service.ts
8bf1881788dda2ead22661ba0d2dac86616cd723c52fa96680dd4f73ba682140 BE/src/order/order-detail.dto.ts
1024d1b83859789ae4df33d9ddfd89eafcb76732af43b4d42059c391b9c6a050 BE/src/cart/cart.service.ts
910c4652768c48272e63c64ab8c998480bf740a0e29e1b9b9bf1a3f000116691 BE/src/cart/cart.dto.ts
99793bd47d0b8644740ff108e41e6034bb25c337a4657024f8bd197939eec87e BE/test/order-list.e2e-spec.ts
8afac326103ca4656ebed5164c3fd61c09cc96538ade31a5cf036c7b4000f884 BE/test/order-detail.e2e-spec.ts
7298027a3bf2f49854b7066696ea849effcd6cb46a362563c8fa7434d468694d BE/test/cart.e2e-spec.ts
62be8cae2fbc716128880ef7ff9405f5e726c8c4a33adf6118c46252ba584cec BE/test/seller-buyer-access.e2e-spec.ts
539fa0942bcc8d116814fc77139342829015bf9b8d17c52ecf4a6c149e176053 BE/test/helpers/qa-fault-ddl.ts (mới, Codex → Claude tiếp nhận)
e0ddb8f8bbc7cd14192e2a51a2d5ad68d76b01bc40155dd40548c250059b35a3 BE/test/helpers/qa-fault-ddl.spec.ts (mới)
094ae592596cecea6f107838aedb2afdb03bd860448742697c7aa5e439d79411 BE/test/order-cancellation.e2e-spec.ts
3a2007e1132620d6ce0a9f4645d78274148b72c61add5e065eed52491cb92cad BE/test/order-delivery-command.e2e-spec.ts
672912cb5ae43b08b17e2674c3abe3b828fb248b140cceffe5aced635c9f6ea2 BE/test/seller-order-command.e2e-spec.ts
5bbd640993b31a96802caef965885b2186fb49ee62b9510253ef3ef34ddb3397 BE/test/order-returned-command.e2e-spec.ts
```
Không có file nào trong `CANDIDATE_BASELINE.json` bị đổi bởi task này.

## Lệnh và kết quả thực tế

### Unit / build (trong `BE/`, trên source cuối)
- `pnpm test` (full unit) → **93 file / 2037 test PASS**, 0 FAIL.
- `pnpm build` → exit 0. `tsc --noEmit` (gồm cả test) → exit 0.
- `pnpm lint` → 2 cảnh báo có sẵn trong `search-image-url-policy.ts`, không thuộc task.

### Lượt 1 — `node machine-local/run-be-ux01-qa-20261031.mjs` (8 suite allowlist)
Artifact `machine-local/final-day-20261030/be-ux01-qa-1793439585660/`. Kết quả **241 PASS / 13 FAIL / 0 SKIP / 0 TODO**, `source-stability: stable=true`.

| Suite | PASS | FAIL | Phân loại lỗi |
|---|---|---|---|
| cart | 31 | 0 | — |
| order-list | 33 | 0 | — |
| seller-buyer-access | 7 | 0 | — |
| order-detail | 26 | 2 | (a) **Lỗi ứng dụng thật, do task này gây ra.** Preview list parse option snapshot hỏng nên cả `GET /orders` trả 500; ca rate-limit fail dây chuyền vì gọi `/orders` sau ca này. (b) **Assertion cũ mâu thuẫn quyết định mới**: so body detail sau khi Product về `NOT_SUBMITTED` phải y hệt trước, nhưng ảnh hiện tại của Buyer đổi thành null theo đúng quyết định |
| order-cancellation | 49 | 5 | **Guard/môi trường**: ca tiêm lỗi chạy `CREATE FUNCTION/TRIGGER` bằng client app; role app chỉ có DML → `42501 permission denied for schema public` |
| order-delivery-command | 21 | 3 | Như trên (42501) |
| seller-order-command | 54 | 2 | Như trên (42501) |
| order-returned-command | 20 | 1 | Như trên (42501) |

### Sửa sau lượt 1
- (a) Ứng dụng: snapshot option hỏng chỉ làm dòng preview đó có `options: null`. Không lộ JSON, không lấy từ catalog, detail vẫn trả 500 fail-closed như cũ. Đã thêm e2e khẳng định `/orders` và `/seller/orders` vẫn 200 với đơn hỏng, cùng unit tương ứng.
- (b) Test: vẫn khẳng định **mọi** trường khác giống hệt `first`. `imageUrl` được kiểm tường minh: Buyer = null, Seller = ảnh. Không bỏ ca, không nới phần snapshot.
- 11 lỗi 42501: không sửa test, không nới quyền runtime. Các file này không thuộc task.

### Lượt 2 — chạy lại các suite bị ảnh hưởng
`node machine-local/run-be-ux01-qa-20261031.mjs test/order-detail.e2e-spec.ts test/order-list.e2e-spec.ts test/seller-buyer-access.e2e-spec.ts`
Artifact `machine-local/final-day-20261030/be-ux01-qa-1793439827030/`. Kết quả **68 PASS / 0 FAIL / 0 SKIP**, `stable=true`. Hash provenance khớp 0 lệch với source hiện tại.

### Phạm vi áp dụng của từng bằng chứng
- Lượt 1 chạy trên source chỉ lệch 4 file so với source cuối: `order-item-preview.ts`/`.spec.ts`, `order-list.dto.ts`, `order-detail.e2e-spec.ts`. Thay đổi chỉ chạm nhánh options hỏng trong preview list.
- Cart và 144 ca PASS của 4 suite regression lấy từ lượt 1, **chưa chạy lại** trên source cuối.

### Lượt 3 — khép 11 ca fixture-DDL và chạy lại trên source cuối
- Codex (đã xác nhận với owner) thêm kênh DDL chỉ dùng cho fixture, rồi dừng; Claude review và tiếp nhận:
  - `BE/test/helpers/qa-fault-ddl.ts` kèm spec 16 test;
  - 4 suite fault chuyển `CREATE/DROP FUNCTION|TRIGGER` sang `ddl.exec`;
  - launcher truyền `QA_FIXTURE_DDL_URL` (migrator của chính QA DB dùng một lần) **chỉ** khi chạy 4 suite fault.

  Request/runtime vẫn là `bckl_local_app` chỉ DML (provenance `role: bckl_local_app`). Không cấp CREATE cho app, không đụng Demo.
- Guard của helper:
  - DDL URL phải trùng host/port/database với `DATABASE_URL`, khớp regex final-day, user `bckl_local_migrator` khác user app, chỉ cho `schema=public`, không fragment;
  - bị từ chối trên GitHub Actions;
  - DB final-day mà thiếu biến → fail-closed;
  - sau khi kết nối, kiểm lại `current_database`/`current_user`/không superuser;
  - lỗi không in credential.
- Lệnh: `node machine-local/run-be-ux01-qa-20261031.mjs test/cart.e2e-spec.ts test/order-cancellation.e2e-spec.ts test/order-delivery-command.e2e-spec.ts test/seller-order-command.e2e-spec.ts test/order-returned-command.e2e-spec.ts`
- Artifact `machine-local/final-day-20261030/be-ux01-qa-1793440773058/`. Kết quả **186 PASS / 0 FAIL / 0 SKIP**, `stable=true`, hash provenance khớp 0 lệch với source hiện tại.

### Ma trận cuối — 8 suite trên source cuối, mỗi suite lấy lượt mới nhất (không cộng lượt bị thay thế)

| Suite | Lượt | PASS | FAIL | SKIP |
|---|---|---|---|---|
| order-list | 2 | 33 | 0 | 0 |
| order-detail | 2 | 28 | 0 | 0 |
| seller-buyer-access | 2 | 7 | 0 | 0 |
| cart | 3 | 31 | 0 | 0 |
| order-cancellation | 3 | 54 | 0 | 0 |
| order-delivery-command | 3 | 24 | 0 | 0 |
| seller-order-command | 3 | 56 | 0 | 0 |
| order-returned-command | 3 | 21 | 0 | 0 |
| **Tổng** | | **254** | **0** | **0** |

- Giữa lượt 2 và lượt 3 chỉ đổi file test của 4 suite fault và helper. `BE/src` cùng các file test của 3 suite lượt 2 không đổi, nên lượt 2 vẫn áp dụng cho source cuối.
- Lượt 1 (241/13) được giữ làm lịch sử lỗi; không dùng làm bằng chứng cuối.
- Unit trên source cuối: **94 file / 2053 test PASS** (thêm 16 test của helper DDL). `tsc --noEmit` exit 0. Lint chỉ còn 2 cảnh báo cũ của Search.

## Giới hạn / ghi nhận
- Ảnh là ảnh hiện tại: Product đổi ảnh chính thì đơn cũ hiển thị ảnh mới. Muốn ảnh lịch sử thì cần migration snapshot ở task sau.
- Option snapshot hỏng: list trả `options: null` cho dòng đó; detail vẫn 500 fail-closed như trước.
- `vnpayCheckoutEnabled()` (`BE/src/payment/vnpay-config.ts`) không có caller. Chưa xóa, sẽ kiểm riêng.
- Working tree có `FE/src/pages/AdminDashboardPage.module.css` đang sửa nhưng không phải của Claude; không đụng.
- Phần sau checkpoint này, chưa làm: proposal đóng đơn VNPay giao thất bại, đổi mật khẩu qua email, danh mục địa giới.

## Checkpoint 2 — Claude đồng leader: kênh DDL fixture cho 11 ca fault-injection (31/10, CHƯA CHẠY trên PG)

> **Cập nhật 17:0x — phiên Claude Windows (có shell + PG):** trạng thái dưới đây đã bị thay thế. Lệnh đã chạy thật ở *Lượt 3*, artifact `be-ux01-qa-1793440773058`: cart 31, order-cancellation 54, order-delivery-command 24, seller-order-command 56, order-returned-command 21 → **186 PASS / 0 FAIL / 0 SKIP**, runtime `bckl_local_app`, `stable=true`, hash khớp source hiện tại. Spec helper chạy bằng vitest thật: 16/16. Full unit 94 file / 2053 PASS. 11 ca fixture-DDL **đã khép**. Ma trận cuối xem mục “Ma trận cuối”.

Trạng thái (ghi lúc viết checkpoint): **SOURCE_CHANGED_NOT_RUN**. Sandbox của Claude không tới được PostgreSQL 5549 trên máy owner và không chạy được vitest (node_modules Windows), nên chưa có bằng chứng PASS cho 11 ca. Không gọi là đã khép.

Thay đổi (chỉ test + helper, không đụng `BE/src`, migration, quyền runtime):
- Mới `BE/test/helpers/qa-fault-ddl.ts` + `qa-fault-ddl.spec.ts`. `createFaultDdl()` lazy; chỉ mở kết nối khi ca cần CREATE/DROP trigger.
  - DB đích dated final-day (`isFinalDayQaTarget` hiện có, không đổi regex) và có `QA_FIXTURE_DDL_URL`: chấp nhận khi cùng host/port/DB, user đúng `bckl_local_migrator` (khác role app), chỉ `schema=public`, không fragment, không chạy trong GitHub Actions; sau connect kiểm `current_database()`, `current_user`, không superuser; `lock_timeout 5s`.
  - DB final-day mà thiếu biến: **fail closed** (không tụt về app role, không skip). DB legacy/CI không biến: giữ hành vi cũ (cùng role như trước).
- 4 suite đổi toàn bộ `prisma.$executeRawUnsafe` (24 điểm: cancellation 4, delivery 12, seller-order-command 4, returned 4) sang `ddl.exec`; SQL giữ nguyên, thêm `ddl.close()` ở `afterAll`. Phần DML/HTTP vẫn qua app role.
- Launcher `machine-local/run-be-ux01-qa-20261031.mjs` (ngoài Git): chỉ khi chọn 1 trong 4 suite này mới đặt `QA_FIXTURE_DDL_URL` = migrator trên **đúng DB dùng một lần vừa tạo**; `DATABASE_URL` của app vẫn `bckl_local_app`. Bản gốc lưu ở scratchpad phiên Claude; diff 3 dòng. Không cấp CREATE cho app, không DDL trên Demo.
- Đã làm được: transpile sạch 5 file; chạy lại logic guard của spec bằng shim (16/16) — **không phải** vitest thật.

Lệnh cho người có shell Windows (một lần, DB mới mỗi lần, không provider):
`node machine-local/run-be-ux01-qa-20261031.mjs test/order-cancellation.e2e-spec.ts test/order-delivery-command.e2e-spec.ts test/seller-order-command.e2e-spec.ts test/order-returned-command.e2e-spec.ts`
Kỳ vọng: 4 suite chạy đủ; 11 ca trước đây 42501 phải PASS hoặc lộ lỗi thật (giữ nguyên lượt FAIL nếu có). Chạy kèm `cart` để có bằng chứng cart trên source cuối. Cũng chạy `pnpm vitest run test/helpers/qa-fault-ddl.spec.ts`, `tsc --noEmit`, `oxlint` và `prettier --check` (các dòng `ddl.exec(` ngắn hơn có thể cần format).

## Rủi ro hợp đồng với FE phát hiện khi review chéo (read-only)
`FE/src/services/orderResponse.ts` dùng `exact()` (số key phải bằng đúng allowlist). Với BE WIP hiện tại: mỗi dòng `GET /orders` có thêm `itemPreview/itemCount/totalQuantity/hasMoreItems` và `items[]` của detail có thêm `imageUrl` ⇒ validator FE hiện hành sẽ coi response không hợp lệ. File này chưa có thay đổi FE. FE phải mở rộng validator (và test) trước khi ghép với BE này; `itemPreview[].options` phải chấp nhận `null`.

## Checkpoint 3 — BE-UX-02: Admin tìm đơn theo mã hiển thị ORD (31/10, coordinator Claude Windows)

| API | Nhãn | Bằng chứng |
|---|---|---|
| `GET /admin/fulfilment/orders?orderNumber=…` | **API_ACCEPTED (local HTTP/PG QA)** | `machine-local/final-day-20261030/be-ux01-qa-1793441482233/`: admin-fulfilment-read **6/6 PASS**, `stable=true`, runtime `bckl_local_app`. Unit parser 31/31 |

### Hợp đồng cho Antigravity
- Không truyền query → queue giao hàng như cũ (READY_TO_SHIP / SHIPPING / DELIVERY_FAILED, ≤ 20 đơn). Response và projection không đổi.
- `?orderNumber=<mã>`: tìm theo mã hiển thị trên **mọi trạng thái**, sắp id giảm dần, tối đa 20 đơn. Response `{ "items": [...] }`, mỗi item cùng projection tối thiểu như queue/detail: `id, orderNumber, status, total, currentDeliveryAttempt, retryCount, currentAttempt, payment`. Không có buyer, địa chỉ hay SĐT.
- Input hợp lệ:
  - `ORD-` (không phân biệt hoa/thường, có thể bỏ) + **ít nhất 8 ký tự hex đầu** của mã, hoặc đủ mã;
  - khoảng trắng hai đầu được bỏ;
  - chỉ chấp nhận `[0-9a-f-]`.
- Input sai trả 400 `VALIDATION_ERROR`: ngắn hơn 8 hex, có `%`/`_`/khoảng trắng giữa/ký tự lạ, rỗng, lặp tham số, kèm tham số khác. Không tìm thấy → 200 với `items: []`.
- Quyền: chỉ Admin đang hoạt động, đúng credential version (cùng reader với queue); Buyer/Seller nhận 403. Chung rate limit với danh sách đơn.
- FE: ô tìm theo mã ORD, hiển thị kết quả bằng parser `snapshot()` hiện có. Mở chi tiết/hành động bằng `id` trả về. Không hiển thị ID nội bộ như thể đó là mã đơn.

### File đổi (SHA256)
```
ecdc2647c0496b661a6ac0d5241dad03394ff6e3aafe74e3d87e5baddf727f6d BE/src/order/admin-order-lookup.ts (mới)
4938c35af9e63aea8d6d5b141c11778f92a15a0824d72c79594c20238137f2a3 BE/src/order/admin-order-lookup.spec.ts (mới)
d10ba06b41290534f3f6d5e299984b8d9b65c4acf47216da8aec4238002adce5 BE/src/order/admin-fulfilment.controller.ts
e603bf5d338ac4c3b12af8bd8745a0a0bb85309876e5a09bbd929373ea7f6a87 BE/test/admin-fulfilment-read.e2e-spec.ts
```
- Launcher `machine-local/run-be-ux01-qa-20261031.mjs` (ngoài Git): chỉ thêm `test/admin-fulfilment-read.e2e-spec.ts` vào allowlist. Không đổi guard/DB/quyền.
- Unit toàn BE sau thay đổi: **95 file / 2084 PASS**, `tsc` exit 0, lint 2 cảnh báo Search cũ.
- E2E ca mới:
  - lookup đủ mã / prefix 8 hex / chữ hoa + khoảng trắng / bỏ `ORD-`;
  - đơn COMPLETED tìm được nhưng không lọt vào queue;
  - fixture không có dạng ORD không bao giờ khớp;
  - Buyer/Seller 403;
  - 7 dạng input xấu → 400;
  - GET không làm đổi Order/Payment.
- Không chạy lại 8 suite trước: chúng không gọi endpoint này, và `BE/src` khác chỉ ở controller Admin cùng file lookup mới.
- Giới hạn: queue vẫn tối đa 20 đơn, chưa có phân trang (giữ nguyên hành vi cũ). Tìm theo prefix dùng `LIKE 'x%'` trên cột unique, đủ cho dữ liệu khóa luận; chưa đo hiệu năng ở quy mô lớn.

## Checkpoint 4 — BE-UX-03: Danh mục địa giới + địa chỉ có mã + số di động VN (31/10, coordinator Claude Windows)

Quyết định owner (31/10): (1) làm khung trước, nạp dữ liệu chính thức sau; (2) địa chỉ cũ vẫn dùng được, có nhắc cập nhật; (3) số di động VN 10 số.

**Nguồn:** Quyết định 19/2025/QĐ-TTg (ký 30/6/2025, hiệu lực 1/7/2025), mô hình hai cấp: 34 tỉnh/thành (mã 2 số) và 3.321 xã/phường/đặc khu (mã 5 số), không còn cấp huyện. **Chưa nạp dữ liệu thật**: chưa có file Phụ lục chính thức (trang `danhmuchanhchinh.gso.gov.vn` không phân giải được; báo chí chỉ trích lại và mâu thuẫn về số chữ số). Không tự dựng danh mục.

| Phần | Nhãn | Bằng chứng |
|---|---|---|
| Migration `20261031120000_admin_division_catalog` (thêm bảng/cột, không seed) | **IMPLEMENTED, deploy PASS trên QA DB mới** | `be-ux01-qa-1793442688886` (launcher chạy `migrate deploy` 41 migration) |
| `GET /locations/provinces`, `GET /locations/provinces/:code/wards` | **API_ACCEPTED (local HTTP/PG QA, với catalogue FIXTURE)** — **chưa có dữ liệu thật** | location-address 4/4 |
| `POST/PATCH /me/addresses` với `provinceCode`/`wardCode`, `divisionStatus` | **API_ACCEPTED (local HTTP/PG QA, fixture)** | location-address 4/4, address 22/22 |
| Số di động VN | **API_ACCEPTED (local HTTP/PG QA)** | address 22/22, location-address, unit DTO |
| Checkout với địa chỉ (snapshot) | Không đổi logic; hồi quy **PASS** | checkout-create 42/42 |

Tổng lượt này: **68 PASS / 0 FAIL / 0 SKIP**, `stable=true`, runtime `bckl_local_app`. Unit toàn BE **96 file / 2139 PASS**; build và tsc đạt; lint chỉ còn 2 cảnh báo Search cũ.

### Hợp đồng cho Antigravity
- `GET /locations/provinces` → `{ version: { id, sourceRef, effectiveDate }, items: [{ code, name, kind }] }`. `kind` thuộc `THANH_PHO | TINH`.
- `GET /locations/provinces/:provinceCode/wards` → `{ version, province, items: [{ code, name, kind }] }`. `kind` thuộc `PHUONG | XA | DAC_KHU`.
- Lỗi của hai API trên:
  - 400 `VALIDATION_ERROR` khi mã sai định dạng hoặc có query lạ;
  - 404 `PROVINCE_NOT_FOUND`;
  - **503 `LOCATION_CATALOG_NOT_LOADED` khi chưa nạp danh mục (trạng thái hiện tại)**. FE hiển thị ô nhập text như cũ và không chặn người mua.
- Public, `Cache-Control: public, max-age=300`. Chỉ trả mã/tên.
- Địa chỉ, khi đã có danh mục: gửi `provinceCode` + `wardCode` (bắt buộc đủ cặp).
  - Tên tỉnh/xã **lấy từ danh mục**; text client gửi kèm bị bỏ qua; `district` bị xóa (không còn cấp huyện).
  - Lỗi:
    - 422 `ADDRESS_DIVISION_INVALID` khi xã không thuộc tỉnh;
    - 400 `ADDRESS_DIVISION_INCOMPLETE` khi chỉ có một mã;
    - 503 `LOCATION_CATALOG_NOT_LOADED`.
- Địa chỉ cũ / text tự do: vẫn tạo và sửa được khi `ADDRESS_CATALOG_REQUIRED=false` (mặc định). Response có `divisionStatus`:
  - `STANDARD`: mã thuộc danh mục active;
  - `OUTDATED`: mã thuộc danh mục cũ hơn;
  - `LEGACY_FREE_TEXT`: text tự do, chưa xác thực.

  Với `OUTDATED`/`LEGACY_FREE_TEXT`: vẫn checkout được, FE nhắc “Cập nhật địa chỉ theo danh mục mới”.
- PATCH:
  - gửi mã → đổi vị trí theo danh mục;
  - gửi text vị trí → thành legacy (xóa mã);
  - không gửi trường vị trí → giữ nguyên.
- Response thêm `provinceCode`, `wardCode` (nullable), `divisionStatus`. Không lộ id version nội bộ.
- **Số điện thoại người nhận:** chỉ di động VN, dạng `0` + `3/5/7/8/9` + 8 số, hoặc `+84…`; cho phép khoảng trắng/dấu chấm/gạch/ngoặc. BE lưu dạng `0xxxxxxxxx`. Đây là kiểm định dạng, **không phải xác minh chủ số**. Số cũ đã lưu không bị đổi. FE cần đổi validation/placeholder tương ứng (hiện FE còn quy tắc 8–15 số).
- Đơn hàng: snapshot vẫn là text tỉnh/xã/huyện như cũ; đơn cũ không đổi.

### Bảo đảm dữ liệu
- DB:
  - FK tổ hợp `(divisionVersionId, wardCode, provinceCode)` → `admin_wards`, nên PostgreSQL tự chặn xã không thuộc tỉnh;
  - CHECK địa chỉ đủ cả 3 mã hoặc không có mã nào;
  - unique index chỉ một version active;
  - CHECK định dạng mã, loại đơn vị và SHA256.

  E2E đã thử chèn sai trực tiếp vào DB và bị từ chối.
- Importer `BE/src/location/location-import.ts`:
  - kiểm toàn bộ trước khi ghi: mã, trùng lặp, loại, xã thuộc tỉnh tồn tại, tỉnh nào cũng có xã, **số lượng phải đúng 34/3.321** với nguồn chính thức;
  - tạo version mới ở trạng thái inactive → nạp dữ liệu → chuyển active trong một transaction;
  - **không sửa địa chỉ hay snapshot đơn**; địa chỉ gắn version cũ thành `OUTDATED`.
- Fixture test dùng tên bịa, `sourceRef = QA-FIXTURE-NOT-OFFICIAL`. E2E từ chối chạy nếu DB đã có danh mục, nên không thể ghi đè dữ liệu thật.

### Còn mở (cần owner/coordinator)
1. **File chính thức:** Phụ lục QĐ 19/2025/QĐ-TTg dạng Excel/CSV/PDF từ Cục Thống kê/Công báo, đặt trong `machine-local/`. Khi có file: viết bộ chuyển đúng định dạng file → chạy `importCatalog` với kỳ vọng 34/3.321 trên QA, đối chiếu ngẫu nhiên với văn bản gốc, rồi mới xin phép nạp Demo.
2. Demo/online: cần `migrate deploy` và `GRANT SELECT` các bảng `admin_*` cho role app (migration không tự GRANT, giống các migration trước). Chưa thực hiện trên Demo.
3. Chỉ bật `ADDRESS_CATALOG_REQUIRED=true` sau khi đã nạp dữ liệu thật và FE có bộ chọn.

### File đổi (SHA256)
```
fcb1eea59ca4a6ed35a49a47ead43273ccf474cd8f1b2753a9d540ce85ee91fe BE/prisma/schema.prisma
b02ed7088dcdd1918d0cac7d1d33e7ef08b3466f5b0d6cb4d22ba64ed9ab73cc BE/prisma/migrations/20261031120000_admin_division_catalog/migration.sql (mới)
b0f02594fcf16828b637f8a9a58c09ce9dc52445d197a8de87e66109896e407a BE/src/location/location-catalog.ts (mới)
b24bccea72c98e01f32712531313b7d5248abbd4a41ff31f77ed95e8153a18d2 BE/src/location/location-import.ts (mới)
f2e016b986207241bee3b29078fb2ce67268844a12dc19ea1075e9ad7ab0020a BE/src/location/location.controller.ts (mới)
6b1443015736e6a7c0b2ebf68291894ba4ade474944adaee6731b935efa6e640 BE/src/location/location.spec.ts (mới)
f4001f77734e0649488ba498430a3fa668864a13d456f4e9ea5cb5182f0870c9 BE/src/address/address.dto.ts
b42ee1ecf806f53f187ab7a0fb71cbc32289d47b5b76728403b36025acfec885 BE/src/address/address.service.ts
ed63f9dff523ff1ffbd5ffb324b28f793d0e2bdc22d1d64ab79296ddf47176ca BE/src/address/address.dto.spec.ts
0160f4bec4e97b07e227ff5dcbb4673ee71ec05550b699cd18575fa4f6f5acbe BE/src/app.module.ts
dc74d5cac5af14230754c5cca140e31e617f7e8cd2594f22552ebc7d4086b421 BE/test/location-address.e2e-spec.ts (mới)
```
Launcher (ngoài Git): thêm `address`, `location-address`, `checkout-create` vào allowlist; không đổi guard/DB/quyền.

## Checkpoint 5 — BE-UX-04: Đổi mật khẩu qua email (31/10, coordinator Claude Windows) — **IMPLEMENTED_DISABLED, CHỜ REVIEW THIẾT KẾ TRƯỚC KHI BẬT**

Mặc định `AUTH_PASSWORD_CHANGE_MODE=DIRECT`: hành vi hiện tại **không đổi**. Chỉ bật `EMAIL` sau khi leader/owner review thiết kế dưới đây và có quyền gửi thư phù hợp. Đã kiểm bằng delivery stub trong bộ nhớ, **không gửi thư thật**.

| Phần | Nhãn | Bằng chứng |
|---|---|---|
| Migration `20261031130000_auth_password_change_email`: thêm cột `bindingHash`, purpose `CHANGE_PASSWORD`, CHECK binding | Deploy PASS trên QA DB mới | `be-ux01-qa-1793443974417` |
| `POST /auth/password-change/{request,verify,confirm}` | **API_ACCEPTED (local HTTP/PG QA, chế độ EMAIL bật trong test, delivery stub)** | auth-password-change-email **6/6** |
| Hồi quy reset/verify email (delivery có đổi) | PASS | auth-email-recovery **13/13** |
| `POST /auth/password` (đổi trực tiếp) | Chế độ EMAIL → 409 `PASSWORD_CHANGE_EMAIL_REQUIRED` (e2e). Chế độ DIRECT: logic không đổi; **suite `account-settings` chưa chạy lại** vì dùng DDL fault-injection chưa chuyển sang kênh DDL fixture | unit + e2e |

Lượt 1 `be-ux01-qa-1793443872942`: 18 PASS / 1 FAIL. Lỗi do **fixture test sai**: test cố lùi `expiresAt` của token và bị trigger DB `Auth email identity is immutable` chặn; ứng dụng không lỗi. Đã sửa test sang cách chèn sẵn token hết hạn (theo đúng pattern của suite recovery), không nới trigger. Lượt 2 `be-ux01-qa-1793443974417`: **19 PASS / 0 FAIL / 0 SKIP**, `stable=true`. Unit toàn BE **97 file / 2148 PASS**, build và tsc đạt, lint 2 cảnh báo cũ.

### Thiết kế (để review)
1. **Request** `POST /auth/password-change/request` (JWT + guard settings) body `{ currentPassword, confirmed: true }`:
   - phải có tài khoản active và đúng credential version; **email đã xác minh** (không thì 409 `EMAIL_NOT_VERIFIED`);
   - **rate limit DB trước bcrypt**: 3 lần/user và 20 lần/IP trong cửa sổ 15 phút → 429 `PASSWORD_CHANGE_RATE_LIMITED`;
   - **giữ reauth bằng mật khẩu hiện tại** → sai thì 400 `CURRENT_PASSWORD_INVALID`.
   - Trong lock User: kiểm lại hash/email/verified; revoke challenge `CHANGE_PASSWORD` cũ còn hiệu lực (chỉ link mới nhất dùng được); tạo token 32 byte (**DB chỉ lưu SHA256**, TTL 15 phút, gắn user + email + credential version + `bindingHash`).
   - Gửi thư sau commit, không gửi trong lock. Response `{ status, email (che), expiresAt, bindingSecret }`, `Cache-Control: no-store`.
2. **Link** `/account/change-password#token=…`: token nằm trong fragment nên GET/scanner không chạm server. FE đọc fragment rồi xóa khỏi URL.
3. **Verify** `POST …/verify` `{ token, bindingSecret }` (JWT): **không tiêu thụ**, chỉ để FE quyết định mở form.
4. **Confirm** `POST …/confirm` `{ token, bindingSecret, newPassword, confirmed: true }` (JWT):
   - kiểm trước khi lock, rồi kiểm lại **toàn bộ dưới lock User + token** bằng đồng hồ DB;
   - mật khẩu mới phải khác mật khẩu cũ;
   - trong **một giao dịch**: đánh dấu token đã dùng, đổi hash, `credentialVersion + 1`, revoke mọi refresh token, revoke mọi email token còn lại, ghi audit `PASSWORD_CHANGED`;
   - trả `{ status: 'PASSWORD_CHANGED', reauthenticationRequired: true }`; access token cũ hết hiệu lực;
   - lỗi chưa rõ kết quả → 503 `AUTH_EMAIL_CONFIRM_UNCERTAIN`, không tự gửi lại.
5. **Gắn phiên / thiết bị khác:** `bindingSecret` chỉ có trên trình duyệt đã yêu cầu (FE lưu sessionStorage). Mở link trên thiết bị hoặc trình duyệt khác → 409 `PASSWORD_CHANGE_OTHER_BROWSER` kèm hướng dẫn gửi yêu cầu mới. Thiết bị khác chưa đăng nhập → 401, phải đăng nhập đúng tài khoản. **Không tự đăng nhập, không nối identity.**
6. **Chỉ có Google / chưa đặt mật khẩu:** không biết mật khẩu hiện tại nên request bị từ chối, kèm thông báo hướng dẫn dùng “Quên mật khẩu” (luồng reset đã có). **Email chưa xác minh** → 409, FE dẫn tới xác minh email trước.
7. **Chống đi vòng:** chế độ EMAIL chặn `POST /auth/password` (409). DB:
   - CHECK `CHANGE_PASSWORD` ⇔ có `bindingHash`;
   - trigger sẵn có giữ token bất biến, không đảo trạng thái đã dùng/đã revoke.
8. E2E đã phủ: DIRECT/EMAIL, chưa xác minh email, sai mật khẩu, verify lặp không tiêu thụ, sai trình duyệt, mật khẩu trùng, xoay vòng credential nguyên tử, token cũ 401, link dùng một lần kể cả sau khi đăng nhập lại, user khác, link bị thay thế, link hết hạn, **hai confirm đồng thời chỉ commit một**, rate limit.

### Để bật (chưa làm)
- `AUTH_PASSWORD_CHANGE_MODE=EMAIL`, `AUTH_EMAIL_ENABLED=true`, cấu hình provider/HMAC đã có, `ACCOUNT_SETTINGS_WRITE_ENABLED=true`, `AUTH_EMAIL_WEB_ORIGIN` đúng FE.
- Migration trên Demo.
- FE trang `/account/change-password`.
- Quyết định quyền gửi thư thật (D09: chỉ gửi tới alias kiểm thử).

### File đổi (SHA256)
```
9422d987c77b3299a73e0ca96c6d8b26781f741363a0abdb83d9f69c02397b7b BE/prisma/schema.prisma
ba3ae462818734066963606edade9ce82dc73c43ec9cbb3b3e483c4866a178ff BE/prisma/migrations/20261031130000_auth_password_change_email/migration.sql (mới)
d4e85c47e1603c8da5ba0b25a8d1f241270562d9ecca5292f8baf6354c71b5e0 BE/src/auth/password-change-email.controller.ts (mới)
b5222f57364c7a1a3fa029984beff59f6ecfff95cebf0330c5c27b0970082b1d BE/src/auth/password-change-email.input.ts (mới)
f6d8f5bec78ee2fb7ab4d4b7fc2333ac25ee2651b0ad907ca7c7ec16c45abd80 BE/src/auth/password-change-email.input.spec.ts (mới)
51750502b3bb272d3cc88fc00d4041dae3dc48859cf22a86512c42d85541caf5 BE/src/auth/password-change-email.service.ts (mới)
310d7dca41d787ef079e88b0cadc07c27fdd4988c601439d772f671f662ea16c BE/src/auth/email-delivery.ts
ca6164b5986e5a074614453eba31524e23376534b3fc6ae082cf6a0484df127b BE/src/auth/email-recovery.input.ts
f485608f20050140f45c9fbab1580df39fe963196eeb69fad00673e1eb6b59db BE/src/auth/account-settings.service.ts
a568cac82bb6d06a9a5d786bce5c6b8a4a35d73eee0d95b21cd6096573ffe61a BE/src/auth/auth.module.ts
9ecf2ba80671549e9dc35529dce47909b9055e744096292b33717a21111a1c95 BE/test/auth-password-change-email.e2e-spec.ts (mới)
```
Launcher (ngoài Git): thêm 2 suite auth vào allowlist; không đổi guard/DB/quyền.
