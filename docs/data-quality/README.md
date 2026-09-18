# Tái lập rà soát ABO 1200

Quy tắc xử lý trước mốc 18/09 và danh sách ngoại lệ theo `externalId`: [`abo-qa-decision-2026-09-18.md`](abo-qa-decision-2026-09-18.md). Chạy `python scripts/dataset/prepare_qa_decision_exceptions.py` để tái sinh CSV ngoại lệ từ kết quả QA hiện tại; không ghi vào gói ABO gốc.

Rà 398 mã category gốc theo chức năng (397 còn pending, 1 đã LOẠI) và 23 ca khó: [`abo-category-function-review.md`](abo-category-function-review.md). Chạy `python scripts/dataset/prepare_category_function_review.py` để tái sinh hai CSV hỗ trợ rà; script không gán `categoryId`.

Mẫu JSONL + ảnh để Hoàng kiểm tra contract importer: [`abo-import-contract-sample.md`](abo-import-contract-sample.md). Gói nằm trên Drive, không commit ảnh; mã chờ category và Renewed nằm ngoài `products.jsonl`.

Chạy từ thư mục gốc repo với Python 3.12. Cài dependency đã kiểm tra: NumPy 2.3.5 và Pillow 12.3.0. Script finalize chỉ dùng thư viện chuẩn Python.

```powershell
py -3.12 -m venv .venv-review
.\.venv-review\Scripts\python.exe -m pip install -r scripts/dataset/requirements-review.txt
.\.venv-review\Scripts\python.exe scripts/dataset/review_abo_dataset.py C:/data/abo_dataset_review_1200 C:/data/abo-review --contact-sheets
.\.venv-review\Scripts\python.exe scripts/dataset/finalize_abo_review.py C:/data/abo-review/automated_review.csv C:/data/abo-review/final
.\.venv-review\Scripts\python.exe scripts/dataset/validate_review.py C:/data/abo-review/final
```

Thay hai đường dẫn C:/data bằng thư mục giải nén và thư mục kết quả trên máy. Đầu vào phải là đúng gói ZIP và products.jsonl có SHA-256 trong báo cáo; không dùng quyết định theo externalId của gói này cho corpus khác. Contact sheet là đầu vào kiểm tra thủ công; chạy script không thay thế thao tác xem ảnh. Trường manualImageReview tái sử dụng kết quả rà soát ngày 12/09 cho đúng gói này.

Các CSV là **đề xuất QA**, không phải payload importer cuối. Cột proposed* không tự ghi đè dữ liệu nguồn. LOẠI có importDisposition=EXCLUDE; mọi bản ghi còn lại là DRAFT_ONLY và publicationApproved=false. GIỮ chỉ có nghĩa chưa phát hiện lỗi QA, không đồng nghĩa đủ variant/giá/ảnh/kiện hàng hoặc đã được Admin duyệt.

Rà bổ sung màu và mô tả thiếu nằm ở [`abo-color-description-follow-up.md`](abo-color-description-follow-up.md). Để tái lập trên đúng gói ABO 1200, giữ bản gốc ở `C:/data/abo_dataset_review_1200` và dùng thư mục cache/staging **ngoài repo**:

```powershell
python scripts/dataset/prepare_color_review.py C:/data/abo_dataset_review_1200/metadata_reference.csv docs/data-quality/abo-electronics-1200-status.csv docs/data-quality/abo-electronics-1200-color-proposals.jsonl
python scripts/dataset/fetch_official_listings.py C:/data/abo_dataset_review_1200/products.jsonl C:/data/abo-review/official-1200.jsonl
python scripts/dataset/prepare_description_sources.py C:/data/abo_dataset_review_1200/products.jsonl docs/data-quality/abo-electronics-1200-status.csv C:/data/abo-review/official-1200.jsonl docs/data-quality/abo-electronics-173-description-sources.jsonl
Invoke-WebRequest https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/spins/metadata/spins.csv.gz -OutFile C:/data/abo-review/spins.csv.gz
python scripts/dataset/prepare_independent_query_images.py C:/data/abo_dataset_review_1200/products.jsonl docs/data-quality/abo-electronics-1200-status.csv C:/data/abo-review/official-1200.jsonl C:/data/abo-review/spins.csv.gz C:/data/abo_dataset_review_1200 C:/data/abo-review/independent-spin-queries docs/testing/electronics/independent-image-queries.jsonl
python scripts/dataset/prepare_hard_negative_candidates.py docs/testing/electronics/independent-image-queries.jsonl docs/data-quality/abo-electronics-1200-status.csv docs/testing/electronics/hard-negative-candidates.jsonl
python scripts/dataset/prepare_image_pilot_labels.py docs/testing/electronics/independent-image-queries.jsonl docs/testing/electronics/hard-negative-candidates.jsonl docs/testing/electronics
```

Lệnh cuối tải 11 ảnh query vào staging ngoài repo, yêu cầu Pillow. Bước tải metadata/ảnh cần Internet. Các manifest mang trạng thái đề xuất, không tự cập nhật nguồn hoặc gán `productId`.

Các nhóm category còn chờ ánh xạ, brand chưa chốt và listing Renewed phải ở SỬA/DRAFT. Không tự suy brand, condition hoặc Category ID. Chỉ sau khi Hoàng/Đạt xác nhận mới tạo bản clean, import vào PostgreSQL, bổ sung dữ liệu cần thiết và xuất mapping externalId → productId. Không dùng ID prototype 1–1200 làm ID chính thức.

Mốc dự kiến: 18/09 chốt QA/metadata; 20/09 thử mapping và query; 27/09 bàn giao test tích hợp. Các mốc phụ thuộc phản hồi và API thực tế, không phải trạng thái đã hoàn thành.
