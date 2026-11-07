# Seller Order Web + resolver — 18/10/2026

## Phạm vi và nền

Nền chính thức `develop 39e8343` đã merge Backend #67. Nhánh FE
`codex/seller-resolution-client`; không đổi Backend, migration, Auth, Search,
Admin hoặc Address/Cart. Đây là **IN_PROGRESS**, chưa review/merge Web.

Nối vào `/seller/orders/:orderId` qua cờ cấu hình
`VITE_SELLER_ORDER_COMMANDS_ENABLED=true` chỉ cho QA. Mặc định false vẫn đi
đường chỉ đọc cũ, không GET Store hay POST command. Đây không là phân quyền:
Backend luôn đọc lại account/owner/state/payment và bảo đảm transaction.
UI cam #59 chưa merge nên không lấy source nhánh đó vào bản này.

## Luồng và từ cần hiểu

- **Intent / ý định:** người dùng muốn thực hiện đúng một bước trên đúng đơn.
- **Idempotency-Key / mã chống xử lý trùng:** ghi sessionStorage trước HTTP;
  khi mất phản hồi vẫn giữ mã cũ, không tạo mã khác để “thử lại”.
- **Receipt / biên nhận:** kết quả command đã commit trong PostgreSQL;
  GET detail chỉ là trạng thái hiện tại, không thay biên nhận.
- **Resolver / đối chiếu:** có biên nhận thì trả COMMITTED; nếu chưa thực hiện
  thì ghi bản chặn CLOSED_WITHOUT_EXECUTION. Đóng mã không phải hủy đơn.
- **Session generation / thế hệ phiên:** chặn response của lần đăng nhập cũ
  cập nhật giao diện hoặc xóa mã của lần đăng nhập mới.

1. GET detail và GET `/seller/store`; validate ownership projection/status,
   snapshot/Payment; không giả Store ACTIVE. Store SUSPENDED xử lý đơn cũ được.
2. Chọn bước hợp lệ → hộp xác nhận riêng → consent → lưu intent → POST `{}`.
   Xác nhận → đóng gói → sẵn sàng giao, mỗi bước cần consent mới; không tự chain.
3. Biên nhận hợp lệ → xóa đúng pending → GET mới. GET lỗi vẫn giữ kết quả đã biết,
   chỉ cho retry GET, chưa mở bước sau. Không dựng trạng thái mới từ toast.
4. Mất response/lỗi HTTP/response hỏng → giữ intent, khóa command mới. Reload chỉ
   GET, không tự execute/resolve. Người dùng xác nhận riêng việc đối chiếu/dừng.
5. Resolver validate full response + invocation/key/actor/phiên → settlement đúng
   journal → GET mới. Lỗi resolver vẫn giữ mã; không giả receipt cho nhánh CLOSED.
6. Có pending ở đơn khác → link về đúng đơn, không resolve trên đơn đang xem.
   Storage hỏng/không ghi/xóa được → khóa; không clear-on-logout/TTL.
7. Unmount/đổi phiên không acknowledge response cũ. Controller ổn định trong
   view; latch đồng bộ chặn double-click. PostgreSQL mới là bảo đảm đa request.

## File để đọc

| File | Trách nhiệm |
|---|---|
| `orderResolutionApi.ts` | Adapter và validator strict; proof gắn đúng lần gọi |
| `orderIntentJournal.ts` | Một pending/account/tab; không token/địa chỉ/receipt |
| `orderCommandCoordinator.ts` | Latch execute/resolve, so phiên và pending |
| `sellerOrderWorkflow.ts` | Store/detail freshness, confirmation, unknown, settlement, GET retry |
| `SellerOrderWorkspace.tsx` | Route QA nối controller ổn định, snapshot/confirmation/recovery |
| `SellerCommandReview` / `SellerResolutionReview` | Hai consent riêng; không callback thì disabled |
| `OrderReadPages.tsx` | Chỉ Seller detail opt-in, Buyer/list/default giữ nguyên |

`revision` tăng mỗi lần publish để panel không giữ latch cũ sau hủy rồi mở lại
hộp xác nhận. `outcome` chỉ là thông báo kết quả đã xác minh, không là OrderStatus.
`mounted` chặn settlement từ controller đã rời trang; không thay quyền server.

## Bằng chứng kiểm thử

