# Admin Attributes write API — runtime PR, 22/10/2026

**IN_PROGRESS / RUNTIME REVIEW, chưa merge.** Contract nghiệp vụ là
[Admin Category Attributes #65](admin-category-attributes-contract.md). Không thay
contract bằng các diễn giải từ code. Bốn endpoint dưới đây đã có đường HTTP →
service → PostgreSQL thật; được promote lên branch riêng từ develop đã có nền,
chưa có runtime này trên develop và chưa phải
bàn giao chính thức để bật editor của Hiền.

## Nền và giới hạn tích hợp

Branch `codex/admin-attribute-write-api`, từ develop `e394c9e`. Các nền
#83/#87/#91/#92/#93 đã merge chính thức. Chỉ promote delta runtime đã kiểm
từ candidate local, giữ Health #89, upload #90, ownership #85 và UI #59 mới.
Migration normalized uniqueness thuộc #92; không sửa migration đã dùng chung
hoặc thêm schema mới. Không dùng approval nền thay review bốn API runtime.

Fresh checkout phải áp đủ17migration chính thức. Không copy riêng controller
lên checkout thiếu policy/shared transaction boundary/normalized unique.

## API và dữ liệu

Tất cả route dùng JWT, current active ADMIN từ database; actor không nhận từ body.
Body JSON tối đa **16 KiB sau giải nén**, không query, không trường thừa/coerce
chuỗi thành bool/số. Mọi write response, gồm lỗi guard/parser, trả `no-store`.
Quota **60 write requests/phút/Admin/instance**, map tối đa 10.000 actor; 429 có
Retry-After. Đây không phải rate limit dùng chung đa replica.

| Method | Path | Body |
| --- | --- | --- |
| POST | `/admin/categories/:categoryId/attributes` | name, slug, dataType và metadata tùy chọn/confirmation/reason theo #65 |
| PATCH | `/admin/categories/:categoryId/attributes/:attributeId` | expectedRevision và ít nhất một metadata thật |
| POST | `/admin/categories/:categoryId/attributes/:attributeId/options` | expectedRevision, value, slug, sortOrder?, isActive? |
| PATCH | `/admin/categories/:categoryId/attributes/:attributeId/options/:optionId` | expectedRevision và ít nhất một metadata option; confirmation/reason khi cần |

ID/revision là JSON integer nguyên dương ≤ 2147483647; URL ID không nhận `01`,
`2e1`, âm hoặc số thập phân. Option phải thuộc đúng definition/Category. Không
DELETE cứng, không tạo ProductAttributeValue hộ Seller.

POST trả 201; PATCH trả 200. Envelope:

```json
{
  "definition": {
    "id": 31, "categoryId": 12, "name": "Kết nối", "slug": "ket-noi",
    "dataType": "SINGLE_SELECT", "isRequired": false, "isFilterable": false,
    "allowsCustom": true, "sortOrder": 0, "isActive": true, "revision": 2,
    "usage": {"referencedProductCount": 0},
    "createdAt": "2026-10-22T00:00:00.000Z", "updatedAt": "2026-10-22T00:01:00.000Z"
  },
  "option": {
    "id": 4, "attributeDefinitionId": 31, "value": "Bluetooth", "slug": "bluetooth",
    "sortOrder": 0, "isActive": true, "referencedProductCount": 0
  },
  "searchReconciliation": null
}
```

Definition write có option=null; option write trả option đã ghi. Khi cần đánh giá
lại Product, searchReconciliation là `{jobId:"123",status:"PENDING"}`. Job ID là
chuỗi decimal; response chỉ xác nhận đã lưu việc, không nói hai index đã đồng bộ.
Các ví dụ là dữ liệu minh họa, không account hoặc ID QA có thể dùng ngay.

## Giao dịch và cạnh tranh

```text
JWT/role/quota → strict parser → snapshot input bất biến
→ Serializable transaction: actor SHARE → Category fence → definition UPDATE lock
→ đọc lại revision/usage/options/Product count → policy planner
→ metadata + revision trigger + audit + durable Category job
→ response đọc trong cùng snapshot → commit → gửi HTTP
```

- Category fence là UPDATE không đổi updatedAt, tạo xung đột MVCC thật nhưng
  không thay dữ liệu thời gian; không dùng khóa trong một process.
- Option INSERT khóa cha trước, tránh deadlock nâng khóa FK. Option mutation
  tăng revision cha đúng một lần bằng trigger, không tăng thủ công thêm lần nữa.
- Retry hữu hạn cho serialization/deadlock; hết lượt trả 503 an toàn, không retry
  business 409 với revision mới. Statement/lock/transaction timeout có giới hạn.
- PostgreSQL lock timeout55P03/query cancellation57014 được map503 và
  Retry-After:1 ngay sau rollback, không chạy lại callback hoặc tự replay HTTP.
  Chỉ nhận structured Prisma/driver metadata, không đoán từ chuỗi message.
- Stale revision, kể cả no-op, trả409. No-op đúng revision không ghi lại metadata,
  revision, audit hoặc Search job. Revision max chặn thay đổi, không reset/tràn.
- Actor, dữ liệu đếm usage và effect Search do server xác định; correlationId do
  server sinh. Audit/job lỗi hoàn tác mọi thay đổi của giao dịch.
- Response PATCH/options được dựng trong transaction; không làm GET sau commit
  rồi biến lỗi GET thành hiểu nhầm cần gửi mutation lần nữa.

## Quy tắc dữ liệu

- Type/slug đã có ProductValue, kể cả DRAFT/hidden, không đổi. Không tự convert,
  xóa value hoặc backfill. SELECT còn option cũng không chuyển sang kiểu khác.
- Label option đang dùng không đổi value/slug; tạo lựa chọn mới thay thế.
- Đổi policy cần confirmation và reason 10–500 code points theo #65. Required
  SELECT active không custom phải có option active khi bật rule.
- Name/label trùng được PostgreSQL unique normalized key bảo vệ, kể cả inactive;
  conflict trả mã an toàn, không lộ message SQL.
- Admin đổi policy không tự đưa Product về DRAFT hoặc hồi sinh HIDDEN/FROZEN.
  Worker đọc canonical predicate, tăng version/outbox đúng khi cần.
- Public/Search dùng cùng projection: optional option inactive hoặc custom không
  còn được phép bị bỏ khỏi output, không trả null hoặc nhãn cũ. false/0 vẫn hợp lệ.

## Các đường ghi liên quan

| Đường ghi | Cách phối hợp |
| --- | --- |
| Admin definition/options | Cùng kernel, Category fence, parent lock, CAS, audit/job |
| Seller ProductValue | Fence Category trước đọc lại Product/definition/option; retry đọc lại quy tắc |
| Seller đổi Category | Fence cả Category cũ/mới theo ID tăng trước Product CAS |
| Seller tạo Product | Fence Category trước validate và INSERT để count canonical không bị bỏ sót |
| Seller submit | File I/O dưới image lock, rồi fence + canonical public-rule validation + CAS trong transaction |
| Seller re-submit APPROVED | DELETE outbox cùng transaction khi chuyển về PENDING |
| Moderation/show, Cart/Checkout, worker | Giữ transaction/predicate canonical hiện có; không gọi FastAPI trong transaction |
| Importer hiện hành | Chỉ tạo DRAFT và ảnh, không ghi ProductValue hoặc tự đổi Category của Product cũ. Nếu mở rộng ghi value phải tham gia cùng fence |

Đã tìm thấy và sửa dạng raw-query Prisma P2010/SQLSTATE40001 khi Seller chờ
Category fence: phải nhận diện là serialization conflict và retry cả transaction,
không trả500 hoặc hạ isolation để né lỗi.

## Lỗi và cách FE xử lý

Envelope `{statusCode,code,message}`; message an toàn, không raw body/token/SQL.
400 cho body/type/query sai hoặc reason thiếu/sai; 401/403 theo quyền hiện hành;
404 cho nesting không đúng; 409 cho stale revision, tên/slug trùng, type/slug/option
đã dùng, thiếu confirmation hoặc revision hết; 413 body quá lớn; 429 quota;
503 transaction quá bận; 500 lỗi không dự kiến đã sanitized.

FE giữ draft ở400/409 và yêu cầu người dùng đối chiếu dữ liệu mới; không tự đổi
revision rồi PATCH. Timeout/5xx/mất response không chứng minh rollback: khóa ghi
và báo kết quả chưa rõ, không auto replay POST. API này chưa có idempotency receipt
hoặc durable resolver riêng; không nhận recovery Order là recovery Catalog.

## Kiểm thử và bàn giao Hiền

Suite mới: `BE/test/admin-attribute-write-runtime.e2e-spec.ts`, gọi HTTP thật vào
hai Nest application/pool, PostgreSQL QA riêng; không mock HTTP thành công.
Một số ca bơm lỗi audit/job có chủ đích để chứng minh rollback. API Public và
Search worker/outbox được đối chiếu, nhưng không live Elasticsearch/FAISS hoặc
browser editor. Kết quả cuối phải lấy ở báo cáo runtime 22/10, không dùng số test
cũ của foundation để nghiệm thu API mới.

Fixture QA opt-in `scripts/run-attributes-handoff-qa.mjs` trong PR này có hai Admin,
Seller và Buyer riêng; DRAFT + Product đã
mua có đủ bốn kiểu thuộc tính (NUMBER0/BOOLEANfalse), option bật/tắt và một đơn
COD tạo qua `POST /checkouts` thật. Đơn có snapshot SKU không rỗng, Payment
UNPAID, history khởi tạo và một stock movement; GET Buyer/Seller đã kiểm.
Catalog approval là dữ liệu dựng QA, không phải bằng chứng luồng Seller duyệt
bán; URL ảnh chỉ là metadata fixture, chưa có file upload để nghiệm thu ảnh UI.
Mỗi lần seed tạo bundle mới, không ghi đè tài khoản/đơn cũ; credentials nằm
trong thư mục private Git-ignored. Script kết thúc thì app cũng dừng, không
coi localhost của Hoàng là môi trường chạy sẵn hoặc được chia sẻ sang máy khác.

Hướng dẫn [dựng QA trên máy nhận và nghiệm thu editor](../testing/attributes-editor-handoff-2026-10-22.md)
bao gồm Compose riêng, role hạn chế,17migration, seed mới và API loopback3014.
QA từ head PR chỉ phục vụ review; sau runtime merge mới bàn giao commit nền
chính thức để nối editor. Địa chỉ localhost của Hoàng không phải môi trường
chia sẻ cho máy Hiền. Không gửi secret/private profile lên GitHub; chưa yêu cầu
Hiền nối write hoặc nhận Admin giai đoạn3 DONE từ tài liệu này.
