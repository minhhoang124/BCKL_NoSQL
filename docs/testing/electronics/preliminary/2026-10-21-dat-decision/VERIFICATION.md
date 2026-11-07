# Kiểm chứng quyết định — 21/10/2026

Phần dưới ghi lượt kiểm ban đầu. Bản sửa Windows tiếp theo bổ sung regression và
CI riêng tại [báo cáo portability](../../pr82-windows-byte-portability-2026-10-21.md),
không thay nhãn hoặc giá trị hash dữ liệu đã chốt.

Thực chạy local bằng Python 3 của bundled workspace runtime. Mọi lệnh dưới đây
exit 0. Không chạy dịch vụ, truy cập DB, tải model hoặc chạy retrieval mới.

```sh
python3 docs/testing/electronics/preliminary/2026-10-21-dat-decision/verify_decision.py
python3 scripts/dataset/tests/test_evaluation_v2.py
git diff --check
```

- Verifier quyết định PASS: 1.032 khóa; 975 nhãn cũ giữ nguyên; 3 nhãn được Đạt
  nhận; 978 numeric/54 null; cùng 7 query đủ 86 nhãn.
- Hai verifier gói trước được gọi lại: 373 join rank–nhãn, 126 dòng per-query,
  18 dòng macro, snapshot cũ 975/57 và 57 đề xuất/bằng chứng vẫn nguyên vẹn.
- 10 negative probes bị từ chối: sửa nhãn cũ, lấp null, thêm Hiền approval,
  giả độc lập, thêm query chưa đủ nhãn, tự bật publication, đổi thẩm quyền,
  đổi nhãn mới, đổi nguồn sang bằng chứng bị loại và lặp quyết định.
- 10 test công cụ evaluation v2 PASS; gate/lock và công cụ đó không được sửa.
- SHA-256 JSONL canonical được tạo trong bộ nhớ, UTF-8, sort_keys,
  separators=(',', ':'), mỗi hàng kết thúc LF:
  `2c745fbf82ffa339c3b3ad93399078e3000c67579bf7f148fa89d25a3d626350`.

Không tuyên bố kiểm thử toàn ứng dụng local, quality gate chính thức, nguồn
nhãn khách quan, hoặc Hiền đã review. Lượt đầu verifier chỉ chạy local; bản sửa
portability đã thêm job GitHub Actions. Trạng thái CI cần xem đúng head trên #82.
