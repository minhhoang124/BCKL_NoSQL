# Rà chức năng cho 398 mã category gốc

Ngày 17/09/2026. Bảng đầy đủ [`abo-category-function-review.csv`](abo-category-function-review.csv) giữ đủ 398 `externalId` từng cần rà category: **397 mã vẫn `CATEGORY_MAPPING_PENDING`, 1 mã filament đã `LOẠI`**; bảng [`abo-category-hard-23.csv`](abo-category-hard-23.csv) giữ 23 ca gốc để truy vết. Đây là **bảng hỗ trợ rà thủ công**, không phải ánh xạ Category lá. `categoryId` vẫn rỗng toàn bộ; chưa gọi 397 mã pending là import-ready khi Hoàng chưa xác nhận importer nhận Product DRAFT thiếu categoryId.

## Cách nhóm và kiểm tra

Nhìn chức năng thực tế: pin; bộ sạc; adapter chuyển tín hiệu; cáp; máy hủy giấy; TV/display; máy chiếu; màn chiếu; phụ kiện màn hình; thiết bị mạng; thiết bị an ninh; dây điện; chiếu sáng; giá đỡ; inverter. Tên sản phẩm tạo **gợi ý ban đầu**, category nguồn và ảnh phải được đối chiếu trước khi chốt. `productType` chỉ là cột tham khảo, không phải căn cứ tự động. Nếu tên gợi nhiều chức năng (ví dụ bộ sạc kèm cáp, pin kèm sạc, adapter dạng cáp), để trống nhóm ứng viên và xử lý theo chức năng chính/bộ kit sau khi nhóm thống nhất. Nếu tên không cho biết đủ, giữ pending.

Kết quả rà sơ bộ trên **398 mã gốc**: 281 dòng có đúng một dấu hiệu chức năng trong tên để kiểm tra tiếp, **chưa xác nhận mapping**; 101 dòng có nhiều dấu hiệu chức năng; 8 dòng không có dấu hiệu rõ; 23 ca khó được gắn cờ riêng. Các cờ rà soát là phân hoạch 266 `VERIFY_SOURCE_AND_IMAGE`, 101 `MULTIPLE_FUNCTIONS`, 8 `NO_TITLE_CLUE`, 23 `HARD_CASE_23`; số 281 gợi ý một chức năng có thể nằm trong nhóm ca khó nên không cộng vào phân hoạch này. Phân bố bucket cũ đúng như Đạt đếm: 263 `power_adapter`, 98 `office_display`, 36 `network_security`, 1 `audio` — chỉ để truy vết, không dùng làm taxonomy đích.

### Sáu gợi ý đã chỉnh theo vòng review của Đạt

| externalId | Gợi ý chức năng sau chỉnh | Lý do |
| --- | --- | --- |
| `abo:B005HKPWAQ` | `storage_card` | Sản phẩm chính là thẻ microSD; SD adapter đi kèm không biến nó thành adapter tín hiệu. |
| `abo:B00M77HMU0`, `abo:B071Y6Y83W` | `network_adapter` | Lần lượt là USB–Ethernet và USB Wi-Fi adapter. |
| `abo:B01N6E557C` | `power_adapter` | AC adapter cấp nguồn cho Nintendo. |
| `abo:B08CS6X36V` | `usb_hub` | Sản phẩm chính là hub USB, dù có AC adapter đi kèm. |
| `abo:B07W42KQ3M` | `electrical_cord` | Category nguồn Elektroinstallation và ảnh cho thấy dây nối điện; không coi là cáp dữ liệu. |

CSV có cột `reviewCorrectionNote` để truy vết. Đây vẫn là **gợi ý nhóm chức năng**, không phải Category lá đã duyệt. Sáu mã tiếp tục `CATEGORY_MAPPING_PENDING`, `categoryId` rỗng; riêng cáp nối điện vẫn ở bảng 23 ca khó. Ảnh của 23 ca không xác minh được chiều dài dây, thông số inverter hoặc thiết bị tương thích của giá đỡ ARKON.

### Vòng review tiếp theo của Đạt

