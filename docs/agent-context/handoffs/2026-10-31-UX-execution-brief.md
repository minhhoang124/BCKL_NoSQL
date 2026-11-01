# Giao việc sửa trải nghiệm và hợp đồng nghiệp vụ — 31/10/2026

Owner yêu cầu thực thi ngay sau phản hồi thực tế. Codex là leader điều phối/review, Claude phụ trách BE, Antigravity phụ trách FE và review tích hợp. Argon/Claude tối đa Medium; Flash tối đa High.

## Điểm bắt đầu và quy tắc chung

- Checkout duy nhất được sửa: `C:/Vo Minh Hoang/BCKL_2026/release-integration/`. HEAD leader vừa kiểm `60f2091`, working tree sạch trước ghi brief này. Agent phải tự kiểm lại; tài liệu/baseline mới do leader ghi là thay đổi có chủ đích, không reset hoặc ghi đè.
- Đọc AGENTS và README/CURRENT/DECISIONS/WORKBOARD/PROTOCOL; đối chiếu CANDIDATE_BASELINE. Các baseline lệch do thay đổi của worker khác phải báo leader, không sửa hộ hoặc tự cập nhật hash. Không sửa Seller WIP không rõ nguồn.
- Đọc danh sách yêu cầu đầy đủ tại root máy `DANH_SACH_PHAN_HOI_UX_2026-10-31.md`. Đây là yêu cầu owner, ảnh Shopee chỉ tham khảo bố cục/hành trình, không thêm mọi tính năng trong ảnh.
- Một checkout, hai writer ở hai miền khác nhau. Không git checkout/pull/merge/reset/clean, không commit/push hoặc stage file của nhau. Leader tích hợp sau review. Không sửa bộ context chung; chỉ viết file bàn giao được giao.
- Bảo toàn PostgreSQL là nguồn nghiệp vụ, snapshot Order, idempotency, session epoch/ownership, tiền/kho và phục hồi sau mất phản hồi. Không xóa bảo vệ để giảm bước UI. Không tự POST khi reload, không xóa pending journal chỉ để mở nút.
- Không đọc/in secret vào prompt/review; không sửa .env/profile private, seed/reset/migrate DB Demo, bật worker thật, gửi mail/provider, mở tunnel/cloud hoặc nhận TOS. Test có ghi phải dùng QA DB mới được leader/guard xác nhận. Có quyền viết test QA không đồng nghĩa có quyền tạo fixture trên Demo.
- Chạy kiểm phù hợp với từng phần. Không sửa assertions thành yếu hơn, xóa test hoặc đổi hợp đồng chỉ để làm xanh. Báo rõ FAIL/SKIP/TODO và phần chưa chạy. Local PASS không thay CI/provider/staging.
- Tạo các checkpoint nhỏ theo task; không đợi sửa mọi thứ mới bàn giao. Cần sửa ngoài miền sở hữu thì dừng phần phụ thuộc và gửi yêu cầu leader, tiếp tục phần độc lập.

## Quyết định hành trình dùng chung — ưu tiên hơn audit cũ

**Web: PDP Mua ngay → giỏ hàng → chọn mặt hàng/Mua hàng → checkout → Đặt hàng.** Không cần API mua thẳng độc lập trong đợt này. Không tự đặt đơn khi bấm Mua ngay. Giữ cơ chế PUT số lượng mong muốn hiện tại; FE diễn đạt rõ, không nhân đôi do doubleclick, giữ các SKU khác và chọn đúng SKU vừa mua. Không âm thầm tự cộng số lượng theo semantics mới.

COD và VNPay sandbox; MoMo P2. Không tạo voucher/xu/bảo hiểm/refund ngân hàng/logistics thật từ ảnh tham chiếu. Dữ liệu demo có thể được ghi nhận gọn tại chỗ phù hợp, không giả thành thông số, bảo hành hoặc ưu đãi thật. Nội dung người dùng phải là ngôn ngữ mua sắm, không diễn giải framework/đồ án.

## CLAUDE — ownership BE

