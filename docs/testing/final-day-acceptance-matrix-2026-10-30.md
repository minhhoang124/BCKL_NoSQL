# Ma trận nghiệm thu chặng cuối — 30/10/2026

TODAY-01: đối chiếu tài liệu, không chạy sản phẩm, provider, DB hoặc CI. Owner đã yêu cầu thực thi kế hoạch; các worker runtime làm riêng và coordinator bổ sung bằng chứng cuối vào mục cuối file. Không đọc file secret/private để lập ma trận này.

## Phạm vi và cách đọc

- Tám gate lấy từ [implementation-scope](../project/implementation-scope.md), không tự chia nhóm mới thay thế. Hạn nộp owner hiện tại08/11; mốc tháng12 trong tài liệu lịch sử không thay hạn nộp.
- **HISTORICAL_LOCAL_PASS**: tài liệu ghi một lượt đã đạt trên ngày/source/môi trường gốc, kể cả lượt trước trong ngày30/10. Không đổi thành PASS trên bytes candidate mới.
- **CURRENT_NOT_RUN**: worker lập ma trận chưa nhận bằng chứng thực thi trên candidate cuối; không suy rằng worker khác đang chạy cũng chưa chạy.
- **PARTIAL**: mới đủ một phần tiêu chí; **BLOCKED**: thiếu đầu vào/quyền/hạ tầng được nêu cụ thể. Không dùng tổng số test hoặc health READY làm điều kiện đóng toàn gate.
- Base checkpoint: PR137 develop`23096fa3a43f82998507d45a8efa7d17b2bface1` có CI sau merge6/6; PR138 head`6ea22d74e5088472cc4d270dac799b50c8210da0` có exact-head CI6/6 theo [CURRENT](../agent-context/CURRENT.md). Chưa GET lại GitHub trong task này. Seller WIP mới không nằm trong CI head cũ; HEAD cũ không đại diện bytes chưa commit.
- Quota Actions theo owner vẫn chặn push/merge/workflow mới. Trạng thái local, remote đã tích hợp và HTTPS staging phải báo riêng. Các báo cáo cũ ghi PR Draft/chưa merge là lịch sử tại lúc chạy, không tự thay metadata hiện tại.

## Tám gate chính thức

