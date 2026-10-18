"""Build a full-corpus review matrix and attach ranks from locked retrieval runs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from evaluation_v2_common import (
    canonical_jsonl_sha256,
    load_lock,
    raw_sha256,
    read_jsonl,
    unique_by,
    validate_ranked_items,
    locked_systems,
    locked_top_k,
    verify_evaluation_manifest,
    verify_query_set,
    verify_run_manifest,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--run-manifest", type=Path, required=True)
    parser.add_argument("--evaluation-manifest", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--queries", type=Path, required=True)
    parser.add_argument("--seed-judgments", type=Path, required=True)
    parser.add_argument("--results", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    lock = load_lock(args.lock)
    mapping_rows = read_jsonl(args.mapping)
    mapping = unique_by(mapping_rows, "externalId", "mapping")
    reverse: dict[int, str] = {}
    for external_id, row in mapping.items():
        product_id = row.get("productId")
        if not isinstance(product_id, int) or isinstance(product_id, bool) or product_id < 1:
            raise ValueError("mapping rows require externalId string and positive integer productId")
        if product_id in reverse:
            raise ValueError(f"duplicate productId in mapping: {product_id}")
        reverse[product_id] = str(external_id)
    mapping_hash = raw_sha256(args.mapping)
    if mapping_hash != lock["corpus"]["mappingSha256Expected"].upper():
        raise ValueError("mapping SHA-256 does not match evaluation lock")

    query_rows = read_jsonl(args.queries)
    queries = unique_by(query_rows, "queryId", "queries")
    verify_query_set(query_rows, lock, "queries")
    queries_hash = canonical_jsonl_sha256(args.queries)
    if queries_hash != lock["queryArtifacts"]["textQueries"]["sha256"].upper():
        raise ValueError("queries SHA-256 does not match evaluation lock")
    verify_evaluation_manifest(args.evaluation_manifest, lock, mapping_hash, queries_hash)
    verify_run_manifest(args.run_manifest, lock, mapping_hash, queries_hash, args.results)

    seed_by_pair: dict[tuple[str, int], dict[str, Any]] = {}
    for row in read_jsonl(args.seed_judgments):
        query_id = row.get("queryId")
        external_id = row.get("candidateExternalId") or row.get("externalId")
        if query_id not in queries or external_id not in mapping:
            raise ValueError(f"seed judgment is outside locked query/corpus: {query_id}/{external_id}")
        pair = (str(query_id), mapping[external_id]["productId"])
        if pair in seed_by_pair:
            raise ValueError(f"duplicate seed judgment: {pair[0]}/{pair[1]}")
        seed_by_pair[pair] = row

    pool: dict[tuple[str, int], dict[str, Any]] = {}
    for query_id in sorted(queries):
        for product_id, external_id in sorted(reverse.items()):
            seed = seed_by_pair.get((query_id, product_id), {})
            pool[(query_id, product_id)] = {
                "queryId": query_id,
                "candidateExternalId": external_id,
                "productId": product_id,
                "ranks": {},
                "relevance": seed.get("relevance"),
                "labeledBy": seed.get("labeledBy"),
                "reviewedBy": seed.get("reviewedBy"),
                "consensusBy": seed.get("consensusBy"),
                "adjudicationStatus": seed.get("adjudicationStatus", "PENDING"),
                "reviewEvidence": seed.get("reviewEvidence"),
                # A newly generated full-corpus matrix must be reviewed as a
                # whole; an earlier one-row anchor label cannot make it exhaustive.
                "exhaustive": False,
            }

    systems_seen: set[str] = set()
    result_pairs: set[tuple[str, str]] = set()
    for result_path in args.results:
        for row in read_jsonl(result_path):
            query_id, system = row.get("queryId"), row.get("system")
            if query_id not in queries:
                raise ValueError(f"result references unknown queryId: {query_id}")
            if not isinstance(system, str) or not system:
                raise ValueError(f"result {query_id} has no system")
            result_pair = (str(query_id), system)
            if result_pair in result_pairs:
                raise ValueError(f"duplicate result row: {query_id}/{system}")
            result_pairs.add(result_pair)
            systems_seen.add(system)
            items = validate_ranked_items(row.get("items"), f"result {query_id}/{system}")
            if len(items) > locked_top_k(lock):
                raise ValueError(f"result {query_id}/{system} exceeds locked topK")
            for item in items:
                product_id = item["productId"]
                if product_id not in reverse:
                    raise ValueError(f"result contains unmapped productId: {product_id}")
                pool[(str(query_id), product_id)]["ranks"][system] = item["rank"]

    expected_systems = locked_systems(lock)
    if systems_seen != expected_systems:
        raise ValueError(
            "result systems do not match expected systems; "
            f"expected={sorted(expected_systems)}, actual={sorted(systems_seen)}"
        )
    missing_pairs = sorted(
        f"{query_id}/{system}"
        for query_id in queries
        for system in expected_systems
        if (query_id, system) not in result_pairs
    )
    if missing_pairs:
        raise ValueError(f"missing query/system result rows: {', '.join(missing_pairs)}")

    output_rows = sorted(pool.values(), key=lambda row: (row["queryId"], row["productId"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in output_rows),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "evaluationScope": "FULL_LOCKED_CORPUS",
                "queries": len(queries),
                "corpusProducts": len(reverse),
                "systems": sorted(systems_seen),
                "reviewRows": len(output_rows),
            }
        )
    )


if __name__ == "__main__":
    main()
