# Phân công tăng tốc Address/Cart và tích hợp — 03/10/2026

## 1. Phân công đã giao và mục tiêu

**Trạng thái: CONFIRMED_BY_HIEN — cập nhật 05/10/2026.** Hoàng giao Hiền CODE hai màn Buyer UI Address/Cart ngày 04/10, không chỉ review bộ giao diện tham chiếu trước đây. Hiền đã [xác nhận nhận task trên PR #29 ngày 04/10](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-5978048696), tách Address/Cart thành các PR riêng ngoài Admin #28, không tự đổi API/schema. Chưa có cam kết lịch cụ thể hoặc bằng chứng UI hoàn thành. Không chuyển toàn bộ Buyer/Seller UI hoặc trách nhiệm Backend cho Hiền.

Mục tiêu checkpoint 11/10: tiến tới luồng mua hàng chạy thật. Đây là mục tiêu cần kiểm chứng, không phải tuyên bố chắc chắn sẽ đạt. Schema #26 đã merge tại develop `08f165e`; contract #27 đã review/merge tại c0a7d48. Cập nhật GitHub 05/10: Address #30 đã merge tại efd86a3; Cart Backend #31 đã merge tại 6663fab; #29 cần re-review nội dung mới (approval chỉ ở head cũ). Checkout còn TARGET; UI chưa nghiệm thu. Hiền có thể nối cả Address và Cart API đã merge, tách hai PR UI riêng.

## 2. Hoàng — Backend và tích hợp

Thứ tự:

1. Đã merge #27 vào develop sau #26; đồng bộ branch implementation theo develop c0a7d48, dùng contract đã review.
2. Triển khai theo contract Address/Cart đã chốt: province/ward bắt buộc, district nullable bằng migration mới; DTO unavailableItems và validation theo tài liệu, không tự đổi luật.
3. Address API: ownership từ JWT, validation, default address nguyên tử, concurrent update và giới hạn đã duyệt.
4. Cart API: Variant, quantity tuyệt đối, nhóm Store, privacy, giá/kho hiện hành, không giữ kho và không phát SearchOutbox vì chỉ sửa giỏ.
5. Checkout/COD: snapshot, key/hash replay, all-or-nothing nhiều Store, cạnh tranh kho và version/outbox nguyên tử khi stock thực sự đổi.
6. Order lifecycle: quyền actor, command receipt, delivery attempt, 3 retry, cancel/restore và job COMPLETED.
7. Buyer UI Checkout/Order, Seller Order UI, Chat ở task riêng; không tự giao sang Đạt.

Phạm vi chủ yếu: `BE/src/`, `BE/test/`, migration mới nếu thiết kế được duyệt, docs API/architecture; Frontend ngoài Address/Cart và Admin vẫn do Hoàng điều phối.

Bàn giao mỗi API gồm Swagger, example request/response, mã lỗi, test, commit/PR và limitation. Hoàng cập nhật kiến trúc khi có luồng chạy thật, không ghi CURRENT/DONE chỉ từ thiết kế.

## 3. Hiền — Admin + Buyer UI Address/Cart + QA

### A. Nghiệp vụ và review trước code

- Contract #27 đã approve/merge; re-review phần tài liệu mới ở #29. Hiền đã xác nhận nhận CODE Buyer Address/Cart ngày 04/10 theo comment dẫn ở mục 1; lịch cụ thể còn chưa chốt. Không tự đổi SRS cho khớp một lỗi implementation.
- Đối chiếu địa chỉ hiện hành, các field bắt buộc/optional, count/subtotal/unavailable và permission.
- Chuẩn bị acceptance cases; test thiết kế chưa chạy phải ghi NOT_RUN, không PASS.

### B. Admin #28

- Hoàn thiện trong phạm vi PR hiện có; xử lý loading/empty/error/forbidden/version conflict và pending mutation.
- Phân biệt review mockup với lỗi code runtime; chỉ nhận đã hoàn thành khi nối API thật và có bằng chứng browser.
- Không đưa feature chưa có API/contract vào báo cáo như chức năng đã triển khai.

### C. Task CODE Buyer UI Address/Cart — Hiền đã xác nhận nhận

Address Book: danh sách, thêm/sửa/xóa, đặt default; xử lý validation/server error, hết phiên, loading, empty, thao tác đồng thời và refresh sau thành công. Không có nút bỏ default nếu contract cấm.

Cart: nhóm Store, checkbox theo dòng/Store, PUT quantity tuyệt đối, xóa, unavailable, lineCount/totalQuantity, purchasableSubtotal và tổng subset chọn. Chỉ dòng available được chọn mua; item ẩn không lộ metadata; không khẳng định giữ hàng vì thêm giỏ thành công.

Phạm vi: trang/components/CSS/service/types/tests riêng cho Address/Cart trong `FE/src/`; dùng router/AuthProvider/apiClient và theme cam-trắng hiện có. Tên route/file chốt với Hoàng trước tạo PR để tránh đụng router. Không sửa Auth, global API client, Product/Seller UI hoặc Backend nếu chưa trao đổi.

Contract #27 đã duyệt/merge; trong khi API chưa triển khai, có thể dựng layout/components với fixture có nhãn MOCK theo contract. Khi API có và được kiểm thử: nối API của Hoàng; xóa/tách mock khỏi luồng demo thật. Không tự thêm endpoint.

Acceptance: đúng ownership từ Backend; form giữ dữ liệu khi lỗi; chặn double-submit; bỏ response cũ khi đổi request; không refresh toàn trang để che lỗi; không lưu secret vào log/storage tùy tiện; lint/build/test FE và browser evidence. Chưa có API thật thì ghi UI prototype, không nghiệm thu chức năng.

Tạo branch/PR Buyer UI riêng từ develop sau khi chốt contract, không gộp vào Admin #28; ghi dependency và nhờ Hoàng review. Hiền vừa code vừa QA không thay review độc lập của Hoàng.

## 4. Đạt — AI/Search và thực nghiệm

- Theo dõi #25: code đã được approve không đồng nghĩa đã có kết quả Precision/Recall.
- Phối hợp Hiền hoàn tất consensus 1.032 cặp trên corpus/mapping đã khóa; chỉ tính metric khi gate cho phép.
- Hỗ trợ kiểm thử stock thay đổi do Checkout/cancel → Product.version/SearchOutbox → FastAPI/index; xác minh version/idempotency và không duplicate vector.
- Không sửa CRUD Address/Cart, Auth hoặc migration mua hàng. Nếu cần đổi contract Backend–AI, tạo review Hoàng–Đạt trước.

Bàn giao: evidence đồng bộ Search, artifacts/provenance/test hợp lệ và báo cáo thực nghiệm đúng trạng thái. Đạt không cần chờ Address UI để làm consensus/công cụ đánh giá.

## 5. Dependencies và cách tránh sửa chồng

| Phần | Có thể làm ngay | Cần chờ |
|---|---|---|
| Hoàng | Đồng bộ Q1–Q7 đã được Hiền chấp thuận vào [contract Checkout/COD](../api/cart-order-inventory-api-contract.md); #31 đã merge tại 6663fab | Re-review bản đồng bộ #29 trước code Checkout; không tự merge |
| Hiền Admin | Hoàn thiện #28 theo contract hiện có | Approval/runtime acceptance trước merge |
| Hiền Address/Cart UI | Đã xác nhận nhận task: layout/component; nối Address API từ #30 đã merge, tách PR UI riêng | Cart API #31 đã merge, có thể nối ngay; phối hợp route/file với Hoàng, không dùng mock làm bằng chứng hoàn thành |
| Đạt | Consensus/tooling và kế hoạch stock-index tests | Checkout chạy thật để nghiệm thu tích hợp |

File dùng chung (router, Auth, API client, schema, contract): báo trước người sở hữu, PR nhỏ, không tự overwrite. Mỗi task branch riêng; không force push, không merge tự động, không commit dataset/ảnh upload/token.

## 6. Checkpoint đề xuất để nhóm xác nhận

- 03–04/10: contract đã merge; Hiền đã xác nhận nhận CODE Address/Cart ngoài Admin. Phạm vi file/route và thứ tự/lịch cụ thể vẫn cần phối hợp; không coi toàn checkpoint đã hoàn thành chỉ từ lời nhận task.
- 04–06/10: Address/Cart API và UI theo contract; review nhỏ từng phần, kiểm thử ownership/default/concurrency.
- 06–09/10: Checkout/COD + Order từng nhánh, nối UI và kiểm stock-index; không giảm kiểm soát transaction để chạy kịp.
- 10–11/10: demo tích hợp, retest lỗi và báo phần chưa đạt. Nếu dependency trễ, nhóm điều chỉnh mốc rõ ràng; không ghi feature chưa có là DONE.

Chat và các phần còn lại vẫn là rủi ro tiến độ cần Hoàng lập task riêng, không ngầm coi đã nằm trong acceptance Address/Cart. Không ôm toàn bộ phần mở rộng vào sprint này.

## 7. Cách báo tiến độ

Mỗi người comment: đã làm / đang làm / blocker / PR-commit / tests thật / bước tiếp theo / checkpoint có khả thi không. Định nghĩa:

- Contract: thỏa thuận API về field/type/lỗi/nghiệp vụ.
- Acceptance: điều kiện nghiệm thu có thể kiểm thử.
- Fixture/mock: dữ liệu giả dùng thiết kế/test, không phải luồng tích hợp thật.
- Transaction: nhiều thao tác DB cùng commit hoặc rollback.
- Idempotency: retry không tạo tác dụng nghiệp vụ lần hai.
- Consensus: nhãn đánh giá được các người gán/review thống nhất.

Phân công Buyer UI đã được Hoàng giao và Hiền xác nhận ngày 04/10 tại comment dẫn ở mục 1. Lịch vẫn là checkpoint đề xuất, không gán deadline đã cam kết thay thành viên. Đạt giữ nguyên phạm vi AI/Search và cần báo checkpoint phần mình. Checklist [Checkout/COD](../architecture/checkout-cod-backend-readiness.md) là bước chuẩn bị Backend của Hoàng, không chuyển sang Hiền/Đạt.
