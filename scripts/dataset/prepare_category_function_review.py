"""Prepare function-based review buckets; never assign final categoryId."""
import csv
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / 'docs/data-quality/abo-electronics-1200-status.csv'
output = root / 'docs/data-quality/abo-category-function-review.csv'

# Ordered, deliberately conservative clues from the title and source category.
rules = [
    ('storage_card', r'\bmicrosd\b|\bmicrosdhc\b|\bsd card\b|flash memory card'),
    ('printing_material', r'filament|3d printer material'),
    ('motion_sensor', r'^gira .*switch|motion sensor|motion detector'),
    ('video_switcher', r'\bhdmi\b.*\b\d+x\d+ switch\b|selector box'),
    ('lighting', r'\bled\b.*\bbulb\b|light bulb|lamp bulb|spotlight bulb'),
    ('power_inverter', r'\binverter\b|dc.?ac converter'),
    ('electrical_cord', r'extension cord|power cord|electrical extension|outdoor extension'),
    ('battery', r'\bbatter(y|ies)\b|\balkaline\b|\bnimh\b|\blithium ion\b|\bcr20\d\d\b|\bcr16\d\d\b|\bcoin cell\b'),
    ('charger', r'\bcharger\b|charging station|charging dock|charge station|charging pad|wireless charging'),
    ('network_device', r'ethernet adapter|network adapter|wifi adapter|wi.?fi router|network switch|network hub'),
    ('signal_adapter', r'\badapter\b|\bconverter\b|\bdongle\b'),
    ('cable', r'\bcable\b|\bcord\b|\bwire\b|\bhdmi\b|\brj45\b'),
    ('paper_shredder', r'\bshredder\b|shredding'),
    ('label_printer', r'label maker|label printer'),
    ('privacy_filter', r'privacy screen'),
    ('projection_screen', r'projection screen|projector screen|screen for projector'),
    ('projector', r'\bprojector\b|video projector'),
    ('tv_display', r'\btelevision\b|\btv\b|\bmonitor\b|display screen'),
    ('display_mount', r'\bmount\b|monitor stand|tv stand|monitor arm|headrest holder|bracket'),
    ('security_device', r'\bsafe\b|security camera|surveillance|doorbell'),
    ('protective_case', r'\bcase\b|\bcover\b'),
    ('audio_accessory', r'headphone splitter|audio splitter|banana plugs'),
]

hard_ids = set('''B000UW91EY B07QWSGQK7 B07QWSHH1N B07QYTNK1M B07QYTR5GF B07QZYDYHN
B06XT2FR5Q B07674HN3M B07674HN3P B07676NXCH B07677TJ3G B076783WZZ B07678VMLW
B07678VMM1 B0767B356W B07W42KQ3M B07KGKJLB4 B07KGKW4Q8 B07KGKZ7XP B07KGN19LQ
B07H9QFF82 B07TPLLSJG B07TPMH44Q'''.split())

hard_groups = {
    'motion_sensor': {'B000UW91EY'},
    'lighting': {'B07QWSGQK7', 'B07QWSHH1N', 'B07QYTNK1M', 'B07QYTR5GF', 'B07QZYDYHN'},
    'data_cable': {'B06XT2FR5Q'},
    'electrical_cord': {'B07674HN3M', 'B07674HN3P', 'B07676NXCH', 'B07677TJ3G', 'B076783WZZ', 'B07678VMLW', 'B07678VMM1', 'B0767B356W', 'B07W42KQ3M'},
    'mount': {'B07KGKJLB4', 'B07KGKW4Q8', 'B07KGKZ7XP', 'B07KGN19LQ'},
    'printing_material': {'B07H9QFF82'},
    'power_inverter': {'B07TPLLSJG', 'B07TPMH44Q'},
}
assert set.union(*hard_groups.values()) == hard_ids

