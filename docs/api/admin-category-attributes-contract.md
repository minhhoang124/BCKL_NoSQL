# Admin quản trị thuộc tính ngành hàng — đề xuất v1

Ngày 16/10/2026; baseline `develop 035656b`. **PROPOSED / CHỜ REVIEW**.
Đồng bộ ngày 17/10 lên `develop ad3b969` sau merge #28. Hiền và Đạt đã
approve bản `b69b06b`; delta đồng bộ cần review lại. Giữ nguyên nội dung
nghiệp vụ đã duyệt, chưa triển khai runtime hoặc migration.
Sau merge #58, đồng bộ lên develop `7e58255`; Hiền đã approve `2d637e9`.
Lần đồng bộ này giữ nguyên semantics/34acceptance, cần review delta sau push.
Chỉ tài liệu, chưa thêm API/schema/migration. Hoàng thiết kế/Backend; Hiền review
nghiệp vụ và triển khai editor sau Backend merge; Đạt review tác động Search.

Nguồn: [SRS v3](../analysis/hien/srs-v3.md) FR-CAT-01/FR-PRD-01/FR-ADM-01,
[Product domain](../architecture/product-domain-design.md),
[phạm vi](../project/implementation-scope.md), [contract AI](ai-service-contract.md).
Đây là cấu hình thuộc tính mô tả theo Category, KHÔNG là ProductOptionGroup/Value
tạo SKU, không thêm MULTI_SELECT khi schema hiện chỉ hỗ trợ một value/definition.

## 1. Audit hiện trạng có thể kiểm từ source

| Thành phần | CURRENT tại 035656b | Thiếu/rủi ro cần xử lý trong PR code sau |
|---|---|---|
| Public GET categories/:id/attributes | Chỉ definition/option active, đường dẫn Category public | Không dùng để hiển thị toàn bộ quản trị |
| Admin POST attributes | name/slug/type/required/filterable/custom/order | Chưa giới hạn đổi cấu hình theo usage hoặc concurrency revision |
| Admin PATCH attributes | name/dataType/isRequired/isActive/allowsCustom | Chưa slug/isFilterable/sortOrder; cho đổi dataType đã dùng; luôn enqueue Category |
| Admin GET attributes/options | Chưa có controller | Cần đọc cả Category/definition/option đã tắt |
| Admin POST/PATCH options | Chưa có controller | Không giả API public/Product option là API quản trị |
| Schema | Definition unique(categoryId,slug), option unique(definitionId,slug), ProductValue unique(productId,definitionId) | Chưa revision cấu hình/audit Admin thay đổi |
| Seller/public predicate | Chỉ definition trực tiếp của category Product, không kế thừa | false và 0 hợp lệ; SINGLE_SELECT cần option active hoặc custom khi cho phép |
| Search | Durable enqueueCategory + worker đọc lại canonical Product và phát version/outbox | Không trực tiếp gọi ES/FAISS trong controller; job accepted khác index synced |

Source: `BE/src/catalog/{admin-catalog.controller,catalog.service}.ts`, DTO attributes,
`BE/prisma/schema.prisma`, `product.service.ts`, `product-public-policy.ts`,
`search-outbox.service.ts`, `search-reconciliation.service.ts`.
Public projection hiện có thể trả null cho optional value trỏ option đã tắt;
đợt code cần test và thống nhất projection, không suy tắt option là xóa lịch sử.

## 2. API đọc dành riêng Admin

JWT + kiểm current account active/ADMIN theo cơ chế Backend, không tin actor client.
Guest401; role khác403. Admin được đọc cấu hình Category inactive; public API giữ
bộ lọc cũ. ID nguyên dương <=2147483647; sai nesting trả404 chung.

| Method/path | Contract đề xuất |
|---|---|
| GET /admin/categories/:categoryId/attributes | Query limit(default50,max100), afterId(optional), isActive(optional boolean thật); mặc định gồm bật/tắt |
| GET /admin/categories/:categoryId/attributes/:attributeId | Một definition đầy đủ metadata/revision; không tự nhúng vô hạn mọi option |
| GET /admin/categories/:categoryId/attributes/:attributeId/options | Cùng cursor/limit/isActive; mặc định gồm bật/tắt |

