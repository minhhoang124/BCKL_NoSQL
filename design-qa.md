# Orange UI alignment — design QA 16/10/2026

final result: passed

## Lượt hoàn thiện Login/Order sau review c444a95

Phạm vi kết luận: trình bày ba phần đã yêu cầu, không phải clone pixel1:1 hoặc
nghiệm thu giao dịch. Đã bổ sung minh họa Login tĩnh sinh riêng; sidebar Buyer có
3 route thật; detail tách địa chỉ/thanh toán/sản phẩm, lịch sử thật ở đầu trang.
Không thêm mốc timeline chưa xảy ra, ảnh item/Google/chat hoặc nút giao dịch giả.
Những đoạn blocked/OPEN bên dưới là lịch sử trước follow-up, được thay bởi mục này.

Source: `C:/VoMinhHoang/KLCN_2026/deliverables/ui-orange-v1/previews/`
16-login/05-orders/06-order-detail.png, 1440×1080.
Capture: `C:/VoMinhHoang/KLCN_2026/deliverables/pr59-visual-followup-2026-10-16/`:
auth/desktop-light-01-login.png, browser/desktop-light-01-buyer-list.png,
browser/desktop-light-04-buyer-detail.png và mobile-dark tương ứng.
Viewport desktop1440×1080/mobile390×844, DPR1. Ảnh full-page cao theo dữ liệu thật.
State: Login chưa nhập; Order PENDING_CONFIRMATION lấy API QA thật. Mẫu có2đơn
và ảnh item, runtime20summary/cursor: không dùng pixel-diff để suy độ giống dữ liệu.

Đã mở so sánh chung compare-login/compare-order-list/compare-order-detail.png.
Ảnh cắt vùng list-focus/detail-focus so cùng vùng x0,y128,w1440,h900, mỗi bên thu
720×450; mở ảnh gốc desktop/mobile riêng để đọc nhãn và đánh giá font/spacing.
Lượt đầu phát hiện nút reload mất style sau bọc content; đã sửa selector, chạy lại
Chrome và chụp lại trước so sánh cuối. Timeline ở dưới hàng hóa đã được chuyển
lên đầu, các event chỉ lấy history đã lưu; danh sách thống nhất một surface trắng.

### Năm bề mặt đối chiếu

- Typography: Inter local, heading28/30, body16/label14; email/mã UUID dài wrap,
  không cắt mã quan trọng. Tiếng Việt hiển thị đúng trên desktop/mobile.
- Spacing: sidebar226/gap36; detail hai cột/gap24; items/summary riêng; <=900px
  xếp một cột. Form mobile ở trước minh họa, không tràn ngang/che nút chính.
- Color: camD63B0B, peachFFF2EC, nềnF6F7F8, chữ20242B, surface trắng; giữ
  storefront sáng ở cả OS preferences, không tuyên bố theme tối riêng.
- Imagery: WebP1000×667 sinh mới31.8KB, trang trí alt rỗng; không ảnh ABO/private,
  không dùng CSS/SVG dựng sản phẩm. Subject/headset khác mẫu là asset thay thế
  có chủ đích, không đại diện listing thật. Xem provenance trong docs/architecture.
- Content: sidebar chỉ3màn đã có; không đưa link thông báo/bảo mật/chat chưa làm.
  List không bịa tên/ảnh item từ summary; timeline chỉ sự kiện thực, không tô
  xanh các bước chưa xảy ra. Google/reset-password và phí giả trong mock bị bỏ.

Không còn P0/P1/P2 trong ba hạng mục sửa; khác nội dung/độ dài/mốc timeline là
giới hạn dữ liệu và hành vi đã công bố, không nhận clone1:1 toàn bộ mock.
P3: có thể tinh chỉnh các tab lọc thay dropdown và nhãn payment/actor Việt hóa
ở đợt UX riêng có test. Không đổi code/hash/contract nghiệp vụ để giống ảnh.

### Kiểm thử và giới hạn

362 FE PASS /6 live SKIP; lint/build PASS. Ba test mới kiểm artwork/sidebar/
section detail và giữ command disabled. Auth Chrome4/4, Order Chrome5/5 PASS
trên HTTP Nest + PostgreSQL QA5549; không pageerror/tràn panel, kiểm focus,
asset loaded, sidebar, snapshot/cursor/error/retry/account switch.
Không chạy lại Checkout browser/live6suite vì logic không đổi; ảnh Checkout
trong compare là bằng chứng cũ có nguồn, KHÔNG tính là rerun.
Không thay test giả lập thành integration: browser account-switch vẫn có hard
navigation, còn callback SPA có unit riêng. Device thật/Safari/Firefox/screen
reader/full transaction recovery chưa kiểm; các nút POST vẫn disabled.
Author visual pass không thay approval độc lập của Hiền hoặc G-FULFILMENT.

## Bằng chứng và findings lịch sử (đã thay thế)

## Cập nhật sau #57 merge

