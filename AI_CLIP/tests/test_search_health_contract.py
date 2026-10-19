"""Contract-only probes/fixtures; no real ES, models, scheduler, auth or DB."""

import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.schemas.search_health_contract import SearchHealthSnapshot, dependency_status

EXAMPLES = Path(__file__).resolve().parents[2] / "docs/api/examples"


def fixture() -> dict:
    return json.loads((EXAMPLES / "search-health-proposed-v1.json").read_text())


def validate(data: dict) -> SearchHealthSnapshot:
    return SearchHealthSnapshot.model_validate(data)


def test_proposed_fixture_round_trip_and_schema_export() -> None:
    data = fixture()
    assert validate(data).model_dump(mode="json") == data
    schema = json.loads((EXAMPLES / "search-health-proposed-v1.schema.json").read_text())
    assert schema == SearchHealthSnapshot.model_json_schema()


@pytest.mark.parametrize("scope", ["root", "components", "clipText", "capabilities", "hybridText"])
def test_extra_fields_are_rejected(scope: str) -> None:
    data = fixture()
    target = data if scope == "root" else (
        data[scope] if scope in ("components", "capabilities") else
        data["components" if scope == "clipText" else "capabilities"][scope]
    )
    target["internalSecret"] = "not-a-real-secret"
    with pytest.raises(ValidationError):
        validate(data)


@pytest.mark.parametrize("component", ["clipImage", "clipText", "faiss", "elasticsearch"])
def test_missing_components_are_rejected(component: str) -> None:
    data = fixture()
    del data["components"][component]
    with pytest.raises(ValidationError):
        validate(data)


@pytest.mark.parametrize("value", [True, "1", 2, 1.0])
def test_exact_version(value: object) -> None:
    data = fixture()
    data["schemaVersion"] = value
    with pytest.raises(ValidationError):
        validate(data)


@pytest.mark.parametrize("field,value", [
    ("loaded", "true"), ("durationMs", "2"), ("durationMs", True),
    ("durationMs", -1), ("durationMs", float("nan")), ("durationMs", float("inf")),
    ("status", "ok"), ("dimension", "512"), ("dimension", 0),
    ("warningCodes", ["MAGIC_GREEN"]),
])
def test_strict_types_and_finite_numbers(field: str, value: object) -> None:
    data = fixture()
    data["components"]["clipText"][field] = value
    with pytest.raises(ValidationError):
        validate(data)


@pytest.mark.parametrize("field,value", [
    ("checkedAt", "2026-10-16"), ("checkedAt", "2026-10-16T06:00:00+07:00"),
    ("expiresAt", "2026-10-16T06:00:00.000Z"),
    ("expiresAt", "2026-10-16T06:01:01.000Z"),
    ("lastSuccessAt", "2026-10-16T06:00:01.000Z"),
    ("checkedAt", None),
])
def test_timestamp_invariants(field: str, value: object) -> None:
    data = fixture()
    data["components"]["clipText"][field] = value
    with pytest.raises(ValidationError):
        validate(data)


def test_expired_ready_is_not_accepted_from_new_generated_at() -> None:
    data = fixture()
    data["generatedAt"] = "2026-10-16T06:01:00.000Z"
    with pytest.raises(ValidationError):
        validate(data)


def expired_failure(component: str, generated_at: str) -> dict:
    data = fixture()
    data["generatedAt"] = generated_at
    # Keep every other observation fresh so only the selected failure is stale.
    for part in data["components"].values():
        part.update(checkedAt="2026-10-16T06:00:59.000Z",
                    expiresAt="2026-10-16T06:01:59.000Z")
        if part["status"] == "READY":
            part["lastSuccessAt"] = part["checkedAt"]
    part = data["components"][component]
    reason = {"clipImage": "ENCODE_FAILED", "clipText": "ENCODE_FAILED",
              "faiss": "INDEX_SEARCH_FAILED", "elasticsearch": "ES_TIMEOUT"}[component]
    part.update(status="UNAVAILABLE", errorCode=reason,
                checkedAt="2026-10-16T06:00:00.000Z",
                expiresAt="2026-10-16T06:01:00.000Z",
                lastSuccessAt="2026-10-16T05:59:30.000Z")
    affected = {"clipImage": ["imageSearch"], "clipText": ["semanticText", "hybridText"],
                "faiss": ["semanticText", "imageSearch", "hybridText"],
                "elasticsearch": ["hybridText"]}[component]
    for name in affected:
        data["capabilities"][name].update(status="UNAVAILABLE", reasonCodes=[reason])
    return data


