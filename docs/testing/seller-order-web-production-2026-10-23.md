# Seller production Order route — 23/10/2026

## Bản kết hợp cuối sau #40

Nhận develop `33878fb` tại `55da0fa86a40e3327f1ccf4b4dea26671803a926`.
Merge sạch, Seller runtime không đổi; các route preview vẫn chỉ DEV.
**Full FE mới1151PASS/6liveSKIP**,58filesPASS/1SKIP,132.94s;
lint/typecheck/buildPASS450modules,5warningAdmin nền. Không cộng18preview
vào lượt1133 cũ để nhận đó là lượt full mới.

Gemini ArgonMedium đã đọc độc lập workflow+workspace đúng55da0fa, nêu hai
nguy cơ khi dùng component **không có wrapper**: closureAuth ban đầu và đổi
orderId không remount. Đối chiếu caller thực tế `OrderReadPage` đã có guard
active/role và key(sessionVersion,userId,scope,orderId,query). Không kết luận
đó là hai lỗi production đã tái lập hoặc đổi logic chỉ theo suy đoán model.

Thêm hai regression qua đúng AppRouter/Auth wrapper: pending ở Order20 rồi
click link từ19 phải GET/resolve đúng20 và key cũ; Auth inactive **không tăng
sessionVersion** vẫn unmount và không settle late receipt. **Workspace9/9PASS**
(gồm2case mới),3.92s; typecheckPASS. Các regression chứng minh ranh giới caller
hiện tại; không nhận component standalone an toàn nếu caller mới bỏ guard/key.
Hai test mới thêm sau full1151, không nhận đã chạy full1153 trong lượt đó.
Gemini staticreview không thay test hay humanapproval, không claim NO FINDING.

Nhánh `codex/seller-order-web-production` từ develop `081ce63`. Không nhận
#94/#97 đang review hoặc sửa Backend/Prisma/Auth để làm test xanh.

## Kiểm mới

- Hai regression mới: default-on vẫn GET-only trước consent; React StrictMode
  setup/cleanup/setup vẫn đọc được và chỉ POST sau một xác nhận. Kill-switch
  false giữ read-only, không GET Store hoặc POST.
- Targeted workflow/workspace/read routes: **56PASS/3files,19.65s**.
- Full FE: **1133PASS/6liveSKIP**,56filesPASS/1SKIP,244.06s; không cộng subset.
  Lint PASS với5warning Admin nền. Lượt typecheck đầu FAIL vì test mới dùng
  nhầm option `exact` của Playwright trong Testing Library. Đã bỏ option không
  tồn tại (name string vẫn exact), giữ nguyên assertions; TypeScript/Vite build
  PASS445modules và workspace7/7PASS sau sửa. Không gọi lượt build lỗi làPASS.
- Chrome thật **11/11 nhóm PASS**, Nest HTTP + PostgreSQL17 QA loopback5549,
  DB `bckl_order_resolution_test_seller_web_20261023_v922`. Không flag bật QA;
  driver xóa enable override, Vite envDir=false để kiểm default production.

| Chrome scenario | Oracle thực tế |
| --- | --- |
| Desktop1440/light, desktop1440/dark, mobile390/light, mobile390/dark | Mỗi Order READY_TO_SHIP,3command/4history/0fence; mỗi bước consent mới; doubleclick không nhân bản; không tràn ngang |
| Bỏ response sau server commit, reload, resolve | Key cũ giữ nguyên;1command/0fence |
| Abort trước server, CLOSED rồi ý định mới | Trước0command/1fence; sau consent mới đúng1command |
| Biên nhận đã biết nhưng GET lỗi | Chỉ GET retry;1command |
| Giữ response sau commit, đổi Seller rồi quay lại | Không lộ Product của Seller cũ; key giữ tới resolve;1command |
| Malformed realHTTP200 sau commit | Extra field bị reject, journal giữ nguyên, resolve trả receipt gốc |
| Real429 tại resolver | Retry-After42s; key không đổi; chờ hết hạn rồi xác nhận lại, vẫn1command |
| Deadline thật30s sau commit | Quan sát30481ms; giữ key và resolve đúng1command |

Trước/sau toàn bộ chuẩn bị/resolve, Product/Variant/stockMovement/outbox giữ
nguyên fingerprint sau Checkout. Catalog/actors là fixture DB có nhãn;10Order
được tạo qua Cart/Checkout HTTP thật, không mock biên nhận thành công. Ba Buyer
để giữ quota Checkout mặc định; không sửa quota hoặc xóa bucket của Seller.

## Lượt chưa đạt và nguyên nhân

- Lượt đầu driver không nạp được CJS Playwright bằng dynamic import; đổi sang
  `createRequire` cho module path đã cung cấp. Chưa tạo fixture trước lỗi đó.
- Hai lượt mở rộng dừng ở resolver429 sau20ingress/Seller. HTTP trace chứng
  minh đây là quota thật; không kết luận do HMR hoặc lỗi validator. Một lượt
  trước có formatter gây HMR nên không dùng làm bằng chứng cuối.
- Lượt cuối source đứng yên, không nới quota: kiểm thêm429/Retry-After và chạy
  trọn11nhóm, exit0. Fixture/log lỗi cũ giữ lại, không reset/drop/purge để che lỗi.

## Tái lập / giới hạn

`scripts/test-seller-command-browser.mjs` yêu cầu exactDBv922/5549, explicit
JWT QA secrets, explicit Playwright module/output. Refuse dotenv, khóa workers,
API/Vite loopback5193/portngẫu nhiên; finally đóng chỉ tiến trình nó tạo.
Local ignored evidence ở `artifacts/seller-order-web-qa-20261023/run1/`, marker
`seller-web-220deaf7-7593-4`: results.json +7PNG theo manifest. Không zip glob
cả folder vì ảnh failure lượt cũ còn ở đó; không gửi credentials/cookies/token.

Đã xem ảnh desktop/mobile sau thực thi; chưa screen-reader/physicalphone/Safari/
Firefox hoặc ảnh xác nhận riêng từng bước trong lượt này. Dark OS dùng theme
storefront sáng có chủ đích. Chưa Browser Address→Cart→Checkout trong cùng
driver, chưa đầy đủ giao/hoàn tất/hủy/hoàn kho, loaded Search hoặc production.
SessionStorage không chống mất tab; recovery unknown bị khóa là chủ đích.
Không nhận6liveSKIP làPASS hoặc hứa không có bug chưa phát hiện.
