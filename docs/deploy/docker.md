# Chạy BCKL bằng Docker

Bộ Docker gồm 3 container: **PostgreSQL**, **Backend** (NestJS) và **Web** (React build sẵn, phục vụ bằng nginx).
Tìm kiếm Elasticsearch và dịch vụ AI tìm bằng ảnh **không** nằm trong bộ này (phần Search do nhóm Search phụ trách).

## Yêu cầu
- Docker Desktop (hoặc Docker Engine + Compose v2).
- Cổng trống: 5432 (PostgreSQL), 3001 (API), 8080 (Web). Đổi bằng `POSTGRES_PORT`, `BACKEND_HOST_PORT`, `WEB_HOST_PORT`.

## Chạy nhanh
```bash
# 1. Tạo secret JWT riêng (không commit giá trị nào vào Git)
export JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
export JWT_REFRESH_SECRET="$(openssl rand -base64 48)"
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"

# 2. Build và chạy (profile "app" = backend + web)
docker compose --profile app up -d --build

# 3. Mở web
#    Web: http://localhost:8080   API: http://localhost:3001/docs
```
Lần đầu Backend tự chạy `prisma migrate deploy` (`RUN_MIGRATIONS=true` mặc định trong compose). Muốn có dữ liệu mẫu, chạy seed từ máy dev (`pnpm prisma:seed`) trỏ vào cùng database.

Chỉ chạy database như trước: `docker compose up -d postgres` (hoặc `pnpm db:up`), không cần biến JWT.

## Cấu hình
| Biến | Ở đâu | Ghi chú |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | backend | **Bắt buộc**; container dừng ngay nếu thiếu. |
| `POSTGRES_USER/PASSWORD/DB` | postgres + backend | Mặc định `postgres` / `change_me` / `klcn_ecommerce` — chỉ dùng thử máy cá nhân. |
| `RUN_MIGRATIONS` | backend | `true` để tự migrate khi khởi động; đặt `false` nếu migrate riêng. |
| `FRONTEND_URL` | backend | Origin được phép gọi API (CORS); mặc định `http://localhost:8080`. |
| `VITE_API_URL` | build web | Địa chỉ API **trình duyệt** gọi tới; build lại web khi đổi. |
| `VITE_*` khác | build web | Cờ bật/tắt chức năng, mặc định trong `FE/Dockerfile`. Giá trị bị nhúng vào bundle — không đặt secret. |
| `VNPAY_SANDBOX_ENABLED` + `VITE_VNPAY_SANDBOX_ENABLED` | backend + web | Mặc định tắt; bật cần thêm `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (secret, truyền qua môi trường) và IPN cần HTTPS công khai. |

Ảnh sản phẩm tải lên nằm trong volume `bckl_uploads`; database trong `bckl_pgdata`.

## Build riêng từng image
```bash
docker build -f BE/Dockerfile -t bckl-backend .
docker build -f FE/Dockerfile --build-arg VITE_API_URL=http://localhost:3001 -t bckl-web .
```
Context build là thư mục gốc repo (pnpm workspace + `pnpm-lock.yaml`). `.dockerignore` loại `node_modules`, `.env*`, `*.private.json`, `uploads`, `datasets`, tài liệu và script QA khỏi image.

## Giới hạn
- Đây là cấu hình chạy thử/demo trên một máy, chưa phải hạ tầng production (chưa có HTTPS, reverse proxy, backup, giám sát).
- Image Backend giữ cả dependency dev để chạy `prisma migrate deploy` trong container.
