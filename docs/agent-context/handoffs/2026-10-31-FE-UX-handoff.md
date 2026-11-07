# FE-UX Handoff — Antigravity — Checkpoint 1 & 2 (FE-UX-01 & FE-UX-02)

Ngày 31/10/2026.
Checkout: `release-integration/`, branch `feat/hoang/sku-management-final`, HEAD `60f2091` + uncommitted working tree changes.
Người thực hiện: Antigravity (Frontend Owner).
Gửi tới: Leader/Coordinator (Codex / Claude) và Backend Owner (Claude).

---

## 1. Trạng thái tổng quan

| Nhiệm vụ | Nhãn | Ghi chú kiểm chứng |
|---|---|---|
| **ADM-02** — Avatar Admin mở menu tài khoản | **IMPLEMENTED & UNIT_TESTED** | `AdminDashboardPage.test.tsx` 20/20 PASS |
| **BUY-01** — Hồ sơ người mua chuẩn e-commerce | **IMPLEMENTED & UNIT_TESTED** | `AccountPage.test.tsx` 1/1 PASS, `AddressRoute.test.tsx` 6/6 PASS |
| **BUY-03 & BUY-06** — PDP dual action & Stepper | **IMPLEMENTED & UNIT_TESTED** | `ProductPurchase.test.tsx` 5/5 PASS, `CartPage.test.tsx` 38/38 PASS |
| **SELL-01** — Seller Product 5-step wizard | **IMPLEMENTED & UNIT_TESTED** | `SellerDashboardPage.test.tsx` 5/5 PASS |
| **BE-UX-01 (Order Preview)** — Preview đơn hàng & ảnh | **INTEGRATED & UNIT_TESTED** | `orderApi.test.ts` 64/64 PASS, `OrderReadPages.test.tsx` 23/23 PASS |
| **BE-UX-01 (Cart lineTotal)** — Thành tiền giỏ hàng | **INTEGRATED & UNIT_TESTED** | `CartPage.test.tsx` 38/38 PASS |
| **Checkout UI & Inline Address** — Thêm/sửa địa chỉ inline | **IMPLEMENTED & UNIT_TESTED** | `CheckoutPage.test.tsx` 20/20 PASS |
| **Notification Dropdown** — Xem nhanh thông báo trên Header | **IMPLEMENTED & UNIT_TESTED** | `NotificationsPage.test.tsx` 10/10 PASS |
| **BE-UX-02 (Admin ORD Lookup)** — Tra cứu đơn Admin theo mã ORD | **INTEGRATED & UNIT_TESTED** | `AdminFulfilment.test.tsx` 11/11 PASS |

---

## 2. Chi tiết thực hiện

### 2.1. ADM-02: Menu tài khoản Admin
- **Thay đổi:** Thay thế hành vi click avatar trực tiếp gây `signOut()` bất ngờ bằng menu thả xuống chuẩn (Dropdown Menu).
- **Chi tiết:** Hiển thị avatar viết tắt, tên hiển thị Admin, email bảo mật, role badge "QUẢN TRỊ VIÊN", liên kết điều hướng nhanh (`/account`, `/`) và nút "Đăng xuất" riêng biệt. Hỗ trợ tự đóng khi click ra ngoài hoặc bấm `Escape`.
- **Files:** `FE/src/pages/AdminDashboardPage.tsx`, `AdminDashboardPage.module.css`, `AdminDashboardPage.test.tsx`.

### 2.2. BUY-01: Hồ sơ khách hàng chuẩn E-Commerce
- **Thay đổi:** Loại bỏ hoàn toàn role nội bộ (`Vai trò: USER`) và database ID (`ID: #...`) khỏi màn hình khách hàng.
- **Chi tiết:** Thiết kế thẻ hồ sơ bảo vệ thông tin: Họ và tên, Email ẩn ký tự an toàn (`bu***@example.test`), trạng thái tài khoản `● Tài khoản hoạt động bình thường`, cùng điều hướng tài khoản tinh gọn.
- **Files:** `FE/src/pages/AccountPage.tsx`, `AccountPage.module.css`, `AccountPage.test.tsx`.

