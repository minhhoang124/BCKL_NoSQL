# Nghiệm thu Seller cancel/returned và phục hồi — 30/10/2026

**PASS local theo phạm vi dưới đây**, chưa push/merge hoặc CI mới. Source nền PR138 `6ea22d74e5088472cc4d270dac799b50c8210da0` cộng thay đổi Seller và resolver mới; exact bytes được ghi trong artifact SHA256, không lấy HEAD nền đại diện WIP.

## Thay đổi

- Nối UI hủy đơn trước bàn giao và xác nhận hàng giao thất bại đã quay về; giữ lý do/biên nhận trong bộ nhớ màn hình, journal chỉ metadata/hash/key.
- Chặn preparation/close đồng thời, double submit, sai phiên/actor, snapshot/receipt không khớp; không tự POST khi reload hoặc retry401.
- Biên nhận kiểm amount/provider với Order đã đọc; success hoặc rejection xác định của lần gửi đầu có thể settle sau unmount trong cùng auth epoch bằng CAS.
- Giữ journal khi401/429 hoặc kết quả không rõ. Thêm explicit server resolver cho trường hợp không nhớ body cũ, trả COMMITTED receipt hoặc durable CLOSED_WITHOUT_EXECUTION. Không xóa key theo GET/4xx và không tự thực thi lại Order command.
- Migration40 chỉ mở rộng Seller command pairs của fence constraint; giữ SSI/opposing-outcome/immutability. [Contract](../api/seller-close-resolution.md).

## Kết quả đúng source đã lưu

| Kiểm tra | Kết quả | Phạm vi |
|---|---|---|
| FE focused | 140 PASS,0FAIL/0SKIP | 78client +26page +36existingworkflow/workspace; mockHTTP/storage/session, không phải DB |
| FE toàn bộ | 1803 PASS,6SKIP,0FAIL | Source ổn định trong lượt chạy;6SKIP được giữ, không nhận toàn bộ liveprovider |
| Backend focused | 167 PASS,0FAIL | Gồm62unit resolver, canonical hash/receipt và các test liên quan |
| Backend toàn bộ cuối | 1872 PASS,0FAIL | Sau thêm guard QA; không cộng lượt1847 cũ vào lượt này |
| Backend HTTP/PostgreSQL E2E | 1212 PASS,1SKIP,20TODO,0FAIL | DB mới,40migrations; migrator cho DDL/fault-injection.1SKIP là FastAPI thật;20TODO checklist lịch sử giữ nguyên |
| Chrome thật + app-role | 12nhóm PASS,18nhóm HTTPprobe PASS,16Orderledger PASS | QA40 mới, role DML không super/schemaCREATE; actor/catalog giả lập; Checkout/preparation/Admin qua HTTP thật, Seller qua Web |
| Upgrade có dữ liệu | 39→40 PASS | 67bảng nghiệp vụ không đổi fingerprint,9Order giữ nguyên; không tính bảng migration. Không nâng demo trong ca này |
| Build/typecheck | BE Nest build; BE/FE tsc PASS | Không thay schema Prisma generatedmodel; SQLconstraint additive |

Lượt E2E đầu831PASS/2FAIL/379pending không được dùng làm nghiệm thu. Có hai nguyên nhân: các allowlist QA cũ chặn DB mới và ca R12 còn coi Seller cancel fence là invalid trước migration40. Đã bổ sung helper chỉ chấp nhận loopback5549 và đúng tên QA ngày30/10/timestamp13số, giữ chặn demo/catalog/remote/query override;32guard tests PASS. R12 đổi sang command thật sự không hợp lệ và thêm ca constraint cho Seller cancel/returned. Lượt E2E mới hoàn tất thay thế, giữ logs cũ.

## Chrome và sổ kho

Mỗi fixture stock5, checkout2 món giá10000, total20000; sau mua stock3.

