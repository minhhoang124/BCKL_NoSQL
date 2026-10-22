# UI cam trên Order thật — 16/10/2026

Base develop `035656b` có #56/#57. UI commit `3080d79`, merge/sync `4bf24cf`;
follow-up bổ sung assert màu/font trong harness và ảnh đối chiếu. Không Backend,
schema, policy/session hoặc contract thay đổi. Giữ route và link Checkout #57.

359 FE PASS /6 live SKIP trong lượt thông thường; lint, build FE/BE PASS.
Chạy live suite riêng: 6/6 HTTP/PostgreSQL PASS (jsdom, không phải browser).
Chrome Order thật: 5/5 nhóm PASS, 27 ảnh, API/QA DB127.0.0.1:5549 riêng.
Không reset/mutate database demo5432; workers tắt trong QA.

Desktop1440×1080/mobile390×844 sáng/tối đều assert Inter, heading rgb32/36/43,
card trắng; không pageerror/tràn ngang. Có pagination/filter, Buyer/Seller detail,
Seller đọc Store SUSPENDED, lỗi GET/retry, đổi account/ownership404. Harness không
gửi lệnh Order, baseline các trường/count chọn không đổi. Bootstrap22 đơn qua
Cart/Checkout thật không được nhầm với zero-write toàn QA DB.

Evidence `deliverables/orange-order-runtime-2026-10-16/browser/` trên máy Hoàng.
Combined reference/runtime captures cập nhật tại
`deliverables/orange-ui-alignment-2026-10-16/compare-order-*.png`.
Đã xem cặp ảnh list/detail cùng khung; khác dữ liệu/số dòng nên không phải pixel
diff hai state giống hệt. `design-qa.md` ghi phần chưa đạt, không nhận 1:1.

Giới hạn: account-switch browser có hard navigation; deferred unit kiểm callback
riêng. Chưa screen reader/device thật/Firefox/Safari/full SPA late response.
Nút command vẫn disabled; #58 chưa chốt resolution/fence. Bằng chứng Order read
không chứng minh command recovery hoặc toàn G-FULFILMENT đã hoàn thành.
