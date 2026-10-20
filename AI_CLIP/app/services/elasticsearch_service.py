from __future__ import annotations

import json
import logging
import math
from time import monotonic
from typing import Any
from urllib.parse import quote

import httpx

from app.schemas.elasticsearch import (
    ElasticsearchHit,
    ElasticsearchSearchResponse,
    ProductDocument,
    SearchFilters,
)

logger = logging.getLogger(__name__)

INDEX_MAPPING: dict[str, Any] = {
    "mappings": {
        "properties": {
            "productId": {"type": "long"},
            "name": {"type": "text", "analyzer": "standard"},
            "description": {"type": "text", "analyzer": "standard"},
            "categoryId": {"type": "integer"},
            "categoryPathIds": {"type": "integer"},
            "categoryName": {"type": "keyword"},
            "brandId": {"type": "integer"},
            "brandName": {"type": "keyword"},
            "minPrice": {"type": "double"},
            "maxPrice": {"type": "double"},
            "inStock": {"type": "boolean"},
            "attributes": {"type": "object", "enabled": False},
            "version": {"type": "integer"},
        }
    }
}


class ElasticsearchError(RuntimeError):
    """Base exception for Elasticsearch operations."""


class ElasticsearchUnavailableError(ElasticsearchError):
    """Raised when Elasticsearch is unreachable or service is unavailable."""


class ElasticsearchIndexError(ElasticsearchError):
    """Raised when an indexing request is rejected or invalid."""