@pytest.mark.parametrize("component", ["clipImage", "clipText", "faiss", "elasticsearch"])
def test_failure_is_still_known_immediately_before_expiry(component: str) -> None:
    result = validate(expired_failure(component, "2026-10-16T06:00:59.999Z"))
    assert getattr(result.components, component).status == "UNAVAILABLE"


@pytest.mark.parametrize("component", ["clipImage", "clipText", "faiss", "elasticsearch"])
@pytest.mark.parametrize("generated_at", [
    "2026-10-16T06:01:00.000Z", "2026-10-16T06:01:00.001Z",
])
def test_expired_failure_cannot_remain_unavailable(component: str, generated_at: str) -> None:
    with pytest.raises(ValidationError, match="Expired observations"):
        validate(expired_failure(component, generated_at))


@pytest.mark.parametrize("component", ["clipImage", "clipText", "faiss", "elasticsearch"])
def test_expired_failure_becomes_unknown_without_refreshing_history(component: str) -> None:
    data = expired_failure(component, "2026-10-16T06:01:00.001Z")
    part = data["components"][component]
    history = {key: part[key] for key in ("checkedAt", "expiresAt", "lastSuccessAt")}
    part.update(status="UNKNOWN", errorCode="SNAPSHOT_STALE")
    # A different, still-fresh ES failure continues to disable hybrid.
    unknown_caps = {"clipImage": ["imageSearch"], "clipText": ["semanticText"],
                    "faiss": ["semanticText", "imageSearch"],
                    "elasticsearch": ["hybridText"]}[component]
    for name in unknown_caps:
        data["capabilities"][name].update(status="UNKNOWN", reasonCodes=["SNAPSHOT_STALE"])
    if component in ("clipText", "faiss"):
        data["capabilities"]["hybridText"].update(
            status="UNAVAILABLE", reasonCodes=["ES_TIMEOUT", "SNAPSHOT_STALE"]
        )
    result = validate(data)
    observed = getattr(result.components, component)
    assert observed.status == "UNKNOWN"
    assert {key: getattr(observed, key) for key in history} == history
    part["errorCode"] = "ES_TIMEOUT"
    with pytest.raises(ValidationError, match="Expired observations"):
        validate(data)


@pytest.mark.parametrize("component", ["clipImage", "clipText", "faiss", "elasticsearch"])
@pytest.mark.parametrize("reason", [
    "PROBE_TIMEOUT", "PROBE_BUSY", "NOT_CHECKED", "SNAPSHOT_STALE", "CLOCK_SKEW",
])
def test_uncertain_observation_cannot_claim_unavailable(component: str, reason: str) -> None:
    data = fixture()
    data["components"][component].update(status="UNAVAILABLE", errorCode=reason)
    with pytest.raises(ValidationError, match="requires UNKNOWN"):
        validate(data)


@pytest.mark.parametrize("reason", [
    "PROBE_TIMEOUT", "PROBE_BUSY", "NOT_CHECKED", "SNAPSHOT_STALE", "CLOCK_SKEW",
])
def test_uncertain_es_observation_makes_only_hybrid_unknown(reason: str) -> None:
    data = fixture()
    es = data["components"]["elasticsearch"]
    es.update(status="UNKNOWN", errorCode=reason)
    if reason in ("NOT_CHECKED", "PROBE_BUSY"):
        es.update(checkedAt=None, expiresAt=None, lastSuccessAt=None, durationMs=None)
    data["capabilities"]["hybridText"].update(status="UNKNOWN", reasonCodes=[reason])
    result = validate(data)
    assert result.capabilities.hybridText.status == "UNKNOWN"
    assert result.capabilities.semanticText.status == "READY"
    assert result.capabilities.imageSearch.status == "READY"
    data["capabilities"]["hybridText"]["status"] = "UNAVAILABLE"
    with pytest.raises(ValidationError, match="contradicts dependency"):
        validate(data)


