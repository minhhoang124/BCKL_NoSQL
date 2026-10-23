# Hồ sơ/đổi mật khẩu — QA23/10/2026

Nhánh `codex/account-settings`, nền cuối `3872eae`; PR #108 giữ trạng thái tích
hợp, chưa bật mặc định. Phạm vi chỉ tên hiển thị + đổi password chủ động,
không full profile/P1.
API/biến/gate: [account-settings](../api/account-settings.md).

## Vòng đối kháng bổ sung và nền kết hợp

Ngày23/10 đã nhận develop `3872eae` sau merge toolkit #105, không conflict và
không đổi runtime Auth/FE đã kiểm. Thêm `account-settings-adversarial.e2e-spec.ts`
với4ca HTTP/PostgreSQL thật,4/4PASS, typecheck/lint/diffPASS:

1. Giữ User row lock trên connection riêng: password write hết lock timeout,
   trả503 sanitized; hash/version/refresh/audit bất biến, token cũ vẫn dùng được.
2. Uncommitted khóa account rồi gửi HTTP: guard và password snapshot thấy active
   cũ. Quan sát request thực sự đợi FOR UPDATE qua pg_stat_activity, commit khóa;
   service đọc lại và trả401, không đổi credential hoặc ghi audit.
3. Năm current-password sai trả400; lần6bị429 trước write, Retry-After1..60,
   không audit hoặc thay credentials. Quota vẫn chỉ bảo vệ một instance.
4. Profile/password qua2app cùng lúc: chỉ profile trước password commit được ghi;
   profile cũ sau thu hồi bị401, password tăng1version và có đúng1audit.

Không gọi4case là kiểm nhiều replica production. Full Backend trên head70f3509
đã đạt819E2E;20TODO và1SKIP vẫn giữ nguyên, không nhận là đã chạy.

## Review độc lập và sửa Login

Theo cho phép của Hoàng, Codex và Gemini thay nhau rà, không giả là approval của
Hiền. Gemini Argon Medium đọc2file Backend/audit tại70f3509: NO FINDING trong
phạm vi tĩnh. Lượt2 đọc AccountSettings/LoginPage phát hiện Login thiếu chốt đồng
bộ và kiểm phản hồi sau unmount. Test tái lập trước sửa:3FAIL/1PASS; trong đó ca
đổi phiên dùng mock transport để chứng minh phòng thủ component, không gọi là
vượt bảo vệ fetchApi thật (fetchApi đã có kiểm phiên).

Login nay chặn request trùng bằng ref trước await, abort khi unmount, timeout15s,
chỉ nhận phản hồi cùng lifecycle/controller/session. Không tự replay login.
4test mới giữ các ca bấm đôi, unmount, đổi phiên và retry chủ động sau lỗi.
Test401 của Settings đợi effect Login hoàn thành bằng waitFor, không kiểm quá sớm
ngay lúc DOM vừa hiện alert. Bộ tập trung28/28PASS sau sửa.
Driver Chrome thêm bấm đôi cả2lượt login và đếm đúng2request cho mỗi nhóm.

## Đã kiểm

- Frozen offline install:585package từ cache, không sửa lockfile.
- Backend full unit sau audit:1.165PASS/52file.
- Backend full E2E sau audit + đối kháng:819PASS/1SKIP/20TODO,48filePASS/2SKIP. Các TODO
  nền vẫn chưa chạy, không dùng PASS để nhận toàn bộ nghiệp vụ hoàn tất.
- Frontend full sau chốt Login:1.181PASS/6liveSKIP,61filePASS/1SKIP.
-18case tập trung Backend/API/Auth/upgrade sau audit:PASS. Có hai Nest app/pool,
  request thật, PostgreSQL QA riêng; không dùng mock HTTP thành công.
- Typecheck/Nest build/FE build/lint/Prisma validate/diff-check PASS; FE còn5warning
  Admin nền. Prisma migrate diff trên QA so với schema: No difference detected,
  exit0, gồm map unique/FK của bảng audit; trigger/constraint được kiểm SQL riêng.
- Fresh18migration trước audit và19migration trên DB mới v938 đạt; upgrade17→18→19
  giữ account/refresh dữ liệu cũ, cột mặc định1 và trigger audit bất biến đạt.

DB E2E: `bckl_order_resolution_test_attributes_20261019_v936`, upgrade đã thêm
audit bằng migration mới, không sửa checksum cũ. Browser v937 trước audit,
v938 mới cho bản đầy đủ. Docker QA bind127.0.0.1:5549; demo bị chặn nếu đang chạy.
Không copy.env, không reset/drop DB demo hay credentials vào Git/artifacts công khai.

## Invariant/ca rủi ro

- JWT User/Seller/Admin active, actor từ DB; từ chối body role/userId, no-store
  trên parser/guard/error; JSON8KiB, query/extra/type sai bị chặn.
