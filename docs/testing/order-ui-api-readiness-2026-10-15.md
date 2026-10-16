# Chuẩn bị nối Order UI Buyer/Seller

Ngày 15/10/2026. Người thực hiện: Hoàng; reviewer đề nghị: Hiền/Đạt. Nhánh `codex/order-ui-api-readiness`, đồng bộ nền `develop 541d15b` sau merge #48. **IN_PROGRESS / PREPARATION ONLY**: chưa nối route, chưa giao dịch Web thật, chưa nghiệm thu G-CHECKOUT/G-FULFILMENT.

## 1. Nguồn chuẩn và phạm vi

- [Phạm vi / Definition of Done](../project/implementation-scope.md), SRS v3.1 `docs/analysis/hien/srs-v3.md`, [Order contract](../api/cart-order-inventory-api-contract.md).
- [Order detail](../api/order-detail-read-contract.md), [Seller preparation](../api/seller-order-command-contract.md).
- DTO/service trên checkout: `BE/src/order/order-list.dto.ts`, `order-detail.dto.ts`, `order-list.service.ts`, `order-detail.service.ts`, `seller-order-command.controller.ts` và `seller-order-command.service.ts`.
- Đối chiếu code/contract, **không phải audit giao diện bằng ảnh hoặc trình duyệt**. Không nghiên cứu/chốt lại chính sách sàn; dùng các quy tắc Order đã chốt của nhóm.
- Chỉ thay module FE Order mới và tài liệu. Không sửa Backend/schema/Auth/apiClient/router/menu/Address/Cart/Admin/FastAPI. Không thao tác DB demo hay DB QA; task này không cần Docker.

## 2. Kết quả rà màn đã có

| Phần đã rà | Thực tế | Cách xử lý ở nhánh này |
|---|---|---|
| #40 `buyer-preview/BuyerPreviewPages.tsx` | DEV-only, ID `demo-*`, snapshot giả, ít trạng thái | Giữ nguyên nhãn mẫu; không chuyển ID giả thành ID PostgreSQL hoặc coi là API |
| #40 `seller-order-preview/SellerOrderPreview.tsx` | Bấm nút đổi useState tại client; không giao dịch | Không dùng state giả làm xác nhận/đóng gói thật |
| List API #37 | Summary/cursor, không có item name/image/quantity | Panel chỉ hiển thị số đơn, Store, trạng thái, tổng, Payment; nút chi tiết nhận numeric ID |
| Detail API #42 | Snapshot hàng/địa chỉ, Payment/history; actor được Backend lọc | Hiển thị snapshot; không query catalog/address hiện tại để ghi đè lịch sử |
| WIP `codex/order-ui-readiness` trong checkout session-isolation | Panel/policy chưa commit của task khác | Không sửa/xóa, không coi là dependency; cần chọn một bộ panel khi tích hợp để tránh trùng |
| #54 Checkout Web | PR riêng, chưa merge tại lúc kiểm tra | Không lấy code chưa merge; chuẩn bị điểm nhận numeric orderId sau receipt Checkout |

## 3. File mới và ý nghĩa

| File từ `FE/src/` | Trách nhiệm |
|---|---|
| `types/order.ts` | Kiểu dữ liệu đọc/biên nhận, 9 trạng thái và phân biệt Buyer/Seller |
| `services/orderResponse.ts` | Runtime validation: kiểm response thật khi nhận, không chỉ tin TypeScript |
| `services/orderApi.ts` | Adapter (lớp chuyển yêu cầu UI thành HTTP): list/detail + chuẩn bị POST C2; dùng client/Auth hiện có |
| `features/order-readiness/useOrderRead.ts` | Hooks đọc: tải/rỗng/lỗi, retry GET, hủy request cũ, chặn dữ liệu sai phiên |
| `features/order-readiness/orderPolicy.ts` | Nhãn, định dạng tiền, lỗi an toàn và quy tắc hiện/khóa nút; không thay quyền Backend |
| `features/order-readiness/OrderPanels.tsx` và CSS Module | Panel danh sách/chi tiết độc lập, loading/error/empty, callback chọn đơn/trang/nút |
| `features/order-readiness/testFixtures.ts` | Chỉ fixture kiểm thử (dữ liệu giả), không nhập DB hoặc đưa vào route demo |

Mọi panel yêu cầu `source="fixture"` hoặc `source="api"`. Fixture luôn có nhãn **DỮ LIỆU MẪU — chưa tích hợp giao dịch thật**. Nhãn API vẫn ghi **chưa nghiệm thu toàn luồng Order Web**. Không có route mới trong PR này; build production không tự kích hoạt các module.

## 4. Mapping dữ liệu — đọc để hiểu biến

