# Kết quả rà soát ABO Electronics 1.200 sản phẩm

- Ngày xem ảnh thủ công: 12/09/2026; tái chạy kiểm tra và áp dụng feedback: 15/09/2026.
- Nguồn: `abo_dataset_review_1200.zip`
- Giấy phép: CC BY 4.0
- SHA-256 ZIP: `F3C7F6D8A6A2471B9C0B206C3E1BBB7F86D18486E5C687810A56762C1DE5ACB2`
- SHA-256 `products.jsonl`: `4C9EC953160E3CEB6AAD72ACD8A35353FD9FAD7D70CF2C326E6F8C919B1A185D`

Không sửa hoặc xóa dữ liệu gốc. Mọi kết luận được ghi theo `externalId` trong hai tệp CSV đi kèm.

## Kết quả

| Trạng thái | Số lượng | Ý nghĩa |
| --- | ---: | --- |
| GIỮ | 555 | Chưa phát hiện lỗi QA; chỉ cân nhắc nhập DRAFT khi đủ contract |
| SỬA | 622 | Cần sửa/xác minh metadata hoặc chốt mapping/condition; chưa mặc định import được |
| LOẠI | 23 | Ngoài phạm vi, ảnh sai hoặc trùng rõ ràng |
| **Tổng** | **1.200** |  |

Sau khi loại còn **1.177 sản phẩm**, cao hơn ngưỡng 1.000 nên chưa cần lấy thêm dữ liệu.

Đây là số ứng viên còn lại, không phải số sản phẩm đủ điều kiện import hay công khai. Có 340 bản ghi chuyển từ GIỮ sang SỬA sau feedback về category/condition. Mọi bản ghi chưa loại đều có `importDisposition=DRAFT_ONLY`, `publicationApproved=false`; `DRAFT_ONLY` là giới hạn trạng thái **nếu sau này đủ điều kiện import**, không chứng minh Product DRAFT đã được tạo. Record chưa ánh xạ Category lá không thể tạo Product theo schema hiện tại. Không tự áp dụng proposed* vào nguồn. Xem [lệnh tái lập và dependency](README.md).

## Phương pháp kiểm tra

1. Đọc và kiểm tra schema của đủ 1.200 dòng JSONL.
2. Đối chiếu `externalId`, đường dẫn ảnh và phạm vi thư mục.
3. Mở kiểm tra ảnh bằng Pillow; tính SHA-256 tệp, SHA-256 pixel và pHash để tìm ảnh trùng/gần trùng.
4. Xem thủ công đủ 1.200 ảnh trên 40 contact sheet, mỗi sheet 30 sản phẩm, để đối chiếu ảnh với tên và phạm vi sản phẩm.
5. Rà soát tên, mô tả, brand, category và các ứng viên sản phẩm trùng.

Không có ảnh hỏng, ảnh thiếu, đường dẫn ảnh không an toàn, `externalId` sai định dạng hoặc lỗi schema bắt buộc.

## Danh sách cần loại