| Gate | Bằng chứng local đã có, ngày/source gốc | Đánh giá candidate mới và điều kiện đóng còn thiếu |
|---|---|---|
| **ACCOUNT** | [Auth hardening29/10](auth-session-hardening-2026-10-29.md); [email/reset27/10](auth-email-recovery-2026-10-27.md): Mailpit/consent/token/session; [Google27/10](google-oauth-2026-10-27.md): synthetic LINK và LOGIN thật, tách hai loại; [OTP27/10](phone-otp-sandbox-2026-10-27.md):19 HTTP/PG và5 nhóm Chrome, SMS mô phỏng. Verify email thật30/10 được ghi tại CURRENT, token dùng trong hạn/role giữ nguyên. | **PARTIAL; CURRENT_NOT_RUN** cho hồi quy candidate cuối. Google LINK thật/collision-session và reset email thật chưa khép. Verify delivery không thay reset; synthetic LINK không thay live. HTTPS/cookie/proxy/OAuth redirect của staging chưa đạt. OTP cần kiểm cờ/cấu hình trên candidate; không yêu cầu SMS production ngoài scope. |
| **SELLER** | [Onboarding26/10](seller-onboarding-2026-10-26.md), base`169df599…`:22 HTTP app-role/9 nhóm Chrome; rejected→sửa→nộp lại cùng Store, approve/SUSPENDED/ownership/CV. [Checkpoint30/10](release-priority-checkpoint-2026-10-30.md) tổng hợp rollout local sau đó. | **HISTORICAL_LOCAL_PASS / PARTIAL staging; CURRENT_NOT_RUN** trên candidate cuối. Giữ cùng tài khoản Buyer–Seller, đúng Store và khóa actor; kiểm flags/grant/session khi ghép source cuối. Không gọi onboarding PASS là đã khép mọi lệnh xử lý đơn. |
| **LISTING** | [Listing/Chat29/10](listing-chat-release-2026-10-29.md), implementation`59277df`:2 trục/4 SKU, typed attributes giữfalse/0, Admin duyệt, Buyer chọn đúng SKU;41 focused HTTP và6 nhóm browser trên QA riêng. Hai race variant/axis có regression. | **PARTIAL; CURRENT_NOT_RUN** trên candidate cuối. UI sửa giá/tồn kho SKU đã tạo chưa có theo báo cáo, trong khi scopeP0 có thao tác giá/kho từng SKU: phải đóng gap hoặc có quyết định phạm vi rõ, không tự đẩyP2. Media/staging và đồng bộ toàn UI chưa được nghiệm thu. |
| **DISCOVERY** | [Search/restore29/10](release-ownership-search-recovery-2026-10-29.md), source`7948e239…`:86/86 ảnh-ID-index, CLIP/ES/FAISS thật, keyword/semantic/image/hybrid; hide/PG hydrate, hai outbox mới DELETE/UPSERT và NOOP replay, restart một process. [Checkpoint30/10](release-priority-checkpoint-2026-10-30.md): smoke model/index86. | **PARTIAL; CURRENT_NOT_RUN** trên candidate cuối. Portability ảnh import/historical queue chưa khép, cron cũ giữ tắt; không tự drain để làm PASS. Gói metric/provenance cuối chưa xác minh lại; image functionality không thay chất lượng ảnh độc lập. Không gán readiness1worker thành năng lực nhiều replica. |
| **CHECKOUT** | [Listing/Chat29/10](listing-chat-release-2026-10-29.md): đúng variant/giá server/kho/replay; [checkpoint30/10](release-priority-checkpoint-2026-10-30.md):146 focused HTTP/PG và COD→hậu mãi. [VNPay29/10](vnpay-sit-live-2026-10-29.md), candidatePR135`2079c54`+parserfix: SIT6/6, NCB20000VND→IPN thật→PAID/SUCCEEDED, Web đọcAPI. | **PARTIAL; CURRENT_NOT_RUN** cho candidate cuối; VNPay QC/callback staging còn mở. Kiểm quyền/giá/kho/duplicate/rollback đúng source; ACK00 không tự đồng nghĩa PAID. Tunnel cũ đã tắt. COD và VNPay sandbox là bản nộp; MoMoP2 không còn blocker. |
| **FULFILMENT** | [Admin30/10](admin-fulfilment-web-2026-10-30.md):27 FE,50 HTTP/PG,7 nhóm Chrome và ledger8Order trên source nhánhPR138; ship/delivered/complete, fail/retry4attempt, returned tốt/hỏng/LOST Admin, Buyer cancel; lost-response/replay/race haiAdmin. Source/hash trong artifact gốc, chưa lấy CI137 thayPR138. | **PARTIAL; CURRENT_NOT_RUN** cho Seller close/candidate cuối tại lúc lập ma trận. TODAY-02/03 phải bổ sung quyền, trạng thái, expected payment, mất phản hồi trước/sau commit, same-key/different-body, race và kho đúng một lần. Seller không LOST; hàng giao thất bại quay về dùngCANCELLATION_RESTORE, hàng hỏng không restock. Giao vận mô phỏng. Thông báo đúng recipientP0 phải có evidence, không bỏ qua. |
| **AFTERSALE** | [Hậu mãi26/10](aftersales-web-2026-10-26.md), [Review26/10](product-review-web-2026-10-26.md), [Listing/Chat29/10](listing-chat-release-2026-10-29.md) và [checkpoint30/10](release-priority-checkpoint-2026-10-30.md):refund-only/return-restock/dispute, Buyer Review/Seller reply/Admin hide, Chat order/privacy/session/history. | **HISTORICAL_LOCAL_PASS / PARTIAL triển khai; CURRENT_NOT_RUN** trên candidate cuối. Kiểm refund tối đa line snapshot đúng một lần, quyền và read state/thông báo; RETURN_RESTORE thuộc hậu mãi, khác cancellationrestore. Hoàn tiền là mô phỏng, không bank refund; không nhận chat media hoặc multi-instance realtime. |
| **OPERATE** | [Checkpoint30/10](release-priority-checkpoint-2026-10-30.md):39 migrations, restore local68bảng/90ảnh, app-role và smoke;40 readrequest/concurrency4/p95≈48,94ms là baseline nhẹ. [Admin30/10](admin-fulfilment-web-2026-10-30.md):CI137postmerge và provenance. [Staging readiness29/10](../deployment/staging-readiness-2026-10-29.md) ghi gate còn mở. | **PARTIAL / BLOCKED remote/staging; CURRENT_NOT_RUN** cho finalRC. Cần SHA/commit chứa đúng source, test phù hợp/migrations, flags/data/demo/runbook và docs khớp. Quota chặn tích hợp remote; chưa HTTPS/cookie/proxy/private-services acceptance, offsite/cloud restore/rollback executable hoặc workloadSRS. Không suy stress/load từ40GET. |

