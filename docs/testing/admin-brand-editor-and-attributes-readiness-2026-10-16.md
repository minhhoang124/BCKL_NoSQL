# Admin Catalog bổ sung — Brand editor và readiness thuộc tính, 16/10/2026

**IN_PROGRESS — source `6aabf98`, base develop `035656b`.** Module FE đã QA chọn lọc qua browser → Backend thật → PostgreSQL riêng. Chưa tích hợp vào router/menu #28, chưa nghiệm thu toàn bộ Admin/Search.

## Baseline / phạm vi

Nhánh `feat/hien/admin-brand-editor` từ develop `035656b`. Không nhập Admin #28, Accounts hoặc Dashboard preview chưa merge; không sửa router/menu, AuthProvider/apiClient, CSS global, Address/Cart/Checkout/Order, Backend/schema/migration hoặc contract Search. Component/CSS, adapter và tests nằm riêng trong `FE/src/features/admin-brands`.

Căn cứ: phân công Hiền giai đoạn 3; SRS FR-ADM-01; thiết kế miền Product mục 3.1/6/8; code `BE/src/catalog/admin-catalog.controller.ts`, `catalog.service.ts`, `UpdateBrandDto`/DTO attribute và test Store/Catalog/Search hydrate đã merge. Endpoint dự kiến trong tài liệu không tự được nhận là API hiện có.

## Phần đủ contract và đã code

- `GET /admin/brands` dành cho ADMIN trả cả Brand bật và tắt, không phân trang theo code baseline. Không lấy `/brands` public thay danh sách Admin.
- `PATCH /admin/brands/:brandId` nhận các trường hiện có name/slug/isActive; **module mới chỉ cho sửa name/slug**, chỉ gửi trường thực sự đổi, không gửi isActive hoặc thêm version/reason chưa có trong DTO.
- Tên trim dài 2–120; slug trim ở form, dài 2–140 và mẫu chữ thường/số/ngăn bởi gạch nối. Không tự đổi slug khi sửa tên. Chưa có thay đổi thì không gửi PATCH.
- Màn đọc dữ liệu, chọn Brand, giữ form khi lỗi validation/slug trùng, xem lại và xác nhận trước khi gửi, khóa bấm nhanh, không đổi trạng thái lạc quan trước phản hồi.
- Tải lại danh sách không tự xóa bản nháp; lỗi GET rồi tải lại thành công vẫn giữ tên/slug đang sửa. Khi kết quả write chưa rõ, GET thành công không mở khóa ghi hoặc xóa draft.
- Adapter dùng shared `fetchApi`, fixed path, AbortSignal/timeout 15s, kiểm shape/ID/nội dung xác nhận và reconciliation metadata. PATCH đặt `retryOnUnauthorized: false`, không tự refresh/replay request ghi; GET dùng chính sách shared client hiện hành.
- Sau phản hồi xác nhận, đóng form trước GET reload. GET lỗi giữ thông báo **đã lưu** và lỗi **không tải được danh sách**, không mời gửi lại write.
- Mất mạng/timeout/5xx/phản hồi 2xx sai cấu trúc hoặc identity là **chưa rõ kết quả**: khóa ghi trong phiên màn hình, không auto retry. GET được phép đối chiếu nhưng không tự mở khóa ghi vì request cũ có thể chưa kết thúc.
- Chặn UI cho guest/USER/SELLER/Admin inactive; dữ liệu/draft remount theo user ID và auth-session generation, response cũ không cập nhật phiên mới. Backend vẫn là lớp phân quyền chính.
- Reconciliation job chỉ là công việc Backend ghi nhận, không báo index ES/FAISS đã hoàn tất. Đổi tên/isActive tạo job theo service; slug-only có thể trả null.

### Giới hạn an toàn

Brand hiện không có expectedVersion/If-Match hoặc idempotency receipt cho PATCH. Không nhận đã giải quyết ghi đè hai Admin hoặc retry an toàn xuyên reload. Lock chưa rõ kết quả chỉ sống trong instance màn hình; đóng/reload/đổi phiên không chứng minh request server đã rollback. Cần người có thẩm quyền đối chiếu Backend trước khi quyết định ghi tiếp, không tự bật retry.

