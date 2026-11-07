# Nghiệm thu SKU giá/kho — 30/10/2026

Candidate branch `feat/hoang/sku-management-final`, base localc18c81b; source WIP được gắn SHA256 trong provenance, chưa push/merge hoặc remoteCI. Phạm vi D13: sửa SKU đã tạo không đưa APPROVED về nháp; nội dung theo moderation cũ.

## Kết quả thực thi

| Kiểm tra | Kết quả | Bằng chứng tại root máy `machine-local/final-day-20261030/` |
|---|---|---|
| FE focused API/component |53PASS| Hai file `variantInventoryApi.test.ts`, `VariantInventoryEditor.test.tsx`; mock, không DB |
| FE full regression |1856PASS,6SKIP,0FAIL|`fe-regression-1793355548500/results.json`, source-stabilitytrue |
| BE full unit regression |1872PASS,0FAIL|`be-regression-1793355535902/results.json`, source-stabilitytrue |
| SKU HTTP/PostgreSQL |35PASS,0FAIL|`sku-e2e-1793355551794/results.json`, QA40 mới, role bckl_local_app DML, source-stabilitytrue |
| NativeChrome/HTTP/PostgreSQL |3groupsPASS,3SKUledgerPASS|`sku-browser-1793355699232/browser/{browser-report.json,ledger-report.json}`, QA40 mới, app-role không super/CREATE |
| BE toàn E2E sau SKU |1247PASS,1SKIP,20TODO,0FAIL|`e2e-regression-1793355678221/results.json`, source-stabilitytrue; migrator cho các suite DDL lịch sử, không thay DML focused proof |
| Build |BE và FE PASS| Typecheck/build local; FE còn cảnh báo kích thước bundle, không che warning |

Focused35 kiểm quyền, staleCV, Product/Variant khác quyền, PENDING/FROZEN/Store khóa, bounds/no-op/unknown payload, price-only không ledger0, stock0 và tăng/giảm đúng delta. Có real Checkout→snapshot cũ bị409, edit sau checkout giữ Order/Payment/OrderItem và receipt replay; hai edit chung CAS chỉ một200; hai ca overlap Checkout/edit đối chiếu price, stock, version, ledger và outbox; lỗi outbox được tiêm qua spy rollback thựcDB rồi retry hợp lệ.

Chrome thực tế mở SellerDashboard, chọn sản phẩm và SKU: review/consent, hai click cùng tick chỉ một PATCH, stock0 trên390px không overflow; response200 bị cắt sau commit→khóa ghi→GET có chủ đích không gửi lại; client khác thắng sau review→409→tải dữ liệu mới, không ghi đè. Kiểm DOM không có form lồng nhau, không pageerror. Đã xem screenshot mobile `normal.png`.

## Lỗi phát hiện và sửa

Lượt đầu `sku-e2e-1793355358599` có29PASS4FAIL: ba lỗi fixture (email localpart quá dài, giả định sai về checkout/version và edit dùng version cũ); một lỗi implementation thật: P2010 bọc SQLSTATE40001 từ raw FOR UPDATE chưa vào retry, race trả200/500. Đã nhận diện SQLSTATE40001/40P01 và chạy lại trên DB mới:35PASS. Không xóa hoặc cộng số lượt thất bại vào PASS cuối.

ArgonMedium tạo draft offline; directwrite trước bị headless permission deny và không ghi file. Codex kiểm/sửa draft SQL/schema/auth, tích hợp FE/controller và thực thi QA. Claude SonnetMedium review source chọn lọc tại `sku-review-1793355211860`, followup `sku-review-1793355462139`: góp ý nestedform được rút sau khi coordinator sửa context sai và đưa fullparent SECTION; không còn confirmedP1/P2 trong snapshot review này. Review tĩnh không phải pentest hoặc human approval.

## Giới hạn

- Enqueue SearchOutbox đã kiểm; chưa chứng minh chính event SKU này đi vào ES/FAISS thật. Không đẩy fixtureQA sang index demo.
- Giá mới nguyên VND; legacy giá lẻ phần đồng chưa hỗ trợ sửa. Không tự làm tròn dữ liệu.
- GET sau mất response không phải durable receipt/fence; dùng CAS và thao tác rõ ràng theo [contract](../api/seller-variant-inventory.md).
- Không có provider, tiền thật hoặc courier thật trong fixture. Historical Order test chạy qua CheckoutCOD thựcAPI, không chỉnh SQL Order để dựng bằng chứng.
- GitHub vẫn chưa push/merge/CI doquota; localPASS không đồng nghĩa staging/production.

## Rollout demo local sau QA

Đã bật `VITE_SELLER_VARIANT_INVENTORY_ENABLED=true` trong profile riêng ngoài Git, khởi động lại đúng managed Backend/Frontend sau đối chiếu process tree/port owner; AI giữ nguyên,40migrations không đổi. Trước/sau rollout hash của orders/order_items/payments/stock_movements/order_commands/order_command_resolutions giống nhau:2Orders/2Payments/2Movements. Proof `demo-sku-order-integrity.json`.

Read-onlyChrome `machine-local/priority-20261030/demo-smoke-1793356069267307800/report.json`:4checksPASS login→realHybridSearch→Product→ownOrders, không tạo đơn. `demo-sku-read-1793356127721786100/report.json`:Sellerlogin→dashboard→editor GET, flag/UI thực sự hoạt động,0Sellerwrites. Không chỉnh giá/kho demo để dựng nghiệm thu; mutation chỉ ở QA riêng.