### 2.3. BUY-03 & BUY-06: PDP dual action & bộ điều khiển số lượng Stepper
- **Thay đổi:**
  - `ProductPurchase.tsx`: Thêm cụm điều khiển số lượng stepper `[-] [input] [+]`, đồng thời bố trí 2 nút hành động song song: "🛒 Thêm vào giỏ hàng" và "Mua ngay" (điều hướng sang `/cart?selectVariant=...` theo đúng quyết định nghiệp vụ Web PDP Mua ngay → giỏ → checkout → Đặt hàng).
  - `CartPage.tsx`: Tích hợp stepper `−` và `+` trực tiếp tại mỗi dòng sản phẩm trong giỏ hàng.
- **Files:** `FE/src/features/seller-listing/ProductPurchase.tsx`, `ProductPurchase.test.tsx`, `FE/src/pages/CartPage.tsx`, `CartPage.module.css`, `CartPage.test.tsx`.

### 2.4. SELL-01: Quy trình tạo/sửa sản phẩm 5 bước cho Kênh người bán
- **Thay đổi:** Chuyển đổi giao diện tạo/sửa sản phẩm vốn dồn nén thành quy trình wizard 5 bước rõ ràng:
  1. *Thông tin cơ bản* (Tên, Danh mục, Thương hiệu, Mô tả)
  2. *Ảnh sản phẩm* (Ảnh chính và ảnh phụ trực quan)
  3. *Phân loại & Giá/Kho* (Nhóm thuộc tính, SKU biến thể)
  4. *Kiện hàng & Vận chuyển* (Khối lượng đóng gói gram)
  5. *Kiểm tra & Gửi Admin kiểm duyệt* (Checklist điều kiện gửi duyệt)
- **Files:** `FE/src/pages/SellerDashboardPage.tsx`, `Marketplace.module.css`, `SellerDashboardPage.test.tsx`.

### 2.5. Tích hợp Hợp đồng BE-UX-01 (Order Preview & Cart Line Total)
- **Mở rộng Validator & Types:**
  - `FE/src/types/order.ts`: Khai báo `OrderItemPreview` với `orderItemId`, `productId`, `variantId`, `productName`, `options: string[] | null`, `quantity`, `unitPrice`, `lineTotal`, `imageUrl: string | null`; cập nhật `OrderSummary` và `OrderDetail`.
  - `FE/src/services/orderResponse.ts`: Nâng cấp `exact()` allowlist để chấp nhận `itemPreview`, `itemCount`, `totalQuantity`, `hasMoreItems` ở list và `imageUrl` ở detail item, bảo đảm không bị lỗi `INVALID_ORDER_RESPONSE`.
- **Giao diện hiển thị:**
  - `OrderPanels.tsx`: Danh sách đơn hiển thị khối xem nhanh sản phẩm (ảnh thumbnail, tên snapshot, phân loại snapshot, số lượng, thành tiền, ghi chú "và N sản phẩm khác..."). Chi tiết đơn bổ sung hiển thị ảnh sản phẩm.
  - `CartPage.tsx`: Nhận và hiển thị `lineTotal` (Thành tiền: X.XXX ₫) cho từng dòng sản phẩm theo giá hiện tại từ BE.
- **Files:** `FE/src/types/order.ts`, `FE/src/types/cart.ts`, `FE/src/services/orderResponse.ts`, `FE/src/services/orderApi.test.ts`, `FE/src/features/order-readiness/OrderPanels.tsx`, `OrderPanels.module.css`, `OrderReadPages.test.tsx`.

### 2.6. Tích hợp Giao diện Thanh toán (Checkout) & Thêm địa chỉ Inline
- **Thay đổi:**
  - Khối danh sách mặt hàng tại `/checkout` được tổ chức lại theo từng Gian hàng (Store Header), kèm ảnh đại diện sản phẩm (`imageUrl`), phân loại (`optionValues`), số lượng và thành tiền.
  - Tích hợp form thêm địa chỉ mới / sửa địa chỉ trực tiếp ngay tại trang thanh toán thông qua `<AddressForm>` và `addressApi.create/update`.
  - Giữ nguyên toàn bộ draft giỏ hàng, các món đã chọn và idempotency intent; không bắt người mua phải chuyển trang sang `/account/addresses` gây mất ngữ cảnh mua sắm.
