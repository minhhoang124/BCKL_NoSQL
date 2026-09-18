"""Build a small, review-only ABO JSONL + image package from the immutable source."""
import argparse
import csv
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image

PRODUCT_IDS = [
    'abo:B00JZVPC08', 'abo:B00LLJ55XG', 'abo:B00Q3OHI4I',
    'abo:B00TTC9164', 'abo:B01F2O1GRY',
]
RENEWED_ID = 'abo:B07BLDWLS2'
PENDING_IDS = ['abo:B005014LRC', 'abo:B01FSGT9D4']
EXCLUDED_ID = 'abo:B07H9QFF82'
DESCRIPTION_HOLDS = {
    'abo:B00LLJ55XG': 'Mô tả nguồn nói về đệm hỗ trợ lưng, không phải loa Bluetooth.',
    'abo:B00TTC9164': "Mô tả nguồn chỉ có câu 'An Amazon Brand', không có nội dung sản phẩm.",
    'abo:B01FSGT9D4': 'Thông số AA/AAA trong mô tả nguồn chưa xác minh đúng model bộ sạc.',
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_jsonl(path, rows):
    path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')


parser = argparse.ArgumentParser()
parser.add_argument('source_directory', type=Path)
parser.add_argument('qa_csv', type=Path)
parser.add_argument('output_directory', type=Path)
args = parser.parse_args()

source_rows = {
    row['externalId']: row
    for row in (json.loads(line) for line in (args.source_directory / 'products.jsonl').read_text(encoding='utf-8').splitlines())
}
with args.qa_csv.open(encoding='utf-8-sig', newline='') as source:
    qa_rows = {row['externalId']: row for row in csv.DictReader(source)}

all_ids = PRODUCT_IDS + [RENEWED_ID] + PENDING_IDS + [EXCLUDED_ID]
assert len(set(all_ids)) == 9 and all(item in source_rows and item in qa_rows for item in all_ids)
assert all(qa_rows[item]['status'] != 'LOẠI' and qa_rows[item]['normalizedCategory'] == 'audio' for item in PRODUCT_IDS)
assert all(qa_rows[item]['status'] == 'GIỮ' for item in PRODUCT_IDS if item not in DESCRIPTION_HOLDS)
assert qa_rows[RENEWED_ID]['status'] == 'SỬA' and 'CONDITION_PENDING' in qa_rows[RENEWED_ID]['issueCodes']
assert all('CATEGORY_MAPPING_PENDING' in qa_rows[item]['issueCodes'] for item in PENDING_IDS)
assert not source_rows['abo:B01FSGT9D4'].get('brand')
assert qa_rows[EXCLUDED_ID]['status'] == 'LOẠI'

if args.output_directory.exists() and any(args.output_directory.iterdir()):
    raise SystemExit('Output directory must be empty to avoid mixing sample versions')
args.output_directory.mkdir(parents=True, exist_ok=True)

image_evidence = []


def package_record(external_id, *, mapped_audio=False, include_image=True):
    original = source_rows[external_id]
    qa = qa_rows[external_id]
    assert original['schemaVersion'] == 1 and original['source'] == 'abo'
    assert original['externalId'] == external_id and original['name'].strip()
    asin = external_id.removeprefix('abo:')
    attributes = dict(original.get('sourceAttributes') or {})
    if external_id in DESCRIPTION_HOLDS:
        assert 'DESCRIPTION_QA_HOLD' in qa['issueCodes']
        attributes['qaFlags'] = ['DESCRIPTION_QA_HOLD']
        attributes['qaNotes'] = [DESCRIPTION_HOLDS[external_id]]
    if external_id == RENEWED_ID:
        attributes['sourceCondition'] = 'RENEWED'
    record = {
        'schemaVersion': 1,
        'source': 'abo',
        'externalId': external_id,
        'name': original['name'],
        'description': None if external_id in DESCRIPTION_HOLDS else (original.get('description') or None),
        'brand': original.get('brand') or None,
        'externalCategory': original.get('externalCategory') or None,
        'normalizedCategory': 'Electronics > Audio' if mapped_audio else None,
        'images': [],
        'sourceAttributes': attributes,
    }
    if include_image:
        source_image = args.source_directory / qa['imageSourcePath']
        assert source_image.is_file() and not source_image.is_symlink()
        with Image.open(source_image) as image:
            image.verify()
        relative_image = Path('images') / asin / '1.jpg'
        target_image = args.output_directory / relative_image
        target_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_image, target_image)
        record['images'] = [{'sourcePath': relative_image.as_posix(), 'sortOrder': 1, 'isPrimary': True}]
        image_evidence.append({'externalId': external_id, 'sourceSha256': sha256(source_image),
                               'packageSha256': sha256(target_image), 'path': relative_image.as_posix()})
        assert image_evidence[-1]['sourceSha256'] == image_evidence[-1]['packageSha256']
    return record


