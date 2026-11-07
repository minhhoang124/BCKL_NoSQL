# Thống kê tìm kiếm theo Store

28/10/2026 — FR-RPT-02 / TC-60. PostgreSQL là nguồn sự kiện. Không thay Backend–AI wire, Elasticsearch, FAISS, dữ liệu xếp hạng hay cách tính thực nghiệm 7 truy vấn. Chỉ xem là đã tích hợp sau khi PR được merge.

## Ý nghĩa số liệu

- Một SearchLog là một lần Backend trả về tập kết quả công khai sau hydrate/lọc từ PostgreSQL. Tìm văn bản ghi `HYBRID_TEXT`, tìm ảnh ghi `IMAGE`; không suy ra riêng keyword/semantic từ hybrid.
- SearchResultLog giữ `productId`, `storeId`, thứ hạng AI được giữ lại sau lọc và thời điểm acknowledgement. Kết quả ngoài viewport chưa được tính hiển thị. Browse danh mục/Store không thuộc Search.
- Web gửi IMPRESSION khi thẻ giao viewport và document đang visible. Đây là tín hiệu trình duyệt, không chứng minh con người đọc hay một chuẩn viewability quảng cáo. CLICK là kích hoạt liên kết thẻ bằng chuột/bàn phím/middle-click, không phải mua hàng. Menu chuột phải copy/open link không được bảo đảm ghi nhận.
- Mỗi cặp `(searchId, productId)` tối đa một hiển thị, một click. CLICK xác nhận hiển thị trong cùng giao dịch để tránh mất acknowledgement/race và bảo đảm clicks không lớn hơn impressions. Không đếm click lặp thành nhiều lượt, không gọi số sản phẩm hiển thị là số lượt tìm kiếm hoặc số người.
- Kỳ là `[from,to)` theo UTC, tối đa30 ngày; from/to phải là nửa đêm UTC canonical. Cả hai chỉ số quy chiếu theo thời điểm DB tạo SearchLog. Click tới trong15 phút có thể cập nhật lại kỳ của lần tìm trước. `asOf` là snapshot đọc, không phải mốc khóa số liệu bất biến.
- `coverage=RECORDED_ONLY`, `complete=false` ở mọi response: mất mạng, chặn theo dõi, logging outage hoặc bot có thể làm số liệu thiếu/nhiễu. Không dùng cho tính phí hoặc tuyên bố chất lượng tìm kiếm. Không backfill lịch sử từ đơn hàng.

## API

`POST /search/session`: Web prime cookie HttpOnly/SameSite=Lax trước lần tìm đầu, dùng chung promise trong một tab. Không tạo dữ liệu nghiệp vụ. Hai tab mới hoàn toàn có thể đua cookie; mẫu không xác thực được sẽ bị loại, không tự gán lại người hoặc Store.

`POST /search/hybrid`, `POST /search/image`: response cũ giữ nguyên khi collection tắt/không ghi được/không có kết quả. Khi ghi được thêm `analytics:{token}`. Token không phải JWT hoặc thông tin đăng nhập. Không đưa vào URL, localStorage, log hoặc report. Tìm ảnh gửi anonymous cookie để ràng buộc proof; không thêm Authorization, không lưu ảnh hoặc tên file người dùng. Backend–AI payload giữ nguyên.

`POST /search/events`, body đúng ba trường `{token,productId,event:'IMPRESSION'|'CLICK'}`. Không nhận Store, rank, userId hay query do client khai báo. Origin phải khớp FRONTEND_URL. Token256 bit, cookie proof băm theo từng token để không tạo hash phiên ổn định trong DB; hết hạn15 phút theo đồng hồ PostgreSQL. Sai proof/product/expiry trả400; Origin/cookie không hợp lệ403, quota429, collection/DB unavailable503. Không tự retry vô hạn. Gửi keepalive và timeout3 giây, không chặn mở trang sản phẩm.

