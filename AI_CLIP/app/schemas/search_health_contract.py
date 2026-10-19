"""Proposed wire contract only; no route, auth, scheduler or live probe is installed."""

import re
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HealthStatus = Literal["READY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"]
ReasonCode = Literal[
    "NOT_CHECKED", "SNAPSHOT_STALE", "PROBE_BUSY", "PROBE_TIMEOUT", "CLOCK_SKEW",
    "MODEL_NOT_LOADED", "ENCODE_FAILED", "INVALID_EMBEDDING", "DIMENSION_MISMATCH",
    "INDEX_NOT_LOADED", "INDEX_SEARCH_FAILED", "INVALID_INDEX_RESULT",
    "ES_UNREACHABLE", "ES_TIMEOUT", "ES_AUTH_FAILED", "ES_INDEX_MISSING",
    "ES_MAPPING_INVALID", "ES_QUERY_FAILED", "RRF_CONFIG_INVALID",
]
WarningCode = Literal["EMPTY_INDEX", "ES_REPLICA_WARNING"]
PositiveInt = Annotated[int, Field(gt=0)]
NonnegativeInt = Annotated[int, Field(ge=0)]
Milliseconds = Annotated[float, Field(ge=0)]
UNKNOWN_ONLY_REASONS = frozenset({
    "NOT_CHECKED", "SNAPSHOT_STALE", "PROBE_BUSY", "PROBE_TIMEOUT", "CLOCK_SKEW",
})


def utc(value: str) -> datetime:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        raise ValueError("Expected UTC timestamp with millisecond precision")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Component(WireModel):
    loaded: bool | None
    status: HealthStatus
    checkedAt: str | None
    expiresAt: str | None
    lastSuccessAt: str | None
    durationMs: Milliseconds | None
    errorCode: ReasonCode | None
    warningCodes: list[WarningCode]

    @model_validator(mode="after")
    def observation(self) -> Self:
        if len(self.warningCodes) != len(set(self.warningCodes)):
            raise ValueError("Duplicate warnings")
        if (self.checkedAt is None) != (self.expiresAt is None):
            raise ValueError("checkedAt/expiresAt must be paired")
        checked = utc(self.checkedAt) if self.checkedAt is not None else None
        if self.expiresAt is not None:
            ttl = (utc(self.expiresAt) - checked).total_seconds()
            if not 0 < ttl <= 60:
                raise ValueError("Snapshot TTL must be in (0,60] seconds")
        if self.lastSuccessAt is not None:
            if checked is None or utc(self.lastSuccessAt) > checked:
                raise ValueError("Success cannot be later than latest observation")
        if checked is None and self.durationMs is not None:
            raise ValueError("No measured duration without a probe observation")
        if self.status in ("READY", "DEGRADED"):
            if checked is None or self.durationMs is None or self.lastSuccessAt != self.checkedAt:
                raise ValueError("Usable observation needs a successful measured probe")
            if self.errorCode is not None:
                raise ValueError("Usable observation cannot contain an error")
            if self.status == "DEGRADED" and not self.warningCodes:
                raise ValueError("Degraded requires an observed warning")
        elif self.errorCode is None:
            raise ValueError("Unavailable/unknown requires an allowlisted reason")
        if self.errorCode in UNKNOWN_ONLY_REASONS and self.status != "UNKNOWN":
            raise ValueError("Uncertain observation requires UNKNOWN, not a proven failure")
        return self


class ClipComponent(Component):
    dimension: PositiveInt | None

    @model_validator(mode="after")
    def model_metadata(self) -> Self:
        if self.warningCodes:
            raise ValueError("No CLIP warnings defined in v1")
        if self.status in ("READY", "DEGRADED") and (
            self.loaded is not True or self.dimension is None
        ):
            raise ValueError("Usable model requires loaded/dimension")
        return self


class FaissComponent(Component):
    dimension: PositiveInt | None
    vectorCount: NonnegativeInt | None

    @model_validator(mode="after")
    def index_metadata(self) -> Self:
        if "ES_REPLICA_WARNING" in self.warningCodes:
            raise ValueError("ES warning does not belong to FAISS")
        if self.status in ("READY", "DEGRADED"):
            if self.loaded is not True or self.dimension is None or self.vectorCount is None:
                raise ValueError("Usable FAISS needs measured metadata")
            if (self.vectorCount == 0) != ("EMPTY_INDEX" in self.warningCodes):
                raise ValueError("Empty index warning must match measured count")
        return self


