# Review đối kháng #118 —25/10/2026

Head tác giả `f58e67f38d061a9bce4b82cfc2dfeef6d9fc703d`. Checkout review riêng,
không sửa nhánh tác giả, không chạy Docker/AI/DB live. CI6jobs của head này đạt;
21 toolkit tests thường PASS. Review không thay live proof của Đạt.

## P2: verifier không từ chối optimized Python

`migration_provenance.py` và `verify_search_live.py` dùng assert nhưng chỉ runner
cũ có guard. `python -O -m unittest discover -s scripts/qa -p
test_migration_provenance.py -v` trên head tác giả:7tests chạy,10assertRaises
subcases FAIL. SQL dirty, forged inventory, checksum/name/head/state sai được
helper chấp nhận vì assert bị Python loại. Không dùng ví dụ head toàn0 không
tồn tại làm bằng chứng: Git vẫn lỗi; probe dùng commit fixture hợp lệ.

Gemini độc lập cũng thấy lỗi này nhưng gọi P1. Reviewer xếp P2 vì đây là tính
đúng của QA gate, chưa có bằng chứng mất tiền/đột nhập ứng dụng hay DB mutation.

Fix ứng viên: guard `sys.flags.optimize` ngay trong module dùng chung, nên cả
import library lẫn verifier CLI từ chối trước evidence/Git/DB I/O.8subcases mới
bao phủ -O/-OO/PYTHONOPTIMIZE1/2 × library/CLI.

## P2: gói có file lồng không portable Windows/Linux

Manifest POSIX `runtime/nested.json` hợp lệ được verifier Windows biến actual
path thành backslash rồi báo Unlisted evidence file. Hai probe trên Windows
trước sửa đều FAIL: POSIX nested bị từ chối; backslash manifest lại được nhận.
Đây là vấn đề có sẵn ở hash helper, được phát hiện khi review gói provenance
mới; không gán nó là regression chỉ do delta #118.

Fix ứng viên: runner/verifier cùng `.as_posix()`; từ chối backslash key để tránh
cách hiểu theo OS; log/hash JSON dùng UTF-8 rõ ràng. Gói historical giữ verifier
cũ hoặc chạy lại, không sửa hashes/provenance để gắn nhãn PASS mới.

## Retest fix trên nhánh riêng

24 toolkit tests PASS sau sửa, gồm normal inventory17/19/25 và8optimized startup
subcases,2portable path cases. Ruff check/format và diff-check được kiểm trước
commit bàn giao. Không có live Search run mới; runner/guard unit chỉ dùng fake
Docker/test temp files theo suite hiện có, không tác động database demo.

Chưa tự nhận bản sửa vào nhánh tác giả hoặc merge #118 bằng CI của source cũ.
Tác giả cần nhận commit sửa, chạy CI đúng head mới; re-review delta trước merge.