List `{items:[...],nextCursor:number|null}`; thứ tự ID tăng cho cursor ổn định,
`sortOrder` là dữ liệu UI, không giả cursor ID với sortOrder thay đổi. UI phải tải
hết trang hoặc hiển thị rõ chưa tải hết; không gọi một trang là toàn bộ dữ liệu.
Mọi response `Cache-Control:no-store`; limit không nhận float/âm/string lạ,
query trùng/field thừa bị từ chối. Không nhận parent/Store/actor override.

Definition detail ví dụ (chưa tồn tại runtime):

```json
{
  "id": 31, "categoryId": 12, "name": "Kết nối", "slug": "ket-noi",
  "dataType": "SINGLE_SELECT", "isRequired": false, "isFilterable": true,
  "allowsCustom": false, "sortOrder": 0, "isActive": true, "revision": 2,
  "usage": {"referencedProductCount": 6},
  "createdAt": "2026-10-16T06:00:00.000Z", "updatedAt": "2026-10-16T06:01:00.000Z"
}
```

Option `{id,attributeDefinitionId,value,slug,sortOrder,isActive,referencedProductCount}`.
`usage` là số DISTINCT Product ở thời điểm đọc, không phải quyền đổi kiểu/đổi nghĩa.
Backend kiểm lại usage trong transaction ghi; không nhận số usage từ client.
Option list kèm `definitionRevision` để editor phát hiện cấu hình đổi khi tải trang.
UI hủy phiên/tải lại khi revision khác giữa các trang, không ghép snapshot giả.

## 3. API ghi và validation

| Method/path | Body được phép |
|---|---|
| POST /admin/categories/:categoryId/attributes | name,slug,dataType,isRequired?,isFilterable?,allowsCustom?,sortOrder?,isActive?,confirmPolicyChange?,reason? |
| PATCH /admin/categories/:categoryId/attributes/:attributeId | expectedRevision + ít nhất một field metadata phía trên + confirmPolicyChange?,reason? |
| POST /admin/categories/:categoryId/attributes/:attributeId/options | expectedRevision,value,slug,sortOrder?,isActive? |
| PATCH /admin/categories/:categoryId/attributes/:attributeId/options/:optionId | expectedRevision + ít nhất một value/slug/sortOrder/isActive + confirmPolicyChange?,reason? |

Không DELETE cứng, không đổi categoryId/definitionId/ID từ body, không tạo Product
value hộ Seller. Không mutation từ GET; option đúng definition đúng Category.
Strict body, reject null/extra/array/type coercion không chủ đích. PATCH{} lỗi400.
SRS TC25 yêu cầu không tạo definition trùng tên chuẩn hóa: đề xuất NFC, trim,
gộp whitespace, lowercase tiếng Việt nhưng giữ dấu; unique trong cùng Category,
kể cả definition inactive (phải mở lại thay vì tạo bản sao). Option value áp
cùng nguyên tắc trong definition. Slug unique đơn lẻ chưa chứng minh điều này.
Chốt hàm chuẩn hóa dùng chung và unique normalized key ở migration mới sau review;
không chỉ check-then-create trong một process. Dữ liệu cũ trùng phải xuất audit
và xử lý có quyết định, không tự gộp/xóa ProductValue khi migrate. Đây là dependency
riêng cần kiểm upgrade trước bật rule, không nhận DB hiện có đã bảo vệ tên chuẩn.
Đề xuất giới hạn: name/value trim2–120 ký tự; slug2–140, regex
`^[a-z0-9]+(?:-[a-z0-9]+)*$`; sortOrder integer0..2147483647; bool JSON thật.
Default isRequired/isFilterable=false, isActive=true, sortOrder0; allowsCustom=true
giữ tương thích mặc định hiện hành. Với non-SINGLE_SELECT, allowsCustom không
quyết định cách đọc value; không tự chuyển TEXT/NUMBER/BOOLEAN thành lựa chọn.
Không có đơn vị NUMBER mới trong scope; NUMBER/BOOLEAN tiếp tục dùng type hiện có.

