# Tích hợp API chi tiết đơn và Seller preparation — 13/10/2026

## Nền và phạm vi

#42 đã merge vào develop `ad1771b216db561f2417c4e654973f5043459b02`
ngày 13/10 giờ Việt Nam. Đồng bộ nền này vào #43 từ head `5349ca6`,
không rebase/force-push, không tự merge PR. Working tree #43 sạch trước đồng bộ;
file cá nhân và các nhánh đang dở được giữ nguyên.

Conflict ở `BE/src/order/order.module.ts` và tài liệu kiến trúc:

- Giữ OrderListController/Service/RateGuard, OrderDetailController/Service
  và SellerOrderCommandController/Service/RateGuard trên cùng OrderModule.
- Giữ guard GET list/detail trước parser Seller command 8 KiB,
  rồi parser Checkout 64 KiB/default JSON; cookie, CORS và Retry-After không mất.
- Kiến trúc phân biệt detail CURRENT sau #42 với C2 IN_PROGRESS ở #43,
  giữ cả mô tả hai chức năng; #54 vẫn Draft, G-FULFILMENT chưa DONE.
- Không đổi schema/migration, Auth, contract FastAPI hoặc source FE so với develop.

## Bằng chứng HTTP/PostgreSQL mới

Mở rộng ca cuối `seller-order-command.e2e-spec.ts` (không chỉ mock service):

1. POST /checkouts thật tạo COD từ giỏ Buyer và Product/Variant fixture.
2. GET detail Buyer lưu dữ liệu snapshot gốc.
3. Đổi tên catalog và tên người nhận trong sổ địa chỉ bằng fixture DB;
   dữ liệu đã mua không bị thay theo dữ liệu hiện hành.
4. Seller confirm → start-packing → ready-to-ship bằng HTTP.
5. Sau mỗi bước, GET detail Buyer và Seller trả đúng trạng thái/timeline,
   items/address/Payment giữ nguyên; Buyer ẩn ID Seller, Seller thấy ID chính mình.
6. App Nest thứ hai replay key confirm cũ trả receipt CONFIRMED ban đầu,
   nhưng GET detail vẫn READY_TO_SHIP; DB Order/history/commands không ghi thêm.
7. Seller khác GET detail nhận 404. Kho, movement, Product/version/outbox,
   OrderItem snapshot, Checkout receipt, Cart và Payment giữ nguyên qua commands/reads.

Hai app dùng PostgreSQL thật và HTTP loopback. Đổi catalog qua DB chỉ phục vụ
fixture kiểm snapshot; không phải bằng chứng Seller Product API hoặc Search dispatch.

## Môi trường và kiểm tra

Container riêng `bckl-checkout-web-qa-20261012`, PostgreSQL 17,
loopback port 5549. Database mới `bckl_pr43_post42_20261013`, đủ 12 migration
đúng tập của checkout; không dùng completion-job migration chưa merge.
Không reset/drop database, không thao tác `klcn_ecommerce` trên port 5432.
Không có `.env` ở worktree/root Backend; URL DB và JWT test-only chỉ trong process.
Search sync/reconciliation/image-repair cron bị tắt bởi setup E2E để không gửi fixture ra ngoài.

| Kiểm tra | Kết quả |
|---|---|
| BE typecheck, lint, build | PASS; typecheck/lint chạy lại sau sửa test |
| BE unit | 442/442 PASS, 21 suites |
| FE test | 122/122 PASS, 15 files |
| FE lint/build | PASS |
| Prisma validate/migrate deploy | PASS; áp dụng 12/12 migration vào DB mới |
| BE full E2E | 433/433 PASS, 23 suites; 107.79 giây |
| git diff --check | PASS |

Dùng dependencies hiện có; không gọi đây là fresh frozen install.
Lượt sandbox ban đầu bị EPERM trước chạy pnpm, đã chạy lại với quyền được duyệt.
Docker ban đầu tắt; sau khi người dùng bật, start lại đúng container QA,
đợi pg_isready chấp nhận kết nối rồi tạo DB mới. Warning pg query/Vite nền
còn tồn tại; ERROR của fault injection là ca kiểm lỗi, phải đối chiếu kết quả suite.

## Chưa chứng minh

- Chưa browser Order UI hoặc toàn vòng đời mua → giao → hoàn tất.
- #44/#46/#47/#48 chưa tích hợp vào #43; confirm-vs-cancel cần kiểm sau #44.
- Chưa SearchOutbox → FastAPI → Elasticsearch/FAISS từ luồng Order (CHK-S04).
- Quota vẫn per-instance, không phải bảo đảm chống xử lý trùng;
  transaction/unique PostgreSQL mới bảo vệ concurrency/idempotency.
- Cần Hiền re-review head kết hợp và CI mới trước merge #43.
