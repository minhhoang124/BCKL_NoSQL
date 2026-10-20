"""Cached read readiness with a bounded cycle and no queue of native probes."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from threading import Event, Thread
from time import monotonic

from app.schemas.search_health_contract import SearchHealthSnapshot, dependency_status, utc
from app.services.search_health_probes import clip_probe, faiss_probe

CAPS = {"elasticsearch": 1.5, "faiss": 0.5, "clipText": 2.0, "clipImage": 2.0}


def timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def blank(name):
    result = dict(
        loaded=None,
        status="UNKNOWN",
        checkedAt=None,
        expiresAt=None,
        lastSuccessAt=None,
        durationMs=None,
        errorCode="NOT_CHECKED",
        warningCodes=[],
    )
    if name == "elasticsearch":
        result.update(indexExists=None, readable=None)
    else:
        result.update(dimension=None)
        if name == "faiss":
            result.update(vectorCount=None)
    return result


class SearchHealthService:
    def __init__(
        self, application, rrf_k: Callable, *, clock=None, monotonic_clock=None, wait=None
    ):
        self.app = application
        self.rrf_k = rrf_k
        self.clock = clock or (lambda: datetime.now(UTC))
        self.monotonic = monotonic_clock or monotonic
        self.wait = wait or asyncio.wait_for
        self.observations = {name: blank(name) for name in CAPS}
        self._observed_at: dict[str, float] = {}
        self._cycling = False
        self._pending: asyncio.Future | None = None
        self._native_started = Event()
        self._task: asyncio.Task | None = None
        self._closed = False

    def start(self):
        if self._task is None and not self._closed:
            self._task = asyncio.create_task(self._loop())

    async def close(self):
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # A daemon native call cannot safely be killed; it retains single-flight.
        # Shutdown does not await it or permit completion to mutate observations.

    async def _loop(self):
        while True:
            next_due = self.monotonic() + 30
            await self.refresh()
            await asyncio.sleep(max(0, next_due - self.monotonic()))

    def snapshot(self) -> SearchHealthSnapshot:
        now = self.clock()
        components = {}
        for name, saved in self.observations.items():
            row = {**saved, "warningCodes": list(saved["warningCodes"])}
            if any(row[key] and utc(row[key]) > now for key in ("checkedAt", "lastSuccessAt")):
                # Future timestamps cannot be valid observations in the wire schema.
                # Preserve history internally; do not shift it to pretend freshness.
                row.update(
                    status="UNKNOWN",
                    errorCode="CLOCK_SKEW",
                    checkedAt=None,
                    expiresAt=None,
                    lastSuccessAt=None,
                    durationMs=None,
                    warningCodes=[],
                )
            elif row["expiresAt"] and (
                now >= utc(row["expiresAt"])
                or self.monotonic() - self._observed_at.get(name, self.monotonic()) >= 60
            ):
                row.update(status="UNKNOWN", errorCode="SNAPSHOT_STALE", warningCodes=[])
            components[name] = row
        capabilities = {}
        for name, model, deps in (
            ("semanticText", "clipText", ("clipText", "faiss")),
            ("imageSearch", "clipImage", ("clipImage", "faiss")),
            ("hybridText", "clipText", ("clipText", "faiss", "elasticsearch")),
        ):
            rows = [components[key] for key in deps]
            status = dependency_status([row["status"] for row in rows])
            reasons = list(dict.fromkeys(row["errorCode"] for row in rows if row["errorCode"]))
            model_row, index = components[model], components["faiss"]
            if (
                all(row["status"] in ("READY", "DEGRADED") for row in (model_row, index))
                and model_row["dimension"] != index["dimension"]
            ):
                status = "UNAVAILABLE"
                reasons.append("DIMENSION_MISMATCH")
            k = self.rrf_k()
            if name == "hybridText" and (type(k) is not int or k < 1):
                status = "UNAVAILABLE"
                reasons.append("RRF_CONFIG_INVALID")
            capabilities[name] = dict(status=status, reasonCodes=reasons)
        return SearchHealthSnapshot.model_validate(
            dict(
                schemaVersion=1,
                generatedAt=timestamp(now),
                components=components,
                capabilities=capabilities,
            )
        )

    def _unknown(self, name, code, *, checked=None, duration=None):
        row = {
            **self.observations[name],
            "status": "UNKNOWN",
            "errorCode": code,
            "warningCodes": [],
        }
        if checked is not None:
            row.update(
                checkedAt=timestamp(checked),
                expiresAt=timestamp(checked + timedelta(seconds=60)),
                durationMs=duration,
            )
            self._observed_at[name] = self.monotonic()
        self.observations[name] = row

    def _record(self, name, metadata, checked, duration):
        row = blank(name)
        row.update(metadata)
        code = metadata.get("errorCode")
        row["errorCode"] = code
        row.update(
            status="UNAVAILABLE" if code else "READY",
            checkedAt=timestamp(checked),
            expiresAt=timestamp(checked + timedelta(seconds=60)),
            durationMs=duration,
            lastSuccessAt=(
                self.observations[name]["lastSuccessAt"] if code else timestamp(checked)
            ),
        )
        self.observations[name] = row
        self._observed_at[name] = self.monotonic()

    def _native(self, name, deadline):
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending = future
        self._native_started = Event()

        def finish(result):
            if not future.done():
                future.set_result(result)

        def run():
            # Budget includes thread dispatch. A late thread must not begin inference.
            started = self.monotonic()
            if self._closed or started >= deadline:
                result = (None, None, "NOT_CHECKED")
            else:
                self._native_started.set()
                try:
                    state = self.app.state
                    if name == "faiss":
                        metadata = faiss_probe(getattr(state, "faiss_service", None))
                    else:
                        metadata = clip_probe(
                            getattr(state, "clip_service", None),
                            "text" if name == "clipText" else "image",
                            state.image_service,
                        )
                    result = (metadata, started, None)
                except BlockingIOError:
                    result = (None, None, "PROBE_BUSY")
                except Exception:
                    result = (
                        {
                            "errorCode": "INDEX_SEARCH_FAILED"
                            if name == "faiss"
                            else "ENCODE_FAILED"
                        },
                        started,
                        None,
                    )
            try:
                loop.call_soon_threadsafe(finish, result)
            except RuntimeError:
                pass  # Event loop closed during bounded shutdown.

        try:
            Thread(target=run, daemon=True, name="search-health-probe").start()
        except RuntimeError:
            finish((None, None, "PROBE_BUSY"))
        return future

    async def refresh(self) -> bool:
        if self._closed or self._cycling or (self._pending and not self._pending.done()):
            return False
        self._cycling = True
        deadline = self.monotonic() + 5.0
        try:
            for name, cap in CAPS.items():
                remaining = deadline - self.monotonic()
                if remaining <= 0 or (self._pending and not self._pending.done()):
                    self._unknown(name, "PROBE_BUSY")
                    continue
                started = self.monotonic()
                budget = min(cap, remaining)
                probe_deadline = started + budget
                try:
                    if name == "elasticsearch":
                        metadata = await self.wait(
                            self.app.state.elasticsearch_service.readiness_probe(budget), budget
                        )
                    else:
                        metadata, native_start, uncertain = await self.wait(
                            asyncio.shield(self._native(name, probe_deadline)), budget
                        )
                        if uncertain:
                            self._unknown(name, uncertain)
                            continue
                        started = native_start
                    checked = self.clock()
                    elapsed = self.monotonic() - started
                    if self.monotonic() >= min(deadline, probe_deadline):
                        self._unknown(
                            name, "PROBE_TIMEOUT", checked=checked, duration=elapsed * 1000
                        )
                    else:
                        self._record(name, metadata, checked, elapsed * 1000)
                except TimeoutError:
                    if name != "elasticsearch" and not self._native_started.is_set():
                        self._unknown(name, "NOT_CHECKED")
                    else:
                        self._unknown(
                            name,
                            "PROBE_TIMEOUT",
                            checked=self.clock(),
                            duration=(self.monotonic() - started) * 1000,
                        )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self._record(
                        name,
                        {
                            "errorCode": "ES_QUERY_FAILED"
                            if name == "elasticsearch"
                            else "INDEX_SEARCH_FAILED"
                            if name == "faiss"
                            else "ENCODE_FAILED"
                        },
                        self.clock(),
                        (self.monotonic() - started) * 1000,
                    )
            return True
        finally:
            self._cycling = False