Chưa chứng minh audit toàn bộ Catalog, tác động listing có Product tham chiếu hoặc Search runtime. Không tự thêm contract/schema để lấp khoảng trống.

## Thuộc tính Category — vì sao chưa triển khai quản lý đầy đủ?

| API / trường | Baseline thực tế | Khoảng trống |
| --- | --- | --- |
| GET `/admin/categories` | Chỉ metadata Category, không kèm attributeDefinitions | Không dùng để đọc mọi thuộc tính |
| GET `/categories/:categoryId/attributes` | Public path; chỉ Category/tổ tiên active, definition/option active | Không xem/mở lại definition đã tắt, không quản lý Category inactive hoặc option inactive |
| POST Admin attributes | Có name/slug/dataType/isRequired/isFilterable/allowsCustom/sortOrder | Tạo được riêng lẻ nhưng không thay quản lý/list/recovery đầy đủ |
| PATCH Admin attribute | Có name/dataType/isRequired/isActive/allowsCustom | Không có slug/isFilterable/sortOrder trong Update DTO; không tự gửi các trường đó |
| POST/PATCH attribute options trong thiết kế | Chưa có controller runtime tương ứng | Không tự tạo endpoint giả hoặc dùng Product option thay CategoryAttributeOption |

Hoàng đã nhận contract/API Admin thuộc tính/lựa chọn trên PR riêng: đọc cả bản ghi đã tắt, quản lý option và rà PATCH slug/isFilterable/sortOrder; chặn đổi kiểu khi Product đã dùng, kiểm tác động khi bắt buộc/tắt option và giữ dữ liệu lịch sử/Search transaction. Đây là phân công/hướng contract, không khẳng định API mới đã merge. Hiền review contract rồi nối UI sau merge; không triển khai Backend này trong PR Brand. Không bypass bằng SQL từ FE hoặc dùng public response để tự suy mọi definition đang active.

## Preview và kiểm thử

`/admin-brand-editor-preview.html` chỉ là entry development riêng, có nhãn mọi actor/Brand/job/kết quả là minh họa. API injected trong preview chỉ thay mẫu trong memory; không HTTP/DB, không credential hoặc token thật. Các mode normal/409/reload-error/unknown để xem cùng state machine, không thay chứng cứ Backend. Không thêm entry vào production build hoặc app router.

Component mặc định dùng adapter API thật **khi được tích hợp dưới AuthProvider**; hiện chưa có route/menu/điểm nối #28. Hoàng cần review điểm tích hợp, giữ phần tạo/bật-tắt Brand và Category đã có. Không dùng dev actor giả để xác nhận RBAC.

| Kiểm tra local cuối 16/10 | Kết quả |
| --- | --- |
| Cài FE dependency offline/frozen lockfile | PASS, không đổi lockfile |
| Test adapter + component mới | 31 PASS / 2 files (gồm giữ draft sau GET lỗi/retry và unknown + GET) |
| `pnpm --dir FE exec vitest run --maxWorkers=1` | 377 PASS / 6 SKIP; 27 files PASS / 1 suite SKIP |
| `pnpm --dir FE lint` | PASS; hai warning mới ở preview/cleanup đã sửa, không tắt rule |
| `pnpm --dir FE build` | PASS TypeScript/Vite; dist mặc định không chứa preview/module chưa nối |
| Browser preview desktop 1280×900 | Lưu tên mẫu → reload đúng mẫu, giữ slug/status; job không được nhận là index đã đồng bộ; không tràn ngang |
| Browser preview mất response | UI khóa ghi; GET thấy mẫu đã đổi nhưng vẫn khóa, không gửi PATCH tiếp |
| Browser mobile 360×800 / 390×844 | Không tràn ngang; unknown và saved/reload-error tách đúng thông báo; chưa thiết bị cảm ứng thật |
| Màu | Dark preference thực tế true; module riêng giữ nền/chữ sáng-tối đọc được, không đổi theme toàn ứng dụng |

Test thêm validation/không thay đổi/409, pending double-click, malformed list/response, no active toggle, sai role và chuyển Admin/phiên đăng nhập cùng ID. CSS/preview không thay toàn bộ keyboard/WCAG hoặc bằng chứng quyền server.

