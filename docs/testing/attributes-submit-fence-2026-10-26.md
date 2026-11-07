# Attributes editor — chốt đồng bộ gửi lệnh26/10/2026

Tiếp nối #109 head `e282cb0`, ghép develop `87ccf76` trên checkout/nhánh riêng
`codex/pr109-safe-submit`. Giữ code nghiệp vụ/consent của Hiền, không sửa schema,
Backend API hoặc thay dữ liệu QA của thành viên khác.

## Finding đã tái lập và sửa

Probe hai DOM click trong cùng `act`, trước khi React render nút disabled,
gọi patchDefinition hai lần cùng expectedRevision: expected1/received2. Đây là
P2 tuần tự hóa ý định giao diện, không kết luận P1 ghi dữ liệu hai lần; Backend
vẫn kiểm revision/khóa giao dịch. Dùng chung latch useRef cho load/choose/
moreOptions/perform để chặn ngay trước await. Chọn option, tạo draft mới,
đổi draft và consent cũng kiểm latch trước cập nhật.

Known conflict nhả latch để người dùng xử lý. Unknown outcome đặt cờ khóa ghi
đồng bộ; đọc lại danh sách được phép nhưng không xóa khóa/draft, không replay.
Bootstrap StrictMode chỉ lượt effect còn hiệu lực được nhả latch. Async result
sau unmount không cập nhật editor. Parent tiếp tục remount theo category/session.

Argon Medium đề xuất thêm categoryId carryover và xếp UI duplicate là P1;
Codex không giữ các diễn giải đó: mount thật có key categoryId, Backend bảo vệ
revision. Chỉ kết luận finding có probe tái lập. Static review không thay runtime.

## Kiểm chứng

- Đúng head e282cb0 trước sửa:137/137 Attributes/Admin và build PASS.
- Ghép nền428700b trước sửa: full FE1410PASS/6liveSKIP, build PASS.
- Probe gửi trùng FAIL trước sửa, PASS sau sửa.
- Bản cuối trên nền87ccf76:141/141 Attributes/Admin PASS, gồm4probe mới:
  gửi trùng + chọn/đọc/new-draft xen khi ghi; hai selection cùng tick; known409
  nhả latch; unknown giữ khóa sau reload danh sách.
- Một lượt full FE trung gian có2ca probe FAIL (selector thông báo exact và
  nút reload còn disabled khi unknown); đã sửa selector và tách read-disable
  khỏi write-lock. Không tính lượt đó PASS. Kết quả full cuối ghi riêng trên PR.
- Full FE cuối:84filesPASS/1skipped,1456PASS/6liveSKIP,158.84s. TypeScript/Vite
  build PASS, Oxlint0errors/5warnings nền Admin; bundle>500kB vẫn là cảnh báo.
- Argon `gemini-4-argon-medium`, effort Medium, re-review delta cuối: NONE
  P1/P2 cụ thể. Source editor SHA256
  `d560687bd02fde06032770903af32a88ae22086a8abe355431219a41d3f04a2a`.
  AI review không giả thành human GitHub approval.

Không chạy Chrome/PostgreSQL mới cho patch latch này; bằng chứng live của Hiền
giữ đúng nguồn22migration/ngày cũ trong
[báo cáo gốc](attributes-integration-live-qa-2026-10-23.md), không đổi nhãn thành
QA trên nền27migration. Không đụng demo. Không nghiệm thu Search propagation,
physical device hoặc toàn Admin từ test component. UI hiện dùng API Attributes
đã merge; Accounts, Dashboard, hậu mãi mới được giữ trong bản ghép.