- `abo:B079L8VZ5R`: đổi gợi ý từ cáp thành `video_switcher`. Tên “HDMI 5x1 Switch”, category nguồn “Selector Boxes” và ảnh hộp chuyển khớp; chữ HDMI không có nghĩa là cáp. Giữ pending.
- `abo:B000UW91EY`: đổi từ công tắc sang `motion_sensor`. [Tài liệu Gira cho 0831 10](https://www4.gira.com/data3/08311790.pdf) ghi Observer 70 anthracite, cảm biến chuyển động bật đèn theo chuyển động và độ sáng. Ảnh trông phù hợp, nhưng listing “GIRA 83110 – Switch” chưa chứng minh chắc khớp mã tài liệu; giữ tên nguồn và pending cho tới khi đối chiếu mã listing.
- `abo:B07H9QFF82`: ảnh và tên là cuộn sợi TPU máy in 3D, không phải tai nghe. Quyết định `LOẠI` vì là vật tư tiêu hao ngoài phạm vi thiết bị/phụ kiện điện tử. Giữ dòng trong bảng 398 gốc với `decisionStatus=EXCLUDED_OUT_OF_SCOPE` để truy vết, không đưa vào tập import.

## 23 ca khó đã đối chiếu ảnh

Đã mở contact sheet từ đúng ảnh catalog của từng `externalId`, đối chiếu tên và `externalCategory` trong bảng. Kết quả theo nhóm:

| Nhóm | Số mã | Bằng chứng và việc cần chốt |
| --- | ---: | --- |
| Cảm biến GIRA | 1 | Ảnh có thiết bị GIRA; tài liệu hãng cho mã 0831 10 xác nhận Observer 70 là cảm biến chuyển động bật đèn. Chờ khớp mã listing và Category lá. |
| Bóng đèn LED | 5 | Ảnh có bóng đèn/spotlight. Category nguồn thuộc Light Bulbs, riêng `abo:B07QYTR5GF` nằm ở nhánh Incandescent dù tên ghi LED; xác minh loại trước khi gán lá. |
| Dây USB-C | 1 | `abo:B06XT2FR5Q` có hai đầu USB-C trong ảnh; category nguồn rỗng. Đề xuất nhóm cáp dữ liệu, chưa chốt Category lá. |
| Dây nối điện | 9 | Ảnh có dây và ổ cắm/phích cắm; tám mã có nguồn Extension Cords hoặc rỗng, `abo:B07W42KQ3M` có nguồn Elektroinstallation. Không tự xác nhận chiều dài từ ảnh. |
| Giá đỡ ARKON | 4 | Ảnh là các cụm giá đỡ/kẹp; category nguồn Bluetooth Car Kits quá rộng/có thể sai. Chưa xác định thiết bị tương thích của từng model chỉ bằng ảnh. |
| Sợi in 3D | 1 | `abo:B07H9QFF82` hiện cuộn filament trong ảnh; `productType=HEADPHONES` sai rõ ràng. Đã LOẠI khỏi tập ứng viên import. |
| Inverter | 2 | Ảnh có bộ đổi điện dùng đầu cắm xe; category nguồn Inverters/Wechselrichter hỗ trợ chức năng DC–AC. Giữ đề xuất chức năng inverter, chờ Category lá. |

Ngoài 23 ca: `abo:B07LF7CS8M`, `abo:B07Q7JMWKZ`, `abo:B07Q8LHPHF`, `abo:B08HGX1DD8` có tên **Projector Screen** nhưng `productType=VIDEO_PROJECTOR`; phải rà theo chức năng màn chiếu, không tự gán máy chiếu. Chúng vẫn pending. `abo:B07H9QFF82` và bốn màn chiếu là ví dụ chứng minh không thể sửa hàng loạt theo `productType`.

Sau khi Hoàng xác nhận schema/importer và nhóm thống nhất taxonomy lá, mới ghi `categoryId` cho từng mã có đủ bằng chứng. Chạy lại kiểm tra số lượng, overlap Renewed và trường bắt buộc trước khi tách tập import thử; không thay đổi CSV QA nguồn hay file ABO gốc.