## Bằng chứng xuyên gate không được bỏ sót

| Hạng mục | Evidence lịch sử và tiêu chí cuối |
|---|---|
| **Thông báo trong ứng dụngP0** | [Notifications27/10](notifications-2026-10-27.md), base`f271318`:22 HTTP/PG,35 focused Web,9 nhóm Chrome; projector/dedupe/audience/late commit/read watermark/role/session/privacy. Ba flags mặc địnhfalse; đây là evidence lịch sử30migrations, không phải current39migration smoke. Candidate cần kiểm inbox/badge/recipient đúng sau sự kiện Order/Store/Product và không rollback nghiệp vụ khi notify lỗi. |
| **Email thông báoP1** | [Business email28/10](business-notification-email-2026-10-28.md), base`d5815d5`: Mailpit HTTP/Chrome, accepted đúng recipient, UNKNOWN sau mất phản hồi không gửi lại mù. Receipt accepted không chứng minh Gmail inbox; không suy verify-email thật đã đóng notificationemail. Scope cho demo provider thử, không được gọi gửi ngoài thật nếu mới Mailpit. |
| **Phone OTP sandboxP1** | [OTP27/10](phone-otp-sandbox-2026-10-27.md):expiry/quota/consume/reconcile/audit/contact, fault rollback và5Chromegroups. Giữ nhãn SMS mô phỏng; không sử dụng contact sandbox cho login/recovery/2FA/cấp quyền. Không mặc định toànAuthP1 PASS nhờ OTP. |
| **Reset/Google LINK/VNPayQC** | [Email27/10](auth-email-recovery-2026-10-27.md), [Google27/10](google-oauth-2026-10-27.md), [VNPay29/10](vnpay-sit-live-2026-10-29.md) chỉ đóng đúng ca/phạm vi đã chạy. CURRENT ghi verify30/10 thật, liveLINK/reset thật/QC còn mở. Các ca provider mới thực hiện tuần tự trên QA riêng, đúng quyền và input; không tự dùng lại consentTOS cũ. |

## Search: điều kiện gói số liệu báo cáo

- Quyết định hiện hành [7query/86Product/602cặp23/10](electronics/evaluation-scope-7q-2026-10-23.md): Precision/Recall@5/10/20, cùng7query cho ba hệ keyword/semantic/hybrid. Năm query thiếu nhãn giữ ngoài tính, không điền0.
- Nhãn có AI hỗ trợ, tập development; không ghi hai lượt chấm độc lập, held-out benchmark hoặc chất lượng toàn hệ thống/ảnh. Ngưỡngchính relevance2; ngưỡng>=1 nếu có phải tách.
- [Gói sơ bộ20/10](electronics/preliminary/2026-10-20-seven-query/README.md) có CSV/Excel/provenance/verifier/hash. Nhãn PRELIMINARY là lịch sử trước quyết định23/10; không lấy nó để cấm mọi phép tính7query, cũng không tự đổi thành gói cuối đã verified.
- [Completionv2](electronics/evaluation-completion-v2.md) đã ghi phần12query/consensus là quy trình lịch sử, không đặt lại blocker đủ12query. Phải kiểm danh sách7queryId,602nhãn,corpus/mapping/hash/model/index/rawresult và phép tính/gói xuất cuối trước khi chốt báo cáo. Task này **không chạy verifier hoặc công bố metric mới**.
- Portability ảnh/mapping/index và historical queue là gate vận hành riêng; benchmark văn bản không thay việc dựng lại catalog. Giữ outbox bất biến/version; không sửa event cũ để vượt smoke.

## Khoảng trống ưu tiên và kết luận được phép