| Biến/nhóm | Chứa gì, lấy từ đâu | Không được làm |
|---|---|---|
| `scope` | `buyer` chọn `/orders`, `seller` chọn `/seller/orders` | Không gửi buyerId/sellerId để chọn chủ đơn |
| `orderId` / `id` | Số nguyên PostgreSQL, 1..2147483647 | Không nhận `demo-*`, số thập phân hoặc chuỗi làm ID thật |
| `limit/afterId/status` | Số dòng 1..50, mốc ID trang sau, bộ lọc enum | Không tự phân trang theo thứ tự client/offset |
| `nextCursor` | ID cuối trang nếu còn trang; null là hết | Không dùng số trang hoặc ID giả; đổi filter phải bỏ trang cũ |
| `items` ở list | Các **đơn** tóm tắt | Không nhầm với các dòng hàng của detail |
| `items` ở detail | Các OrderItem: productName/sku/options/unitPrice/quantity/lineTotal lúc mua | Không lấy tên/giá hiện tại từ Product |
| `shippingAddress` | Snapshot người nhận, điện thoại, địa chỉ lúc đặt | Không lấy địa chỉ mới từ Address API; không in ra log/storage |
| `total/subtotal/shippingFee/discountTotal` | Tiền snapshot dưới dạng chuỗi nguyên đồng `.00` | Không parseFloat/tự tính lại tiền đơn; BigInt chỉ để định dạng hiển thị |
| `payment` | Snapshot đọc Payment hiện hành; có thể null với legacy | Không suy thiếu Payment là COD UNPAID |
| `timeline` | Toàn lịch sử đọc từ detail, thời gian tăng dần | Không dựng lịch sử giả từ trạng thái cuối; UI không hiển thị actorId |
| `readKey` | Dấu nhận diện phiên/người/đơn/filter/lần đọc | Không dùng nó làm idempotency key; chỉ dùng chống phản hồi/nút cũ |
| `fresh/busy/outcomeUnknown` | Dữ liệu còn mới / đang xử lý / chưa biết kết quả | Không mở nút mới khi request cũ có thể đã commit |
| `PreparedSellerCommand` | Ý định thao tác bất biến trong bộ nhớ: orderId/command/actorId/key/sessionVersion | Không lưu key vào URL/log; không tạo key mới chỉ vì timeout |
| `commandId/replayed/result` | Biên nhận lệnh; replay là gửi lại lệnh cũ | Không dùng result.status thay trạng thái mới nhất từ GET detail |

Validator từ chối HTTP 200 sai envelope, trường thiếu/thừa, enum/ID/tiền/ngày sai, dòng hàng trùng, lịch sử ngược, cursor/filter không khớp và receipt sai identity/actor/transition. Kiểm này **không phải quyền truy cập**: Backend vẫn kiểm JWT/ownership/state trong DB. Contract FE hiện là bản đối chiếu thủ công từ DTO local; khi Backend đổi shape phải cập nhật cả type/validator/test, chưa có code generation (tự sinh schema) giữa hai phía.

## 5. Nút và điều kiện

| Actor / trạng thái | Nút chuẩn bị | Có thể gọi runtime từ UI này chưa? |
|---|---|---|
| Seller / PENDING_CONFIRMATION | Xác nhận đơn | Chưa; panel chỉ callback, adapter có test riêng |
| Seller / CONFIRMED | Bắt đầu đóng gói | Chưa |
| Seller / PACKING | Sẵn sàng bàn giao | Chưa |
| Seller / SHIPPING hoặc DELIVERED | Không có nút tự xác nhận giao/hoàn tất | Không; giao mô phỏng thuộc Admin |
| Buyer / PENDING_CONFIRMATION | Hủy đơn, disabled | Backend #44 đã merge; chưa nối adapter/UI, lý do/key và test |
| Seller / PENDING_CONFIRMATION hoặc CONFIRMED | Hủy đơn, disabled | Backend #44 đã merge; chưa nối adapter/UI |
| Seller / DELIVERY_FAILED | Xác nhận hàng quay về, disabled | Backend #47 đã merge; chưa nối adapter/UI; thất bại không đồng nghĩa đã nhận hàng/hoàn kho |
| Buyer / DELIVERED | Xác nhận đã nhận hàng, disabled | Backend #48 đã merge; chưa nối adapter/UI |
| COMPLETED / CANCELLED | Không mở lại các bước chuẩn bị | Không |

C2 chỉ gợi ý enabled nếu Seller active, Store đúng `order.store.id`, Store ACTIVE/SUSPENDED, COD UNPAID paidAt=null hoặc sandbox PAID paidAt hợp lệ, amount=total VND, fresh=true, busy=false, outcomeUnknown=false. Store tạm khóa vẫn xử lý đơn cũ theo quyết định Hoàng, không mở quyền bán mới. Trường hợp Payment sandbox ở unit test **không** chứng minh VNPay/MoMo đã tích hợp.

## 6. Thứ tự nối runtime tiếp theo

