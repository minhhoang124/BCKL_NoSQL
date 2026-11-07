# Khung giao dịch ghi Attributes — PREPARATION,21/10/2026

## Bổ sung canonical usage sau nền #86/#73

Nền mới `be568e0`. `run().usage` cung cấp đủ năm số đếm bất biến sau khi đã
khóa actor/Category/definition trong cùng Serializable transaction:

| Biến | Đếm gì |
| --- | --- |
| referencedProductCount | Product có giá trị của definition này, kể cả DRAFT/inactive reference |
| optionReferencedProductCount | Product tham chiếu option đang được xử lý; không chọn option thì 0 |
| optionCount | Tất cả lựa chọn của definition, kể cả đã tắt |
| activeOptionCount | Chỉ lựa chọn đang bật của definition |
| categoryProductCount | Mọi Product trực tiếp trong Category, kể cả chưa nhập giá trị; không đếm cây con |

Các số đếm này cho planner tương lai quyết định đổi type/required/options mà
không đọc usage ngoài giao dịch hoặc dùng số từ client. `optionCount` đồng thời
được dùng kiểm chữ ký sau audit. No-op không tăng revision/audit/job. Thử hai pool
quan sát khóa DB chứng minh chờ writer harness xong mới thấy Product mới.
Đây vẫn chưa là toàn bộ writer production hoặc API Attributes đã hoạt động.

Nền develop `d84381a`, sau #77/#74/#88. Đây là bước chuẩn bị code/test độc lập theo
contract #65 đã merge, **không** lấy #83/#87 chưa merge làm nền chính thức.
Không tạo migration, đổi schema/contract AI hoặc đăng ký controller/provider.
`AttributeTransactionBoundary` hiện chỉ được gọi từ test. Không báo Backend ghi
Attributes đầy đủ, Admin editor hoạt động hoặc G-LISTING/G-ADMIN hoàn thành.

## 1. Vì sao cần phần này

Admin đọc form ở revision1, nhưng một Admin khác có thể đã sửa cấu hình hoặc
Seller vừa nhập giá trị. Kiểm usage trước transaction hoặc chỉ khóa một process
không bảo vệ được dữ liệu trên nhiều kết nối. Audit và việc đồng bộ Search cũng
không được gửi kiểu best-effort sau commit: ghi lỗi phải hoàn tác thay đổi.

`run` giới hạn một definition đã tồn tại và tối đa một option trong một
giao dịch. `createDefinition` bổ sung đường tạo mới bên dưới. Khung chưa quyết định policy đổi type/slug/
required/active/custom, không phải một generic sandbox chặn mọi SQL tùy ý.
Callback là code nội bộ được tin cậy, chỉ thao tác DB qua `context.tx`, đúng
scope, await tất cả promise và không gọi HTTP/email/filesystem vì có thể retry.

### Đường tạo definition mới (chưa nối HTTP)

`createDefinition({actorId,categoryId}, prepare)` chụp scope trước await, kiểm
Admin hiện hành và fence Category trước khi đọc số Product trực tiếp thuộc
Category. Planner nội bộ tương lai nhận count trong cùng snapshot rồi trả
metadata, reason và quyết định Search. Khung chỉ copy allowlist primitive,
không nhận ID/categoryId/revision/timestamp từ plan vào INSERT.

INSERT definition revision1 → audit CREATE_DEFINITION với oldValues SQL NULL,
newValues lấy từ DB → enqueueCategory nếu planner yêu cầu; tất cả cùng một
transaction. Không callback chạy sau các bước ghi. Lỗi planner/audit/job/unique
rollback các hàng liên quan, không gọi AI hoặc sửa Product. Sequence tự tăng
có thể có khoảng trống khi INSERT rollback; không hứa sequence rollback.

Đây chưa là policy/API tạo thuộc tính: chưa normalized-name uniqueness, chưa
confirmation HTTP hoặc chứng minh planner effect đúng; concurrency cùng slug
chỉ dựa trên unique(categoryId,slug) hiện có. Không tính thành CRUD hoàn chỉnh.

## 2. Luồng và ý nghĩa biến

1. Chụp `actorId/categoryId/definitionId/expectedRevision/optionId` trước await;
   kiểm số nguyên dương tối đa2147483647, không nhận chuỗi ép kiểu.
2. Transaction Serializable, chờ pool2s, tổng transaction5s, statement2s/lock1s.
3. Khóa User SHARE rồi đọc active/ADMIN từ DB trong cùng snapshot. Token/actor
   do client tự khai không thay bước xác thực của controller tương lai.
4. Ghi fence trên Category bằng `updatedAt=updatedAt`: giá trị nghiệp vụ và
   timestamp không đổi, nhưng có một MVCC row write. Không sửa primary key;
   tránh khóa khóa-ngoại không cần thiết. Đây vẫn là **ghi cơ chế**, không gọi
   transaction này READ ONLY hoặc khẳng định không tạo phiên bản hàng vật lý.
