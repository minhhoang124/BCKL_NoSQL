# Review điều kiện merge PR138 và PR139 — 31/10/2026

Review đúng head, không checkout/ghi đè WIP; không merge, push, rerun Actions hoặc đổi billing/workflow. Theo owner, hoàn tất review hai PR trước khi sửa ba lỗi UX.

| PR | Head / base | Kết luận |
|---|---|---|
|[138](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/138)|6ea22d74e5088472cc4d270dac799b50c8210da0 / develop23096fa|Đạt về code/CI trong phạm vi feature:6/6 jobsSUCCESS,không unresolvedthreads,không confirmedP1/P2 mới trong diff. Sẵn sàng đề xuất merge khi owner/quy trình cho phép; không đồng nghĩa bản phát hành cuối đủAuth/staging|
|[139](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/139)|14ed3d30952f2a6d17c7017d20b32c69002a2daf / develop23096fa|Chưa đủ điều kiện merge:Draft,CI6/6FAIL trước khi chạysteps; reviewHiền làCOMMENTED; contract còn yêu cầu thống nhất chính sách Hoàng–Đạt. Chưa thấy confirmedP1/P2 mới trong diff; giữcutoffunset|

## PR138

Đọc newAdmin reader, client, workspace và tests: transaction khóaUserFOR SHARE, recheckactive/Admin/CV; projection tối thiểu không Buyer/address/phone/reason/key; Decimal string chuẩn, no-store, boundedtimeout/safe503. Web consent/latch/session+selectionfence, journalchỉmetadata lưu trướcPOST, hashđúngbody, replaychủđộng cùngkey, receiptvalidation, không tự tiếp bước; late response phiên cũ không xóa journal mới.

CI xác minh trực tiếp run[40989177252](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/actions/runs/40989177252), đủ6jobsSUCCESS gồm repositorychecks,AI và4evaluationmatrix. Có review COMMENTED đã ghi owner cho phép AIcrossreview, không giả humanapproval. Các27FE/50HTTP/7Chrome ở review lịch sử thuộc đúnghead; nghiệmthu31/10 trên candidate mới hơn không thay bằng chứng exacthead.

Head138 chưa chứa Authwriteepochfix168ba50. Đây là write-layer gap có trướcPR138, không phải regression của reader/UI. Bản phát hành cuối phải giữ companionfix đã được tái hiện/sửa trong candidate. Gitancestor xác nhận138 đã nằm trongcandidate1c4feb4; không cherry-pick/ghi đè lại. Merge riêng theo squash cần kiểm lịch sử khi tích hợp candidate tiếp.

## PR139

Hai configNone/finite[-1,1] ởserver; cosinecutoff trướclimit, điểm bằngngưỡng giữ, rankliêntiếp, không bùđủK; nonfinitebỏ. Hybrid chỉ lọc semantic trướcRRF, keyword/metadata độc lập; Backend hydratePG không đổi. Đã đọc normalizationCLIP/FAISSupsert/IndexFlatIP. Envelope, SS RF/imagevalidation/indexmutation không đổi; empty200/items[] tách khỏiupstreamerror.

Kiểm độc lập bằng snapshot đầy đủ của đúngcommit, không source/runtimeDemo:

- FEfocused Home/Image/API/telemetry:50PASS.
- AI full:336PASS,1FAIL doWindowsWinError1314 khi test tạo symlinkngoài dataset; test này có từ trước và không thuộcdiff. Không xóa/skip test hoặc gọi337PASS.19casecutoff mới đềuPASS.
- Ruff3Pythonfiles thay đổi:PASS. Exportfixture regen ở bản trích riêng khớpJSON/ngữ nghĩa vàbytechuẩnLF so vớicommit; khácCRLFghiWindows không phảiwirechange.
- Lượt trích ban đầu chỉAI/FE thiếufixture ởdocs làm92testfail, cộng1symlinkfail; đã dùng fullcommitsnapshot kiểm lại ra sốtrên. Không biến lỗi snapshotthiếu thành regressionPR.
- ReviewHiền trênGitHub báo337AI/50FE/buildPASS trên môi trường riêng, và annotationquota; phân biệt bằng chứng đó với rerunWindows này. Chưa chạy lạiBE92Search hoặc DBE2E cho139 trong lượt review.

CI run[41005273931](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/actions/runs/41005273931) hiện6jobsFAIL, không steps. Hiền đã đọc annotation và ghi nguyên nhânpayments/spendinglimit; owner cũng đã báo hếtquota. Connector hiện từ chối annotationendpoint, publicAPIkhông có quyền trả404 nên coordinator không tự nhận đã đọc lại annotation. Không gọi làtestcodeFAIL từ trạng tháiCI này, cũng không thayCI bằnglocalPASS.

Ngưỡngtext0.265/image0.80 làtuningdevelopment chưarepresentative/held-out; không bậtchung đểmerge. Defaultunset bảo toàn compatibility. Reviewquy trìnhHoàng–Đạt và trạng tháiDraft phải được khép thật; không giả signoff từreviewCOMMENTED.

## Tích hợp và giới hạn quyền

Read-only merge-tree:138+139 trênbase23096fa không conflictmarkers.139 vào candidate1c4feb4 có conflict ởFE/src/pages/HomePage.tsx. Cần giữ UI/copy chuyên nghiệp mới và empty-state139; không lấy nguyên filecũ đè WIP. Không chạymerge trong workingtreeđangdirty.

APIđọc branchprotectiondevelop bị403 Resource not accessible by integration; chưa xácminh toàn bộ rules hoặc khả năng GitHub cho phép bấmMerge. Mergeabletrue chỉ nói khôngconflict vớidevelop hiện tại, không thay CI/approval/quota. User yêu cầu review, chưa tựmerge. Sau review mới chuyển sang sửaUX01–03 ởtask nghiệmthu.