Chỉ SINGLE_SELECT được quản lý options. Không bật một required SINGLE_SELECT
không cho custom nhưng không có option active; cấu hình theo thứ tự inactive
definition → thêm option → bật/required. Optional definition thiếu option có thể
lưu nhưng UI báo chưa có lựa chọn, không bịa danh sách.

POST201/PATCH200 trả `{definition:<detail>,option:<option|null>,searchReconciliation:
{jobId:string,status:string}|null}`. Job dùng status enum thực của DB, jobId decimal
string; không báo synced từ job pending. POST definition không phải idempotent;
slug unique ngăn bản sao cùng slug nhưng không thay receipt. FE không auto replay
write401/timeout/5xx; kết quả chưa rõ phải khóa ghi trong instance và giải thích
giới hạn reload như Brand #64, không nhận đã có recovery bền vững.

## 4. Quy tắc thay đổi có ảnh hưởng — Hiền đã chốt nghiệp vụ, chi tiết sửa chờ re-review

Review Hiền tại fc7c35b ngày16/10 đã đồng ý các nguyên tắc dưới đây; không phải
approval implementation hoặc thay review Đạt về Search. Theo FR-ADM-01, mutation
policy nhạy cảm cần **confirmPolicyChange=true VÀ reason**. Reason là chuỗi trim
10–500 Unicode code points sau NFC, không null/rỗng/whitespace; reject control
characters ngoài newline/tab, không cắt chuỗi âm thầm. Client giữ draft và báo lỗi;
Backend kiểm lại trước mutation, không tự sinh lý do từ old/new values.
Áp dụng khi tạo required active hoặc thực sự đổi required/active/allowsCustom
của definition, hay tắt option đang dùng/bật lại option có thể ảnh hưởng listing.
Không phụ thuộc usage client, không dùng reason để vượt gate type/slug in-use.
sortOrder-only/isFilterable-only vô hại không bắt lý do policy; nếu có reason thì
vẫn validate. Gửi chỉ reason/confirm không có metadata thật vẫn là PATCH trống.
Confirmation nói rõ có thể ngừng public **hoặc public trở lại**; reason không
thay confirmation. Thiếu/sai reason trả400 ATTRIBUTE_POLICY_REASON_REQUIRED/
ATTRIBUTE_POLICY_REASON_INVALID, không mutation/revision/audit/job. Thiếu confirm
vẫn409 ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED; lỗi không được tự replay write.

| Thay đổi | Quyết định đề xuất | Ảnh hưởng |
|---|---|---|
| dataType khi có ProductValue bất kỳ, kể cả Product DRAFT/hidden | 409 ATTRIBUTE_TYPE_IN_USE; không convert/xóa giá trị | Tạo definition mới rồi Seller chuyển giá trị trong workflow riêng |
| dataType chưa có ProductValue nhưng còn option (kể cả inactive) | 409 ATTRIBUTE_OPTIONS_EXIST nếu đổi khỏi SINGLE_SELECT | Không bỏ dữ liệu cấu hình ngầm; định nghĩa mới thay thế |
| slug definition khi có ProductValue | 409 ATTRIBUTE_SLUG_IN_USE | Giữ định danh cấu hình ổn định; payload Search hiện dùng NAME làm key, không phải slug; sửa nhãn name có thể rebuild payload |
| value/slug option khi có ProductValue tham chiếu | 409 ATTRIBUTE_OPTION_IN_USE | Tránh đổi “Đen” thành “Đỏ” trên listing cũ; tạo option mới, tắt cũ có xác nhận |
| isRequired false→true, bật lại definition required, allowsCustom true→false cho SELECT | Cho phép khi confirmPolicyChange=true, không điền hộ Product | Product thiếu dữ liệu bị loại public ngay theo predicate; Seller bổ sung/submit theo workflow hiện có |
| Tắt option đang dùng | Cho phép confirmPolicyChange=true, không xóa ProductValue | Required thiếu option hợp lệ có thể mất public; optional bỏ value vô hiệu khỏi projection/index |
| Tắt definition / bỏ required / mở custom / bật option | Cho phép có confirmPolicyChange=true khi thay quy tắc | Có thể làm listing APPROVED/ACTIVE đủ điều kiện lại; ghi job, không tự đổi moderation |
| name, sortOrder, isFilterable | Không sửa ProductValue | name có thể đổi nhãn; sortOrder/filterable không tự thêm filter Search mới |
| No-op metadata | Không tăng revision, không job, không audit mutation mới | Vẫn kiểm revision/ownership đầu vào |

