"""Cross-reference missing descriptions with official ABO listing metadata."""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('products_jsonl', type=Path)
parser.add_argument('review_csv', type=Path)
parser.add_argument('official_matches_jsonl', type=Path)
parser.add_argument('output_jsonl', type=Path)
args = parser.parse_args()

products = {r['externalId']: r for r in map(json.loads, args.products_jsonl.open(encoding='utf-8'))}
with args.review_csv.open(encoding='utf-8-sig', newline='') as f:
    reviewed = {r['externalId']: r for r in csv.DictReader(f)}
official = {r['externalId']: r for r in map(json.loads, args.official_matches_jsonl.open(encoding='utf-8'))}
assert len(products) == len(reviewed) == len(official) == 1200

rows = []
for external_id, product in products.items():
    if (product.get('description') or '').strip():
        continue
    matches = []
    for candidate in official[external_id]['candidates']:
        content = []
        for field in ('product_description', 'bullet_point'):
            for entry in candidate.get(field) or []:
                value = (entry.get('value') or '').strip()
                if value:
                    content.append({'field': field, 'language': entry.get('language_tag'),
                                    'excerpt': value[:320]})
        if content:
            english = [e for e in content if (e['language'] or '').startswith('en_')]
            other = [e for e in content if not (e['language'] or '').startswith('en_')]
            evidence = (english + other)[:24]
            matches.append({
                'sourceUrl': candidate['sourceUrl'], 'domain': candidate['domain'],
                'listingTitle': candidate['title'],
                'titleSimilarity': candidate['titleSimilarity'],
                'availableTextCount': len(content),
                'languages': sorted({e['language'] for e in content if e['language']}),
                'textEvidence': evidence,
            })
    excluded = reviewed[external_id]['status'] == 'LOẠI'
    decision = ('EXCLUDED_FROM_CLEAN_SET' if excluded else
                'OFFICIAL_TEXT_CANDIDATE' if matches else 'NO_OFFICIAL_TEXT')
    flags = []
    if matches and max(x['titleSimilarity'] for x in matches) < 0.99:
        flags.append('LISTING_TITLE_DIFFERS')
    if matches and not any(lang.startswith('en_') for x in matches for lang in x['languages']):
        flags.append('NON_ENGLISH_ONLY')
    if external_id in {'abo:B01N1OX4D3', 'abo:B07PZ8GHXY',
                       'abo:B01IIDOWDQ', 'abo:B01IIDP4UG'}:
        flags.append('CHECK_CAPACITY_OR_POWER_VARIANT')
    rows.append({
        'externalId': external_id, 'qaStatus': reviewed[external_id]['status'],
        'name': product['name'], 'decision': decision,
        'source': 'Amazon Berkeley Objects official listings metadata',
        'sourceHome': 'https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/index.html',
        'officialListingCount': len(official[external_id]['candidates']),
        'evidenceListings': matches,
        'reviewFlags': flags,
        'followUpSearchQuery': external_id.split(':', 1)[1] + ' ' + product['name'],
        'proposedDescription': '',
        'reviewNote': ('Mã đang LOẠI; không bổ sung mô tả.' if excluded else
                       'Chỉ là nguồn ứng viên. Đối chiếu đúng biến thể, ngôn ngữ và thông số trước khi viết mô tả.' if matches else
                       'ABO không có mô tả/bullet bổ sung; chỉ dùng tài liệu hãng hoặc nhãn ảnh xác minh được.'),
    })

assert len(rows) == 173
args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
args.output_jsonl.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
print(json.dumps({'records': len(rows), 'decision': dict(Counter(r['decision'] for r in rows)),
                  'withOfficialText': sum(bool(r['evidenceListings']) for r in rows)}, ensure_ascii=True))
