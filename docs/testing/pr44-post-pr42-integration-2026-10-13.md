# PR #44 — đồng bộ sau merge #42, ngày 13/10/2026

## Phạm vi và nguyên nhân

Nhánh `codex/order-cancellation`, head trước sửa `30669b5`, được merge an toàn
với `origin/develop ad1771b` (API detail #42 đã merge). Không rebase/force push,
không lấy code #43 còn OPEN và không tự merge PR.

Bốn conflict: OrderModule, test Order list, Order command readiness và tổng quan
kiến trúc. Hai phía đăng ký/ghi trạng thái khác nhau cho detail và cancellation.
Giữ cả list/detail/cancel và SearchModule; không thêm Seller preparation chưa merge.

## Những thay đổi kiểm thử

- `order-cancellation.e2e-spec.ts`: exact UPSERT payload (dữ liệu gửi Search),
  không dùng lại production builder làm expected: productId/version, name,
  description, categoryId/name/path cha–con, brandId/name, attributes, ảnh primary
  trước ảnh secondary, giá Decimal string khác nhau (`10000`/`20000`) và inStock.
- SUSPENDED/CLOSED Store: exact DELETE `{productId,version}`, chỉ tăng version
  một lần và thêm đúng một event. Seller replay qua app thứ hai giữ nguyên DB.
- HTTP Checkout → Buyer cancel → Buyer/Seller GET detail: snapshot items/address
  và total không đổi dù giá catalog đã khác; Payment CANCELLED, timeline và audit
  đúng. Không trả key/hash/receipt nội bộ. Receipt Checkout/Cart/stock invariants
  và replay qua process/restart vẫn được kiểm tra trong 49 cancellation cases.
- Swagger list/detail xác nhận cả read API đã merge và cancel; Seller confirm
  chưa có, không nhận #43 đã tích hợp.
- Cleanup xóa chỉ fixture của suite, gồm parent category và brand mới.

## Kết quả thực chạy

Database mới riêng `127.0.0.1:5549/bckl_pr44_post42_20261013`, container
`bckl-checkout-web-qa-20261012`, PostgreSQL 17. Không thao tác database demo.
Không có root/BE `.env` trong worktree; cấu hình QA đặt riêng ở process.
Search sync/reconciliation/image-repair cron tắt bởi test setup.

| Kiểm tra | Kết quả |
|---|---|
| pnpm install --frozen-lockfile | PASS, lockfile không đổi |
| Prisma validate | PASS |
| Fresh migration deploy | PASS, đúng 12 migration trong checkout |
| Prisma migrate status | PASS, database up-to-date |
| git diff --check (staged và diff so với develop) | PASS |
| Backend typecheck/lint/build | PASS |
| Backend unit | 424/424 PASS, 21 suites |
| Order cancellation + detail + list E2E | 108/108 PASS, 3 suites, 23.04s |
| Full Backend PostgreSQL E2E | 428/428 PASS, 23 suites, 105.56s |
| Frontend lint/test/build | PASS, 122/122 test, 15 suites |
| Diff/schema/lockfile/FastAPI scope | Không đổi schema, migration, lockfile, FastAPI hoặc Frontend so với develop |

Lượt targeted đầu 106/108: ảnh fixture sortOrder âm vi phạm CHECK và Swagger
detail cũ yêu cầu route cancel không tồn tại. Đã sửa fixture thành thứ tự hợp lệ,
cập nhật expectation cho head kết hợp, rerun targeted và toàn bộ E2E PASS.
Không nới constraint hay bỏ test để che lỗi. Log forced failures là test rollback;
cảnh báo pg concurrent query/Vite tsconfig-paths vẫn tồn tại, chưa tuyên bố sửa.

## Checklist bàn giao và giới hạn

- [x] Giữ API detail #42 và hủy COD #44 trong cùng OrderModule.
- [x] Payload UPSERT/DELETE được đối chiếu đầy đủ với dữ liệu canonical.
- [x] Snapshot, replay, hoàn kho/version/outbox đúng một lần và rollback có test.
- [x] Kiến trúc/readiness cập nhật baseline và giới hạn hiện hành.
- [x] Chạy lại full Backend E2E trên DB QA riêng.
- [ ] Hiền/Đạt re-review đúng head mới; CI head mới kiểm tra trên GitHub.
- [ ] Sau #43 merge: sync lần nữa và chạy confirm-vs-cancel bằng HTTP thật.
- [ ] Nối UI và kiểm thử toàn luồng delivery/complete sau các PR kế tiếp.

Đạt đã báo CHK-S04 local PASS ở head cũ 30669b5, artifact ZIP chưa bàn giao;
đợt này không rerun FastAPI/Elasticsearch/FAISS thật và không coi báo cáo của Đạt
là bằng chứng độc lập mới. Không browser Order UI, không đánh giá Precision/Recall.
G-FULFILMENT vẫn IN_PROGRESS. Commit/CI và review request ghi trên PR #44.
