# PR #44 — tích hợp #43 và cạnh tranh Order, 14/10/2026

## Baseline và thay đổi

#43 MERGED tại `515f68a02d985912e55fc9551b5a16087433876c`. Root develop cập nhật
fast-forward, giữ file cá nhân/untracked. Nhánh #44 `codex/order-cancellation`
từ d0ce060 merge develop vào cùng nhánh, không rebase/force push/tự merge PR.

Conflict configure-app/OrderModule/readiness/architecture: giữ list/detail,
Seller preparation, cancellation, SearchModule và guards. Parser GET → Seller
command → cancellation → Checkout/default; giữ giới hạn 8 KiB/64 KiB tương ứng.
Logic hai production services không đổi; không sửa schema/migration/lockfile,
FastAPI hoặc Frontend. Swagger tests giữ tất cả API đã tích hợp.

## Test cạnh tranh mới

POST Checkout COD thật mua hết hai Variant cùng Product APPROVED; hai Nest
applications/Prisma pool độc lập gọi HTTP qua JWT/guards/parser/services thật.
Không mock HTTP hoặc dùng SQL writer giả Seller confirm.

| Scenario | Kết quả đã PASS |
|---|---|
| Confirm–Buyer cancel tự do, đảo app từng actor (2 ca) | Một 200/một 409, một command/history mới, state/Payment/kho/event khớp bên thắng |
| Confirm thắng khi Buyer request đang chờ DB | Buyer ORDER_CANNOT_CANCEL, CONFIRMED/UNPAID; không restore hoặc đổi Product/version/outbox |
| Cancel thắng khi Seller request đang chờ DB | Seller INVALID_ORDER_TRANSITION; CANCELLED/Payment CANCELLED; mỗi Item một restore, stock 2/2, một version/UPSERT Product |
| Start-packing–Seller cancel trên CONFIRMED | Chỉ PACKING hoặc CANCELLED; hủy hoàn một lần, packing không đổi kho/event; receipt confirm cũ replay nguyên trạng |

Hai ca ép kết quả dùng khóa User row PostgreSQL test-only và pg_blocking_pids
xác nhận HTTP request thực sự chờ blocker. Promise chỉ điều phối fixture;
bảo đảm dữ liệu là khóa DB/Serializable/unique key production, không khóa RAM
hoặc sleep để nhận là concurrency. Khóa release trong finally.

Sau race GET detail Buyer/Seller kiểm status/Payment/history/actor/privacy,
snapshot items và Checkout không đổi, Cart vẫn đã xóa dòng mua. Receipt bên thắng
replay qua app khác không thêm command/history/movement/version/event; bên thua
vẫn 409. Exact UPSERT expected độc lập builder gồm productId/version, name,
description, category/path, brand, attributes, images, Decimal prices và inStock.
Stock-only giữ APPROVED. DELETE và SQL fault rollback nằm trong ca gốc giữ nguyên.

## Kết quả thực chạy

DB mới `127.0.0.1:5549/bckl_pr44_post43_20261014`, PostgreSQL 17 QA riêng,
container bckl-checkout-web-qa-20261012, đúng 12 migration. Không demo DB,
không root/BE .env trong worktree; QA env đặt ở process; cron Search/repair tắt.
Không chạy seed local trong đợt này, không nhận test fixtures là demo toàn luồng.

| Kiểm tra | Kết quả |
|---|---|
| Frozen install | PASS, lockfile không đổi |
| Prisma validate/fresh migrate deploy | PASS, 12 migrations |
| Backend typecheck/lint/build | PASS |
| Backend unit | 458/458 PASS, 22 suites |
| Cancellation + Seller preparation + detail + list E2E | 167/167 PASS, 4 suites, 32.05s |
| Full Backend E2E | 487/487 PASS, 24 suites, 107.73s |
| FE lint/test/build | PASS, 122/122 test, 15 suites |
| Staged diff và diff so với develop | PASS |

54 cancellation cases = 49 gốc + 5 mới. Full E2E là chạy head kết hợp, không
cộng test hai nhánh. Log lỗi có chủ đích kiểm rollback; pg/Vite warnings nền
vẫn còn, không nhận đã sửa. Không cần sửa logic giao dịch production trong đợt này.

## Checklist tiếp

- [x] Giữ đủ parser/controllers/providers sau #43 merge.
- [x] Confirm–Buyer cancel cả hai kết quả; packing–Seller cancel; replay/detail.
- [x] Kho/audit/snapshot/version/outbox đúng; full regression/kiến trúc cập nhật.
- [ ] CI head mới, Hiền/Đạt re-review delta, người dùng merge #44.
- [ ] Sau merge #44 sync #46 → #47 → #48, chạy lại head kết hợp từng bước.
- [ ] Nối Order UI, browser journey và G-FULFILMENT; hiện chưa nghiệm thu.

Đạt đã gửi ZIP CHK-S04 ở 30669b5 nhưng chưa tải/kiểm chứng độc lập hoặc rerun
FastAPI/ES/FAISS trên head mới. Outbox DB assertions không chứng minh index nhận.
Không nghiệm thu Search quality, refund/sandbox production, notification hoặc
Web từ test API. Commit/CI/review request ghi trên #44; không tự merge.
