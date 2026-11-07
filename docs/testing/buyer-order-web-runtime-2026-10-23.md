# Buyer Order production route — 23/10/2026

Nền `023ce96` đã merge95/96. PR này nối `/account/orders/:orderId`, không dùng
entry `FE/qa` thay route thật. Không Backend/schema/Auth/address/cart/admin mới.
Kill switch build `VITE_BUYER_ORDER_COMMANDS_ENABLED=false` chỉ quay UI về read-only.

## Kiểm chứng hiện có

- **42 test mới**:29controller +13route/component, real merged runtime/journal/
  adapter/validator, HTTP mock có nhãn.22read-only fallback regression cũng đạt.
- Full FE cuối: **1131PASS/6liveSKIP**,56filesPASS/1SKIP,113.23s, trên source
  cuối có bố cục mobile/stale label/tap targets. Targeted42PASS nằm trong tổng,
  không cộng thêm. Production build444modules, không entryQA.
- Lint/typecheck/build:PASS, chỉ5warning Admin nền. Lỗi TS ban đầu của test dùng
  `exact` (thuộc Playwright, không thuộc Testing Library) đã sửa bằng matcher
  role/name đúng type; không đổi assertion nghiệp vụ để làm xanh.
- Fresh QA database v916:17migrations/generate/Nest buildPASS. Dotenv injected0;
  launcher kiểm role/target trước bootstrap; không DB demo hoặc schema reset.

## Chrome thật / PostgreSQL

Chrome155.0.8059.85 headless, context/profile riêng, không profile cá nhân.
Đăng nhập/refresh/logout thực, route `/account/orders/:id`, Nest port tạm và
PostgreSQL loopback5549. Catalog/actor là fixture tổng hợp; Checkout và
Seller/Admin chuẩn bị đơn qua HTTP thật. Hai Variant cùng Product,2đơn vị mỗi
Variant, stock2→0 khi Checkout, tổng40000.00. Ảnh chỉ URL metadata, không upload.

| Nhóm scenario | Oracle |
| --- | --- |
| Desktop1440×1000/mobile390×844 × light/dark OS × cancel/complete (8) | Consent/reason đầy đủ; hai DOMclick cùng tick chỉ một POST |
| Mất response sau real commit rồi reload cancel/complete (2) | Key cũ giữ qua cookie refresh, không autoPOST; resolver receipt gốc, một lệnh |
| COMMITTED nhưng GET lỗi cancel/complete (2) | Chỉ GET retry, không execute/resolve mới, pending đã settle |
| CLOSED trước execution (1) | Chỉ một fence; Order/Payment/kho/version/outbox/history bất biến |
| CLOSED rồi ý định mới xác nhận riêng (1) | Key mới khác, chỉ một cancel và mỗi dòng hoàn đúng một lần; fence cũ giữ nguyên |
| Account switch khi giữ response đã commit (1) | B không thấy Order A; pending A giữ; A đăng nhập lại và resolve đúng key |
| Seller confirm sau GET Buyer, trước submit (1) | Buyer409 không tự coi rollback; resolve CLOSED, đơn CONFIRMED, không hoàn kho |
| Chrome storage quota trước POST (1) | Bị khóa trước khi gửi,0command/fence/mutation |
| Malformed real HTTP200 sau commit (1) | Extra field bị reject, giữ pending, resolver xác minh lệnh gốc |
| Timeout thực30giây sau commit (1) | Giữ key khi AbortSignal deadline; resolve sau đó không hoàn kho lần hai |

Tổng **19/19 PASS trên source cuối**, marker `buyer-web-b3b9282c-1d5`,32PNG.
Timeout thực đo **30069ms**; key gốc được resolve, không hoàn kho lần hai.
Đã xem ảnh desktop/mobile, confirmation/pending/GET-error và sửa bố cục nêu
dưới. Không cộng14ca entryQA cũ hoặc các lượt lặp vào19.

Driver snapshot trước/sau: status/total Order, Payment status/amount, hai stock,
Product.version, outbox/history/restore/BuyerCommand/BuyerResolution count.
Cancel: restore2dòng nhưng version/outbox/history/command mỗi loại+1. Complete:
history/command+1, kho/Payment/version/outbox giữ nguyên. Không xóa fixture.
Proxy chỉ giữ/abort/biến dạng response sau real server commit; không giả200
thành công giữa FE và BE. `pageerror` được kiểm; mọi ảnh kiểm tràn ngang và
các nút workspace tối thiểu44px. Mobile là viewport emulation, không máy thật.

## Phát hiện trong triển khai và sửa

- Controller mới sau CLOSED phải tạo runtime mới **sau fresh GET** mới cho ý
  định mới; không reuse runtime đã latch settled. Có unit/route/browser riêng.
- CSS mobile `.page label` ép recovery consent thành grid: workspace override
  riêng label có checkbox thành flex, tap target44px; không sửa Address/Cart.
- GET lỗi sau receipt: dữ liệu đã đọc được giữ nhưng gắn nhãn stale rõ ràng,
  không trình bày Order/Payment cũ như trạng thái mới hoặc mở execute.
- ReactStrictMode: mỗi mounted epoch có runtime mới, dispose khi cleanup;
  old GET/finally không publish hoặc mở khóa job của epoch mới.

Gemini ArgonMedium kiểm tĩnh hai file controller/workspace tại4a81541:
NO FINDING trong phạm vi epoch/job/session/readKey/CLOSED/GET-error/consent.
Không chạy test hoặc đọc lại các dependency đã merge; không human approval.
Hai file này nguyên byte sau review; delta cuối chỉ CSS nowrap và assertion
Chrome để checkbox luôn cạnh nội dung. Full1131tests là cùng source chức năng;
delta CSS cuối đã chạy lại19Chrome và lint, không cộng các lượt lặp vào tổng.

## Tái lập / an toàn

Đọc AGENTS/tài liệu trước; checkout riêng, frozen install, không .env local.
Chuẩn bị database **bckl_order_resolution_test_buyer_web_20261023_v916** mới
trên127.0.0.1:5549 bằng role QA không superuser/createrole, deploy17migrations,
generate/build. Không dùng DB demo/QA đồng đội hoặc xóa database đã có.
Truyền URL/JWT secret qua environment private; Vite `envDir:false` không đọc
dotenv. Sau đó từ checkout chạy:

```powershell
node scripts/test-buyer-order-web-browser.mjs --playwright-module <absolute-playwright-index.js> --output <absolute-evidence-directory>
```

Ảnh/JSON/HTML local ở `artifacts/buyer-order-web-qa-20261023/run1`; không
commit credentials/tokens/cookie/profile/ảnh runtime. Không test code/schema
remote động. Launcher local allowlist riêngv916, demo phải stopped.
Driver còn dependency warningpg query bận; không nhận đã sửa warning này.

## Còn ngoài phạm vi

FullBE E2E/AI chưa chạy mới cho PR FE này; có real API/DB browser scenarios,
không thay các suite kia. Chưa full Address→Cart→Checkout→Seller→delivery qua
toàn bộ Web, loadedSearch/FAISS, notification, Review hoặc hậu mãi. DarkOS giữ
storefront sáng theo mẫu, không claim full dark theme. Historical409/409 vẫn
OPEN; PR98 là cải thiện test có bằng chứng riêng, không tự đóng lịch sử.
