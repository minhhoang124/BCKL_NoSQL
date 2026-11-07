# #51 — kiểm lại công cụ Address/Cart sau Buyer Web

Nhận develop `4ed07a3` tại `5fcffdceb4a53645b09894e0c78cd6a8d5ddd2b3`.
Hai conflict chỉ overview; giữ đầy đủ hai phía. BE/src/Prisma/FE/AI/lockfile
nguyên byte nền chính thức; script/10guard nguyên byte `ef0e981` đã kiểm trước.
Không đổi Auth/schema/giao dịch/UI, không lấy #94 hoặc #97 chưa merge.

Kiểm mới ngày23/10:

- **10/10 safety guard PASS**, Node test549ms; diff-check PASS.
- Fresh detached checkout `pr51-sync-qa-20261023` đúng5fcffdc; frozen/offline
  install ignore-scripts585packages PASS, explicit Prisma generate/Nest build PASS.
- DB mới `bckl_hien_address_cart_20261023_sync`, chỉ127.0.0.1:5549,
  17migrations PASS; role QA NOSUPERUSER/NOCREATEROLE (migrator có CREATEDB,
  không nhầm với runtime role NOCREATEDB của gói Attributes).
- prepare → đổi giá/kho/địa chỉ/giỏ trên fixture mới → prepare lần2: fingerprint
  bảng nghiệp vụ/passwords giữ nguyên. Không reset dữ liệu để làm test xanh.
- serve→verify HTTP/PostgreSQL thật **PASS9nhóm** tại
  `2026-10-22T18:46:08.020Z`. Sau cleanup đúng fixture tạm:4User/5Product/
  0Order/0outbox. Original private config checksum giữ nguyên; child API dừng.
- Không fullBE/FE mới vì production sources nguyên nền đã kiểm; không cộng
  số liệu lịch sử1034/939 thành lượt chạy mới. Không browser mới/Checkout write/
  Order fulfilment/loaded ES–FAISS; API smoke không phải nghiệm thu Web.

Kết quả verifier/credentials/images chỉ ở các file riêng Git-ignored trong
checkout QA, không gửi profile/JWT/password/DB URL. Demo container vẫn dừng,
không reset/drop/purge database/volume. Approval cũ không là approval head mới.
Hoàng cho phép owner exception nhưng không dùng admin bypass; CI thiếu phải
ghi đúng trạng thái/annotation, không nhận local PASS là CI xanh.
