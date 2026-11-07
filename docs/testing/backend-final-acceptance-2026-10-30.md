# Backend candidate cuối ngày30/10/2026

Chốt local/QA trên branch `feat/hoang/sku-management-final`, nối các commit Seller/SKU sau base develop23096fa và PR138. Không tự merge develop/main. OwnerD15 đã yêu cầu push lại; không đổi workflow hoặc billing. Kết quả Git/CI công khai phải đối chiếu SHA thực tế, không dùng CI của6ea22d7 cho source mới.

## Những lỗi đã khép

1. **Phiên bị thu hồi giữa JWT guard và transaction:** tái hiện3RED bằng HTTP/PG thật; khóa User rồi so verified epoch trước replay/ghi trên các lệnh Checkout/Order/resolver.10oracle sau fixPASS. Xem [quy tắc epoch](../api/transactional-write-epoch.md).
2. **URL ảnh legacy làm event mới bị422:** chuẩn hóa managed `/uploads/...` tại producer, không sửa payload cũ. Originconfig500 có code riêng và fail startup; production cần BACKEND_PUBLIC_URL explicit. URLcatalog400 có productId/imageIndex, không echoURL/credential. Absolutequery `%` hợp lệ được giữ; rawspace/control/backslash/credential vẫn bị từ chối theo policy rõ ràng.
3. **Reconciliation churn vì JSONB đổi thứ tự key:** structural comparison giữ mọi key, ignoreobject-keyorder nhưng giữ arrayorder/types.7ca PG thật kiểm nhiều thuộc tính, CREATED→SKIPPED, thay giá và cạnh tranh.
4. **WebP upload hợp lệ nhưng AI không index:** Backend validate WebP gốc, chuẩn hóa thành PNG lossless trước hash/staging; giữ alpha, cap5MiB sau chuyển đổi. JPEG/PNG giữ bytes cũ. Luồng upload HTTP→PNGmedia→Seller gửi duyệt→Admin duyệt→CLIP/ES/FAISS đã chạy thật. Không đổi wireAI hoặc hợp đồng publicimagequeryJPEG/PNG.

## Kiểm thử source cuối

| Bộ kiểm | Kết quả | Artifact dưới `machine-local/final-day-20261030/` |
|---|---|---|
| BE fullunit |1987PASS,0FAIL|`be-regression-1793372779030/results.json`, source-stabilitytrue; BE source không đổi sau lượt này |
| BE fullE2E |1264PASS,0FAIL,1opt-inSKIP,20historicalTODO|`e2e-regression-1793373341894/results.json`, source-stabilitytrue |
| Live cachedhealth riêng |1PASS|`be-final-focused-1793373036064/results.json`; realFastAPI cố ý không load model, phủ ca mặc địnhSKIP |
| DMLfocused |74PASS|`be-final-focused-1793372290649/results.json`;10Auth/7recon/35SKU/22Notifications |
| RealCLIP/ES/FAISS |9groupsPASS,3vectors|`sku-search-live-1793372844383/browser/report.json`; QA40 mới, không indexDemo |
| Notification native |6HTTPgroups+7ChromegroupsPASS|`notify-browser-1793372989680/browser/{ledger-report.json,browser-report.json}`; currentUI/sourcehash,4rows,0emailjobs,11businesshashes không đổi |
| SKU native |3Chromegroups+3SKUledgerPASS|`sku-browser-1793372985205/browser/{browser-report.json,ledger-report.json}` |
| Address/Cart + Aftersales targetguards |19PASS|`node --test scripts/address-cart-handoff.test.mjs scripts/aftersales-qa.test.mjs` trongBE |
| Build/typecheck/lint |PASS| Lint còn2cảnh báo control-regex có chủ đích trong URLsecurityvalidation; không tắt rule để che lỗi |

FullE2E dùng migrator cho các ca DDL/fault-trigger lịch sử;74focused và các native/live runner dùng roleDML không super/CREATE để chứng minh runtime. Không cộng các lượt rerun thành tổng test. Lượt E2E trước `e2e-regression-1793372773326`1260PASS4FAIL: bốn fullpayloadassertion cũ còn mong imageURLs tương đối. Chỉ cập nhật đúng kỳ vọng ảnh thành URL tuyệt đối; giữ các assertion tiền/kho/snapshot/replay và chạy lại toàn bộ đạt như bảng.

