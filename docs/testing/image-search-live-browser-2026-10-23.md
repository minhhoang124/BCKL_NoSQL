# Image Search — Chrome, AI và PostgreSQL thật, 23/10/2026

## Kiểm lại sau khi #108 và #102 đã merge

Lượt mới source sạch Backend/AI `33a9e9a210487497a1d42041dfbf2d10ae57d3e1`
(nguyên runtime develop09b332c) và Frontend `5f50f499e687769faae48241822eb58d494effc2`.
DB mới `bckl_order_resolution_test_image_chrome_r1792750973496`,19migration,
runtime role NOSUPERUSER/NOCREATEDB/NOCREATEROLE; không có.env ở hai checkout.
CLIP offline đúng hai revision bên dưới, FAISS512/ES8.19.21/index mới;
Chrome155.0.8059.85. Cả **5/5 nhóm PASS**, gồm4viewport/OSscheme và PNG stale-hit.
Mỗi nhóm4viewport bấm đôi chỉ1POST; Product bị ẩn trong DB không lộ dù index
chưa cập nhật, tìm không phát sinh version/outbox. Không HTTP success mock.
Artifacts: `artifacts/image-search-live-chrome-20261023/r1792750973496/`, có
proof.json/results.json/5PNG; ảnh mobile-dark đã xem, không tràn ngang.
Services/Nest/Vite/Chrome/AI và đúng ES container lượt này đã dừng; giữ DB/index.

Frontend full trên5f50f49: **1.219 PASS/6 live SKIP**,63filePASS/1SKIP,158.37s;
lint0error/5warning Admin nền, tsc/Vitebuild/diffPASS. Nền Backend đã kiểm riêng
1.212unit/822E2E, không cộng hai suite hoặc nhận SKIP/TODO đã chạy.
Component/adapter/driver ảnh nguyên byte so với2b09e14 đã được Hiền/Đạt duyệt;
merge chỉ giữ phần Auth/gateway/toolkit mới và cả ghi chú kiến trúc, không sửa
thuật toán, wire hoặc flag. Review tự động cũ giữ phạm vi đúng source, không
giả approval của Hiền trên head mới. Codex kiểm delta và chạy live mới như trên.

Đây vẫn là kiểm đường chạy với2Product tổng hợp, không là chất lượng tìm ảnh,
thực nghiệm7query/602cặp hay full-load/auth-switch/error matrix với loadedAI.
Cờ VITE_IMAGE_SEARCH_ENABLED vẫnfalse mặc định; không tự bật ngoài QA.
Các phần bên dưới giữ lịch sử lượt trước, không thay SHA/kết quả mới này.

## Source và môi trường

- Backend/AI checkout #102: `18e6fbf3d2e2da1ca977eb00cd521cc25c13f4ad`.
- Frontend checkout #104: `0cb787680a2400e9516947a00cb3f556d266644d`.
- Hai checkout sạch, cùng nhận develop `a91db91` sau #94; không dùng .env.
- Chrome thật qua Playwright; Vite `envDir:false`, cờ tìm ảnh chỉ bật trong QA.
- PostgreSQL17 QA loopback5549, database mới
  `bckl_order_resolution_test_image_chrome_r1792743640667`, đủ17migration.
- Backend dùng role riêng hiện có NOSUPERUSER/NOCREATEDB/NOCREATEROLE;
  migrator chỉ tạo database mới và cấp quyền trong đúng database đó.
- Elasticsearch8.19.21/index mới `image-chrome-r1792743640667`; FAISS512
  mới, CLIP CPU offline từ snapshot image `327ab6726d33c0e22f920c83f2ff9e4bd38ca37f`
  và text `58edf8cada9e398793dca955574a48cbb7f18be2`. Không tải model mới.
- Hai Product tổng hợp có ID do PG sinh, ảnh màu cam tổng hợp dùng kiểm đường
  truyền/visibility; không dùng corpus86 hoặc dữ liệu đánh giá7query/602cặp.

## Đường chạy và kết quả

Fixture catalog có nhãn → SearchOutbox trong Serializable transaction → worker
thật → FastAPI `/index/product` → Elasticsearch+FAISS. Kiểm đúng2outbox SUCCEEDED,
ES có hai document version1, health modelLoaded/indexLoaded=true/vectorCount2.
Sau đó Chrome chọn ảnh → JPEG/PNG multipart thật → Nest `/search/image` →
FastAPI CLIP/FAISS → Backend hydrate PostgreSQL → ProductCard.
Không mock hoặc fulfill response giữa trình duyệt, Backend và FastAPI.

| Nhóm | Kết quả | Đối chiếu |
|---|---|---|
| Desktop1440×1000, OS light | PASS | Hai ID đúng, giá/stock hiển thị, bấm đôi chỉ1POST |
| Desktop1440×1000, OS dark | PASS | Hai ID đúng, không lỗi JavaScript/tràn ngang |
| Mobile390×844, OS light | PASS | Hai ID đúng, không lỗi JavaScript/tràn ngang |
| Mobile390×844, OS dark | PASS | Hai ID đúng, không lỗi JavaScript/tràn ngang; ảnh đã xem thủ công |
| PNG + stale hidden hit | PASS | Ẩn A bằng SQL fixture, chưa dispatch index; Web chỉ còn B; version/outbox không đổi vì truy vấn |

Trước bấm gửi không có POST; request tìm ảnh không Authorization/cookie.
Hai Product dùng cùng ảnh nên không suy luận chất lượng/ranking từ thứ tự.
OS dark là cấu hình trình duyệt, storefront vẫn giao diện cam/sáng hiện hành;
không nhận đây là theme tối mới đã thiết kế.

## Bằng chứng và giới hạn

Local artifacts tại repo chính:
`artifacts/image-search-live-chrome-20261023/r1792743640667/` gồm `proof.json`,
`results.json`, 5PNG và log/model/index riêng. Không commit artifacts hoặc secret.
Harness local `deliverables/run-image-chrome-live-20261023.cjs` đọc profile QA
riêng, từ chối demo đang chạy, DB/output/cổng đã dùng và checkout có.env.
Harness này còn phụ thuộc đường dẫn máy Hoàng, chưa phải portable toolkit #105.
Không gửi private profile; máy khác dựng QA riêng theo runbook của #105.

Ba lượt lỗi harness trước được giữ nguyên: hai lượt cùng lỗi fixture nested
Prisma chứa storeId thừa; lượt tiếp theo đã đạt4nhóm Chrome nhưng phép so sánh
SQL thiếu orderBy làm danh sách đảo vị trí. Sửa fixture/phép so sánh, không sửa
runtime ứng dụng để làm xanh. Lượt cuối ở trên đạt5/5, exit0.
Còn warning pg concurrent query nền, không coi PASS là đã xử lý warning đó.

Đã dừng Nest/Vite/Chrome/AI và đúng ES container do lượt này tạo; giữ database,
container dừng, index và các lượt lỗi để đối chiếu. Demo `bckl_postgres` vẫn tắt;
không xóa/khôi phục hoặc thao tác dữ liệu demo trong lượt này.

Chưa kiểm browser crash/đa replica/load, bộ ảnh thực lớn, chất lượng tìm ảnh,
hoặc toàn bộ8nhóm toolkit #105 trong Chrome. Lỗi mạng/malformed/quota/decode đã
có unit/E2E/Chrome fixture riêng, không nhận chúng đều chạy với loadedAI ở đây.
Chưa merge #102/#104 và chưa bật cờ trên develop. Commit chỉ thêm báo cáo sau
hai source SHA đã kiểm; không đổi runtime.
