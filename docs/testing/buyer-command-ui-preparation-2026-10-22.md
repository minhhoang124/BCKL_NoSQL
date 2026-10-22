# Kiểm thử Buyer command UI preparation — 22/10/2026

Nền develop `e394c9e`; không ghép #94/#95 chưa merge. Thay đổi chỉ component
`BuyerCommandReview`, CSS/test và tài liệu. Không route/nút Web hoặc HTTP mới.

## Kết quả

- Frozen install/ignore-scripts: PASS, 585 dependency theo lockfile, không đổi lockfile.
- `BuyerCommandReview.test.tsx` + `BuyerRecoveryConsent.test.tsx`: 70 PASS,
  2 file, 24.09s (lần đầu sau cài dependency); không cộng subset vào full.
- FE lint: PASS, 0 error; 5 warning set-state-in-effect Admin nền.
- FE TypeScript (`tsc -b`) và Vite build: PASS, 432 module production, không
  bundle component mới vì chưa mount/import runtime.
- Full FE: 992 PASS/6 live SKIP, 51 file PASS/1 SKIP (52), 95.66s.
  53 test mới của view; không cộng subset70 vào full992.
- Working/staged/full-range diff-check: PASS, không thay test nghiệp vụ hoặc
  kiểm nghiệm độc lập của reviewer.

## Ca đã kiểm ở mức component/jsdom

Default disconnected/callback thiếu không gửi; separate consent, reason trim/
bounds500UTF16 và thay code/text mất consent; snapshot frozen; double click
chỉ một callback; Enter trong textarea không submit; dismiss trước gửi không
mutation; sau gửi callback resolve không giả thành công và lỗi vẫn khóa.

Cancel sai Order status/COD/payment/amount/paidAt/null, pending present/blocked,
fresh=false đều khóa. Complete body{} và PAID/date đúng; trạng thái thanh toán
hoặc timestamp sai khóa. Identity/read/total/status/updatedAt/command đổi xóa
draft/consent; role/inactive/session/ID/money sai không lộ orderNumber.

Session đổi không rerender vẫn chặn callback; callback lỗi sau unmount không
ghi vào tài khoản mới. Known-outcome GET lỗi chỉ callback GET, chống double
click, không gọi onConfirm; GET error không hiển thị raw exception.

Composition với BuyerRecoveryConsent hiện có: unmount/remount giả reload dùng
metadata fixture không tự gọi execute/resolve, không lấy lại reason cũ hoặc lộ
key/hash. Đây không phải actual reload/storage/proof settlement integration.

## Không chạy / không nhận nghiệm thu

Không DB/container/seed/migration; không đọc .env/private profile. Không BE
unit/E2E hoặc AI tests vì không sửa source tương ứng. Không live API, browser
desktop/mobile/light/dark, hai tab/thiết bị hoặc Order Web đầy đủ. Bản #95 có
live QA riêng nhưng không thay các mục NOT_RUN ở nhánh này.

## Tái lập và bước tiếp

Từ checkout: `pnpm install --frozen-lockfile --ignore-scripts --prefer-offline`,
`pnpm --dir FE exec vitest run src/features/order-recovery/BuyerCommandReview.test.tsx src/features/order-recovery/BuyerRecoveryConsent.test.tsx`,
`pnpm --dir FE exec vitest run --pool=threads --maxWorkers=1`, FE lint/build.
Không cần database để chạy những kiểm tra này.

Review component hiện tại độc lập; không lấy approval #95 thay approval UI.
Chỉ sau runtime #95 merge mới nối parent, proof/settlement và route trên PR
riêng theo [hướng dẫn](../architecture/buyer-command-ui-preparation.md), rồi
kiểm browser trên Backend/PostgreSQL QA. Không bật Buyer giao dịch từ module này.
