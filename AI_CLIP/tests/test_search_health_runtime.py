import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from threading import Event, Thread
from types import SimpleNamespace

import faiss
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.services.clip_service import ClipService
from app.services.elasticsearch_service import INDEX_MAPPING, ElasticsearchService
from app.services.faiss_service import FaissService
from app.services.image_service import ImageService
from app.services.search_health_probes import PROBE_PNG, clip_probe, faiss_probe
from app.services.search_health_service import CAPS, SearchHealthService


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 20, tzinfo=UTC)
        self.elapsed = 0.0

    def advance(self, seconds):
        self.elapsed += seconds
        self.now += timedelta(seconds=seconds)


class Model:
    def __init__(self, vector=None, error=False):
        self.vector = np.ones((1, 3), dtype="float32") if vector is None else vector
        self.error = error
        self.calls = 0

    def encode(self, inputs, **kwargs):
        self.calls += 1
        if self.error:
            raise RuntimeError("secret http://private-server/token must not leak")
        return self.vector


def clip():
    service = ClipService(Settings(_env_file=None))
    service._image_model = Model()
    service._text_model = Model()
    return service


def index(tmp_path, count=1):
    path = tmp_path / "test.faiss"
    native = faiss.IndexIDMap2(faiss.IndexFlatIP(3))
    if count:
        native.add_with_ids(np.array([[1, 0, 0]], dtype="float32"), np.array([125]))
    faiss.write_index(native, str(path))
    service = FaissService(path, tmp_path / "state.json")
    service.load()
    return service


class ES:
    async def readiness_probe(self, timeout):
        return dict(loaded=None, indexExists=True, readable=True)


def collector(tmp_path, *, clock=None):
    state = SimpleNamespace(
        clip_service=clip(),
        faiss_service=index(tmp_path),
        elasticsearch_service=ES(),
        image_service=ImageService(10000, 10000),
    )
    clock = clock or Clock()
    return SearchHealthService(
        SimpleNamespace(state=state),
        lambda: 60,
        clock=lambda: clock.now,
        monotonic_clock=lambda: clock.elapsed,
    )


def test_probe_png_uses_real_image_decoder():
    assert ImageService(10000, 10000).decode(PROBE_PNG).size == (1, 1)


@pytest.mark.parametrize("kind", ["image", "text"])
def test_clip_loaded_separate_from_encode_failure(kind):
    service = clip()
    getattr(service, f"_{kind}_model").error = True
    assert clip_probe(service, kind, ImageService(10000, 10000)) == {
        "loaded": True,
        "dimension": None,
        "errorCode": "ENCODE_FAILED",
    }
    setattr(service, f"_{kind}_model", None)
    assert clip_probe(service, kind, ImageService(10000, 10000))["errorCode"] == "MODEL_NOT_LOADED"
    assert service.model_loaded("text" if kind == "image" else "image")


@pytest.mark.parametrize(
    "value",
    [
        np.zeros((1, 3)),
        np.array([[np.nan, 1, 1]]),
        np.array([[np.inf, 1, 1]]),
        np.ones((2, 3)),
        np.ones(3),
        np.ones((1, 0)),
        np.ones((1, 3), dtype=int),
    ],
)
def test_reject_invalid_embeddings(value):
    service = clip()
    service.probe_embedding = lambda kind, image=None: value
    assert clip_probe(service, "text", None)["errorCode"] == "INVALID_EMBEDDING"


def test_faiss_real_read_is_immutable_and_handles_empty(tmp_path):
    service = index(tmp_path)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert faiss_probe(service) == dict(loaded=True, dimension=3, vectorCount=1)
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before
    native = index(tmp_path, count=0)
    assert faiss_probe(native) == dict(
        loaded=True, dimension=3, vectorCount=0, warningCodes=["EMPTY_INDEX"]
    )
    assert faiss_probe(None)["errorCode"] == "INDEX_NOT_LOADED"


