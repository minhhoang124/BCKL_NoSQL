# Verifier Search theo migration của source commit — 25/10/2026

Refs #32, #105 và điểm giao Search của #114. Chỉ sửa toolkit/runbook,
không sửa ứng dụng, schema, migration, productId hoặc contract Backend–AI.

## Lỗi và cách sửa

Verifier cũ bắt buộc tổng migration bằng 17 nên từ chối cả gói mới hợp lệ.
Không thay hằng số bằng 19/24/25. Runner lấy tên và SHA-256 SQL từ Git object
của commit ứng dụng được kiểm, đối chiếu checkout trước khi mở Docker, rồi ghi
`migration-provenance.json` từ bảng `_prisma_migrations` của DB QA mới.
Verifier đọc lại Git object, kiểm tên/checksum/trạng thái và tổng tương ứng.
`--head` cho phép người nhận khóa SHA nguồn mong đợi; `--checkout` chỉ repository
có commit đó. Hash coverage và các invariant Search cũ vẫn giữ nguyên.

Chấp nhận checkout LF/CRLF có nội dung tương đương Git, không chấp nhận sửa SQL.
Thiếu/thừa/trùng migration, cùng tổng nhưng sai tên, SQL sai byte nội dung,
chưa hoàn thành, đã rollback hoặc source SHA khác đều bị từ chối.
Không tự bổ sung provenance cho gói lịch sử để đổi kết luận của lượt cũ.

## Kiểm mới

- 21 unit test toolkit PASS (14 cũ + 7 mới; các subtest không cộng vào tổng).
  Fixture Git có ba commit 17/19/25 migration chứng minh việc kiểm source lịch sử
  không phụ thuộc HEAD hiện tại. Đây là SQL giả lập kiểm guard, không phải ba
  lượt migrate PostgreSQL thật.
- Ruff check/format, Node syntax và diff-check PASS.
- Thực thi runner mới trên application #114
  `35a234d0607abb499b95c2aeb57dd10605c1a8a5`: **24 migration PostgreSQL thật**
  được đối chiếu tên/checksum/trạng thái; verifier **48 hash PASS**, 8 nhóm
  tích hợp loaded Search PASS. Driver reviewer bổ sung một luồng owner riêng
  sau các nhóm chuẩn; không cộng vào tổng unit.
- Cùng application SHA, checkout không sửa: **1324 Backend unit PASS**;
  ba suite account-owner-invalidation/account-status-hardening/search-hydrate
  **69 test DB PASS**; typecheck và Nest build PASS. Không nhận đã chạy full DB E2E.

## Ranh giới điểm giao #114

Review sau merge, đúng head nguồn nêu trên; không phải approval hồi tố toàn PR.
Account state/audit/revoke và durable job SELLER cùng giao dịch; tìm Store theo
sellerId canonical, không yêu cầu current role SELLER. DB tests kiểm rollback
khi enqueue lỗi, no-op, Store SUSPENDED không tự mở và fan-out DELETE/UPSERT.

Probe reviewer với Nest/FastAPI/CLIP/ES/FAISS thật trên DB/index mới: owner USER
có listing public, UPSERT v2; khóa qua Admin HTTP tạo job, Backend loại candidate
cũ trước dispatch; worker fan-out DELETE v3 và cả ES/FAISS xóa đúng ID; mở lại
qua HTTP tạo UPSERT v4, hai index và hydrate trả lại. No-op không thêm job/event;
Store ACTIVE và Variant giá/kho giữ nguyên; access token cũ vẫn 401 sau unlock.
Không thấy blocker Search trong phạm vi đã kiểm.

Hai DB/role mới, role false:false:false, cổng loopback5549, cron tắt và dispatch
worker thật có chủ ý. Không reset/drop dữ liệu cũ. QA đã dừng, giữ audit/index.
ES8.19.21; model offline image327ab6726d33c0e22f920c83f2ff9e4bd38ca37f,
text58edf8cada9e398793dca955574a48cbb7f18be2; CPU1worker/RRF60,
hybrid20/100, image10/30; ảnh fixture dùng chung chỉ kiểm dây nối/ID.
Không truy hồi lại evaluation hoặc tính Precision/Recall.

#114 đã merge d508c61 và #116 đã merge 632aef0 trước lúc chốt review.
Kết quả tại35a234d không tự chuyển thành nghiệm thu #116 hoặc develop632aef0.
Không kiểm Chrome/Accounts recovery mới, load đa replica hoặc toàn Auth/Admin.
Logs forced failures trong test và warning pg concurrent query được giữ,
không giải thích exit0 thành đã sửa warning. CI cần đọc riêng, local không là CI xanh.

## Lệnh

```sh
python3 -m unittest discover -s scripts/qa -p 'test_*.py' -v
python -m ruff check scripts/qa
python -m ruff format --check scripts/qa
node --check scripts/qa/search-live.mjs
python3 scripts/qa/verify_search_live.py /absolute/new-evidence \
  --checkout /absolute/application-checkout \
  --head 35a234d0607abb499b95c2aeb57dd10605c1a8a5
git diff --check
```

Xem [runbook cập nhật](search-live-runbook.md). Source toolkit nằm trong PR;
log lệnh/exit, inventory24, proof và driver reviewer được đăng comment #114/#32,
không commit runtime/model/FAISS/log hoặc credential.