def build_elasticsearch_query(
    query: str | None = None,
    filters: SearchFilters | None = None,
    top_k: int = 10,
    offset: int = 0,
    restrict_product_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Constructs Elasticsearch query DSL with keyword search and bool filters.

    Rules:
    - OR within categoryIds.
    - OR within brandIds.
    - AND between filter groups (category, brand, price, inStock).
    """
    bool_query: dict[str, list[dict[str, Any]]] = {
        "must": [],
        "filter": [],
    }

    cleaned_query = query.strip() if query else ""
    if cleaned_query:
        bool_query["must"].append({
            "multi_match": {
                "query": cleaned_query,
                "fields": ["name^2", "description"],
            }
        })
    else:
        bool_query["must"].append({"match_all": {}})

    if filters is not None:
        if filters.category_ids:
            bool_query["filter"].append({
                "bool": {
                    "should": [
                        {"terms": {"categoryId": filters.category_ids}},
                        {"terms": {"categoryPathIds": filters.category_ids}},
                    ],
                    "minimum_should_match": 1,
                }
            })

        if filters.brand_ids:
            bool_query["filter"].append({
                "terms": {"brandId": filters.brand_ids}
            })

        if filters.min_price is not None:
            bool_query["filter"].append({
                "range": {"maxPrice": {"gte": float(filters.min_price)}}
            })

        if filters.max_price is not None:
            bool_query["filter"].append({
                "range": {"minPrice": {"lte": float(filters.max_price)}}
            })

        if filters.in_stock is not None:
            bool_query["filter"].append({
                "term": {"inStock": filters.in_stock}
            })

    if restrict_product_ids is not None:
        bool_query["filter"].append({"terms": {"productId": restrict_product_ids}})

    return {
        "from": offset,
        "size": top_k,
        "query": {"bool": bool_query},
    }


class ElasticsearchService:
    """Service connecting to Elasticsearch for product indexing and search.

    Addresses, index names and timeouts are loaded via configuration, never hardcoded.
    """

    def __init__(
        self,
        base_url: str,
        index_name: str,
        timeout_seconds: float = 5.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._index_name = index_name.strip()
        self._timeout_seconds = timeout_seconds
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout_seconds,
        )

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def index_name(self) -> str:
        return self._index_name

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def is_available(self) -> bool:
        """Check if Elasticsearch cluster is reachable."""
        try:
            response = await self._client.get(f"{self._base_url}/")
            return response.status_code == 200
        except (httpx.HTTPError, OSError) as error:
            logger.warning("Elasticsearch ping failed: %s", error)
            return False

    async def readiness_probe(self, timeout_seconds: float) -> dict[str, Any]:
        """Read target mapping and one hit. Never create/refresh/write an index."""
        result: dict[str, Any] = {"loaded": None, "indexExists": None, "readable": None}
        deadline = monotonic() + timeout_seconds
        target = quote(self._index_name, safe="")

        async def read(suffix, body=None):
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise httpx.ReadTimeout("Health budget")
            async with self._client.stream(
                "GET", f"{self._base_url}/{target}/{suffix}", json=body,
                params={"allow_no_indices": "false", "ignore_unavailable": "false"},
                timeout=remaining, follow_redirects=False,
            ) as response:
                if response.status_code in (401, 403):
                    return "ES_AUTH_FAILED", None
                if response.status_code == 404:
                    result["indexExists"] = False
                    return "ES_INDEX_MISSING", None
                if response.status_code != 200:
                    return "ES_QUERY_FAILED", None
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 262144:
                        return "ES_QUERY_FAILED", None
                return None, json.loads(content)

        try:
            code, mapping = await read("_mapping")
            if code:
                return {**result, "errorCode": code}
            result["indexExists"] = True
            if not isinstance(mapping, dict) or len(mapping) != 1:
                return {**result, "errorCode": "ES_MAPPING_INVALID"}
            target_mapping = next(iter(mapping.values()))["mappings"]
            properties = target_mapping["properties"]
            expected = INDEX_MAPPING["mappings"]["properties"]
            if not isinstance(properties, dict) or any(
                not isinstance(properties.get(key), dict)
                or properties[key].get("type") != definition["type"]
                or (key == "attributes" and properties[key].get("enabled") is not False)
                for key, definition in expected.items()
            ):
                return {**result, "errorCode": "ES_MAPPING_INVALID"}
            # A matching type does not mean the field can serve our queries.
            # Full-text fields need an inverted index. Numeric/boolean filters
            # can use doc values instead, so index=false alone is not an error.
            if (
                target_mapping.get("enabled", True) is not True
                or target_mapping.get("_source", {}).get("enabled", True) is not True
                or any(properties[key].get("index", True) is not True
                       for key in ("name", "description"))
            ):
                return {**result, "errorCode": "ES_MAPPING_INVALID"}
            for key in (
                "productId", "categoryId", "categoryPathIds", "brandId",
                "minPrice", "maxPrice", "inStock",
            ):
                indexed = properties[key].get("index", True)
                doc_values = properties[key].get("doc_values", True)
                if (type(indexed) is not bool or type(doc_values) is not bool
                    or not (indexed or doc_values)):
                    return {**result, "errorCode": "ES_MAPPING_INVALID"}
            code, data = await read("_search", {
                "size": 1, "query": {"match_all": {}}, "_source": ["productId"],
                "track_total_hits": True,
            })
            result["readable"] = False
            if code:
                return {**result, "errorCode": code}
            shards = data["_shards"]
            if (
                data.get("timed_out") is not False
                or data.get("terminated_early") is True
                or any(type(shards.get(k)) is not int or shards[k] < 0
                       for k in ("total", "successful", "skipped", "failed"))
                or shards["failed"] != 0 or shards["successful"] < 1
                or shards["successful"] + shards["failed"] != shards["total"]
            ):
                return {**result, "errorCode": "ES_QUERY_FAILED"}
            total = data["hits"]["total"]
            hits = data["hits"]["hits"]
            if (not isinstance(total, dict) or type(total.get("value")) is not int
                or total["value"] < 0 or total.get("relation") != "eq"
                or not isinstance(hits, list) or len(hits) != min(total["value"], 1)):
                return {**result, "errorCode": "ES_QUERY_FAILED"}
            for hit in hits:
                identity, score = hit["_source"]["productId"], hit["_score"]
                if (type(identity) is not int or identity < 1
                    or type(score) not in (int, float) or not math.isfinite(score)):
                    return {**result, "errorCode": "ES_QUERY_FAILED"}
            return {**result, "readable": True,
                    "warningCodes": ["EMPTY_INDEX"] if total["value"] == 0 else []}
        except httpx.TimeoutException:
            return {**result, "errorCode": "ES_TIMEOUT"}
        except (httpx.HTTPError, OSError):
            return {**result, "errorCode": "ES_UNREACHABLE"}
        except (ValueError, TypeError, KeyError, AttributeError):
            return {**result, "errorCode": (
                "ES_QUERY_FAILED" if result["readable"] is False else "ES_MAPPING_INVALID"
            )}

    async def ensure_index(self) -> bool:
        """Ensure the target index exists with required mapping.

        Returns True if created, False if already exists.
        """
        try:
            head_response = await self._client.head(f"{self._base_url}/{self._index_name}")
            if head_response.status_code == 200:
                return False
            if head_response.status_code == 404:
                create_response = await self._client.put(
                    f"{self._base_url}/{self._index_name}",
                    json=INDEX_MAPPING,
                )
                if create_response.status_code in (200, 201):
                    return True
                raise ElasticsearchIndexError(
                    f"Failed to create Elasticsearch index: {create_response.text}"
                )
            raise ElasticsearchUnavailableError(
                f"Unexpected status checking index existence: {head_response.status_code}"
            )
        except (httpx.ConnectError, httpx.TimeoutException) as error:
            raise ElasticsearchUnavailableError(
                f"Elasticsearch is unavailable: {error}"
            ) from error
        except httpx.HTTPStatusError as error:
            if error.response.status_code in (502, 503, 504):
                raise ElasticsearchUnavailableError(
                    f"Elasticsearch returned {error.response.status_code}: {error}"
                ) from error
            raise ElasticsearchError(f"Elasticsearch HTTP error: {error}") from error

    async def index_product(self, product: ProductDocument | dict[str, Any]) -> dict[str, Any]:
        """Indexes or updates a product document in Elasticsearch by its PostgreSQL integer ID."""
        if isinstance(product, dict):
            doc = ProductDocument.model_validate(product)
        else:
            doc = product

        url = f"{self._base_url}/{self._index_name}/_doc/{doc.product_id}"
        try:
            response = await self._client.put(url, json=doc.to_es_source())
            if response.status_code in (200, 201):
                data = response.json()
                return {
                    "productId": doc.product_id,
                    "result": data.get("result", "updated"),
                    "version": data.get("_version"),
                }
            if response.status_code in (400, 422):
                raise ElasticsearchIndexError(
                    f"Elasticsearch rejected product {doc.product_id}: {response.text}"
                )
            if response.status_code in (502, 503, 504):
                raise ElasticsearchUnavailableError(
                    f"Elasticsearch unavailable ({response.status_code}): {response.text}"
                )
            raise ElasticsearchError(
                f"Unexpected indexing status {response.status_code}: {response.text}"
            )
        except (httpx.ConnectError, httpx.TimeoutException) as error:
            raise ElasticsearchUnavailableError(
                f"Elasticsearch is unavailable during indexing: {error}"
            ) from error

    async def delete_product(self, product_id: int) -> bool:
        """Deletes a product document by integer ID. Returns True if deleted, False if not found."""
        if product_id <= 0:
            raise ValueError("productId must be a positive integer")

        url = f"{self._base_url}/{self._index_name}/_doc/{product_id}"
        try:
            response = await self._client.delete(url)
            if response.status_code in (200, 202):
                return True
            if response.status_code == 404:
                return False
            if response.status_code in (502, 503, 504):
                raise ElasticsearchUnavailableError(
                    f"Elasticsearch unavailable ({response.status_code}): {response.text}"
                )
            raise ElasticsearchError(
                f"Unexpected status during deletion {response.status_code}: {response.text}"
            )
        except (httpx.ConnectError, httpx.TimeoutException) as error:
            raise ElasticsearchUnavailableError(
                f"Elasticsearch is unavailable during deletion: {error}"
            ) from error

    async def get_product(self, product_id: int) -> dict[str, Any] | None:
        """Fetch raw document source by productId. Returns None if 404."""
        if product_id <= 0:
            raise ValueError("productId must be a positive integer")

        url = f"{self._base_url}/{self._index_name}/_doc/{product_id}"
        try:
            response = await self._client.get(url)
            if response.status_code == 200:
                data = response.json()
                return data.get("_source")
            if response.status_code == 404:
                return None
            if response.status_code in (502, 503, 504):
                raise ElasticsearchUnavailableError(
                    f"Elasticsearch unavailable ({response.status_code}): {response.text}"
                )
            raise ElasticsearchError(
                f"Unexpected status fetching product {response.status_code}: {response.text}"
            )
        except (httpx.ConnectError, httpx.TimeoutException) as error:
            raise ElasticsearchUnavailableError(
                f"Elasticsearch is unavailable: {error}"
            ) from error

    async def search(
        self,
        query: str | None = None,
        filters: SearchFilters | dict[str, Any] | None = None,
        top_k: int = 10,
        offset: int = 0,
    ) -> list[ElasticsearchHit]:
        """Search products with keyword query and filters.

        Returns list of ElasticsearchHit with numeric productId, rank and score.
        """
        response = await self.search_with_meta(
            query=query,
            filters=filters,
            top_k=top_k,
            offset=offset,
        )
        return response.items

    async def search_with_meta(
        self,
        query: str | None = None,
        filters: SearchFilters | dict[str, Any] | None = None,
        top_k: int = 10,
        offset: int = 0,
        restrict_product_ids: list[int] | None = None,
    ) -> ElasticsearchSearchResponse:
        """Search products and return response with metadata (total, tookMs, items)."""
        if top_k < 1:
            raise ValueError("top_k must be at least 1")
        if offset < 0:
            raise ValueError("offset must be non-negative")

        search_filters = (
            SearchFilters.model_validate(filters) if isinstance(filters, dict) else filters
        )
        body = build_elasticsearch_query(
            query=query,
            filters=search_filters,
            top_k=top_k,
            offset=offset,
            restrict_product_ids=restrict_product_ids,
        )

        url = f"{self._base_url}/{self._index_name}/_search"
        try:
            response = await self._client.post(url, json=body)
            if response.status_code in (502, 503, 504):
                raise ElasticsearchUnavailableError(
                    f"Elasticsearch unavailable ({response.status_code}): {response.text}"
                )
            if response.status_code != 200:
                raise ElasticsearchError(
                    f"Elasticsearch search error ({response.status_code}): {response.text}"
                )

            data = response.json()
            hits_data = data.get("hits", {})
            raw_hits = hits_data.get("hits", [])

            items: list[ElasticsearchHit] = []
            for rank_idx, hit in enumerate(raw_hits, start=1):
                source = hit.get("_source", {})
                raw_product_id = source.get("productId") or hit.get("_id")
                if raw_product_id is None:
                    continue
                product_id = int(raw_product_id)
                score = float(hit.get("_score") or 0.0)
                items.append(
                    ElasticsearchHit(
                        productId=product_id,
                        rank=rank_idx,
                        score=score,
                    )
                )

            total_val = hits_data.get("total", {})
            total = total_val.get("value", 0) if isinstance(total_val, dict) else int(total_val)
            took_ms = float(data.get("took", 0.0))

            return ElasticsearchSearchResponse(
                total=total,
                items=items,
                tookMs=took_ms,
            )
        except (httpx.ConnectError, httpx.TimeoutException) as error:
            raise ElasticsearchUnavailableError(
                f"Elasticsearch is unavailable during search: {error}"
            ) from error
