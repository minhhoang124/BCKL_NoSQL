# Quyết định triển khai Checkout/COD — bảy điểm đã được Hiền chấp thuận

Ngày 05/10/2026. Hoàng đề xuất; Hiền review nghiệp vụ/DTO/migration; Đạt review ranh giới stock → outbox → index.

**ACCEPTED_BY_HIEN — DESIGN/TARGET.** Hiền đồng ý Q1–Q7 tại [review head 222f52f ngày 05/10](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#pullrequestreview-5412360700), yêu cầu đồng bộ nguồn contract trước code. Đây không phải API đang chạy hoặc approve head tài liệu mới; không có schema/migration mới trong lượt này. Mọi ví dụ là thiết kế; toàn bộ QCHK-* là **NOT_RUN**. Những chữ “đề xuất” trong phần lập luận bên dưới ghi lại phương án đã được chọn cho P0, không còn là câu hỏi Q1–Q7 đang chờ trả lời.

## 1. Nguồn chuẩn và điều kiện triển khai

- [SRS v3.1](../analysis/hien/srs-v3.md): FR-CAR-01, FR-CHK-01, FR-PAY-01 và yêu cầu đối chiếu kết quả sau timeout.
- [Contract chuẩn](cart-order-inventory-api-contract.md): mục 5, 10–13 đã đồng bộ Q1–Q7 theo review trên; re-review head mới #29 trước implementation. Contract này là nguồn field/HTTP/canonical hash, không dùng hai định nghĩa khác nhau.
- [Checklist Checkout/COD](../architecture/checkout-cod-backend-readiness.md): luồng transaction, CHK-01…19 và CHK-S01…04.
- Develop `6663fab` đã có schema nền #26, Address #30 và Cart Backend #31 đã merge sau review/CI xanh. Không đưa Checkout code vào #31 hoặc PR tài liệu #29.

Q1–Q7 đã được Hiền chấp thuận; Cart #31 đã merge; sau khi bản đồng bộ contract #29 được re-review: tạo branch Checkout riêng từ develop; audit dữ liệu cũ trước migration mới; triển khai preview/create/lookup và test. Order lifecycle, hoàn kho, sandbox payment và UI là các task tiếp theo, không nhận là đã có chỉ vì Checkout tạo được Order.

Các nguyên tắc đã chốt **không xin đổi**: một Buyer/key/request tạo một Checkout chung; một Order mỗi Store, cùng transaction; chỉ subset Cart với quantity khớp; replay trước đọc giỏ/địa chỉ/giá hiện hành; COD UNPAID; PostgreSQL chuẩn; không âm kho; không HTTP trong transaction; snapshot bất biến; một version/event mỗi Product bị đổi kho, giữ APPROVED nếu chỉ đổi kho.

## 2. Bảng quyết định đã được chấp thuận ở mức thiết kế

| ID | Đề xuất ưu tiên | Trạng thái |
|---|---|---|
| Q1 | Preview trả allowlist, lỗi public/giá/kho theo dòng; tổng toàn nhóm null khi không thể mua | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |
| Q2 | P0 đầu tiên phí vận chuyển demo cố định 0.00, có nhãn mô phỏng; không bật phí khác trước contract xác nhận phí | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |
| Q3 | Tối đa 50 dòng/request, quantity 1–99; body 64 KiB; tiền nguyên đồng và kiểm overflow trước ghi DB | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |
| Q4 | 5 lần tạo mới/phút + giới hạn đầu vào hữu hạn; replay hợp lệ không tiêu thụ quota tạo mới | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |
| Q5 | hashVersion=1 chỉ cho request mới theo canonical v1; legacy không rõ nguồn để null, không backfill đoán | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |
| Q6 | Lưu receipt ban đầu cùng transaction; replay không trả OrderStatus/PaymentStatus hiện hành thay receipt cũ | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |
| Q7 | GET /checkouts/by-key với header key, ownership/no-store; 404 không chứng minh request trước chưa commit | ACCEPTED_BY_HIEN — DESIGN/NOT_RUN |

Hiền đã đồng ý từng Q tại review dẫn trên; cần re-review độ đồng bộ của head mới. Đạt review ranh giới stock/outbox/index theo checklist; không thay contract FastAPI, index payload hay thuật toán Search trong task này. Không yêu cầu Hiền sửa SRS để hợp thức hóa code chưa duyệt.

## 3. Q1 — preview rõ ràng và không lộ sản phẩm nháp

Giữ request đã duyệt: addressId, paymentProvider=COD, items[{variantId,quantity,expectedUnitPrice}]. Buyer lấy từ JWT, không nhận buyerId/storeId/tổng tiền client.

- DTO/header sai → 400; xác thực/quyền theo Auth; address không thuộc actor → 404 ADDRESS_NOT_FOUND; dòng không thuộc giỏ → 404 CART_ITEM_NOT_FOUND; quantity lệch → 409 CART_CHANGED. Đây là lỗi toàn request theo contract, không biến thành preview thành công.
- Sau các bước trên, đọc snapshot nhất quán public policy/Variant/giá/kho. Product hoặc Variant không public → lỗi dòng VARIANT_NOT_AVAILABLE; public nhưng thiếu kho → INSUFFICIENT_STOCK; giá khác → PRICE_CHANGED. Ưu tiên unavailable → thiếu kho → giá đổi; không tiết lộ lý do moderation nội bộ.
- Với lỗi dòng, đề xuất HTTP 200, canCheckout=false để UI hiển thị các món cần sửa **trước create**. Create vẫn dùng 409 và rollback toàn nhóm cho các lỗi nghiệp vụ tương ứng. Không coi HTTP 200 preview là đã đặt hàng.
- Dòng non-public chỉ trả variantId, quantity và mã lỗi trong unavailableItems; không name/image/options/store/brand/giá nháp. Dòng public P0 trả các field tối giản trong contract mục 5.1; field tên/option/ảnh bổ sung cần review allowlist riêng, không tự lấy toàn Cart DTO.
- Mỗi dòng public có expectedUnitPrice, unitPrice hiện hành, lineTotal tính bằng Decimal và errors. Không trả toàn Prisma object. Không trả mật khẩu, dữ liệu seller nội bộ hoặc metadata import.
- Nếu bất kỳ dòng lỗi: canCheckout=false và totals=null; không đưa tổng một phần lên nút đặt hàng như thể có thể mua toàn nhóm. Tổng nhóm Store cũng null nếu nhóm có lỗi. Giá mới chỉ là thông tin để Buyer xác nhận lại bằng request mới, không tự chấp nhận thay Buyer.
- Preview chỉ đọc DB, không khóa/giữ kho, không ghi Checkout/Order/Payment/movement/outbox. Snapshot nhất quán không phải lời bảo đảm giá/kho tại create.

Ví dụ tối giản, số tiền là ví dụ thiết kế (không phải dữ liệu demo đã kiểm thử):

```json
{
  "canCheckout": true,
  "paymentProvider": "COD",
  "currency": "VND",
  "shippingMode": "DEMO_ZERO_V1",
  "groups": [{
    "store": {"id": 8, "name": "Cửa hàng mẫu"},
    "items": [{
      "variantId": 125, "quantity": 2,
      "expectedUnitPrice": "1290000.00",
      "unitPrice": "1290000.00", "lineTotal": "2580000.00",
      "errors": []
    }],
    "subtotal": "2580000.00", "shippingFee": "0.00",
    "discountTotal": "0.00", "total": "2580000.00"
  }],
  "unavailableItems": [],
  "totals": {"subtotal": "2580000.00", "shippingFee": "0.00", "discountTotal": "0.00", "total": "2580000.00"}
}
```

Allowlist chuẩn ở contract mục 5.1; errors là mảng code, dòng chỉ báo lỗi ưu tiên cao nhất, group có lỗi có cả bốn tổng null. Trường display bổ sung phải review DTO/Swagger trước code. Preview không cần gửi lại toàn địa chỉ: UI dùng Address đã chọn; Order lưu snapshot khi create. Không trả hay log địa chỉ người khác để giải thích ownership.

## 4. Q2 — phí ship mô phỏng, tránh thay tổng không được xác nhận

Contract mới yêu cầu expectedUnitPrice, chưa có expectedShippingFee/quote. Nếu tùy ý đổi config phí từ preview sang create, giá hàng vẫn khớp nhưng tổng tăng mà Buyer không xác nhận. Vì vậy đề xuất **P0 đầu tiên chỉ dùng DEMO_ZERO_V1**, phí 0.00 cho mọi Store; preview/create dùng chung policy, lưu shippingFee=0.00 vào Order.

UI ghi “Vận chuyển mô phỏng — phí demo 0đ”, không tuyên bố sàn/đơn vị vận chuyển thực tế miễn phí. Đây là lựa chọn phạm vi demo đã được Hiền chấp thuận Q2, không phải mô tả quy trình nội bộ Shopee/TikTok hay chính sách kinh doanh lâu dài. discountTotal=0.00 vì voucher ngoài P0.

Không expose config cho phép thay phí bất kỳ trong P0 rồi bỏ qua xác nhận. Nếu nhóm muốn phí flat như 30.000đ/Store ngay đợt đầu, phải review riêng request xác nhận phí/quote có version, canonical hash và mã phí đổi; cập nhật contract trước code. Không âm thầm thêm field vào hash v1 đã duyệt. Phí vận chuyển thật/địa giới/khối lượng và quote hết hạn để bước sau.

## 5. Q3 — giới hạn tài nguyên và tiền

- Đề xuất config Checkout maxItems=50; request rỗng → EMPTY_CHECKOUT, quá giới hạn/duplicate variantId → VALIDATION_ERROR. quantity integer 1–99, ID positive PostgreSQL Int. Không truncate bớt dòng hoặc gộp quantity trùng âm thầm.
- body JSON tối đa 64 KiB **sau giải nén** cho preview/create; quá mức → 413 REQUEST_TOO_LARGE (đã đồng bộ contract mục 10). Đếm/giới hạn ngay lớp đọc body của route, trước controller/JSON parse hoàn chỉnh; Content-Length chỉ là gợi ý, không phải bảo vệ duy nhất. Phải kiểm parser registration trong Nest bootstrap vì configureApp hiện chưa đặt limit riêng. Không gắn một middleware sau khi global parser đã đọc hết rồi tuyên bố có bảo vệ sớm; không làm thay limit upload ảnh/API khác.
- expectedUnitPrice là chuỗi tiền dương nguyên đồng theo regex v1 trong contract mục 5.1, canonical output hai số thập phân .00; không cho client gửi JSON float. Quy tắc canonical tương đương theo contract, không tự mở rộng định dạng số khi implement.
- Dùng Prisma.Decimal/decimal arithmetic cho unitPrice × quantity, subtotal, fee, discount và total; không dùng Number/parseFloat tính tiền. Kiểm từng phép tính trước insert; không chờ PostgreSQL overflow rồi trả lỗi SQL.
- Decimal(14,2) chứa tối đa 12 chữ số phần nguyên. Với VND nguyên đồng, bound dương là 999999999999.00. Giá bán phải dương theo public policy; shipping/discount không âm; discount không vượt tổng trước giảm. Kiểm cả lineTotal, từng Order và tổng toàn Checkout; tiền vượt bound → 400 VALIDATION_ERROR với reason MONEY_LIMIT_EXCEEDED trong details (đã đồng bộ contract mục 10).
- DTO reject trường thừa trên cả envelope và item. 50 dòng × quantity 99 không cho phép vượt kho; vẫn kiểm canonical stock trong transaction lúc create.

## 6. Q4 — chống spam nhưng vẫn lấy lại đơn sau timeout

Hai giới hạn khác mục đích, tất cả theo userId thật từ JWT:

1. Đề xuất bucket đầu vào create 60 request/phút/User, **bao gồm replay**, trả 429 + Retry-After. Validation/body/Auth vẫn chạy theo pipeline đã kiểm thử; bucket không thay DB ownership. Đây là trần hữu hạn cho lookup/hash/replay, không hứa retry vô hạn luôn HTTP 200.
2. Quota tạo mới 5/phút/User theo contract. Sau validation và đọc key thuộc actor: COMPLETED/hashVersion/receipt hợp lệ + hash trùng → replay, không tính quota tạo mới. Key mới được tính một lần vào quota trước attempt; cả attempt thất bại cũng tính để không spam bằng lỗi kho. Internal serialization retry không tính thành request tạo mới thứ hai.

Có key không đồng nghĩa replay. Key giả vẫn quota tạo mới; key đã có nhưng hash khác → 409 IDEMPOTENCY_CONFLICT; key đang xử lý → 409 CHECKOUT_IN_PROGRESS + Retry-After ngắn. Tất cả vẫn chịu bucket đầu vào. Không lookup key toàn hệ thống hay bỏ guard để “ưu tiên replay”.

Lookup trước transaction là tối ưu, **không là bằng chứng chống đơn đôi**. Transaction phải khóa Buyer/đọc lại Checkout trước Cart/address, phân loại race theo unique buyer/key và hash; trạng thái có thể đổi sau lookup. Một request key mới đã bị 429 không tạo DB work; client giữ key/body và thử lại, hoặc tra Q7 nếu request trước mất response.

Preview giữ 20/phút/User. Lookup Q7 đề xuất 20/phút/User riêng. P0 limiter memory chỉ theo instance; không tuyên bố hạn mức dùng chung khi chạy nhiều replica. Database unique/khóa vẫn bảo vệ không tạo đơn đôi trên nhiều instance; đó là vấn đề khác với quota chống spam. Shared limiter là bước mở rộng riêng, không đưa Redis chỉ cho task này.

Transaction retry đề xuất tối đa **3 attempts kể cả lần đầu**, chỉ conflict/deadlock đã phân loại. Giới hạn chờ khóa và thời gian transaction, backoff hữu hạn và deadline tổng phải được khóa/test trong PR code; không bắt mọi lỗi rồi retry hoặc để request chờ vô hạn. Hết conflict retry → STOCK_CONFLICT; cùng key còn đang xử lý → CHECKOUT_IN_PROGRESS. Không retry PRICE_CHANGED/validation/ownership.

## 7. Q5 — hash version và dữ liệu legacy

Schema hiện có requestHash nhưng chưa có hashVersion. Đề xuất migration mới thêm hashVersion nullable, **không default 1 cho mọi dòng cũ**. New Checkout ghi 1 tường minh với SHA-256/canonical v1 của contract: buyerId/addressId/provider/items; sort items theo variantId, key JSON sort đệ quy và tiền canonical. Chỉ thêm field vào hash khi contract version tương ứng được review.

Trước migration audit số Checkout theo status và khả năng xác định request/hash cũ; báo số liệu không chứa raw key/PII. Chưa chạy DB audit thì không ghi “không có legacy”. Có request gốc và thuật toán được chứng minh mới được backfill; không hash lại Order hiện hành rồi nhận là request gốc.

Legacy/unknown hashVersion hoặc receipt legacy thiếu không được tự tạo đơn mới theo key cũ. Đề xuất 409 CHECKOUT_LEGACY_REVIEW_REQUIRED (đã được Hiền chấp thuận; contract mục 10) cho replay/lookup không đủ bằng chứng; bảo toàn đơn/kho/key, hướng xử lý riêng. Không xóa Checkout cũ hay gán v1 chỉ để test xanh. Hash version lạ không fallback v1.

## 8. Q6 — receipt bất biến khác trạng thái Order hiện hành

Đề xuất migration mới thêm Checkout.receiptVersion nullable và receiptJson nullable. Khi tạo mới, lưu receiptVersion=1 và receipt allowlist trong **cùng transaction** với Order/stock/Cart/Completed/outbox. Ràng buộc DB tương ứng: Checkout hashVersion=1 COMPLETED phải có receiptVersion=1/receipt; kiểm shape/version ở runtime trước trả. Định nghĩa SQL constraint cụ thể cần review migration, không coi JSON có sẵn là đã an toàn.

Receipt chứa checkoutId/status=COMPLETED và nhóm Order (id/orderNumber/storeId/status ban đầu/payment provider-status-amount-currency/total) đúng envelope contract. Không lưu replayed: Backend thêm false cho tạo mới, true cho replay/lookup. Không copy toàn Prisma row, địa chỉ, token hoặc raw key vào receipt response. Khi lưu đã sort Order ổn định theo storeId; replay không đổi thứ tự.

POST replay dùng receipt ban đầu, chỉ đặt replayed=true; POST mới replayed=false. Seller xác nhận/giao hàng hay Payment thành PAID không sửa receipt Checkout. GET Order hiện hành ở task Order riêng trả trạng thái mới/timeline. UI phân biệt “đã tạo đơn” với “đơn đang giao”, không dùng receipt cũ làm nguồn tracking hiện hành.

Không dựng receipt bằng Order.status hiện hành sau timeout rồi gọi là kết quả gốc. Receipt lỗi/thiếu/unknown version không đi tiếp để đặt mới hoặc giảm kho; trả lỗi an toàn và log checkoutId/requestId, không dump JSON/PII. Legacy xử lý theo Q5; new-version corrupt data báo lỗi server an toàn, không diễn giải là Buyer nhập sai. Receipt phải được giữ để replay, không xóa sớm sau vài phút; chính sách lưu trữ sau này cần review riêng.

## 9. Q7 — tra cứu sau mất response

Đề xuất **GET /checkouts/by-key**; key truyền header Idempotency-Key theo format đã duyệt, không đặt raw key vào URL/log. JWT USER/active, query `(buyerId,key)` và Cache-Control:no-store. Header phải được che khỏi request/error/proxy logs, không chỉ đổi từ query sang header là đủ.

- Có Checkout COMPLETED phiên bản hỗ trợ: 200 receipt gốc Q6, replayed=true nghĩa là trả lại kết quả đã lưu, không vừa tạo đơn. Lookup không ghi Cart/stock/version/outbox; không yêu cầu địa chỉ/giỏ vẫn còn tồn tại.
- Không tìm thấy trong phạm vi actor: 404 CHECKOUT_NOT_FOUND (đã được Hiền chấp thuận; contract mục 10), cả key chỉ thuộc Buyer khác cũng vậy.
- PENDING nhìn thấy được: 409 CHECKOUT_IN_PROGRESS + Retry-After; không tự reset/re-create. Với luồng create một transaction, dòng PENDING chưa commit không visible; không cần tạo PENDING riêng ngoài transaction để phục vụ lookup. PENDING cũ phải audit, không loop poll vô hạn.
- Legacy không đủ bằng chứng: Q5. Receipt dữ liệu mới hỏng: lỗi server an toàn Q6.

**404 không chứng minh request cũ chưa commit:** transaction có thể đang chạy/chưa visible. UI không sinh key mới khi timeout hoặc lookup 404; giữ body/key gốc, retry hữu hạn cùng key. UI tối đa 3 lần tổng cộng tự đối chiếu/retry với backoff, sau đó hiển thị “chưa xác định, kiểm tra lại”, cho phép kiểm tra thủ công; không tự báo mua thất bại rồi checkout lần hai với key mới. Tải lại trang phải giữ intent/key an toàn; cơ chế lưu phía UI được Hoàng review trong PR UI, không lưu JWT/địa chỉ đầy đủ vào URL.

Chỉ sau lỗi nghiệp vụ đã có response chắc chắn không tạo đơn và Buyer sửa intent (giá/quantity/address) mới dùng key mới; receipt thành công thì mở Order hiện hành khi Order read API đã có. Không hứa endpoint tracking chưa triển khai.

## 10. Test bổ sung phải viết khi implementation — NOT_RUN

| ID | Bao phủ | Expected |
|---|---|---|
| QCHK-01 | Q1 public/unavailable/giá đổi/ownership | Mã HTTP phù hợp contract; không lộ draft; totals null khi lỗi; preview không có write |
| QCHK-02 | Q2 preview/create/phí demo | Cùng policy 0.00/snapshot/nhãn; không có config phí khác âm thầm tăng tổng |
| QCHK-03 | Q3 0/50/51 dòng, duplicate, quantity biên | Reject đúng, không cắt dòng; maxItems không bypass bởi nested data |
| QCHK-04 | Q3 chunked/compressed/body quá 64 KiB | 413 sớm, không DB write; parser không phá upload/API khác |
| QCHK-05 | Q3 Decimal biên, overflow line/Store/toàn nhóm | Chuỗi nguyên đồng, không Number rounding; rollback/no write |
| QCHK-06 | Q4 quota đã đầy, key mới/key giả/hash khác/replay thật | Mới 429, replay đúng dưới ingress cap; spam replay cũng có trần; User khác độc lập |
| QCHK-07 | Q4 hai instance, cùng key/race/transaction retry | Một receipt/nhóm đơn; internal retry không trừ kho hai lần; không nhận memory quota là shared |
| QCHK-08 | Q5 fresh/legacy/version lạ | Migration mới, không guessed backfill; không dùng key legacy tạo lại; bảo toàn dữ liệu |
| QCHK-09 | Q6 Seller/Payment đổi sau create | POST replay/GET lookup giữ receipt gốc; Order read riêng trả state mới khi API đó có |
| QCHK-10 | Q6 inject lỗi lưu receipt/corrupt receipt | Lỗi lưu rollback toàn checkout; corrupt không hydrate tùy tiện/tạo đơn lần hai/lộ JSON |
| QCHK-11 | Q7 lookup trước commit, timeout sau commit, sai actor | 404 không đổi key; commit xong nhận cùng ID; ownership/no-store/log redaction |
| QCHK-12 | Q4/Q7 timeout/retry giới hạn | Không treo request/poll vô hạn; UI cho kiểm tra lại, không tự nhân đôi intent |

Các ca này bổ sung, không thay CHK-01…19 và CHK-S01…04. Tests cạnh tranh dùng hai app/client và điểm đồng bộ có kiểm soát; HTTP mock không chứng minh stock → dual index. Ghi rõ kiểm thử nào đã chạy, môi trường DB/index riêng và head cuối. Không thực hiện migration trên dữ liệu demo để “thử nhanh”.

## 11. Từ điển ngắn và bước đọc cho Hoàng

- **Preview:** xem lại đơn trước mua; chưa giữ kho hay tạo đơn.
- **Transaction/rollback:** cả nhóm thay đổi DB cùng thành công hoặc hoàn tác.
- **Idempotency:** cùng key và cùng nội dung chỉ có một tác dụng mua hàng.
- **Hash/version:** dấu kiểm nội dung request và phiên bản quy tắc tạo dấu; không phải Product.version.
- **Receipt:** kết quả ban đầu đã lưu để trả lại sau mất response; không phải trạng thái giao hàng hiện hành.
- **Snapshot:** thông tin sản phẩm/địa chỉ/giá lúc đặt, không đổi khi Seller sửa catalog.
- **Quota/rate limit:** giới hạn số request trong khoảng thời gian; không thay khóa/unique chống đơn đôi.
- **Canonical:** dữ liệu chuẩn PostgreSQL, không lấy index Search làm nguồn tính tiền/kho.
- **Outbox:** công việc đồng bộ index được ghi cùng giao dịch kho, worker gửi sau commit.
- **Legacy:** dữ liệu cũ chưa đủ bằng chứng để áp quy tắc/hash mới.

Hoàng đọc: contract mục 5 → bảng Q1–Q7 → luồng create tại checklist → CHK/QCHK tests → schema Checkout/Order/Payment/StockMovement. Khi code PR mới, cập nhật [kiến trúc hệ thống](../architecture/system-architecture-overview.md) bằng route → validator → service/transaction → dữ liệu → outbox → tests thật, không chỉ thêm tên component.
