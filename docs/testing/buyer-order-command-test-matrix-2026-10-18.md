# Buyer cancel/complete — ma trận chuẩn bị 18/10/2026

Nền `develop 39e8343`. **Chưa triển khai Buyer Web hoặc contract recovery mới.**
Tài liệu [readiness](../architecture/buyer-order-command-readiness-2026-10-18.md)
giải thích luật, body/receipt, khoảng trống BR-01..BR-06 và thứ tự thực hiện.

## Nhãn bằng chứng

- **SOURCE_CHECKED:** đã đọc source/test đang có, không đồng nghĩa chạy E2E hôm nay.
- **UNIT_RERUN:** đã thực thi nhóm unit hiện hữu trên đúng nền; không chứng minh HTTP/DB.
- **NOT_RUN:** ca nghiệm thu Buyer Web/recovery mới chưa chạy, chưa có implementation.

Chạy hôm nay: BE150PASS/4file; FE51PASS/2file. Không bỏ test, nới guard/quota hoặc
chạm DB demo. Bảng dưới mô tả **điều kiện phải đạt**, không gán PASS cho kế hoạch.

## A. Quyền, input và policy

| ID | Ca và kỳ vọng | Nguồn nền đã đọc | Gate Buyer mới |
|---|---|---|---|
| BA01 | Buyer active đúng owner; cancel chỉ PENDING_CONFIRMATION | cancellation.controller/service, command-policy | NOT_RUN |
| BA02 | Đơn người khác và absent đều404; không leak snapshot | cancellation E2E `hides Order existence`; completion E2E `ownership/role/inactive` | NOT_RUN |
| BA03 | Guest401, sai role403, account khóa không replay | Cùng hai service + Jwt/Roles guards | NOT_RUN |
| BA04 | Store CLOSED/SUSPENDED không chặn Buyer hợp lệ; không cấp Seller quyền Buyer | cancellation E2E `Buyer cancellation is allowed even when Store CLOSED` | NOT_RUN |
| BA05 | Cancel từ CONFIRMED/PACKING/SHIPPING/DELIVERY_FAILED/DELIVERED không hoàn kho | command-policy unit; cancellation E2E source-state cases | NOT_RUN |
| BA06 | Complete chỉ DELIVERED, deliveredAt hợp lệ; không cần chờ3ngày | completion.service + runtime E2E `not yet 3 days` | NOT_RUN |
| BA07 | Cancel COD UNPAID; paid/sandbox/missing/wrong amount/currency không đổi dữ liệu | cancellation.service + E2E payment matrix | NOT_RUN |
| BA08 | Complete PAID/paidAt hợp lệ, amount/total,VND,provider; null/future không tự sửa | completion.service + E2E `wrong source/payment/extra body` | NOT_RUN |
| BA09 | ReasonCode Buyer chỉ CHANGED_MIND/OTHER; trim1..500, text required cả hai | command-request unit, cancellation receipt unit | NOT_RUN |
| BA10 | Extra/null/array/body/query/content-type/ID/key/8KiB sai bị từ chối | controller/http helpers + E2E input cases | NOT_RUN |
| BA11 | Quota riêng mỗi command group; request21/Retry-After; không coi distributed | cancellation/completion rate guards | NOT_RUN |

## B. Atomicity và concurrency

| ID | Ca và kỳ vọng | Nguồn nền đã đọc | Gate Buyer mới |
|---|---|---|---|
| BT01 | Cancel: Order+Payment+history+receipt+stock movement+version/outbox cùng commit | cancellation E2E `cancels real COD checkout atomically` | NOT_RUN |
| BT02 | Nhiều Variant cùng Product: restore từng Item, chỉ1version/1outbox mỗi Product | Cùng test; service gom productIds | NOT_RUN |
| BT03 | Same key/body concurrent và replay không restore/history/outbox thêm | cancellation E2E `same-key requests genuinely overlap` | NOT_RUN |
| BT04 | Khác key cùng Order hoặc Buyer/Seller hủy cạnh tranh chỉ1restore | cancellation E2E race/source tests | NOT_RUN |
| BT05 | Seller confirm vs Buyer cancel: chỉ1transition từ PENDING; loser không clear unknown bằng409 | cancellation E2E HTTP barrier `confirm/cancel` | NOT_RUN |
| BT06 | Thiếu/sai CHECKOUT_DECREMENT, đã restore, variant mismatch: toàn bộ rollback | cancellation.service ledger checks + E2E | NOT_RUN |
| BT07 | Stock overflow/Product.version cuối miền/outbox SQL lỗi: không partial commit | cancellation E2E overflow/fault cases | NOT_RUN |
| BT08 | Restore cạnh tranh Checkout mới không mất increment; giá/nội dung đổi không sửa snapshot cũ | cancellation E2E concurrent Checkout/snapshot cases | NOT_RUN |
| BT09 | Complete chỉ1history/receipt, không đổi Payment/stock/Product/outbox/snapshot | completion runtime E2E `Buyer completes atomically` | NOT_RUN |
| BT10 | Hai instance Buyer complete cùng key hoặc khác key: một transition | completion runtime E2E `two instances same key` + policy source | NOT_RUN |
| BT11 | Buyer-vs-D07: SYSTEM hoặc Buyer thắng; worker SKIPPED/SUCCEEDED; không gán SYSTEM receipt cho Buyer | completion runtime E2E `Buyer races runtime`/real delivery race | NOT_RUN |
| BT12 | Timeout/serialization/deadlock giới hạn; pending không mất; SQL cuối fail rollback | hai services, completion runtime E2E SQL fault | NOT_RUN |