# Review corrections from Đạt on 17/09. These remain function suggestions, not leaf categories.
review_corrections = {
    'B005HKPWAQ': ('storage_card', 'Thẻ microSD; SD adapter chỉ là phụ kiện đi kèm.'),
    'B00M77HMU0': ('network_adapter', 'USB-to-Ethernet adapter; chức năng chính là kết nối mạng.'),
    'B071Y6Y83W': ('network_adapter', 'USB Wi-Fi adapter; chức năng chính là kết nối mạng.'),
    'B01N6E557C': ('power_adapter', 'AC adapter cấp nguồn cho Nintendo; không phải adapter tín hiệu.'),
    'B08CS6X36V': ('usb_hub', 'USB 3.0 hub; AC adapter đi kèm không phải chức năng chính.'),
    'B07W42KQ3M': ('electrical_cord', 'Nguồn Elektroinstallation và ảnh dây nối điện; không gọi cáp dữ liệu chung.'),
    'B079L8VZ5R': ('video_switcher', 'Tên HDMI 5x1 Switch, nguồn Selector Boxes và ảnh hộp chuyển; HDMI không đồng nghĩa cáp.'),
    'B000UW91EY': ('motion_sensor', 'Gira 0831 10 là Observer 70 theo tài liệu hãng; cần đối chiếu mã listing trước khi sửa tên.'),
}

with source.open(encoding='utf-8-sig', newline='') as f:
    pending = [row for row in csv.DictReader(f) if 'CATEGORY_MAPPING_PENDING' in row['issueCodes'] or row['externalId'] == 'abo:B07H9QFF82']

rows = []
for item in pending:
    title = item['name'].lower()
    matches = [bucket for bucket, pattern in rules if re.search(pattern, title)]
    # Multiple title clues (e.g. charger and cable in a kit) require human choice.
    suggested = matches[0] if len(matches) == 1 else ''
    review = 'HARD_CASE_23' if item['externalId'][4:] in hard_ids else ('MULTIPLE_FUNCTIONS' if len(matches) > 1 else ('NO_TITLE_CLUE' if not matches else 'VERIFY_SOURCE_AND_IMAGE'))
    hard_bucket = next((bucket for bucket, ids in hard_groups.items() if item['externalId'][4:] in ids), '')
    correction = review_corrections.get(item['externalId'][4:])
    if correction:
        suggested = correction[0]
    image_note = {
        'motion_sensor': 'Ảnh có thiết bị GIRA dạng cảm biến; chức năng xác nhận bằng tài liệu Gira 0831 10, còn phải khớp mã listing.',
        'lighting': 'Ảnh có bóng đèn/spotlight; cần đối chiếu đúng loại đui, công suất và pack theo tên.',
        'data_cable': 'Ảnh có hai đầu USB-C và dây nối; không phải bộ sạc.',
        'electrical_cord': 'Ảnh có dây nối điện và ổ cắm/phích cắm; chưa xác minh chiều dài chỉ từ ảnh.',
        'mount': 'Ảnh có cụm giá đỡ/kẹp; thiết bị tương thích cần kiểm tra theo model.',
        'printing_material': 'Ảnh có cuộn sợi in 3D; không phải tai nghe.',
        'power_inverter': 'Ảnh có bộ đổi điện dùng đầu cắm xe; cần xác minh thông số DC–AC từ nguồn.',
    }.get(hard_bucket, '')
    rows.append({
        'externalId': item['externalId'],
        'qaStatus': item['status'],
        'previousBucket': item['normalizedCategory'],
        'name': item['name'],
        'externalCategory': item['externalCategory'],
        'productTypeForCrossCheckOnly': item['productType'],
        'imageSourcePath': item['imageSourcePath'],
        'functionalBucketCandidate': suggested,
        'titleClues': ';'.join(matches),
        'reviewFlag': review,
        'hardCaseFunctionalGroup': hard_bucket,
        'hardCaseImageObservation': image_note,
        'reviewCorrectionNote': correction[1] if correction else '',
        'categoryId': '',
        'decisionStatus': 'EXCLUDED_OUT_OF_SCOPE' if item['status'] == 'LOẠI' else 'CATEGORY_MAPPING_PENDING',
    })

assert len(rows) == 398  # Original 398 reviewed: 397 pending and one now excluded.
assert sum(row['reviewFlag'] == 'HARD_CASE_23' for row in rows) == 23
with output.open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
hard_output = root / 'docs/data-quality/abo-category-hard-23.csv'
with hard_output.open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(row for row in rows if row['reviewFlag'] == 'HARD_CASE_23')
print(f'{len(rows)} historically reviewed, {sum(row["decisionStatus"] == "CATEGORY_MAPPING_PENDING" for row in rows)} pending, 23 original hard cases')
