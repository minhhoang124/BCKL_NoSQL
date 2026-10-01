from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any, Literal

from starlette.concurrency import run_in_threadpool

from app.schemas.elasticsearch import ProductDocument
from app.schemas.index import (
    IndexesStatus,
    IndexStatusDetail,
    ProductSyncResponse,
    SingleProductIndexRequest,
)
from app.services.image_download_service import ImageUrlNotAllowedError

if TYPE_CHECKING:
    from app.services.clip_service import ClipService
    from app.services.elasticsearch_service import ElasticsearchService
    from app.services.faiss_service import FaissService
    from app.services.image_download_service import ImageDownloadService

logger = logging.getLogger(__name__)


class VersionConflictError(ValueError):
    """Raised when request version matches latestVersion but operation or payload differs."""


def compute_payload_fingerprint(payload: SingleProductIndexRequest) -> str:
    """Computes a deterministic SHA-256 fingerprint of the normalized product payload.

    Prices are formatted with fixed Decimal strings to guarantee float-free stability.
    Attributes dictionary keys and lists are alphabetically sorted.
    """
    norm_min_price = f"{payload.min_price:.2f}" if payload.min_price is not None else None
    norm_max_price = f"{payload.max_price:.2f}" if payload.max_price is not None else None
    norm_attributes = {
        k: sorted(str(v) for v in vals) for k, vals in sorted(payload.attributes.items())
    }

    canonical: dict[str, Any] = {
        "productId": payload.product_id,
        "name": payload.name,
        "description": payload.description,
        "categoryId": payload.category_id,
        "categoryName": payload.category_name,
        "categoryPathIds": payload.category_path_ids,
        "brandId": payload.brand_id,
        "brandName": payload.brand_name,
        "imageUrls": [str(url) for url in payload.image_urls],
        "minPrice": norm_min_price,
        "maxPrice": norm_max_price,
        "inStock": payload.in_stock,
        "attributes": norm_attributes,
        "externalId": payload.external_id,
    }
    serialized = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def compute_delete_fingerprint(product_id: int, version: int) -> str:
    """Computes a deterministic SHA-256 fingerprint for a DELETE operation."""
    canonical = f"DELETE:{product_id}:{version}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


IndexResponseStatus = Literal["SUCCEEDED", "ALREADY_APPLIED", "FAILED"]


@dataclass
class IndexSyncRecord:
    status: Literal["PENDING", "SUCCEEDED", "FAILED"]
    version: int | None = None


