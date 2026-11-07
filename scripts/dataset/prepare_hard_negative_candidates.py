"""Suggest visually similar ABO products for independent image-query judging."""
import argparse
import csv
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('query_manifest', type=Path)
parser.add_argument('review_csv', type=Path)
parser.add_argument('output_jsonl', type=Path)
args = parser.parse_args()

queries = {r['externalId']: r for r in map(json.loads, args.query_manifest.open(encoding='utf-8'))}
with args.review_csv.open(encoding='utf-8-sig', newline='') as f:
    reviewed = {r['externalId']: r for r in csv.DictReader(f)}

groups = [
    ('lightning_cable', ['B07DDK15FN', 'B07DDPQ1HZ', 'B07DDN6RKK',
                         'B07DDPNBJZ', 'B07DDPQ1JD'], 'color_or_length_variant'),
    ('metal_monitor_stand', ['B017DORX3M', 'B017DOS5C0'], 'color_variant'),
    ('monitor_arm', ['B07DHK5DHN', 'B07DHNHZ2Y'], 'single_vs_dual_arm'),
]

rows = []
for group, asins, distinction in groups:
    ids = ['abo:' + asin for asin in asins]
    assert all(item in queries and reviewed[item]['status'] == 'GIỮ' for item in ids)
    for anchor in ids:
        for candidate in ids:
            if candidate == anchor:
                continue
            rows.append({
                'queryId': queries[anchor]['queryId'],
                'anchorExternalId': anchor,
                'candidateExternalId': candidate,
                'candidateName': reviewed[candidate]['name'],
                'group': group,
                'distinctionToCheck': distinction,
                'relevance': None,
                'labelStatus': 'UNJUDGED_DAT_REVIEW',
                'note': 'Ứng viên khó; không mặc định relevance=0. Ảnh có thể không cho biết độ dài hoặc đủ bộ phận.',
            })

assert len(rows) == 24
args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
args.output_jsonl.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
print(json.dumps({'candidates': len(rows), 'queryIds': len({r['queryId'] for r in rows}),
                  'labeled': sum(r['relevance'] is not None for r in rows)}))