Quy tắc category hiện tại: definition chỉ áp trực tiếp, không tự kế thừa từ cha.
Cấu hình Category nonleaf không mở quyền gán Product vào nonleaf. Không tự đặt
mọi Product về DRAFT khi Admin đổi rule; giữ moderation/sellerStatus và dùng
predicate hiện hành. Khác với Seller sửa nội dung Product cần duyệt lại theo SRS.
Hiền đã chốt chỉ public lại nếu Product vẫn APPROVED + sellerStatus ACTIVE và
TOÀN BỘ predicate canonical hợp lệ: Store/account/Category/Brand/required/variant/
ảnh/shipping... Không hồi sinh DRAFT/HIDDEN/FROZEN/REJECTED hoặc account/Store
không đủ điều kiện. Worker không dùng snapshot cũ để suy public lại; chưa áp code.
Giữ OrderItem/address/price/options snapshot, tồn kho/Payment/history Order nguyên vẹn.
Không dùng “tắt” để thay đổi nội dung Order cũ. Inactive definition/value vẫn có
trong Admin/historical Seller view với nhãn; không cho chọn mới ở form Seller.
Không tự đoán/điền dữ liệu thiếu hoặc backfill false/0 thành empty.

## 5. Chống ghi đè và giao dịch — proposal, chưa migration

Đề xuất thêm `CategoryAttributeDefinition.revision Int default1` ở migration mới
sau review, khác hoàn toàn Product.version. Option mutation tăng revision definition
cha; cả hai Admin sửa definition/options phải dùng expectedRevision mới nhất.
POST definition dùng unique(categoryId,slug); không cần giả revision Category.
Revision stale trả409 ATTRIBUTE_REVISION_CONFLICT, giữ draft, GET lại và người
dùng đối chiếu; không tự retry bằng revision mới hoặc ghi đè silent.

Transaction khóa/serialize cấu hình definition rồi kiểm usage/option/state và
CAS revision; bounded retry cho lỗi transaction đã phân loại, không retry409business.
Kiểm usage ngoài transaction là chưa đủ: Seller ghi ProductValue/đổi category/submit
cũng phải tham gia protocol tương thích hoặc Serializable + retry có proof.
Không tự chọn row-lock order trái protocol Product hiện có; PR implementation
phải nêu lock ordering và có test hai connection trước merge. Không một-process lock.

Trong cùng commit: metadata + revision + audit Admin (reason chuẩn hóa, actorId
Admin đã xác minh, entity type/ID/Category, command, thời gian DB, correlationId
server sinh/kiểm an toàn, old/new field allowlist, không token/raw key) + durable
reconciliation job khi cần. Không tin actor/time/correlationId tùy ý từ body;
không suy reason từ diff hoặc chỉ log reason ngoài transaction. Audit model
mới phải được review migration riêng, không ghi “đã có audit” từ updatedAt.
Nếu job/audit/CAS lỗi: rollback toàn mutation; không trả success trước có durable
work. Response xác nhận nhận việc, worker retry/checkpoint đọc canonical state.
Revision tới Int max thì409 ATTRIBUTE_REVISION_EXHAUSTED, không reset/tràn.

## 6. Ma trận đồng bộ Search

