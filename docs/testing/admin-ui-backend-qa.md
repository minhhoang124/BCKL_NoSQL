# Admin #28 — chuẩn bị QA Backend/PostgreSQL thật

> Cập nhật bàn giao 16/10: xem [tổng hợp QA trên source `abe4a14`](admin-ui-handoff-2026-10-16.md).
> Các mốc dưới đây là lịch sử/kế hoạch tại thời điểm ghi, không thay kết quả và giới hạn mới trong bản tổng hợp. Vẫn QA PARTIAL.

Ngày cập nhật: 15/10/2026. Trạng thái: **QA PARTIAL / chưa nghiệm thu G-ADMIN**.
Không dùng test mock hoặc health/OpenAPI để nhận Admin đã nghiệm thu.

## Lượt đồng bộ tiếp `541d15b` — 15/10/2026

Từ head `8eab9ef`, merge develop `541d15b` đã có #46/#47/#48 trên cùng nhánh
Admin. Phép diff trực tiếp với develop có vẻ xóa Admin vì develop chưa có UI
nhánh này; đã kiểm cây merge thử và hash blob trước khi thao tác: **toàn bộ FE
giữ nguyên**, gồm Admin/CSS/test/router/Address/Cart/Auth/client. Backend và
schema/migration sau merge **khớp develop**, không chọn bỏ controller/parser
hay sửa migration để giải conflict. Chỉ conflict tài liệu kiến trúc, giữ đủ
nội dung Admin và Order, ghi lại baseline lịch sử.

### Bằng chứng mới trên source kết hợp

- FE **132/132 test (16 file)**, full TypeScript/Vite build PASS. Lint exit0,
  vẫn5 warning set-state-in-effect nền ở Admin; không gọi warning-free.
- Backend **594/594 unit (25 suite)**, full TypeScript không incremental,
  lint/Nest build PASS. Generated Prisma client từ schema mới, không dùng client cũ.
- Full Backend **560/560 PostgreSQL E2E (28 suite) PASS**, migrate13→seed→test
  trên database **mới riêng** `bckl_hien_admin_sync541_20261015_e2e`. Không dùng
  manual QA/demo; script từ chối database E2E đã tồn tại, không reset/reuse rộng.
  Log ERROR fault injection có chủ đích không phải suite bị bỏ qua.
- DB manual Admin QA được nâng từ12 lên13 migration bằng migrate deploy:
  migration mới chỉ thêm bảng/index completion jobs. Snapshot trước/sau xác nhận
  dữ liệu Product/Store/User(role/active)/Order/outbox/movement được kiểm không đổi:
  57 Product,6 Store,0 Order. Không gọi là mọi cột trong DB đã được so sánh.
- Backend build mới đã chạy lại tại cổng QA cũ; Search/reconciliation/image
  repair/auto-complete workers đều tắt. Không tự complete Order hoặc dispatch AI.
- API/DB read smoke PASS: health connected, Guest401, Buyer/Seller403 trên các
  API Admin, AdminA/B đọc queue/Product/Store/catalog khớp DB. Snapshot nghiệp vụ
  trước/sau không đổi; login có tạo refresh-session records, không gọi là DB zero-write.
- Browser reload Store: Store5 ACTIVE, Store6 REJECTED/history2; Product11 detail
  FROZENv7/reason/history vẫn đúng. Tổng quan hiển thị45 Product/0 Store chờ duyệt,
  catalog tải4 Category/2 Brand. Đây là ca đọc lại, không chạy lại quyết định cũ.
- Browser logout→reload→mở thẳng `/admin`: màn login, không Admin shell/data.
  Login lại AdminA thành công và tổng quan tải đúng. Có ảnh local, không trace
  HTTP đầy đủ nên không khẳng định mã HTTP của lượt browser chỉ từ UI.

