import json
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.schemas.index import ProductSyncResponse, SingleProductIndexRequest
from app.schemas.search import HybridSearchRequest, HybridSearchResponse
from app.services.elasticsearch_service import build_elasticsearch_query

FIXTURES = Path(__file__).parent / "fixtures" / "backend_contract"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_backend_index_payload_matches_fastapi_contract() -> None:
    payload = SingleProductIndexRequest.model_validate(load_fixture("index_product.json"))

    assert payload.product_id == 125
    assert payload.category_path_ids[-1] == payload.category_id
    assert payload.min_price == Decimal("1290000.00")
    assert payload.max_price == Decimal("1590000.00")


def test_backend_hybrid_payload_preserves_decimal_filter_values() -> None:
    payload = HybridSearchRequest.model_validate(load_fixture("hybrid_search.json"))

    assert payload.filters.min_price == Decimal("500000.00")
    assert payload.filters.max_price == Decimal("2000000.00")
    query = build_elasticsearch_query(payload.query, payload.filters, payload.top_k)
    encoded = json.dumps(query)
    assert '"gte": 500000.0' in encoded
    assert '"lte": 2000000.0' in encoded


@pytest.mark.parametrize(
    ("fixture_name", "model"),
    [
        ("product_sync_response.json", ProductSyncResponse),
        ("hybrid_search_response.json", HybridSearchResponse),
    ],
)
def test_fastapi_response_fixtures_validate(fixture_name: str, model: type) -> None:
    model.model_validate(load_fixture(fixture_name))


def test_contract_rejects_unknown_request_and_response_fields() -> None:
    request = load_fixture("hybrid_search.json")
    request["rrfK"] = 10
    with pytest.raises(ValidationError):
        HybridSearchRequest.model_validate(request)

    response = load_fixture("hybrid_search_response.json")
    response["products"] = []
    with pytest.raises(ValidationError):
        HybridSearchResponse.model_validate(response)


def test_contract_rejects_invalid_filter_range_and_candidate_count() -> None:
    request = load_fixture("hybrid_search.json")
    filters = request["filters"]
    assert isinstance(filters, dict)
    filters["minPrice"] = 3000000
    filters["maxPrice"] = 2000000
    request["candidateK"] = 10

    with pytest.raises(ValidationError):
        HybridSearchRequest.model_validate(request)


def test_external_call_timeouts_are_positive_and_bounded() -> None:
    with pytest.raises(ValidationError):
        Settings(elasticsearch_timeout_seconds=0)
    with pytest.raises(ValidationError):
        Settings(elasticsearch_timeout_seconds=61)
    with pytest.raises(ValidationError):
        Settings(image_download_timeout_seconds=61)
