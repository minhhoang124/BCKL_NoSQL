# Ma trận Seller command Web / recovery — 16/10/2026

**Bằng chứng nền C2:** suite Backend hiện có đã chạy lại54/54PASS trên DB test
mới, xem [readiness](c2-backend-readiness-2026-10-16.md). Chỉ các tình huống Backend
được mapping trong báo cáo đó; không chuyển các ca tích hợp Web/resolution mới
bên dưới thành PASS hoặc nhận discarded-response là socket-loss proof.

Nguồn: [thiết kế và quyết định cần review](../architecture/seller-command-web-recovery-design.md).
Baseline ban đầu develop09daae0; khi đó #56/#57 còn là PR riêng. Đồng bộ trên
develop035656b sau merge #56/#57: journal và Order GET đã có, chưa có resolver
hoặc Seller command Web runtime. **Toàn bộ dòng dưới NOT_RUN cho
luồng tích hợp mới**, không lấy test foundation hoặc browser GET làm PASS cho POST.

## Môi trường / baseline

PostgreSQL QA riêng, không demo hoặc DB E2E reset chung với manual QA. Hai Nest
instance cùng DB, hai browser/session độc lập. Buyer tạo COD qua Checkout thật;
Seller active đúng Store, Seller sai Store, account bị khóa và Store SUSPENDED.
Ghi head/migration/marker/orderId, Order/Payment/history/receipt, stock/movement,
Product.version/outbox và fence mới trước/sau. Không ghi key/token/PII vào report.
Fault injection nêu rõ trước commit, sau commit hay chỉ cắt response, không mock
receipt thành công rồi gọi đó là integration. Reset worker/process chỉ thuộc QA.

| ID | Kịch bản | Kỳ vọng / bằng chứng | Layer cần chạy |
|---|---|---|---|
| C2W01 | Confirm PENDING → packing CONFIRMED → ready PACKING | Mỗi bước một confirmation/key/history/receipt; GET mới; không tự nhảy bước; kho/Payment/version/outbox không đổi | Browser + HTTP/DB |
| C2W02 | Bấm đúp/click+Enter trước await; hai component cùng controller | Một dispatch/latch; nếu hai request lọt, server cùng key chỉ một effect | Component + HTTP/DB |
| C2W03 | Hai app cùng key/hash | Cùng commandId/receipt, một history, không PROCESSING commit riêng | HTTP/DB |
| C2W04 | Hai key khác cạnh tranh cùng nguồn | Một transition thành công; bên còn lại lỗi không nhận replay giả; giải quyết pending qua cơ chế đã review | HTTP/DB |
| C2W05 | Reload trước gửi và khi POST pending | Auth xác minh trước đọc pending; không auto resend; factory handle mới với key cũ, xác nhận mới trước replay | Browser + HTTP/DB |
| C2W06 | Server commit, response mất | Unknown giữ key; replay trả đúng receipt cũ dù Order đã sang bước sau; một effect | Browser + HTTP/DB |
| C2W07 | Client timeout/abort trước hoặc trong server xử lý | Không suy rollback; pending không xóa; replay/resolve quyết định bằng DB | Browser + HTTP/DB |
| C2W08 | Storage get/set/readback/remove lỗi hoặc JSON hỏng | Chặn trước POST khi chưa persist; remove lỗi sau receipt vẫn blocked, không sinh key mới | Unit/component + browser |
| C2W09 | Logout A/login B hoặc role/active đổi khi POST đang chờ | Không resend bằng B; response/lỗi A không ack, clear pending hay toast trong B | Deferred component + browser |
| C2W10 | Logout/login lại cùng ID nhưng phiên mới | Callback generation cũ bị bỏ; chỉ explicit replay bằng session hiện hành | Browser + HTTP/DB |
| C2W11 | Receipt đúng, acknowledge xong, GET lỗi | Thông báo đã ghi nhận/chưa tải lại; khóa bước mới; retry GET, không gửi lại POST mới | Component + browser |
| C2W12 | HTTP200 thiếu field/extra/actor/order/command sai hoặc tiền sai | Validator từ chối trước ack; giữ pending, không dùng typed object/GET thay bằng chứng | Contract/component + fault browser |
| C2W13 | Retry401/403/404/409/413/429 sau lần gửi unknown | Không clear chỉ theo code; không auto refresh/retry POST; quota/IN_PROGRESS chờ có kiểm soát | Component + HTTP/browser |
| C2W14 | Cùng key khác Order/command/hash | IDEMPOTENCY_CONFLICT, không nhận receipt khác/clear pending | HTTP/DB |
| C2W15 | Sai owner/Seller khóa; Store SUSPENDED đúng owner | Ngoài owner404, khóa401; Store suspended được xử lý đơn cũ nếu Payment hợp lệ | HTTP/DB + browser |
| C2W16 | Payment null/amount/currency/status/paidAt sai | Không chuyển state, không tự sửa Payment; giữ pending tới settlement phù hợp | HTTP/DB |
| C2W17 | SQL lỗi ở history/receipt cuối transaction | Order/history/receipt rollback; không side effect kho/Search; retry cùng key sau xử lý nguyên nhân | HTTP/DB |
| C2W18 | GET thấy target nhưng không có receipt của key đang chờ | Không acknowledge hoặc mở bước tiếp theo | Component/browser |
| C2W19 | Confirm dialog bị hủy | Không persist, không POST; không tạo pending giả | Component/browser |
| C2W20 | Đổi Order/route/unmount khi POST pending | Pending sống ngoài panel, response cũ không đổi màn mới; cần đối chiếu đúng intent | Component/browser |