- Seller cancel PENDING_CONFIRMATION/CONFIRMED: CANCELLED, paymentCANCELLED, stock5, đúng một CANCELLATION_RESTORE +2.
- Hàng đủ điều kiện quay về: stock5, restore một lần. DAMAGED: stock3, không restore. Không dùng RETURN_RESTORE của hậu mãi.
- Lost response sau commit → reload không autoPOST → body khác bị chặn local → cùng body/key trả replayedtrue; command/history/stock không tăng thêm.
- Foreign Seller404; anonymous401; Buyer/Admin role403 trên endpoint Seller; Web đúng vai trò bị chặn. SHIPPING/COMPLETED và paid VNPay fixture bị409, data không đổi; Seller LOST400.
- Buyer cancel đua Seller cancel:200/409; Seller cancel đua confirm: lượt này200/409; Seller/Admin returned:409/200. Mỗi kết quả kiểm payment/snapshot/ledger, replay winner không ghi mới. Cancel đua confirm có thể hợp lệ200/200 nếu confirm thắng trước, vì Seller được hủy CONFIRMED; driver kiểm cả nhánh này.
- Server resolver CLOSED qua Web có consent riêng, mộtPOST dù doubleclick, journal settle đúng proof; Order vẫn PENDING_CONFIRMATION/stock3, không tạo command hoặc hoàn kho.
- HTTP CLOSED repeat cùngresolutionId, đổihash409, original đến muộn409 ORDER_COMMAND_CLOSED. Resolver COMMITTED trả immutable originalreceipt, không thêm command. Resolver đua execute: lượt này CLOSED thắng, commandCount0/fenceCount1; không dual outcome.

## Bằng chứng và review

Từ root máy `C:/Vo Minh Hoang/BCKL_2026/machine-local/final-day-20261030/`:

- `seller-focused-final.json`, `seller-backend-focused.json`.
- `fe-regression-1793350924968/`, `be-regression-1793352517749/`.
- `e2e-regression-1793352340350/`: lượt E2E hoàn tất và hash source/test. Lượt thất bại giữ tại `e2e-regression-1793351421879/`.
- `seller-browser-1793353201828/browser/{browser-report.json,ledger-report.json}`:12nhóm/18probe/16đơn, screenshot desktop/mobile; driver source hash giữ nguyên trong lượt chạy.
- `migration-proof-1793350742892/report.json`.
- `resolution-review-1793350741966/`: Argon Medium và Claude Sonnet Medium review source/slices cuối, không confirmedP1/P2 trong phần gửi. Đây là review tĩnh, model không tự thực thi các số test trên.

Codex đã kiểm ảnh mobile/restock và ảnh server CLOSED, kiểm assertions/ledger và đối chiếu các đề xuất reviewer với source. Không áp dụng đề xuất xóa journal chỉ dựa lỗi retry; bổ sung durable resolver để chặn late request.

## Giới hạn và phát hành

Không gọi9nhóm browser cũ trênQA39 là nghiệm thu resolver mới. Lượt11nhóm/15đơn tại seller-browser-1793352758288 được giữ làm lịch sử; lượt16đơn bổ sung COMMITTED qua Chrome thật sau mất phản hồi hàng hỏng, không nhập lại body, restockablefalse và kho3 giữ nguyên. Không cộng hai lượt browser thay thế hoặc hai lượt E2E. VNPayPAID trong driver là fixture SQL tổng hợp để kiểm guard, không phải giao dịch VNPay thật. Tăng quota chỉ cho fixture setup, không chứng minh production rate limit/capacity. Dark preference được chạy nhưng surface hiện có vẫn sáng, không tuyên bố theme hoàn chỉnh.

GitHub Actions quota vẫn chặn push/merge; PR138 xanh tại head cũ không phủ code mới. Demo DB chưa được nâng bởi các ca QA; rollout cần backup, migrations40 và smoke riêng. HTTPS/offsite/rollback executable, SKU editor, provider còn thiếu và toàn bộ UI redesign không được đóng nhờ báo cáo này.
