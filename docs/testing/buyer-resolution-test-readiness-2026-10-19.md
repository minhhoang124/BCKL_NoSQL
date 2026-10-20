# Buyer recovery: audit guard và chuẩn bị kiểm thử — 19/10/2026

**TEST PREPARATION, chưa migration/API Buyer.** Baseline develop `bd45b54`
sau #68 và #61; nhánh riêng `codex/buyer-resolution-test-preparation`.
Proposal #69 là dependency thiết kế đang review bản đồng bộ, không lấy source
chưa merge làm nền implementation. Không sửa SRS/schema/service/controller.

## 1. Kết quả rà năm luồng ghi hiện hành

Tất cả vị trí dưới đây được đọc trên bd45b54. Đây là source audit, không phải
bằng chứng hai transaction đã chạy an toàn. `USER:id` là namespace người dùng,
không phải role USER; role đổi không tạo namespace mới.

| Writer / vị trí guard | Thứ tự trước guard | Sau guard | Lưu ý Buyer |
|---|---|---|---|
| seller-order-command.service.ts:126 | User UPDATE → Store SHARE → Order UPDATE → receipt lookup | Replay rồi policy và Payment SHARE | Ba lệnh confirm/start-packing/ready-to-ship; giữ behavior Seller |
| order-cancellation.service.ts:131 | User UPDATE → Store SHARE → Order UPDATE → receipt lookup | Replay → policy → Payment UPDATE → Product UPDATE theo ID tăng | Buyer chỉ PENDING_CONFIRMATION; stock/Payment/history/version/outbox atomic |
| order-completion.service.ts:153 | User UPDATE nếu Buyer → Store SHARE → Order UPDATE → job lock nếu SYSTEM → receipt lookup | Replay trước policy; Payment UPDATE ở lệnh mới | SYSTEM D07 scope riêng; guard SYSTEM return là có chủ đích, không cấp HTTP SYSTEM |
| order-delivery.service.ts:124 | User UPDATE → Store SHARE → Order UPDATE → receipt lookup | Replay → policy → Payment UPDATE | Actor quản trị giao mô phỏng vẫn dùng USER scope; không bỏ writer khi sửa helper |
| order-returned.service.ts:125 | User UPDATE → Store SHARE → Order UPDATE → receipt lookup | Replay → policy → Payment UPDATE → Product theo ID tăng | Hoàn kho lần đầu phải có ledger và không trùng, không bị tác động bởi resolver chỉ đọc/đóng key |

`assertOrderCommandNotClosed` hiện gọi lookup fence theo scope/key, kiểm dual
outcome trước replay. **Khoảng trống có chủ đích cần implementation sau:**

- Helper hard-code actorType SELLER/hashVersion1; chưa nhận fence Buyer hợp lệ.
- Check `order_resolution_identity_check` ở migration #67 chỉ SELLER và ba lệnh
  chuẩn bị. Không thể insert fence BUYER cancel/complete bằng schema hiện tại.
- Migration mới phải mở đúng allowed-pair, không sửa migration đã dùng chung;
  helper phải phân biệt valid conflict với corrupt identity, không biến mọi
  Buyer fence thành500. Chưa sửa chúng trong task chuẩn bị này.
- Unique(scope,key), identity immutable từ PROCESSING, opposing-table checks
  và Serializable đã có. Không được thay bằng latch/Promise/process lock.

## 2. Fixture chuẩn bị và giới hạn

`BE/test/helpers/buyer-resolution-fixture-plan.ts` chỉ tạo **input gốc** bằng
`prepareOrderCommand`/`completeInput` đã merge. Hash/trim/identity không copy
thuật toán từ proposal. Không là DTO resolver, không seed/connect/POST hoặc
ghi browser storage. Reason trong test là giả lập, không dữ liệu người dùng.

ID lấy từ fixture DB QA được tạo trong lượt test tương lai; không dùng các ID
7/101 trong self-test như ID thật đã import. `buyerResolutionFixtureTarget`
dùng guard QA hiện có: loopback5549 và namespace
`bckl_order_resolution_test_*`, từ chối demo5432/remote/schema override. Guard
địa chỉ không chứng minh credentials đúng, schema đã áp hoặc DB thực sự riêng.