20TODO là checklist cũ có mapping trong runtime/migration evidence, không xóa hoặc gọi là20PASS. Một healthSKIP opt-in đã có lượt riêng, không sửa số của fullsuite. Không dùng bộ test này làm chứng nhận pentest/ASVS hoặc đảm bảo production.

## Review và disposition

`backend-review-1793372526347/summary.json`: ClaudeSonnetMedium review diff epoch/helper/controller không confirmedP1/P2; ArgonMedium review Searchproducer/config/structuralcomparison và policy không confirmedP1/P2 trong snapshot. Coordinator kiểm các callsites controller, basehandlers Buyer/Seller và Seller/Adminreturned; giữ SYSTEMpath. Hypothesis replay/catch trả401 đã có oracle thực tế.

**Poison image policy:** fail closed, không bỏ ảnh lỗi hoặc checkpoint qua product lỗi. Transaction product rollback; job retry hữu hạn8lần rồiDEAD. Unit chứng minh job hỏng không chặn job độc lập trong batch. Vận hành phải sửa image/config có productId/imageIndex, sau đó tạo **job mới cùng scope/scopeId** để xử lý cả phần sau product lỗi. Không reset attempt/cursor để làm đẹp bằng chứng và không mutate event cũ. Inner transaction conflict retry5 khác8attempts của job.

`webp-review-1793373501995/summary.json`: ClaudeMedium không thấy blocker mới; nêu hai rủi ro vận hành thấp: staging có thể còn file sau crash, và concurrentdecode25MP có thể tạo áp lực bộ nhớ. Existingrepairworker xử lý DB ảnh mất file, không đồng nghĩa có garbagecollector cho mọi `.staging` orphan. Cần chính sách retention/sweep được duyệt và đo capacity trước production; không xóa uploads tự động trong lượt này. AnimatedWebP chỉ frame đầu theo decoder mặc định; không claim kiểm mọi ICC/profile/animation. Demoaudit không có legacyWebP; môi trường khác cần audit riêng.

## Demo sau cập nhật

`demo-search-apply-1793373997270/report.json`: hai Product liên quan hai legacy events được tạo higher-version event và xác nhận cảES/FAISS; reconciliation chạy lạiSKIPPED;0openevents,86vectors,10business-tablehashes không đổi. Hai payload lịch sử giữ nguyên, worker thật đánh dấu422terminalFAILED; không xóa hoặc giảSUCCEEDED.

`demo-reconciliation-close-1793374715139/report.json`: xử lý đúng7PENDINGscopejobs,7SUCCEEDED,0openevents; đối chiếu đủ86publicProducts giữaDB/ES/FAISS (version, min/maxprice, inStock),86vectors và financial/inventoryhash không đổi.119URLs đã qua policy. Đây là metadata/index reconciliation, không sửa giá/kho/đơn. Cờ hai worker được bật trong profile local và nạp qua managedBackendrestart; chỉ gọi DONEruntime sau smoke cuối ởCURRENT.

## Phạm vi tám gate và phần ngoài local

Đối chiếu [audit tám gate](backend-final-gate-audit-2026-10-30.md) và [ma trận](final-day-acceptance-matrix-2026-10-30.md). FullE2E hiện tại chạy Auth/Store/listing/Search/Checkout/COD/fulfilment/cancel/returned/completion/Aftersales/dispute/Review/Chat/Notifications/Admin/Payments theo testsource, không gắn toàn bộ nguồn notification vào7nativegroups.

Live reset email + GoogleLINK/LOGIN đã được owner xác nhận và DB đối chiếu riêng. VNPay có SIT6/6 và NCBsandbox→IPNthật→PAID từ29/10; không gọi đó là QCthủcông/HTTPSstaging của candidate cuối. Returnfailure/bankcancel mới, whitelist/logQC, business-email delivery, livecollisionhaiGoogleaccounts, offsitebackup/rollback executable/load/publicAzure vẫn chưa khép. MoMoP2. Không tạo resource, mở tunnel, gửi mail hoặc nhận TOS mới chỉ để đổi các dòng này thànhDONE.

Phần UI Argon hiện có một đợt WIP riêng và được giữ nguyên; các kiểm native trên workingcopy ghi sourcehash thực tế. Push phần BE không tự tuyên bố đã publish hoặc nghiệm thu toàn bộ visualUI mới; marketingbanners được ownerD14 xác nhận trangtrí, không phải tính năng khuyếnmãi thật.
