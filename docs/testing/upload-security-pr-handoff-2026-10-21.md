## Mục tiêu

Vá ranh giới ảnh native và phụ thuộc upload; không đổi Product lifecycle,
schema/migration hoặc contract Backend–AI. Đã nhận develop d84381a sau #88;
conflict chỉ kiến trúc, giữ nguyên source/dependency ef1e8a1 Hiền đã approve.
Đồng bộ làm head thay đổi, cần review delta và CI mới trước merge.

## Thay đổi và regression đã bắt

- Chặn định dạng ngoài JPEG/PNG/WebP bằng chữ ký byte trước Sharp; vẫn kiểm
  metadata/giải mã thật,25Mpixel/5MiB. Kiểm cả buffer.length khi size báo thấp.
- Nâng Sharp0.35.5, scoped override Multer2.4.0; pnpm why xác nhận chỉ1version
  của từng package. Không audit-fix-force hay nâng toàn bộ dependency.
- HTTP test bắt thêm Nest12 trả500 vì Multer đổi message Unexpected file field.
  Route-only outer interceptor map known MulterError codes về400/413, giữ lỗi
  lạ/HttpException, không echo tên field/file từ client.
- Không đổi staging/publish/hash/compensation và không tự chuyển Product state.

## Kiểm thử

-17 format-boundary +6 actual Nest/Multer HTTP +15 error-mapping cases =38PASS.
- Full Backend803unit PASS/37files,7.85s trên bản kết hợp sau #88.
- BE lint/typecheck/build/Prisma validate/diff-check PASS. FE không đổi, chưa
  chạy lại FE lần sync này;721FE/6liveSKIP ở report cũ là lịch sử.
- Full Backend E2E mới670PASS/20TODO,35filesPASS/1SKIP,188.42s.
- HTTP6ca fake auth/persistence, parser/controller/storage thật; không nhận là
  JWT/DB integration. Full E2E dùng PostgreSQL QA thật riêng, không full liveAI.
- Chỉ cluster QA loopback5549, role không superuser/credential riêng, demo vẫn
  tắt. Không đưa `.env`/secret/dump/log/allowlist vào diff hoặc prompt.

## Review và giới hạn

@Hiennq44 @dungdat nhờ review delta đúng head hiện tại trước merge; Hiền đã
approve ef1e8a1 trước sync, không lấy thay approval bản mới.
Opus4.6Thinking source-only3lượt trước không nêu P1/P2 tái lập được; không
coi là human approval hoặc độc lập chạy test. Đã lọc nhận định sai của model.

Prod audit vẫn còn6advisory không thuộc Sharp/Multer (1critical/3high/2moderate).
Không chứng nhận toàn hệ thống an toàn, không thử RCE/crash, không nhận Windows
có điều kiện RCE glibc Linux. Không re-encode/virus-scan/quota/rate-limit mới;
WebP tương thích AI là follow-up riêng, không tự đổi contract FastAPI.

PR#88 đã merge, fail-closed trước collection và không dotenv fallback. Không
đụng demo hoặc reset DB QA. Báo cáo bản mới:
`docs/testing/pr90-post88-sync-2026-10-21.md`; lịch sử red→green/source baseline
giữ ở `docs/testing/upload-security-hardening-2026-10-21.md`.
