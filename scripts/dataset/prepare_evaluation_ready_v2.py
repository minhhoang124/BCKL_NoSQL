"""Validate the phase-two lock and prepare mapping-bound evaluation artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from evaluation_v2_common import (
    canonical_json_sha256,
    consensus_complete,
    load_lock,
    raw_sha256,
    read_jsonl,
    unique_by,
    verify_artifact,
    verify_query_set,
    write_jsonl,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--queries", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    lock = load_lock(args.lock)
    corpus_spec = lock["corpus"]
    query_spec = lock["queryArtifacts"]["textQueries"]
    label_spec = lock["labelArtifacts"]["textConsensus"]
    corpus_hash = verify_artifact(args.corpus, corpus_spec, "corpus")
    query_hash = verify_artifact(args.queries, query_spec, "queries")
    label_hash = verify_artifact(args.labels, label_spec, "labels")
    mapping_hash = raw_sha256(args.mapping)
    expected_mapping_hash = corpus_spec["mappingSha256Expected"].upper()
    if mapping_hash != expected_mapping_hash:
        raise ValueError(
            f"mapping SHA-256 mismatch: expected {expected_mapping_hash}, got {mapping_hash}"
        )

    corpus_rows = read_jsonl(args.corpus)
    mapping_rows = read_jsonl(args.mapping)
    query_rows = read_jsonl(args.queries)
    label_rows = read_jsonl(args.labels)
    corpus = unique_by(corpus_rows, "externalId", "corpus")
    mapping = unique_by(mapping_rows, "externalId", "mapping")
    query_by_id = unique_by(query_rows, "queryId", "queries")
    verify_query_set(query_rows, lock, "queries")

    missing_mapping = sorted(set(corpus) - set(mapping))
    extra_mapping = sorted(set(mapping) - set(corpus))
    if missing_mapping or extra_mapping:
        raise ValueError(
            "mapping externalId set must exactly match corpus; "
            f"missing={missing_mapping}, extra={extra_mapping}"
        )

    product_ids: set[int] = set()
    for external_id, row in mapping.items():
        product_id = row.get("productId")
        if not isinstance(product_id, int) or isinstance(product_id, bool) or product_id < 1:
            raise ValueError(f"mapping has invalid productId for {external_id}: {product_id}")
        if product_id in product_ids:
            raise ValueError(f"mapping contains duplicate productId: {product_id}")
        product_ids.add(product_id)

    mapped_queries: list[dict[str, Any]] = []
    for query in query_rows:
        external_id = query.get("anchorExternalId")
        if external_id not in corpus:
            raise ValueError(f"query anchor is outside corpus: {query['queryId']} -> {external_id}")
        mapped = dict(query)
        mapped["productId"] = mapping[external_id]["productId"]
        mapped["status"] = "LOCKED_FULL_CORPUS_EVALUATION"
        mapped_queries.append(mapped)

    mapped_labels: list[dict[str, Any]] = []
    label_pairs: set[tuple[str, int]] = set()
    complete_pairs: set[tuple[str, int]] = set()
    for label in label_rows:
        query_id = label.get("queryId")
        if query_id not in query_by_id:
            raise ValueError(f"label references unknown queryId: {query_id}")
        external_id = label.get("candidateExternalId") or label.get("externalId")
        if external_id not in mapping:
            raise ValueError(f"label candidate is missing mapping: {query_id} -> {external_id}")
        product_id = mapping[external_id]["productId"]
        pair = (str(query_id), product_id)
        if pair in label_pairs:
            raise ValueError(f"duplicate label: {query_id}/{product_id}")
        label_pairs.add(pair)
        mapped = dict(label)
        mapped["productId"] = product_id
        mapped_labels.append(mapped)
        if mapped.get("exhaustive") is True:
            if not consensus_complete(mapped):
                raise ValueError(f"exhaustive label lacks completed consensus: {query_id}/{product_id}")
            complete_pairs.add(pair)

    expected_pairs = len(query_rows) * len(corpus_rows)
    metric_ready = len(complete_pairs) == expected_pairs
    args.output_dir.mkdir(parents=True, exist_ok=True)
    queries_output = args.output_dir / "queries-mapped.jsonl"
    labels_output = args.output_dir / "labels-mapped.jsonl"
    write_jsonl(queries_output, mapped_queries)
    write_jsonl(labels_output, mapped_labels)

    manifest = {
        "schemaVersion": 1,
        "evaluationScope": "FULL_LOCKED_CORPUS",
        "lockSha256": canonical_json_sha256(args.lock),
        "corpusSha256": corpus_hash,
        "mappingSha256": mapping_hash,
        "queriesSha256": query_hash,
        "labelsSha256": label_hash,
        "queryIds": sorted(query_by_id),
        "corpusCount": len(corpus_rows),
        "mappingCount": len(mapping_rows),
    }
    (args.output_dir / "evaluation-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    readiness = {
        **manifest,
        "status": "METRIC_READY" if metric_ready else "SMOKE_ONLY",
        "labelCount": len(label_rows),
        "requiredFullCorpusJudgmentCount": expected_pairs,
        "completedConsensusJudgmentCount": len(complete_pairs),
        "precisionRecallAllowed": metric_ready,
    }
    (args.output_dir / "readiness.json").write_text(
        json.dumps(readiness, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(readiness, ensure_ascii=False))


if __name__ == "__main__":
    main()