### Fixture DB cần dựng sau dependency merge — CHƯA SEED

| Fixture | Dữ liệu / cách chứng minh |
|---|---|
| F-CANCEL | Buyer active, Seller/Store riêng, Product cùng2Variant và2OrderItem; ưu tiên đi qua Cart/Checkout thật để có CHECKOUT_DECREMENT đúng quantity/snapshot. Payment COD/UNPAID đúng total. Ghi lại stock sau Checkout, version và outbox |
| F-COMPLETE | Order của Buyer ở DELIVERED, Payment PAID/amount/VND/paidAt đúng; deliveredAt từ bước giao thật hoặc fixture synthetic có nhãn, không giả đã test vận chuyển nếu chỉ set state |
| F-D07 | Cùng điều kiện completion, job SYSTEM tới hạn có lease đúng. Mốc tới hạn cấu hình test/clock điều khiển được; không sleep3ngày hoặc giả Buyer receipt từ SYSTEM |
| F-OWNERSHIP | BuyerB, SellerB và OrderB riêng; trường hợp Store SUSPENDED và account inactive tạo riêng từng test để không đổi dữ liệu test khác |
| F-LEGACY | Seller receipt/fence hợp lệ đã tồn tại trước migration mới; giữ nguyên nội dung/hash/key/time sau upgrade. Fence bất biến không xóa bằng cleanup |

Không reuse DB demo hoặc DB E2E dùng chung. Định danh fixture bằng marker UUID,
nhưng key được giữ nguyên trong cả lượt race/retry/restart của một intent.
Không seed/reset hay xóa fence ở afterAll. DB disposable được lưu/loại bỏ theo
thao tác môi trường QA riêng đã xác minh, không xóa dữ liệu ứng dụng để qua test.

## 3. Cách điều khiển cạnh tranh, không dựa vào may rủi thời gian

Tận dụng cơ chế test hiện có trong
`order-command-resolution-runtime.e2e-spec.ts:R03/R04/R11`:

1. Hai Nest app/connection độc lập và một connection điều khiển. Gắn barrier
   test-only tại INSERT bảng command hoặc resolution cho đúng Order fixture.
   Dùng advisory lock PostgreSQL và quan sát `pg_locks ... NOT granted` để biết
   request A thật sự tới DB. Không dùng chỉ sleep hoặc boolean trong process.
2. Bắt đầu request B sau barrier A đã được xác nhận, rồi nhả gate. Hai outcome
   có deadline hữu hạn; không nới timeout ứng dụng hoặc rate limit để qua.
3. `finally`: nhả advisory lock, await settled requests, xóa đúng trigger/function
   test-created theo ID đã xác minh và đóng connection/app. Đây không phải
   migration ứng dụng; **chưa tạo barrier/DDL nào trong lượt chuẩn bị này**.
4. R11: hai connection BEGIN SERIALIZABLE, đều thiết lập snapshot trước commit
   của đối thủ. Chạy cả command-first và fence-first. Retry toàn transaction
   đọc lại canonical state; không retry mọi23505 hoặc bỏ SSI vì có User row lock.
5. Phân biệt SQL mechanism proof và API integration: fixture SQL không gọi
   controller không được ghi là HTTP đã đạt. Hai Nest app không phải hai OS
   process; test restart thật phải đóng/mở lại app với DB cùng fixture/key.

## 4. Kịch bản giao dịch cần chạy sau migration/API — tất cả NOT_RUN

