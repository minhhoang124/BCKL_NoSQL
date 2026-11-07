import asyncio
import json
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.schemas.elasticsearch import (
    ElasticsearchHit,
    ProductDocument,
    SearchFilters,
)
from app.services.elasticsearch_service import (
    ElasticsearchService,
    ElasticsearchUnavailableError,
    build_elasticsearch_query,
)


def test_env_vars_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies Elasticsearch address and index name are loaded from env, not hardcoded."""
    # Test default settings
    default_settings = Settings()
    assert default_settings.elasticsearch_url == "http://localhost:9200"
    assert default_settings.elasticsearch_index_name == "products"

    # Test override via ELASTICSEARCH_URL
    monkeypatch.setenv("ELASTICSEARCH_URL", "http://es-cluster:9200")
    monkeypatch.setenv("ELASTICSEARCH_INDEX_NAME", "ecommerce_products")
    custom_settings = Settings()
    assert custom_settings.elasticsearch_url == "http://es-cluster:9200"
    assert custom_settings.elasticsearch_index_name == "ecommerce_products"

    # Test override via AI_ELASTICSEARCH_URL
    monkeypatch.setenv("AI_ELASTICSEARCH_URL", "http://ai-es-cluster:9200")
    monkeypatch.setenv("AI_ELASTICSEARCH_INDEX_NAME", "ai_products")
    ai_settings = Settings()
    assert ai_settings.elasticsearch_url == "http://ai-es-cluster:9200"
    assert ai_settings.elasticsearch_index_name == "ai_products"


def test_index_product_stores_backend_payload() -> None:
    """Indexes by PostgreSQL integer productId, saving name, categories, brand, price and stock."""
    recorded_requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append({
            "method": request.method,
            "url": str(request.url),
            "body": json.loads(request.content.decode("utf-8")),
        })
        return httpx.Response(201, json={"result": "created", "_version": 1})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    payload = {
        "productId": 125,
        "name": "Wireless Bluetooth Headphones",
        "description": "Over-ear wireless headphones",
        "categoryId": 12,
        "categoryName": "Headphones",
        "categoryPathIds": [1, 5, 12],
        "brandId": 8,
        "brandName": "Sony",
        "minPrice": "1290000.00",
        "maxPrice": "1590000.00",
        "inStock": True,
        "attributes": {"color": ["Black"]},
        "version": 4,
    }

    async def run() -> dict[str, Any]:
        return await service.index_product(payload)

    result = asyncio.run(run())

    assert result["productId"] == 125
    assert result["result"] == "created"
    assert len(recorded_requests) == 1

    req = recorded_requests[0]
    assert req["method"] == "PUT"
    assert req["url"] == "http://localhost:9200/test_products/_doc/125"

    body = req["body"]
    assert body["productId"] == 125
    assert body["name"] == "Wireless Bluetooth Headphones"
    assert body["description"] == "Over-ear wireless headphones"
    assert body["categoryId"] == 12
    assert body["categoryPathIds"] == [1, 5, 12]
    assert body["brandId"] == 8
    assert body["brandName"] == "Sony"
    assert body["minPrice"] == 1290000.0
    assert body["maxPrice"] == 1590000.0
    assert body["inStock"] is True
    assert body["attributes"] == {"color": ["Black"]}
    assert body["version"] == 4


def test_index_product_supports_large_non_prototype_id() -> None:
    """Verifies that arbitrary positive PostgreSQL IDs (e.g. 50000, 999999) are accepted."""
    recorded_requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append({
            "url": str(request.url),
            "body": json.loads(request.content.decode("utf-8")),
        })
        return httpx.Response(200, json={"result": "updated", "_version": 2})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    payload = {
        "productId": 999999,
        "name": "Mechanical Keyboard",
        "categoryId": 45,
        "categoryPathIds": [10, 45],
        "minPrice": 2500000.0,
        "maxPrice": 2500000.0,
        "inStock": True,
    }

    async def run() -> dict[str, Any]:
        return await service.index_product(payload)

    result = asyncio.run(run())
    assert result["productId"] == 999999
    assert recorded_requests[0]["url"] == "http://localhost:9200/test_products/_doc/999999"


def test_index_product_rejects_non_positive_id() -> None:
    """Validates that non-positive productId (<= 0) is rejected."""
    with pytest.raises(ValidationError):
        ProductDocument(
            productId=0,
            name="Invalid Product",
            categoryId=1,
            categoryPathIds=[1],
        )

    with pytest.raises(ValidationError):
        ProductDocument(
            productId=-10,
            name="Invalid Product",
            categoryId=1,
            categoryPathIds=[1],
        )


def test_build_elasticsearch_query_keyword_only() -> None:
    """Keyword search formats multi_match query on name^2 and description."""
    query_dsl = build_elasticsearch_query("tai nghe bluetooth", top_k=20)

    assert query_dsl["size"] == 20
    bool_q = query_dsl["query"]["bool"]
    assert len(bool_q["must"]) == 1
    assert bool_q["must"][0] == {
        "multi_match": {
            "query": "tai nghe bluetooth",
            "fields": ["name^2", "description"],
        }
    }
    assert bool_q["filter"] == []


def test_build_elasticsearch_query_empty_uses_match_all() -> None:
    """Empty or None query uses match_all."""
    query_dsl = build_elasticsearch_query(None)
    assert query_dsl["query"]["bool"]["must"] == [{"match_all": {}}]

    query_dsl_blank = build_elasticsearch_query("   ")
    assert query_dsl_blank["query"]["bool"]["must"] == [{"match_all": {}}]


def test_filter_semantic_candidates_restricts_to_requested_product_ids() -> None:
    query_dsl = build_elasticsearch_query(
        filters=SearchFilters(brandIds=[8], inStock=True),
        top_k=2,
        restrict_product_ids=[88, 51],
    )
    assert query_dsl["query"]["bool"]["filter"] == [
        {"terms": {"brandId": [8]}},
        {"term": {"inStock": True}},
        {"terms": {"productId": [88, 51]}},
    ]


def test_filter_category_ids_uses_or_logic() -> None:
    """categoryIds filter applies OR within the category ID list via categoryId/PathIds."""
    filters = SearchFilters(categoryIds=[12, 15])
    query_dsl = build_elasticsearch_query(filters=filters)

    filter_clauses = query_dsl["query"]["bool"]["filter"]
    assert len(filter_clauses) == 1
    assert filter_clauses[0] == {
        "bool": {
            "should": [
                {"terms": {"categoryId": [12, 15]}},
                {"terms": {"categoryPathIds": [12, 15]}},
            ],
            "minimum_should_match": 1,
        }
    }


def test_filter_brand_ids_uses_or_logic() -> None:
    """brandIds filter applies OR within the brand ID list via terms query."""
    filters = SearchFilters(brandIds=[8, 9])
    query_dsl = build_elasticsearch_query(filters=filters)

    filter_clauses = query_dsl["query"]["bool"]["filter"]
    assert len(filter_clauses) == 1
    assert filter_clauses[0] == {
        "terms": {"brandId": [8, 9]}
    }


def test_filter_min_price() -> None:
    """minPrice filter verifies product maxPrice reaches at least minPrice."""
    filters = SearchFilters(minPrice=500000.0)
    query_dsl = build_elasticsearch_query(filters=filters)

    filter_clauses = query_dsl["query"]["bool"]["filter"]
    assert len(filter_clauses) == 1
    assert filter_clauses[0] == {
        "range": {"maxPrice": {"gte": 500000.0}}
    }


def test_filter_max_price() -> None:
    """maxPrice filter verifies product minPrice is within maxPrice."""
    filters = SearchFilters(maxPrice=2000000.0)
    query_dsl = build_elasticsearch_query(filters=filters)

    filter_clauses = query_dsl["query"]["bool"]["filter"]
    assert len(filter_clauses) == 1
    assert filter_clauses[0] == {
        "range": {"minPrice": {"lte": 2000000.0}}
    }


def test_filter_in_stock() -> None:
    """inStock filter generates boolean term match."""
    filters_true = SearchFilters(inStock=True)
    query_dsl_true = build_elasticsearch_query(filters=filters_true)
    assert query_dsl_true["query"]["bool"]["filter"] == [{"term": {"inStock": True}}]

    filters_false = SearchFilters(inStock=False)
    query_dsl_false = build_elasticsearch_query(filters=filters_false)
    assert query_dsl_false["query"]["bool"]["filter"] == [{"term": {"inStock": False}}]


def test_filter_combined_and_between_groups_or_within_ids() -> None:
    """Combined filters enforce AND between filter groups, and OR within ID lists."""
    filters = SearchFilters(
        categoryIds=[12, 15],
        brandIds=[8, 9],
        minPrice=500000.0,
        maxPrice=2000000.0,
        inStock=True,
    )
    query_dsl = build_elasticsearch_query("tai nghe", filters=filters, top_k=15)

    assert query_dsl["size"] == 15
    bool_q = query_dsl["query"]["bool"]

    # Must clause has the text query
    assert len(bool_q["must"]) == 1
    assert bool_q["must"][0]["multi_match"]["query"] == "tai nghe"

    # Filter clauses contain all 5 groups joined with AND (elements in filter array)
    filter_clauses = bool_q["filter"]
    assert len(filter_clauses) == 5

    # 1. Category OR
    assert filter_clauses[0] == {
        "bool": {
            "should": [
                {"terms": {"categoryId": [12, 15]}},
                {"terms": {"categoryPathIds": [12, 15]}},
            ],
            "minimum_should_match": 1,
        }
    }

    # 2. Brand OR
    assert filter_clauses[1] == {"terms": {"brandId": [8, 9]}}

    # 3. Min Price
    assert filter_clauses[2] == {"range": {"maxPrice": {"gte": 500000.0}}}

    # 4. Max Price
    assert filter_clauses[3] == {"range": {"minPrice": {"lte": 2000000.0}}}

    # 5. In Stock
    assert filter_clauses[4] == {"term": {"inStock": True}}


def test_search_executes_and_returns_hits_with_rank_and_score() -> None:
    """search() returns list[ElasticsearchHit] with integer productId, rank, and score."""
    mock_es_response = {
        "took": 12,
        "hits": {
            "total": {"value": 2, "relation": "eq"},
            "hits": [
                {
                    "_id": "125",
                    "_score": 4.85,
                    "_source": {
                        "productId": 125,
                        "name": "Wireless Bluetooth Headphones",
                    },
                },
                {
                    "_id": "250",
                    "_score": 3.12,
                    "_source": {
                        "productId": 250,
                        "name": "Noise Cancelling Earbuds",
                    },
                },
            ],
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/test_products/_search"
        return httpx.Response(200, json=mock_es_response)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    async def run() -> list[ElasticsearchHit]:
        return await service.search(query="tai nghe", top_k=10)

    hits = asyncio.run(run())

    assert len(hits) == 2
    assert hits[0].product_id == 125
    assert hits[0].rank == 1
    assert hits[0].score == 4.85

    assert hits[1].product_id == 250
    assert hits[1].rank == 2
    assert hits[1].score == 3.12


def test_search_with_meta_returns_took_and_total() -> None:
    """search_with_meta() returns tookMs, total, and items."""
    mock_es_response = {
        "took": 7,
        "hits": {
            "total": {"value": 1, "relation": "eq"},
            "hits": [
                {
                    "_id": "125",
                    "_score": 1.0,
                    "_source": {"productId": 125},
                }
            ],
        },
    }

    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=mock_es_response))
    client = httpx.AsyncClient(transport=transport)
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    async def run() -> Any:
        return await service.search_with_meta(query="test")

    res = asyncio.run(run())
    assert res.total == 1
    assert res.took_ms == 7.0
    assert len(res.items) == 1
    assert res.items[0].product_id == 125


def test_elasticsearch_unavailable_on_connection_error() -> None:
    """When Elasticsearch connection fails, raises ElasticsearchUnavailableError."""
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused to http://localhost:9200")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    async def run_search() -> None:
        with pytest.raises(ElasticsearchUnavailableError, match="unavailable during search"):
            await service.search("headphones")

    async def run_index() -> None:
        with pytest.raises(ElasticsearchUnavailableError, match="unavailable during indexing"):
            await service.index_product({
                "productId": 1,
                "name": "Item",
                "categoryId": 1,
                "categoryPathIds": [1],
            })

    asyncio.run(run_search())
    asyncio.run(run_index())


def test_elasticsearch_unavailable_on_timeout() -> None:
    """When Elasticsearch times out, raises ElasticsearchUnavailableError."""
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("Read timed out")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    async def run() -> None:
        with pytest.raises(ElasticsearchUnavailableError):
            await service.search("headphones")

    asyncio.run(run())


def test_elasticsearch_unavailable_on_503_response() -> None:
    """When Elasticsearch returns 503 Service Unavailable, raises ElasticsearchUnavailableError."""
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="Cluster block / Service Unavailable")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    async def run_search() -> None:
        with pytest.raises(ElasticsearchUnavailableError, match="503"):
            await service.search("headphones")

    async def run_index() -> None:
        with pytest.raises(ElasticsearchUnavailableError, match="503"):
            await service.index_product({
                "productId": 125,
                "name": "Headphones",
                "categoryId": 12,
                "categoryPathIds": [1, 12],
            })

    asyncio.run(run_search())
    asyncio.run(run_index())


def test_is_available_reports_status() -> None:
    """is_available() checks cluster reachability."""
    client_ok = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200)))
    service_ok = ElasticsearchService("http://localhost:9200", "products", client=client_ok)

    client_down = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500)))
    service_down = ElasticsearchService("http://localhost:9200", "products", client=client_down)

    async def run() -> tuple[bool, bool]:
        ok = await service_ok.is_available()
        down = await service_down.is_available()
        return ok, down

    ok, down = asyncio.run(run())
    assert ok is True
    assert down is False


def test_delete_product() -> None:
    """delete_product() returns True on 200/202, False on 404."""
    def handler(request: httpx.Request) -> httpx.Response:
        if "125" in request.url.path:
            return httpx.Response(200, json={"result": "deleted"})
        return httpx.Response(404, json={"result": "not_found"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "products", client=client)

    async def run() -> tuple[bool, bool]:
        deleted = await service.delete_product(125)
        not_found = await service.delete_product(999)
        return deleted, not_found

    deleted, not_found = asyncio.run(run())
    assert deleted is True
    assert not_found is False


def test_ensure_index_creates_when_missing() -> None:
    """ensure_index() creates index when HEAD returns 404, returns False when 200."""
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method} {request.url.path}")
        if request.method == "HEAD":
            return httpx.Response(404)
        if request.method == "PUT":
            return httpx.Response(201, json={"acknowledged": True})
        return httpx.Response(400)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "new_products", client=client)

    async def run() -> bool:
        return await service.ensure_index()

    created = asyncio.run(run())
    assert created is True
    assert calls == ["HEAD /new_products", "PUT /new_products"]


def test_index_product_with_null_description_and_brand_id() -> None:
    """Validates payload with description=None and brandId=None indexes safely."""
    recorded_requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append({
            "url": str(request.url),
            "body": json.loads(request.content.decode("utf-8")),
        })
        return httpx.Response(201, json={"result": "created", "_version": 1})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ElasticsearchService("http://localhost:9200", "test_products", client=client)

    payload = {
        "productId": 126,
        "name": "Generic Cable",
        "description": None,
        "categoryId": 12,
        "categoryPathIds": [1, 5, 12],
        "brandId": None,
        "brandName": None,
        "minPrice": "50000.00",
        "maxPrice": "50000.00",
        "inStock": True,
    }

    async def run() -> dict[str, Any]:
        return await service.index_product(payload)

    result = asyncio.run(run())
    assert result["productId"] == 126
    assert len(recorded_requests) == 1
    body = recorded_requests[0]["body"]
    assert body["description"] == ""
    assert body["brandId"] is None
    assert body["brandName"] is None
    assert body["categoryId"] == 12
    assert body["categoryPathIds"] == [1, 5, 12]


def test_index_product_rejects_missing_leaf_category() -> None:
    """Validates that omitting leaf categoryId is rejected."""
    with pytest.raises(ValidationError):
        ProductDocument.model_validate({
            "productId": 100,
            "name": "Product Without Category",
            "categoryPathIds": [1, 5],
        })


def test_index_product_rejects_missing_or_empty_category_path() -> None:
    """Validates that omitting or providing empty categoryPathIds is rejected."""
    with pytest.raises(ValidationError):
        ProductDocument.model_validate({
            "productId": 100,
            "name": "Product Without Path",
            "categoryId": 5,
        })

    with pytest.raises(ValidationError):
        ProductDocument.model_validate({
            "productId": 100,
            "name": "Product With Empty Path",
            "categoryId": 5,
            "categoryPathIds": [],
        })


def test_index_product_rejects_category_path_not_ending_with_category_id() -> None:
    """Validates categoryPathIds must strictly end with categoryId and is not auto-fixed."""
    with pytest.raises(ValidationError, match="categoryPathIds must end with categoryId"):
        ProductDocument.model_validate({
            "productId": 100,
            "name": "Mismatched Category Path",
            "categoryId": 12,
            "categoryPathIds": [1, 5, 99],
        })
