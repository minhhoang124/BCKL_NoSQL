# #83 — sửa môi trường CI cho test DB preparation

Run lỗi:39449662655, head6b82435. `repository-checks` dừng ở Backend E2E:
suite protocol gọi guard yêu cầu loopback5549 và database tên riêng; CI cũ chỉ
cấp DATABASE_URL localhost5432/klcn_ecommerce. Guard chặn trước fixture writes.
Không phải lỗi thuật toán policy hoặc AI; không coi suite chưa chạy là PASS.

## Sửa

Workflow thêm service PostgreSQL17 riêng `backend-e2e-postgres`, bind
127.0.0.1:5549, database `bckl_order_resolution_test_ci`. Healthcheck trước steps.
Hai bước prepare/E2E override DATABASE_URL sang DB mới; chạy migrate deploy và
seed trước toàn bộ E2E. Service5432 cũ giữ cho các bước kiểm tra khác.
Credential postgres/postgres ở đây chỉ dành runner/container CI dùng một lần,
không là cấu hình máy thành viên/demo. Không sửa guard, không skip suite hoặc
đặt biến CI local để né kiểm tra. GitHub thu hồi services khi job kết thúc.

## Kiểm tra

- Parse YAML và assert service/E2E URL wiring PASS bằng PyYAML có sẵn.
- Lint và diff-check PASS.
- Local dùng DB QA riêng5549 `bckl_order_resolution_test_attrprep_release`,
  đã có14migration chính thức, seed PASS; không database demo5432.
- Lượt full E2E đầu thiếu JWT env khi bootstrap nên không đạt; đã bổ sung JWT
  ngẫu nhiên trong RAM cho tiến trình thử lại. Không sửa source/test để qua.
- Lượt chạy lại full Backend E2E:626PASS/20TODO;33filesPASS/1SKIP;149.68giây.
  Bao gồm10protocol và4audit tests; không cộng chúng lần nữa vào626.
- Kết quả full E2E và CI sau push được cập nhật ở comment PR; không nhận
  workflow mới xanh trước khi GitHub chạy xong.

Application runtime, schema/migration và dependency lockfile không thay đổi.
