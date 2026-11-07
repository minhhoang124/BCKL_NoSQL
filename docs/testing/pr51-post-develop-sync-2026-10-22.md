# PR #51 — đồng bộ và HTTP/PostgreSQL QA ngày 22/10/2026

Nhận develop `e394c9e` vào head đã duyệt `ab89203`. Chỉ conflict tổng quan
kiến trúc; giữ đủ nội dung hai phía. CI/README/package merge sạch: giữ bước
Address/Cart guard lẫn evaluation, E2E safety và mọi nền mới. Script prepare/
serve/verify +10guard nguyên byte so `ab89203`; BE/src/Prisma/FE/AI/lockfile
khớp develop. Không schema/API/Auth hoặc giao dịch mới.

## Cây và môi trường được kiểm

- Merge local `2cd2592b37205f165022a5e64549b1269584879c`; sau đó chỉ thêm docs.
- Unit/static chạy trên checkout tác giả; cấu hình ignored cũ giữ nguyên.
- Live chạy checkout detached sạch `pr51-sync-qa-20261022` tại `2cd2592`.
- DB mới `bckl_hien_address_cart_20261022_sync`, PostgreSQL17 loopback5549,
  role hạn chế không superuser/createrole, container QA riêng; demo dừng.
- Chỉ tạo DB khi chưa tồn tại,17migration deploy, không reset/drop DB cũ.
- Không root/BE.env; launcher local allowlist đọc private profile nhưng không
  in credentials. Không commit profile, upload/fixture/config/verifier output.

## Kết quả thực chạy

| Kiểm | Kết quả |
| --- | --- |
| Frozen install ignore-scripts |PASS, không lockfile change |
| BE typecheck/lint/build/Prisma validate |PASS |
| Safety guards |10/10PASS |
| Full BE unit |1034PASS/47files,11.39s |
| Full FE |939PASS/6liveSKIP,50filesPASS/1SKIP,41.01s |
| FE lint/TypeScript/Vite build |PASS,5warning Admin nền |
| Fresh QA migrations/build |17migration PASS, generate/Nest build PASS |
| prepare → chỉnh fixture → prepare lần2 |PASS; checksum users/passwords/catalog/shipping/ảnh/address/cart giữ nguyên |
| serve → verify HTTP thật |PASS,9nhóm checks,2026-10-22T11:18:15Z |
| Sau verify cleanup |4User,5Product,0Order,0SearchOutbox |
| Cấu hình ignored tác giả cũ |checksum trước/sau bằng nhau |
| Full-range diff check |PASS |

Lần thử prepare lặp sửa giá/kho một Variant, địa chỉ và quantity giỏ của Buyer
QA mới trước snapshot; lần2 không ghi đè. Trước HTTP verifier, giá của đúng
fixture mới được trả10000đ theo oracle cố định của verifier, không sửa demo.

HTTP checks: health/DB, hai Buyer login/me/refresh, Address CRUD/foreign404/
default/20limit, Cart nhóm/lineCount/totalQuantity/Decimal/99limit/kho/private,
ảnh fixture phục vụ thật, private Cart không lộ tên/giá, Checkout preview một
dòng đúng20000đ và không tạo Order, xóa Address/Cart của Buyer verifier tạm.
Cleanup chỉ User verifier vừa tạo theo email/ID có guard không Order; bốn
tài khoản bàn giao giữ nguyên. Child API được dừng sau verify; DB/fixture giữ lại.

## Giới hạn và review

Không browser Address/Cart/Checkout/Order trên bản này, không create COD,
fulfilment, Search worker/ES/FAISS, AI tests hoặc full BE E2E mới. SVG/catalog
APPROVED là fixture QA có nhãn, không chứng minh upload/duyệt Seller thật.
9nhóm verifier không được gọi thành9E2E giao dịch mua hàng.

Nhờ Hiền re-review delta đồng bộ đúng head mới. Approvalab89203 không thay
review bản kết hợp; CI billing không được gọi là CI xanh. Chưa merge PR hoặc
nhận công cụ QA đồng nghĩa nghiệm thu các gate Web.
