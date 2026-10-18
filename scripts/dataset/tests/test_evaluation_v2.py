from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts/dataset"))
from evaluation_v2_common import (  # noqa: E402
    canonical_json_sha256,
    canonical_jsonl_sha256,
    load_lock,
    raw_sha256,
    verify_artifact,
)

PREPARE = REPO_ROOT / "scripts/dataset/prepare_evaluation_ready_v2.py"
POOL = REPO_ROOT / "scripts/dataset/build_evaluation_pool.py"
METRICS = REPO_ROOT / "scripts/dataset/compute_retrieval_metrics.py"


def write_jsonl(path: Path, rows: list[dict], newline: str = "\n") -> None:
    path.write_text(
        newline.join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + newline,
        encoding="utf-8",
        newline="",
    )


def consensus(query_id: str, product_id: int, relevance: int) -> dict:
    return {
        "queryId": query_id,
        "productId": product_id,
        "relevance": relevance,
        "exhaustive": True,
        "labeledBy": "Hien",
        "reviewedBy": "Dat",
        "consensusBy": ["Hien", "Dat"],
        "adjudicationStatus": "AGREED",
        "reviewEvidence": "PR review",
    }


class EvaluationV2ToolsTest(unittest.TestCase):
    def run_script(self, script: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(script), *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def fixture(self, root: Path, query_ids: tuple[str, ...] = ("Q1",)) -> dict[str, Path]:
        files = {name: root / name for name in ("corpus.jsonl", "mapping.jsonl", "queries.jsonl", "labels.jsonl", "lock.json")}
        write_jsonl(files["corpus.jsonl"], [{"externalId": "A"}, {"externalId": "B"}])
        write_jsonl(files["mapping.jsonl"], [{"externalId": "A", "productId": 7}, {"externalId": "B", "productId": 8}])
        write_jsonl(
            files["queries.jsonl"],
            [{"queryId": query_id, "anchorExternalId": "A"} for query_id in query_ids],
        )
        write_jsonl(
            files["labels.jsonl"],
            [
                {
                    "queryId": query_id,
                    "candidateExternalId": "A",
                    "relevance": 2,
                    "exhaustive": False,
                    "labeledBy": "Hien",
                    "reviewedBy": "Dat",
                    "consensusBy": ["Hien", "Dat"],
                    "adjudicationStatus": "AGREED",
                    "reviewEvidence": "pilot",
                }
                for query_id in query_ids
            ],
        )
        lock = {
            "schemaVersion": 2,
            "evaluationScope": "FULL_LOCKED_CORPUS",
            "corpus": {
                "count": 2,
                "hashAlgorithm": "raw-sha256",
                "sha256": raw_sha256(files["corpus.jsonl"]),
                "mappingSha256Expected": raw_sha256(files["mapping.jsonl"]),
            },
            "search": {
                "commit": "a" * 40,
                "imageModel": "clip-image",
                "imageModelRevision": "b" * 40,
                "textModel": "clip-text",
                "textModelRevision": "c" * 40,
                "indexSnapshotSha256": "D" * 64,
                "rrfK": 60,
                "candidateK": 100,
                "systems": ["hybrid"],
                "topK": 20,
                "metricKValues": [1, 2],
                "relevanceThreshold": 2,
            },
            "queryArtifacts": {
                "textQueries": {
                    "count": len(query_ids),
                    "hashAlgorithm": "canonical-jsonl-v1",
                    "sha256": canonical_jsonl_sha256(files["queries.jsonl"]),
                    "queryIds": list(query_ids),
                }
            },
            "labelArtifacts": {
                "textConsensus": {
                    "count": len(query_ids),
                    "hashAlgorithm": "canonical-jsonl-v1",
                    "sha256": canonical_jsonl_sha256(files["labels.jsonl"]),
                }
            },
        }
        files["lock.json"].write_text(json.dumps(lock), encoding="utf-8")
        return files

    def run_manifest(self, root: Path, files: dict[str, Path], results: list[Path]) -> Path:
        lock = json.loads(files["lock.json"].read_text(encoding="utf-8"))
        evaluation_manifest = {
            "schemaVersion": 1,
            "evaluationScope": "FULL_LOCKED_CORPUS",
            "lockSha256": canonical_json_sha256(lock),
            "corpusSha256": lock["corpus"]["sha256"],
            "mappingSha256": raw_sha256(files["mapping.jsonl"]),
            "queriesSha256": canonical_jsonl_sha256(files["queries.jsonl"]),
            "queryIds": sorted(lock["queryArtifacts"]["textQueries"]["queryIds"]),
            "corpusCount": lock["corpus"]["count"],
            "mappingCount": lock["corpus"]["count"],
        }
        (root / "evaluation-manifest.json").write_text(
            json.dumps(evaluation_manifest), encoding="utf-8"
        )
        manifest = {
            "schemaVersion": 1,
            "runId": "test-run-001",
            "createdAt": "2026-09-30T00:00:00Z",
            "environment": "unit-test",
            "searchCommit": lock["search"]["commit"],
            "imageModel": lock["search"]["imageModel"],
            "imageModelRevision": lock["search"]["imageModelRevision"],
            "textModel": lock["search"]["textModel"],
            "textModelRevision": lock["search"]["textModelRevision"],
            "indexSnapshotSha256": lock["search"]["indexSnapshotSha256"],
            "mappingSha256": raw_sha256(files["mapping.jsonl"]),
            "queriesSha256": canonical_jsonl_sha256(files["queries.jsonl"]),
            "rrfK": 60,
            "candidateK": 100,
            "topK": lock["search"]["topK"],
            "systems": sorted(lock["search"]["systems"]),
            "resultArtifacts": {path.name: canonical_jsonl_sha256(path) for path in results},
        }
        path = root / "run-manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def test_canonical_jsonl_hash_is_independent_of_lf_or_crlf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lf, crlf = root / "lf.jsonl", root / "crlf.jsonl"
            rows = [{"queryId": "Q1", "text": "đỏ"}, {"queryId": "Q2", "text": "xanh"}]
            write_jsonl(lf, rows, "\n")
            write_jsonl(crlf, rows, "\r\n")
            self.assertEqual(canonical_jsonl_sha256(lf), canonical_jsonl_sha256(crlf))

    def test_repository_lock_matches_committed_query_and_label_artifacts(self) -> None:
        lock = load_lock(REPO_ROOT / "docs/testing/electronics/evaluation-lock-v2.json")
        query_spec = lock["queryArtifacts"]["textQueries"]
        label_spec = lock["labelArtifacts"]["textConsensus"]
        verify_artifact(REPO_ROOT / query_spec["path"], query_spec, "queries")
        verify_artifact(REPO_ROOT / label_spec["path"], label_spec, "labels")

    def test_prepare_enforces_lock_and_keeps_pilot_smoke_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            output = root / "output"
            result = self.run_script(
                PREPARE,
                "--lock", str(files["lock.json"]),
                "--corpus", str(files["corpus.jsonl"]),
                "--mapping", str(files["mapping.jsonl"]),
                "--queries", str(files["queries.jsonl"]),
                "--labels", str(files["labels.jsonl"]),
                "--output-dir", str(output),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            readiness = json.loads((output / "readiness.json").read_text(encoding="utf-8"))
            self.assertEqual(readiness["status"], "SMOKE_ONLY")
            self.assertEqual(readiness["requiredFullCorpusJudgmentCount"], 2)
            self.assertFalse(readiness["precisionRecallAllowed"])

            write_jsonl(files["queries.jsonl"], [{"queryId": "Q1", "anchorExternalId": "B"}])
            tampered = self.run_script(
                PREPARE,
                "--lock", str(files["lock.json"]),
                "--corpus", str(files["corpus.jsonl"]),
                "--mapping", str(files["mapping.jsonl"]),
                "--queries", str(files["queries.jsonl"]),
                "--labels", str(files["labels.jsonl"]),
                "--output-dir", str(output),
            )
            self.assertNotEqual(tampered.returncode, 0)
            self.assertIn("queries SHA-256 mismatch", tampered.stderr)

    def test_prepare_rejects_exhaustive_label_without_adjudication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            write_jsonl(
                files["labels.jsonl"],
                [{"queryId": "Q1", "candidateExternalId": "A", "relevance": 2, "exhaustive": True, "adjudicationStatus": "PENDING"}],
            )
            lock = json.loads(files["lock.json"].read_text(encoding="utf-8"))
            lock["labelArtifacts"]["textConsensus"]["sha256"] = canonical_jsonl_sha256(files["labels.jsonl"])
            files["lock.json"].write_text(json.dumps(lock), encoding="utf-8")
            result = self.run_script(
                PREPARE,
                "--lock", str(files["lock.json"]), "--corpus", str(files["corpus.jsonl"]),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--labels", str(files["labels.jsonl"]), "--output-dir", str(root / "output"),
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("lacks completed consensus", result.stderr)

    def test_consensus_normalizes_identity_and_requires_participants(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            invalid_rows = [
                {
                    "queryId": "Q1", "candidateExternalId": "A", "relevance": 2,
                    "exhaustive": True, "labeledBy": "Dat", "reviewedBy": " dat ",
                    "consensusBy": ["Dat", "Hien"], "adjudicationStatus": "AGREED",
                    "reviewEvidence": "review",
                },
                {
                    "queryId": "Q1", "candidateExternalId": "A", "relevance": 2,
                    "exhaustive": True, "labeledBy": "Hien", "reviewedBy": "Dat",
                    "consensusBy": ["Alice", "Bob"], "adjudicationStatus": "AGREED",
                    "reviewEvidence": "review",
                },
            ]
            for row in invalid_rows:
                write_jsonl(files["labels.jsonl"], [row])
                lock = json.loads(files["lock.json"].read_text(encoding="utf-8"))
                lock["labelArtifacts"]["textConsensus"]["sha256"] = canonical_jsonl_sha256(
                    files["labels.jsonl"]
                )
                files["lock.json"].write_text(json.dumps(lock), encoding="utf-8")
                result = self.run_script(
                    PREPARE,
                    "--lock", str(files["lock.json"]), "--corpus", str(files["corpus.jsonl"]),
                    "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                    "--labels", str(files["labels.jsonl"]), "--output-dir", str(root / "output"),
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("lacks completed consensus", result.stderr)

    def test_pool_contains_full_corpus_and_known_positive_outside_retrieval(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            results = root / "results.jsonl"
            # Only B is retrieved; known positive A must still be in the review matrix.
            write_jsonl(results, [{"queryId": "Q1", "system": "hybrid", "items": [{"productId": 8, "rank": 1}]}])
            manifest = self.run_manifest(root, files, [results])
            output = root / "pool.jsonl"
            result = self.run_script(
                POOL,
                "--lock", str(files["lock.json"]), "--run-manifest", str(manifest),
                "--evaluation-manifest", str(root / "evaluation-manifest.json"),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--seed-judgments", str(files["labels.jsonl"]), "--results", str(results),
                "--output", str(output),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
            self.assertEqual({row["productId"] for row in rows}, {7, 8})
            positive = next(row for row in rows if row["productId"] == 7)
            self.assertEqual(positive["relevance"], 2)
            self.assertEqual(positive["ranks"], {})
            self.assertFalse(positive["exhaustive"])

    def test_pool_rejects_gapped_rank(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            results = root / "results.jsonl"
            write_jsonl(results, [{"queryId": "Q1", "system": "hybrid", "items": [{"productId": 8, "rank": 20}]}])
            manifest = self.run_manifest(root, files, [results])
            result = self.run_script(
                POOL,
                "--lock", str(files["lock.json"]), "--run-manifest", str(manifest),
                "--evaluation-manifest", str(root / "evaluation-manifest.json"),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--seed-judgments", str(files["labels.jsonl"]), "--results", str(results),
                "--output", str(root / "pool.jsonl"),
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("contiguous", result.stderr)

    def test_pool_rejects_tampered_lock_and_missing_locked_systems(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            results = root / "results.jsonl"
            write_jsonl(
                results,
                [{"queryId": "Q1", "system": "hybrid", "items": [{"productId": 7, "rank": 1}]}],
            )
            manifest = self.run_manifest(root, files, [results])
            lock = json.loads(files["lock.json"].read_text(encoding="utf-8"))
            lock["corpus"]["sha256"] = "0" * 64
            files["lock.json"].write_text(json.dumps(lock), encoding="utf-8")
            args = (
                "--lock", str(files["lock.json"]), "--run-manifest", str(manifest),
                "--evaluation-manifest", str(root / "evaluation-manifest.json"),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--seed-judgments", str(files["labels.jsonl"]), "--results", str(results),
                "--output", str(root / "pool.jsonl"),
            )
            tampered = self.run_script(POOL, *args)
            self.assertNotEqual(tampered.returncode, 0)
            self.assertIn("evaluation manifest", tampered.stderr)

            files = self.fixture(root)
            lock = json.loads(files["lock.json"].read_text(encoding="utf-8"))
            lock["search"]["systems"] = ["keyword", "semantic", "hybrid"]
            files["lock.json"].write_text(json.dumps(lock), encoding="utf-8")
            manifest = self.run_manifest(root, files, [results])
            missing_systems = self.run_script(
                POOL,
                "--lock", str(files["lock.json"]), "--run-manifest", str(manifest),
                "--evaluation-manifest", str(root / "evaluation-manifest.json"),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--seed-judgments", str(files["labels.jsonl"]), "--results", str(results),
                "--output", str(root / "pool.jsonl"),
            )
            self.assertNotEqual(missing_systems.returncode, 0)
            self.assertIn("result systems do not match expected systems", missing_systems.stderr)

    def test_metrics_require_full_corpus_consensus_and_valid_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            results = root / "results.jsonl"
            judgments = root / "judgments.jsonl"
            write_jsonl(results, [{"queryId": "Q1", "system": "hybrid", "items": [{"productId": 7, "rank": 1}, {"productId": 8, "rank": 2}]}])
            write_jsonl(judgments, [consensus("Q1", 7, 2), consensus("Q1", 8, 0)])
            manifest = self.run_manifest(root, files, [results])
            output = root / "metrics.json"
            args = (
                "--lock", str(files["lock.json"]), "--run-manifest", str(manifest),
                "--evaluation-manifest", str(root / "evaluation-manifest.json"),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--results", str(results), "--judgments", str(judgments), "--k", "1", "2",
                "--output", str(output),
            )
            result = self.run_script(METRICS, *args)
            self.assertEqual(result.returncode, 0, result.stderr)
            metrics = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(metrics["evaluationScope"], "FULL_LOCKED_CORPUS")
            self.assertEqual(metrics["metricKValues"], [1, 2])
            self.assertEqual(metrics["relevanceThreshold"], 2)
            self.assertEqual(metrics["systems"]["hybrid"]["@1"]["recallMacro"], 1.0)

            mismatched_policy = self.run_script(
                METRICS,
                *args,
                "--relevance-threshold", "0",
            )
            self.assertNotEqual(mismatched_policy.returncode, 0)
            self.assertIn("relevance threshold must match evaluation lock", mismatched_policy.stderr)

            mismatched_k_args = list(args)
            k_position = mismatched_k_args.index("--k")
            mismatched_k_args[k_position + 1 : k_position + 3] = ["999"]
            mismatched_k = self.run_script(METRICS, *mismatched_k_args)
            self.assertNotEqual(mismatched_k.returncode, 0)
            self.assertIn("metric K values must match evaluation lock", mismatched_k.stderr)

            bad_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            bad_manifest["indexSnapshotSha256"] = "wrong"
            manifest.write_text(json.dumps(bad_manifest), encoding="utf-8")
            rejected = self.run_script(METRICS, *args)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("indexSnapshotSha256 mismatch", rejected.stderr)

    def test_metrics_reject_missing_query_pending_consensus_and_bad_rank(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root, ("Q1", "Q2"))
            results = root / "results.jsonl"
            judgments = root / "judgments.jsonl"
            write_jsonl(results, [{"queryId": "Q1", "system": "hybrid", "items": [{"productId": 7, "rank": 20}]}])
            write_jsonl(judgments, [consensus("Q1", 7, 2), consensus("Q1", 8, 0)])
            manifest = self.run_manifest(root, files, [results])
            base_args = (
                "--lock", str(files["lock.json"]), "--run-manifest", str(manifest),
                "--evaluation-manifest", str(root / "evaluation-manifest.json"),
                "--mapping", str(files["mapping.jsonl"]), "--queries", str(files["queries.jsonl"]),
                "--results", str(results), "--judgments", str(judgments),
                "--output", str(root / "metrics.json"),
            )
            result = self.run_script(METRICS, *base_args)
            self.assertNotEqual(result.returncode, 0)
            # Missing Q2 is detected from the lock even though it is absent from both inputs.
            self.assertIn("full-corpus judgments are incomplete", result.stderr)

            pending = consensus("Q1", 7, 2)
            pending["adjudicationStatus"] = "PENDING"
            write_jsonl(
                judgments,
                [pending, consensus("Q1", 8, 0), consensus("Q2", 7, 2), consensus("Q2", 8, 0)],
            )
            rejected_pending = self.run_script(METRICS, *base_args)
            self.assertNotEqual(rejected_pending.returncode, 0)
            self.assertIn("lacks completed independent consensus", rejected_pending.stderr)

            write_jsonl(
                results,
                [
                    {"queryId": "Q1", "system": "hybrid", "items": [{"productId": 7, "rank": 20}]},
                    {"queryId": "Q2", "system": "hybrid", "items": [{"productId": 7, "rank": 1}]},
                ],
            )
            write_jsonl(
                judgments,
                [
                    consensus("Q1", 7, 2), consensus("Q1", 8, 0),
                    consensus("Q2", 7, 2), consensus("Q2", 8, 0),
                ],
            )
            manifest = self.run_manifest(root, files, [results])
            rank_args = list(base_args)
            rank_args[3] = str(manifest)
            rejected_rank = self.run_script(METRICS, *rank_args)
            self.assertNotEqual(rejected_rank.returncode, 0)
            self.assertIn("contiguous", rejected_rank.stderr)


if __name__ == "__main__":
    unittest.main()