`GET /seller/search-analytics?from=2026-10-28T00:00:00.000Z&to=2026-10-29T00:00:00.000Z`: kiểm actor hiện hành (`isActive`, role, credentialVersion), tự lấy Store từ sellerId; tham số Store khác bị từ chối. Chủ Store tạm khóa/đã đóng vẫn được đọc lịch sử, không được ghi catalog qua API này. Seller chưa có Store404; guest401, sai role403.

`GET /admin/search-analytics`: cùng range, tổng hợp toàn sàn; có thể thêm `storeId` nguyên dương canonical để đối chiếu từng Store. Không trả query, Buyer, cookie/proof hoặc dữ liệu cá nhân. Strict query: từ chối khóa lạ/trùng/mảng, ngày không hợp lệ, khoảng ngược hoặc quá30 ngày. GET body bị chặn. Read-only RepeatableRead và statement timeout5s; lỗi DB503, không đổi thành số0. `Cache-Control:no-store` áp dụng cả lỗi trước guard; CORS xử lý trước các gate.

Response: `scope, storeId, from, to, asOf, availableFrom, retentionDays:30, attribution:'SEARCH_COHORT', metric:'VIEWPORT_ACKNOWLEDGED', coverage:'RECORDED_ONLY', complete:false, status, totals, strategies`. Totals là số result đã hiển thị/nhấp; strategies phân rã cùng mẫu số. Tắt hoặc cutoff cấu hình không hợp lệ: `status=DISABLED,totals=null`. Kỳ ngoài cutoff/floor hoặc chứa thời gian tương lai: PARTIAL, chỉ trả phần đã ghi, không giả sử vùng thiếu bằng0. Trong cửa sổ thu thập trả RECORDED nhưng vẫn không hứa đầy đủ.

## Vận hành và giới hạn

Migration mới `20261028120000_store_search_analytics`, không sửa migration đã merge. Áp dụng migration trước khởi động ứng dụng. Cấu hình `SEARCH_ANALYTICS_ENABLED=false` mặc định, bật cần `SEARCH_ANALYTICS_START_AT` UTC canonical có milliseconds. Cutoff không phải lịch sử uptime được server chứng nhận; luôn báo RECORDED_ONLY.

`SEARCH_ANALYTICS_RETENTION_ENABLED=true` chạy độc lập việc collection bật/tắt; mỗi phút xóa tối đa500 cohort quá30 ngày bằng SKIP LOCKED, cascade các result/click. Không xóa bảng nghiệp vụ. Nếu dừng worker hoặc backlog cao, xóa vật lý có thể chậm; API vẫn loại dữ liệu trước floor. Người vận hành phải theo dõi cảnh báo retention và không tắt job sau khi bắt đầu thu thập. QA được tắt cron để kiểm thủ công, không dùng cấu hình đó cho vận hành có thu thập.

Known bot UA bị loại, hạn240 request capture/event/session mỗi phút/IP kết nối thực mỗi process, map tối đa10000 địa chỉ trong bộ nhớ. Không tin X-Forwarded-For; nhiều người dùng chung IP có thể bị loại mẫu. Không chống bot giả User-Agent hoặc đổi IP ở quy mô sàn thật. Khi mở rộng cần rate-limit tại gateway đáng tin, quota phân tán và đánh giá quyền riêng tư; không âm thầm nới quyền Seller. Cookie path theo đường Search nhìn từ request; proxy đổi prefix/HTTPS cần cấu hình cookie/trust proxy tương ứng và QA lại. Không lưu IP trong bảng/log; memory bucket chỉ phục vụ quota.

Backend luôn set LOCAL timezone UTC ở capture/event/read/cleanup; không phụ thuộc timezone của PostgreSQL hoặc đồng hồ Node để ghi cohort/expiry. Capture lỗi vẫn trả Search thành công, không tạo click cho kết quả không có proof. Rank/product trùng hoặc dữ liệu trái constraint làm rollback telemetry, không tự sửa thứ hạng của AI.

## Máy mới

Xem `docs/project/handoff-search-analytics-2026-10-28.md`. Secret, `.env`, database QA, uploads và artifact ảnh không nằm trong Git. Không sao chép `.env` máy cũ để chạy test; dùng PostgreSQL QA riêng và các chốt đích đã có trong test.
