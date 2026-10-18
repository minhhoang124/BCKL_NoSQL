"""Unit checks for preflight reporting, not cross-service integration evidence."""

import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "checkout_preflight", Path(__file__).parents[1] / "scripts/checkout_search_preflight.py"
)
assert SPEC and SPEC.loader
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


@pytest.mark.parametrize("url", [
    "http://example.com", "http://user:secret@localhost:8000", "https://localhost",
    "http://localhost/path", "http://localhost?token=secret",
])
def test_refuses_nonlocal_or_sensitive_urls(url):
    with pytest.raises(ValueError):
        preflight.local_url(url)


def responses(url):
    if url.endswith("/health"):
        return {"status": "ok", "modelLoaded": True, "indexLoaded": True, "vectorCount": 0}
    if url.endswith("/_mapping"):
        return {"chk-search-unit": {"mappings": {"properties": {
            key: {} for key in ("productId", "version", "inStock", "minPrice", "maxPrice")
        }}}}
    return {"paths": {path: {method: {}} for path, method in (
        ("/checkout/preview", "post"), ("/checkouts", "post"),
        ("/checkouts/by-key", "get"), ("/search/hybrid", "post"), ("/index/product", "post"),
    )}}


def invoke(getter):
    return preflight.run("http://localhost:3301", "http://localhost:8108",
                         "http://localhost:19228", "chk-search-unit", getter)


def test_ready_probes_never_claim_integration_pass():
    report = invoke(responses)
    assert report["status"] == "PROBES_READY"
    assert report["integrationStatus"] == "NOT_RUN"


def test_missing_checkout_blocks_readiness():
    report = invoke(lambda url: {"paths": {}} if url.endswith("/docs-json") else responses(url))
    assert report["status"] == "BLOCKED"
    checkout = next(c for c in report["checks"] if c["name"] == "backend_checkout")
    assert checkout["status"] == "BLOCKED"


def test_exception_does_not_leak_details():
    def fail(url):
        raise ValueError("secret-password-and-token")
    report = invoke(fail)
    assert report["status"] == "BLOCKED"
    assert "secret" not in str(report)


def test_refuses_demo_index():
    with pytest.raises(ValueError):
        preflight.run("http://localhost", "http://localhost", "http://localhost", "products")
