# QA email nghiệp vụ — 28/10/2026

Nền `d5815d5`, nhánh riêng. Chưa coi đã merge hoặc gửi email ra ngoài chỉ dựa trên tài liệu này.

## Môi trường và migration

Fresh QA v973, PostgreSQL loopback5549,37 migration. App-role không có superuser/CREATEDB/CREATEROLE; migrator riêng chỉ dựng QA. Không `.env` trong checkout, không reset/drop database cũ. Demo dừng trong suốt lượt chạy.

Upgrade độc lập: tạo bản sao QA v971 khi không còn kết nối sang v974, áp migration36→37. Hash62 bảng nghiệp vụ trước/sau giống nhau; 36 migration cũ/checksum giữ nguyên, bảng job mới rỗng. Report local `artifacts/email-qa-20261028/upgrade-v974.json`. Schema diff0.

## Bộ kiểm và bằng chứng đã xác minh

- Policy/transport:39 unit PASS sau test khoảng đệm provider. Cấu hình/nguồn/origin/role, cửa sổ23h, host clock lùi, header injection, response lỗi/quá lớn, HTTP429/409/5xx, timeout và redirect guard. Không gọi Resend thật trong test.
- PostgreSQL/HTTP tập trung:30 PASS. Concurrentenqueue/workers, ID nhỏ commit muộn, crash trước/sau marker, stale worker trước/sau network, exactpayload/key, max5, backoff và cửa sổ hết hạn, inactive/unverified/demotion/đổi email/config, terminalimmutability, cutoff và email legacy quá dài. Test lệch Date host±365ngày đã tái lập lỗi timestamp và đạt sau sửa rawINSERT/DBclock.
- Preflight đã tái lập trên bản cũ: OPTIONS `/account/notifications?limit=20` trả400 vì bị coi là write trước CORS. Chuyển CORS trước body/query gates, ca hiện tại204; guestGET401, Notification/job counts không đổi. Không nới guard/validation nghiệp vụ.
- Real Mailpit HTTP + Chrome:5 nhóm PASS,3PNG tại `artifacts/email-qa-20261028/email-browser-1793165094049/report.json`. Catalog/actors/verifiedflag là setup tổng hợp; Buyer đặt COD qua HTTP Address/Cart/Checkout, Seller confirm/startpacking qua HTTP thật. Một email accepted đúng recipient và ID provider khớpDB; chạy lại/reconstructworker không thêm thư. Controlled lost response sau Mailpit nhận thư -> UNKNOWN, restart không gửi thêm; Order/Payment/Variant/Stock/Search của chính đơn không đổi do worker.
- Chrome desktop/mobile light đăng nhập thật mở owninbox từ đích email, không tràn ngang/pageerror. Mailpit UI nhìn thấy thư. Không có bằng chứng dark mới, không video, không SMS/email xác minh thật hoặc Resend/Gmail delivery.

Các lượt lỗi fixture/oracle được giữ: update thời gian RETRY_WAIT bị SQLgate chặn nên test chuyển sang lịch có kiểm soát; fixture email legacy trùng được sửa thành unique; request ERR_ABORTED do StrictMode cleanup được tách khỏi lỗi mạng thật. Không nới SQLgate để làm xanh và không xóa bằng chứng cũ.

Hồi quy local:1738 Backend unit PASS trước bổ sung test khoảng đệm (39 focused cuối PASS); full1155 E2E PASS/1SKIP/20historicalTODO,68filesPASS/2SKIP. Typecheck/build/lint/schemaDiff0 đạt. Delta cuối chỉ thêm log finalize bị fence chặn và test khoảng đệm; 30PG/HTTP,39unitfocused và Mailpit/Chrome được chạy lại trên đúng mã cuối. Argon Medium đã tìm clock/UNKNOWN/backoff; sửa và test hồi quy. Hai lượt CLI cuối trả rỗng không được tính duyệt. Sonnet Medium review delta/disposition: NONE P1/P2; giữ fence, log cố định và giới hạn23h, không hứa exactly-once SMTP. Review AI là static, không approval giả danh thành viên hoặc bằng chứng reviewer đã chạy test.

## Chạy lại

Theo [hướng dẫn QA local](local-qa-runbook-2026-10-28.md), build Backend trước. Cấu hình private qua môi trường tiến trình; không dùng `.env` demo.

```powershell
pnpm --dir BE exec vitest run src/notification/notification-email
pnpm --dir BE exec vitest run --config vitest.config.e2e.ts test/notification-email-runtime.e2e-spec.ts
```

Driver `scripts/test-notification-email-local.mjs --playwright-module <đường dẫn playwright/index.js> --output <thư mục mới>` chỉ nhận app-role QA v973/37 migration, port5549. Mailpit phải chạy riêng chỉ bind127.0.0.1:8025/1025, không relay/forward; driver không khởi động hoặc xóa inbox. Đặt các worker Search/reconciliation/image-repair/auto-complete/notifications/email thànhfalse. Driver tự Nest3393/Vite5193/Chrome rồi đóng phần do mình tạo; fixture và inbox được giữ để đối chiếu.

Full E2E và browser chạy lần lượt. Full E2E dùng migrator cho các child DB có guard, không gọi cả lượt là app-role. Không stage ảnh/log/database Mailpit, `node_modules`, private profile hoặc API key. Receipt ACCEPTED chỉ chứng minh Mailpit/provider đã nhận HTTP, không thay chứng từ tiền hoặc trạng thái đơn.
