# Chuẩn bị test Backend cho resolution — 16/10/2026

Base035656b. Contract đang review ở [#62](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/62).
Nhánh này TEST-ONLY, không phụ thuộc code unmerged, không sửa schema, API hoặc FE.

## Công cụ mới

- `BE/test/helpers/order-resolution-qa-target.ts`: guard thuần, chỉ nhận database
  loopback5549 tên `bckl_order_resolution_test_<suffix>`, chỉ schema public; chặn
  demo/DB manual Checkout/remote/options tùy ý và không in URL chứa credentials.
  Phải gọi trước bootstrap/fixture/migration; guard không tự xác minh runtime API
  đang nối DB nào, caller vẫn phải dựng process Nest bằng đúng env đã kiểm.
- `BE/test/helpers/order-resolution-response-proxy.ts`: proxy HTTP test-only tới
  loopback ephemeral origin; whitelist POST C2/resolve, không Auth/admin/query.
  Đợi upstreamHTTP200 kết thúc mới cắt socket client, không retry/generate result,
  không lưu header/body/key/PII. HTTP200 chưa là bằng chứng PostgreSQL commit:
  scenario thực phải snapshot DB và receipt sau đó.
- `BE/test/order-resolution-test-harness.spec.ts`: tự kiểm guard/proxy bằng HTTP
  server giả; không Nest/Prisma/DB. Không coi những ca này là R01–R24 PASS.
- `BE/test/order-command-resolution.e2e-spec.ts`:20 TODO có ID truy vết contract,
  không bootstrap/DB/endpoint. Bổ sung R25 theo feedback #62: identity bất biến ngay
  từ PROCESSING, không chỉ SUCCEEDED. Runner phải ghi20TODO/SKIP, KHÔNG PASS. R19–R23 là
  FE/browser ở ma trận #62, không nhét vào Backend bằng fixture giả.

## Trình tự implementation sau contract được chốt

1. Fresh/upgrade migration + DB guard trước (R10–13,R25); không sửa migration cũ.
   R25 phải thử đổi từng field và bộ identity hợp lệ khác của claim PROCESSING,
   NULL-safe compare, đích key đã fence; no-op/hoàn tất đúng vẫn được phép. Không
   dùng immutable trigger chỉ chạy sau SUCCEEDED làm bằng chứng đủ. Assert đúng
   identity-guard constraint, không nhận việc vấp NOT NULL/FK khác là đã chứng minh
   guard identity hoạt động.
2. Request canonicalization, resolver service/controller/parser/quota (R01–02,
   R05,R14–18). Không bật route Web hoặc gọi endpoint chưa tồn tại từ UI.
3. Shared check tại cả5writers: preparation/cancel/returned/delivery/complete;
   SYSTEM namespace riêng. Direct SQL guard phải fail-closed nếu helper bị quên.
4. Hai app/two connections: R03/04/06/09/11. Dùng SQL lock/barrier quan sát được,
   không dùng sleep hoặc Promise.all thắng ngẫu nhiên làm proof.
5. R07/08: dùng proxy/fault injection thật; sau upstream commit →socket loss→
   replay/DB đối chiếu identity. Không dùng mock receipt hoặc discarded-return-value
   để gọi là socket loss. Sau lỗi trước commit, xác nhận rollback tất cả fields.
6. R24 và FE settlement/browser: chỉ sau Backend merge/review. Fresh GET + explicit
   confirmation/key mới, key cũ còn bị DB chặn; không GET-based ack.

## Fixture/snapshot yêu cầu khi activate TODO

DB mới riêng đúng guard,13migration hiện hành + migration mới khi có; không reset
demo/manual QA. CI tương lai cần provision throwaway database cùng port5549 và
namespace đã chốt; không tự nới guard sang database demo/CI dùng chung để test chạy.
Hai Nest app cùng env; workers Search/repair/reconciliation/D07
tắt, ngoại trừ scenario SYSTEM riêng. Dựng Buyer/Seller/Admin/sai-owner/locked,
Store ACTIVE/SUSPENDED và Checkout COD thật để có items/stock/history thật.

Mỗi case snapshot theo fixture IDs, không đọc/so toàn DB shared: Order/Payment/
item+address snapshot/history/OrderCommand/resolution/stock movements/Variant.stock/
Product.version/outbox. Resolve CLOSED không đổi các trường nghiệp vụ; COMMITTED
không dựng lại result từ Order mới. Login/session writes không phải business writes.
Không báo “zero DB writes” nếu mới kiểm một tập fields/count.

Migration tests dùng schema ngẫu nhiên riêng; validate identifier, search_path,
FK/trigger thực; giữ snapshot legacy trước/sau. Cleanup chỉ tài nguyên tạo bởi
test và DB test đúng namespace; không copy lệnh xóa fence sang production hoặc
tắt trigger để fixture đi qua. Service tests phải cover retry exhaustion/deadline.

## Các tầng kết quả phải tách riêng

Harness self-test có thể PASS nhưng20runtimeTODO và toàn bộ resolution vẫn NOT_RUN.
Full Backend E2E/runtime mới chưa chạy vì contract/endpoint/schema chưa có. Không
cần Docker cho self-tests; không gọi việc không kết nối DB là lỗi môi trường.
Khi implementation đổi contract, cập nhật TODO IDs/matrix trước khi bỏ TODO.

## Kết quả đợt chuẩn bị

- Frozen offline install PASS;20self-tests guard/proxy PASS (fake HTTP upstream).
- Full Backend unit614PASS; lint/typecheck/build và diff-check PASS.
- Lượt skeleton đầu19TODO; sau bổ sung R25 đã chạy lại:20TODO/1suiteSKIP,
  không phải20PASS. Chạy riêng self-test lần cuối20/20PASS, không cộng vào614lần nữa.
- Không chạy full Backend E2E hoặc DB/migration tests mới; không tạo/sửa schema,
  không reset fixture/demo. Log health/Search lỗi trong unit là fault giả lập
  của test nền, không phải kết nối tới DB/Search thật của đợt này.
