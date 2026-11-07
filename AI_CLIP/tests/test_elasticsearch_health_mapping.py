"""Regression for PR79: mapping types alone do not prove query readiness."""

import asyncio
from copy import deepcopy

import httpx
import pytest

from app.services.elasticsearch_service import INDEX_MAPPING, ElasticsearchService

FILTER_FIELDS = (
    "productId", "categoryId", "categoryPathIds", "brandId",
    "minPrice", "maxPrice", "inStock",
)


def run_probe(mapping):
    requests = []

    def handle(request):
        requests.append(request)
        assert request.method == "GET"
        if request.url.path.endswith("/_mapping"):
            return httpx.Response(200, json={"products": mapping})
        assert request.url.path.endswith("/_search")
        return httpx.Response(200, json={
            "timed_out": False,
            "_shards": {"total": 1, "successful": 1, "skipped": 0, "failed": 0},
            "hits": {"total": {"value": 0, "relation": "eq"}, "hits": []},
        })

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            return await ElasticsearchService(
                "http://es", "products", client=client,
            ).readiness_probe(1.5)

    return asyncio.run(scenario()), requests


@pytest.mark.parametrize("field", ["name", "description"])
def test_text_without_inverted_index_cannot_report_ready_even_when_empty(field):
    mapping = deepcopy(INDEX_MAPPING)
    mapping["mappings"]["properties"][field]["index"] = False
    result, requests = run_probe(mapping)
    assert result.get("errorCode") == "ES_MAPPING_INVALID"
    assert result["indexExists"] is True
    assert not result["readable"]
    assert not result.get("warningCodes")
    assert len(requests) == 1  # Fail closed, do not disguise it as an empty index.


@pytest.mark.parametrize("field", FILTER_FIELDS)
def test_filter_without_index_or_doc_values_cannot_report_ready(field):
    mapping = deepcopy(INDEX_MAPPING)
    mapping["mappings"]["properties"][field].update(index=False, doc_values=False)
    result, requests = run_probe(mapping)
    assert result.get("errorCode") == "ES_MAPPING_INVALID"
    assert len(requests) == 1


@pytest.mark.parametrize("field", FILTER_FIELDS)
@pytest.mark.parametrize(
    "options", [{"index": False}, {"index": False, "doc_values": True},
                {"index": True, "doc_values": False}],
)
def test_queryable_numeric_boolean_filters_remain_valid(field, options):
    mapping = deepcopy(INDEX_MAPPING)
    mapping["mappings"]["properties"][field].update(options)
    result, requests = run_probe(mapping)
    assert result.get("errorCode") is None
    assert result["readable"] is True
    assert result["warningCodes"] == ["EMPTY_INDEX"]
    assert len(requests) == 2


@pytest.mark.parametrize("field", ["categoryName", "brandName", "version"])
def test_metadata_not_used_by_search_does_not_require_indexing(field):
    mapping = deepcopy(INDEX_MAPPING)
    mapping["mappings"]["properties"][field].update(index=False, doc_values=False)
    result, requests = run_probe(mapping)
    assert result.get("errorCode") is None
    assert len(requests) == 2


@pytest.mark.parametrize("disabled", ["root", "source"])
def test_disabled_root_or_source_is_not_usable_even_when_empty(disabled):
    mapping = deepcopy(INDEX_MAPPING)
    if disabled == "root":
        mapping["mappings"]["enabled"] = False
    else:
        mapping["mappings"]["_source"] = {"enabled": False}
    result, requests = run_probe(mapping)
    assert result.get("errorCode") == "ES_MAPPING_INVALID"
    assert len(requests) == 1