@pytest.mark.parametrize(
    "count,score,identity",
    [
        (1, np.nan, 125),
        (1, np.inf, 125),
        (1, 1, -1),
        (1, 1, 0),
        (1, 1, True),
        (0, 0, -1),
        (0, -1, -1),
        (0, -np.inf, 1),
    ],
)
def test_reject_bad_faiss_hits(count, score, identity):
    service = SimpleNamespace(
        is_loaded=True, probe_search=lambda: (3, count, np.array([score]), np.array([identity]))
    )
    assert faiss_probe(service)["errorCode"] == "INVALID_INDEX_RESULT"


def test_probe_never_waits_behind_foreground_lock(tmp_path):
    for service, operation in [
        (clip(), lambda s: clip_probe(s, "text", None)),
        (index(tmp_path), faiss_probe),
    ]:
        entered, release = Event(), Event()

        def hold(target=service, ready=entered, done=release):
            with target._lock:
                ready.set()
                assert done.wait(3)

        worker = Thread(target=hold)
        worker.start()
        assert entered.wait(3)
        try:
            with pytest.raises(BlockingIOError):
                operation(service)
        finally:
            release.set()
            worker.join(3)


def test_snapshot_cache_expiry_failure_history_and_dependencies(tmp_path):
    clock = Clock()
    health = collector(tmp_path, clock=clock)
    assert health.snapshot().capabilities.hybridText.status == "UNKNOWN"
    asyncio.run(health.refresh())
    initial = health.snapshot()
    assert all(c.status == "READY" for c in initial.capabilities.__dict__.values())
    success_at = initial.components.clipText.lastSuccessAt
    calls = health.app.state.clip_service._text_model.calls
    for _ in range(20):
        assert health.snapshot().components.clipText.checkedAt == success_at
    assert health.app.state.clip_service._text_model.calls == calls
    clock.advance(1)
    health.app.state.clip_service._text_model.error = True
    asyncio.run(health.refresh())
    failure = health.snapshot()
    assert failure.components.clipText.loaded is True
    assert failure.components.clipText.status == "UNAVAILABLE"
    assert failure.components.clipText.lastSuccessAt == success_at
    assert failure.capabilities.imageSearch.status == "READY"
    clock.advance(60)
    expired = health.snapshot()
    assert expired.components.clipText.errorCode == "SNAPSHOT_STALE"
    assert expired.capabilities.hybridText.status == "UNKNOWN"
    assert expired.components.clipText.lastSuccessAt == success_at


def test_fresh_mismatch_stale_mismatch_rrf_and_es_failure(tmp_path):
    clock = Clock()
    health = collector(tmp_path, clock=clock)
    health.app.state.clip_service._text_model.vector = np.ones((1, 4), dtype="float32")
    asyncio.run(health.refresh())
    assert health.snapshot().capabilities.semanticText.reasonCodes == ["DIMENSION_MISMATCH"]
    assert health.snapshot().capabilities.imageSearch.status == "READY"
    clock.advance(60)
    snapshot = health.snapshot()
    assert snapshot.capabilities.semanticText.status == "UNKNOWN"
    health._record(
        "elasticsearch",
        dict(loaded=None, indexExists=True, readable=False, errorCode="ES_QUERY_FAILED"),
        clock.now,
        1.0,
    )
    assert health.snapshot().capabilities.hybridText.status == "UNAVAILABLE"
    assert "DIMENSION_MISMATCH" not in health.snapshot().capabilities.hybridText.reasonCodes
    health.rrf_k = lambda: True
    assert "RRF_CONFIG_INVALID" in health.snapshot().capabilities.hybridText.reasonCodes


def test_clock_rollback_does_not_publish_future_probe(tmp_path):
    clock = Clock()
    health = collector(tmp_path, clock=clock)
    asyncio.run(health.refresh())
    stored = deepcopy(health.observations)
    clock.advance(-1)
    assert health.snapshot().components.clipText.errorCode == "CLOCK_SKEW"
    assert health.observations == stored


def test_clock_adjustment_cannot_extend_monotonic_ttl(tmp_path):
    clock = Clock()
    health = collector(tmp_path, clock=clock)
    asyncio.run(health.refresh())
    saved = deepcopy(health.observations)
    clock.elapsed = 61
    clock.now += timedelta(seconds=10)  # Wall clock adjusted back while process ran.
    assert health.snapshot().components.clipText.errorCode == "SNAPSHOT_STALE"
    assert health.observations == saved


