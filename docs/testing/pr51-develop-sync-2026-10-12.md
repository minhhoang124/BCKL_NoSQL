# PR #51 sync sau Cart #50 — 12/10/2026

Merge develop `d4d1884` trên nhánh `codex/address-cart-handoff`.
Conflict chỉ kiến trúc: giữ mục client Checkout và mục công cụ QA riêng.
Không đổi script/schema/API/router/Auth; Address #49/Cart #50/Auth #52/client #53
đã merge. Không dùng approval cũ thay kiểm chứng head sau sync.

## Kiểm thử thực chạy

- Frozen install, BE typecheck/lint/build, diff-check PASS.
- Safety guards **10/10**, BE unit **377/377**, FE **122/122** + lint/build PASS.
- Checkout QA sạch detached `2e09b5e`; không copy private config của worktree cũ.
- Fresh DB bàn giao `127.0.0.1:5549/bckl_hien_address_cart_20261012_sync`,
  12 migration đúng checkout; prepare → serve loopback 3013 → verify HTTP thật PASS.
- Verify: login/me/refresh hai Buyer, Address CRUD/default/20/foreign 404,
  Cart quantity/stock/group/Decimal/private/no reservation, public Product/ảnh,
  preview đúng dòng đã chọn, không tạo Order; cleanup Buyer tạm PASS.
- Sửa fixture Variant 1 thành giá 10001.00/kho 199 rồi prepare lặp:
  checksum toàn bộ Product/Variant/Address/Cart/CartItem trước/sau giống nhau.
  Không reset giá/kho/dữ liệu đã sửa; tài khoản bàn giao giữ nguyên.
- Full Backend E2E **352/352, 21 suites PASS** trên DB thứ hai
  `127.0.0.1:5549/bckl_pr51_e2e_20261012`, 12 migration từ trống.
  Không chạy full E2E vào DB fixture bàn giao hoặc demo.
- Dừng API QA sau verify; dữ liệu/config fixture nằm trong ignored files,
  không commit mật khẩu/JWT/ảnh runtime/results.

## Giới hạn

Lượt prepare đầu ở worktree cũ tái dùng cấu hình QA cũ đúng hành vi script;
không tính đó là bằng chứng fresh DB 5549. Đã chuyển checkout sạch và thực hiện
toàn chuỗi kiểm ở trên; không xóa/ghi đè cấu hình QA cũ.
Verify API không chứng minh browser của Hiền, Checkout write, Order fulfillment,
ES/FAISS hoặc thanh toán production. Browser Checkout #54 là bằng chứng riêng.
Không nâng G-CHECKOUT/G-FULFILMENT thành DONE hoặc tự merge.

Chỉ bổ sung tài liệu sau kiểm, runtime không thay từ `2e09b5e`; commit/CI cuối
và yêu cầu Hiền re-review được ghi trong comment PR.