Được sửa BE/src, BE/test, BE/prisma khi cần migration mới, tài liệu API liên quan và file bàn giao `docs/agent-context/handoffs/2026-10-31-BE-UX-contract.md`. Không sửa FE, dependency/lockfile dùng chung, dữ liệu/runtime private hoặc bộ context chung. Nếu cần shared file, báo leader.

### Thứ tự thực hiện

1. **Công bố contract sớm** trong file bàn giao: endpoint hiện có/cần mở rộng, request/response, quyền, trường tùy chọn và tương thích dữ liệu cũ, mã lỗi, flag, test và phần FE được dùng ngay. Đừng bịa endpoint tương lai thành API đã chạy. Đầu tiên khảo sát cart/checkout/order/address/chat/notification đang có, ưu tiên tận dụng.
2. **Dữ liệu giỏ/checkout/đơn:** bổ sung đúng phần thiếu để FE có ảnh, tên, phân loại, số lượng, đơn giá, thành tiền và Store; list đơn cần preview có giới hạn, không nổ N+1 hoặc lộ PII. Detail đã có tên/SKU/options/giá/timeline, không viết lại. Chốt ảnh lịch sử và fallback khi Product thay đổi/xóa/ẩn, không lấy giá hiện tại thay giá snapshot. Mở rộng response có tương thích và test; không thêm migration nếu chỉ cần projection. Không cấp quyền đọc chi tiết Buyer/address cho Admin reader chỉ để trang trí thẻ.
3. **Admin tìm/chọn đơn:** tái sử dụng queue/detail. Nếu FE cần tìm theo orderNumber hiển thị ORD-…, bổ sung lookup có kiểm active Admin/CV, dữ liệu tối thiểu, phân trang/giới hạn và input an toàn. Giữ trạng thái/command/receipt, chống stale attempt, double submit và hoàn kho trùng.
4. **Địa chỉ:** giữ quyền sở hữu, default và legacy order snapshot; hỗ trợ tạo ngay tại checkout qua API có sẵn. Kiểm định dạng phone phù hợp thị trường đã chốt, không gọi kiểm regex là xác minh chủ số. Đề xuất/triển khai danh mục tỉnh-phường có mã, phiên bản và nguồn đáng tin cậy; xác minh nguồn hiện hành trước sử dụng, không bịa danh mục hoặc silently đổi địa chỉ cũ. Kiểm cặp mã thuộc nhau phía BE, không chỉ select FE. Nếu nguồn/legacy migration chưa chốt, tách checkpoint và báo leader, không nhận đã xác thực địa chỉ thực.
5. **Đổi mật khẩu qua email:** tái sử dụng nền email/challenge/queue, nhưng purpose phải tách khỏi forgot-password/verify. Giữ current-password reauthentication đang có khi bắt đầu yêu cầu; không tự bỏ. Request từ phiên đã xác thực, email đã verified; xác nhận email mở quyền nhập mật khẩu mới cho đúng request/phiên. Challenge hash/TTL/one-use, rate limit, phiên/token sai/hết hạn/đã dùng, replay và race; GET/email scanner không được tiêu thụ challenge hoặc đổi mật khẩu. Kiểm challenge ở server khi commit, revoke phiên/CV/audit nguyên tử. Trường hợp chỉ có Google, email chưa verify hoặc mở link thiết bị khác phải có hành vi an toàn rõ, không tự nối identity/autologin. Thiết kế được review trước khi bật; kiểm bằng provider giả lập/Mailpit/QA, không tự gửi thư ra ngoài.
6. **Chat/notification:** tái sử dụng REST/socket/read/unread; bổ sung thiếu hụt contract để global widget và dropdown dùng được. Thông báo đơn đã có source theo lịch sử; kiểm mapping người nhận, loại self-notification, dedupe, catch-up và flags. Nếu cần kênh push, phải kiểm quyền/session lại, không broadcast dữ liệu đơn cho người ngoài, không làm rollback giao dịch chính khi push lỗi. Không tự bật worker Demo.
7. **Seller:** kiểm contract/validation ảnh, thuộc tính, nhóm phân loại, SKU/giá/kho, kiện hàng và gửi duyệt. Trả lỗi có cấu trúc/field code nếu thiếu, để FE dẫn đúng mục. API cần kho/số lượng an toàn cho bộ −/+ nhưng không mở endpoint kho nội bộ hoặc tin FE về available stock. Không tự tạo mô tả/bảo hành từ dữ liệu thiếu.
8. **Nhánh đơn trả trước giao thất bại:** ghi proposal đóng/đối chiếu tiền-kho riêng cho leader. Chưa triển khai refund thật, chưa tự cho COD returned endpoint nhận VNPay PAID. Không dùng việc làm UI để thay quy tắc tài chính.

