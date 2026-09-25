# Nhận xét và đối chiếu SRS v3.1

Ngày cập nhật 24/09/2026. Bản bàn giao: [SRS v3 Markdown](srs-v3.md) và [SRS v3 Word](srs-v3.docx).

## Kết quả tổng hợp

SRS v3 kết hợp bản tham khảo srs-marketplace-review-draft.md của Hoàng, bản phân tích v0.5 của Hiền tại b358beb, SRS Đề tài 18 v2 và các quyết định phạm vi/Product/Chat. File tham khảo ở C:\khoaluan có SHA-256 trùng bản trong Downloads. Bản Word v0.5 ngày 15/09 không được dùng làm nguồn nội dung mới nhất.

Đã giữ 37 mã yêu cầu cũ qua bảng alias; giữ UC-HT01 đến UC-HT10, thêm UC-HT11 thanh toán, UC-HT12 hậu mãi và UC-HT13 hồ sơ/thông báo. TC-01 đến TC-44 được giữ và hiệu chỉnh điểm chưa rõ; bổ sung đến TC-60. Các ca trong SRS đều là thiết kế NOT_RUN, không phải bằng chứng đã kiểm thử.

## Nhận xét bản Hoàng gửi và các điểm đã xử lý

1. Bản Hoàng mô tả tốt các luồng thực tế và lỗi cạnh tranh, nhưng chưa truy vết đủ mã cũ, early/late fusion, thống kê tìm kiếm Seller và đổi mật khẩu chủ động. V3 đã bổ sung các phần này, không bỏ yêu cầu học thuật cũ khi đổi cách trình bày.
2. v0.5 ghi xác minh tài khoản P0, lệch implementation-scope. V3 đưa verify/reset, Google và OTP về P1; giữ hồ sơ/địa chỉ/onboarding P0. P1 vẫn cam kết trước bảo vệ.
3. Bản tham khảo có thể bị hiểu là cho phép tắt category đang được dùng. V3 giữ quy tắc hiện có: không tắt khi còn con hoạt động hoặc Product tham chiếu; không xóa dữ liệu đang được tham chiếu.
4. Public khi hết hàng, actor giao hàng/hoàn tất và cách sửa Product sau duyệt đã được chốt tại D02/D04/D07. V3.1 đưa các quyết định đó vào FR/AC/UC/TC, đồng thời vẫn ghi PR #18 là IN_PROGRESS thay vì coi code đã hoàn tất.
5. Checkout all-or-nothing đã được v0.5 ghi chốt. V3 không mở lại quyết định này; D06 chỉ giữ phần bổ sung thanh toán từng Order, timeout/late callback và cách đối chiếu.
6. Hậu mãi kế thừa đầy đủ scope mới: giữ quyền PENDING/APPROVED, chặn xuyên request/key, mã ORDER_ITEM_ALREADY_FULLY_REFUNDED, không tăng stock cho REFUND_ONLY và không tạo doanh thu âm trước COMPLETED. Bổ sung không refund khoản chưa thu.
7. Search giữ PostgreSQL nguồn chuẩn, FastAPI sở hữu ES/FAISS/RRF; SRS không ghi đè contract hoặc cố định lại candidateK/timeout từ bản cũ. Tách smoke mapping/self-match khỏi đánh giá query độc lập và public-ready.
8. Bổ sung mô hình logic, các ràng buộc dữ liệu, API theo chức năng, 13 Use Case, FR–UC–API/dữ liệu–TC và release gate. Không gán trạng thái CURRENT cho phần chỉ có tài liệu.
9. Thời hạn bảo vệ được diễn đạt theo scope tháng 12/2026; mốc 08/11 của SRS v2 là kế hoạch nội bộ cũ. Không tự điền ngày bảo vệ cụ thể.

## Kết quả xác nhận và cập nhật cuối

Hoàng đã xác nhận D01–D10 ngày 23/09/2026. Đạt xác nhận D04/D09 ngày 24/09/2026: Elasticsearch chỉ tạo ứng viên; Backend hydrate PostgreSQL và recheck giá/inStock trên cùng một Variant active; Search worker dùng signed URL có thời hạn và host allowlist; ảnh query multipart xử lý tạm. Các xác nhận này không đổi payload PR #8.

SRS v3.1 đã đồng bộ FR, AC, UC, API boundary, mô hình dữ liệu, TC và ma trận truy vết. 60 ca kiểm thử vẫn là thiết kế NOT_RUN. XMI/VPP không đổi topology vì D01–D10 chỉ làm rõ luồng hiện có. CURRENT/IN_PROGRESS/TARGET tiếp tục dựa trên PR merge và bằng chứng kiểm thử, không dựa trên việc quyết định đã được duyệt.