| externalId | Lý do |
| --- | --- |
| `abo:B00870ZHCQ` | Ống nhòm dùng ngoài trời, ngoài phạm vi điện tử/phụ kiện điện tử đã chốt |
| `abo:B00CTFMD1S` | Gối ôm và vỏ gối, ngoài phạm vi |
| `abo:B07JMB83Q3` | Két ngụy trang dạng sách, không có chức năng điện tử rõ ràng |
| `abo:B075X3S2Z6` | Đèn cây trang trí nội thất, ngoài phạm vi bộ dữ liệu |
| `abo:B07Q2NBNF5` | Sản phẩm cà phê, ngoài phạm vi |
| `abo:B01LYTIU1W` | Vòng tay/trang sức, ngoài phạm vi |
| `abo:B07D52SHTY` | Thảm yoga/Pilates, ngoài phạm vi |
| `abo:B07VDBBTFY` | Khung thành bóng đá, ngoài phạm vi |
| `abo:B07TVRZZWB` | Ảnh chỉ có logo, không thể hiện tai nghe |
| `abo:B07GB3SGSF` | Ảnh chỉ có logo, không thể hiện cáp USB |
| `abo:B00EZMZTBO` | Trùng rõ ràng với `abo:B001TH7GUK` |
| `abo:B01BSVLUBW` | Trùng rõ ràng với `abo:B015IKVKGE` |
| `abo:B01HTRCWX4` | Trùng rõ ràng với `abo:B01F2O1CFK` |
| `abo:B01B7RV2SI` | Trùng rõ ràng với `abo:B00LBPUBUC` |
| `abo:B01ICRR8AW` | Trùng rõ ràng với `abo:B01ICR8H66` |
| `abo:B07HH3J9WR` | Trùng rõ ràng với `abo:B075QMLS5J` |
| `abo:B07HHM23QF` | Trùng rõ ràng với `abo:B07CWJR6YB` |
| `abo:B01NBH855Y` | Trùng rõ ràng với `abo:B01MQSNS0R` |
| `abo:B01MXUT9Z0` | Trùng rõ ràng với `abo:B01MQSNTDL` |
| `abo:B01NBH83SI` | Trùng rõ ràng với `abo:B01MRU1PLL` |
| `abo:B07WBS8ML1` | Trùng rõ ràng với `abo:B07W4CLC92` |
| `abo:B07WV5WN7B` | Trùng rõ ràng với `abo:B0787G1YFG` |
| `abo:B07H9QFF82` | Cuộn sợi TPU cho máy in 3D là vật tư tiêu hao, ngoài phạm vi thiết bị/phụ kiện điện tử của tập này; ảnh và tên khớp, `productType=HEADPHONES` sai. |

## Metadata cần sửa

Có **622 bản ghi** ở trạng thái `SỬA`; CSV hành động có 645 dòng gồm SỬA và LOẠI. Danh sách chi tiết và giá trị đề xuất nằm trong `abo-electronics-1200-actions.csv`. Các nhóm lỗi nguồn dưới đây có thể chồng nhau:

- 173 bản ghi thiếu mô tả. Giữ trống giá trị đề xuất khi nguồn không cung cấp dữ liệu; không tự viết nội dung sản phẩm.
- 131 bản ghi thiếu brand. Đã đề xuất brand khi tên sản phẩm cung cấp bằng chứng rõ; còn 2 bản ghi cần đối chiếu nguồn.
- Đã rà lại toàn bộ 23 bản ghi từng được gắn `CATEGORY_MISMATCH`: 2 bộ đổi điện DC–AC giữ đề xuất `power_adapter`; 20 mã còn chờ Category lá; 1 mã filament đã loại vì ngoài phạm vi.
- 15 bản ghi dùng biến thể của AmazonBasics và đã có giá trị chuẩn hóa.
- 4 mô tả chứa câu boilerplate cần bỏ.
- 3 mô tả bổ sung bị giữ lại sau vòng rà mẫu import: `abo:B00LLJ55XG` nói về đệm lưng dù sản phẩm là loa; `abo:B00TTC9164` chỉ ghi “An Amazon Brand”; `abo:B01FSGT9D4` lẫn thông số AA/AAA. Cả ba có `DESCRIPTION_QA_HOLD`; bản xuất phải để `description=null` cho đến khi xác minh.
- 1 tên có hậu tố ngừng sản xuất cần làm sạch.
- 2 listing màn hình riêng tư 14,1 và 15,6 inch dùng cùng ảnh, cần xác minh ảnh đúng cho từng kích thước.

Các cờ `PRODUCT_DUPLICATE_CANDIDATE` và `NAME_DUPLICATE_CANDIDATE` là tín hiệu rà soát. Chỉ 12 cặp giống rõ cả tên và ảnh mới bị loại. Không tự loại các biến thể màu sắc, chiều dài, dung lượng hoặc số lượng gói. Có 397 bản ghi chờ mapping category và 146 listing Renewed chờ chốt condition, đều thuộc SỬA; hai nhóm có thể chồng nhau.

## Category và brand cần thống nhất