### Bằng chứng và bàn giao BE

Test có ý nghĩa cho ownership, malformed input, default/race, amount/snapshot/stock/idempotency, list projection, challenge/CV và correct-recipient. HTTP/PG trên QA riêng khi có guard đủ; nếu chưa có QA, báo chưa chạy, không dùng Demo thay. Sau đóng các phần chạy full BE regression phù hợp một lần và typecheck/build; không phát mail/provider thật. Bàn giao exact file diff, source hashes, lệnh/kết quả thực, migration/compatibility và giới hạn. Đánh dấu contract READY theo từng API để FE nối dần, không nhận DONE khi mới có DTO.

## ANTIGRAVITY — ownership FE

Được sửa FE/src và tests, tài liệu UI riêng khi cần và file bàn giao `docs/agent-context/handoffs/2026-10-31-FE-UX-handoff.md`. Không sửa BE/Prisma/API contract do Claude giữ, dependency/lockfile dùng chung, bộ nhớ chung hoặc private profiles. Dùng skill frontend-design/impeccable/webapp-testing phù hợp; giữ theme hiện hành, không thay toàn bộ nhận diện thương hiệu hoặc copy nguyên Shopee.

### Có thể làm ngay, không chờ BE

1. **ADM-02:** avatar không đăng xuất; mở menu tài khoản, đăng xuất có nhãn và thao tác riêng, bàn phím/focus đúng. Không đổi auth/session phía client để né lỗi.
2. **BUY-01:** Hồ sơ/Địa chỉ/Bảo mật rõ ràng; bỏ role USER/ID nội bộ ở giao diện người mua, email che nhất quán; không loại role khỏi auth logic. Không tự thêm ngân hàng/ngày sinh/giới tính/voucher.
3. **BUY-03/06:** nút Thêm vào giỏ hàng/Mua ngay đúng luồng web; bộ −/ô số/+ cả PDP/cart, trạng thái hết hàng, chọn đủ biến thể và giới hạn hợp lý. Không giả vờ Mua ngay hoạt động khi chỉ đổi label/link. Dùng dữ liệu tồn kho public cho UI nếu có; server vẫn kiểm cuối. Không suy kho chính xác từ boolean inStock.
4. **SELL-01:** trang tạo/sửa sản phẩm đủ rộng/chia bước có chỉ dẫn: Thông tin, Ảnh, Phân loại/giá/kho, Thông số, Kiện hàng, Kiểm tra/gửi duyệt. Backend đang tạo nháp trước; giữ quy trình này nhưng tự chuyển rõ sang bước tiếp theo, không giấu các phần đến khi người bán tự mò Chỉnh sửa. Cảnh báo thiếu ảnh/thuộc tính dẫn đúng mục. Danh sách có nội dung nhận diện phù hợp, trạng thái tiếng Việt, phân biệt Lưu nháp/Gửi duyệt/Hủy chỉnh sửa. Không viết lại hoặc bỏ editor SKU đã có.

### Làm song song, nối theo contract READY của Claude

