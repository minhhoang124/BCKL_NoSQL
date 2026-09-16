"""Validate final review integrity without changing source or publishing data."""
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from finalize_abo_review import CATEGORY_FIXES, CATEGORY_PENDING_REVIEW

root = Path(sys.argv[1])
def read(name):
    with (root / name).open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))
rows = read('abo_review_final.csv')
actions = read('abo_review_actions.csv')
by_id = {r['externalId']: r for r in rows}
assert len(rows) == len(by_id) == 1200
assert all(r['externalId'].startswith('abo:') for r in rows)
assert actions == [r for r in rows if r['status'] != 'GIỮ']
assert not (set(CATEGORY_FIXES) & set(CATEGORY_PENDING_REVIEW))
assert len(CATEGORY_FIXES) + len(CATEGORY_PENDING_REVIEW) == 23
assert {r['externalId'] for r in rows if 'CATEGORY_MISMATCH' in r['issueCodes']} == set(CATEGORY_FIXES)
for external_id in CATEGORY_PENDING_REVIEW:
    row = by_id[external_id]
    assert row['status'] == 'SỬA'
    assert 'CATEGORY_MAPPING_PENDING' in row['issueCodes']
    assert not row['proposedNormalizedCategory']
for external_id, category in CATEGORY_FIXES.items():
    row = by_id[external_id]
    assert row['status'] == 'SỬA'
    assert row['proposedNormalizedCategory'] == category
    assert 'CATEGORY_MAPPING_PENDING' in row['issueCodes']
for r in rows:
    assert r['status'] in {'GIỮ', 'SỬA', 'LOẠI'}
    assert r['publicationApproved'] == 'false'
    assert r['importDisposition'] == ('EXCLUDE' if r['status'] == 'LOẠI' else 'DRAFT_ONLY')
    if r['duplicateOf']:
        assert r['duplicateOf'] in by_id and by_id[r['duplicateOf']]['status'] != 'LOẠI'
    if r['status'] != 'LOẠI' and ('renewed' in r['name'].lower() or r['normalizedCategory'] in {'network_security','office_display','power_adapter'}):
        assert r['status'] == 'SỬA'
summary = json.loads((root / 'abo_review_summary.json').read_text(encoding='utf-8'))
assert dict(Counter(r['status'] for r in rows)) == summary['statusCounts']
missing = [r['externalId'] for r in rows if r['status'] != 'LOẠI' and 'BRAND_MISSING' in r['issueCodes'] and not r['proposedBrand']]
assert len(missing) == summary['unresolvedMissingBrandCount']
print(json.dumps({'counts': summary['statusCounts'], 'actions': len(actions), 'unresolvedBrands': missing, 'validation': 'PASS'}, ensure_ascii=True))
