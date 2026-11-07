"""Prepare reproducible query manifests; never assign production product IDs."""
import csv
import hashlib
import json
from pathlib import Path
import argparse

p = argparse.ArgumentParser()
p.add_argument('review_csv', type=Path)
p.add_argument('dataset_root', type=Path)
p.add_argument('output_dir', type=Path)
a = p.parse_args()
with a.review_csv.open(encoding='utf-8-sig', newline='') as f:
    rows = {r['externalId']: r for r in csv.DictReader(f)}
anchors = [
 ('B002VPE1NO', 'ốp lưng iPhone 3G hoặc 3GS màu đỏ đen'),
 ('B0050SXMNE', 'tai nghe có dây USB để trò chuyện trên PlayStation 3'),
 ('B003ES61EE', 'bút vệ sinh ống kính máy ảnh'),
 ('B00ESJGNBO', 'ốp iPhone 5C màu xanh lá và vàng'),
 ('B00BI9ME3S', 'tai nghe trò chuyện cho Nintendo Wii U'),
 ('B074SZZLKM', 'ốp trong suốt cho iPhone 7 hoặc 8'),
 ('B07DR8NQWT', 'giá đỡ điện thoại trên ô tô xoay 360 độ màu đen'),
 ('B005KP47RC', 'chân máy ảnh linh hoạt cho máy ảnh compact'),
 ('B003JBHQP4', 'đầu đọc thẻ nhớ USB 2.0 hỗ trợ 21 loại'),
 ('B07H96HZBJ', 'ốp trong suốt cho điện thoại Pocophone F1'),
 ('B003M0NT1M', 'ổ đĩa DVD gắn ngoài kết nối USB 2.0'),
 ('B00JZVPC08', 'loa Bluetooth màu đỏ hai loa 3W có micro'),
 ('B00JZVPGD6', 'loa Bluetooth màu xanh hai loa 3W có micro'),
 ('B00DHPCSA0', 'chân máy ảnh du lịch sợi carbon 52 inch có túi'),
 ('B004ELB7OY', 'USB lưu trữ 4GB chuẩn USB 2.0'),
 ('B004Q3R9B0', 'thẻ nhớ SDHC 8GB Class 4'),
 ('B004Q3R9BA', 'thẻ nhớ SDHC 16GB Class 4'),
 ('B004Q3R9BK', 'thẻ nhớ SDHC 32GB Class 4'),
 ('B00FAYL1YU', 'chân máy ảnh một chân 67 inch'),
 ('B0051U0I10', 'cáp mạng Cat5e RJ45 Exacon dài 15.2 mét'),
]
queries, labels = [], []
for i, (source_id, text) in enumerate(anchors, 1):
    external_id = 'abo:' + source_id
    r = rows[external_id]
    assert r['status'] == 'GIỮ', external_id
    path = (a.dataset_root / r['imageSourcePath']).resolve()
    assert path.is_relative_to(a.dataset_root.resolve()) and path.is_file()
    for mode in ('image', 'text'):
        query_id = f'{mode.upper()}-{i:03}'
        queries.append({
            'queryId': query_id, 'mode': mode,
            'text': text if mode == 'text' else None,
            'imageSourcePath': r['imageSourcePath'] if mode == 'image' else None,
            'imageSha256': hashlib.sha256(path.read_bytes()).hexdigest() if mode == 'image' else None,
            'anchorExternalId': external_id, 'productId': None,
            'sourceName': r['name'], 'category': r['normalizedCategory'],
            'split': 'development_smoke', 'status': 'AWAITING_PEER_REVIEW',
        })
        labels.append({
            'queryId': query_id, 'externalId': external_id, 'relevance': 2,
            'basis': 'same_catalog_image' if mode == 'image' else 'source_title_matches_query',
            'labelStatus': 'PROPOSED', 'judgedBy': 'Hien-assistant',
            'reviewedBy': None, 'exhaustive': False,
        })
a.output_dir.mkdir(parents=True, exist_ok=True)
for name, entries in [('queries.jsonl', queries), ('ground-truth-proposed.jsonl', labels)]:
    (a.output_dir / name).write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in entries), encoding='utf-8')
assert len({q['queryId'] for q in queries}) == len(queries) == 40
print('PASS: 20 image queries, 20 text queries, 40 proposed relevance labels; no production IDs.')