5. Khóa definition UPDATE **trước** ghi option con; kiểm nesting và revision.
   Usage của ProductValue, kể cả DRAFT, và option được đọc lại trong transaction.
6. Callback tương lai chạy policy từ dữ liệu canonical rồi ghi metadata/option.
   Trigger foundation tăng revision. `recordChange` chỉ nhận quyết định Search
   nội bộ và target/reason, không nhận old/new snapshot/actor/time từ HTTP.
7. Kernel đọc old/new allowlist từ DB; kiểm đúng một revision/một option operation,
   ghi audit server actor/correlation UUID/thời gian DB và enqueue Category khi
   planner nội bộ yêu cầu, bằng cùng `tx`.
8. Trước commit đối chiếu lại chữ ký metadata/revision/timestamp/option/count với
   trạng thái đã audit. Không để xóa option sau audit hoặc giấu xóa option trong
   audit sửa definition. Lỗi ở bất kỳ bước nào rollback cả metadata/audit/job.

| Từ/biến | Ý nghĩa |
| --- | --- |
| revision | Phiên bản cấu hình definition; không phải Product.version |
| expectedRevision/CAS | Chỉ chấp nhận quyết định dựa trên đúng phiên bản đang có |
| canonical usage | Số Product thực tham chiếu trong transaction, không lấy từ UI |
| fence | Điểm ghi dùng chung khiến snapshot chồng lấn phải chờ/rollback-retry |
| audit | Lịch sử bất biến của thay đổi, không chỉ một dòng log hoặc updatedAt |
| durable job | Công việc lưu PostgreSQL, sống qua restart; chưa nghĩa index synced |
| searchMayBeAffected | Cờ từ planner nội bộ tương lai; kernel không tự chốt policy |
| recordedSignature | Dấu so sánh trạng thái đã ghi audit với trạng thái sắp commit |

`recordChange` có latch ngay trước await, chặn hai lần trong cùng tick. Lỗi record
bị callback nuốt vẫn làm transaction bị từ chối; context hết hiệu lực sau khi
callback kết thúc. No-op không tạo audit/job/revision và không sửa timestamp
scope. Sai revision vẫn bị từ chối kể cả callback dự định không làm gì.

Chỉ40001/40P01/P2034 được phân loại retry toàn transaction, tối đa3lần có backoff.
Không retry stale-revision409, constraint/validation hoặc mọi lỗi timeout. Cạn
retry trả503 nội bộ thay vì giả thành một business conflict đã biết. API filter,
deadline request, body/quota/confirmation/validation lỗi vẫn là gate tiếp theo.

## 3. Ranh giới phải giữ

- `fenceAttributeCategory` chưa được nối vào toàn bộ writer production. Code
  hiện tại của Seller/Admin/import/đổi Category/submit **chưa** có bảo đảm chung
  từ helper này. Không bật API mới trước khi tích hợp và có test các writer thật.
- Test value-writer dùng harness tham gia fence trên bảng thật, không gọi
  `ProductService` production. Có quan sát chờ DB thật, không suy thành Seller
  runtime đã an toàn hoặc khóa nhiều OS process đã được nghiệm thu.
- Kernel dùng một scope/transaction, không cấm callback đáng tin ghi SQL ngoài
  scope bằng một security sandbox. Không dùng helper này làm bề mặt HTTP công khai.
- Cờ effect trong test do harness cấp để kiểm machinery, không phải bằng chứng
  planner #83 đã nối runtime hoặc tất cả quyết định Search đúng nghiệp vụ.
- Job lỗi rollback; job PENDING không chứng minh có SearchOutbox, ES/FAISS đã đổi,
  Product.version đã tăng hoặc chất lượng tìm kiếm đã đạt.

## 4. Việc phải làm để có API ghi thật

1. Reviewer chốt #83 policy/CI và #87 Seller validation đúng head; không tự
   dismiss Request changes hoặc coi overall APPROVED ở commit cũ là gate mới.
2. Audit dữ liệu chuẩn hóa rồi migration mới cho uniqueness tên/value; không
   tự gộp/xóa dữ liệu cũ. Kernel hiện không tạo normalized unique constraint.
3. Tích hợp protocol tương thích cho tất cả đường nhập/đổi Category/submit và
   writer Admin, kể cả legacy routes/importer; chứng minh thứ tự khóa không chu kỳ.
4. Nối policy chuẩn vào cả createDefinition/run, xây bốn endpoint POST/PATCH,
   parser/DTO/guard/quota/no-store/filter lỗi, audit effect/no-op chính xác.
5. Thống nhất projection optional inactive ở public/hydrate/index; test worker
   canonical, Product.version/outbox đơn điệu và không phát event thừa.
6. Qua review/CI rồi merge, mới bàn giao commit/API/QA cho Hiền nối editor.

Không sửa SRS ngược để mô tả khung chuẩn bị này là chức năng đã hoàn thành.
[Bằng chứng kiểm thử](../testing/attribute-transaction-boundary-2026-10-21.md).
