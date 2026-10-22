# Vá ranh giới upload ảnh — 21/10/2026

**Bản cập nhật sau #88:** nhận develop `d84381a`, giữ source/dependency của
`ef1e8a1` nguyên byte. Kiểm mới803unit/670E2E PASS,20TODO; lint/typecheck/build/
Prisma/diff PASS. [Báo cáo sau #88](pr90-post88-sync-2026-10-21.md).
Các số bên dưới là lịch sử của bản trước, không thay baseline mới.

## Phạm vi và nguyên nhân

Nền develop `fa85f6658ffd980902b4b61bce44c834c5e5913a`. Bản vá trên nhánh riêng,
chưa nhận là đã triển khai trên develop. Không đổi API, schema, Product lifecycle,
compensation, đường dẫn publish hay định dạng response.

Trước sửa, ảnh SVG bị từ chối cuối cùng nhưng đã đi qua Sharp metadata/stats.
Như vậy allowlist định dạng đặt sau bộ giải mã không bảo vệ ranh giới native.
Lockfile còn Sharp0.35.4 và Multer2.2.0 có advisory. Không thử payload gây RCE
hay crash trên ứng dụng dùng chung; điều kiện Sharp RCE nêu cho glibc Linux,
không suy ra đã chứng minh RCE trên Windows đang kiểm thử.

## Thay đổi

1. Kiểm chữ ký byte JPEG/PNG/WebP trước khi khởi tạo Sharp. Filename/MIME không
   đáng tin; prefix đúng vẫn phải qua metadata + stats để xác thực decode.
2. Format metadata phải khớp prefix và có kích thước trước stats. Giữ limit
   25triệu pixel,5MiB, staging/hash/publish/discard như cũ. Kiểm thêm độ dài
   buffer thật để caller nội bộ không vượt hạn mức bằng metadata size báo thấp.
3. Sharp0.35.5 với các native package/libvips tương ứng; scoped override chỉ
   Multer của `@nestjs/platform-express` sang2.4.0. Không nâng toàn bộ mù.
4. HTTP regression bắt lỗi tương thích Nest12: Multer2.4 đổi message
   `Unexpected file field`, khiến Nest mặc định trả500. Interceptor ngoài parser,
   chỉ tại route Seller upload, map **known MulterError codes** về400/413;
   không dựa message hoặc echo field/filename, giữ nguyên lỗi lạ và HttpException.

Không nhận chống mọi polyglot/virus: API cũ vẫn lưu byte gốc của raster hợp lệ,
không re-encode/quét mã độc. Rate limit upload, quota tổng và WebP của AI là
follow-up riêng; không tự thay contract FastAPI trong PR này.

## Kiểm thử và giới hạn bằng chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Regression trước sửa | 5FAIL/7PASS: unsupported file đã gọi metadata |
| Format boundary sau sửa | 17PASS: JPEG/PNG/WebP, SVG/GIF/PDF/HTML, prefix cụt, buffer rỗng, metadata giả không khớp,5MiB boundary, size báo thấp |
| HTTP parser cô lập | 6PASS: PNG, SVG giả JPEG, field sai/trùng, quá5MiB, multipart thiếu boundary rồi request hợp lệ |
| Mapping lỗi parser | 15PASS:11known400,413, giữ unknown/service/403 |
| Full Backend unit cuối | 789PASS/36files |
| Full Frontend regression | 721PASS/6liveSKIP,40filesPASS/1SKIP; FE source không đổi |
| BE lint/typecheck/build | PASS |
| FE build; Prisma validate; diff check | PASS; không đổi schema/migration |
| Full Backend E2E trước thêm interceptor | 670PASS/20TODO,183.85s |
| Full Backend E2E có interceptor, trước thêm check buffer.length | 670PASS/20TODO,185.77s |
| Full Backend E2E source cuối | 670PASS/20TODO,35filesPASS/1SKIP,177.28s |
| pnpm audit --prod | Còn6advisory:1critical/3high/2moderate; không còn Sharp/Multer |

HTTP parser dùng controller/configureApp/Multer/Sharp thật, auth và Product
persistence giả: **không** coi6ca này là kiểm chứng JWT/PostgreSQL. Full E2E dùng
PostgreSQL thật trên cluster QA riêng, không phải FastAPI/ES/FAISS live integration.

Lượt unit đầu bị sandbox Windows chặn rename cache (0test); chạy lại ngoài
sandbox được cấp quyền, không bỏ assertion. Một lượt typecheck bắt import type
trong test dùng namespace Sharp không hợp lệ; sửa sang named Metadata import,
rồi chạy lại unit/typecheck/build/lint đạt. Không tính lượt lỗi là PASS.

DB demo vẫn tắt. Checkout này không có root/BE `.env`; kiểm raw target localhost
literal127.0.0.1:5549/tên DB QA/role QA riêng trước chạy E2E, dùng cluster riêng,
SCRAM và không superuser. Không chạy root/develop E2E còn dotenv override.
#88 là dependency bảo vệ toàn repo đang chờ human review, không âm thầm ghép
code pending của #88 thành nền chính thức cho bản vá upload này.

## Review độc lập

Opus4.6Thinking từ CLI inventory hiện có, không hỗ trợ explicit effort flag.
Vòng đầu source-only không P1/P2 và đề xuất test bổ sung; đã thêm kiểm rỗng,
metadata mismatch và boundary. Vòng đó **chưa** có interceptor mới.
Vòng2 đọc full storage/interceptor/tests, không thấy P1/P2 có reproduction;
đề xuất check buffer.length đã áp dụng và có test. Vòng3 rà riêng delta đó,
kết luận không demonstrated P1/P2 regression; named Metadata import chỉ test.
Không nhận các phát biểu sai trong review: JS catch không bắt native segfault,
failOn:error không phải tùy chọn nghiêm nhất và26000x1 không vượt25M pixel.
Chỉ gửi source, không config/credentials/DB; không nhận model review là GitHub
human approval hoặc bằng chứng đã chạy test. Model không xem lock integrity/
auth/DB hay chứng minh an toàn multi-instance; bằng chứng runtime là các suite
do tác giả chạy ở bảng trên, không đánh tráo thành test do model chạy độc lập.

## Nguồn advisory

- [Sharp maintainer advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- [Multer malformed fields](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm)
- [Multer aborted stream](https://github.com/advisories/GHSA-qfvm-cv95-jqjf)
- [Multer array index](https://github.com/advisories/GHSA-3pph-fpjx-jg34)

Các6advisory còn lại không được đóng bằng PR này; một số đi qua Prisma tooling
optional, proxy-addr phụ thuộc cấu hình trust proxy. Không coi “không thấy cấu
hình khai thác” là hết advisory hoặc chứng nhận bảo mật toàn hệ thống.
