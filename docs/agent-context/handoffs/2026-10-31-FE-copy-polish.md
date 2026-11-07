# FE copy polish — 31/10/2026

Owner yêu cầu gỡ lời giới thiệu đồ án/công nghệ trên giao diện để trình bày riêng khi bảo vệ. Hai điểm chỉ định bằng ảnh: chip AI CLIP ở hero và dòng hướng dẫn hover nhắc Shein. Giữ trang trí Noel theo D14.

Codex đã thực hiện trên `feat/hoang/sku-management-final`, base1c4feb4, working tree trước sửa sạch; baseline7b73dd5 khớp56/56 trước sửa. Không sửa BE hoặc checkout khác.

- Home: bỏ chip AI CLIP và hover instruction; hai voucher còn lại chia đều hai cột, mobile giữ một cột. Đổi lời giới thiệu ngữ nghĩa thành câu theo mùa lễ hội, bỏ Search Service latency, không quảng bá tìm ảnh khi flag tắt.
- Header/Auth/Footer: nhãn tìm ảnh thông thường, bỏ tên CLIP/FAISS/OAuth và lời giới thiệu khóa luận; giữ đường dẫn/handler/flag/quyền.
- Account/Seller: bỏ Masked PII, mã quyết định D13 và tên Shopee khỏi nội dung hiển thị. Giữ dữ liệu email che mờ và chức năng cập nhật giá/kho.
- Image Search: bỏ tốc độ AI và giải thích điểm xếp hạng, giữ hướng dẫn chọn ảnh và mục đích xử lý ảnh bằng từ ngữ phổ thông.
- Orders: bỏ banner API/chưa nghiệm thu ở dữ liệu thật, giữ nhãn fixture và các kiểm quyền/phục hồi/thanh toán. Review disabled được diễn đạt theo thao tác người dùng.
- Hai test hiện có chỉ cập nhật kỳ vọng nội dung đã đổi; giữ assertions route, flag, snapshot, payment và disabled commands. Không xóa test.

Kiểm tra: full FE Vitest31/10 lúc08:49 đạt110 files PASS,1856tests PASS,6SKIP; production build/TypeScript PASS. Cảnh báo bundle>500kB còn nguyên. Lượt focused trước đó75PASS/1FAIL do test giữ tên link cũ; cập nhật đúng tên mới rồi full suite trên đạt. git diff --check PASS (Git báo chuyển LF→CRLF theo cấu hình).

Chưa commit/push/deploy trong lượt sửa copy; URL Vercel đã cung cấp vẫn cần nghiệm thu riêng. Không có browser render mới trong lượt này. Các trang preview/dev giữ nhãn mẫu; Admin system health giữ tên thành phần kỹ thuật có ích cho vận hành; sandbox/payment/courier limitations và consent/recovery giữ nguyên.

## Bổ sung theo chỉ đạo nội dung thương mại

Owner nhấn mạnh D16: FE phải nói theo nhu cầu mua sắm/vận hành, không giải thích tính năng đồ án. Đã rà tiếp giỏ hàng, Checkout, recovery Buyer/Seller, Chat, Admin accounts/brands/attributes/dashboard. Bỏ các câu API thật/Backend/revision/job/index/đợt bàn giao trong thông báo người dùng; chuyển lỗi kết nối, kết quả chưa rõ và cập nhật chậm thành hướng dẫn thực tế. Giữ logic guard, latches, khóa ghi, payload, phân quyền và các assertion bất biến. Không sửa BE.

Full FE cuối31/10 lúc08:55:28: **1856PASS,6SKIP**,110filesPASS; build/TypeScript source cuốiPASS, cảnh báo bundle cũ giữ nguyên. Các lượt sau sửa copy từng có8 rồi2 testFAIL vì giữ câu chữ/mã lỗi cũ; đã cập nhật đúng kỳ vọng nội dung, không xóa test hay nới kiểm giao dịch. Các màn preview/dev không thuộc luồng khách dùng giữ nhãn mẫu. Border accent KPI Seller có từ trước vẫn giữ, không ignore hoặc đổi thiết kế trong task nội dung.
