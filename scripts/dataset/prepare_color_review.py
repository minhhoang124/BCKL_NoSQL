"""Prepare source-backed color proposals without modifying ABO source files."""
import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('reference_csv', type=Path)
parser.add_argument('review_csv', type=Path)
parser.add_argument('output_jsonl', type=Path)
args = parser.parse_args()

with args.reference_csv.open(encoding='utf-8-sig', newline='') as f:
    reference = {'abo:' + r['externalId']: r for r in csv.DictReader(f)}
with args.review_csv.open(encoding='utf-8-sig', newline='') as f:
    reviewed = list(csv.DictReader(f))
assert len(reference) == len(reviewed) == 1200

raw_map = {
    'black':'Black', 'blk':'Black', 'white':'White', 'red':'Red', 'blue':'Blue',
    'green':'Green', 'yellow':'Yellow', 'pink':'Pink', 'purple':'Purple',
    'orange':'Orange', 'gold':'Gold', 'silver':'Silver', 'sliver':'Silver',
    'silver colours':'Silver', 'gray':'Gray', 'grey':'Gray',
    'dark grey':'Dark Gray', 'light grey':'Light Gray', 'bright orange':'Bright Orange',
    'electric blue':'Electric Blue', 'lime green':'Lime Green', 'champagne':'Champagne',
    'rose gold':'Rose Gold', 'rosegold':'Rose Gold', 'clear':'Transparent',
    'transparent':'Transparent', 'multicolor':'Multicolor', 'multi-colored':'Multicolor',
    'multicolour':'Multicolor', 'blue/green':'Blue/Green',
    'green / yellow':'Green/Yellow', 'yellow & blue':'Yellow/Blue',
    'black/red':'Black/Red', 'black / red':'Black/Red', 'black+red':'Black/Red',
    'gray and black':'Gray/Black', 'gray blue':'Gray/Blue',
    'brass/white':'Brass/White',
}
generic = {'others'}
ambiguous = {'adapter','blackadaafgew','gen202','gen287','gray interior','orange interior'}
known = set(raw_map) | generic | ambiguous
colors_in_source = {r['color'].strip().casefold() for r in reference.values() if r['color'].strip()}
assert colors_in_source <= known, f'Unreviewed source colors: {colors_in_source-known}'

title_re = re.compile(r'(?<![a-z])(transparent|clear|rosegold|rose gold|black|white|red|blue|green|yellow|pink|purple|grey|gray|silver|gold|orange|brown|beige|ivory|champagne)(?![a-z])', re.I)
title_map = {'clear':'Transparent','transparent':'Transparent','grey':'Gray','gray':'Gray','rosegold':'Rose Gold'}

def title_colors(name):
    result = []
    for hit in title_re.findall(name):
        value = title_map.get(hit.casefold(), hit.title())
        if value not in result:
            result.append(value)
    return result

def color_matches_source(title_color, source_color):
    """A title can name a base color while the metadata names its shade."""
    return any(part == title_color or part.endswith(' ' + title_color)
               for part in source_color.split('/'))

output = []
for row in reviewed:
    external_id = row['externalId']
    source = reference[external_id]
    raw = source['color'].strip()
    norm = raw_map.get(raw.casefold())
    title = title_colors(row['name'])
    proposal = ''
    if raw.casefold() in ambiguous:
        decision = 'REVIEW_INVALID_SOURCE'
        reason = 'Giá trị color nguồn không phải màu chuẩn hoặc chỉ mô tả màu bên trong.'
    elif norm:
        if title and not all(color_matches_source(c, norm) for c in title) and norm != 'Multicolor':
            decision = 'REVIEW_CONFLICT'
            reason = 'Màu trong tên không khớp cột color nguồn; cần xem ảnh và listing.'
        elif title and norm == 'Multicolor' and len(title) == 1:
            decision = 'REVIEW_MULTICOLOR'
            reason = 'Nguồn ghi đa màu nhưng tên chỉ nêu một màu; cần xem ảnh.'
        else:
            proposal = norm
            decision = 'PROPOSED_SOURCE_AND_TITLE' if title else 'PROPOSED_SOURCE_ONLY'
            reason = 'Chuẩn hóa cách viết của cột color nguồn; tên phù hợp hoặc không nêu màu.'
    elif len(title) == 1:
        proposal = title[0]
        decision = 'PROPOSED_TITLE_ONLY'
        reason = 'Nguồn thiếu màu cụ thể; tên sản phẩm nêu rõ một màu. Cần kiểm tra ảnh trước import.'
    elif len(title) > 1:
        decision = 'REVIEW_MULTIPLE_TITLE_COLORS'
        reason = 'Tên nêu nhiều màu hoặc nhiều bộ phận/biến thể; cần xem ảnh.'
    else:
        decision = 'NO_COLOR_EVIDENCE'
        reason = 'Cả cột color nguồn và tên đều không có màu cụ thể.'
    output.append({
        'externalId': external_id, 'qaStatus': row['status'], 'sourceColor': raw,
        'titleColors': title, 'proposedColor': proposal, 'decision': decision,
        'reason': reason, 'evidence': 'ABO metadata_reference.csv + products.jsonl/name',
    })

assert len(output) == len({r['externalId'] for r in output}) == 1200
args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
args.output_jsonl.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in output), encoding='utf-8')
print(json.dumps({'records':len(output),'decisions':dict(Counter(r['decision'] for r in output))},ensure_ascii=True))