products = [package_record(item, mapped_audio=True) for item in PRODUCT_IDS]
renewed = [package_record(RENEWED_ID)]
pending = [package_record(item) for item in PENDING_IDS]
excluded = [{
    'schemaVersion': 1,
    'source': 'abo',
    'externalId': EXCLUDED_ID,
    'name': source_rows[EXCLUDED_ID]['name'],
    'reason': qa_rows[EXCLUDED_ID]['reason'],
}]

write_jsonl(args.output_directory / 'products.jsonl', products)
write_jsonl(args.output_directory / 'renewed_candidates.jsonl', renewed)
write_jsonl(args.output_directory / 'category_pending.jsonl', pending)
write_jsonl(args.output_directory / 'excluded.jsonl', excluded)
(args.output_directory / 'image-sha256.json').write_text(json.dumps(image_evidence, ensure_ascii=False, indent=2), encoding='utf-8')
semantic_review = []
for group, records in [('products', products), ('renewed_candidates', renewed),
                       ('category_pending', pending), ('excluded', excluded)]:
    for record in records:
        external_id = record['externalId']
        semantic_review.append({
            'externalId': external_id,
            'sampleGroup': group,
            'nameImageReview': 'MATCHES_VISIBLE_PRODUCT' if group != 'excluded' else 'EXCLUDED_FROM_SAMPLE_IMAGES',
            'descriptionReview': 'HELD_NULL' if external_id in DESCRIPTION_HOLDS else (
                'RAW_RENEWED_TEXT_NOT_FOR_IMPORT' if group == 'renewed_candidates' else (
                    'SOURCE_TEXT_REVIEWED' if record.get('description') else 'SOURCE_DESCRIPTION_EMPTY')),
            'qaDecision': qa_rows[external_id]['status'],
            'reviewNote': DESCRIPTION_HOLDS.get(external_id, 'Tên và ảnh mẫu đã được đối chiếu trực quan; không suy thông số ẩn từ ảnh.'),
        })
write_jsonl(args.output_directory / 'sample-semantic-review.jsonl', semantic_review)
(args.output_directory / 'README.txt').write_text(
    'ABO contract sample for review only: 9 records (5 products, 1 Renewed, 2 category pending, 1 excluded).\n'
    'products.jsonl uses Electronics > Audio from the current product-domain seed as a proposed mapping for Hoang to confirm; no categoryId or productId is invented.\n'
    'category_pending.jsonl is an additional holding file permitted by the PR #14 comment.\n'
    'Renewed and category-pending records must not be imported or indexed. Excluded record has no packaged image.\n'
    'One category-pending record has brand=null to exercise the nullable-brand contract without inventing a category.\n'
    'sample-semantic-review.jsonl records the manual name/image/description check for each of the nine records.\n'
    'Original ABO package remains untouched. Every packaged image was verified and has the same SHA-256 as its source.\n',
    encoding='utf-8',
)
print(json.dumps({'products': len(products), 'renewed': len(renewed), 'categoryPending': len(pending),
                  'excluded': len(excluded), 'images': len(image_evidence)}))
