# Buyer Address API — hướng dẫn kiểm thử và bàn giao

Ngày 03/10/2026. Trạng thái IN_PROGRESS trên `codex/buyer-address-api`, chưa merge/không phải gate G-ACCOUNT hoặc G-CHECKOUT DONE. Nguồn yêu cầu: [contract đã duyệt #27](../api/cart-order-inventory-api-contract.md#3-useraddress-api).

## Phạm vi

- Năm endpoint `/me/addresses` GET/POST, PATCH/DELETE `/:addressId`, PUT `/:addressId/default`.
- Actor USER đang active, ownership từ JWT; role SELLER/ADMIN chưa dùng Buyer API trong mô hình single-role. Không tự đổi Auth sang multi-role.
- Migration expand mới district nullable cho Address và Order snapshot; dữ liệu cũ không bị đổi.
- DTO trim, validation/type/length, field thừa, PATCH omission/null và error envelope. PUT default không có field điều khiển từ client.
- Giới hạn cấu hình 20; mặc định nguyên tử; lock PostgreSQL theo User và retry conflict hữu hạn.
- Không có Cart/Checkout/Order API/UI hoặc rate limiter Cart trong task này.

## Luồng demo khi nhánh được chạy

1. Chạy migration trên database local được lựa chọn rõ ràng; khởi động Backend, mở Swagger `/docs`.
2. Đăng nhập bằng tài khoản USER và Authorize bằng access token.
3. POST `/me/addresses` với recipientName/phone/province/ward/addressLine; bỏ district hoặc gửi null. Địa chỉ đầu tiên tự mặc định.
4. Thêm địa chỉ thứ hai rồi PUT `/:addressId/default`; GET chỉ có một địa chỉ mặc định.
5. PATCH isDefault=false ở địa chỉ mặc định nhận 409; null ở ward nhận 400; district=null được nhận.
6. DELETE mặc định chọn địa chỉ cũ nhất còn lại; GET bằng User khác không thấy dữ liệu này.

Response địa chỉ: id, recipientName, phone, province, district, ward, addressLine, postalCode, deliveryNote, isDefault, createdAt, updatedAt. Không trả userId. GET `{items: [...]}` default trước, sau đó createdAt DESC/id DESC. Không có GET chi tiết trong contract P0.

## Test tái lập

Fresh checkout: `pnpm install --frozen-lockfile`, cấu hình DATABASE_URL và JWT secrets bằng môi trường riêng không commit. Dùng PostgreSQL test riêng; **không chạy reset hoặc fixture cleanup rộng trên database demo**.

```powershell
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE exec prisma validate
pnpm --dir BE lint
pnpm --dir BE build
pnpm --dir BE test
pnpm --dir BE test:e2e address.e2e-spec.ts
pnpm --dir BE test:e2e
git diff --check
```

E2E gọi HTTP thật qua JWT/role guard/ValidationPipe/controller. Bao phủ CRUD/default/ownership/inactive/expired token/validation/null/empty/ID overflow/giới hạn/concurrent creates/default switch+delete và Order snapshot. Ca rollback inject lỗi sau bỏ default trong **transaction DB thật**; không dùng mock HTTP làm bằng chứng DB. Test cạnh tranh limit dùng hai service instance chia sẻ Prisma/DB, không phải hai process Backend độc lập. Unit test bao phủ DTO biên và retry có giới hạn.

Cron SearchSync/Reconciliation/ImageRepair được tắt bởi setup-env hiện có. Cleanup chỉ fixture có marker riêng, không reset DB chung. DB kiểm thử local: `bckl_address_test_20261003`; database demo không được áp migration trong đợt này.

## Kết quả local ngày 03/10/2026

| Kiểm tra | Kết quả |
|---|---|
| Fresh install frozen lockfile | PASS; lockfile không đổi, postinstall generate thành công |
| Migration deploy trên DB trống riêng | PASS, đủ 9 migration; không áp trên DB demo |
| Prisma validate / migrate status | PASS / up-to-date |
| Backend lint / build | PASS / PASS |
| Backend unit | 87/87 PASS, 10 file |
| Backend E2E toàn bộ | 127/127 PASS, 13 file, gồm 22 ca Address |

E2E có log lỗi được inject cố ý cho ca rollback/timeout; không coi đó là test fail. Có cảnh báo deprecation của pg ở các suite hiện hữu và thông báo vite-tsconfig-paths; chưa xử lý thay dependency ngoài phạm vi task. Chưa có CI/review/browser evidence tại thời điểm ghi kết quả local. Không coi E2E service instances là kiểm thử nhiều process production.

## Giới hạn và bước tiếp theo

- Chưa có Buyer UI; chưa nghiệm thu luồng người dùng hoàn chỉnh.
- P0 lưu địa danh chuỗi, không có API địa giới/hard-code danh mục cũ.
- Không đụng giá/kho/version/SearchOutbox. Giỏ không giữ kho; Checkout phải tái kiểm tra khi triển khai.
- Lock theo User bảo vệ DB writes theo giao thức, không là rate limiter hoặc chứng minh tải production/multi-process.
- Sau review/merge: triển khai Cart theo contract, rồi Checkout/COD/Order; UI Address/Cart vẫn cần xác nhận phân công riêng của Hiền.