## QA Backend/PostgreSQL thật bổ sung

Hiền cho phép QA local trên database riêng, không reset database. Một Brand fixture mới `id=9` (`QA Brand Editor 16-10`, slug `qa-brand-editor-4022c4d8`) không gắn Product được tạo qua API trước lấy baseline. Browser dùng **AuthProvider, LoginPage, shared apiClient và brandApi thật**, không actor injected. Cổng development dùng gateway loopback chuyển request vào Backend QA; chỉ log method/path/status Catalog, không headers/cookie/credential. Trang này không nối route/menu production.

| Ca kiểm trên source `6aabf98` | Bằng chứng / kết quả |
| --- | --- |
| Đọc Brand bật/tắt | Browser GET thật hiển thị 5 Brand, gồm một Brand đã tắt; không có nút đổi active trong editor |
| Xem lại / quay lại sửa | Chưa gửi PATCH trước xác nhận; quay lại giữ tên vừa nhập |
| Slug trùng | HTTP PATCH trả 409; UI giữ tên `QA Brand Editor Renamed 16-10` và slug trùng, không báo đã lưu |
| Sửa riêng tên | PATCH 200; DB chỉ Brand 9 đổi tên, slug/isActive giữ nguyên. UI báo job 22 PENDING, chưa nhận index đã đồng bộ |
| Sửa riêng slug | PATCH 200; DB giữ tên/isActive, slug thành `qa-brand-editor-4022c4d8-updated`; số reconciliation jobs giữ 22, response không có job |
| Mất phản hồi sau commit | Gateway QA chủ động cắt **một response PATCH 200** sau Backend xử lý; UI báo chưa rõ, giữ draft và khóa ghi. GET sau đó thấy tên `QA Brand Editor Lost Response 16-10` nhưng vẫn khóa ghi |
| Đối chiếu cuối | DB Brand 9 đúng tên/slug mới, isActive true; bốn Brand cũ không đổi. Jobs 21 → 22 → 22 → 23, đúng hai lần đổi tên. Products 60, Categories 8, Stores 10, Orders/stock movements 0, Search outbox 24 giữ nguyên |
| Không tự replay write | Trace gateway có đúng 4 PATCH Brand 9: một 409 và ba 200. Sau response bị cắt chỉ GET, không thêm PATCH; ảnh trạng thái khóa lưu local |

Ảnh/snapshot/trace gốc giữ local, không commit artifact runtime. Bằng chứng browser này không phải test competing Admin, Product tham chiếu, Search worker/index hoặc audit đầy đủ. CA pending double-click/GET lỗi/reload-error và auth-session isolation vẫn là test tự động/preview, không gọi là browser live PASS. Lượt đặt viewport mới chưa xác nhận được kích thước 390 trong DOM nên không báo mobile Backend PASS; các ảnh mobile preview ở mục trên giữ phạm vi mock riêng.

### Cách reviewer chạy

1. Cấu hình `VITE_API_URL` tới Backend QA **riêng**, có tài khoản Admin active và Brand fixture; không dùng database demo/production. Không commit cấu hình/credential.
2. Chạy FE development và mở `/admin-brand-editor-qa.html`: đăng nhập thật; trang có nhãn ghi vào DB. Nếu dùng proxy local cần giữ cookie path và CORS đúng môi trường, không tắt bảo vệ Auth.
3. Chọn fixture, sửa name/slug, xem lại, hủy/xác nhận; thử slug trùng và đối chiếu DB. Không thử mất response trên dữ liệu thật; harness fault injection chỉ giữ local.
4. `/admin-brand-editor-preview.html` là mock riêng để xem state, không dùng kết quả mock làm Backend PASS. Production build mặc định không chứa hai entry QA/preview hoặc module chưa tích hợp.

NOT_RUN: Search index thật, cạnh tranh hai Admin, audit đầy đủ, replay/lock bền vững xuyên reload, mobile Backend và QA accessibility toàn diện. PR riêng để Hoàng review module/điểm tích hợp trước nối Admin; không merge hoặc nhận G-ADMIN DONE.
