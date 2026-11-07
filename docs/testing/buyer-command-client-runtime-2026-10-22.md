# Buyer command client — promotion và kiểm thử 22/10/2026

## Nền và phạm vi

Branch `codex/buyer-command-client-runtime` từ develop
`e394c9eb3c13c8f96bfe40f5be97d5efb97d192e`, không nhận #94 pending.
Tái sử dụng checkout sạch #84 đã merge (`buyer-resolution-adapter`), branch mới;
ref #84 và candidate `buyer-recovery-combined-20261022` giữ nguyên.

Promote đúng delta từ tree `e490b7f1f006019321288193e99b6d0a26f6462f`:
journal settlement/execution factory, coordinator, execute adapter, tests và
opt-in live QA harness. Không copy cả candidate cũ. Composition test được đổi
tên từ file `.review.test.ts` local thành regression `.test.ts`; không nhận đó
là một reviewer độc lập mới. Resolver adapter chỉ sửa mô tả, logic #84 giữ nguyên.

Không đổi BE/src, Prisma, Auth/shared API client, validators đã merge, router,
pages/CSS, Buyer consent component, Seller command, lockfile hoặc AI source.
BE thay đổi chỉ test host và config opt-in, không endpoint/migration mới.

## Kết quả thực thi trên branch mới

| Kiểm | Kết quả |
| --- | --- |
| Dependency frozen/ignore-scripts/prefer-offline | PASS, supply-chain policy bật, lockfile không đổi |
| Fresh QA database |17migrations PASS, DB mới v909, không reset DB cũ |
| Buyer subset |181PASS/5files,1.13s; gồm49execute +41recovery +7composition +53journal +31adapter |
| Full Frontend |1036PASS/6liveSKIP,53filesPASS/1SKIP,53.35s |
| Frontend lint/typecheck/build |PASS,5warning set-state-in-effect Admin nền; Vite432modules |
| Client→NestHTTP→PostgreSQL thật |15scenario PASS; host1PASS/8.69s, không cộng thành16scenario |
| Backend typecheck/lint/build/Prisma |PASS |
| Full Backend unit |1034PASS/47files,7.89s |
| Backend cancel/complete/resolver E2E |108PASS/3files,64.21s; không cộng host hoặc live scenario vào108 |

Không chạy lại toàn Backend E2E hoặc AI Ruff/Pytest trong PR này; BE production/
schema và AI source không đổi. Các log ERROR do bơm lỗi kiểm rollback là có chủ
đích, assertion/exit cuối đạt; warning pg query-in-flight/vite-tsconfig-paths giữ
nguyên. Không dùng108selected thay kết quả full Backend hoặc nhận CI xanh.

Subset/lượt lặp không cộng vào tổng. Unit/mock fetch/WebCrypto thật không phải
browser hay DB integration. 6liveSKIP vẫn NOT_RUN; không gọi đã nghiệm thu UI.
Full FE1020/15live ở candidate cũ là lịch sử, không thay số mới trên nền UI cam.

## Ma trận live — không mock HTTP giữa client và Backend

Host tạo15Order bằng Checkout HTTP thật, hai Variant cùng Product; complete
fixture qua Seller confirm→packing→ready và Admin ship→delivered thật. Catalog
approval/ảnh metadata/JWT là fixture QA có nhãn, không browser login/upload.
FE modules chạy Node process riêng, gọi API qua proxy loopback tạm. Storage ở
Map test có nhãn, không phải sessionStorage của Chrome.

| Nhóm | Scenario / oracle |
| --- | --- |
| Recovery mất execute |cancel và complete đã commit nhưng response bị ngắt → remount/resolve nhận receipt gốc |
| Recovery mất resolve |fence đã commit, response bị ngắt → explicit retry original key, cùng fence |
| Recovery chưa execute |complete CLOSED giữ nguyên Order/Payment/kho/history, không giả command receipt |
| Recovery boundary |đổi account khi response bị giữ; timeout; double-click; GET lỗi sau known outcome chỉ GET lại |
| Runtime execute |cancel success; complete success sau giao; double-click chỉ một mutation POST |
| Runtime unknown |execute commit nhưng mất response/timeout → giữ key, chặn execute lại, explicit resolve |
| Runtime GET/session |success rồi GET lỗi chỉ GET lại; đổi account không xóa pending chủ cũ, chủ cũ resolve |

Đủ15case mới có exit0/count15; host còn đối chiếu DB từng Order: cancel hoàn
hai dòng một lần, Product tăng đúng1version/1outbox, đúng1BUYER command/history;
complete không thêm kho/outbox; CLOSED chỉ thêm fence. Replay không duplicate
logical mutation. Không xóa immutable receipt/history để dọn test.

Fault proxy chủ động drop/hold response thật sau khi Backend trả200; timeout
dùng AbortSignal fault injection. Unit kiểm finite30s bằng fake clock, không
nhận đã đo socket stall30s trên trình duyệt. Không chạy ES/FAISS/worker nền;
outbox oracle không chứng minh index đã sync hoặc full Search hoạt động.

## Cách chạy và an toàn

Từ FE: `pnpm test`, `pnpm lint`, `pnpm build`; chọn subset bằng Vitest và đúng
tên file trên. Từ BE với QA target hợp lệ: `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm test` và chọn các E2E Buyer hiện có.

Live harness opt-in: từ BE chạy
`pnpm exec vitest run --config vitest.config.buyer-live.ts`. Config thường không
collect các file `.qa.ts`. Reviewer tự tạo DB QA riêng đúng guard trong
`test/helpers/runtime-qa-target.ts` và `order-resolution-qa-target.ts`: loopback
5549, tên `bckl_order_resolution_test_*`, role hạn chế; kiểm target trước áp
17migration lên DB mới. JWT access/refresh secret QA tự sinh và truyền riêng;
không dùng credential demo, không sửa guard hoặc dựa .env service làm target.

Lượt tác giả dùng launcher local allowlist/private profile, no root/BE.env,
DB `bckl_order_resolution_test_buyer_client_20261022_v909` mới trên cluster
`bckl-safe-qa-20261021`, chỉ127.0.0.1:5549. Demo phải dừng trước khi launcher
khởi động QA. Không đọc/in cấu hình private qua tool output; host redacts tokens/
DB URL từ child output. Fixture được giữ; không reset/drop/purge DB/demo.
Launcher/private profile không commit và không gửi như cấu hình portable.

## Ranh giới nghiệm thu

Chưa route/nút Buyer, browser desktop/mobile/theme/reload/đổi tài khoản bằng UI,
cross-device hay nhiều tab. Không đổi contract Backend #69/#74 hoặc sửa policy
đơn hàng. Sau review/merge module mới nối UI bằng PR riêng và chạy browser QA.
Approval #75/#84 không thay review coordinator/settlement/execute mới. CI billing
không được gọi là CI xanh; ngoại lệ không miễn blocker code/test/review.
Issue Order409/409 lịch sử vẫn giữ trạng thái điều tra, không đóng bằng rerun xanh.
