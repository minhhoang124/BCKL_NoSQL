from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    import faiss
    import numpy as np


@dataclass(frozen=True)
class FaissMutationResult:
    product_id: int
    version: int
    applied: bool
    status: Literal["updated", "deleted", "ignored"]
    vector_count: int


class FaissService:
    """Owns the FAISS index, product versions and atomic persistence."""

    def __init__(self, index_path: Path, state_path: Path) -> None:
        self._index_path = index_path
        self._state_path = state_path
        self._index: faiss.Index | None = None
        self._versions: dict[int, int] = {}
        self._deleted_product_ids: set[int] = set()
        self._lock = RLock()

    @property
    def is_loaded(self) -> bool:
        return self._index is not None

    @property
    def vector_count(self) -> int:
        with self._lock:
            return int(self._index.ntotal) if self._index is not None else 0

    @property
    def dimension(self) -> int:
        with self._lock:
            if self._index is None:
                raise RuntimeError("FAISS index is not loaded")
            return int(self._index.d)

    def load(self) -> None:
        import faiss

        if not self._index_path.is_file():
            raise FileNotFoundError(f"FAISS index not found: {self._index_path}")

        loaded_index = faiss.read_index(str(self._index_path))
        if not isinstance(loaded_index, faiss.IndexIDMap):
            raise RuntimeError("FAISS index must use IndexIDMap or IndexIDMap2")

        versions, deleted_product_ids = self._read_state()
        with self._lock:
            self._index = loaded_index
            self._versions = versions
            self._deleted_product_ids = deleted_product_ids

    def current_version(self, product_id: int) -> int | None:
        self._require_index()
        with self._lock:
            return self._versions.get(product_id)

    def search(
        self,
        embedding: np.ndarray,
        top_k: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        index = self._require_index()

        with self._lock:
            scores, product_ids = index.search(
                embedding.astype("float32"),
                top_k,
            )

        return scores[0], product_ids[0]

    def upsert(
        self,
        product_id: int,
        version: int,
        embedding: np.ndarray,
        force: bool = False,
    ) -> FaissMutationResult:
        return self.upsert_many([(product_id, version, embedding)], force=force)[0]

    def upsert_many(
        self,
        products: list[tuple[int, int, np.ndarray]],
        force: bool = False,
    ) -> list[FaissMutationResult]:
        import faiss
        import numpy as np

        if not products:
            return []

        product_ids = [product_id for product_id, _, _ in products]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Batch contains duplicate productId values")

        with self._lock:
            index = self._require_index()
            prepared: dict[int, np.ndarray] = {}
            applicable: list[tuple[int, int]] = []

            for product_id, version, embedding in products:
                self._validate_identity(product_id, version)
                current_version = self._versions.get(product_id)
                if current_version is not None:
                    if current_version > version:
                        continue
                    if current_version == version and not force:
                        continue
                prepared[product_id] = self._prepare_embedding(embedding, index.d)
                applicable.append((product_id, version))

            if applicable:
                candidate_index = faiss.clone_index(index)
                ids = np.asarray(
                    [product_id for product_id, _ in applicable],
                    dtype="int64",
                )
                candidate_index.remove_ids(ids)
                vectors = np.vstack(
                    [prepared[product_id] for product_id, _ in applicable]
                ).astype("float32")
                candidate_index.add_with_ids(vectors, ids)

                candidate_versions = self._versions.copy()
                candidate_deleted = self._deleted_product_ids.copy()
                for product_id, version in applicable:
                    candidate_versions[product_id] = version
                    candidate_deleted.discard(product_id)

                self._replace_index(candidate_index)
                self._write_state(candidate_versions, candidate_deleted)
                self._versions = candidate_versions
                self._deleted_product_ids = candidate_deleted

            applied_ids = {product_id for product_id, _ in applicable}
            vector_count = int(self._require_index().ntotal)
            return [
                FaissMutationResult(
                    product_id=product_id,
                    version=version,
                    applied=product_id in applied_ids,
                    status="updated" if product_id in applied_ids else "ignored",
                    vector_count=vector_count,
                )
                for product_id, version, _ in products
            ]

    def delete(
        self,
        product_id: int,
        version: int,
        force: bool = False,
    ) -> FaissMutationResult:
        import faiss
        import numpy as np

        self._validate_identity(product_id, version)

        with self._lock:
            index = self._require_index()
            current_version = self._versions.get(product_id)
            if current_version is not None:
                if current_version > version:
                    return FaissMutationResult(
                        product_id=product_id,
                        version=version,
                        applied=False,
                        status="ignored",
                        vector_count=int(index.ntotal),
                    )
                if current_version == version and not force:
                    return FaissMutationResult(
                        product_id=product_id,
                        version=version,
                        applied=False,
                        status="ignored",
                        vector_count=int(index.ntotal),
                    )

            candidate_index = faiss.clone_index(index)
            candidate_index.remove_ids(np.asarray([product_id], dtype="int64"))
            candidate_versions = self._versions.copy()
            candidate_versions[product_id] = version
            candidate_deleted = self._deleted_product_ids.copy()
            candidate_deleted.add(product_id)

            self._replace_index(candidate_index)
            self._write_state(candidate_versions, candidate_deleted)
            self._versions = candidate_versions
            self._deleted_product_ids = candidate_deleted

            return FaissMutationResult(
                product_id=product_id,
                version=version,
                applied=True,
                status="deleted",
                vector_count=int(candidate_index.ntotal),
            )

    def _require_index(self) -> faiss.Index:
        if self._index is None:
            raise RuntimeError("FAISS index is not loaded")
        return self._index

    @staticmethod
    def _validate_identity(product_id: int, version: int) -> None:
        if product_id < 1:
            raise ValueError("productId must be positive")
        if version < 1:
            raise ValueError("version must be positive")

    @staticmethod
    def _prepare_embedding(embedding: np.ndarray, dimension: int) -> np.ndarray:
        import numpy as np

        vector = np.asarray(embedding, dtype="float32")
        if vector.ndim == 1:
            vector = vector.reshape(1, -1)
        if vector.shape != (1, dimension):
            raise ValueError(
                f"Embedding shape must be (1, {dimension}), received {vector.shape}"
            )
        if not np.isfinite(vector).all():
            raise ValueError("Embedding contains a non-finite value")

        norm = float(np.linalg.norm(vector))
        if norm == 0:
            raise ValueError("Embedding must not be a zero vector")
        return vector / norm

    def _replace_index(self, candidate_index: faiss.Index) -> None:
        import faiss

        self._index_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self._index_path.with_name(f".{self._index_path.name}.tmp")
        try:
            faiss.write_index(candidate_index, str(temporary_path))
            os.replace(temporary_path, self._index_path)
            self._index = candidate_index
        finally:
            temporary_path.unlink(missing_ok=True)

    def _read_state(self) -> tuple[dict[int, int], set[int]]:
        if not self._state_path.is_file():
            return {}, set()

        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
            products = payload.get("products", {})
            versions = {
                int(product_id): int(record["version"])
                for product_id, record in products.items()
            }
            deleted = {
                int(product_id)
                for product_id, record in products.items()
                if bool(record.get("deleted"))
            }
        except (OSError, TypeError, ValueError, KeyError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Invalid FAISS state file: {self._state_path}") from error

        return versions, deleted

    def _write_state(self, versions: dict[int, int], deleted: set[int]) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self._state_path.with_name(f".{self._state_path.name}.tmp")
        payload = {
            "schemaVersion": 1,
            "products": {
                str(product_id): {
                    "version": version,
                    "deleted": product_id in deleted,
                }
                for product_id, version in sorted(versions.items())
            },
        }
        try:
            temporary_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(temporary_path, self._state_path)
        finally:
            temporary_path.unlink(missing_ok=True)