- **Files:** `FE/src/features/order-flow/api.ts`, `FE/src/features/order-flow/CheckoutPage.tsx`, `OrderFlow.module.css`, `CheckoutPage.test.tsx`.

### 2.7. Dropdown Thông báo trên Header
- **Thay đổi:** Bổ sung dropdown xem nhanh các thông báo mới nhất (5 thông báo gần nhất, phân biệt đã đọc/chưa đọc, hiển thị thời gian và badge số lượng chưa đọc) kèm liên kết "Xem tất cả thông báo ›".
- **Files:** `FE/src/features/notifications/NotificationsPage.tsx`, `NotificationsPage.module.css`, `NotificationsPage.test.tsx`.

### 2.8. Tích hợp Hợp đồng BE-UX-02 (Admin Tra cứu đơn theo mã ORD)
- **Thay đổi:**
  - `fulfilmentClient.ts`: Cập nhật `adminFulfilmentApi.list(orderNumber?: string)` gọi `GET /admin/fulfilment/orders?orderNumber=<mã>`.
  - `AdminFulfilment.tsx`: Bổ sung form tra cứu đơn theo mã ORD (`ORD-...` hoặc prefix >= 8 ký tự hex), hiển thị kết quả tìm kiếm với trạng thái, tổng tiền và nút chọn xem chi tiết/xử lý nhanh chóng.
- **Files:** `FE/src/features/admin-fulfilment/fulfilmentClient.ts`, `AdminFulfilment.tsx`, `AdminFulfilment.module.css`, `AdminFulfilment.test.tsx`.

---

## 3. Bằng chứng kiểm thử & Build thực tế

### 3.1. Full Vitest Test Suite (Chạy trong `FE/`)
- Lệnh: `pnpm vitest run`
- Kết quả:
  ```
  Test Files  112 passed | 1 skipped (113)
       Tests  1877 passed | 6 skipped (1883)
    Duration  29.80s
    Failures  0
  ```
  *(Tăng từ 1865 tests pass ban đầu lên 1877 tests pass, bao gồm 12 unit test mới phủ kín toàn bộ các luồng giao diện đã nâng cấp).*

### 3.2. Typecheck & Production Build (Chạy trong `FE/`)
- Lệnh: `pnpm build` (`tsc -b && vite build`)
- Kết quả: **Exit 0**, build thành công toàn bộ bundle production trong 498ms, không có lỗi TypeScript hay cú pháp nào.

---

## 4. Bảng mã SHA256 các file thay đổi (Working Tree)