def test_native_dispatch_failure_is_unknown_not_a_failed_model(tmp_path, monkeypatch):
    import app.services.search_health_service as module

    class BrokenThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            raise RuntimeError("cannot start thread")

    health = collector(tmp_path)
    monkeypatch.setattr(module, "Thread", BrokenThread)
    asyncio.run(health.refresh())
    assert health.snapshot().components.clipText.errorCode == "PROBE_BUSY"
    assert health.snapshot().components.clipText.checkedAt is None
    assert health._pending.done()


def test_hung_native_singleflight_late_completion_and_concurrent_refresh(tmp_path):
    async def scenario():
        clock = Clock()
        health = collector(tmp_path, clock=clock)
        entered, release = Event(), Event()
        original = health.app.state.clip_service.probe_embedding

        def block(kind, image=None):
            if kind == "text":
                entered.set()
                assert release.wait(3)
            return original(kind, image)

        health.app.state.clip_service.probe_embedding = block
        wait_count = 0

        async def barrier_timeout(future, timeout):
            nonlocal wait_count
            wait_count += 1
            if wait_count == 3:  # ES, FAISS, then native text
                assert await asyncio.to_thread(entered.wait, 2)
                assert await health.refresh() is False
                clock.advance(timeout)
                raise TimeoutError()
            return await asyncio.wait_for(future, 2)

        health.wait = barrier_timeout
        try:
            assert await health.refresh()
            stored = deepcopy(health.observations)
            assert health.snapshot().components.clipText.errorCode == "PROBE_TIMEOUT"
            assert health.snapshot().components.clipImage.errorCode == "PROBE_BUSY"
            assert health.snapshot().components.clipImage.checkedAt is None
            for _ in range(25):
                health.snapshot()
                assert await health.refresh() is False
            release.set()
            await asyncio.wait_for(asyncio.shield(health._pending), 2)
            assert health.observations == stored  # late result cannot turn green
            health.wait = asyncio.wait_for
            assert await health.refresh()
            assert health.snapshot().components.clipText.status == "READY"
        finally:
            release.set()
            await health.close()

    asyncio.run(scenario())


def test_cycle_budget_includes_dispatch_and_caps_remaining_time(tmp_path):
    async def scenario():
        clock = Clock()
        health = collector(tmp_path, clock=clock)
        budgets = []

        async def advance(future, timeout):
            budgets.append(timeout)
            result = await asyncio.wait_for(future, 2)
            clock.advance(timeout - 0.01 if len(budgets) < 4 else timeout)
            return result

        health.wait = advance
        await health.refresh()
        assert budgets[:3] == [1.5, 0.5, 2.0]
        assert budgets[3] == pytest.approx(1.03)
        assert clock.elapsed == pytest.approx(5.0)
        assert health.snapshot().components.clipImage.errorCode == "PROBE_TIMEOUT"

    asyncio.run(scenario())


def test_no_dispatch_after_cycle_deadline(tmp_path):
    async def scenario():
        clock = Clock()
        health = collector(tmp_path, clock=clock)

        async def exhaust(future, timeout):
            result = await future
            clock.advance(5)
            return result

        health.wait = exhaust
        await health.refresh()
        assert health._pending is None
        for name in CAPS:
            if name != "elasticsearch":
                assert health.observations[name]["checkedAt"] is None
                assert health.observations[name]["errorCode"] == "PROBE_BUSY"

    asyncio.run(scenario())


def test_thread_dispatch_delay_never_starts_native_after_deadline(tmp_path, monkeypatch):
    import app.services.search_health_service as module

    async def scenario():
        clock = Clock()
        health = collector(tmp_path, clock=clock)
        deferred = []

        class DelayedThread:
            def __init__(self, *, target, **kwargs):
                self.target = target

            def start(self):
                deferred.append(self.target)

        monkeypatch.setattr(module, "Thread", DelayedThread)
        n = 0

        async def expire(future, timeout):
            nonlocal n
            n += 1
            if n == 1:
                return await future
            clock.advance(timeout)
            raise TimeoutError()

        health.wait = expire
        await health.refresh()
        assert len(deferred) == 1
        assert health.observations["faiss"]["errorCode"] == "NOT_CHECKED"
        assert health.observations["faiss"]["checkedAt"] is None
        stored = deepcopy(health.observations)
        assert await health.refresh() is False
        deferred[0]()  # OS dispatch finally occurs after the deadline.
        await health._pending
        assert health.observations == stored
        assert health.app.state.clip_service._text_model.calls == 0
        await health.close()

    asyncio.run(scenario())


