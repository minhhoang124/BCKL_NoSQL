# Tái lập rà soát ABO 1200

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

Các nhóm category còn chờ ánh xạ, brand chưa chốt và listing Renewed phải ở SỬA/DRAFT. Không tự suy brand, condition hoặc Category ID. Chỉ sau khi Hoàng/Đạt xác nhận mới tạo bản clean, import vào PostgreSQL, bổ sung dữ liệu cần thiết và xuất mapping externalId → productId. Không dùng ID prototype 1–1200 làm ID chính thức.

Mốc dự kiến: 18/09 chốt QA/metadata; 20/09 thử mapping và query; 27/09 bàn giao test tích hợp. Các mốc phụ thuộc phản hồi và API thực tế, không phải trạng thái đã hoàn thành.
