# Search integration thật — 23/10/2026

Refs #32/#102/#103. Đạt thực hiện trên macOS26.6.2 ARM64, Node24.21.0,
PostgreSQL17 và Elasticsearch8.19.21. Không sửa runtime/schema/productId/AI wire.
[Bộ lệnh tái lập](search-live-runbook.md).

## Hai cây nguồn tách biệt

| Nguồn | Kết quả mới | Phạm vi |
| --- | --- | --- |
| #102 `3cc0e9fe961062cfb5eb1b94186b91006d41e724` | 8nhóm PASS,exit0,43.76s gồm shutdown; verifier45hash PASS | Loaded image gateway + Checkout/cancel/outbox/dual-index/hydrate; candidate, không nhận đã merge |
| develop `06eb4fd072c409a173ee2b239ef9c8c364bade9e` | 6nhóm PASS,exit0,44.18s gồm shutdown; verifier37hash PASS | Cùng chuỗi đồng bộ thật, không gateway image Backend chưa merge |

Hai DB mới:
`bckl_order_resolution_test_search_live_20261023_candidate3` và
`bckl_order_resolution_test_search_live_20261023_develop1`,127.0.0.1:5549;
17freshmigrations mỗi DB,role flagsfalse:false:false. Hai ES container/index
mới theo run-name,19263 chỉ loopback. Backend/AI/image/proxy chỉ loopback.
FAISS mới ban đầu0vector, không copy index86/dữ liệu evaluation. Hai Product QA
có ID do PG sinh,2Variant/Product,1ảnh fixture dùng chung,không chất lượng search.

Model cache offline pin image `327ab6726d33c0e22f920c83f2ff9e4bd38ca37f`,
text `58edf8cada9e398793dca955574a48cbb7f18be2`; deviceCPU,workers1,
rrfK60. Hybrid topK20/candidateK100; image topK10/candidateK30. Không model download.
Python3.12.14,FastAPI0.141.1,Uvicorn0.52.4,Pydantic2.13.5,
sentence-transformers5.7.0,transformers5.16.1,torch2.14.0,FAISS1.12.0,
numpy2.5.3,Pillow12.3.0. Dependency ranges chưa thành Python lock đầy đủ.

Driver Node SHA256 nguyên byte ở cả hai lượt:
`01d5666a0b2fd1d33cc4d35e0b17538613a18c706f775f0aafeafc97ceeedc46`.
Ảnh fixture SHA256:
`41c455da6b0a1019a6e47eacf59ba7a36868d8af5f123b13be5d88b5c4a860f0`.

## Đã kiểm chứng

1. Worker thật gửi UPSERT từ DB → FastAPI tải ảnh HTTP → CLIP embedding →
   Elasticsearch/FAISS. Đúng ID/512dimension/không vector trùng.
2. #102: JPEG và PNG qua multipart thật trả public Product từ PG. JPEG hỏng400,
   GIF415,AI proxy ngắt TCP503; no-store, không ghi thêm hàng nghiệp vụ đã snapshot.
3. #102: đổi Product A thành HIDDEN bằng fixture SQL, chưa dispatch DELETE;
   FastAPI vẫn trả A trong candidates nhưng Backend loại A,giữB. Đổi fixture lại
   ACTIVE trước các ca Checkout. Đây không phải test API Seller hide.
4. Hai Variant A stock1 mua hết qua Cart/preview/Checkout HTTP thật → một
   Product.version2/outbox,inStockfalse; cả index và filtered Search loạiA.
5. Buyer cancel HTTP → stock[1,1],APPROVED giữ nguyên,version3/một UPSERT.
   Replay cùng key/body giữ DB nguyên trạng. Trước dispatch,index cũ thiếuA;
   không giả hydrate tự bổ sung được ứng viên bị index bỏ sót.
6. Ngắt ES TCP sau cancel commit: FastAPI503/PARTIAL_FAILURE,FAISS v3
   SUCCEEDED/ES FAILED; outboxFAILED attempt1. Chờ backoff30s thật → attempt2
   SUCCEEDED,nguyên event; FAISS ALREADY_APPLIED/ES SUCCEEDED. Byte FAISS không
   đổi giữa partial và caught-up,vector không nhân đôi,A tìm lại được.
7. Bv2 được giữ lịch trước dispatch,Bv3 đi trước; v2 tới muộn nhậnSTALE,
   docsES và toàn bộ hash FAISS/state không đổi. Không sửa payload/resetattempt.
8. Store fixture chuyểnSUSPENDED rồi hủyOrderA → DELETE v5 với đúngID/version,
   ES bỏ document,FAISS bỏA,Backend không trả sản phẩmStorebịkhóa. Gửi UPSERTv3
   cũ quaHTTP nhậnSTALE,tombstone không cho hồi sinh.

## Minh bạch lượt lỗi và giới hạn

- Candidate lượt1 dừng tại đọc snapshot FAISS: runner đã resolve symlink của
  Python venv thành interpreter nền nên không import đượcFAISS. FastAPI vẫn
  load thành công; đây là lỗi harness, không finding #102.
- Một preflight lượt kế tiếp gặp socketTIME_WAIT khi khôngSO_REUSEADDR; không
  provisioning mới. Sửa probe port,không kill tiến trình đang chạy.
- Candidate lượt2 dừng ở JSON.stringify BigInt của snapshot. Đã sửa harness
  giữ objecttyped trongRAM,chỉ serializeBigInt khi lưu. Lượt3 dùng DB/index mới
  đạt đủ8nhóm; giữ cả output/DB lỗi, không nhận hai lượt lỗi làPASS.
- Guard tests mới từng vấp quyền socket sandbox trước check tên container.
  Đã chuyển check input sai lên trước socket;14unitpreflight/hash cuốiPASS.
- Ruff ban đầu8lỗi style/import/check=False ở toolkit mới,đã sửa; không giảmrule.
- Có warning pg concurrent query và resource_tracker shutdown ở môi trường
  Python; chưa điều tra rootcause,không gọi exit0 là đã sửawarning.
- Các kiểm tra là fixture integration local/singleprocess; không browser hoặc
  cohort86/quality/held-out image query. Không thay groundtruth978/54,metricpilot
 7query hoặc publication gate #25. Không thay fullBE/FEunit/E2E regression.
- #103 giao Hoàng chuẩn bị FE song song. Chưa có Web upload/production Search
  acceptance,không G-DISCOVERY/G-OPERATE DONE. #102 vẫnDraft/chờreviewHiền.
- CI billing trước đó chưa chạyjob; lượt này localPASS,không tuyên bốCIxanh.

Hết lượt chạy: FastAPI/Nest/proxy/ảnh đã đóng; PostgreSQLQA và ESQA đã dừng,
giữ DB/index/runtime để kiểm. Main checkout không đổi. Bộ công cụ chỉ thêm
`scripts/qa` và hai tài liệu kiểm thử; không commit log/model/image/FAISS/runtime.