def test_unknown_null_and_empty_index_are_distinct() -> None:
    data = fixture()
    data["components"]["faiss"]["vectorCount"] = 0
    data["components"]["faiss"]["warningCodes"] = ["EMPTY_INDEX"]
    assert validate(data).components.faiss.vectorCount == 0
    data["components"]["faiss"]["vectorCount"] = None
    with pytest.raises(ValidationError):
        validate(data)
    data = fixture()
    for part in data["components"].values():
        part.update(status="UNKNOWN", checkedAt=None, expiresAt=None, lastSuccessAt=None,
                    durationMs=None, errorCode="NOT_CHECKED", warningCodes=[])
        if "dimension" in part:
            part["dimension"] = None
        if "vectorCount" in part:
            part["vectorCount"] = None
        part["loaded"] = None
    for cap in data["capabilities"].values():
        cap.update(status="UNKNOWN", reasonCodes=["NOT_CHECKED"])
    assert validate(data).components.faiss.vectorCount is None


def test_known_failure_precedes_unknown_dependency() -> None:
    assert dependency_status(["UNKNOWN", "UNAVAILABLE"]) == "UNAVAILABLE"
    assert dependency_status(["READY", "UNKNOWN"]) == "UNKNOWN"
    assert dependency_status(["DEGRADED", "DEGRADED"]) == "DEGRADED"


def test_es_failure_does_not_disable_semantic_but_hybrid_cannot_be_green() -> None:
    data = fixture()
    assert validate(data).capabilities.semanticText.status == "READY"
    data["capabilities"]["hybridText"].update(status="READY", reasonCodes=[])
    with pytest.raises(ValidationError):
        validate(data)


def test_dimension_mismatch_requires_capability_failure() -> None:
    data = fixture()
    data["components"]["clipText"]["dimension"] = 768
    with pytest.raises(ValidationError):
        validate(data)
    data["capabilities"]["semanticText"].update(
        status="UNAVAILABLE", reasonCodes=["DIMENSION_MISMATCH"]
    )
    data["capabilities"]["hybridText"]["reasonCodes"].append("DIMENSION_MISMATCH")
    assert validate(data).capabilities.imageSearch.status == "READY"


def stale_dimension_snapshot(model: str) -> dict:
    data = fixture()
    data["generatedAt"] = "2026-10-16T06:01:00.001Z"
    data["components"][model]["dimension"] = 768
    for part in data["components"].values():
        part.update(status="UNKNOWN", errorCode="SNAPSHOT_STALE")
    for cap in data["capabilities"].values():
        cap.update(status="UNKNOWN", reasonCodes=["SNAPSHOT_STALE"])
    return data


@pytest.mark.parametrize("model", ["clipText", "clipImage"])
def test_stale_dimension_mismatch_is_not_current_failure(model: str) -> None:
    data = stale_dimension_snapshot(model)
    history = copy.deepcopy(data["components"])
    snapshot = validate(data)
    assert all(cap.status == "UNKNOWN" for cap in snapshot.capabilities.__dict__.values())
    assert snapshot.model_dump(mode="json")["components"] == history
    affected = ["semanticText", "hybridText"] if model == "clipText" else ["imageSearch"]
    for name in affected:
        data["capabilities"][name].update(
            status="UNAVAILABLE", reasonCodes=["SNAPSHOT_STALE", "DIMENSION_MISMATCH"]
        )
    with pytest.raises(ValidationError):
        validate(data)


@pytest.mark.parametrize("model", ["clipText", "clipImage"])
def test_stale_mismatch_with_fresh_es_failure_disables_only_hybrid(model: str) -> None:
    data = stale_dimension_snapshot(model)
    es = data["components"]["elasticsearch"]
    es.update(status="UNAVAILABLE", errorCode="ES_TIMEOUT",
              checkedAt="2026-10-16T06:01:00.000Z",
              expiresAt="2026-10-16T06:02:00.000Z")
    data["capabilities"]["hybridText"].update(
        status="UNAVAILABLE", reasonCodes=["SNAPSHOT_STALE", "ES_TIMEOUT"]
    )
    snapshot = validate(data)
    assert snapshot.capabilities.hybridText.status == "UNAVAILABLE"
    assert snapshot.capabilities.semanticText.status == "UNKNOWN"
    assert snapshot.capabilities.imageSearch.status == "UNKNOWN"
    data["capabilities"]["hybridText"]["reasonCodes"].append("DIMENSION_MISMATCH")
    with pytest.raises(ValidationError, match="unobserved reason"):
        validate(data)