1. Review bộ panel này cùng WIP/#40; chọn một nguồn, không gộp hai bộ policy/state. Khi nối route thật mới quyết định `/account/orders`, `/account/orders/:id` và `/seller/orders...` cùng guard/menu. Các path này hiện **đề xuất**, không phải route có sẵn.
2. Nối hooks đọc → panel; chỉ `source=api` sau khi dữ liệu đến từ adapter đã validate. Cho đổi status/cursor, chi tiết/back/empty/error; nếu refresh thất bại thì không hiển thị đơn cũ như còn mới.
3. Tạo bộ điều phối command: một intent/key cho một thao tác, click latch (khóa bấm trùng) ngay trước HTTP, giữ intent qua timeout/mất mạng/409 đang xử lý. Không dùng khóa client thay idempotency/DB locks ở Backend.
4. Gọi POST với **cùng object intent/key** khi gửi lại có kiểm soát. Không auto refresh/replay POST sau 401. Muốn refresh phiên phải do caller điều phối và chỉ gửi lại intent hợp lệ; đổi tài khoản thì adapter từ chối intent cũ.
5. Nhận receipt hợp lệ → GET detail mới → cập nhật list/detail. Không tự tiến state từ receipt cũ. Lấy `readKey` từ hook cùng state của lần đọc, không tự đổi key để mở nút trên dữ liệu cũ; hook chuyển loading ngay khi reload, chỉ ready sau response mới. Nếu kết quả command vẫn chưa rõ, giữ outcomeUnknown=true dù một GET đã xong. Không mở key mới dựa trên 404/timeout.
6. Hiện intent chỉ giữ **trong bộ nhớ**. Reload/tab close có thể mất intent; chưa có recovery bền qua reload. Phải giải quyết/đặc tả bước phục hồi này và ngăn unmount bỏ quên thao tác trước khi bật POST trên Web. Không hứa tự đối chiếu khi chưa có API/luồng phù hợp.
7. Sau khi các API liên quan merge, nối hủy/return/complete riêng với xác nhận/lý do, không bật bằng trạng thái mẫu.
8. Chạy Web thật trên DB QA riêng: Buyer đặt COD → list/detail → Seller 3 bước → theo dõi; sau các merge tiếp tục giao/hủy/quay về/hoàn tất. Kiểm desktop/mobile, sáng/tối, điều hướng Cart→Checkout→Order, đổi actor khi request pending, spam-click, mất response/replay và kho/outbox. Chỉ khi đủ bằng chứng mới xem xét nghiệm thu gate.

## 7. Kiểm chứng thực tế

### Đồng bộ sau #48, ngày 15/10

- Nền `develop 541d15b`, giữ đủ Backend Order đã merge và mục C4.3 completion; phần Order UI chuyển thành mục15 trong tổng quan kiến trúc. Không lấy code #54 chưa merge.
- FE source không đổi so với `5ec24a5`; Backend/Prisma/AI_CLIP/lockfile giống develop. Giới hạn intent trong memory và outcomeUnknown ở mục6 không đổi, không bật POST/route runtime.
- Rerun **239/239 FE tests**,19 files PASS; lint/TypeScript/build/diff PASS. Chưa chạy browser/live API/DB hoặc Backend E2E trong đợt đồng bộ tài liệu này. Không lấy 4live của nhánh #54 làm bằng chứng #55.

### Lịch sử đợt đồng bộ trước

### Đồng bộ sau #44, ngày 15/10

- Merge `origin/develop 2ed3ee5` vào nhánh #55; giải quyết duy nhất xung đột kiến trúc, giữ C2/C3 và mục Order UI. C3 đã CURRENT ở Backend, không đồng nghĩa nút hủy trên Web đã nối.
- Mã FE không đổi so với `eb17cbd`; Backend, AI_CLIP và lockfile giống nền develop sau merge. Không lấy code #46/#47/#48 chưa merge.
- Chạy lại: **239/239 test, 19 files PASS**, FE lint PASS, build gồm TypeScript PASS, diff-check PASS.
- Không chạy lại Backend E2E hoặc browser/live API cho đợt đồng bộ tài liệu này. Chưa có bằng chứng giao dịch Web; giới hạn intent trong bộ nhớ ở mục 6 vẫn giữ nguyên.

| Kiểm tra | Kết quả ngày 15/10 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, giữ nguyên lockfile; postinstall Prisma generate, không kết nối DB |
| `pnpm --dir FE test` | **239/239 PASS**, 19 files; nền 122 + 117 test mới |
| `pnpm --dir FE lint` | PASS, không warning |
| `pnpm --dir FE build` | PASS, gồm `tsc -b` kiểm kiểu và Vite build |
| `git diff --check` | PASS |
| Backend/schema/migration/API | Không sửa; không chạy lại BE/E2E/Prisma validate cho task FE độc lập |
| Live HTTP Backend/PostgreSQL, browser desktop/mobile/dark | **NOT_RUN** — chưa đăng ký route/hành vi runtime |
| Toàn luồng giao dịch Order Web, ES/FAISS | **NOT_RUN**, không lấy mock làm bằng chứng |

117 ca mới nằm ở `orderApi.test.ts`, `orderPolicy.test.ts`, `OrderPanels.test.tsx`, `useOrderRead.test.tsx`: transport HTTP mock, strict response, timeout/abort, intent/key/phiên, ma trận nút, snapshot/null, loading/error/empty, bấm trùng, lỗi async muộn, đổi đơn/trang/tài khoản và bỏ response cũ. **Mock** là phản hồi giả có kiểm soát trong test; các test này không chứng minh server/DB commit hoặc rollback. Cần Hiền review contract/privacy/nút và kiểm thử runtime riêng trước merge phần nối thật.
