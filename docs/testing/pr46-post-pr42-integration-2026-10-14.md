# PR #46 — đồng bộ detail #42 và kiểm thử giao mô phỏng, 14/10/2026

## Baseline/phạm vi

Head trước sửa `51072cc`, nhánh `codex/order-delivery-commands`; merge
`origin/develop ad1771b` vào cùng nhánh, không rebase/force push. Root và các
worktree đang dở khác giữ nguyên. #43/#44 chưa merge lúc bắt đầu, không kéo
code các nhánh đó vào #46 hoặc tự merge PR.

Hai conflict ở OrderModule và system-architecture-overview. Giữ list/detail
controllers/services/guard từ #42, cùng DeliveryController/Service/RateGuard.
Parser GET vẫn đứng trước delivery và Checkout/default. Không sửa schema,
migration dùng chung, FastAPI, lockfile hay Frontend so với develop.

## Rà nghiệp vụ và dữ liệu

- Chỉ active ADMIN chạy bốn command; role/active được đọc lại dưới khóa trước replay.
- Ship READY_TO_SHIP → SHIPPING; failed SHIPPING → DELIVERY_FAILED;
  retry DELIVERY_FAILED → SHIPPING; delivered SHIPPING → DELIVERED.
- Failed/delivered phải khớp cả currentDeliveryAttempt và trackingReference;
  callback cũ với key mới bị STALE_DELIVERY_ATTEMPT. Replay key/hash cũ trả
  receipt gốc, không sửa state hiện hành. Không suy replay từ trạng thái đích.
- Ship 1/0, tối đa 4 attempt/3 retry; được dùng cùng vận đơn. Legacy thiếu identity
  fail closed. Unique scope/key PostgreSQL và Serializable bảo vệ xuyên process,
  không lấy quota RAM làm bảo đảm dữ liệu.
- COD delivered đặt Payment PAID/paidAt + Order.deliveredAt + history/receipt
  trong một transaction. DELIVERY_FAILED chưa hoàn kho; DELIVERED chưa COMPLETED.
  Kho, movement, Product.version/SearchOutbox không bị delivery thay đổi.
- Admin mô phỏng giao đơn cũ không phải cấp lại quyền bán mới cho Store khóa.
  Payment sandbox fixture chỉ chứng minh policy, không phải thu tiền thật.

Không tìm thấy blocker mới trong phạm vi code được rà; không nhận full workflow
đã đạt vì READY_TO_SHIP vẫn là fixture, chưa chạy Seller command #43.

## Test mới/bổ sung

1. Ship → failed → retry → delivered, GET detail Buyer/Seller sau từng bước:
   snapshot item/address/total giữ nguyên khi tên/giá catalog đổi; Payment,
   attempt/tracking/history đúng trạng thái mới nhất; Buyer ẩn ID Admin,
   Seller audit theo allowlist; không trả key/hash/receipt.
2. Replay ship qua app thứ hai sau delivered: trả receipt SHIPPING gốc,
   DB không ghi thêm và GET vẫn DELIVERED.
3. SQL trigger fail khi finalize retry-delivery sau các write: toàn state DB
   giữ nguyên (Order/Payment/attempt/command/history/kho/outbox); bỏ lỗi rồi
   cùng key retry qua app khác tăng đúng một attempt/counter/history/receipt.
   Replay sau đó giữ DB nguyên trạng.
4. Fixture optionSnapshot dùng `[]` đúng default variant; không nới parser
   hoặc đổi dữ liệu nghiệp vụ để GET chấp nhận JSON không canonical.
5. Swagger giữ detail Buyer/Seller + 4 delivery commands; không giả Seller
   confirm hay Admin complete đã được tích hợp.

## Kết quả thực chạy

Database mới `bckl_pr46_post42_20261014`, PostgreSQL 17 container
`bckl-checkout-web-qa-20261012`, loopback port 5549; đúng 12 migration trong
checkout. Không chạy demo DB. Worktree không có root/BE `.env`; cấu hình QA
đặt ở process; cron Search/reconciliation/image repair bị test setup tắt.

| Kiểm tra | Kết quả |
|---|---|
| pnpm install --frozen-lockfile | PASS, 585 packages reuse cache, postinstall Prisma generate PASS |
| Prisma validate/migrate deploy | PASS, 12 migration |
| Backend full typecheck/lint/build | PASS |
| Backend unit | 485/485 PASS, 21 suites |
| Delivery + detail + list E2E | 81/81 PASS, 3 suites, 18.31s |
| Full PostgreSQL Backend E2E | 401/401 PASS, 23 suites, 108.16s |
| FE lint/test/build | PASS, 122/122 test, 15 suites |

Full E2E gồm 22 delivery command cases và suite nền DeliveryAttempt/detail.
Lỗi forced rollback/invalid response trong log là test có chủ đích; cảnh báo
pg concurrent query và Vite tsconfig-paths chưa được sửa trong task này.
Số test nhỏ hơn nhánh #44 do #46 không chứa 49 cancellation cases; không phải
bỏ test của #44. Sau merge phải chạy lại suite kết hợp, không cộng số hai nhánh.

## Checklist tích hợp tiếp

- [x] Giải quyết conflict giữ cả read và delivery.
- [x] Rà quyền, state nguồn, lần giao hiện hành, replay và transaction.
- [x] Bổ sung detail/privacy/replay và rollback retry-delivery.
- [x] Chạy full regression riêng; cập nhật kiến trúc.
- [ ] Hiền re-review đúng head đồng bộ và CI head mới.
- [ ] Người dùng merge #43 → sync/test #44 confirm-vs-cancel HTTP.
- [ ] Sau #43/#44 merge, sync #46 lại và chạy Checkout → Seller → Admin delivery.
- [ ] #47: thêm nhiều item/Variant cùng Product, exact UPSERT/DELETE,
  restore cũ/version overflow, blocked actor replay sau receipt thật.
- [ ] #48: giữ detail/command/CompletionService/Worker/guard, rerun migration,
  lease/retry/restart và regression trên nền Order chính thức sau merge.
- [ ] Nối Order UI, browser journey và G-FULFILMENT; hiện NOT_RUN.

Không tự merge, không refund production hoặc nghiệm thu Web/Search chất lượng.
Head commit, CI và re-review request được ghi trên PR #46.
