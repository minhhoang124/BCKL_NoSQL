# Buyer Cart UI — triển khai và kiểm chứng

## Đồng bộ nền client #53 — 12/10/2026

Đồng bộ `origin/develop 41450b4` (PR #53 đã merge) vào nhánh Cart từ
`6e9ca07`. Git hợp nhất tự động thành công, không có conflict cần sửa tay;
không dựa vào trạng thái mergeability tạm thời trên GitHub để khẳng định có
xung đột. Giữ nguyên code/CSS Cart, Header và AppRouter so với `6e9ca07`,
gồm cả route Address/Cart. API client và test của client khớp nguyên bản
`develop 41450b4`: giữ bảo vệ phiên #52, timeout refresh và mã lỗi #53.
Không lấy Checkout #54 hoặc Order chưa merge vào nhánh này.

Kiểm tra lại trên bản kết hợp: **122/122 FE tests, 15 file PASS**, FE lint
không warning, build (`tsc -b` + Vite) và diff-check PASS. Test gồm cả Cart,
Address, điều hướng chung, quyền và bảo vệ phiên; dùng mock, không phải QA
trình duyệt/Backend thật.

Lượt đồng bộ này chưa chạy lại browser desktop/mobile hoặc Backend/PostgreSQL
thật. Bằng chứng cũ giữ phạm vi head cũ; không dùng để nghiệm thu head mới.
CI sau push và re-review của Hoàng cần đối chiếu đúng commit mới. Cart vẫn
`IN_PROGRESS`, chưa nghiệm thu Checkout xuyên suốt hoặc `G-CHECKOUT`.

## Đồng bộ sau merge Address #49 — 11/10/2026

Hoàng xác nhận #49 đã merge tại `develop dc52d92`. Bản đồng bộ của #50 lấy
đúng nền này và Auth #52 (`fc52c8c`), không sửa Backend/schema/contract hoặc
logic/CSS Address/Cart. Conflict duy nhất ở `AppRouter.tsx` được giải quyết
bằng giữ cả import AddressBookPage/CartPage và hai route USER:
`/account/addresses`, `/cart`. Link Account và Header của hai màn đều được giữ.

Reviewer chạy lại trên checkout riêng: **117/117 FE tests, 15 file PASS**,
lint, build (`tsc -b` + Vite) và whitespace check PASS. Thêm
`BuyerRoutesIntegration.test.tsx` kiểm việc dùng cùng AppRouter để mở Address,
đi qua link Giỏ hàng trên Header, rồi quay lại Address; API chỉ được gọi đúng
màn. Test này dùng AuthContext/service mock, không phải browser/Backend thật.
Các test quyền USER/Seller/Admin/inactive/anonymous của cả hai route cùng chạy
trên bản đã giải quyết conflict. Checkout receiver vẫn là công việc riêng
của Hoàng; không thêm route đặt đơn hoặc tự coi G-CHECKOUT là DONE.

Lượt này không chạy lại browser/mobile hoặc Backend/PostgreSQL E2E. Kết quả
browser thật và probe Auth trong comment Hiền ngày 10/10 thuộc các head trước
đồng bộ Address; không dùng làm test mới của bản kết hợp. CI phải đối chiếu
đúng commit sau push; PASS local không thay CI. Nội dung lịch sử bên dưới giữ
nguyên để phân biệt bằng chứng từng đợt.

Ngày 10/10/2026. Branch `feat/hien/buyer-cart-ui` được tạo trực tiếp từ `develop 27e083b`; Cart Backend #31 đã merge tại `6663fab`. Trạng thái **IN_PROGRESS**. Chưa nghiệm thu `G-CHECKOUT`.

## Phạm vi

`FE/src/pages/CartPage.tsx` là màn giỏ hàng Buyer độc lập, cùng CSS, service, types và test. Màn đọc `GET /cart`, đặt số lượng tuyệt đối bằng `PUT /cart/items/:variantId`, xóa bằng `DELETE /cart/items/:variantId`. Không sửa Backend, schema, Auth hoặc API client.

Màn nhóm các dòng còn công khai theo Store, checkbox dòng/Store/toàn giỏ chỉ chọn dòng `available=true`, có trạng thái chọn một phần. Hiển thị `lineCount`, `totalQuantity`, `purchasableSubtotal` do Backend trả, số lượng subset chọn và tạm tính bằng số nguyên cent từ chuỗi Decimal. Không cộng tiền bằng số thực JavaScript. Dòng `unavailableItems` cấp gốc chỉ hiện trạng thái chung, mã variant, số lượng và nút xóa; không hiển thị metadata Product dù response thừa trường. Variant bị ẩn không hiển thị option/giá/tồn riêng dù response thừa trường. Dòng thiếu tồn cho phép giảm quantity; dòng hết hàng/variant không hợp lệ chỉ cho xóa hoặc tải lại để kiểm tra điều kiện mới.

PUT thành công nhận toàn giỏ do Backend trả nhưng giữ bản sửa chưa lưu ở dòng khác. Lỗi validation 400 giữ bản sửa; lỗi 401/403/404/409/429/5xx hoặc lỗi mạng khóa thao tác và ẩn tổng tiền cũ đến khi GET thành công. Khi chưa tải được không hiển thị 0đ/giỏ trống giả. Tải lại giữ bản sửa chưa gửi nếu dòng vẫn có thể sửa; cảnh báo tạm tính dùng quantity đã lưu và có nút Hủy sửa. Thay đổi giá giữa hai snapshot có cảnh báo. Không tự retry mutation ngoài hành vi refresh session có sẵn của API client.

DELETE cần xác nhận và đọc lại giỏ sau 204. Nếu xóa thành công nhưng GET sau đó lỗi, giữ thông báo xóa thành công riêng và yêu cầu tải lại; không gợi ý xóa lần nữa. Dialog có focus ban đầu, vòng Tab/Shift+Tab, Escape khi chưa gửi, chặn nền bằng inert, khóa double-submit và trả focus về nút mở khi hủy. Response GET/PUT cũ bị bỏ khi đổi tài khoản; GET cũ bị hủy khi bắt đầu write. Không sửa Auth/global client hoặc tạo đơn.

Hoàng xác nhận qua tin nhắn ngày 10/10: Cart dùng `/cart`, được thêm route USER ở `AppRouter.tsx` và link Giỏ hàng trong Header. Đã nối đúng phạm vi; trang chặn inactive USER trước gọi API. Không sửa AuthProvider/refresh/API client/CSS toàn ứng dụng/Checkout/Order/Seller/Admin. Nhánh đã merge an toàn `develop f267399`, không xếp chồng Address hoặc feature Order chưa merge.

Cart → Checkout theo quy ước đã chốt: `/checkout?variantId=10&variantId=25`. Chỉ truyền variantId được chọn và available, không productId/quantity/giá/tổng tiền/token/địa chỉ. Nút khóa khi giỏ chưa sẵn sàng, không có lựa chọn, quá 50 dòng, tiền lỗi hoặc còn số lượng chưa lưu. Checkout của Hoàng phải đọc lại Cart/Address và preview, giữ query khi reload, không fallback mua toàn giỏ khi ID lỗi; intent/body/key đặt hàng chưa rõ kết quả vẫn phải được bảo toàn. PR này không triển khai phần nhận query hoặc đặt hàng. **Cart → Checkout xuyên suốt NOT_RUN** vì Hoàng chưa nối bên nhận.

## Bằng chứng hiện có

Lượt bàn giao sau xác nhận Hoàng/sync `develop f267399` ngày 10/10: **69/69 FE test, 10 file**, lint không warning, build/typecheck và diff-check PASS. So với 59 ca trước: thêm 4 ca handoff (repeated variantId, chỉ subset mua được, chặn draft, biên 50/51), 5 ca router/active/role/anonymous và 1 ca Header link. Không kiểm phần nhận query ở Checkout; không tạo API hoặc fixture giao dịch thật.

- `pnpm --filter fe test`: **59/59 test, 9 file đạt**, trong đó 32 ca CartPage, 2 adapter Cart và 2 tiền Decimal. Gồm empty/error/retry GET, chọn dòng/Store/toàn giỏ/chọn một phần, private metadata, Decimal lớn, quantity không hợp lệ, PUT absolute/chặn gửi hai lần/giữ bản sửa dòng khác, 400/401/403/404/409/429/5xx/network, DELETE xác nhận/204/GET sau xóa lỗi, đổi actor khi GET/PUT đang chạy và quyền USER/Seller/Admin/inactive/anonymous.
- `pnpm --filter fe build`: đạt.
- `pnpm --filter fe lint`: đạt, không warning.
- `git diff --check`: đạt.
- Browser local với fixture MOCK: chọn subset, giảm quantity thiếu tồn, PUT response/tổng mới, xóa private item/204/GET lại, giá thay đổi, lỗi ghi 503/ẩn tổng cũ/tải lại/giữ draft, keyboard dialog/focus đạt. Desktop và viewport mobile 390×844 không có overflow ngang; console không có error/warn trong lượt kiểm tra cuối.
- Ảnh QA ở thư mục local ngoài repository `C:/khoaluan/cart-ui-evidence-20261010/`: `cart-desktop-mock.jpg`, `cart-mobile-mock.jpg`, luôn có nhãn MOCK. Harness nằm trong `FE/artifacts/cart-preview/`, được gitignore; không đưa harness/ảnh vào PR. Không có tài khoản/token thật, không gọi Backend hoặc PostgreSQL.

Đây là test FE với mock service và browser với mock HTTP, **không phải nghiệm thu Backend + PostgreSQL thật**. Hoàng xác nhận chưa có server/tài khoản bàn giao đang chạy; cần DB test riêng, catalog mua được và hai Buyer active, không DB demo. Mở PR để Hoàng review code trước; tích hợp thật **NOT_RUN**, không chuyển CURRENT/DONE. Tạm tính ở Cart không bảo đảm giá/kho lúc tạo đơn. Reload Cart hoặc đổi actor không lưu lựa chọn/draft vào storage; reload Checkout phải giữ tập variantId trong URL theo trách nhiệm bên nhận. Ảnh/browser evidence ở trên là lượt trước nối Header/handoff, không nhận đã kiểm browser mới bằng các ảnh cũ.
