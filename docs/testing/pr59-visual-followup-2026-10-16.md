# PR59 — hoàn thiện ba khoảng trống visual sau c444a95

**Bàn giao visual sau review Hiền:** [gói ảnh đã lọc](visual-evidence/pr59-v1/README.md)
chứa cặp source/implementation desktop và mobile Login, manifest SHA256.
Application vẫn ba3dcbf; chỉ đóng gói ảnh cũ, không tính là rerun test mới.
Không kèm tài khoản/địa chỉ rõ, cấu hình, cookie hoặc trace QA.

Ngày16/10, nền develop035656b; chỉ FE trình bày/test/harness/docs + artwork tĩnh.

- AuthLayout dùng WebP trang trí mới, không ảnh private hoặc dữ liệu đang bán.
- Buyer Order list thêm sidebar dùng user phiên hiện tại, 3 link đã có. Không
  thêm quyền Buyer cho Seller hoặc thay route guard/API. Seller không nhận sidebar Buyer.
- Detail: timeline từ history đã lưu ở đầu, address/payment hai cột, items/summary
  riêng. Giữ đầy đủ cancellation/reason/tracking/attempt, payment-null fallback,
  item snapshot, handler và điều kiện disabled. Không tạo mốc giao hàng giả.
- Thêm test artwork/links/semantic regions và assert browser asset/sidebar/regions.

Kết quả mới: 362 FE PASS,6liveSKIP; lint, TypeScript/Vite build, JS syntax và
diff-check PASS. Test đầu bị sandbox EPERM cache (chưa chạy case), chạy lại ngoài
sandbox mới là kết quả trên. Build test mới từng phát hiện option `exact` không
đúng type Testing Library, đã bỏ option dư và build lại PASS. Prettier không có
trong FE, đã dùng dependency BE để format; không thêm dependency/lockfile.

Chrome riêng → HTTP Nest → PostgreSQL5549 QA: Auth4/4, Order5/5 nhóm PASS;
desktop1440/mobile390, light/dark preference, load/error/retry/cursor/ownership/
account switch và các nút command disabled. Fixture QA tạo qua script; không
reset demo5432; bootstrap ghi dữ liệu QA, không được nhận zero-write toàn DB.
Baseline Order/history/commands/stock/outbox theo fixture không đổi ở màn đọc.
Không chạy lại Backend unit/E2E hoặc Checkout/live6suite trong đợt chỉ presentation.

Evidence local `deliverables/pr59-visual-followup-2026-10-16/` gồm auth/browser,
results.json/report.html và combined compare-login/order-list/order-detail.
`design-qa.md` ghi kích thước/density/state, ảnh focused/full-view và intentional
deviations; không nhận pixel-perfect khi mock khác dữ liệu/số dòng/API.
Ảnh Checkout reused lịch sử và không cộng kết quả mới. Không commit ảnh tài khoản
QA/screenshot/log hoặc secret; reviewer có thể tái lập bằng harness trên DB riêng.

Giới hạn: OS dark vẫn là storefront sáng; Chrome mobile là viewport giả lập;
account-switch browser có hard navigation, không thay unit SPA; không screen
reader/device thật/Firefox/Safari. Chưa bật giao dịch hoặc resolution. Giữ Draft
để Hiền review delta mới, không dùng approval/comment c444a95 thay head mới.