| Mutation thật | Enqueue | Worker / read policy |
|---|---|---|
| Required/active/custom thay đổi; option active thay đổi | Category khi có khả năng ảnh hưởng Product | Kiểm canonical; invalid DELETE, valid payload khác UPSERT |
| Name/slug/value định nghĩa/option được phép sửa | Category nếu có Product đang dùng chịu ảnh hưởng payload | Rebuild payload, giữ Product.version tăng đơn điệu/outbox atomic |
| sortOrder-only / isFilterable-only | Không khi payload/eligibility hiện hành không dùng field đó | Không tự thêm filter vào FastAPI contract |
| Tạo optional chưa có Product dùng; tạo option chưa dùng; no-op | Không | Không phát event Product không bị ảnh hưởng |

Có thể dùng enqueueCategory hiện có làm coarse job; worker phải skip Product có
payload/predicate không đổi, không nhận coarse scope là mọi Product đều cần event.
Không nhầm đồng bộ rule với đổi nội dung/duyệt lại Product. Khi public predicate
không còn đạt, Backend list/detail/Cart/Checkout/hydrate kiểm canonical ngay,
không chờ ES/FAISS xóa xong. Đợt code phải bổ sung projection optional option
inactive nhất quán cho publicProduct và buildUpsertPayload, không trả null rỗng
làm giá trị giả. Search payload shape không đổi; thay semantics vẫn nhờ Đạt review.
Relax rule chỉ worker/read dựa vào state hiện tại, không phát UPSERT từ snapshot cũ.

## 7. Lỗi và UX

400 VALIDATION_ERROR/ATTRIBUTE_PATCH_EMPTY/ATTRIBUTE_OPTIONS_NOT_SUPPORTED;
401/403 chuẩn Auth;404 ATTRIBUTE_NOT_FOUND/ATTRIBUTE_OPTION_NOT_FOUND/CATEGORY_NOT_FOUND;
409 SLUG_CONFLICT/ATTRIBUTE_NAME_CONFLICT/ATTRIBUTE_OPTION_VALUE_CONFLICT/
ATTRIBUTE_REVISION_CONFLICT/ATTRIBUTE_TYPE_IN_USE/
ATTRIBUTE_OPTIONS_EXIST/ATTRIBUTE_SLUG_IN_USE/ATTRIBUTE_OPTION_IN_USE/
ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED/ATTRIBUTE_REVISION_EXHAUSTED.
409config thiếu lựa chọn: ATTRIBUTE_REQUIRED_OPTIONS_EMPTY. 500sanitized khi lỗi
không dự kiến; transaction contention cạn retry không giả business409 đã biết.
Envelope mới phải chốt với filter Catalog hiện hành trước code, không nhận mã
trên là runtime đã có. Quota/body limit theo hạ tầng Admin; bổ sung bounded policy
trong PR triển khai, không tự copy quota C2 hoặc tắt bảo vệ.

UI loading/empty/error/ready; hiển thị inactive và usage; form giữ draft khi
validation/409, khóa selection/input/tab/refresh khi write pending. Không PATCH
trước confirmation; stale revision không tự ghi đè, unknown không GET-based unlock.
Không cho ProductAttributeValue nhầm CategoryAttributeOption thành ProductOptionValue.

## 8. Điều kiện mở implementation

Hiền và Đạt đã approve bản b69b06b, gồm reason/validation/audit và
projection/invalidation mục6. Bản đồng bộ sau #28 cần review delta tài liệu;
không coi approval contract là approval implementation hoặc runtime PASS.
Sau đó mới migration mới → Backend Admin read → definition/option writes +
Seller/public/Search coherence → test thật → merge → Hiền nối UI.
Không giữ “hợp lệ theo code” bằng cách tự cập nhật SRS ngược khi quyết định chưa duyệt.

Từ dễ hiểu: contract = quy ước request/response; revision = số phiên bản cấu hình;
CAS = chỉ ghi nếu phiên bản còn đúng; durable job = công việc lưu DB qua restart;
canonical = dữ liệu chuẩn PostgreSQL; projection = phần dữ liệu trả ra/index;
invalidation = đánh giá lại sản phẩm sau thay đổi quy tắc.

[Ma trận kiểm thử](../testing/admin-category-attributes-acceptance.md) và
[checklist triển khai](../architecture/admin-category-attributes-readiness.md).