def test_scheduler_start_is_idempotent_and_shutdown_is_bounded(tmp_path):
    async def scenario():
        health = collector(tmp_path)
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def refresh():
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        health.refresh = refresh
        health.start()
        first = health._task
        health.start()
        assert health._task is first
        await asyncio.wait_for(entered.wait(), 2)
        await asyncio.wait_for(health.close(), 2)
        assert cancelled.is_set()
        assert first.done()
        health.start()
        assert health._task is first

    asyncio.run(scenario())


def es_body(*, total=1):
    return {
        "timed_out": False,
        "_shards": {"total": 1, "successful": 1, "skipped": 0, "failed": 0},
        "hits": {
            "total": {"value": total, "relation": "eq"},
            "hits": [{"_source": {"productId": 125}, "_score": 1.0}] if total else [],
        },
    }


@pytest.mark.parametrize("field", ["name", "description"])
def test_unqueryable_text_marks_only_hybrid_unavailable(tmp_path, field):
    async def scenario():
        health = collector(tmp_path)
        mapping = deepcopy(INDEX_MAPPING)
        mapping["mappings"]["properties"][field]["index"] = False

        def handle(request):
            assert request.method == "GET"
            assert request.url.path.endswith("/_mapping")
            return httpx.Response(200, json={"products": mapping})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            health.app.state.elasticsearch_service = ElasticsearchService(
                "http://es", "products", client=client,
            )
            await health.refresh()
        snapshot = health.snapshot()
        assert snapshot.components.elasticsearch.status == "UNAVAILABLE"
        assert snapshot.components.elasticsearch.errorCode == "ES_MAPPING_INVALID"
        assert snapshot.capabilities.hybridText.status == "UNAVAILABLE"
        assert snapshot.capabilities.hybridText.reasonCodes == ["ES_MAPPING_INVALID"]
        assert snapshot.capabilities.semanticText.status == "READY"
        assert snapshot.capabilities.imageSearch.status == "READY"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "failure,expected",
    [
        ("good", None),
        ("empty", None),
        ("404", "ES_INDEX_MISSING"),
        ("401", "ES_AUTH_FAILED"),
        ("403", "ES_AUTH_FAILED"),
        ("mapping", "ES_MAPPING_INVALID"),
        ("timeout", "ES_TIMEOUT"),
        ("connect", "ES_UNREACHABLE"),
        ("shards", "ES_QUERY_FAILED"),
        ("timedout", "ES_QUERY_FAILED"),
        ("shape", "ES_QUERY_FAILED"),
        ("badid", "ES_QUERY_FAILED"),
        ("redirect", "ES_QUERY_FAILED"),
        ("oversize", "ES_QUERY_FAILED"),
        ("invalidjson", "ES_MAPPING_INVALID"),
    ],
)
def test_es_readonly_probe(failure, expected):
    async def scenario():
        requests = []

        def handle(req):
            requests.append(req)
            assert req.method == "GET"
            assert req.url.params["allow_no_indices"] == "false"
            assert req.url.params["ignore_unavailable"] == "false"
            if failure in ("401", "403", "404"):
                return httpx.Response(int(failure))
            if failure == "timeout":
                raise httpx.ReadTimeout("secret")
            if failure == "connect":
                raise httpx.ConnectError("secret")
            if failure == "redirect":
                return httpx.Response(302, headers={"location": "http://secret/"})
            if failure == "oversize":
                return httpx.Response(200, content=b"x" * 262145)
            if req.url.path.endswith("_mapping"):
                if failure == "invalidjson":
                    return httpx.Response(200, content=b"not-json")
                mapping = deepcopy(INDEX_MAPPING)
                if failure == "mapping":
                    mapping["mappings"]["properties"]["name"]["type"] = "keyword"
                return httpx.Response(200, json={"products": mapping})
            assert req.url.path.endswith("/_search")
            body = es_body(total=0 if failure == "empty" else 1)
            if failure == "shards":
                body["_shards"]["failed"] = 1
            if failure == "timedout":
                body["timed_out"] = True
            if failure == "shape":
                body.pop("hits")
            if failure == "badid":
                body["hits"]["hits"][0]["_source"]["productId"] = True
            return httpx.Response(200, json=body)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            service = ElasticsearchService("http://es", "products", client=client)
            result = await service.readiness_probe(1.5)
        assert result.get("errorCode") == expected
        assert len(requests) == (
            2 if failure in ("good", "empty", "shards", "timedout", "shape", "badid") else 1
        )
        if failure == "empty":
            assert result["warningCodes"] == ["EMPTY_INDEX"]
        assert "secret" not in str(result)

    asyncio.run(scenario())


