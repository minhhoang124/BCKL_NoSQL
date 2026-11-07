# Kiểm thử Store Search analytics — 28/10/2026

Phạm vi FR-RPT-02 / TC-60, nền `a88a11d` (#132), nhánh `codex/store-search-analytics`. Runtime collection mặc định tắt. Xem [contract](../api/store-search-analytics.md) và [bàn giao máy mới](../project/handoff-search-analytics-2026-10-28.md). Đây là bằng chứng local; không thay CI hoặc tự ghi nhận approval của thành viên.

## Môi trường và dữ liệu

- QA PostgreSQL chỉ loopback5549. Demo `bckl_postgres` giữ dừng; không sửa/xóa/khôi phục dữ liệu demo.
- v975: fresh38 migrations và full E2E. HTTP analytics riêng chạy bằng role app không superuser/CREATEDB/CREATEROLE; full suite có các fixture cần role migrator QA.
- v976: clone QA v973, nâng37→38 migrations. Cả63 bảng cũ và checksum/metadata migrations cũ giữ nguyên; ba bảng analytics mới rỗng, không backfill. Digest dữ liệu cũ: `047bb7f6cd0ebf19f147fcb1a5716e5999856b870b9a45f9205779113ba1c492`.
- v977: Chrome dùng DB riêng để không tranh chấp fixture với full E2E. Catalog/actors và AI retrieval là dữ liệu tổng hợp có nhãn. Upload/decode ảnh, public hydrate, HTTP, cookie, viewport/click, đăng nhập mật khẩu và đọc báo cáo chạy thật. Không coi là model/index AI thật hoặc phép đo chất lượng tìm kiếm.
- Không nạp `.env` vào QA checkout, không gửi provider secret cho Gemini, không commit database/ảnh/log/binary.

## Kết quả

| Kiểm tra | Kết quả |
| --- | --- |
| Fresh migration + schema diff | 38 migrations PASS; schema diff0 |
| Upgrade37→38 | PASS,63 bảng cũ không đổi, analytics0 |
| Backend typecheck/build/lint | PASS |
| Backend full unit | 80 files,1761/1761 PASS |
| Backend full E2E | 69 files PASS,2 files SKIP;1168 PASS/1 SKIP/20 TODO |
| Web full suite cuối | 1680 PASS/6 live SKIP, pool=forks,1 worker |
| Web TypeScript/Vite build + lint | PASS; warning nền hiện có, không tăng warning telemetry |
| Chrome | 6 nhóm PASS,4 ảnh: desktop-light và mobile với color-scheme dark được giả lập |
| Git whitespace | PASS |

20 TODO thuộc suite lịch sử, không đổi thành PASS hoặc xóa để làm đẹp số liệu. Lần E2E đầu bị hai helper từ chối tên DB mới; đã chỉ bổ sung đúng v975 vào allowlist, giữ host/port/role fence, rồi chạy lại toàn bộ. Test upload cô lập được bổ sung dependency telemetry pass-through; không dùng mock đó trong E2E analytics.

Ca đối kháng thực thi: concurrent10 click/render chỉ một hiển thị và một click; cookie/token sai, product ngoài kết quả, token hết hạn; zero/frozen/bot không tạo proof; Seller không chọn/đọc Store khác, Buyer/guest/stale credential/demotion/deactivation bị chặn; Admin lọc Store; no-store, GET body và query trùng; logging outage không làm Search thành công bị fail và report DB lỗi không biến thành0; cleanup cascade dữ liệu quá30 ngày dù collection tắt, không đổi Order/Stock/SearchOutbox/Product; hai cohort cùng cookie không có hash visitor cố định; PostgreSQL timezone UTC+7 và Node clock lệch không làm lệch cohort/expiry.

Web còn có test viewport nền/visible, click và middle-click keepalive, bỏ tracking trên browse, lỗi telemetry không chặn điều hướng, báo cáo disabled/mất mạng/dữ liệu sai và đổi phiên. Chrome tái lập lỗi Home tải Search trong lúc Auth bootstrap kết thúc; đã chờ initial session trước mount HomeResults và thêm regression. Test hủy ảnh bao phủ cả lúc đang prime cookie và khi upload đã dispatch. Một lượt full Web chạy cùng các tiến trình QA bị `Worker exited unexpectedly`, không có kết luận PASS từ lượt đó; lượt cuối chạy riêng với một fork.

## Review độc lập

Gemini Argon Medium rà thiết kế và source, chỉ đọc; không tuyên bố tự chạy database. Finding timezone và hash phiên ổn định đã được sửa, có regression. Review source cuối `63495964-e198-48c1-bd99-7185d2c41321`: không còn P1/P2 theo phần mã được cung cấp. SHA256 snapshot đã đánh số dòng: `ff71723bc362d84e583bf570e11c7aecda91aeb05a3b745da6cdcaffcbedd72f`.

Codex chạy test/runtime/Chrome và tự đối chiếu scope. Không gọi đây là hai reviewer con người hoặc bảo đảm không có lỗi. Giới hạn công bố: client telemetry có thể mất/nhiễu; bot giả UA/IP vẫn có thể tạo mẫu; hai tab hoàn toàn mới có thể đua cookie; map quota theo process, cleanup có giới hạn batch; không làm CPC billing, không suy ra mua hàng hay chất lượng AI.

## Bằng chứng máy cũ

Log không chứa credential dưới `artifacts/search-analytics-qa-20261028/`; Web cuối `fe-final-1793171226888.log`; full E2E `e2e-1793170385403.log`, unit `unit-1793169889241.log`, upgrade `upgrade-v976.json`. Chrome cuối dưới `artifacts/search-analytics-browser-qa-20261028/analytics-browser-1793170965061/`: `report.json`,4 PNG và source hashes. Các thư mục này phải sao chép riêng nếu cần ảnh báo cáo trên máy mới; không nằm trong Git. Script Chrome và tổng kết này được commit để dựng lại bằng chứng.

Chưa nghiệm thu AI provider thật, không đổi tình trạng VNPay IPN hoặc email provider. Cần kiểm head/CI mới sau push; chỉ cập nhật trạng thái tích hợp sau merge hợp lệ.

## Kiểm lại trên máy mới — 28/10/2026

Source ứng dụng vẫn là `dcc5e9f`; delta mới chỉ sửa oracle trong driver Chrome.
Fresh database `bckl_order_resolution_test_pr133_review_20261028`, PostgreSQL17
loopback5549, áp đủ38 migrations; HTTP/PostgreSQL analytics13/13PASS bằng
app-role không superuser/CREATEDB/CREATEROLE. Không dùng database demo hoặc
database phục hồi đang nối Web làm fixture cho lượt kiểm này.

Lượt Chrome đầu và lượt chẩn đoán giữ nguyên là FAIL ở bước chờ acknowledgement.
React StrictMode có thể dispatch hai Search lúc mount; Web bỏ phản hồi cũ nhưng
driver lấy token của response đầu rồi chờ impression của cohort không được render.
Lượt chẩn đoán ghi nhận Web đã gửi event200 cho kết quả hiện hành. Sửa driver để
lấy capability từ request IMPRESSION thực của Product cần kiểm, đối chiếu nó với
một response Search đã nhận và Product tương ứng, rồi kiểm impression/click trong
PostgreSQL theo đúng cohort đó. Không tắt StrictMode, giả event thành công, thêm
sleep để chọn response hoặc nới assertion số liệu/quyền.

Sau sửa, driver gốc chạy lại trên QA v977/38 migrations với Chrome thật:
6nhómPASS,4PNG; giữ kiểm scope Seller/Admin và số dòng nghiệp vụ không đổi.
AI retrieval trong lượt này vẫn là provider tổng hợp, không phải catalog/index
AI thật hoặc nghiệm thu chất lượng tìm kiếm. Các artifact mới nằm ngoài Git tại
`machine-local/pr133-browser-final-20261028-163358/`; bản lỗi, diagnostic và lượt
sửa đầu được
giữ riêng. Node24.22.1, pnpm11.25.0, Chrome cài trên Windows.

Argon Medium đọc snapshot source của `dcc5e9f`, không phát hiện P1/P2 xác nhận
trong phạm vi đã đọc; đây là review tĩnh tự động, không phải reviewer con người,
không thay bằng chứng runtime hoặc tự cho phép merge. Lượt Flash review delta
timeout/trảrỗng không được tính là approval hay review đạt.
Sonnet Medium đọc delta driver cuối và không có finding xác nhận; response bị
hủy được bỏ qua có xử lý rejection, nhưng token đang acknowledgement vẫn phải
khớp một response HTTP thành công chứa đúng Product và bản ghi PostgreSQL thật.
