# Test case User / Seller / Admin — chuẩn bị Giai đoạn 2

Soạn ngày 15/09/2026, rà và bắt đầu chạy ngày 18/09/2026. U01/U02 đã PASS trên Backend test cô lập; 23 ca còn lại **NOT_RUN**. PR #10 (schema Product) đã merge; điều đó chưa chứng minh Product Draft API, importer hay Admin UI đã chạy. Chỉ thực thi ca khi API, dữ liệu và môi trường test tương ứng sẵn sàng. Bằng chứng và trạng thái từng ca nằm tại [`electronics-role-test-run-log.md`](electronics-role-test-run-log.md).

## Fixture và quy ước

- Tạo User U1/U2, Seller S1/S2 với Store khác nhau và Admin A1 bằng fixture test được Backend cho phép. Không dùng tài khoản thật hay seed tự nâng quyền tài khoản có sẵn.
- Gói import thử v1 chỉ có 86 sản phẩm Audio ở `products.jsonl`. Hai loa `abo:B00JZVPC08` (đỏ) và `abo:B00JZVPGD6` (xanh) thuộc tập này; chỉ dùng sau khi Hoàng xác nhận import thành công và trả mapping. Hai thẻ SDHC `abo:B004Q3R9B0` (8GB), `abo:B004Q3R9BA` (16GB) còn trong `category_pending.jsonl`, **không** dùng làm fixture PostgreSQL của gói v1. Ca về variant 8GB/16GB cần Product/Variant fixture riêng do Backend tạo hợp lệ.
- Tra productId bằng mapping externalId → productId do Hoàng xuất sau import; đối chiếu `externalId` duy nhất, `productId` nguyên dương/duy nhất và Product thực sự tồn tại trong PostgreSQL. Không dùng số thứ tự 1–1200. SKU/variant/giá/tồn phục vụ test được tạo riêng và ghi vào biên bản chạy, không suy từ ABO.
- Chuẩn bị một Product DRAFT, một bị từ chối/ẩn và một đã duyệt đủ điều kiện công khai; variant còn hàng/hết hàng. Dữ liệu QA DRAFT_ONLY chỉ được công khai ở môi trường test sau khi bổ sung và duyệt fixture.
- Mã dưới đây là mã ca kiểm thử, không phải API mới. URL/payload lấy theo contract đã merge. Nếu chưa có thì ghi BLOCKED, không tự thay đổi contract.

## Các ca kiểm thử

| ID | Vai trò / bước thực hiện | Kết quả mong đợi |
| --- | --- | --- |
| U01 | U1 đăng nhập đúng, sai mật khẩu; thử tài khoản bị khóa | Đúng mới nhận phiên hợp lệ; sai/khóa bị từ chối, không lộ mật khẩu |
| U02 | U1 sửa trường role hoặc gọi thao tác Admin | Không nâng quyền; không thay đổi dữ liệu được bảo vệ |
| U03 | Tìm “loa Bluetooth màu đỏ hai loa 3W có micro” trên corpus Audio v1; lọc Category/Brand theo mapping chính thức sau khi có Product công khai hợp lệ | Kết quả đúng bộ lọc; không trả Product ẩn/chưa duyệt; phân trang không lặp bất thường. DRAFT của gói import không được tự xuất hiện công khai |
| U04 | Gửi ảnh hợp lệ, tệp giả ảnh, ảnh quá giới hạn contract | Ảnh hợp lệ được xử lý; đầu vào sai bị từ chối theo contract, không lỗi nội bộ |
| U05 | Search trả một ID đã ẩn, một ID không tồn tại và hai ID hợp lệ | NestJS loại ID không hợp lệ theo PostgreSQL và giữ thứ tự hai ID còn lại |
| U06 | Dùng Product/Variant fixture hợp lệ do Backend tạo: thêm variant 8GB rồi đổi sang 16GB, cập nhật số lượng | Cart tham chiếu đúng variant; giá/tồn lấy Backend, không trộn hai biến thể |
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

Ghi commit Backend/Search, phiên bản mapping, fixture IDs, dữ liệu đầu vào, expected/actual, PASS/FAIL/BLOCKED và bằng chứng đã che thông tin nhạy cảm vào [`electronics-role-test-run-log.md`](electronics-role-test-run-log.md). `NOT_RUN` nghĩa là chưa chạy; `BLOCKED` chỉ dùng sau khi xác nhận thiếu dependency cụ thể. Không đánh dấu PASS vì mới đọc thiết kế hoặc vì CI tài liệu xanh.

Mốc dự kiến: trước 20/09 chốt fixture, mapping và chạy smoke cho các API thực sự sẵn có; 27/09 bàn giao kết quả tích hợp nếu dependency đạt. P01–P02 chỉ chạy sau khi Order/COD/Payment model ổn định và sandbox được tích hợp. Ca chưa có API được ghi `BLOCKED` khi bắt đầu lượt kiểm thử, kèm người phụ trách và dependency cụ thể.
