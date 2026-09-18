"""Split independent image pilot judgments by evaluation objective."""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def read_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]


def write_jsonl(path: Path, rows):
    path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')


parser = argparse.ArgumentParser()
parser.add_argument('query_manifest', type=Path)
parser.add_argument('candidate_manifest', type=Path)
parser.add_argument('output_directory', type=Path)
args = parser.parse_args()

queries = read_jsonl(args.query_manifest)
candidates = read_jsonl(args.candidate_manifest)
by_anchor = defaultdict(list)
for candidate in candidates:
    by_anchor[candidate['anchorExternalId']].append(candidate)

ambiguous_ids = {'abo:B07DDK15FN', 'abo:B07DDPQ1HZ'}
exact_rows = []
for query in queries:
    anchor = query['externalId']
    is_ambiguous_length_query = anchor in ambiguous_ids
    exact_rows.append({
        'queryId': query['queryId'],
        'queryExternalId': anchor,
        'positiveExternalIds': [anchor],
        'negativeExternalIds': [row['candidateExternalId'] for row in by_anchor[anchor]],
        'objective': 'EXACT_PRODUCT',
        'metricEligible': not is_ambiguous_length_query,
        'visualDetermination': 'NOT_DETERMINABLE_FROM_IMAGE' if is_ambiguous_length_query else 'REVIEWED_PILOT',
        'exclusionReason': 'Ảnh không xác định được cáp đen dài 6 ft hay 10 ft; không dùng để kiểm tra AI phân biệt độ dài.' if is_ambiguous_length_query else None,
        'labelStatus': 'PROPOSED_DAT_FINAL_REVIEW',
        'productId': None,
    })

similar_rows = []
for candidate in candidates:
    black_length_pair = {candidate['anchorExternalId'], candidate['candidateExternalId']} == ambiguous_ids
    similar_rows.append({
        'queryId': candidate['queryId'],
        'queryExternalId': candidate['anchorExternalId'],
        'candidateExternalId': candidate['candidateExternalId'],
        'candidateName': candidate['candidateName'],
        'group': candidate['group'],
        'objective': 'SIMILAR_PRODUCT',
        'relevance': None,
        'visualDetermination': 'NOT_DETERMINABLE_FROM_IMAGE' if black_length_pair else 'REQUIRES_RELEVANCE_CRITERIA',
        'labelStatus': 'UNJUDGED_CRITERIA_PENDING',
        'note': 'Không gán mặc định relevance=0 cho biến thể khác màu/cấu hình. Chốt tiêu chí liên quan trước khi đo.',
    })

assert len(queries) == 11 and len(candidates) == 24
assert len({row['queryId'] for row in exact_rows}) == 11
assert sum(not row['metricEligible'] for row in exact_rows) == 2
assert sum(row['visualDetermination'] == 'NOT_DETERMINABLE_FROM_IMAGE' for row in similar_rows) == 2
args.output_directory.mkdir(parents=True, exist_ok=True)
write_jsonl(args.output_directory / 'exact-product-labels.jsonl', exact_rows)
write_jsonl(args.output_directory / 'similar-product-labels.jsonl', similar_rows)
print(json.dumps({'exactQueries': 11, 'exactMetricEligible': 9, 'similarCandidates': 24,
                  'ambiguousLengthPairs': 2}))