@dataclass
class ProductSyncRecord:
    product_id: int
    latest_version: int
    operation: Literal["UPSERT", "DELETE"]
    payload_fingerprint: str
    elasticsearch: IndexSyncRecord
    faiss: IndexSyncRecord

    def to_dict(self) -> dict[str, Any]:
        return {
            "productId": self.product_id,
            "latestVersion": self.latest_version,
            "operation": self.operation,
            "payloadFingerprint": self.payload_fingerprint,
            "elasticsearch": {
                "status": self.elasticsearch.status,
                "version": self.elasticsearch.version,
            },
            "faiss": {
                "status": self.faiss.status,
                "version": self.faiss.version,
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProductSyncRecord:
        es_data = data.get("elasticsearch", {})
        faiss_data = data.get("faiss", {})
        return cls(
            product_id=int(data["productId"]),
            latest_version=int(data["latestVersion"]),
            operation=data["operation"],
            payload_fingerprint=data["payloadFingerprint"],
            elasticsearch=IndexSyncRecord(
                status=es_data.get("status", "PENDING"),
                version=es_data.get("version"),
            ),
            faiss=IndexSyncRecord(
                status=faiss_data.get("status", "PENDING"),
                version=faiss_data.get("version"),
            ),
        )


class ProductSyncService:
    """Coordinates dual-index synchronization for a single product across Elasticsearch and FAISS.

    Enforces:
    - 1-worker process scope (logs explicit warning if configured > 1 workers).
    - Sequential per-productId mutation locks.
    - Durable state persistence with atomic file writes before index execution.
    - Deterministic fingerprinting and version collision detection (STALE, NOOP, VERSION_CONFLICT).
    - Crash resilience: never assumes FAISS succeeded without confirmation in sync state.
    """

    def __init__(self, state_path: Path, server_workers: int = 1) -> None:
        self._state_path = state_path
        self._server_workers = server_workers
        self._file_lock = Lock()
        self._records: dict[int, ProductSyncRecord] = {}
        self._product_locks: dict[int, asyncio.Lock] = {}
        self._product_locks_guard = asyncio.Lock()

        if self._server_workers != 1:
            raise ValueError(
                f"ProductSyncService requires server_workers=1 because in-memory locks and "
                f"atomic state storage are process-local. "
                f"Configured value: {self._server_workers}. "
                f"Running multiple workers without a transactional/distributed store would cause "
                f"state corruption and race conditions."
            )

        self.load_state()

    def load_state(self) -> None:
        with self._file_lock:
            if not self._state_path.is_file():
                self._records = {}
                return

            try:
                content = self._state_path.read_text(encoding="utf-8")
                payload = json.loads(content)
                products = payload.get("products", {})
                self._records = {
                    int(pid): ProductSyncRecord.from_dict(rec) for pid, rec in products.items()
                }
            except Exception as error:
                logger.error(
                    "Failed to read product sync state from %s: %s",
                    self._state_path,
                    error,
                )
                raise RuntimeError(
                    f"Invalid product sync state file: {self._state_path}"
                ) from error

    def _write_state(self) -> None:
        with self._file_lock:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = self._state_path.with_name(f".{self._state_path.name}.tmp")
            payload = {
                "schemaVersion": 1,
                "products": {
                    str(pid): rec.to_dict() for pid, rec in sorted(self._records.items())
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

    async def _get_product_lock(self, product_id: int) -> asyncio.Lock:
        async with self._product_locks_guard:
            if product_id not in self._product_locks:
                self._product_locks[product_id] = asyncio.Lock()
            return self._product_locks[product_id]

    def current_record(self, product_id: int) -> ProductSyncRecord | None:
        with self._file_lock:
            return self._records.get(product_id)

    async def sync_product(
        self,
        payload: SingleProductIndexRequest,
        elasticsearch_service: ElasticsearchService,
        faiss_service: FaissService,
        clip_service: ClipService,
        image_download_service: ImageDownloadService,
    ) -> ProductSyncResponse:
        product_lock = await self._get_product_lock(payload.product_id)
        async with product_lock:
            fingerprint = compute_payload_fingerprint(payload)
            current_rec = self.current_record(payload.product_id)

            # Check Stale
            if current_rec is not None and payload.version < current_rec.latest_version:
                return ProductSyncResponse(
                    productId=payload.product_id,
                    version=payload.version,
                    operation="UPSERT",
                    outcome="STALE",
                    indexes=IndexesStatus(
                        elasticsearch=IndexStatusDetail(
                            status="ALREADY_APPLIED",
                            version=current_rec.elasticsearch.version,
                        ),
                        faiss=IndexStatusDetail(
                            status="ALREADY_APPLIED",
                            version=current_rec.faiss.version,
                        ),
                    ),
                )

            # Check Same Version
            if current_rec is not None and payload.version == current_rec.latest_version:
                if (
                    current_rec.operation != "UPSERT"
                    or current_rec.payload_fingerprint != fingerprint
                ):
                    raise VersionConflictError(
                        f"Version conflict for product {payload.product_id} "
                        f"at version {payload.version}"
                    )

                if (
                    current_rec.elasticsearch.status == "SUCCEEDED"
                    and current_rec.faiss.status == "SUCCEEDED"
                ):
                    return ProductSyncResponse(
                        productId=payload.product_id,
                        version=payload.version,
                        operation="UPSERT",
                        outcome="NOOP",
                        indexes=IndexesStatus(
                            elasticsearch=IndexStatusDetail(
                                status="ALREADY_APPLIED",
                                version=current_rec.elasticsearch.version,
                            ),
                            faiss=IndexStatusDetail(
                                status="ALREADY_APPLIED",
                                version=current_rec.faiss.version,
                            ),
                        ),
                    )

                active_rec = current_rec
            else:
                # payload.version > current_rec.latest_version (or new product)
                active_rec = ProductSyncRecord(
                    product_id=payload.product_id,
                    latest_version=payload.version,
                    operation="UPSERT",
                    payload_fingerprint=fingerprint,
                    elasticsearch=IndexSyncRecord(
                        status="PENDING",
                        version=current_rec.elasticsearch.version if current_rec else None,
                    ),
                    faiss=IndexSyncRecord(
                        status="PENDING",
                        version=current_rec.faiss.version if current_rec else None,
                    ),
                )

            faiss_needed = not (
                active_rec.faiss.status == "SUCCEEDED"
                and active_rec.faiss.version == payload.version
            )

            # Only validate image URL host when FAISS branch actually needs to run
            if faiss_needed and hasattr(image_download_service, "_validate_url"):
                image_download_service._validate_url(str(payload.image_urls[0]))

            if active_rec is not current_rec:
                self._records[payload.product_id] = active_rec
                self._write_state()

            # Execute Elasticsearch
            if (
                active_rec.elasticsearch.status == "SUCCEEDED"
                and active_rec.elasticsearch.version == payload.version
            ):
                es_resp_status: IndexResponseStatus = "ALREADY_APPLIED"
                es_version = active_rec.elasticsearch.version
            else:
                doc = ProductDocument(
                    productId=payload.product_id,
                    name=payload.name,
                    description=payload.description,
                    categoryId=payload.category_id,
                    categoryName=payload.category_name,
                    categoryPathIds=payload.category_path_ids,
                    brandId=payload.brand_id,
                    brandName=payload.brand_name,
                    minPrice=float(payload.min_price) if payload.min_price is not None else None,
                    maxPrice=float(payload.max_price) if payload.max_price is not None else None,
                    inStock=payload.in_stock,
                    attributes=payload.attributes,
                    version=payload.version,
                )
                try:
                    await elasticsearch_service.index_product(doc)
                    active_rec.elasticsearch.status = "SUCCEEDED"
                    active_rec.elasticsearch.version = payload.version
                    es_resp_status = "SUCCEEDED"
                    es_version = payload.version
                except Exception as error:
                    logger.warning(
                        "Elasticsearch indexing failed for %d: %s",
                        payload.product_id,
                        error,
                    )
                    active_rec.elasticsearch.status = "FAILED"
                    es_resp_status = "FAILED"
                    es_version = active_rec.elasticsearch.version

            # Execute FAISS
            if not faiss_needed:
                faiss_resp_status: IndexResponseStatus = "ALREADY_APPLIED"
                faiss_version = active_rec.faiss.version
            else:
                try:
                    image = await image_download_service.fetch(str(payload.image_urls[0]))
                    embedding = await run_in_threadpool(clip_service.encode_image, image)
                    # force=True removes prior vector ID and idempotently adds new vector
                    mutation = await run_in_threadpool(
                        faiss_service.upsert,
                        payload.product_id,
                        payload.version,
                        embedding,
                        True,
                    )
                    if not mutation.applied:
                        raise RuntimeError(
                            f"FAISS rejected UPSERT for product {payload.product_id} "
                            f"at version {payload.version}"
                        )
                    active_rec.faiss.status = "SUCCEEDED"
                    active_rec.faiss.version = payload.version
                    faiss_resp_status = "SUCCEEDED"
                    faiss_version = payload.version
                except ImageUrlNotAllowedError:
                    raise
                except Exception as error:
                    logger.warning(
                        "FAISS indexing failed for %d: %s",
                        payload.product_id,
                        error,
                    )
                    active_rec.faiss.status = "FAILED"
                    faiss_resp_status = "FAILED"
                    faiss_version = active_rec.faiss.version

            # Write updated state to disk
            self._records[payload.product_id] = active_rec
            self._write_state()

            if (
                active_rec.elasticsearch.status == "SUCCEEDED"
                and active_rec.faiss.status == "SUCCEEDED"
            ):
                outcome: Literal["APPLIED", "NOOP", "STALE", "PARTIAL_FAILURE"] = "APPLIED"
            else:
                outcome = "PARTIAL_FAILURE"

            return ProductSyncResponse(
                productId=payload.product_id,
                version=payload.version,
                operation="UPSERT",
                outcome=outcome,
                indexes=IndexesStatus(
                    elasticsearch=IndexStatusDetail(
                        status=es_resp_status,
                        version=es_version,
                    ),
                    faiss=IndexStatusDetail(
                        status=faiss_resp_status,
                        version=faiss_version,
                    ),
                ),
            )

    async def delete_product(
        self,
        product_id: int,
        version: int,
        elasticsearch_service: ElasticsearchService,
        faiss_service: FaissService,
    ) -> ProductSyncResponse:
        product_lock = await self._get_product_lock(product_id)
        async with product_lock:
            fingerprint = compute_delete_fingerprint(product_id, version)
            current_rec = self.current_record(product_id)

            # Check Stale
            if current_rec is not None and version < current_rec.latest_version:
                return ProductSyncResponse(
                    productId=product_id,
                    version=version,
                    operation="DELETE",
                    outcome="STALE",
                    indexes=IndexesStatus(
                        elasticsearch=IndexStatusDetail(
                            status="ALREADY_APPLIED",
                            version=current_rec.elasticsearch.version,
                        ),
                        faiss=IndexStatusDetail(
                            status="ALREADY_APPLIED",
                            version=current_rec.faiss.version,
                        ),
                    ),
                )

            # Check Same Version
            if current_rec is not None and version == current_rec.latest_version:
                if (
                    current_rec.operation != "DELETE"
                    or current_rec.payload_fingerprint != fingerprint
                ):
                    raise VersionConflictError(
                        f"Version conflict for product {product_id} "
                        f"at version {version}"
                    )

                if (
                    current_rec.elasticsearch.status == "SUCCEEDED"
                    and current_rec.faiss.status == "SUCCEEDED"
                ):
                    return ProductSyncResponse(
                        productId=product_id,
                        version=version,
                        operation="DELETE",
                        outcome="NOOP",
                        indexes=IndexesStatus(
                            elasticsearch=IndexStatusDetail(
                                status="ALREADY_APPLIED",
                                version=current_rec.elasticsearch.version,
                            ),
                            faiss=IndexStatusDetail(
                                status="ALREADY_APPLIED",
                                version=current_rec.faiss.version,
                            ),
                        ),
                    )

                active_rec = current_rec
            else:
                # version > current_rec.latest_version (or first time)
                active_rec = ProductSyncRecord(
                    product_id=product_id,
                    latest_version=version,
                    operation="DELETE",
                    payload_fingerprint=fingerprint,
                    elasticsearch=IndexSyncRecord(
                        status="PENDING",
                        version=current_rec.elasticsearch.version if current_rec else None,
                    ),
                    faiss=IndexSyncRecord(
                        status="PENDING",
                        version=current_rec.faiss.version if current_rec else None,
                    ),
                )
                self._records[product_id] = active_rec
                self._write_state()

            # Execute Elasticsearch Delete
            if (
                active_rec.elasticsearch.status == "SUCCEEDED"
                and active_rec.elasticsearch.version == version
            ):
                es_resp_status: IndexResponseStatus = "ALREADY_APPLIED"
                es_version = active_rec.elasticsearch.version
            else:
                try:
                    await elasticsearch_service.delete_product(product_id)
                    active_rec.elasticsearch.status = "SUCCEEDED"
                    active_rec.elasticsearch.version = version
                    es_resp_status = "SUCCEEDED"
                    es_version = version
                except Exception as error:
                    logger.warning(
                        "Elasticsearch delete failed for %d: %s",
                        product_id,
                        error,
                    )
                    active_rec.elasticsearch.status = "FAILED"
                    es_resp_status = "FAILED"
                    es_version = active_rec.elasticsearch.version

            # Execute FAISS Delete
            if (
                active_rec.faiss.status == "SUCCEEDED"
                and active_rec.faiss.version == version
            ):
                faiss_resp_status: IndexResponseStatus = "ALREADY_APPLIED"
                faiss_version = active_rec.faiss.version
            else:
                try:
                    mutation = await run_in_threadpool(
                        faiss_service.delete, product_id, version, True
                    )
                    if not mutation.applied:
                        raise RuntimeError(
                            f"FAISS rejected DELETE for product {product_id} at version {version}"
                        )
                    active_rec.faiss.status = "SUCCEEDED"
                    active_rec.faiss.version = version
                    faiss_resp_status = "SUCCEEDED"
                    faiss_version = version
                except Exception as error:
                    logger.warning(
                        "FAISS delete failed for %d: %s",
                        product_id,
                        error,
                    )
                    active_rec.faiss.status = "FAILED"
                    faiss_resp_status = "FAILED"
                    faiss_version = active_rec.faiss.version

            # Write updated state to disk
            self._records[product_id] = active_rec
            self._write_state()

            if (
                active_rec.elasticsearch.status == "SUCCEEDED"
                and active_rec.faiss.status == "SUCCEEDED"
            ):
                outcome: Literal["APPLIED", "NOOP", "STALE", "PARTIAL_FAILURE"] = "APPLIED"
            else:
                outcome = "PARTIAL_FAILURE"

            return ProductSyncResponse(
                productId=product_id,
                version=version,
                operation="DELETE",
                outcome=outcome,
                indexes=IndexesStatus(
                    elasticsearch=IndexStatusDetail(
                        status=es_resp_status,
                        version=es_version,
                    ),
                    faiss=IndexStatusDetail(
                        status=faiss_resp_status,
                        version=faiss_version,
                    ),
                ),
            )
