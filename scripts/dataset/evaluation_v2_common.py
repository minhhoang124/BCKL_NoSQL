"""Shared validation for the locked phase-two retrieval evaluation."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number} must contain a JSON object")
        rows.append(value)
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )


def raw_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def canonical_jsonl_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    for row in read_jsonl(path):
        digest.update(
            (json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(
                "utf-8"
            )
        )
    return digest.hexdigest().upper()


def canonical_json_sha256(value_or_path: dict[str, Any] | Path) -> str:
    value = (
        json.loads(value_or_path.read_text(encoding="utf-8-sig"))
        if isinstance(value_or_path, Path)
        else value_or_path
    )
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest().upper()


def load_lock(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 2:
        raise ValueError("evaluation lock must be a schemaVersion=2 JSON object")
    if value.get("evaluationScope") != "FULL_LOCKED_CORPUS":
        raise ValueError("evaluation lock must use FULL_LOCKED_CORPUS scope")
    return value


def artifact_sha256(path: Path, algorithm: str) -> str:
    if algorithm == "raw-sha256":
        return raw_sha256(path)
    if algorithm == "canonical-jsonl-v1":
        return canonical_jsonl_sha256(path)
    raise ValueError(f"unsupported hash algorithm: {algorithm}")


def verify_artifact(path: Path, spec: dict[str, Any], name: str) -> str:
    algorithm = spec.get("hashAlgorithm")
    expected = spec.get("sha256")
    if not isinstance(algorithm, str) or not isinstance(expected, str):
        raise ValueError(f"lock is missing hash metadata for {name}")
    actual = artifact_sha256(path, algorithm)
    if actual != expected.upper():
        raise ValueError(f"{name} SHA-256 mismatch: expected {expected.upper()}, got {actual}")
    rows = read_jsonl(path)
    if "count" in spec and len(rows) != spec["count"]:
        raise ValueError(f"{name} count mismatch: expected {spec['count']}, got {len(rows)}")
    return actual


def unique_by(rows: list[dict[str, Any]], key: str, source: str) -> dict[Any, dict[str, Any]]:
    result: dict[Any, dict[str, Any]] = {}
    for row in rows:
        value = row.get(key)
        if value in (None, ""):
            raise ValueError(f"{source} contains a row without {key}")
        if value in result:
            raise ValueError(f"{source} contains duplicate {key}: {value}")
        result[value] = row
    return result


def locked_query_ids(lock: dict[str, Any]) -> set[str]:
    values = lock.get("queryArtifacts", {}).get("textQueries", {}).get("queryIds")
    if not isinstance(values, list) or not values or any(not isinstance(value, str) for value in values):
        raise ValueError("evaluation lock must contain textQueries.queryIds")
    if len(values) != len(set(values)):
        raise ValueError("evaluation lock contains duplicate queryIds")
    return set(values)


def locked_systems(lock: dict[str, Any]) -> set[str]:
    values = lock.get("search", {}).get("systems")
    if not isinstance(values, list) or not values or any(
        not isinstance(value, str) or not value.strip() for value in values
    ):
        raise ValueError("evaluation lock must contain search.systems")
    normalized = {value.strip() for value in values}
    if len(normalized) != len(values):
        raise ValueError("evaluation lock contains duplicate search systems")
    return normalized


def locked_top_k(lock: dict[str, Any]) -> int:
    value = lock.get("search", {}).get("topK")
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError("evaluation lock must contain a positive integer search.topK")
    return value


def locked_metric_k_values(lock: dict[str, Any]) -> list[int]:
    values = lock.get("search", {}).get("metricKValues")
    if not isinstance(values, list) or not values or any(
        not isinstance(value, int) or isinstance(value, bool) or value < 1 for value in values
    ):
        raise ValueError("evaluation lock must contain positive integer search.metricKValues")
    if values != sorted(set(values)):
        raise ValueError("evaluation lock search.metricKValues must be unique and ascending")
    if values[-1] > locked_top_k(lock):
        raise ValueError("evaluation lock metricKValues cannot exceed search.topK")
    return values


def locked_relevance_threshold(lock: dict[str, Any]) -> int:
    value = lock.get("search", {}).get("relevanceThreshold")
    if not isinstance(value, int) or isinstance(value, bool) or value not in (0, 1, 2):
        raise ValueError("evaluation lock search.relevanceThreshold must be 0, 1 or 2")
    return value


def verify_query_set(rows: list[dict[str, Any]], lock: dict[str, Any], source: str) -> set[str]:
    actual = set(unique_by(rows, "queryId", source))
    expected = locked_query_ids(lock)
    if actual != expected:
        raise ValueError(
            f"{source} query set mismatch; missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
        )
    return actual


def validate_ranked_items(items: Any, context: str) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        raise ValueError(f"{context} has no items list")
    seen_products: set[int] = set()
    ranks: list[int] = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"{context} contains a non-object item")
        product_id, rank = item.get("productId"), item.get("rank")
        if not isinstance(product_id, int) or isinstance(product_id, bool) or product_id < 1:
            raise ValueError(f"{context} contains invalid productId: {product_id}")
        if not isinstance(rank, int) or isinstance(rank, bool) or rank < 1:
            raise ValueError(f"{context} contains invalid rank: {rank}")
        if product_id in seen_products:
            raise ValueError(f"{context} contains duplicate productId: {product_id}")
        seen_products.add(product_id)
        ranks.append(rank)
    if sorted(ranks) != list(range(1, len(ranks) + 1)):
        raise ValueError(f"{context} ranks must be unique and contiguous from 1 to N")
    return sorted(items, key=lambda item: item["rank"])


def consensus_complete(row: dict[str, Any]) -> bool:
    labeled_by = row.get("labeledBy")
    reviewed_by = row.get("reviewedBy")
    evidence = row.get("reviewEvidence")
    status = row.get("adjudicationStatus")
    consensus_by = row.get("consensusBy")
    def identity(value: Any) -> str | None:
        if not isinstance(value, str) or not value.strip():
            return None
        return value.strip().casefold()

    labeler = identity(labeled_by)
    reviewer = identity(reviewed_by)
    consensus_identities = (
        {normalized for value in consensus_by if (normalized := identity(value)) is not None}
        if isinstance(consensus_by, list)
        else set()
    )
    return (
        isinstance(row.get("relevance"), int)
        and not isinstance(row.get("relevance"), bool)
        and row.get("relevance") in (0, 1, 2)
        and labeler is not None
        and reviewer is not None
        and labeler != reviewer
        and status in {"AGREED", "RESOLVED"}
        and isinstance(evidence, str)
        and bool(evidence.strip())
        and len(consensus_identities) >= 2
        and labeler in consensus_identities
        and reviewer in consensus_identities
    )


def verify_evaluation_manifest(
    path: Path,
    lock: dict[str, Any],
    mapping_sha256: str,
    queries_sha256: str,
) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        raise ValueError("evaluation manifest must be a schemaVersion=1 JSON object")
    expected = {
        "evaluationScope": "FULL_LOCKED_CORPUS",
        "lockSha256": canonical_json_sha256(lock),
        "corpusSha256": lock["corpus"]["sha256"].upper(),
        "mappingSha256": mapping_sha256,
        "queriesSha256": queries_sha256,
        "queryIds": sorted(locked_query_ids(lock)),
        "corpusCount": lock["corpus"]["count"],
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValueError(
                f"evaluation manifest {key} mismatch: expected {value}, got {manifest.get(key)}"
            )
    return manifest


def verify_run_manifest(
    path: Path,
    lock: dict[str, Any],
    mapping_sha256: str,
    queries_sha256: str,
    result_paths: list[Path],
) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        raise ValueError("run manifest must be a schemaVersion=1 JSON object")
    for key in ("runId", "createdAt", "environment"):
        value = manifest.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"run manifest must contain non-empty {key}")
    search = lock["search"]
    for key in ("commit", "imageModelRevision", "textModelRevision", "indexSnapshotSha256"):
        value = search.get(key)
        if not isinstance(value, str) or not value or value.startswith("TO_BE_RECORDED"):
            raise ValueError(f"evaluation lock search.{key} must be fixed before a metric run")
    required_matches = {
        "searchCommit": search["commit"],
        "imageModel": search["imageModel"],
        "imageModelRevision": search["imageModelRevision"],
        "textModel": search["textModel"],
        "textModelRevision": search["textModelRevision"],
        "indexSnapshotSha256": search["indexSnapshotSha256"],
        "mappingSha256": mapping_sha256,
        "queriesSha256": queries_sha256,
        "rrfK": search["rrfK"],
        "candidateK": search["candidateK"],
        "topK": locked_top_k(lock),
        "systems": sorted(locked_systems(lock)),
    }
    for key, expected in required_matches.items():
        if manifest.get(key) != expected:
            raise ValueError(f"run manifest {key} mismatch: expected {expected}, got {manifest.get(key)}")
    result_hashes = manifest.get("resultArtifacts")
    if not isinstance(result_hashes, dict):
        raise ValueError("run manifest must contain resultArtifacts")
    for result_path in result_paths:
        expected = result_hashes.get(result_path.name)
        actual = canonical_jsonl_sha256(result_path)
        if expected != actual:
            raise ValueError(
                f"run manifest result hash mismatch for {result_path.name}: expected {expected}, got {actual}"
            )
    return manifest