- FE regression: **524 PASS / 6 opt-in live SKIP** (33 file PASS, 1 live file SKIP).
  Các unit/component test dùng mock HTTP, không cộng thành DB/browser proof.
- Lint PASS với 5 warning Admin nền; TypeScript/Vite build PASS, Backend build
  từ nền #67 PASS; diff-check và harness syntax check PASS.
- Chrome riêng → Nest HTTP thật → PostgreSQL QA loopback **5549**, DB có prefix
  `bckl_order_resolution_test_`. Không thao tác DB demo 5432. Workers Search,
  image repair và auto-complete tắt để cô lập C2; không đo health/Search runtime.

| Nhóm QA thật | Đối chiếu PostgreSQL | Kết quả |
|---|---|---|
| Desktop sáng: 3 bước, click hai lần | READY_TO_SHIP; 3 command, 4 history, 0 fence | PASS |
| Mobile 390px/dark: 3 bước | Như trên; không tràn ngang document | PASS |
| Server commit nhưng response bị bỏ; reload; resolver | Cùng key; 1 command, 0 fence; không execute mới | PASS |
| Request bị chặn trước server; CLOSED; intent mới | Trước: PENDING/0 command/1 fence; sau consent mới: 1 command | PASS |
| Command thành công rồi GET lỗi | Pending đã settle; chỉ GET retry; 1 command | PASS |
| Giữ response sau commit, logout/login Seller B rồi về A | B không thấy Product của A; mã A giữ đến resolver; 1 command | PASS |

Product/Variant (toàn hàng fixture), số stock movement và SearchOutbox giữ nguyên
so baseline **sau Checkout** trong toàn bộ C2/resolution. Không khẳng định mọi hàng
trong toàn DB không đổi. Các fixture được tạo riêng, 6 Order qua Cart/Checkout
API thật; chia hai Buyer để giữ quota mặc định, không nới rate limit cho test.
Lượt đầu bootstrap thất bại HTTP429 do một Buyer tạo quá nhiều Order; đó không
phải lỗi Seller. Đã tách actor và chạy lại đủ 6 nhóm PASS.

Harness `scripts/test-seller-command-browser.mjs` có assertion DB target, từ chối
dotenv override, tự đóng Chrome/server ở finally. Chỉ fault injection ở network:
abort trước gửi, bỏ response sau `route.fetch()` thật, giữ response, lỗi GET.
Không mock biên nhận HTTP200 thành công hoặc inject AuthContext trong browser.
Ảnh/results local ở `deliverables/seller-command-browser-2026-10-18/`; không
commit credentials/log/ảnh runtime. Đã xem ảnh desktop/mobile; không coi kiểm
tràn ngang hay ảnh là nghiệm thu toàn bộ UI/accessibility. Sticky-header capture
ở lượt đầu được sửa bằng scroll về đầu trước chụp, không sửa CSS nền trong task.

## Tái lập

1. Checkout nhánh, frozen install dependencies, generate/build BE. Cung cấp
   DATABASE_URL QA đúng prefix/5549 và JWT secrets chỉ cho QA qua môi trường.
   Không sao chép `.env` demo; migrate deploy chỉ trên DB QA được xác minh.
2. `pnpm --dir FE test`, `pnpm --dir FE lint`, `pnpm --dir FE build`.
3. `node scripts/test-seller-command-browser.mjs --playwright-module <absolute-playwright-index.mjs> --output <local-output-folder>`.
   Harness bật cờ QA riêng, Nest port ngẫu nhiên, FE loopback5193, Chrome headless.
   DB phải có schema #67; fixture giữ lại, không reset/delete fence.

## Chưa nghiệm thu

Chưa review độc lập head FE mới; cờ mặc định vẫn false. Chưa Buyer hủy/complete,
Seller hủy/confirm-returned, giao hàng/Admin UI hoặc toàn Checkout→completion.
Chưa mobile thiết bị thật, desktop dark/mobile light trong lượt này, WCAG,
Firefox/Safari, nhiều tab/thiết bị, OS crash hoặc mất/xóa sessionStorage bên ngoài.
6 live suite SKIP của nền không được đổi thành PASS từ 6 nhóm harness khác.
Không tự merge hoặc bật cờ trên môi trường dùng chung sau QA tác giả.
