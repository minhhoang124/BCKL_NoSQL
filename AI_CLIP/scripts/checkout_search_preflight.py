"""Read-only localhost probes; readiness is never Checkout integration acceptance."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import UTC, datetime
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("redirect refused")


def local_url(value: str) -> str:
    parts = urlsplit(value)
    if (
        parts.scheme != "http"
        or parts.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or parts.path not in {"", "/"}
    ):
        raise ValueError("use an HTTP loopback base URL without credentials/path/query")
    _ = parts.port
    return value.rstrip("/")


def read_json(url: str) -> dict:
    with build_opener(ProxyHandler({}), NoRedirect()).open(url, timeout=5) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("probe response exceeds 2 MB")
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("probe response must be an object")
    return value


def route_present(document: dict, path: str, method: str) -> bool:
    return method in document.get("paths", {}).get(path, {})


def run(backend: str, ai: str, es: str, index: str, getter=read_json) -> dict:
    backend, ai, es = map(local_url, (backend, ai, es))
    if not re.fullmatch(r"chk-search-[a-z0-9-]+", index):
        raise ValueError("index must be an explicit chk-search-... test index")
    checks = []

    def probe(name, url, predicate):
        try:
            passed = predicate(getter(url))
            checks.append({"name": name, "status": "PASS" if passed else "BLOCKED"})
        except Exception as error:
            # Avoid response bodies, connection strings, tokens or arbitrary exception text.
            checks.append({"name": name, "status": "BLOCKED", "errorType": type(error).__name__})

    probe("ai_runtime", ai + "/health", lambda d: (
        d.get("status") == "ok" and d.get("modelLoaded") is True
        and d.get("indexLoaded") is True and type(d.get("vectorCount")) is int
        and d["vectorCount"] >= 0
    ))
    probe("ai_routes", ai + "/openapi.json", lambda d: all(
        route_present(d, path, method) for path, method in (
            ("/index/product", "post"), ("/search/hybrid", "post"),
        )
    ))
    probe("backend_search", backend + "/docs-json", lambda d:
          route_present(d, "/search/hybrid", "post"))
    probe("backend_checkout", backend + "/docs-json", lambda d: all(
        route_present(d, path, method) for path, method in (
            ("/checkout/preview", "post"), ("/checkouts", "post"),
            ("/checkouts/by-key", "get"),
        )
    ))
    probe("elasticsearch_index", es + "/" + index + "/_mapping", lambda d:
          index in d and all(
              key in d[index].get("mappings", {}).get("properties", {})
              for key in ("productId", "version", "inStock", "minPrice", "maxPrice")
          ))
    return {
        "schemaVersion": 1,
        "createdAt": datetime.now(UTC).isoformat(),
        "status": "PROBES_READY" if all(c["status"] == "PASS" for c in checks) else "BLOCKED",
        "integrationStatus": "NOT_RUN",
        "checks": checks,
        "stillRequired": ["DB migrations/fixture isolation", "runtime config/artifact provenance",
                          "real Checkout/worker/index/hydrate assertions CHK-S01–S03"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", required=True)
    parser.add_argument("--ai", required=True)
    parser.add_argument("--elasticsearch", required=True)
    parser.add_argument("--index", required=True)
    args = parser.parse_args()
    try:
        report = run(args.backend, args.ai, args.elasticsearch, args.index)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if report["status"] == "PROBES_READY" else 2)


if __name__ == "__main__":
    main()
