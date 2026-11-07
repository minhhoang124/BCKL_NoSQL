"""Fetch only matching ABO listing metadata into a local review file."""
import argparse
import gzip
import io
import json
import time
import urllib.request
import xml.etree.ElementTree as ET
from difflib import SequenceMatcher
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('source_jsonl', type=Path)
p.add_argument('output_jsonl', type=Path)
a = p.parse_args()
target = {r['externalId'].split(':', 1)[1]: r['name'] for r in (json.loads(line) for line in a.source_jsonl.open(encoding='utf-8'))}
base = 'https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/'
headers = {'User-Agent': 'ABO-thesis-data-review/1.0'}
cache = a.output_jsonl.parent / 'official-shards'
cache.mkdir(parents=True, exist_ok=True)
def fetch(url, path):
    if path.exists():
        return path.read_bytes()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=90) as response:
                data = response.read()
            path.write_bytes(data)
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
root = ET.fromstring(fetch(base + '?list-type=2&prefix=listings/metadata/', cache / 'index.xml'))
ns = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
keys = [x.findtext('s:Key', namespaces=ns) for x in root.findall('s:Contents', ns)]
keys = [key for key in keys if key and key.endswith('.json.gz')]
assert keys, 'No official metadata shards found'
found = {}
for i, key in enumerate(keys, 1):
    data = fetch(base + key, cache / key.rsplit('/', 1)[-1])
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
        for line in gz:
            listing = json.loads(line)
            item_id = listing.get('item_id')
            if item_id in target:
                titles = listing.get('item_name', [])
                english = [x['value'] for x in titles if x.get('language_tag') in ('en_US', 'en_GB')]
                title = english[0] if english else (titles[0]['value'] if titles else '')
                match = SequenceMatcher(None, title.casefold(), target[item_id].casefold()).ratio()
                found.setdefault(item_id, []).append({
                    'sourceUrl': base + key,
                    'domain': listing.get('domain_name'),
                    'title': title,
                    'titleSimilarity': round(match, 4),
                    'color': listing.get('color', []),
                    'product_description': listing.get('product_description', []),
                    'bullet_point': listing.get('bullet_point', []),
                    'spin_id': listing.get('spin_id'),
                })
    print(f'shard {i}/{len(keys)}: matched {len(found)}/{len(target)}', flush=True)
a.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
a.output_jsonl.write_text(''.join(json.dumps({'externalId':'abo:'+k,'sourceName':target[k],'candidates':sorted(found.get(k,[]),key=lambda x:x['titleSimilarity'],reverse=True)}, ensure_ascii=False) + '\n' for k in sorted(target)), encoding='utf-8')
print('DONE', len(found), 'of', len(target), flush=True)
