# Hậu mãi Backend —26/10/2026

IN_PROGRESS trên `codex/aftersales-runtime`, base develop `f260192`. Không nhận
toàn hậu mãi/UI/Dashboard DONE. [Contract runtime](../api/aftersales-runtime.md).

## Môi trường và phạm vi bằng chứng

Chỉ QA `bckl-safe-qa-20261021`, loopback5549, DBv950. Demo `bckl_postgres` dừng.
Lượt đầu bị guard chặn khi demo đang chạy, trước kết nối QA; dừng riêng container
theo quyền đã cấp, không xóa volume/dữ liệu. Kết nối QA startup chưa sẵn sàng đã
được chẩn đoán chỉ đọc và thử lại, không đổi profile/password/role.

Fresh26 migrations đã áp dụng trên DB mới, sau đó migration27 bổ sung history
binding; không sửa26 đã áp dụng. Upgrade SQL thực25→26→27 trong schema riêng
của suite nâng cấp giữ User/Store/audit/refresh cũ; không DROP/reset schema chung.
Schema diff phải không khác biệt trước bàn giao; index map Prisma khớp tên SQL
lowercase, không sửa SQL cũ để che lệch metadata.

26 hậu mãi HTTP/PG tests chạy application role NOSUPERUSER/NOCREATEDB/NOCREATEROLE;
full E2E dùng migrator cho DDL suites, không gọi toàn suite là least privilege.
D07 suite riêng tạo DB `bckl_order_resolution_test_d07_20261026_<16hex>` bằng
migrator qua guard exact parent QA hoặc GitHub CI. DB giữ lại, không xóa hàng đợi
chung. Helper từ chối dotenv, sai host/port/role/db/query/hash trước provision.

## Các ca đã chạy

- Full PostgreSQL E2E cuối940PASS/1SKIP/20TODO,58filesPASS/2SKIP,312.36s. Bao gồm
 25→26→27 upgrade thực và D07 private DB migrate fresh đủ27migration. Không dùng
 kết quả940 này để gộp các SKIP/TODO vào PASS.
- Full unit Backend1411PASS/64files, gồm63money/state/input và7guard D07 mới.
- HTTP/PG hậu mãi26PASS: hai key tạo giữ chỗ, reject→request mới vs dispute cũ,
  hai quyết định cùng revision, Seller khác Store, Seller mua bật/tắt cờ, token
  stale và actor bị revoke lúc chờ User lock, expiry, read-only pagination.
- RefundOnly không kho; receive restockable true/false; duplicate replay; stock
  overflow và lỗi outbox rollback toàn bộ; close-before-create/receive không
  tự thực thi; concurrent writer/closure; valid-shaped future audit503 không
  sửa fence; SQL không cho hai UUID nhận cùng history hoặc sửa ledger.
- Buyer và system completion kích hoạt refund chờ cùng commit; completion vs
  refund đồng thời không bỏ lại effectiveAtNULL; refund sau completion hiệu lực
  ngay. Unit kiểm tiền lẻ, net âm kỳ sau và biên UTC+7; chưa Dashboard aggregate.
- Fixture safety9Node tests PASS; fixture live PASS bằng app-role trênv950,
  namespace `aftersales-qa-bbcf2516-5fd8-4b40-9822-4ac3980f2535`,3actor/3Order,
  credential chỉ nằm private artifacts. Schema diff cuối: No difference detected.
- Backend typecheck/lint/build PASS, không bỏ lỗi thật vì lý do hạn mức CI.

## Phát hiện trong quá trình kiểm và cách xử lý

1. Fixture nested OrderItem không nhận storeId do Prisma tự thừa kế composite
   Order relation; bỏ field thừa. Fixture Variant bổ sung optionSignature.
2. Fixture discount phải giữ Order total CHECK: đổi total theo discount trước
   gọi API422, không disable DB constraint. Đã restore đúng snapshot để kiểm
   stale session độc lập. Đây là fixture lỗi, không phải API bỏ qua invariant.
3. Seller Buyer access mặc định off của nền chung được giữ; test kiểm cả off403
   và on200, restore env sau ca. Không tự bật cờ trên develop để làm test xanh.
4. Full E2E đầu có3D07failure: scheduler mỗi tick nhận20job nhưng QA giữ lại nhiều
   đơn DELIVERED từ lượt hậu mãi trước; test cũ giả định target được nhận tick
   đầu. Read-only query thấy25aftersale fixtures chờ (4PENDING/21UNDISCOVERED).
   Tách DB cho **suite test D07**, giữ nguyên production worker batch/cron/deadline,
   không xóa/backdate/filter queue chung. Suite D07 tách DB18/18PASS; full suite
   được chạy lại để nghiệm thu bản kết hợp, không coi rerun xanh tự nó là root cause.
5. Probe dữ liệu hỏng có kiểm soát: một command approve trỏ tới history
   PENDING→CANCELLED vẫn trả200 nếu chỉ kiểm shape/hash. Trước sửa25PASS/1FAIL;
   bổ sung kiểm `nextReturnState(fromState,kind,scope,action)===toState`, creation
   cần provenance0→1/null→PENDING. Sau sửa26/26app-role và full940PASS, receipt
   sai ngữ nghĩa503 giữ nguyên DB/ledger, không bịa fence mới.

## Review độc lập và giới hạn

Gemini Argon Medium rà snapshot contract/migration/input/service/controller/
policy, SUCCESS/NONE P1/P2. Delta future-audit guard/Unicode/index mapping cũng
NONE. Review tĩnh không phải human GitHub approval hoặc live QA độc lập.
Helper/fixture QA được reviewer đọc riêng; kết quả lưu local deliverables.
Một snapshot delta bị đóng gói sai thành `System.Object[]` đã bị loại khỏi bằng
chứng code review. Bản thay thế chứa371dòng source thật được Gemini đọc đầy đủ,
NONE P1/P2; không lấy nhận xét có điều kiện của snapshot lỗi làm approval.

Log local (không commit): `deliverables/aftersales-e2e-app-final-20261026.log`,
`aftersales-e2e-semantic-final-20261026.log`, `aftersales-unit-release-20261026.log`,
`aftersales-schema-final-20261026.log`, `aftersales-fixture-20261026.log`.
Source cuối của26ca app-role: `aftersales-receipt-transition-after-20261026.log`.

Chưa kiểm Chrome/UI (chưa có UI), packet loss vật lý, multi-process crash,
provider tiền thật hoặc live AI index. “Mất phản hồi” ở đây chứng minh replay/
explicit reconcile sau một write HTTP đã commit, không giả đã thử mạng vật lý.
1SKIP/20TODO baseline phải giữ báo cáo riêng nếu full suite còn các mục này.
Không commit log/profile/credential/dataset/model/index. Không xóa audit QA.