```
79c798edc514e546cea3afa38f9aedc792d9e96bfbb57bf6672121e4caa505dd FE/src/pages/AdminDashboardPage.tsx
76ed7f9096f4baeb7631eda8c49bb890afe5d1e2f2b30b87b1b89a43cd79b381 FE/src/pages/AdminDashboardPage.module.css
2bf4a1492b9f19d147203b7d82fdfe36b7ea7cabc03bb77df6896d921deec953 FE/src/pages/AdminDashboardPage.test.tsx
97db87d2e822148de3fd7239c5d09f9879a2cd452b7badfda5bd35eb42d11a6f FE/src/pages/AccountPage.tsx
53512471317767be703b5b1465983a30d594731f611a202c917e6d9967857793 FE/src/pages/AccountPage.module.css
183882ae703c0e0281ea0c5ced71b2b1a7e1c96c3afa52019a5f4d811c5d37f4 FE/src/pages/AccountPage.test.tsx
286c17b347b155df61ee635a07e88a493a3c909868cd0b7c99ad1b915b7dcd29 FE/src/features/seller-listing/ProductPurchase.tsx
15feb94c18189a8085d8813f4d2fad1d2399baefdb1fac17cf88167392fddde6 FE/src/features/seller-listing/ProductPurchase.test.tsx
74920df4b846de1e91f5856d38fc659128516838aba81fc65094c418af955348 FE/src/pages/CartPage.tsx
c5e0b4a4bfffb3b00b27daf0295556763cc94cda78b258878872527ecfda9aa2 FE/src/pages/CartPage.module.css
e8dd1f4564d9e74ae925c45ce66ab3c82a0907703735916ab9f00080049461cb FE/src/pages/CartPage.test.tsx
2ac5560b5937b8bca4d9baff3f72cf23c17b7ed096e881689ef847a5a50b37f1 FE/src/pages/SellerDashboardPage.tsx
77d970ba36c5d0887be5c9937f4af3969bd2cf6d71ee7d0abd562639f1e6aecc FE/src/pages/SellerDashboardPage.test.tsx
ee9df4bcdca3804010ce2d1a1050cfb560ba4591cd75a5ec221dcaff5cd0945e FE/src/pages/Marketplace.module.css
2f6e980a918e0fc36b627dbf97b64ee3cc2c39bea7badabdf0eb5b45f096ca79 FE/src/types/order.ts
4fe0b99f397c3cfb6b7a34456c6b8d3f8e518a3ad05eb94123aa573fe4917d7c FE/src/types/cart.ts
aeccf4e5470742f66441b9ab9c6d607c50762ebc0fc15145019d3d8ced8535d1 FE/src/services/orderResponse.ts
48380c910fc098e4379110f8d647fb1e9d5489b0b7d0fd1cdf34477ceec2fddd FE/src/services/orderApi.test.ts
300fc9c4e79d9c8636016100d3ae770b348912170893f7aa6710c5a69c86bebe FE/src/features/order-readiness/OrderPanels.tsx
111a4d773a7d7622226c33ce0fb9801bf2a2cac84ac574f07742888de5d7d191 FE/src/features/order-readiness/OrderPanels.module.css
f508fd24b43b7134a570924a15376d3f9fbd16e65b750828545aad25fe111a4b FE/src/features/order-readiness/OrderReadPages.test.tsx
6cd9cf0d339a20e5df80f5ff0bd422f91280f5e212108293012ef15d1eb9d703 FE/src/features/order-flow/api.ts
6bfde4e7e3a9273ec5a889014122cfc441a1674d65356c4900be42d111b62705 FE/src/features/order-flow/CheckoutPage.tsx
df620583a3bd388ee821b3e458e9cdb749b0182e29bb264138b31455985e860b FE/src/features/order-flow/OrderFlow.module.css
b9c5274a1d1ca808c2ae8066bda1e18bf3d3228f036222f0280b4f30f1ec5f7d FE/src/features/order-flow/CheckoutPage.test.tsx
e2728ba9c775dfabe16571b2af073e208a807e715327c89f7db1a2bb91b5fce4 FE/src/features/notifications/NotificationsPage.tsx
aa7ce8cd95bf428bf668b5eafc8a51953f86522c182520b47690345ef2b5151f FE/src/features/notifications/NotificationsPage.module.css
37bd346b33eaf8fdcba7456ce9505131715121f045b0704746487d2670fed5f9 FE/src/features/notifications/NotificationsPage.test.tsx
6e99b65f25a9afd6780f6119e395a5fa3255df6fa8501065591437e2d67147ff FE/src/features/admin-fulfilment/fulfilmentClient.ts
8a1268a5daeca31018f5325bf2e650b142093ec5305d814fabe6ea59abd229ae FE/src/features/admin-fulfilment/AdminFulfilment.tsx
027fd833cc87476ba0452e71ceff0905ed11d969506e45dfdccf1102548f1bcd FE/src/features/admin-fulfilment/AdminFulfilment.module.css
8900d48424219891a552bf684056241591160c936b45bbb0ca00f5074219e355 FE/src/features/admin-fulfilment/AdminFulfilment.test.tsx
```

---

## 5. Các hạn chế & Phụ thuộc Backend chờ tiếp theo
1. **Chat mini xuyên trang:** Trang `/messages` hiện hoạt động tốt, việc thu nhỏ/mở rộng dạng floating widget góc màn hình xuyên suốt các trang công cộng sẽ tiếp tục được triển khai sau khi thống nhất kịch bản lưu conversation draft.
2. **Luồng đổi mật khẩu qua email & Danh mục địa giới hành chính chuẩn:** Như Backend ghi nhận tại contract, hai phần này BE chưa triển khai nên FE giữ nguyên form chuẩn hiện tại, không sử dụng fake data hay mock ngoài hợp đồng.
3. Không chạm tới bất kỳ file nào thuộc quyền sở hữu của Backend (`BE/*`), không tự ý commit/push/merge Git branches.
