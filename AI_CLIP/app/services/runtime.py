from dataclasses import dataclass
from threading import RLock

from app.schemas.health import HealthResponse


@dataclass
class RuntimeSnapshot:
    model_loaded: bool = False
    index_loaded: bool = False
    vector_count: int = 0


class RuntimeState:
    """Thread-safe process state reported by the health endpoint."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._snapshot = RuntimeSnapshot()

    def update(
        self,
        *,
        model_loaded: bool | None = None,
        index_loaded: bool | None = None,
        vector_count: int | None = None,
    ) -> None:
        if vector_count is not None and vector_count < 0:
            raise ValueError("vector_count must be non-negative")

        with self._lock:
            if model_loaded is not None:
                self._snapshot.model_loaded = model_loaded
            if index_loaded is not None:
                self._snapshot.index_loaded = index_loaded
            if vector_count is not None:
                self._snapshot.vector_count = vector_count

    def health_response(self) -> HealthResponse:
        with self._lock:
            return HealthResponse(
                model_loaded=self._snapshot.model_loaded,
                index_loaded=self._snapshot.index_loaded,
                vector_count=self._snapshot.vector_count,
            )


runtime_state = RuntimeState()