1. `network_security` đang trộn thiết bị mạng, két điện tử, dây điện, bóng đèn, bộ đổi điện và giá đỡ. Không ép các mặt hàng khác loại vào `power_adapter` chỉ để đủ bảy nhóm prototype. Nhóm cần tách `security_electronics` khỏi thiết bị mạng và xác nhận Category lá trước import.
2. `office_display` đang gộp màn hình/máy chiếu với máy hủy giấy và thiết bị văn phòng. Cần chốt giữ nhóm gộp hay tách `display` và `office_electronics`.
3. `power_adapter` đang gộp pin, bộ sạc, cáp và phụ kiện điện. Cần chốt có tách `battery` và `cable_adapter` hay không.
4. Chuẩn hóa `Amazon Basics`, `AMAZONBASICS`, `amazonbasics` và `AmazonBasics B2B` thành `AmazonBasics`.
5. Chuẩn hóa các cách ghi `Eono by Amazon`/`Eono Essentials` thành `Eono`, và `Umi. Essentials` thành `UMI`.
6. Hai bản ghi `abo:B00GN8WAHE` và `abo:B01FSGT9D4` chưa đủ bằng chứng để chốt brand; cần đối chiếu listing nguồn.
7. Với listing `Renewed`, cần quyết định bổ sung trường `condition` hay loại bản `Renewed` khi schema không lưu tình trạng sản phẩm.

### Rà lại 23 đề xuất sửa category theo feedback của Đạt (16/09)

| Nhóm | Số ID | Kết luận QA |
| --- | ---: | --- |
| GIRA `abo:B000UW91EY` | 1 | [Tài liệu Gira](https://www4.gira.com/data3/08311790.pdf) xác nhận mã 0831 10 là cảm biến chuyển động Observer 70 tự bật đèn. Giữ trong phạm vi; chờ khớp mã listing và Category lá sensor/lighting, chưa đổi tên nguồn. |
| Bóng LED `abo:B07QWSGQK7`, `abo:B07QWSHH1N`, `abo:B07QYTNK1M`, `abo:B07QYTR5GF`, `abo:B07QZYDYHN` | 5 | Xóa đề xuất `power_adapter`; chờ nhóm lighting hoặc quyết định loại. |
| Cáp USB-C `abo:B06XT2FR5Q`; tám dây nối điện `abo:B07674HN3M`, `abo:B07674HN3P`, `abo:B07676NXCH`, `abo:B07677TJ3G`, `abo:B076783WZZ`, `abo:B07678VMLW`, `abo:B07678VMM1`, `abo:B0767B356W`; dây nối `abo:B07W42KQ3M` | 10 | Xóa đề xuất `computer`/`power_adapter`; chờ nhóm cable/electrical phù hợp. |
| Bốn giá đỡ ARKON `abo:B07KGKJLB4`, `abo:B07KGKW4Q8`, `abo:B07KGKZ7XP`, `abo:B07KGN19LQ` | 4 | Xóa đề xuất `mobile_accessory` khi chưa chắc thiết bị tương thích; chờ nhóm mount. |
| Vật liệu in 3D `abo:B07H9QFF82` | 1 | LOẠI vì là vật tư tiêu hao ngoài phạm vi; không gán Category lá. |
| Hai inverter `abo:B07TPLLSJG`, `abo:B07TPMH44Q` | 2 | Có chức năng đổi điện DC–AC nên giữ đề xuất `power_adapter`, nhưng vẫn ở `SỬA/DRAFT` đến khi Hoàng–Đạt xác nhận Category lá. |

**Tổng 23 ca gốc: 20 chưa có category đích + 2 inverter có đề xuất chức năng + 1 đã LOẠI.** 22 mã còn lại tiếp tục `SỬA`, `DRAFT_ONLY`, `publicationApproved=false`; số sản phẩm có thể công khai chưa được xác nhận. Không sửa category của file nguồn. 40 anchor của bộ query vẫn trỏ tới 20 bản ghi `GIỮ` và không nằm trong 23 ID này.

## Tệp kết quả

- `abo-electronics-1200-status.csv`: trạng thái của đủ 1.200 `externalId`.
- `abo-electronics-1200-actions.csv`: chỉ gồm các bản ghi `LOẠI` và `SỬA`, kèm lý do và giá trị đề xuất.
- `scripts/dataset/review_abo_dataset.py`: kiểm tra tự động và tạo danh sách ứng viên/contact sheet.
- `scripts/dataset/finalize_abo_review.py`: áp dụng các quyết định đã rà soát để tạo kết quả cuối.