Lưu ý: test title cũ có chữ “two processes” phải đọc setup; hai Nest app trong
một Vitest process không là bằng chứng hai OS process/crash thật. Không nâng
claim từ tên test hoặc kết quả E2E lịch sử.

## C. Contract và recovery FE cần bổ sung

| ID | Ca đối kháng và expected | Dependency | Trạng thái |
|---|---|---|---|
| BF01 | Full exact envelope/result nested; malformed200 không hydrate/settle | Buyer receipt validators | NOT_RUN |
| BF02 | ID/command/actor/hash identity đúng; tiền string, timestamp hợp lệ, không coercion | Buyer adapters + canonical models | NOT_RUN |
| BF03 | Cancel receipt reason và timeline khớp ý định chuẩn hóa; same key đổi reason bị conflict | BR-02/BR-03 | NOT_RUN |
| BF04 | Complete receipt BUYER đúng actor; SYSTEM response không giả receipt Buyer | BR-01/BR-04 | NOT_RUN |
| BF05 | Persist/read-back identity trước HTTP; getter/setter/removal lỗi/no-op không mở thao tác | journal version/compatibility | NOT_RUN |
| BF06 | Không persist token/địa chỉ hoặc raw reasonText nếu chưa privacy review | BR-03 | NOT_RUN |
| BF07 | Pending khác Order/command/role; v1 và v2 cùng tồn tại không bị bypass | BR-02 | NOT_RUN |
| BF08 | Double-click/Enter/cancel-reopen:1POST/consent, không auto send on mount/reload | Buyer controller/confirmation | NOT_RUN |
| BF09 | Server commit rồi mất response; reload giữ identity, có bằng chứng terminal | BR-01..BR-04 | NOT_RUN |
| BF10 | Request chưa tới server hoặc đang chờ lock; resolver không execute và closure không race muộn | Buyer Backend recovery contract | NOT_RUN |
| BF11 | Đổi tài khoản hoặc login lại cùng ID khi POST/resolve/GET chờ: không expose/clear nhầm | session generation | NOT_RUN |
| BF12 | Unmount/route Order đổi/StrictMode: controller không ack từ phiên/view cũ | lifecycle + pending | NOT_RUN |
| BF13 | 400/401/403/404/409/429/500/timeout/200hỏng không auto retry POST hoặc reset key | error semantics | NOT_RUN |
| BF14 | Đã receipt/CLOSED nhưng GET lỗi: chỉ retry GET, chưa tạo command mới | freshness/settlement | NOT_RUN |
| BF15 | D07 complete trước khi Buyer request chạy: GET COMPLETED/409 không tự clear key | BR-04 | NOT_RUN |
| BF16 | Cờ off/default, Buyer không gọi Seller resolver; không bật nút từ mock/approval #68 | route rollout | NOT_RUN |

## D. Fixture, oracle và tầng kiểm thử

1. Dùng DB QA mới riêng loopback, từ chối target demo5432. Fixture có hai Buyer,
   Seller và Admin độc lập. Secrets cung cấp riêng, không commit/log.
2. Tạo Order qua Address→Cart→Checkout thật để có ledger, không dựng ledger đoán.
   Có Product2Variant + Product thứ hai; đủ case public/nonpublic, stock/version
   gần giới hạn trong fixture riêng. Snapshot trước mutation để so toàn bộ.
3. Complete dùng Seller3steps→Admin ship/mark-delivered thật. Fixture trực tiếp
   DELIVERED/PAID có nhãn riêng, chỉ để kiểm invalid-state, không thay integration.
4. D07 suite mở scheduler thật riêng, kiểm barrier Buyer-vs-job. Tắt cron/workers
   không liên quan trong suite khác; không nới rate limit, tách actor khi cần.
5. Oracle hủy: count/rows OrderCommand, history, Payment, Item movements, stock,
   Product.version và full UPSERT/DELETE payload. Replay/bên thua không thêm dòng.
6. Oracle complete: status/time/receipt/history đúng1; Payment/stock/Product/
   snapshots/outbox giữ nguyên. Job SYSTEM kết quả đúng actor/lease.
7. Fault SQL cuối transaction; proxy bỏ response sau commit; giữ lock/barrier
   để hai request thật chồng nhau; không dựa sleep/Promise.all đơn thuần.
8. Cấp Search integration riêng sau hủy: outbox→worker→FastAPI→ES/FAISS→hydrate;
   Đạt kiểm nếu đổi payload. Outbox PASS không đồng nghĩa index đã nhận.
9. Browser desktop/mobile, error states/consent, reload, session switch, GET lỗi
   sau receipt, storage failure; so DB trước/sau. MockHTTP chỉ là unit/component.

## E. Lệnh unit đã chạy, không DB

```text
pnpm --dir BE exec vitest run src/order/order-command-policy.spec.ts src/order/order-command-request.spec.ts src/order/order-cancellation-receipt.spec.ts src/order/order-completion.spec.ts
→ 4 file / 150 PASS
pnpm --dir FE exec vitest run src/features/order-recovery/orderIntentJournal.test.ts src/features/order-recovery/orderCommandCoordinator.test.ts
→ 2 file / 51 PASS
```

Các kết quả này là **UNIT_RERUN** cho nền hiện hữu, không phải implementation
các BFxx. Các source E2E đã liệt kê chỉ **SOURCE_CHECKED** trong đợt này;
Backend E2E/live DB/browser Buyer mới đều **NOT_RUN**. Không tạo TODO rồi tính
là chức năng đã code. Chỉ chuyển từng dòng sang PASS khi ghi SHA/DB/tầng/test
và bằng chứng kiểm được ở PR implementation tương ứng.
