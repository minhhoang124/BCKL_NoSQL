# Test case User / Seller / Admin — chuẩn bị Giai đoạn 2

Ngày 15/09/2026. Tất cả ca dưới đây **NOT_RUN**: đây là thiết kế kiểm thử, chưa có bằng chứng hệ thống chạy đạt. Chỉ chạy trên môi trường test sau khi API/schema tương ứng có sẵn. Không triển khai Admin dựa trên PR #10 chưa merge.

## Fixture và quy ước

- Tạo User U1/U2, Seller S1/S2 với Store khác nhau và Admin A1 bằng fixture test được Backend cho phép. Không dùng tài khoản thật hay seed tự nâng quyền tài khoản có sẵn.
- Dùng sản phẩm GIỮ: `abo:B004Q3R9B0` (SDHC 8GB), `abo:B004Q3R9BA` (16GB), `abo:B00JZVPC08` (loa đỏ), `abo:B00JZVPGD6` (loa xanh). Đối chiếu tên trong CSV trước khi import.
- Tra productId bằng mapping externalId → productId do Hoàng xuất sau import. Không dùng số thứ tự 1–1200. SKU/variant/giá/tồn phục vụ test được tạo riêng và ghi vào biên bản chạy, không suy từ ABO.
- Chuẩn bị một Product DRAFT, một bị từ chối/ẩn và một đã duyệt đủ điều kiện công khai; variant còn hàng/hết hàng. Dữ liệu QA DRAFT_ONLY chỉ được công khai ở môi trường test sau khi bổ sung và duyệt fixture.
- Mã dưới đây là mã ca kiểm thử, không phải API mới. URL/payload lấy theo contract đã merge. Nếu chưa có thì ghi BLOCKED, không tự thay đổi contract.

## Các ca kiểm thử

| ID | Vai trò / bước thực hiện | Kết quả mong đợi |
| --- | --- | --- |
| U01 | U1 đăng nhập đúng, sai mật khẩu; thử tài khoản bị khóa | Đúng mới nhận phiên hợp lệ; sai/khóa bị từ chối, không lộ mật khẩu |
| U02 | U1 sửa trường role hoặc gọi thao tác Admin | Không nâng quyền; không thay đổi dữ liệu được bảo vệ |
| U03 | Tìm “thẻ nhớ SDHC 8GB”; lọc category/brand theo mapping chính thức | Kết quả đúng bộ lọc; không trả Product ẩn/chưa duyệt; phân trang không lặp bất thường |
| U04 | Gửi ảnh hợp lệ, tệp giả ảnh, ảnh quá giới hạn contract | Ảnh hợp lệ được xử lý; đầu vào sai bị từ chối theo contract, không lỗi nội bộ |
| U05 | Search trả một ID đã ẩn, một ID không tồn tại và hai ID hợp lệ | NestJS loại ID không hợp lệ theo PostgreSQL và giữ thứ tự hai ID còn lại |
| U06 | Thêm variant 8GB rồi đổi sang 16GB, cập nhật số lượng | Cart tham chiếu đúng variant; giá/tồn lấy Backend, không trộn hai biến thể |
| U07 | Hai User cùng mua đơn vị tồn cuối | Không bán vượt tồn; chỉ một yêu cầu giữ/trừ tồn thành công theo cơ chế đã chốt |
| U08 | Đặt COD, sửa amount từ client; Seller đổi giá/tên sau đặt | Tổng tiền do Backend tính; OrderItem giữ snapshot tại thời điểm đặt |
| U09 | Cart nhiều Store; đặt đơn rồi đọc lại | Tách đơn theo Store đúng đặc tả; User chỉ thấy đơn của mình |
| U10 | Gửi hủy đơn hợp lệ hai lần; thử hủy sau mốc không cho phép | Hoàn tồn đúng một lần; chuyển trạng thái không hợp lệ bị từ chối |
| U11 | U2 đọc ID đơn/conversation U1 | Không lộ dữ liệu hoặc thực hiện được thao tác |
| U12 | Đánh giá trước khi đủ điều kiện, sau mua hợp lệ, rồi gửi trùng | Chỉ đánh giá khi đủ điều kiện; xử lý trùng theo đặc tả |
| S01 | S1 tạo Product, option và variant hợp lệ; thử giá/tồn âm | Dữ liệu hợp lệ lưu được; âm bị từ chối, không có bản ghi dở dang |
| S02 | S2 cập nhật Product/variant/đơn thuộc S1 | Bị từ chối do ownership, kể cả khi biết ID |
| S03 | Gắn option value/ảnh của Product khác vào variant | Bị từ chối; không tạo liên kết chéo Product |
| S04 | Tạo DRAFT chưa có thông tin kiện hàng; thử chuyển sang trạng thái bán | DRAFT theo schema được lưu; chỉ bán khi đủ điều kiện đã chốt |
| S05 | Chuyển đơn theo từng bước hợp lệ rồi thử nhảy trạng thái | Luồng hợp lệ thành công; bước sai bị từ chối; lưu lịch sử đúng |
| S06 | So sánh doanh thu trước/sau COMPLETED và đơn hủy | Chỉ đơn đủ điều kiện COMPLETED được tính, không tính đơn hủy |
| S07 | S1 trả lời chat với U1, gửi lại cùng clientMessageId; đọc cursor cũ | Không nhân đôi tin; cursor không lùi; S2 không truy cập được |
| A01 | A1 kiểm duyệt Product rồi User tìm lại | Trạng thái PostgreSQL quyết định khả năng hiển thị; index đồng bộ trễ không làm lộ Product |
| A02 | A1 khóa tài khoản; User/Seller tiếp tục thao tác cần quyền | Quyền bị chặn theo chính sách phiên đã chốt; không tự mở khóa khi chạy seed |
| A03 | Sửa/xóa category đang được Product sử dụng | Theo ràng buộc đã chốt, không tạo Product mồ côi hoặc mapping im lặng sai |
| A04 | Đọc thống kê với đơn hoàn thành/hủy và dữ liệu khác Store | Tổng thống kê khớp dữ liệu chuẩn và phạm vi quyền |
| P01 | P1: thanh toán sandbox, giả amount, callback sai chữ ký | Chỉ amount Backend và callback xác thực được chấp nhận |
| P02 | P1: gửi callback hợp lệ hai lần; chỉ truy cập redirect; thử hết hạn/hủy/thất bại | Không ghi nhận hai lần; redirect không tự đánh dấu PAID; trạng thái đúng contract |

## Ghi nhận mỗi lượt chạy

Ghi commit Backend/Search, phiên bản mapping, fixture IDs, dữ liệu đầu vào, expected/actual, PASS/FAIL/BLOCKED và bằng chứng đã che thông tin nhạy cảm. Không đánh dấu PASS vì mới đọc thiết kế hoặc vì CI tài liệu xanh.

Mốc dự kiến: 18/09 Hoàng/Đạt review fixture và kỳ vọng; 20/09 chạy smoke cho API sẵn có; 27/09 bàn giao kết quả tích hợp. P01–P02 chỉ chạy sau khi Order/COD/Payment model ổn định và sandbox được tích hợp. Các ca chưa có API giữ BLOCKED với người phụ trách và dependency cụ thể.