E2E bắt đầu19:37 và kết thúc19:40 ngày15/10/2026 (Asia/Saigon); source tree
trước bổ sung báo cáo `2a8c568e7fad35bf3c3be842b256ed50cac2e54f`. Bản commit
bàn giao chỉ thêm giải conflict/report Markdown ngoài source merge đã kiểm.
Ảnh/JSON/log/config/credential QA giữ local, không commit hoặc upload GitHub.
CI head sau push phải kiểm riêng, không lấy CI develop hoặc PR Order thay thế.

### Giới hạn của lượt này

Các ca Product approve/reject/freeze, Hủy confirm12 và Store writes ở mục dưới
thực chạy trên `1260a47`/nền2ed3ee5, không tự đổi thành mutation PASS trên541d15b.
FE không đổi là bằng chứng không mất UI, không thay việc chạy mọi luồng browser.
Hai phiên Admin độc lập, network recovery, double-submit, access/refresh expiry,
browser RBAC đủ actor/routes, catalog CRUD/validation/false0/options,
keyboard/screenreader/mobile/dark đầy đủ chưa retest trên541d15b. E2E có mock
Search boundary; không phải FastAPI–ES–FAISS, Checkout/Order Web hay G-FULFILMENT.
Giữ Draft/G-ADMIN PARTIAL; Hoàng quyết định phạm vi nghiệm thu, không tự merge.

## Lịch sử hồi quy nền `2ed3ee5` — 15/10/2026