Base develop035656b, sync UI4bf24cf; Order runtime đã kiểm thật trên UI cam:
359 FE PASS/6liveSKIP,6/6 HTTP/PostgreSQL PASS,5/5 Chrome groups PASS/27ảnh.
Evidence `C:/VoMinhHoang/KLCN_2026/deliverables/orange-order-runtime-2026-10-16/browser/`.
Ảnh compare-order-list/detail hiện dùng capture API thật qua --runtime, không còn
là fixture panel. Đã xem combined images; ảnh list dài do20dòng, không nhận state
giống hệt mẫu2đơn. Card/màu/font/breakpoint đúng bộ token; font Inter và heading
20242B/card trắng được assert cả OS themes. Các phần nói #57 OPEN bên dưới là lịch sử.

Gate runtime read đã gỡ. Còn P2 ảnh minh họa Login; bố cục Order detail chưa tách
address/payment và timeline giống mẫu, list chưa có account sidebar. Không bịa
ảnh/items từ summary API. Vì các khoảng cách/layout còn này, visual QA vẫn blocked;
không cản bằng chứng nghiệp vụ Order read nhưng không nhận đã khớp toàn bộ mẫu.

## Source and capture conditions

Source: `C:/VoMinhHoang/KLCN_2026/deliverables/ui-orange-v1/previews/`
16-login.png, 04-checkout.png, 05-orders.png, 06-order-detail.png.
Sources are 1440×1080. Implementations use desktop CSS viewport 1440×1080,
deviceScaleFactor 1; full-page capture can be taller where real content requires it.
Mobile captures: 390×844; Order fixtures also 768×1080 and 390×1080.
Comparisons render source and implementation together at equal width (half scale)
in a single 1440px image; original full-size captures used for readable detail.

Evidence directory: `C:/VoMinhHoang/KLCN_2026/deliverables/orange-ui-alignment-2026-10-16/`.
Combined evidence: compare-login.png, compare-checkout.png, compare-order-list.png,
compare-order-detail.png. Focused original captures: auth/desktop-light-01-login.png,
checkout/desktop-light-02-preview.png and order-detail-1440.png.
Login initial state, Checkout price-preview with QA products; Order is fixture
panel-only, NOT a full authenticated runtime route. Dynamic data differ from mock;
therefore comparisons are style/layout evidence, not identical data/state acceptance.

## Comparison history

1. Initial: old blue Header/Auth, system fonts, 400px auth card, inconsistent
   Checkout/Order colors. Fixed with shared tokens, locally served Inter,
   two-column auth layout, orange primary/focus, 2:1 Checkout grid and Order cards.
2. Combined visual pass found Checkout large white canvas and nested bordered
   summary card. Fixed neutral page background and removed redundant inner card
   border/padding; recaptured all browser scenarios and comparison images.
3. Legacy heading font/dark aliases could drift: explicitly map heading/font and
   legacy CSS aliases within PublicLayout. Reran 287 FE tests, lint/build and all
   8 Chrome Auth/Checkout groups successfully on that final alias/font revision.
4. Mobile capture exposed promotional text above the login form, pushing the main
   submit below the fold. Moved intro after form at <=900px; Auth4/4 browser groups
   passed again and mobile screenshot visually checked after the fix.

## Required fidelity surfaces

- Typography: Inter 400–700, including Vietnamese/Latin assets. Login heading
  30px, Checkout/Order heading 28px, body16/labels14. Final shared heading/alias
  additions were recaptured with successful Auth/Checkout browser runs.
- Spacing: Header48px controls, content max1440/48px outer margin, 24px cards,
  Checkout 2:1 desktop / single-column mobile; no horizontal overflow in tests.
- Colors: source orange D63B0B, peach FFF2EC, ink20242B, neutral F6F7F8.
  Foreground/button contrast >=4.5:1 tested; light storefront under OS dark.
- Images/icons: Heroicons search used, not custom SVG. Login product photos from
  mock deliberately NOT copied from private uploads/DRAFT corpus; missing approved
  static artwork is still a visual gap. Order summary API lacks item images.
- Copy/content: keep real COD-only and zero demo shipping semantics, no fake Google,
  reset-password, sandbox method or chat controls. Preserve fixture evidence labels.

## Findings / implementation checklist

- [P2] Login promotional image region is absent and proportions differ from mock.
  Need approved static illustration assets and final crop/layout review; do not
  publish private DRAFT product media to make the screenshot resemble a mock.
- [P1 acceptance gap] Order full-route comparison unavailable on this official
  base: #57 still OPEN. Fixture panel comparison cannot validate navigation,
  authenticated shell, pagination/filter or runtime account switching.
  Sync after merge and capture real list/detail at all viewports.
- Resolved: mobile Login recaptured after moving intro below the form; primary
  task appears first, no horizontal clipping.
- Expected constraints, not bugs: unavailable mock menus/buttons are omitted;
  list does not fabricate product images; real timeline retained instead of invented
  progress stages; disabled command actions remain disabled.

## Functional checks

287 Vitest PASS /4 opt-in live SKIP; lint/build PASS including final alias/font fix.
Real Chrome Auth4/4 +Checkout4/4 PASS on isolated PostgreSQL; replay/error cases
included. Browser console and overflow checked by harnesses. Order fixture renderer
6 viewport captures, no pageerror; this is NOT live Order integration.
No Backend/schema/API/recovery-policy changes. No auto merge or publish.