@pytest.mark.parametrize("model", ["clipText", "clipImage"])
def test_fresh_dimension_mismatch_remains_unavailable(model: str) -> None:
    data = fixture()
    data["components"][model]["dimension"] = 768
    with pytest.raises(ValidationError):
        validate(data)
    affected = ["semanticText", "hybridText"] if model == "clipText" else ["imageSearch"]
    for name in affected:
        data["capabilities"][name].update(
            status="UNAVAILABLE", reasonCodes=["DIMENSION_MISMATCH"]
        )
    snapshot = validate(data)
    assert all(getattr(snapshot.capabilities, name).status == "UNAVAILABLE" for name in affected)


@pytest.mark.parametrize("component", ["clipText", "clipImage", "faiss"])
@pytest.mark.parametrize("reason", ["SNAPSHOT_STALE", "PROBE_TIMEOUT"])
def test_one_uncertain_dimension_observation_is_not_mismatch(component: str, reason: str) -> None:
    data = fixture()
    # Isolate model/index uncertainty from the fixture's independent ES failure.
    es = data["components"]["elasticsearch"]
    es.update(status="READY", errorCode=None, readable=True, indexExists=True,
              lastSuccessAt=es["checkedAt"])
    data["capabilities"]["hybridText"].update(status="READY", reasonCodes=[])
    part = data["components"][component]
    part.update(status="UNKNOWN", errorCode=reason, dimension=768)
    if reason == "SNAPSHOT_STALE":
        part.update(checkedAt="2026-10-16T05:59:00.000Z",
                    expiresAt="2026-10-16T06:00:00.000Z",
                    lastSuccessAt="2026-10-16T05:59:00.000Z")
    affected = {"clipText": ["semanticText", "hybridText"], "clipImage": ["imageSearch"],
                "faiss": ["semanticText", "imageSearch", "hybridText"]}[component]
    for name in affected:
        data["capabilities"][name].update(status="UNKNOWN", reasonCodes=[reason])
    snapshot = validate(data)
    assert all(getattr(snapshot.capabilities, name).status == "UNKNOWN" for name in affected)


def test_all_capabilities_can_be_degraded_without_any_ready() -> None:
    data = fixture()
    es = data["components"]["elasticsearch"]
    es.update(status="READY", indexExists=True, readable=True, durationMs=1,
              errorCode=None, lastSuccessAt=es["checkedAt"])
    data["components"]["faiss"].update(
        vectorCount=0, status="DEGRADED", warningCodes=["EMPTY_INDEX"]
    )
    for cap in data["capabilities"].values():
        cap.update(status="DEGRADED", reasonCodes=[])
    assert all(c.status == "DEGRADED" for c in validate(data).capabilities.__dict__.values())


def test_rrf_error_is_allowlisted_and_hybrid_only() -> None:
    data = fixture()
    data["capabilities"]["hybridText"]["reasonCodes"].append("RRF_CONFIG_INVALID")
    validate(data)
    data["capabilities"]["semanticText"].update(
        status="UNAVAILABLE", reasonCodes=["RRF_CONFIG_INVALID"]
    )
    with pytest.raises(ValidationError):
        validate(data)


@pytest.mark.parametrize("reasons", [["SECRET_EXCEPTION"], ["ES_TIMEOUT", "ES_TIMEOUT"], []])
def test_bad_capability_reasons(reasons: list[str]) -> None:
    data = copy.deepcopy(fixture())
    data["capabilities"]["hybridText"]["reasonCodes"] = reasons
    with pytest.raises(ValidationError):
        validate(data)


def test_contract_does_not_install_internal_health_route() -> None:
    with TestClient(create_app(load_runtime=False)) as client:
        assert "/internal/health/search" not in client.get("/openapi.json").json()["paths"]
        assert client.get("/health").status_code == 200
