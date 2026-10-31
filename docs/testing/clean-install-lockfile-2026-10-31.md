# Kiểm cài sạch sau phản hồi Đạt — 31/10/2026

Nguồn: candidate `1c4feb4aec1a07beceb7d73660e5cb3ff5bfd216`, cộng đúng bản sửa `pnpm-lock.yaml`. Không đưa các thay đổi giao diện/UX chưa commit vào bằng chứng cài sạch này.

- Đã tái hiện lockfile gốc: `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts` thất bại `ERR_PNPM_OUTDATED_LOCKFILE`, do FE chuyển ba công cụ build sang dependencies nhưng importer vẫn để ở devDependencies.
- Sửa importer FE cho `@vitejs/plugin-react`, `typescript`, `vite`; giữ nguyên specifier, phiên bản và resolution. Không đổi package.json hoặc nới frozen-lockfile.
- Trích toàn bộ HEAD vào thư mục riêng, xác nhận chưa có node_modules ở root/FE/BE. Dùng Node v24.22.1 và pnpm 11.25.0 theo packageManager của repo.
- `pnpm install --frozen-lockfile`: PASS cả workspace, 618 packages từ cache; BE postinstall `prisma generate` PASS. Không dùng `--ignore-scripts` ở bước kiểm bản sửa.
- `pnpm --dir FE run build`: PASS (tsc + Vite); còn cảnh báo bundle >500 kB đã có trước.
- Lockfile không bị installer sửa lại. Không đọc .env/secret, không kết nối DB, không chạy migration hoặc seed vào dữ liệu thật.

Artifact riêng trên máy: `machine-local/clean-install-20261031-1793428042349/report.json`, cùng log tái hiện/cài/build. Fresh node_modules có sử dụng cache package hiện có, không phải thử tải mọi package từ Internet trên máy mới hoàn toàn.

Phạm vi kết luận: khép blocker frozen-lockfile trên candidate này; chưa thay bằng chứng full regression, tích hợp CLIP–ES–FAISS hoặc nghiệm thu online. Thành viên vẫn cần cấu hình riêng, DB/migrations, ảnh và model/index theo runbook; Git pull không mang dữ liệu runtime/secret sang máy khác.
