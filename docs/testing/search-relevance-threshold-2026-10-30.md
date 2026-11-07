# Ngưỡng lọc kết quả Search — thử nghiệm local 30/10/2026

Nhánh `feat/dat/search-relevance-threshold`, nền develop `23096fa`. Trước bản
sửa, truy vấn không khớp keyword vẫn có thể lấy đủ 24 ứng viên semantic yếu.
Bản sửa cho phép loại ứng viên dưới ngưỡng và trả `items: []` để Web hiển thị
“Không có kết quả phù hợp”. Chưa merge hoặc rollout môi trường chung.

## Chính sách

- `AI_TEXT_MIN_SIMILARITY`: cosine giữa vector câu truy vấn và vector ảnh Product.
  Áp dụng `/search/text` và nhánh semantic của `/search/hybrid` trước RRF.
- `AI_IMAGE_MIN_SIMILARITY`: cosine giữa ảnh truy vấn và vector ảnh Product.
- Bằng ngưỡng được giữ; thấp hơn bị loại. Không bổ sung ứng viên yếu để đủ K.
- Keyword vẫn độc lập. Một keyword match có thể còn kết quả khi semantic rỗng;
  không so cosine với BM25 hoặc áp ngưỡng lên điểm RRF.
- Bỏ cấu hình hai biến để giữ hành vi cũ. Không đặt chuỗi rỗng vào cấu hình số.
  Schema request/response, Product/productId, index/outbox/retry không thay đổi.
- Chuỗi rỗng vẫn là lỗi input cũ. Query hợp lệ nhưng không đủ kết quả trả HTTP
  200, không trả 503; lỗi upstream vẫn giữ hành vi lỗi trước đây.

## Căn cứ chọn mức thử ban đầu

Probe chỉ đọc trên catalog demo 86 Product, hai model pin image revision
`327ab6726d33c0e22f920c83f2ff9e4bd38ca37f`, text revision
`58edf8cada9e398793dca955574a48cbb7f18be2`, CPU/offline. Đây là bộ kiểm tra
phát triển nhỏ, không phải held-out evaluation hoặc phép tính Precision/Recall.

| Query text | Max cosine quan sát trước lọc |
|---|---:|
| tai nghe USB PlayStation 3 | 0.2757 |
| loa Bluetooth | 0.2874 |
| tai nghe cổng Lightning màu trắng | 0.2231 |
| asdfghjkl qwerty zxcvbnm | 0.2270 |
| hôm nay tôi ăn cơm | 0.1955 |
| tôi muốn đặt vé máy bay | 0.2027 |
| 1234567890 | 0.2379 |
| qzxw123abc | 0.2618 |

Các khoảng điểm chồng lấp. Ví dụ Lightning có thể bị loại bởi semantic cutoff
0.265, nên không ép keyword hợp lệ phải vượt cutoff này. Mức text **0.265** chỉ
là cấu hình thử local, không chứng minh chặn mọi query vô nghĩa. Câu ngoài
chủ đề nhưng chứa từ khóa catalog vẫn có thể có kết quả từ keyword.

Đã thử 0.27 trước, nhưng câu “tai nghe chụp tai nhẹ màu trắng” có max 0.2698
và không khớp từ khóa tiếng Anh nên bị trả rỗng. Hạ mức local xuống 0.265 để
giữ các ứng viên đó, đồng thời vẫn loại các mẫu ngoài chủ đề đã thử (max 0.2618).
Đây là tuning trên cùng bộ mẫu phát triển, không phải bằng chứng tổng quát hóa.

Ảnh catalog tai nghe và loa đạt cosine gần 1 do sử dụng lại ảnh nguồn; đây chỉ
là kiểm chức năng. Ảnh xám trơn tổng hợp vẫn có max cosine **0.7829**, ảnh nhiễu
0.6204 và trang chữ tổng hợp 0.6824. Do đó 0.55 không loại được các ca âm này;
mức image thử local là **0.80**. Mức này có thể loại nhầm ảnh sản phẩm thật chụp
khác góc/ánh sáng. Chưa chứng minh tính đại diện cho ảnh người dùng hoặc ảnh người.

Không dùng self-match để kết luận chất lượng và không áp ngược hai cấu hình
này vào raw retrieval, nhãn hoặc số liệu 7 query đã khóa.

## Kiểm tra tự động

```bash
cd AI_CLIP
python -m ruff check app tests/test_relevance_threshold.py
python -m pytest -q
```

19 ca mới kiểm giới hạn cấu hình/NaN/Inf, cutoff trước limit, điểm đúng biên,
rank liên tiếp/không bù K, empty response, hai cutoff độc lập, semantic gate
trước RRF, giữ keyword và tiếp tục metadata filter. Full AI suite: **337 PASS**.

Router source đổi nên đã chạy `scripts/export_image_search_contract.py` để cập
nhật hash nguồn trong fixture Pydantic. JSON Schema và ví dụ wire không đổi.
Backend unit Search **92 PASS**; Web Search tập trung **50 PASS**. Kiểm lại build
và thao tác local được ghi trong bằng chứng của lượt triển khai, không thay
nghiệm thu toàn hệ thống.

Trước merge/rollout chung cần Hoàng–Đạt review chính sách keyword/semantic và
cấu hình môi trường. Không tự coi việc chỉnh demo local là đã triển khai develop.