class ElasticsearchComponent(Component):
    indexExists: bool | None
    readable: bool | None

    @model_validator(mode="after")
    def index_metadata(self) -> Self:
        if self.loaded is not None:
            raise ValueError("ES loaded is not applicable")
        if self.status in ("READY", "DEGRADED") and (
            self.indexExists is not True or self.readable is not True
        ):
            raise ValueError("Usable ES requires target index and successful read")
        return self


class Components(WireModel):
    clipImage: ClipComponent
    clipText: ClipComponent
    faiss: FaissComponent
    elasticsearch: ElasticsearchComponent


class Capability(WireModel):
    status: HealthStatus
    reasonCodes: list[ReasonCode]

    @model_validator(mode="after")
    def reasons(self) -> Self:
        if len(self.reasonCodes) != len(set(self.reasonCodes)):
            raise ValueError("Duplicate reasons")
        if self.status in ("UNKNOWN", "UNAVAILABLE") and not self.reasonCodes:
            raise ValueError("Nonusable capability requires reasons")
        if self.status in ("READY", "DEGRADED") and self.reasonCodes:
            raise ValueError("Capability warnings are observed on its components")
        return self


class Capabilities(WireModel):
    semanticText: Capability
    imageSearch: Capability
    hybridText: Capability


def dependency_status(statuses: list[HealthStatus]) -> HealthStatus:
    if "UNAVAILABLE" in statuses:
        return "UNAVAILABLE"
    if "UNKNOWN" in statuses:
        return "UNKNOWN"
    return "DEGRADED" if "DEGRADED" in statuses else "READY"


class SearchHealthSnapshot(WireModel):
    schemaVersion: Literal[1]
    generatedAt: str
    components: Components
    capabilities: Capabilities

    @field_validator("schemaVersion", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schemaVersion must be an integer, not bool/string")
        return value

    @model_validator(mode="after")
    def snapshot_semantics(self) -> Self:
        generated = utc(self.generatedAt)
        parts = self.components
        for item in (parts.clipImage, parts.clipText, parts.faiss, parts.elasticsearch):
            if item.checkedAt is not None and utc(item.checkedAt) > generated:
                raise ValueError("Producer cannot generate a snapshot before its observation")
            if item.expiresAt is not None and generated >= utc(item.expiresAt):
                if item.status != "UNKNOWN" or item.errorCode != "SNAPSHOT_STALE":
                    raise ValueError("Expired observations require UNKNOWN/SNAPSHOT_STALE")
        cases = (
            (self.capabilities.semanticText, parts.clipText, [parts.clipText, parts.faiss]),
            (self.capabilities.imageSearch, parts.clipImage, [parts.clipImage, parts.faiss]),
            (self.capabilities.hybridText, parts.clipText,
             [parts.clipText, parts.faiss, parts.elasticsearch]),
        )
        for cap, model, deps in cases:
            expected = dependency_status([v.status for v in deps])
            # loaded/dimension can survive as historical metadata on UNKNOWN.
            # Only successful, unexpired observations prove a current mismatch.
            mismatch = (
                model.status in ("READY", "DEGRADED")
                and parts.faiss.status in ("READY", "DEGRADED")
                and model.expiresAt is not None and parts.faiss.expiresAt is not None
                and generated < utc(model.expiresAt)
                and generated < utc(parts.faiss.expiresAt)
                and model.loaded is True and parts.faiss.loaded is True
                and model.dimension is not None and parts.faiss.dimension is not None
                and model.dimension != parts.faiss.dimension
            )
            rrf_error = cap is self.capabilities.hybridText and (
                "RRF_CONFIG_INVALID" in cap.reasonCodes
            )
            if mismatch or rrf_error:
                expected = "UNAVAILABLE"
            if cap.status != expected:
                raise ValueError("Capability contradicts dependency observations")
            if mismatch and "DIMENSION_MISMATCH" not in cap.reasonCodes:
                raise ValueError("Dimension mismatch requires explicit reason")
            if "RRF_CONFIG_INVALID" in cap.reasonCodes and not rrf_error:
                raise ValueError("RRF configuration affects hybrid only")
            for reason in cap.reasonCodes:
                observed = [v.errorCode for v in deps]
                if reason not in observed and not (
                    reason == "DIMENSION_MISMATCH" and mismatch
                ) and not (reason == "RRF_CONFIG_INVALID" and rrf_error):
                    raise ValueError("Capability cannot invent an unobserved reason")
        return self
