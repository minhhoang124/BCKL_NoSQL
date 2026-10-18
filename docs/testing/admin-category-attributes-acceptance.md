# Acceptance quản trị thuộc tính — PROPOSED, 16/10/2026

Baseline035656b. [Contract](../api/admin-category-attributes-contract.md).
**Tất cả ca AT01–AT34 NOT_RUN**: chỉ tài liệu, không test code/schema mới.

| ID | Ca kiểm | Kỳ vọng | Tầng |
|---|---|---|---|
| AT01 | Guest/Buyer/Seller/inactive Admin gọi mọi route | 401/403; không đọc dữ liệu riêng/ghi | HTTP/DB |
| AT02 | Admin đọc Category/definition/option inactive | Đủ trạng thái, không dùng public response thay danh sách quản trị | HTTP/DB |
| AT03 | Nhiều trang, ID cursor, giới hạn, inactive filter | Không sót/lặp do sortOrder; nextCursor/null rõ, revision đổi thì reload | HTTP/UI |
| AT04 | Attribute/option thuộc Category khác | 404, không sửa object ngoài nesting | HTTP/DB |
| AT05 | Null/extra/type sai/query trùng/body trống/ID overflow | Validation an toàn, không mutation | HTTP |
| AT06 | Tạo definition/option slug trùng cạnh tranh | Một bản ghi; lỗi409 bên còn lại, không job/audit lẻ | Hai DB/HTTP |
| AT07 | Type đổi khi đã có ProductValue kể cả draft/hidden | 409; value/type/revision/job không đổi | DB/HTTP |
| AT08 | Đổi khỏi SELECT nhưng còn option inactive | 409, không xóa cấu hình ngầm | DB/HTTP |
| AT09 | Sửa slug definition/nhãn nghĩa option đã dùng | 409; create replacement theo quy trình, không đổi snapshot | DB/HTTP |
| AT10 | Type chưa dùng/no options đổi hợp lệ | Revision tăng1, không convert dữ liệu nonexistent | HTTP/DB |
| AT11 | Required SELECT không custom, không active option | Chặn bật/required; có thể lưu inactive cấu hình trước | HTTP/DB |
| AT12 | Required true chưa confirmPolicyChange | 409confirmation, không đổi dữ liệu | HTTP/DB |
| AT13 | Required true đã confirm, Product thiếu value | Public/Cart/Checkout/hydrate loại ngay; durablejob→DELETE đúng version | HTTP/DB/worker |
| AT14 | Required NUMBER0/BOOLEANfalse | Vẫn hợp lệ, không bị coi là thiếu | Seller/submit/public |
| AT15 | allowsCustom true→false, custom value đang dùng | Cầnconfirm; thiếu lựa chọn hợp lệ bị loại, không xóa value | HTTP/DB/worker |
| AT16 | Tắt option required/optional đang dùng | Required có thể invalid; optional bỏ value khỏi public/index, không null giả | HTTP/DB/Search |
| AT17 | Tắt definition/bỏ required/mở custom/bật option | Hiệu lực theo canonical và quyết định public lại đã duyệt; không auto đổi moderation | HTTP/DB/worker |
| AT18 | Category cha có definition nhưng Product ở lá | Không tự kế thừa/ép required từ cha | Seller/public/Search |
| AT19 | Hai Admin cùng expectedRevision, khác metadata/option | Một mutation thắng; một409stale; không lost update | Hai app/DB barrier |
| AT20 | Seller ghi value/submit khi Admin đổi type/required/option | Serializable/lock proof không có value sai type hoặc duyệt dựa rule cũ lọt public | Hai app/DB barrier |
| AT21 | No-op, sortOrder-only/filterable-only, optional chưa dùng | Không job/event/version Product thừa; no-op không tăng revision/audit | DB/worker |
| AT22 | Job/audit/CAS lỗi sau update metadata | Rollback metadata/revision/audit/job toàn bộ | DB fault |
| AT23 | Worker lỗi giữa batch/restart/retry cùng job | Durable work còn; canonical reread; mỗi logical product event không duplicate | DB/worker |
| AT24 | Product đổi state khi job chờ, version gần/vượt max | State mới nhất; version không lùi/reset; lỗi được lưu/quan sát | DB/worker |
| AT25 | Hai mutation policy liên tiếp, callback/worker đảo thứ tự | Index cuối và hydrate theo canonical; không resurrect stale | HTTP/DB/Search |
| AT26 | ProductValue option sai definition; nonSELECT thêm option | FK/validation chặn, không dữ liệu lẻ | DB/HTTP |
| AT27 | Order cũ sau đổi/tắt definition/option | Item/address/price/options snapshot, stock/Payment/history không đổi | DB/Order GET |
| AT28 | UI pending/409/reload error/double click/unknown | Khóa control, giữ draft, không auto retry/GET-unlock hoặc báo index synced | Component/browser |
| AT29 | Đổi Admin/cùngID phiên mới khi GET/write chờ | Không rò draft/toast/data hoặc resend phiên cũ | Deferred/browser |
| AT30 | Migration fresh/upgrade/revision max/audit | Giữ legacy values/receipts; không sửa migration cũ; no-secret audit và no overflow | Migration/DB |
| AT31 | Tên definition/option value trùng sau NFC/case/whitespace, kể cả inactive, hai slug khác nhau | Một bản ghi theo normalized key; conflict định danh; upgrade có duplicate dừng an toàn, không auto merge/xóa | Hai connection/migration |
| AT32 | Policy có confirm nhưng thiếu/null/rỗng/whitespace/ngoài10–500codepoints/control chars ở reason | 400đúngmã, giữ draft; DB/revision/audit/job không đổi; sortOrder vô hại không bắt reason | HTTP/component/DB |
| AT33 | Policy reason hợp lệ có whitespace/Unicode NFC, body giả actor/time/correlationId | Reason chuẩn hóa lưu đúng; context server đúng actor/entity/command/time/correlationId; extra body bị chặn, không suy reason từ diff | HTTP/DB |
| AT34 | Audit reason insert lỗi hoặc job lỗi sau khi audit chuẩn bị | Rollback cả reason/audit/metadata/revision/job; không response success hoặc retry ghi thừa | DB fault |

Fixture: Category lá/cha/inactive, definitions4type, optionsactive/inactive,
Product DRAFT/APPROVED/hidden/frozen, Order snapshot và hai Admin/Seller. Dữ liệu
NUMBER0/BOOLEANfalse phải có thật. DB/index QA mới riêng, không DB demo5432.
Mutation test dùng API thật và kiểm row/audit/job/version/outbox trước/sau;
mock HTTP không thay DB race hoặc integration Backend–FastAPI.
Race cần hai connection/app và barrier quan sát được, không chỉ Promise.all/sleep.
Fault sau commit và trước commit phân biệt rõ; không log token/key/PII/raw config.
Mỗi lần ghi head/schema/fixture/expected/actual/PASS/FAIL/NOT_RUN và giới hạn.
Trước bàn giao code: lint/build/unit/E2E/Prisma validate/migration tests/diff-check;
chỉ nhận Search runtime nếu thật sự chạy worker→FastAPI→ES/FAISS→hydrate cô lập.
