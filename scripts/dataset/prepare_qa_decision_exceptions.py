"""List unresolved ABO QA decisions by externalId without changing source data."""
import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / 'docs' / 'data-quality'
with (root / 'abo-electronics-1200-status.csv').open(encoding='utf-8-sig', newline='') as source:
    products = list(csv.DictReader(source))
descriptions = {
    row['externalId']: row
    for row in (json.loads(line) for line in (root / 'abo-electronics-173-description-sources.jsonl').read_text(encoding='utf-8').splitlines())
}

rows = []
for item in products:
    flags = []
    if item['status'] == 'LOẠI':
        flags.append('EXCLUDE')
    if 'CATEGORY_MAPPING_PENDING' in item['issueCodes']:
        flags.append('CATEGORY_MAPPING_PENDING')
    if 'Renewed' in item['name'] and item['status'] != 'LOẠI':
        flags.append('CONDITION_RENEWED_PENDING')
    if item['externalId'] in {'abo:B00GN8WAHE', 'abo:B01FSGT9D4'}:
        flags.append('BRAND_UNVERIFIED_NULL')
    if descriptions.get(item['externalId'], {}).get('decision') == 'OFFICIAL_TEXT_CANDIDATE':
        flags.append('DESCRIPTION_MODEL_CHECK_PENDING')
    if 'DESCRIPTION_QA_HOLD' in item['issueCodes']:
        flags.append('DESCRIPTION_QA_HOLD')
    if flags:
        rows.append({
            'externalId': item['externalId'],
            'qaStatus': item['status'],
            'exceptionFlags': ';'.join(flags),
            'sourceIssueCodes': item['issueCodes'],
            'importDisposition': item['importDisposition'],
            'publicationApproved': item['publicationApproved'],
        })

output = root / 'abo-qa-decision-exceptions.csv'
with output.open('w', encoding='utf-8-sig', newline='') as target:
    writer = csv.DictWriter(target, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)

assert len(products) == 1200
assert sum('EXCLUDE' in row['exceptionFlags'] for row in rows) == 23
assert sum('CATEGORY_MAPPING_PENDING' in row['exceptionFlags'] for row in rows) == 397
assert sum('CONDITION_RENEWED_PENDING' in row['exceptionFlags'] for row in rows) == 146
assert sum('BRAND_UNVERIFIED_NULL' in row['exceptionFlags'] for row in rows) == 2
assert sum('DESCRIPTION_QA_HOLD' in row['exceptionFlags'] for row in rows) == 3
print(f'{len(rows)} externalIds with one or more decision exceptions')
