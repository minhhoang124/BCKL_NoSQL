"""Stage ABO 360-view query photos separately from catalog images."""
import argparse
import csv
import gzip
import hashlib
import json
import urllib.request
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('products_jsonl', type=Path)
parser.add_argument('review_csv', type=Path)
parser.add_argument('official_matches_jsonl', type=Path)
parser.add_argument('spins_csv_gz', type=Path)
parser.add_argument('catalog_root', type=Path)
parser.add_argument('staging_dir', type=Path)
parser.add_argument('output_jsonl', type=Path)
args = parser.parse_args()

products = {r['externalId']: r for r in map(json.loads, args.products_jsonl.open(encoding='utf-8'))}
with args.review_csv.open(encoding='utf-8-sig', newline='') as f:
    reviewed = {r['externalId']: r for r in csv.DictReader(f)}
official = {r['externalId']: r for r in map(json.loads, args.official_matches_jsonl.open(encoding='utf-8'))}
spin_to_id = {r['candidates'][0]['spin_id']: r['externalId'] for r in official.values()
              if r['candidates'][0].get('spin_id') and reviewed[r['externalId']]['status'] == 'GIỮ'}
with gzip.open(args.spins_csv_gz, 'rt', encoding='utf-8', newline='') as f:
    spin_rows = [r for r in csv.DictReader(f) if r['spin_id'] in spin_to_id and r['azimuth'] == '18']
assert len(spin_rows) == len(spin_to_id) == 11

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

args.staging_dir.mkdir(parents=True, exist_ok=True)
result = []
for item in sorted(spin_rows, key=lambda r: spin_to_id[r['spin_id']]):
    external_id = spin_to_id[item['spin_id']]
    asin = external_id.split(':', 1)[1]
    url = 'https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/spins/original/' + item['path']
    target = args.staging_dir / (asin + '-spin18.jpg')
    if not target.exists():
        urllib.request.urlretrieve(url, target)
    with Image.open(target) as image:
        image.verify()
    catalog = args.catalog_root / products[external_id]['images'][0]['sourcePath']
    if not catalog.is_file():
        raise FileNotFoundError(catalog)
    query_hash, catalog_hash = digest(target), digest(catalog)
    assert query_hash != catalog_hash, external_id
    result.append({
        'queryId': 'IMG-IND-' + asin, 'externalId': external_id,
        'positiveExternalIds': [external_id], 'qaStatus': 'GIỮ',
        'name': products[external_id]['name'], 'captureType': 'ABO_360_VIEW',
        'spinId': item['spin_id'], 'azimuthIndex': 18,
        'imageSourceUrl': url, 'imageSha256': query_hash,
        'catalogImageSha256': catalog_hash,
        'localStagingFile': target.name,
        'license': 'CC BY 4.0', 'attribution': 'Amazon.com / Amazon Berkeley Objects',
        'visualReview': 'Ảnh spin và catalog cùng loại sản phẩm; biến thể/độ dài cần đối chiếu metadata.',
        'labelStatus': 'PROPOSED_POSITIVE_REQUIRES_VARIANT_CONFIRMATION',
        'productId': None,
    })

args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
args.output_jsonl.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in result), encoding='utf-8')
print(json.dumps({'queryImages': len(result), 'distinctProducts': len({r['externalId'] for r in result}),
                  'allDifferentFromCatalog': True}))