- Name NFC, expectedFullName CAS, no-op không ghi; hai request cùng snapshot chỉ
  một winner, password/hash/role/Search không thay vì sửa tên.
- Wrong/same/over72UTF8byte password không đổi dữ liệu.
- Password→hash/version/revoke/audit atomic; bơm lỗi revoke và lỗi audit rollback
  đầy đủ, không audit giả/khóa phiên nửa chừng.
- Hai request password qua hai app chỉ tăng version1lần; refresh đua password
  không để lại token cũ hữu dụng; delayed-login session step từ hash cũ bị chặn.
- Legacy access thiếucv chỉ hợp lệ ở version1; malformedcv bị từ chối; version
  max trả409 không wrap; disabled account và default-off write gate bị chặn.
- FE StrictMode không POST khi mount; bấm đôi, stale account,400/401/409,
  unknown/malformed response, xác nhận không khớp, không lưu password vào storage.
- Chrome từng phát hiện thật lỗi route bảo vệ làm mất notice sau password200;
  đã sửa Login nhận notice rồi mới kết thúc đúng phiên. Bộ component dùng LoginPage
  thật để giữ regression cho lỗi này, không chỉ thay selector bài Chrome.

## Bằng chứng Chrome

Lượt cuối source sạch `f9807815e0d500f74cd44d7831666ba933415937`:
`artifacts/account-settings-browser-20261023/r1792749549179/`,4/4PASS,8PNG.
Mỗi nhóm đúng2POSTlogin cho2lượt bấm đôi,1PATCHprofile/1POSTpassword,
1audit và credentialVersion2; mobile-dark có mất response sau commit thật.
Kết quả nguồn/driver hash nằm trong results.json; không ghi token/password.
Gemini Argon Medium re-review đúngf980781, NO FINDING trong2fileUI; Backend/audit
không đổi byte so với review70f3509. Đây là review tĩnh tự động, không giả là
review của Hiền hoặc bằng chứng Gemini tự chạy Chrome/DB.
Hoàng đã cho phép Codex+Gemini review thay và merge khi gate an toàn đạt; ngoại
lệ CI payment/spending limit phải ghi rõ, không báo CI xanh hoặc dùng --admin.

Driver commit trong repo: `scripts/test-account-settings-browser.mjs`. Chỉ chạy
khi DATABASE_URL đúng QA v938, không có.env, cron tắt; cần Backend dist build mới,
Chrome, Playwright và dependency Node có sẵn. API3381, Vite5180 bindloopback;
Vite envDir=false, chỉ hai cờ QA bật. Mỗi case sinh account/password mới trong
memory; không ghi password/token vào kết quả/ảnh. Không dùng account thật.

Đã có4/4nhóm desktop/mobile × OSlight/dark đạt trên v937 trước audit;
mobile-dark cắt phản hồi sau POST Backend200 thật rồi reload: không gửi lại,
password mới đăng nhập được, cũ401, phiên cũ401. Bản v938 có audit đạt4/4nhóm,
chỉ1audit/user/toVersion2 và1POSTpassword dù bấm đôi. Artifact cuối trước commit
audit: `artifacts/account-settings-browser-20261023/r1792747135418/`, gồm8PNG và
results.json. Driver/source hash được giữ trong kết quả; lượt đó là candidate
working tree sau6bd94ea, không giả là head6bd không có audit đã được kiểm.
OSdark vẫn storefront cam/sáng hiện hành, không nhận thiết kế theme tối mới.
Ảnh mobile profile và reauthentication sau audit đã được xem, không tràn ngang.

Lượt trước audit `artifacts/account-settings-browser-20261023/run1` FAIL notice;
các lượt đạt sau sửa được giữ riêng, không ghi đè. Lần chuẩn bị DB đầu bị PG
chưa sẵn sàng; xác minh chỉ đọc rồi chạy lại, không giảm guard. Lượt testFE đầu
bị quyền temp sandbox; chạy lại ngoài sandbox. Upgrade fixture từng trùng ID
sequence, sửa fixture explicit ID2; không sửa migration để né lỗi.

## Giới hạn và reviewer

Gemini Argon Medium đã đọc đúng2service tại `6bd94ea`, NO FINDING trong phạm vi
login/refresh/password locks/rollback/leak; không đọc guard/schema/UI và chưa gồm
audit bổ sung sau đó. Không coi đây là approval GitHub hoặc review toàn PR.
Nhờ Hiền review nghiệp vụ/schema/Auth/rollout; Đạt không phải dependency của
task này vì không thay Product/Search payload hoặc thực nghiệm7query/602cặp.

Chưa kiểm nhiều replica/load, cookie CSRF production, email/phone/avatar,
password reset hoặc rollback về binary cũ. Request đã qua guard trước password
change có thể hoàn tất; không coi đổi mật khẩu là thu hồi giao dịch đã commit.
Code/harness QA giữ DB, audit/fences và schema thử để đối chiếu, không xóa dữ liệu.