1. **P0 Seller close:** cần actual browser/HTTP/ledger theo source cuối; unit/mock PASS chưa thay kho thật. Journal chỉ metadata+explicit replay, không tự tuyên bố auto-recovery hoàn toàn hoặc xóa pending khi quên body.
2. **P0 SKU editor:** scope yêu cầu thao tác giá/kho từngSKU, báo cáo listing ghi chưa có editor đã tạo. Cần task/acceptance hoặc quyết định phạm vi được owner xác nhận; không âm thầm gọi DONE.
3. **P0 in-app notifications:** có evidence lịch sử, không coi thiếu code; cần currentflag/config và smoke correctrecipient trên candidate. Email chưa nghiệm thu ngoài không làm thông báoin-appP0 thànhP2.
4. **P1 provider:** liveGoogleLINK/resetmail/VNPayQC chưa khép; verify thật chỉ đúng verify. PhoneOTP sandbox có evidence, chưa phải SMS thật. Không mở provider/resource tự động từ ma trận.
5. **P0/P1 vận hành và đánh giá:** remoteCI/quota, HTTPS, portability/historicalqueue, finalmetric/provenance, rollback/offsite và gói demo còn phải có kết quả riêng. Không lấy restore local làm cloudrestore.
6. **Phạm vi được giữ:** MoMoP2 theoSCOPE-PAYMENT-002; refund/giao vận mô phỏng; không fullUIredesignDONE, không ASVScert/pentesttoàndiện/production-ready hoặc điểmphầntrăm tự suy.

HISTORICAL_LOCAL_PASS không tự trở thành CURRENT hay toàngateDONE. Bản phát hành cuối cần source/migrations thống nhất, kiểm thử đúng source, reviewer khác worker, các lỗi nghiêm trọng về quyền/tiền/kho/ghi trùng đã xử lý và tài liệu khớp mức local/integrated/staging thực tế.

## Bổ sung thực thi candidate hiện tại — coordinator ghi

Chưa điền số110test/Sellerbrowser hoặc provider mới trong bản traceability này. Coordinator bổ sung sau khi nhận actual report, fingerprint/commit, DB/actor, reviewer và giới hạn. Không cộng các lượt rerun thay thế nhau; giữ FAIL/SKIP/TODO, không gọi CI head cũ là CI Seller WIP mới.

| Ngày/source candidate | Luồng và test thực thi | Artifact/reviewer | Kết luận local/remote/staging và giới hạn |
|---|---|---|---|
| Chờ coordinator | Chờ bằng chứng thực thi | Chưa được worker ma trận xác minh | CURRENT_NOT_RUN trong phạm vi đối chiếu này |

## Checkpoint bổ sung thực thi30/10 — Codex

Các mục CURRENT_NOT_RUN phía trên mô tả lượt đọc tài liệu trước thực thi, đã được bằng chứng dưới thay thế đúng phạm vi, không phải đóng mọi gate:

| Luồng/source | Bằng chứng mới | Kết luận và giới hạn |
|---|---|---|
| Seller close/resolverc18 | [Seller QA](seller-close-release-2026-10-30.md), migration40, fullBE1872/fullE2E1212PASS1SKIP20TODO, native12groups/16Orders | DONE_LOCAL, không remoteCI/staging; paidnegative là fixture khôngVNPay thật |
| Reset/GoogleLINK vàLOGIN | [Provider QA](live-email-reset-google-link-2026-10-30.md), owner xác nhận + DB/identity/CV1→2→3 | LIVE_LOCAL_QA_PASS; chưa businessnotificationemail/HTTPS/collisionhaiaccountsthật |
| SKU giá/kho | [SKU QA](seller-variant-inventory-2026-10-30.md), D13,35DMLPG+3Chrome+53FEfocusedPASS | SOURCE/QA_LOCAL_PASS; toànE2E1247PASS1SKIP20TODO; demorollout/read-onlySellerGETPASS; enqueueSearch chưa liveESFAISS consumption |
| Demo migration/restore | `demo-upgrade-1793354083452/report.json`,90ảnh,67businessfingerprints/2Orders giữ nguyên, read-onlysmoke4PASS | LOCAL_RESTORE_PASS; khôngoffsite/cloud hoặcold-executable rollback |
| Search gói7query | packageverifier chạyread-onlyPASS;7query/602cặp, khôngbổsung5unjudged | externalRawArtifactsRecheckedfalse, officialPublicationGateExecutedfalse; chưa finalpublication |

Artifact tên thư mục tại root máy `machine-local/final-day-20261030/`; sourcehash trong provenance. Không cộng các lượt rerun hoặc gắn CI cũ vào source mới. MoMoP2 và toànUI chưaDONE vẫn giữ nguyên.
