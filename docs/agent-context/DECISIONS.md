# Quyết định còn hiệu lực

Nguồn các mục dưới là chỉ đạo trực tiếp của owner trong chat dự án đến 30/10/2026; không phải suy đoán của model. Chỉ đạo mới hơn trong phiên được ưu tiên, ghi rõ khi thay đổi.

| ID | Quyết định / phạm vi |
|---|---|
| D01 | Hạn nộp 08/11/2026. Mục tiêu kế hoạch khóa code05/11, không tự coi là ngày bảo vệ đã xác nhận. Các mốc tháng12 trong tài liệu cũ không thay hạn owner hiện tại |
| D02 | Bốn tiêu chí: ổn định, thực tế, dễ mở rộng và cẩn thận. Ưu tiên quyền, tiền, kho và chống ghi trùng trước tính năng mới |
| D03 | MoMo tạm dừng, đưa vào mở rộng theo SCOPE-PAYMENT-002. Bản nộp giữ COD/VNPay sandbox; không ghi MoMo DONE hoặc blocker |
| D04 | Owner cho phép Codex cùng Gemini/Claude hỗ trợ, review chéo và đối kháng; không cần chờ reviewer thành viên trong phạm vi đã giao. Đây không phải human approval giả hoặc quyền miễn kiểm thử. Chưa nới CI/quota hay cho phép mọi thay đổi contract/migration tương lai |
| D05 | Argon và mọi Claude tối đa Medium. Gemini Flash tối đa High. Không tự nâng effort/model lên High cho Argon/Claude khi timeout/rỗng |
| D06 | GitHub Actions hết quota theo owner. Không push/merge/kích workflow mới hoặc thay billing/workflow để né. Chỉ mở lại khi owner có chỉ đạo mới giải quyết giới hạn này; kế hoạch agent tự viết không tự gỡ chặn |
| D07 | Owner muốn đồng bộ UI toàn bộ; triển khai từng phần, bảo toàn hợp đồng nghiệp vụ và dữ liệu. Không coi thiết kế lại là đã được nghiệm thu |
| D08 | 86 sản phẩm ABO thiếu giá/kho/kiện được phép tạo bộ demo riêng, ghi rõ mô phỏng; không giả thành dữ liệu bán thật |
| D09 | Người nhận email kiểm thử là alias OWNER_EMAIL_TEST, được lưu riêng tại root máy `machine-local/shared-context-20261030/authorized-recipient.private.json`. Không gửi người khác hoặc tự chạy lại mail. Verify đã PASS; quyền gửi ca trước không phải quyền gửi hàng loạt. Không đính kèm file địa chỉ vào prompt review |
| D10 | Azure Education có tài khoản nhưng chưa có domain, chưa chốt tài nguyên/chi phí; không tự triển khai gây phí. HTTPS callback-only tunnel trước đã tắt |
| D11 | TOS giao dịch VNPay sandbox từng lần trước được xác nhận riêng, không tái sử dụng xác nhận đó cho giao dịch mới |
| D12 | Bộ nhớ chung lưu trong dự án và cập nhật qua bàn giao có review; không tự ghi vào bộ nhớ cá nhân/toàn cục của provider. Chỉ đạo tạo bộ nhớ không tự tiếp tục toàn bộ nghiệp vụ đang tạm dừng |
| D13 | Owner xác nhận30/10: giá/kho SKU đã tạo được áp dụng ngay, giữ quy trình duyệt khi sửa nội dung. Sửa giá/kho vẫn kiểm quyền/CAS, ledger và Search outbox; không tự đưa sản phẩm đã duyệt về nháp chỉ vì cập nhật giá/kho |

D14 — Owner30/10 xác nhận bannerNoel/ưuđãi chủyếu là trangtrí; giữhướngvisualnày, không ghi thành chức năng đã nghiệmthu. Owner yêu cầu xóa huyhiệu/chữ Đã đăng ký Bộ Công Thương. Codex chỉ gỡ badgeFooter và CSS riêng, không đổi cácbanner khác. Xác nhận này không chứng minh đăngký/chínhhãng/ưuđãi/đốitác thật.

Quy tắc kiến trúc giữ nguyên: PostgreSQL là nguồn nghiệp vụ; ES/FAISS là index phụ. productId integer đồng nhất; giá/kho thuộc Variant; Order snapshot bất biến. Migration mới thay vì sửa migration dùng chung. Secret/model/index/uploads/dump không vào Git/bộ nhớ/prompt review.

D15 — Chỉ đạo owner30/10 mới: quay lạiBE, khép phần thiếu/nghiệmthu luồng chức năng và đẩyGit. Cho phép pushbranchcandidate đãkiểm, thay giới hạn D06 cũ đối với push; không tựmerge/main/develop, không đổiworkflow/billing hoặc tạoAzure/tunnel/gửimail/nhậnTOSmới. Giữ reviewCodex+Gemini/Claude theoD04 vàmodelcapsD05. QuotaActions có thể vẫn hết, phải báo đúng nếu chưa cóCI mới.

D16 — Owner31/10 yêu cầu nội dung FE theo ứng dụng mua sắm thực tế: không giới thiệu đồ án, tên công nghệ hoặc tiến độ triển khai trên các màn sử dụng. Owner tự trình bày nghiệp vụ khi bảo vệ. Gỡ chip AI CLIP và hướng dẫn hover nhắc Shein; đổi thông báo theo ngôn ngữ của khách hàng/người bán. Giữ hướng dẫn thao tác, consent, phục hồi và giới hạn thanh toán/giao hàng mô phỏng đúng thực tế; không thay đổi nghiệp vụ để làm giao diện trông hoàn thiện hơn.

D17 — Owner31/10 trả lời “vậy thực hiện giúp mình đi” sau khi được giải thích kế hoạch khép PR138, chốt139 và tích hợp. Cho phép thực hiện merge hai PR này, thay giới hạn không merge trước đó trong đúng phạm vi này. Giữ cutoff139 mặc định unset; không nhận các ngưỡng thử0.265/0.80 là cấu hình đã nghiệm thu hoặc giả chữ ký Đạt. Không sửa CI/billing, không tự rerun workflow, không cấp quyền deploy production.