def test_es_failure_only_blocks_hybrid(tmp_path):
    health = collector(tmp_path)

    async def failure(timeout):
        return dict(loaded=None, indexExists=False, readable=False, errorCode="ES_INDEX_MISSING")

    health.app.state.elasticsearch_service.readiness_probe = failure
    asyncio.run(health.refresh())
    snapshot = health.snapshot()
    assert snapshot.capabilities.semanticText.status == "READY"
    assert snapshot.capabilities.imageSearch.status == "READY"
    assert snapshot.capabilities.hybridText.status == "UNAVAILABLE"


def test_internal_auth_no_store_duplicate_headers_and_cached_get(tmp_path):
    app = create_app(load_runtime=False)
    health = collector(tmp_path)
    app.state.search_health_service = health
    app.state.internal_health_token = None
    with TestClient(app) as client:
        missing = client.get("/internal/health/search")
        assert missing.status_code == 503
        assert missing.json() == {"code": "INTERNAL_HEALTH_NOT_CONFIGURED"}
        assert missing.headers["cache-control"] == "no-store"
        app.state.internal_health_token = SecretStr("test-only-health-token")
        health.start = lambda: None  # Explicit refresh only for deterministic HTTP test.
        for headers in [
            [],
            [("X-Internal-Health-Token", "bad")],
            [("X-Internal-Health-Token", "test-only-health-token")] * 2,
        ]:
            response = client.get("/internal/health/search", headers=headers)
            assert response.status_code == 401
            assert response.headers["cache-control"] == "no-store"
        good = {"X-Internal-Health-Token": "test-only-health-token"}
        for _ in range(20):
            response = client.get("/internal/health/search", headers=good)
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            assert response.json()["capabilities"]["semanticText"]["status"] == "UNKNOWN"
        assert health.app.state.clip_service._text_model.calls == 0
        assert client.get("/health").json()["status"] == "ok"


def test_concurrent_http_reads_only_use_cache_and_200_can_mean_unavailable(tmp_path):
    async def scenario():
        app = create_app(load_runtime=False)
        health = collector(tmp_path)
        app.state.search_health_service = health
        app.state.internal_health_token = SecretStr("test-only-health-token")
        await health.refresh()
        health._record(
            "elasticsearch",
            dict(loaded=None, indexExists=False, readable=False, errorCode="ES_INDEX_MISSING"),
            health.clock(),
            1.0,
        )
        saved = deepcopy(health.observations)
        count = health.app.state.clip_service._text_model.calls
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            responses = await asyncio.gather(
                *[
                    client.get(
                        "/internal/health/search",
                        headers={"X-Internal-Health-Token": "test-only-health-token"},
                    )
                    for _ in range(100)
                ]
            )
        assert all(response.status_code == 200 for response in responses)
        assert all(
            response.json()["capabilities"]["hybridText"]["status"] == "UNAVAILABLE"
            for response in responses
        )
        assert all(
            response.json()["capabilities"]["semanticText"]["status"] == "READY"
            for response in responses
        )
        assert health.observations == saved
        assert health.app.state.clip_service._text_model.calls == count
        await app.state.image_download_service.close()
        await app.state.elasticsearch_service.close()

    asyncio.run(scenario())
