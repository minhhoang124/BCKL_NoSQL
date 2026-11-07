# PR #82 — sửa tái lập byte/hash trên Windows

Ngày 21/10/2026, phản hồi review `5595824800` tại `65f68fe`.
Không đổi relevance, corpus/mapping/query, rank/score, metric, model/index hoặc
publication lock. Không chạy lại retrieval và không nhận nghiệm thu 12 query.

## Nguyên nhân và bản sửa

1. Git chưa có thuộc tính LF cho file text có raw-byte hash. Checkout Windows
   `core.autocrlf=true` đổi LF thành CRLF khiến SHA không khớp dù nội dung nhìn
   giống nhau. `.gitattributes` giờ pin `text eol=lf` cho text trong ba gói
   preliminary, proposal protocol và lock được hash; XLSX được đánh dấu binary.
   Không chạm hash raw corpus/mapping bên ngoài hoặc normalize lúc so hash.
2. `--labels` dùng text stdout nên Windows có thể đổi LF thành CRLF, còn cp1258
   không biểu diễn đủ tiếng Việt. Nay ghi `canonical.encode('utf-8')` qua
   `sys.stdout.buffer`, giữ nguyên byte LF và hash đã chốt.
3. Hai verifier cũ đọc vài file text bằng encoding mặc định; nay ghi rõ UTF-8.
   Chỉ hash của **hai script đã sửa** trong SHA256SUMS được cập nhật. Hash
   README/CSV/JSON/JSONL/XLSX, protocol/lock và output canonical không đổi.

## Regression thực chạy local

```sh
python3 docs/testing/electronics/preliminary/2026-10-21-dat-decision/test_portability.py
python3 docs/testing/electronics/preliminary/2026-10-21-dat-decision/verify_decision.py
python3 scripts/dataset/tests/test_evaluation_v2.py
git diff --check
```

Môi trường local macOS, Python 3.12. Hai test methods tạo Git index riêng chỉ
chứa gói kiểm chứng (không `.env`, DB, model/cache); checkout thực với cả hai
`core.autocrlf` và thử `core.eol=crlf`. Mỗi checkout so byte mọi fixture, chạy đủ
ba verifier rồi thu stdout subprocess dưới UTF-8/cp1258/ASCII. Test thứ hai bọc
stdout với newline CRLF để tái hiện cơ chế TextIO của Windows ngay trên macOS.

- **RED trước sửa:** 5 subcases FAIL: checkout autocrlf=true lệch hash; export
  cp1258/ASCII lỗi Unicode; wrapper UTF-8 sinh CRLF. Không thay dữ liệu để né lỗi.
- **GREEN sau sửa:** 2 test methods PASS, cả hai checkout và mọi cấu hình stdout
  nêu trên PASS. Kiểm stdout là byte **thực thu từ subprocess**, không chỉ RAM.
- Export: 1.032 JSONL rows, 978 numeric/54 null, không CR, UTF-8 decode/JSON parse
  hợp lệ, SHA `2c745fbf82ffa339c3b3ad93399078e3000c67579bf7f148fa89d25a3d626350`.
- Verifier quyết định giữ nguyên 975 nhãn cũ, 3 quyết định/54 null, cùng 7 query,
  10 negative probes; gọi lại verifier cũ kiểm 373 join/126 per-query/18 macro.
- 10 test evaluation v2 PASS. Không cần dịch vụ, không chạy full application test.

## Kiểm Windows thật trong CI

Workflow thêm job `evaluation-package-portability`, matrix Ubuntu/Windows ×
autocrlf=false/true. Git được cấu hình **trước** actions/checkout; Python 3.12
chạy cùng regression, bao gồm thu byte stdout native trên runner Windows.
Job không cần DB, dependency AI hoặc credential riêng; chỉ contents:read.

Lượt local mô phỏng newline không được gọi là Windows native PASS. Kết quả
native và CI phải xem đúng head tại PR #82 sau push; không gán CI cũ sang bản
sửa. Không tự resolve review của Hiền hoặc tự merge sau khi test đạt.