5. **BUY-07/09:** giỏ và checkout dạng thương mại: ảnh/tên/phân loại/giá/số lượng/thành tiền theo Store; chọn dòng/Store và tổng tiền chỉ dòng đã chọn. Checkout khối người nhận-điện thoại-địa chỉ, Thay đổi/Thêm địa chỉ tại chỗ, lưu xong chọn ngay và không mất draft. Phương thức COD/VNPay theo flag/backend readiness, tổng tiền/Đặt hàng rõ. Giữ bước preview/đối chiếu giá-kho phía server nhưng lồng vào hành trình dễ hiểu; không bỏ kiểm hoặc tự đặt sau preview.
6. **Đơn mua:** thẻ có preview sản phẩm, trạng thái, Store, tổng tiền, Xem chi tiết; detail ảnh phù hợp, tên/SKU/options/quantity/giá, địa chỉ/timeline và hành động đúng trạng thái. Không gọi detail API cho mọi thẻ để vá list, không hiển thị giá hiện hành thay giá đơn.
7. **BUY-04:** widget chat nổi xuyên trang desktop, thu nhỏ/mở rộng/đóng; mobile panel phù hợp, không che nút mua. Dùng chung core/state/REST/socket với trang Tin nhắn, tránh hai socket hoặc listener gửi trùng. Tên/ảnh Store, preview tin cuối/unread/time, thẻ Product/Order đã có, ô nhập gọn. Chỉ đánh dấu đọc khi tin thực sự được hiển thị trong hội thoại đang xem; đổi account/logout xóa state và hủy kết nối cũ. Nút reload/reconnect chỉ nổi bật khi có lỗi; giữ recovery không tự replay tin chưa rõ kết quả. Không tự thêm ảnh/file/video/bot.
8. **Thông báo:** dropdown từ chuông, unread badge, danh sách mới nhất/Xem tất cả, liên kết đúng đơn, read/read-all theo dữ liệu thật. Cập nhật khi có sự kiện hoặc polling có kiểm soát; không chồng request, không leak thông báo sau đổi account, không đánh dấu tất cả đã đọc chỉ do mở dropdown. Thông báo chuyển trạng thái có thể hiện toast gọn khi phù hợp, không thay mọi thông báo bằng quảng cáo.
9. **ADM-01/03:** danh sách đơn cần xử lý nhìn thấy ngay, tìm theo mã hiển thị khi BE READY; nếu chỉ có ID tạm thời phải ghi rõ ID nội bộ, không giả search ORD đã hoạt động. Thẻ đơn/trạng thái/timeline/hành động tiếp theo theo dữ liệu thật; form vận đơn/lần giao/lý do/biên nhận theo ngữ cảnh. Giữ consent và receipt/recovery, không cho đổi trạng thái tùy ý.
10. **BUY-02/10:** nối luồng email-change-password và bộ chọn địa chỉ theo contract/version Claude đã bàn giao. Chưa sẵn thì giữ trạng thái rõ, không giả xác minh bằng timer/localStorage/mở form trực tiếp. Ảnh Shopee không phải bằng chứng việc mở email tự bảo đảm danh tính.
11. **BUY-05:** mô tả/thông số PDP theo dữ liệu có thật, trình bày dễ đọc. Nếu corpus/demo thiếu nội dung thì báo leader cần bổ sung dữ liệu, không bịa công suất/kết nối/bảo hành, không xóa ghi nhận mô phỏng để giả bán thật.

### Bằng chứng và bàn giao FE

Test tương tác theo hành trình: avatar không logout, đúng SKU/quantity khi vào cart, địa chỉ tạo tại checkout giữ draft, đúng item và amount, empty/error/loading, đổi tài khoản, chat unread/read, notifications đúng người, Seller tạo nháp đủ bước và Admin giao mô phỏng. Chạy full FE/build sau tích hợp cuối; Chrome desktop/mobile dùng QA và chụp ảnh các flow thực. Owner đã cho phép Playwright; không dùng DB Demo để tạo đơn test. Production UI không dùng fake data hoặc mock response làm bằng chứng API hoạt động. Bàn giao ảnh/log ngoài Git, source hashes, tests thực, API còn chờ và giới hạn; đề nghị leader review chéo BE/FE trước khi merge.

## Handoff sớm và điều kiện tích hợp

Claude gửi BE contract checkpoint đầu; Antigravity gửi checkpoint avatar/PDP/Seller và danh sách API cần. Mỗi bên báo thay đổi ngoài phạm vi để leader giải quyết, không tự ghi đè file. Chỉ Codex cập nhật context/baseline và thực hiện commit/push sau kiểm chứng. Không tự merge develop/main. Chưa gọi nghiệm thu hoàn chỉnh trước khi chạy hành trình thực Buyer→Seller→Admin trên cùng source và kiểm tiền/kho, thông báo, dữ liệu hiển thị.
