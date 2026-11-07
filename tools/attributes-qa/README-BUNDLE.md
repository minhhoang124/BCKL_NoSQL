# Attributes QA — bundle nhận gói 23/10/2026

Đây là các file QA/runbook bổ trợ **PR #94**, không phải toàn bộ source hoặc
bằng chứng editor của Hiền đã hoàn thành. Lấy checkout đúng head ghi trong PR
trước khi dùng; nếu #94 chưa merge, dùng nhánh `codex/admin-attribute-write-api`
riêng, không chép đè develop hoặc checkout đang làm dở.

1. Đọc `docs/testing/attributes-editor-handoff-2026-10-22.md` từ đầu.
2. Giữ nguyên `tools/attributes-qa/Dockerfile`, `compose.yaml`, `init-qa.sh`.
   Compose dùng `up -d --build --wait`; hook được COPY chmod0755 bên trong image
   Linux, không phụ thuộc executable bit của host. Không dùng zip9b12b9f cũ.
3. Tạo secrets QA trên chính máy mình theo guide; không xin .env của Hoàng,
   không gửi credential lên GitHub. Nếu cổng5549 bận, kiểm chủ sở hữu; không
   dừng/xóa volume của người khác và không đổi sang DB demo5432.
4. Chỉ chạy migration mới trên đúng DB QA; không migrate reset/drop/down-v.
   Dùng launcher có guard để seed/serve; dữ liệu hai Admin/Seller/Buyer nằm
   trong bundle fixture riêng Git-ignored trên máy nhận.
5. Guide dùng API loopback3014; localhost của Hoàng không
   phải môi trường chia sẻ. Read/write/options/expectedRevision/usage/reason/
   confirmation và lỗi503/Retry-After được mô tả trong hai file API kèm theo.
6. Báo cáo portable-init nêu rõ hai fresh-volume proof Windows/Linux-container
   đã PASS, **native macOS/ARM64 tại máy tác giả NOT_RUN**. Không đánh đồng API
   smoke với browser editor hoặc loaded ES/FAISS acceptance.

Zip không có password/JWT/token/DB URL/privateprofile/model/dataset/upload.
Source/commit, SHA256 zip và kết quả kiểm cuối được gửi riêng trong comment PR.