## Các ca bổ sung cho PROPOSED Backend resolution/fence

Chỉ implement sau khi contract được Hiền review; hiện chưa có endpoint/schema này.

| ID | Kịch bản | Kỳ vọng / bằng chứng | Layer cần chạy |
|---|---|---|---|
| C2R01 | Key đã SUCCEEDED → resolve | COMMITTED trả full receipt gốc; không tạo fence hoặc thay Order | HTTP/DB |
| C2R02 | Key chưa thực thi → explicit resolve | CLOSED_WITHOUT_EXECUTION + fence commit; không history/receipt thành công giả | HTTP/DB |
| C2R03 | Request cũ bắt đầu sau fence commit | Cùng key bị chặn, dù Store/Payment đã hợp lệ trở lại; không effect | Hai app HTTP/DB |
| C2R04 | Request cũ giữ actor lock trước, resolver tới sau | Lệnh commit trước; resolver trả COMMITTED, không fence xung đột | Hai app HTTP/DB |
| C2R05 | Resolver giữ actor lock trước, request cũ tới sau | Fence thắng; không có receipt SUCCEEDED cùng key | Hai app HTTP/DB |
| C2R06 | Resolve lặp/mất response/restart app | Cùng outcome/resolutionId, key cũ không chạy được; không dữ liệu chỉ nằm memory | HTTP/DB + browser |
| C2R07 | Resolve SQL lỗi trước commit | Không trả CLOSED thành công; giữ pending; không fence nửa vời | HTTP/DB |
| C2R08 | Scope/key trùng nhưng khác Order/command/hash | Conflict, không rò receipt hoặc close nhầm; actor-wide serialization | Hai app HTTP/DB |
| C2R09 | Response CLOSED sai identity/extra/session cũ | FE không clear; settlement không dùng acknowledge(success) hoặc commandId giả | Contract/component |
| C2R10 | CLOSED hợp lệ nhưng storage remove lỗi | Không mở key mới, retry settle idempotent; không bỏ qua pending hỏng | Component/browser |
| C2R11 | Account bị khóa/khác owner gọi resolve | Không tự bypass quyền; giữ pending, chỉ báo hạn chế hiện hành | HTTP/browser |
| C2R12 | Sau CLOSED hợp lệ, Seller vẫn muốn thao tác | GET mới, confirmation mới, key mới; key cũ bị fence suốt vòng đời | Browser + HTTP/DB |
| C2R13 | COMMITTED/fence cho cùng key cạnh tranh | Constraint/protocol không cho cả hai kết quả cùng tồn tại; không cleanup bằng TTL phá fence | Migration + hai app DB |
| C2R14 | Key fence C2 dùng lại ở cancel/returned/complete hoặc sau đổi role | Mọi writer cùng USER scope đều chặn; không chỉ test service C2, guard DB fail closed nếu writer quên check | Migration + HTTP/DB |
| C2R15 | Resolve/command xen kẽ vượt quota; JSON/query/extra sai | Dùng chung bucket, không bypass; lỗi không clear pending hoặc ghi fence tùy ý | HTTP/browser |

## Bàn giao

Mỗi test ghi head/schema, actor/fixture ID, expected/actual, DB trước/sau,
PASS/FAIL/NOT_RUN và fault method. Test React mock không thay server transaction;
test API không thay F5/cookie/browser. Journal tab-scoped không thay đa tab/đa
thiết bị hoặc idempotency PostgreSQL. Không chạy lại toàn Backend trên DB manual
QA có dữ liệu cần giữ. G-FULFILMENT chỉ xét sau integration thật và review.
