"""Compute full-corpus macro Precision@K and Recall@K for a locked run."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from statistics import fmean
from typing import Any

from evaluation_v2_common import (
    canonical_jsonl_sha256,
    consensus_complete,
    load_lock,
    raw_sha256,
    read_jsonl,
    unique_by,
    validate_ranked_items,
    locked_metric_k_values,
    locked_relevance_threshold,
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
    parser.add_argument("--results", type=Path, nargs="+", required=True)
    parser.add_argument("--judgments", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--k", type=int, nargs="+")
    parser.add_argument("--relevance-threshold", type=int)
    args = parser.parse_args()

    lock = load_lock(args.lock)
    metric_k_values = locked_metric_k_values(lock)
    relevance_threshold = locked_relevance_threshold(lock)
    if args.k is not None and args.k != metric_k_values:
        raise ValueError(
            f"metric K values must match evaluation lock: expected {metric_k_values}, got {args.k}"
        )
    if args.relevance_threshold is not None and args.relevance_threshold != relevance_threshold:
        raise ValueError(
            "relevance threshold must match evaluation lock: "
            f"expected {relevance_threshold}, got {args.relevance_threshold}"
        )
    mapping_rows = read_jsonl(args.mapping)
    mapping_by_external = unique_by(mapping_rows, "externalId", "mapping")
    product_ids: set[int] = set()
    for row in mapping_by_external.values():
        product_id = row.get("productId")
        if not isinstance(product_id, int) or isinstance(product_id, bool) or product_id < 1:
            raise ValueError(f"mapping contains invalid productId: {product_id}")
        if product_id in product_ids:
            raise ValueError(f"mapping contains duplicate productId: {product_id}")
        product_ids.add(product_id)
    mapping_hash = raw_sha256(args.mapping)
    if mapping_hash != lock["corpus"]["mappingSha256Expected"].upper():
        raise ValueError("mapping SHA-256 does not match evaluation lock")

    query_rows = read_jsonl(args.queries)
    verify_query_set(query_rows, lock, "queries")
    query_ids = {str(row["queryId"]) for row in query_rows}
    queries_hash = canonical_jsonl_sha256(args.queries)
    if queries_hash != lock["queryArtifacts"]["textQueries"]["sha256"].upper():
        raise ValueError("queries SHA-256 does not match evaluation lock")
    verify_evaluation_manifest(args.evaluation_manifest, lock, mapping_hash, queries_hash)
    verify_run_manifest(args.run_manifest, lock, mapping_hash, queries_hash, args.results)

    judged: dict[str, dict[int, int]] = defaultdict(dict)
    for row in read_jsonl(args.judgments):
        query_id, product_id, relevance = row.get("queryId"), row.get("productId"), row.get("relevance")
        if query_id not in query_ids or product_id not in product_ids:
            raise ValueError(f"judgment is outside locked query/corpus: {query_id}/{product_id}")
        if product_id in judged[str(query_id)]:
            raise ValueError(f"duplicate judgment: {query_id}/{product_id}")
        if row.get("exhaustive") is not True:
            raise ValueError(f"judgment is not exhaustive: {query_id}/{product_id}")
        if not consensus_complete(row):
            raise ValueError(f"judgment lacks completed independent consensus: {query_id}/{product_id}")
        judged[str(query_id)][int(product_id)] = int(relevance)

    missing_judgments = [
        f"{query_id}/{product_id}"
        for query_id in sorted(query_ids)
        for product_id in sorted(product_ids)
        if product_id not in judged[query_id]
    ]
    if missing_judgments:
        preview = ", ".join(missing_judgments[:10])
        raise ValueError(
            "full-corpus judgments are incomplete; "
            f"missing {len(missing_judgments)} pairs (first: {preview})"
        )

    result_rows: list[dict[str, Any]] = []
    for result_path in args.results:
        result_rows.extend(read_jsonl(result_path))
    metrics: dict[str, dict[int, list[dict[str, float]]]] = defaultdict(lambda: defaultdict(list))
    result_pairs: set[tuple[str, str]] = set()
    queries_by_system: dict[str, set[str]] = defaultdict(set)
    for row in result_rows:
        query_id, system = row.get("queryId"), row.get("system")
        if query_id not in query_ids or not isinstance(system, str):
            raise ValueError(f"invalid result row: {query_id}/{system}")
        pair = (str(query_id), system)
        if pair in result_pairs:
            raise ValueError(f"duplicate result row: {query_id}/{system}")
        result_pairs.add(pair)
        queries_by_system[system].add(str(query_id))
        ordered = validate_ranked_items(row.get("items"), f"result {query_id}/{system}")
        if len(ordered) > locked_top_k(lock):
            raise ValueError(f"result {query_id}/{system} exceeds locked topK")
        for item in ordered:
            if item["productId"] not in product_ids:
                raise ValueError(f"result contains product outside locked corpus: {item['productId']}")
        relevant_total = sum(
            1 for relevance in judged[str(query_id)].values() if relevance >= relevance_threshold
        )
        if relevant_total == 0:
            raise ValueError(f"query has no relevant products: {query_id}")
        for k in metric_k_values:
            relevant_retrieved = sum(
                1
                for item in ordered[:k]
                if judged[str(query_id)][item["productId"]] >= relevance_threshold
            )
            # Precision@K keeps K as its denominator even when a system emits
            # fewer than K results; missing result slots are non-relevant.
            metrics[system][k].append(
                {"precision": relevant_retrieved / k, "recall": relevant_retrieved / relevant_total}
            )

    expected_systems = locked_systems(lock)
    if set(queries_by_system) != expected_systems:
        raise ValueError(
            "result systems do not match expected systems; "
            f"expected={sorted(expected_systems)}, actual={sorted(queries_by_system)}"
        )
    for system in expected_systems:
        if queries_by_system[system] != query_ids:
            raise ValueError(
                f"system {system} query set mismatch; "
                f"missing={sorted(query_ids - queries_by_system[system])}, "
                f"extra={sorted(queries_by_system[system] - query_ids)}"
            )

    output: dict[str, Any] = {
        "evaluationScope": "FULL_LOCKED_CORPUS",
        "precisionDenominatorPolicy": "K_WITH_MISSING_SLOTS_NON_RELEVANT",
        "metricKValues": metric_k_values,
        "relevanceThreshold": relevance_threshold,
        "queryCount": len(query_ids),
        "corpusProductCount": len(product_ids),
        "systems": {},
    }
    for system in sorted(metrics):
        output["systems"][system] = {}
        for k in sorted(metrics[system]):
            values = metrics[system][k]
            output["systems"][system][f"@{k}"] = {
                "queryCount": len(values),
                "precisionMacro": fmean(value["precision"] for value in values),
                "recallMacro": fmean(value["recall"] for value in values),
            }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
