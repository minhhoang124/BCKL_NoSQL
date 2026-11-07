# UX01–03 — Argon Medium draft, Codex integration/review

Owner yêu cầu gọi Argon sửa ba lỗi UX đã quan sát và soạn tin cho Đạt về blocker cài sạch.

## Provenance

- Codex đã có draft ba source trước khi owner giao Argon; không quy tác giả draft ban đầu cho Argon.
- Lượt CLI accept-edits model `gemini-4-argon-medium`, effort medium, hết print timeout 240s, response rỗng, không có file thay đổi. Không tính đây là bàn giao thành công. Artifact riêng `machine-local/acceptance-20261031/argon-fix-1793427911297/`.
- Lượt offline model/effort như trên nhận snapshot source/test 19KB, chỉ trả code, không tools/secret/provider. Có phản hồi thực và JSON patch tại `argon-offline-1793428216578/patch.json`. Argon sửa helper chống auth-route loop/case/trailing slash/encoded route, bổ sung test helper/Login/PDP/Admin. Argon không tự chạy test.
- Codex kiểm từng target trong allowlist trước tích hợp, review helper/navigation/session guards, đổi test Chat sang route thực `/messages`, thêm kiểm không ghi giỏ từ guest và query encoded hợp lệ. Không thay Backend, schema hay Auth provider contract.

## Thay đổi

1. Login giữ pathname/search/hash nội bộ từ router state; fallback `/` với đích ngoài website, malformed, backslash/control, auth-loop. Không thay single-flight/session epoch/unmount guards.
2. Guest PDP link mang location hiện tại; sau password login quay lại sản phẩm, không tự thêm giỏ.
3. Chuông Admin dẫn `/account/notifications` khi flag bật; bị disable và có title khi flag tắt. Không tạo inbox giả.

## Bằng chứng hiện có

- Focused 4 files: 33 PASS trước bổ sung assertion cuối.
- Full FE trên source cuối: 1865 PASS, 6 SKIP; 111 files PASS/1 file SKIP. TypeScript và Vite build PASS; cảnh báo chunk >500KB vẫn còn.
- Logs riêng: `machine-local/acceptance-20261031/ux-regression-1793428372190/`.
- Driver browser siết UX03 phải tới đúng route và heading inbox, bật notification flags; không dùng thay đổi text bất kỳ làm oracle.
- Browser cuối `machine-local/acceptance-20261031/three-role-1793428754458/browser/report.json`: PASS 12 nhóm cùngOrder + 3UX, source-stable, 0pageerrors, 24ảnh. InboxAdmin đã tải dữ liệu thật (0 unread/empty), không chụp chỉ trạng thái loading. Gallery cuối ở root máy `BAO_CAO_CHOT_UX_2026-10-31/`.
- Giữ lượt lỗi trước: Docker tắt/PG đang recovery làm wrapper chưa chạy; lượt `three-role-1793428510150` qua12 nhóm nhưng dừng trước UX do reload rồi navigate khi refresh đang xoay cookie. Driver nay đợi refresh200 và link tài khoản trước điều hướng. Lượt kế `1793428642163` PASS, rồi siết thêm inbox-load oracle cho lượt cuối. Không sửa ứng dụng Auth để né lỗi; không coi đây là phép kiểm mọi kiểu hủy request/refresh.
- Báo cáo FAIL_UX và 54 ảnh ban đầu được giữ nguyên. Ảnh listing QA dùng fixture1x1, không chứng minh chất lượng ảnh catalog/online.

## Cài sạch / Git

Codex tái hiện frozen-lockfile theo phản hồi Đạt, sửa chỉ 3 dependency groups, kiểm snapshot HEAD+lock mới không node_modules: frozen install cả workspace, Prisma generate và FE build PASS; commit `03afb53` đã push candidate. Có dùng cache package, không gọi đây là tải mới toàn bộ. Owner chọn tự gửi tin; bản soạn ở root máy `machine-local/phan-hoi-dat-2026-10-31.md`, chưa gửi kênh ngoài.

Không merge PR, sửa CI/billing hoặc triển khai cloud. Quota/proof CI đúng commit vẫn là gate riêng.
