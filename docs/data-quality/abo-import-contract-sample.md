# Mẫu gói ABO theo contract import — 17/09/2026

Hoàng đã xác nhận quy tắc Backend trong [comment PR #14](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/14#issuecomment-5714574332). [ZIP mẫu 9 record và 8 ảnh](https://drive.google.com/file/d/1dsh85bOraFYO3vd-tyvN4bYO9UX0wN1i/view?usp=drivesdk) nằm trong thư mục Drive ABO của nhóm; SHA-256 bản sửa mô tả: `EBF6865F768A66F561FED7E0D33DE9095186C890F5504E35EE37FC6E1439F903`. Đây là **mẫu để Hoàng kiểm tra lại contract**, chưa phải gói sạch 23/09 hay kết quả import thành công.

```text
abo-electronics/
├── products.jsonl                5 record audio
├── renewed_candidates.jsonl      1 record
├── category_pending.jsonl        2 record
├── excluded.jsonl                1 record
├── image-sha256.json
├── sample-semantic-review.jsonl
├── README.txt
└── images/                     8 ảnh, mỗi externalId một thư mục
```

Năm record trong `products.jsonl` thuộc nhóm audio và không Renewed. Sau khi Hoàng phát hiện `abo:B00LLJ55XG` có mô tả đệm lưng dù tên/ảnh là loa, vòng rà thủ công cũng phát hiện `abo:B00TTC9164` chỉ có mô tả “An Amazon Brand”. Cả hai chuyển sang QA `SỬA`, nhưng vẫn ở mẫu để Hoàng kiểm tra quy tắc giữ `description=null` cùng cờ/lý do `DESCRIPTION_QA_HOLD` trong `sourceAttributes`; ba record còn lại `GIỮ`. `normalizedCategory` được ghi `Electronics > Audio` theo category Audio đang có trong seed của nhánh Product của Hoàng; Hoàng đã xác nhận đây là Category lá hiện tại, nhưng importer cần ánh xạ bằng slug/path ổn định, không hard-code ID số. Không tự điền `categoryId`, `storeId` hay `productId` vào payload nguồn; importer dùng mapping Category và Store hệ thống. Bản mẫu không thử chạy importer vì importer JSONL chưa hoàn chỉnh.

`category_pending.jsonl` giữ `normalizedCategory=null` và nằm ngoài `products.jsonl`: schema `Product.categoryId` bắt buộc nên các mã này **không thể tạo Product DRAFT** trước khi ánh xạ. Một mã (`abo:B01FSGT9D4`) còn có `brand=null`; mô tả lẫn thông số AA/AAA cũng được để null và gắn `DESCRIPTION_QA_HOLD`. `renewed_candidates.jsonl` giữ tên gốc có Renewed và `sourceAttributes.sourceCondition=RENEWED`; không import/công khai/index như hàng mới. `excluded.jsonl` ghi mã filament đã loại và lý do, không kèm ảnh trong gói mẫu. Brand/description không đủ bằng chứng vẫn null; không đưa tình trạng hàng vào brand hoặc description.

Mỗi ảnh trong JSONL dùng `sourcePath` tương đối dạng `images/<ASIN>/1.jpg`, tồn tại trong ZIP, mở được và có SHA-256 trùng ảnh nguồn. Mỗi record có tối đa một ảnh `isPrimary=true`; không có đường dẫn tuyệt đối, URL Internet, `..` hoặc symlink. `sample-semantic-review.jsonl` ghi kết quả đối chiếu thủ công tên/ảnh/mô tả cho cả 9 mã và ba mô tả phải giữ null. Cả 9 `externalId` duy nhất, đúng namespace `abo:` và `schemaVersion=1`. Gói ABO gốc không thay đổi.

Comment của Hoàng trích số **22 LOẠI/1.178 ứng viên** trước review filament; QA mới nhất đã được Đạt đồng ý là **23 LOẠI/1.177 ứng viên**, trong đó **397 mã vẫn chờ category**. Tập cuối cần tách Renewed và mã chờ category, kiểm tra trường bắt buộc/ảnh theo importer trước khi đếm số import thực tế.

Tái sinh mẫu từ đúng gói ABO gốc:

```powershell
python scripts/dataset/prepare_abo_contract_sample.py C:/data/abo_dataset_review_1200 docs/data-quality/abo-electronics-1200-status.csv C:/data/abo-review/sample/abo-electronics
```

Thư mục đầu ra phải rỗng. ZIP và ảnh không commit vào repo.