Merge `develop 2ed3ee5` (đã có #42/#43/#44) vào cùng nhánh Admin thành
commit `1260a47`, từ
head PR `7f94f03`. Chỉ conflict tài liệu kiến trúc; đã giữ cả Admin và Order,
phân biệt bằng chứng cũ/mới. Router giữ Admin shell riêng, thêm Cart từ develop
và giữ Address/Account/Seller. Tại baseline QA này không ghép #46/#54/#55.

Admin source/CSS/test không đổi so với head trước. Address/Cart/Auth/apiClient
khớp develop; không đổi API/schema/migration/theme để giải conflict.

### Kiểm tra thực chạy trên source kết hợp

- FE **132/132 test, 16 file PASS**; full TypeScript, Vite build PASS.
- FE lint exit 0, còn **5 warning set-state-in-effect có sẵn** ở Admin.
- Backend **458/458 unit, 22 suite PASS**; full TypeScript, lint, Nest build PASS.
- Diff whitespace PASS. CI head bàn giao phải kiểm riêng sau push, chưa nhận xanh.
- Build Backend mới đã được khởi động trên cổng QA cũ, PostgreSQL riêng giữ nguyên
  fixture và 12 migration, không reset/seed lại dữ liệu nghiệp vụ.
- API/DB read smoke PASS: health connected; guest 401; Buyer/Seller 403 cho queue,
  detail Product10, Store, Category, Brand. Admin A/B GET queue/catalog/Store và
  Product5/6/10/11 trả 200; version/status khớp PostgreSQL, queue khớp số PENDING.
- Snapshot nghiệp vụ trước/sau read smoke giống nhau; Product10 vẫn APPROVED v6,
  đúng một history do B. Login kiểm thử tạo refresh-session record, không gọi là
  toàn bộ DB không có write. Không gửi lại approve/reject/freeze để tạo bằng chứng.
- Harness đầu kỳ vọng login201 sai; sửa thành HTTP200 theo contract và chạy lại
  PASS, không sửa Backend hoặc bỏ test để đạt.

### Browser hồi quy bổ sung trên đúng `1260a47`

Ban đầu công cụ bị chặn hạn mức; sau khi phục hồi đã tiếp tục QA bằng trình
duyệt app và Hiền phối hợp xử lý hộp xác nhận. Không bỏ giới hạn cũ rồi gọi tất
cả ca browser PASS. Chỉ các ca sau có bằng chứng mới:

| Ca | UI và DB đã đối chiếu | Kết quả/phạm vi |
|---|---|---|
| Approve Product11 | PENDINGv5→APPROVEDv6, một history Admin A; Hiền xác nhận mở lại không còn Duyệt | PASS local có người dùng phối hợp; không capture bước accept |
| Hủy confirm Product12 | Hiền bấm Hủy; DB trước/sau PENDINGv5, history rỗng | PASS không lưu quyết định; chưa có network trace để nhận không gửi HTTP |
| Reject Product12 | PENDINGv5→REJECTEDv6, một history Admin A, lý do QA đúng; trợ lý mở lại detail thấy reason/history, nút quyết định disabled | PASS kết quả UI/DB, có ảnh local |
| Freeze Product11 | APPROVEDv6→FROZENv7, thêm đúng một history Admin A với reason, giữ history duyệt; detail khóa quyết định | PASS kết quả UI/DB, có ảnh local |
| Store thiếu reason | Store2 báo yêu cầu lý do tối thiểu 3 ký tự | PASS validation UI, không suy thành mọi validation đã đạt |
| Store suspend/reactivate | Store2 ACTIVE→SUSPENDED→ACTIVE; history6→7→8, hai lý do khớp, lịch sử cũ giữ nguyên; UI mở history đối chiếu | PASS kết quả UI/DB |
| Store PENDING approve | Store5 mới tạo qua API Seller, PENDING→ACTIVE; history1→2, đúng reason, UI khớp | PASS kết quả UI/DB |
| Store PENDING reject | Store6 riêng, PENDING→REJECTED; history1→2, đúng reason; UI hiển thị chờ Seller sửa/nộp lại, không còn nút duyệt/từ chối | PASS kết quả UI/DB; accept confirm do Hiền xác nhận |

Native confirm khiến thao tác công cụ timeout và API dialog không expose; không
nhận trợ lý tự accept hoặc dùng SQL/API mutation thay UI. Khi timeout luôn đọc
DB trước, không click/gửi lại để tạo quyết định trùng. Có capture kết quả sau
mutation, nhưng thiếu trace HTTP và capture accept đầy đủ, nên không nhận
double-submit/race/recovery đã được kiểm lại chỉ từ một history.

Store5/6 được tạo bằng đăng ký Seller/mở Store thật trên DB QA riêng; không nâng
quyền account cũ hoặc viết trực tiếp trạng thái. Credential và ảnh Store có email
fixture chỉ giữ local, không đưa lên GitHub. Harness đối chiếu history lượt đầu
so Date với ISO string sai; đã chuẩn hóa JSON rồi chạy lại, không sửa ứng dụng/DB.

### Giới hạn còn mở và nền tích hợp mới

Chưa retest đầy đủ browser logout/refresh expiry, hai Admin ở hai phiên độc lập,
lỗi mạng/recovery, RBAC đủ actor/routes, catalog CRUD/validation, false/0/options,
double-submit, keyboard/screenreader và desktop/mobile/dark trên bản kết hợp này.

QA browser ngày 12–15/10 trước sync (Backend nền41450b4), gồm Product10 xung đột
hai Admin do Hiền phối hợp, chỉ là bằng chứng lịch sử. Không chuyển nguyên các ca
đó sang PASS cho source mới. Full PostgreSQL E2E trên source kết hợp cũng NOT_RUN;
không chạy bộ E2E có cleanup/reset trên DB manual QA đang dùng. CI #44 không thay
CI của nhánh Admin. Search workers tắt, không chứng minh index/Checkout/Order Web.

**Kiểm remote khi bàn giao:** develop đã tiến tới `541d15b`, thêm #46/#47/#48
qua các merge `11a0da7`/`5d17d4f`/`541d15b`. Bản QA `1260a47` chỉ chứa nền
`2ed3ee5`, không tự đổi nhãn bằng chứng sang develop mới nhất. Merge-tree chỉ
ra content conflict ở `docs/architecture/system-architecture-overview.md`;
chưa merge nền mới vào Admin trong lượt bàn giao này. Cần đồng bộ trên cùng
nhánh và chạy lại kiểm tra phù hợp, không dùng CI của từng PR Order thay bản
Admin sau đồng bộ. Commit bổ sung báo cáo chỉ thay Markdown, source QA giữ nguyên.

Phạm vi vẫn hàng chờ/chi tiết/duyệt Product, Store và Category/Brand. Account UI,
hậu mãi, attribute editor và dashboard doanh thu/health vẫn chưa hoàn tất.
Giữ Draft/G-ADMIN PARTIAL, Hoàng quyết định nghiệm thu sau review và hồi quy mới.

## Bằng chứng lịch sử trước đồng bộ (không thay lượt hồi quy trên)

## Kết quả mới nhất — 12/10/2026

### Lượt tiếp tục QA trên head `89860c7` — 12/10/2026

- Giữ nguyên source head `89860c7`; không sửa Admin/Address/Cart ở lượt này.
- Tạo **53 Product PENDING hợp lệ #5–57, version 5** qua API Seller trên
  PostgreSQL QA riêng, có ảnh thật/variant/shipping; không seed trạng thái PENDING
  trực tiếp để vượt validation. Giữ fixture để tiếp tục, không cleanup dữ liệu.
- **Pagination browser PASS:** trang đầu có 50 ID #5–54; bấm “Tải thêm” có
  đủ 53 ID #5–57 theo thứ tự, không trùng; hết cursor thì không còn nút tải thêm.
  Log HTTP xác nhận `limit=50`, request kế tiếp `afterId=54`, response 200.
- **Ca hủy confirm BLOCKED:** mở approve #5 nhưng công cụ click timeout,
  API đọc dialog không trả dialog khả dụng; lần xử lý tiếp có lỗi giới hạn
  approval service, retry vẫn không điều khiển được dialog. Không bypass kiểm
  tra approval hoặc ghi nhận thao tác hủy đã thành công.
- Đối chiếu PostgreSQL sau đó: #5 vẫn PENDING v5, history rỗng; log không có
  POST approve/reject/freeze cho #5. Đây là bằng chứng không có quyết định ghi,
  **không đủ chứng minh người dùng hủy confirm thành công**.
- Tab mới đọc được dữ liệu nhưng các click phục hồi không tạo HTTP request/
  không chuyển route. Đã thử API dialog, tab mới, Escape và reload; chưa khôi
  phục được thao tác tin cậy. Không kết luận đây là lỗi nghiệp vụ Admin từ lỗi tool.
- Proxy loopback QA có hỗ trợ delay/drop-after-write/GET503, chuyển tiếp tới
  Backend thật, chỉ log method/path/status, không log token/password/body.
  Chưa thực thi được ca drop/double-submit/reload-after-write từ browser nên
  chúng vẫn NOT_RUN. Một GET503 thử nghiệm trên lúc reload không đủ chứng minh
  UI lỗi/phục hồi do effect đọc lần sau thành công; không tính ca này PASS.
- Đã tắt proxy và khôi phục FE kết nối trực tiếp Backend QA. Credential, launcher,
  fault mode, request log và snapshot DB chỉ lưu local, không commit.

**Cần thao tác thủ công để gỡ chặn:** kiểm tra/đóng hộp xác nhận trên tab QA
hoặc mở trình duyệt QA hoạt động bình thường; sau đó chạy tiếp ADM-05–10,
quyền Buyer/Seller trên browser, refresh expiry, catalog validation/cycle và
route race. Không cần chờ Backend mới của Hoàng, nhưng hiện chưa đủ bằng chứng
để đóng các ca này hoặc nâng PR #28/G-ADMIN thành hoàn tất.

Đồng bộ thêm `origin/develop 41450b428a30317dfcf74785dcc11c9a2286909a`
(client readiness #53), trên nhánh Admin hiện có. Giữ nguyên Address đã merge;
không lấy Cart #50/Checkout #54 chưa merge, không sửa Auth/API/schema/global theme.
Các mục 1–6 dưới đây giữ làm lịch sử chuẩn bị ngày 11/10; bảng này thay trạng thái
NOT_RUN toàn bộ của lượt chuẩn bị đó, không dùng kết quả cũ xác nhận bản mới.

### Sửa trong phạm vi Admin

- Xóa dữ liệu màn cũ khi đổi Admin hoặc Product ID; bỏ phản hồi quyết định đã
  lỗi thời để không điều hướng/toast lên hồ sơ mới.
- Store: chặn gửi lại khi kết quả ghi chưa rõ, chỉ mở lại quyết định sau GET
  thành công; không cho refresh trong lúc đang ghi. Giữ lý do để đối chiếu.
- `color-scheme: light` chỉ trên Admin shell; chữ/form đúng nền sáng ngay khi
  trình duyệt dùng dark preference, không đổi theme Address/Cart.
- Mô tả đúng API khóa/mở account đã có nhưng danh sách/UI chưa có; hậu mãi,
  attribute editor, doanh thu/health vẫn ngoài đợt nghiệm thu này.

### Kiểm tra tự động trên bản sửa cuối

- FE **85/85 test, 11 file PASS** (gồm test Address/Auth/client nền đã merge).
- Typecheck + production build PASS.
- Lint exit 0, **5 warning có sẵn** `react(set-state-in-effect)` tại các effect
  tải dữ liệu Admin; không gọi là lint sạch warning.
- Lượt test sandbox bị EPERM ở cache tạm chưa chạy được test; chạy lại ngoài
  hạn chế sandbox cho kết quả 85 PASS, không bỏ qua lỗi test ứng dụng.

### Môi trường QA riêng, không dùng database Address/Cart hoặc demo

- Backend từ nền `41450b4`, không sửa code Backend; build PASS, **12 migration**
  deploy hoàn tất trên PostgreSQL 17 riêng, chỉ bind loopback.
- Admin A/B là account QA mới bootstrap trực tiếp DB; Buyer/Seller đăng ký qua
  API thật. Không nâng quyền account có sẵn. Credential/config/upload giữ local,
  không đưa vào repository hoặc ảnh bàn giao công khai.
- Baseline: Store ACTIVE #1, Store PENDING #2; Product PENDING #1–4,
  version 5, mỗi Product có ảnh PNG thật 640×640, variant, stock, shipping.
  Store/Product/catalog được tạo qua API nghiệp vụ thật.
- Search/reconciliation/image repair/order auto complete tắt: không nhận Search
  index/AI hoặc Checkout end-to-end đã PASS.

### Bằng chứng và giới hạn

| Ca | Kết quả đã quan sát | Phân loại |
|---|---|---|
| ADM-01 | HTTP guest 401, Buyer/Seller 403 trên queue Admin | API PASS; browser cả ba actor NOT_RUN |
| ADM-02 | Guest bị chuyển login; Admin A login thật và reload giữ phiên | Browser PASS phần login/reload; logout/refresh expiry NOT_RUN |
| ADM-03 | Overview/queue đọc đúng 4 Product, 1 Store PENDING baseline; sau quyết định overview trả 0/0 | Browser + API PASS trong fixture nhỏ; pagination >50 NOT_RUN |
| ADM-04 | Product #1 hiển thị đúng tên, ảnh, Store, variant/price/stock/shipping/version 5 | Browser PASS phần fixture có; false/0/options chỉ unit test, chưa có fixture thật |
| ADM-05 | Bấm approve #1 từ browser; công cụ timeout, PostgreSQL xác nhận APPROVED v6, đúng 1 history duyệt | DB PASS; màn kết quả sau click chưa xác nhận, browser acceptance PARTIAL |
| ADM-06 | API reject #2: REJECTED v6, đúng reason/history; approve #4 v6 rồi freeze v7/FROZEN | API + DB PASS; reject/freeze từ browser NOT_RUN |
| ADM-07 | Chặn double submit/hủy confirm bằng unit test | Browser NOT_RUN |
| ADM-08 | Admin B approve #3 v5→6; Admin A gửi v5 nhận 409, chỉ thêm 1 history | API + DB PASS; browser lock/reload chỉ unit test |
| ADM-09 | Store write lỗi mạng bắt buộc GET trước quyết định tiếp, không tự resend, giữ reason | Unit PASS; lỗi mạng thật browser NOT_RUN |
| ADM-10 | Store #2 PENDING→ACTIVE→SUSPENDED→ACTIVE; thêm đúng 3 history; UI tải lại ACTIVE | API + DB PASS, browser read PASS; browser mutation NOT_RUN |
| ADM-11/12 | Tạo/sửa/tắt Category #3, tạo/tắt Brand #2; DB khớp. Tạo Category `qa-browser-20261012` từ UI mobile thành công, cây cập nhật 3→4 | API + DB PASS cho fixture API; browser create PASS; duplicate/cycle/toggle UI NOT_RUN |
| ADM-13 | Unit chặn inactive Admin và xóa dữ liệu khi đổi Admin | Unit PASS; route race/network thật NOT_RUN |
| ADM-14 | Desktop overview/detail/catalog; mobile overview/Store/catalog 390×844; dark preference true, chữ/form nền sáng rõ | PASS các màn đã quan sát; chưa kiểm mọi dialog/route/breakpoint |
| ADM-15 | Placeholder account/hậu mãi nói rõ thiếu UI, không dữ liệu giả | PASS mô tả, không phải chức năng hoàn tất |

Harness API ban đầu có kỳ vọng HTTP sai (201 thay vì 200, approve thừa reason
bị DTO từ chối 400); đã sửa harness theo controller hiện hành, không sửa Backend.
Đối chiếu DB trước khi tiếp tục, không gửi lại quyết định đã thành công.
Lượt approve browser timeout cũng được xử lý theo nguyên tắc này.

Bằng chứng local ngày 12/10 gồm baseline, báo cáo HTTP/DB đã loại secret và ảnh
desktop/mobile. Chúng thuộc máy Hiền, không phải server/tài khoản bàn giao cho Hoàng.
Chưa công bố nghiệm thu toàn bộ: PR #28 giữ Draft, cần Hoàng review head mới và
chạy các ca browser ghi, conflict/recovery, quyền và pagination còn thiếu.

## 1. Bản nguồn và kiểm tra sau đồng bộ

- Nhánh `feat/hien/admin-ui-orange-v1`, head trước đồng bộ `1d0da23`.
- Merge local `152ebb78b39e1e0e74a2afd629915b2051212b5e` lấy `develop dc52d92`
  (Address #49 và Auth #52 đã merge). Không lấy Cart #50 hoặc feature Order chưa merge.
- Router giữ Admin shell riêng tại `/admin/*`, guard ADMIN, các route public,
  Account, Address và Seller của develop. Chưa có route Cart trong develop này.
- Kết quả mới: FE 75/75 test (11 file) PASS; build/typecheck PASS;
  lint exit 0 với 5 warning `react(set-state-in-effect)` có sẵn ở Admin;
  diff whitespace PASS. Không gọi lint là sạch warning.
- Đây là đồng bộ source, không sửa API/schema/migration/Auth/global CSS.
  Merge local chưa push và tài liệu này chưa commit tại lượt chuẩn bị.

## 2. Căn cứ và phạm vi nghiệm thu

- [Phân công](../project/work-assignment.md): Hiền code Admin, Hoàng review API/tích hợp.
- [Phạm vi/Definition of Done](../project/implementation-scope.md).
- [Product domain](../architecture/product-domain-design.md),
  [Product moderation contract](../api/product-moderation-public-api.md).
- Backend controller/DTO hiện hành: `AdminProductController`,
  `AdminStoreController`, `AdminCatalogController`; code và migration đã merge
  quyết định tính sẵn có, không lấy nhãn IN_PROGRESS lịch sử trong contract làm trạng thái mới.
- Frontend: `AdminDashboardPage.tsx`, `.module.css` và test cùng tên.

Nghiệm thu đợt này chỉ gồm tổng quan hàng chờ, duyệt Product, xét Store,
Category/Brand. Không tự triển khai User list, hậu mãi, định nghĩa thuộc tính,
doanh thu hoặc health Search dashboard trong task chuẩn bị này.

**Khoảng trống cần mô tả đúng:** Backend đã có PATCH
`/admin/accounts/:userId/status`, nhưng chưa thấy GET danh sách tài khoản.
UI accounts vẫn thiếu; nhãn chung “chưa có API” ở trang placeholder quá rộng.
API tạo/sửa Category attribute cũng đã có nhưng UI attribute chưa triển khai.
Không đổi API/schema để hợp thức hóa khoảng trống UI.

## 3. Kiểm tra môi trường thật đã thực hiện

Backend QA riêng PR #51 tại `e15af44`:

- GET `/health`: `status=ok`, `database=connected`.
- GET `/docs-json`: có đủ GET hàng chờ/detail Product; POST approve/reject/freeze;
  GET Store/PATCH status; GET/POST/PATCH Category/Brand và API attribute.
- GET `/admin/products/review-queue` không token: HTTP 401.
- Đối chiếu PostgreSQL chỉ đọc: 2 USER, 2 SELLER, **0 ADMIN**;
  2 Store ACTIVE, **0 Store PENDING**; 4 Product APPROVED và
  1 NOT_SUBMITTED, **0 Product PENDING**.

Kết luận: API nền có thể truy cập, nhưng fixture hiện tại **chưa đủ** cho
nghiệm thu Admin. Không dùng kết quả này như Admin login/CRUD PASS.
Không nâng Buyer/Seller hiện có thành Admin hoặc thay trạng thái catalog
Address/Cart để tiện test.

## 4. Chuẩn bị môi trường độc lập

1. Dùng checkout Backend có commit được ghi rõ, PostgreSQL local riêng cho
   Admin, tên gợi ý `bckl_hien_admin_20261011_local`; không database demo,
   không DB E2E có hook reset và không clone dữ liệu thật.
2. API/Frontend dùng cổng riêng đã kiểm tra trống, ví dụ 3012/5176;
   bind API `127.0.0.1`, CORS đúng origin FE. localhost thuộc máy đang chạy.
3. Migrate deploy từ đúng Backend checkout; ghi số migration/trạng thái.
   Không chạy migrate reset hoặc sửa migration cũ.
4. Tắt Search Sync/Reconciliation/Image Repair/Order Auto Complete;
   AI không trỏ index dùng chung. Ghi nhận outbox/job trong DB nhưng không nhận
   Search end-to-end khi worker tắt.
5. Tạo credentials/JWT riêng; giữ trong file bị Git ignore, không đưa vào
   PR/log/ảnh. Không dùng tài khoản demo mặc định trên dịch vụ công khai.
6. Chuẩn bị fixture bằng API Seller/Store đã merge để có audit hợp lệ.
   Nếu bootstrap role/Admin qua script QA thì chỉ tạo account mới trong
   DB riêng, không nâng quyền email đã tồn tại. Ghi rõ phần bootstrap trực tiếp DB.
7. Start Backend/FE, kiểm health/login/me/refresh và API Admin trước UI.
   Không dùng `test:e2e` reset dữ liệu trên DB manual QA này.

### Fixture tối thiểu

| Nhóm | Cần chuẩn bị | Mục đích |
|---|---|---|
| Account | Admin A, Admin B, Buyer, Seller active; account bị khóa riêng | RBAC, 401/403, cạnh tranh hai Admin |
| Store | Hai Seller sở hữu hai Store; PENDING, ACTIVE, REJECTED/SUSPENDED | Duyệt/từ chối/tạm khóa, history/reason |
| Catalog | Cây cha–lá active; node inactive; Brand active/inactive, slug duy nhất | Cây, validation, soft disable và public eligibility |
| Product | Ít nhất 3 PENDING độc lập và 1 APPROVED hợp lệ | Approve/reject, version conflict, freeze không dùng lại fixture đã chuyển state |
| Nội dung | Ảnh chính/file thật trong upload root riêng, Variant, option, attribute false/0, kiện hàng | Đối chiếu UI với response đầy đủ, không dùng ảnh riêng tư |
| Pagination | Hơn limit hàng PENDING nếu test tải thêm | Kiểm nextCursor/thứ tự/không lặp ID; nếu chưa có giữ NOT_RUN |

Chụp baseline ID/version/status/counts trước mỗi ca ghi. Mọi fixture gắn marker
của lượt QA. Không cleanup tự động các bản ghi không chứng minh thuộc marker;
ưu tiên giữ DB để đối chiếu và lên kế hoạch dọn riêng.

## 5. Checklist thực thi

Tất cả ca dưới đây **NOT_RUN trên browser + Backend thật** tại lượt chuẩn bị.

| ID | Thao tác | Kết quả cần kiểm và bằng chứng |
|---|---|---|
| ADM-01 | Guest/Buyer/Seller mở `/admin` và gọi API Admin | Không vào được Admin; HTTP 401/403 đúng actor, không mutation |
| ADM-02 | Admin login, reload/refresh, logout | Đúng account/role; Admin shell riêng, không lẫn storefront; ghi commit và HTTP |
| ADM-03 | Tổng quan + hàng chờ | Số liệu từ response thật; hơn 50 không gọi là tổng chính xác; empty không giả zero khi lỗi |
| ADM-04 | Mở chi tiết Product | Tên, Store, version, ảnh, mọi SKU/options/attribute/shipping khớp GET; false/0 không mất |
| ADM-05 | Approve Product hợp lệ | Gửi version đã xem; PENDING→APPROVED, tăng version/history một lần, danh sách cập nhật |
| ADM-06 | Reject/freeze với reason rỗng/hợp lệ | Chặn reason sai; reject chỉ PENDING, freeze chỉ APPROVED; reason lưu đúng |
| ADM-07 | Hủy hộp xác nhận/double click | Hủy không gửi request; đang pending không gửi trùng |
| ADM-08 | Hai Admin xem cùng version, A quyết định trước B | B nhận 409; buộc tải lại trước quyết định tiếp, không tự lấy version mới để duyệt |
| ADM-09 | Lỗi mạng hoặc reload lỗi sau write | Không tự resend; phân biệt đã lưu nhưng reload lỗi với chưa rõ kết quả; đối chiếu DB/history |
| ADM-10 | Duyệt/từ chối/tạm khóa Store | PATCH đúng status/reason; UI/history/DB đồng bộ; kiểm policy và không bấm hai lần |
| ADM-11 | Tạo/sửa Category, cha–lá, slug trùng/cycle | Validation/error giữ form; cây tải lại đúng, lỗi không ghi thành công giả |
| ADM-12 | Tạo Brand, bật/tắt Category/Brand | Trạng thái API/DB đúng; ghi reconciliation job, không nhận index đã đồng bộ |
| ADM-13 | Tải lỗi rồi thử lại/chuyển route nhanh | Loading/empty/error rõ, response cũ không đè màn mới |
| ADM-14 | Desktop/mobile + dark browser | Chữ/nền, sidebar, bảng/form/dialog; không overflow, nút dùng được; lưu ảnh mới đúng head |
| ADM-15 | Account/returns/attribute chưa triển khai | Ghi TARGET/thiếu UI chính xác; không mock để báo DONE |

Các ca lỗi mạng/double-submit cần công cụ quan sát được hỗ trợ hoặc harness
riêng có ghi phương pháp. Không gọi test unit mock là bằng chứng HTTP browser.
Sai quyền, sai status/version, duplicate history hoặc mất dữ liệu là blocker.

## 6. Mẫu ghi kết quả và gate

Mỗi ca ghi: test ID; FE/BE commit; DB marker; actor (không mật khẩu/token);
fixture ID/version trước–sau; thao tác; HTTP status; expected/actual;
PASS/FAIL/NOT_RUN/BLOCKED; ảnh/log đã loại dữ liệu nhạy cảm; bug và bước tái lập.

Chỉ nâng trạng thái nghiệm thu sau khi fixture/migration sẵn sàng, kiểm browser
với API thật và đối chiếu PostgreSQL cho các ca trọng yếu. Approval/CI và test
local không thay toàn bộ runtime acceptance. PR #28 tiếp tục Draft;
Hoàng review và quyết định merge, agent không tự merge.
