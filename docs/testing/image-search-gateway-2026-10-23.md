# Kiểm chứng Backend image gateway — 23/10/2026

## Đồng bộ sau Account settings #108

Nhận develop `66c5756` tại commit `0c6ef33`. Conflict duy nhất ở tổng quan kiến
trúc được giữ cả hai phần, không đổi code gateway/Search/AI so với head18e6fbf
đã được Hiền và Đạt duyệt. Auth và hai migration mới giữ nguyên develop.

- Full Backend unit: **1.212 PASS/53 file**,25.06s; lint/typecheck/build PASS.
- Full Backend E2E: **822 PASS/1 SKIP/20 TODO**,49 file PASS/2 SKIP,295.80s.
  Nâng riêng DB QA v928 từ17 lên19migration, không dùng demo hoặc DB shared.
  Các log bơm lỗi rollback/slow-upload abort là ca đối kháng có chủ đích.
- Gemini Argon Medium re-review service/interceptor đúng0c6ef33: NO FINDING
  trong2file tĩnh; không tự chạy HTTP/DB, không coi là human approval.
- Loaded CLIP/FAISS và Chrome chưa chạy lại trong lượt này. Các bằng chứng cũ
  giữ đúng SHA; không nâng thành bằng chứng live mới trên nền Auth.
- Hoàng cho phép Codex+Gemini review thay và merge với ngoại lệ CI billing.
  Phải kiểm annotation head cuối, không báo CI xanh/không dùng --admin.

Phần dưới là lịch sử các lượt trước, không thay kết quả đồng bộ mới.

Nền develop06eb4fd sau #100; không nhận #94/#97 hoặc dùng chúng làm nền chính thức.
Không migration, index/model download hay đổi FastAPI runtime. Source candidate
đầu `53d7943`; delta sau đó chỉ bổ sung upload deadline15s và regression/ghi nhận.

## Kết quả cuối

| Kiểm tra | Kết quả thực thi |
| --- | --- |
| Frozen offline install, ignore-scripts | 585package,0download, PASS24.6s sau lần sandbox symlinkEPERM. |
| Backend lint/typecheck/build/diff-check | PASS; Prisma generate cùng schema17migration hiện có. |
| Backend full unit | **1160PASS/50files**,25.31s; gồm47image tests, không cộng subset. |
| Image HTTP/native upload subset | **47PASS**,20.06s; real unfinished multipart bị disconnect sau15s, request tiếp PASS; intentional Request aborted log không phải lỗi ngoài dự kiến. |
| Backend full E2E | **760PASS/1SKIP/20TODO**,44filesPASS/2SKIP,234.06s,exit0. DB PostgreSQL17 QA `bckl_order_resolution_test_attributes_20261019_v928`,127.0.0.1:5549,17fresh migrations. |
| Image gateway PostgreSQL subset trước full | **3PASS**,4.37s trên DB riêng v926; không cộng vào760. |
| AI Ruff app/tests/scripts | PASS. |
| AI full Pytest | **318PASS**,29.91s; sau manifest fingerprint update, exporter riêng1PASS0.23s. Models/router AI không đổi. |

Actual source provenance: exporter sinh schema/example từ Pydantic thật, hashLF
cho models và router; Backend test reject drift và nhận đúng exclude-none wire.
Malformed200 không gọi hydrate; thử timeout trước headers và sau headers nhưng
body chưa xong, response>64KiB, redirect không theo, MIME/magic sai, file>5MiB,
duplicate file/field/query và quota/concurrency/release. Negative finite cosine
được nhận, không ép thành RRF hoặc điểm phần trăm.

Ba E2E mới dùng Nest/Multer/HTTP thật + PostgreSQL/public policy thật: stale
draft không lộ tên, ID trùng được dedupe và giữ rank2, Seller khóa trong DB
được đọc lại, Product/Variant/SearchOutbox không đổi sau search. **Upstream là
HTTP fixture có nhãn**, không nhận loaded FastAPI/CLIP/FAISS integration.
FastAPI router behavior được kiểm riêng trong Pytest có fake embeddings/index,
không phải thực nghiệm chất lượng truy hồi hay dữ liệu12query chính thức.

## Lượt chưa đạt và xử lý

- Formatter chạy nhầm root không tìm fixture file; chưa chạy DB ở lệnh đó.
- Fixture E2E đầu nested Variant truyền storeId không được Prisma nested input
  nhận. Tách create Variant với productId/storeId đúng schema,3case PASS sau sửa;
  không nới constraint hoặc sửa migration. Fixture lần lỗi được giữ tại QA v926.
- Full E2E đầu tại v926:674PASS nhưng7suite fail ngay preflight vì tên DB không
  thuộc allowlist Attributes. Không nhận xanh, không xóa/skipsuites/nới guard.
  Dựng **DB mới v928 đúng quy ước sẵn có** rồi chạy full760PASS. DBv926 giữ lại.
- Python TestClient trong sandbox treo ở Windows socketpair trước request;
  faulthandler xác nhận điểm chờ. Dừng riêng process đó, chạy lại có quyền
  loopback:16targetedPASS rồi318fullPASS, không sửa nghiệp vụ để làm xanh.
- `ruff check .` bắt thêm24lỗi notebookColab nền không thuộc CI scope. Không
  sửa notebook của Đạt; `ruff check app tests scripts` đúng phạm vi CI đạt.
- Warning pg concurrent client.query có sẵn; không nhận đã khắc phục lịch sử
  Order409/409 chỉ vì fullsuite lần này xanh. TODO/SKIP vẫn ghi nguyên số.

## Review độc lập và gate

Gemini **ArgonMedium** chỉ đọc service+interceptor đúng53d7943, không shell,
DB/secret/network/writes, trả NO FINDING trong scope; CLI báo16047tokens.
Review đó **trước** delta upload deadline, không gọi đó là approval head cuối.
Codex bổ sung deadline vì hai slow uploads không nên chiếm cả hai slot tới
timeout server mặc định; đã thử fake timer và request thật. Không gọi Gemini
lặp cho docs/status hoặc dùngHigh; modelreview không thay humanapproval.

Đây là Backend candidate cần Hoàng–Đạt review alignment và Hiền QA. Chưa Web
upload, Chrome search journey, loaded model/index/quality hoặc toàn G-SEARCH
DONE. Giới hạn triển khai/mã lỗi ở [API](../api/image-search-gateway.md).
