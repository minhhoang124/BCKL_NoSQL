# Quy tắc QA và ngoại lệ ABO trước mốc 18/09

Đề xuất chốt giữa Hiền và Đạt ngày 17/09/2026. Đây là quy tắc chuẩn bị dữ liệu, **chưa phải xác nhận bộ JSONL cuối hay cho phép công khai**. Gói ABO gốc và hai CSV QA hiện hành không bị sửa. Danh sách ngoại lệ theo `externalId` nằm trong [`abo-qa-decision-exceptions.csv`](abo-qa-decision-exceptions.csv); một mã có thể mang nhiều cờ.

## Quy tắc xử lý

1. **Category:** phân theo chức năng sản phẩm. Không ép đủ bảy nhóm prototype. Tách thiết bị mạng với thiết bị an ninh; display với thiết bị văn phòng; pin, bộ sạc và cáp/phụ kiện kết nối. Chỉ gán Category lá/`categoryId` sau khi đối chiếu taxonomy. Từ 398 mã gốc, 397 mã còn `CATEGORY_MAPPING_PENDING` và giữ trong **gói đầu vào chờ ánh xạ**, chưa tạo Product kể cả DRAFT vì schema bắt buộc `categoryId`; một mã filament đã LOẠI. Tên nhóm đề xuất trong CSV không phải `categoryId` đã chốt.
2. **Tình trạng hàng:** 146 listing `Renewed` chưa bị loại giữ trong `renewed_candidates.jsonl`, tách khỏi `products.jsonl`, và giữ nguyên dấu vết tình trạng tân trang từ nguồn. Chưa import/công khai/tìm kiếm công khai khi Backend chưa có trường condition; không đổi thành hàng mới. Một listing Renewed đã thuộc nhóm LOẠI không tính trong 146 mã này.
3. **Brand, màu, mô tả:** `brand=null` cho `abo:B00GN8WAHE` và `abo:B01FSGT9D4` vì chưa đủ bằng chứng; không gán AmazonBasics theo suy đoán. Màu không có bằng chứng giữ trống. 44 mô tả có nguồn ứng viên vẫn để trống tới khi xác minh đúng model, biến thể và thông số; 123 mã không có nguồn bổ sung cũng giữ trống. Không lấy thông tin của biến thể khác để điền.
4. **Loại và bàn giao:** giữ riêng 23 mã LOẠI, gồm mã filament mới chốt. 1.177 mã còn lại chỉ là **ứng viên chưa bị loại**, gồm 555 `GIỮ` theo rà soát QA và 622 `SỬA` còn việc phải xác minh/sửa; không gọi tất cả là “sạch” hoặc “có thể công khai”. `GIỮ` cũng chưa đồng nghĩa đủ điều kiện import/công khai. Trước khi xuất JSONL bàn giao, đối chiếu trường bắt buộc, giá trị nullable, condition, category, brand, ảnh và cấu trúc JSONL với importer của Hoàng; kiểm tra lại số lượng/ID và chỉ đánh dấu “sẵn sàng import” cho tập đạt các điều kiện đó.

## Mốc và trách nhiệm còn mở

- **18/09:** Hiền và Đạt chốt các quy tắc trên, rà danh sách ngoại lệ và quyết định các mã vướng theo `externalId`. Hoàng xác nhận cách importer nhận `categoryId` chưa có, `brandId=null`, condition Renewed và các trường bắt buộc.
- **23/09:** sau khi xử lý ngoại lệ, kiểm tra JSONL và ảnh trên đúng tập bàn giao, gửi Hoàng gói đã kiểm chứng để import PostgreSQL. Bản 1.200 ban đầu chỉ là prototype/QA, không đổi tên thành “dataset sạch cuối”.

`abo-qa-decision-exceptions.csv` hiện có 520 `externalId` duy nhất mang ít nhất một trong các cờ: 23 `EXCLUDE`, 397 `CATEGORY_MAPPING_PENDING`, 146 `CONDITION_RENEWED_PENDING`, 2 `BRAND_UNVERIFIED_NULL`, 44 `DESCRIPTION_MODEL_CHECK_PENDING`, 3 `DESCRIPTION_QA_HOLD`. Các nhóm cờ **chồng nhau**, không cộng số lượng để tính tổng. Tái sinh bằng `scripts/dataset/prepare_qa_decision_exceptions.py` sau khi CSV QA hoặc nguồn mô tả thay đổi.
