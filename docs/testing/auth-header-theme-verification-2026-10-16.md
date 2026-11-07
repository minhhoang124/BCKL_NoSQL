# Header/Auth dưới dark preference — 16/10/2026

> Bằng chứng lịch sử của bản sửa contrast trước khi người dùng yêu cầu đồng bộ
> mẫu cam. Đợt mới thay xanh bằng cam, thêm Inter/AuthLayout và chỉnh Checkout/
> Order panel; xem [bộ UI mới](../architecture/orange-ui-foundations.md) cùng
> `design-qa.md`. Những dòng “không đổi JSX/lockfile” dưới đây chỉ áp dụng commit
> cũ 0ef505e, không mô tả phần thay đổi mới đang chưa commit.

Source commit `0ef505e`, base develop09daae0; branch `codex/auth-header-theme-fix`.
PR riêng, không lấy mã #56/#57 chưa merge. Không đổi JSX, AuthProvider, API client,
route, Backend/schema/migration/AI hoặc lockfile. Phạm vi CSS Header/AuthForm;
Register dùng chung stylesheet nên cũng được kiểm.

## Root cause và bản sửa

Header/form giữ nền trắng nhưng kế thừa color-scheme:light dark từ root. Global
h1 ở dark preference gần trắng, native input tối, label/placeholder nhạt làm mất
tương phản. Giữ thiết kế bề mặt sáng: đặt color-scheme:light tại Header/card;
foreground#20242b, input trắng, heading explicit, placeholder#596170 opacity1.
Nút xanh#0069c2, link/focus#005fae; cặp chữ/nền chính kiểm contrast>=4.5:1.
Card dùng box-sizing:border-box/width min(100%,400px) để không cộng padding quá
bề rộng mobile. Không bật/tắt theme toàn trang hay đổi luồng đăng nhập.

## Bằng chứng thực chạy

| Kiểm tra | Kết quả |
|---|---|
| Frozen install offline | PASS, lockfile không đổi |
| FE Vitest | 286 PASS,4liveSKIP;23filesPASS,1SKIP;12CSS cases mới |
| FE lint / TypeScript+Vite build | PASS |
| Backend build phục vụ browser QA | PASS, Backend source không đổi |
| node --check harness / diff-check | PASS |
| Chrome desktop1440×1080 light/dark | 2/2PASS |
| Chrome mobile390×844 light/dark | 2/2PASS |
| Screen reader/device thật/Firefox/Safari | NOT_RUN |

Chrome riêng headless → Vite5188 → Nest HTTP thật → Postgres QA5549
`bckl_checkout_web_20261012`. Không DB demo5432. Đăng ký/đăng nhập/đăng xuất bằng
UI, cookie thật; không inject AuthContext/token. Mỗi cấu hình: Login sạch → lỗi
credentials thật → Register điền form/select → đăng ký USER thành công → Header
authenticated → logout → login lại. Scope này không kiểm Seller onboarding.
4/4nhómPASS, không pageerror; documentWidth<=viewport. Kiểm computed colors:
heading/text rgb(32,36,43), bề mặt/input trắng, placeholder rgb(89,97,112), native
scheme light; Tab/focus có outline. Không suy rằng toàn site đạt WCAG từ số này.

16ảnh/JSON/gallery lượt source cuối giữ local:
`C:/VoMinhHoang/KLCN_2026/deliverables/auth-header-theme-qa-2026-10-16/run2/`.
Đã mở ảnh saved kiểm Login/error mobile dark, Register dark, Header authenticated
và Login desktop light. Header authenticated chụp đúng Header, không dùng trang
Home đang tải để báo Home đã nghiệm thu. Fixture user/session giữ QA để đối chiếu;
server/Vite/Chrome được đóng trong finally. Không có password/token raw trong ảnh.

Harness: `scripts/test-auth-header-browser.mjs`, cần DATABASE_URL đúng QA namespace,
JWT QA riêng, QA_HEAD và `--playwright-module <path/index.mjs> --output <folder>`.
Không tải schema/code remote, không tự dùng profile Chrome cá nhân.

## Giới hạn / lịch sử

Lượt đầu build phát hiện test TypeScript dùng node:fs ngoài types FE; chuyển CSS
regression sang .test.js theo pattern repo rồi toàn test/build đạt. Không sửa
tsconfig để che lỗi. Lượt run1 ảnh source chưa commit chỉ là lịch sử; run2 là
commit0ef505e. Có pg deprecation warning cũ; không nâng dependency trong task này.
Home hero/label vẫn có contrast risk riêng ở dark, không sửa Home hoặc nhận cả
giao diện đã hoàn tất. Browser tích hợp lỗi; dùng Chrome riêng theo quyền user.

Suite C2 Backend54PASS chạy trên DB mới riêng, báo cáo ở PR thiết kế #58;
không lấy kết quả đó làm bằng chứng đăng nhập hoặc CSS, không trộn contract mới.
