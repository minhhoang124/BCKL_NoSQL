# Chuẩn bị triển khai Admin thuộc tính — 16/10/2026

PROPOSED, base035656b. [Contract](../api/admin-category-attributes-contract.md),
Đồng bộ 17/10 lên develop `ad3b969` sau #28; không đổi contract đã duyệt.
Đồng bộ tiếp develop `7e58255` sau #58, giữ cả thiết kế Order recovery.
Không lấy #62 còn OPEN làm resolver đã triển khai; không bật Seller POST.
[34ca acceptance](../testing/admin-category-attributes-acceptance.md).
Không API/schema/migration hoặc test runtime mới trong PR tài liệu này.

## Bước tiếp theo theo thứ tự

1. Hiền và Đạt đã approve contract b69b06b, gồm reason FR-ADM-01 và Search.
   Review delta đồng bộ sau #28 trước merge #65; không thay semantics đã duyệt.
   Chỉ triển khai schema/API sau khi contract merge; không nhận 34 ca NOT_RUN
   là bằng chứng runtime.
2. Audit mọi consumer POST/PATCH attribute, lỗi Catalog và writer ProductValue/
   submit/public/outbox. Chốt lock protocol cho mutation Admin cạnh tranh Seller;
   không thêm field DTO mà để normalizeAttributeValue đọc state ngoài giao dịch.
3. Migration mới revision definition + audit/normalized uniqueness theo contract đã được duyệt. Không
   sửa migration dùng chung hoặc backfill giá trị Product. Kiểm fresh/upgrade.
4. PR Backend read: Admin list/detail/options cả inactive, pagination/bounded
   response/nesting/auth. Public/Seller API không bị mở quyền quản trị.
5. PR write: DTO fields còn thiếu, option create/patch, CAS/shared parent revision,
   rule gates/audit/durablejob cùng transaction. Test rollback/race trước UI.
6. Public/submit/index projection coherent, optional inactive không null giả;
   verify worker không event thừa; không thay contract AI shape tự ý.
7. Backend merge/review rồi Hiền nối editor riêng #28/#64, giữ Category/Brand
   đã có. Browser thật trên QA, reload/draft/409/unknown/session. Chưa nghiệm thu
   toàn Admin từ API đơn lẻ hoặc panel mock.

## Phạm vi file khi triển khai sau review

- BE/src/catalog: Admin controller/service + DTO + tests; giữ public controller.
- BE/prisma: schema + migration MỚI, audit/revision theo quyết định được duyệt.
- BE/src/product: chỉ các điểm normalize/submit/public cần bảo vệ rule cạnh tranh;
  không lẫn ProductOptionGroup/SKU hoặc đổi lifecycle Seller ngoài contract.
- BE/src/search: projection/producer hiện có khi cần, không FastAPI shape change.
- BE/test: RBAC/nesting/validation/rollback/concurrency/migration/worker cases.
- FE editor/route: Hiền thực hiện sau Backend; Hoàng review, không làm trùng.

## Checkpoint và ranh giới

Tài liệu là đầu vào review, không nhận lịch hoặc approval thay Hiền/Đạt. Những
field revision/audit/expectedRevision và mã lỗi mới còn đề xuất; không yêu cầu UI
gọi ngay endpoint chưa có. Không tự đổi SRS cho khớp code chưa review. Dùng bản
SRS v3 đang merge, không quay về v0.5. Type mapping vẫn TEXT/NUMBER/BOOLEAN/
SINGLE_SELECT, một value/Product/definition; multi-select là thiết kế riêng.

Kết quả đợt tài liệu: source audit + Markdown link/fence/diff checks; AT01–34
NOT_RUN. Không Docker/test fixture hoặc demo DB bị thay đổi. Test implementation
chỉ bắt đầu sau chốt contract, không dùng số test nền cũ làm proof mới.
