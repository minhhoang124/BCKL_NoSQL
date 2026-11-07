"""Opt-in live ES proof on NEW, isolated QA indices; never repair target mappings.

Run from AI_CLIP: python scripts/verify_search_health_mapping.py --url
http://127.0.0.1:19222 --output /tmp/pr79-health-mapping.json
Only loopback non-default ports are accepted. Setup/cleanup writes are fixtures,
not health probe actions. No models, FAISS, PostgreSQL, credentials or metrics.
"""

import argparse
import asyncio
import hashlib
import json
import sys
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.elasticsearch import SearchFilters  # noqa: E402
from app.services.elasticsearch_service import (  # noqa: E402
    INDEX_MAPPING,
    ElasticsearchService,
    build_elasticsearch_query,
)


def cases():
    yield "valid-empty", deepcopy(INDEX_MAPPING), False, False
    yield "valid-populated", deepcopy(INDEX_MAPPING), True, False
    for fields in [("name",), ("description",), ("name", "description")]:
        mapping = deepcopy(INDEX_MAPPING)
        for field in fields:
            mapping["mappings"]["properties"][field]["index"] = False
        yield "unindexed-" + "-".join(fields), mapping, True, True
    for field in (
        "productId", "categoryId", "categoryPathIds", "brandId",
        "minPrice", "maxPrice", "inStock",
    ):
        mapping = deepcopy(INDEX_MAPPING)
        mapping["mappings"]["properties"][field].update(index=False, doc_values=False)
        yield "disabled-" + field.lower(), mapping, True, True
    mapping = deepcopy(INDEX_MAPPING)
    for field in (
        "productId", "categoryId", "categoryPathIds", "brandId",
        "minPrice", "maxPrice", "inStock",
    ):
        mapping["mappings"]["properties"][field]["index"] = False
    yield "doc-values-only", mapping, True, False
    mapping = deepcopy(INDEX_MAPPING)
    for field in ("categoryName", "brandName", "version"):
        mapping["mappings"]["properties"][field].update(index=False, doc_values=False)
    yield "metadata-unindexed", mapping, True, False
    for setting in ("root", "source"):
        mapping = deepcopy(INDEX_MAPPING)
        if setting == "root":
            mapping["mappings"]["enabled"] = False
        else:
            mapping["mappings"]["_source"] = {"enabled": False}
        yield "disabled-" + setting, mapping, False, True


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


async def verify(url):
    service_source = Path(__file__).resolve().parents[1] / "app/services/elasticsearch_service.py"
    report = {"startedAt": datetime.now(UTC).isoformat(), "cases": [],
              "serviceSourceSha256": hashlib.sha256(service_source.read_bytes()).hexdigest()}
    namespace = "pr79-health-mapping-" + uuid4().hex[:12]
    created = []
    async with httpx.AsyncClient(base_url=url, timeout=10, follow_redirects=False) as admin:
        response = await admin.get("/")
        response.raise_for_status()
        report["elasticsearchVersion"] = response.json()["version"]["number"]
        try:
            for label, mapping, populated, invalid in cases():
                target = namespace + "-" + label
                # Do not overwrite or clean up any pre-existing resource.
                response = await admin.put("/" + target, json=mapping)
                response.raise_for_status()
                created.append(target)
                if populated:
                    response = await admin.put(
                        f"/{target}/_doc/125", params={"refresh": "true"}, json={
                            "productId": 125, "name": "readiness", "description": "readiness",
                            "categoryId": 12, "categoryPathIds": [1, 12], "brandId": 8,
                            "minPrice": 10, "maxPrice": 20, "inStock": True, "version": 1,
                        },
                    )
                    response.raise_for_status()

                async def state(target=target):
                    m = await admin.get(f"/{target}/_mapping")
                    d = await admin.request("GET", f"/{target}/_search", json={
                        "query": {"match_all": {}}, "size": 10, "track_total_hits": True,
                    })
                    m.raise_for_status()
                    d.raise_for_status()
                    return {"mapping": m.json(), "hits": d.json()["hits"]}

                before = await state()
                trace = []

                async def record(request, trace=trace):
                    trace.append({"method": request.method, "path": request.url.path})

                async with httpx.AsyncClient(event_hooks={"request": [record]}) as client:
                    observation = await ElasticsearchService(
                        url, target, client=client,
                    ).readiness_probe(1.5)
                assert all(r["method"] == "GET" for r in trace), trace
                assert len(trace) == (1 if invalid else 2), trace
                after = await state()
                assert before == after, label
                if invalid:
                    assert observation.get("errorCode") == "ES_MAPPING_INVALID", observation
                    assert not observation.get("warningCodes"), observation
                else:
                    assert observation.get("errorCode") is None, observation
                    assert observation["readable"] is True
                    assert observation["warningCodes"] == ([] if populated else ["EMPTY_INDEX"])
                # Real production DSL, with keyword AND every public filter.
                query = build_elasticsearch_query(
                    "readiness", SearchFilters(categoryIds=[12], brandIds=[8],
                    minPrice=10, maxPrice=20, inStock=True),
                    top_k=1, restrict_product_ids=[125],
                )
                search = await admin.request("GET", f"/{target}/_search", json=query)
                if label == "unindexed-name-description":
                    assert search.status_code == 400, search.text
                if not invalid:
                    search.raise_for_status()
                    assert len(search.json()["hits"]["hits"]) == int(populated)
                report["cases"].append({"case": label, "observation": observation,
                    "productionQueryStatus": search.status_code, "probeRequests": trace,
                    "beforeAfterSha256": fingerprint(before), "stateUnchanged": True})
        finally:
            # Exact names created successfully above, never wildcard/demo indices.
            for target in reversed(created):
                response = await admin.delete("/" + target)
                response.raise_for_status()
    report["finishedAt"] = datetime.now(UTC).isoformat()
    report["fixturesRemoved"] = len(created)
    report["status"] = "PASS"
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
        or parsed.port in (None, 80, 9200) or parsed.username or parsed.password
        or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        parser.error("Use an isolated QA Elasticsearch on http://127.0.0.1:<non-default-port>")
    result = asyncio.run(verify(args.url.rstrip("/")))
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}))