| ID | Barrier / thao tác | Oracle cần đối chiếu |
|---|---|---|
| BPR-01 | Cancel execute-first rồi resolver cùngkey/hash | COMMITTED đúngcommandId/result gốc;1receipt,0fence; stock hoàn đúng1lần |
| BPR-02 | Cancel resolver-first rồi execute muộn | CLOSED;0receipt,1fence; Order/Payment/stock/history/version/outbox không đổi |
| BPR-03 | Complete execute-first | COMMITTED;1Buyerhistory/receipt; không đổi stock/Payment/version/outbox |
| BPR-04 | Complete resolver-first | CLOSED;Order cònDELIVERED; không Buyerhistory/receipt;1fence |
| BPR-05 | Hai resolver cùngkey, haiapp; đóng/mở lạiapp rồi replay | CùngresolutionId/resolvedAt;1fence; không mutation lầnhai |
| BPR-06 | Hai snapshot cũ, cả hai chiều thắng | Không thể receipt và fence cùng tồn tại; lỗi/ retry có giới hạn và không success giả |
| BPR-07 | Mất response sau commit, gọi lại cùngkey | Giữ outcome gốc, không createkey mới; proxy không fake200 hoặc tự retry |
| BPR-08 | Inject lỗi cuối transaction trước commit | Không fence/receipt/business mutation lọt; retry sau sửa lỗi dùng key cũ |
| BPR-09 | Buyer complete đối đầu SYSTEM D07 | MộtCOMPLETED transition; nếuSYSTEM thắng thì Buyer key chỉCLOSED, không fakeBuyerreceipt |
| BPR-10 | Seller confirm/cancel đối đầu Buyer cancel | Một trạng thái nguồn hợp lệ; một cancellation restore nếu cancel thắng; không hai history đối nghịch |
| BPR-11 | Cancel2Variant cùngProduct | MỗiItem đúngrestockquantity, Productversion/outbox chỉ tăng1; fullpayload đúngcanonical |
| BPR-12 | Key đã đóng đổirole rồi đi qua cả5writer | Khácidentity hợp lệ409conflict; đúngidentityclosed; không mutation; khôngbypass quyền/owner |
| BPR-13 | Upgrade cóSellerreceipt/fence vàbusinesshistory | Giữ checksum toàn dữ liệu lịch sử; newBuyerpair được nhận, pairAdmin/System sai bịchặn |
| BPR-14 | Wrongowner/lockedBuyer/Stoređãkhóa | Quyền hiện hành kiểm lại cảreplay;404khônglộOrder; Storestatekhôngtựchặnđốichiếukeycũ |
| BPR-15 | No-record cancel fingerprint khác reason execute muộn | Đóngtoànscopedkey; không chứngminh reason gốc; body/hash khác không thoátfence |
| BPR-16 | Complete hash sai/receipt hỏng/dualcorruption | Lỗi an toàn theo contract; không tự sửa receipt hoặc ghi fence thay kết quả bịhỏng |

Mỗi oracle ghi before/after theo **cả orderId và actorScope/key**: Order,
Payment, OrderStatusHistory, OrderCommand, OrderCommandResolution,
OrderCompletionJob nếu có, StockMovement từngItem, stock từngVariant,
Product.version và SearchOutbox. Đếm theoOrder riêng không đủ phát hiện reuse
key sangOrderkhác. Log không key/hash/reason/token/địa chỉ.

## 5. Bằng chứng được phép báo trong task này

- Audit source/DDL hiện hành và fixture/QA-target self-tests thực chạy.
- Không migration mới, endpoint Buyer, database fixture thật hoặc API race đã chạy.
- Self-test PASS không chuyển BPR01–16 thànhPASS. Khi triển khai thay proposal
  bằng contract đã merge và ghi SHA/schema/app/test/DB target mỗi lượt kiểm.
- Testfixture helper chưa là service runtime, không import từ AppModule.

Kiểm thực chạy19/10: frozen/offline installPASS (Prisma generate local, không
migrate); **24fixture/guard self-testsPASS**, nằm trong fullBackend **653PASS /
28file**; lint/typecheck/Nestbuild/diffcheckPASS. Không đổi BE/src, Prisma, FE,
AI hoặc lockfile so bd45b54. Các log lỗi trong unit thuộc ca mock/fault nền;
không là kiểm health/DB live. Không chạy Backend E2E hoặc kết nối DB trong lượt này.

Điều kiện mở implementation:
#69 đãmerge và đủinput; sau đó migration/API PR riêng, không trộn testpreparation
thànhbiênnhận Buyer runtime hay fullG-FULFILMENTDONE.
