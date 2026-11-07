import copy
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from migration_provenance import (
    allowed_checksums,
    digest,
    source_inventory,
    sql_at_commit,
    verify_migrations,
)


class MigrationProvenanceTests(unittest.TestCase):
    def test_optimized_verifier_and_library_refused_before_any_evidence_read(self):
        kit = Path(__file__).resolve().parent
        for optimize in ["-O", "-OO", "env-1", "env-2"]:
            for target in ["library", "verifier"]:
                with self.subTest(optimize=optimize, target=target):
                    env = os.environ.copy()
                    env.pop("PYTHONOPTIMIZE", None)
                    cmd = [sys.executable]
                    if optimize.startswith("env-"):
                        env["PYTHONOPTIMIZE"] = optimize[-1]
                    else:
                        cmd.append(optimize)
                    if target == "library":
                        cmd += ["-c", "import migration_provenance"]
                    else:
                        # No evidence path exists: fail closed at module import.
                        cmd += [str(kit / "verify_search_live.py"), "missing-evidence"]
                    result = subprocess.run(
                        cmd,
                        cwd=kit,
                        env=env,
                        capture_output=True,
                        text=True,
                        check=False,
                        timeout=15,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(
                        "QA safety checks require Python without -O", result.stderr
                    )
                    self.assertNotIn("FileNotFoundError", result.stderr)

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.repo = Path(cls.temp.name)
        cls.git("init", "-q")
        cls.git("config", "user.name", "QA fixture")
        cls.git("config", "user.email", "qa@example.test")
        cls.git("config", "core.autocrlf", "false")
        cls.heads = {}
        for count in [17, 19, 25]:
            for i in range(count):
                p = cls.repo / f"BE/prisma/migrations/m{i:02}/migration.sql"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(f"-- migration {i}\nSELECT {i};\n".encode())
            cls.git("add", "BE")
            cls.git("-c", "commit.gpgsign=false", "commit", "-qm", f"fixture {count}")
            cls.heads[count] = cls.git("rev-parse", "HEAD").strip()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def git(cls, *args):
        return subprocess.check_output(["git", *args], cwd=cls.repo, text=True)

    def proof(self, count=25):
        head = self.heads[count]
        sql = sql_at_commit(self.repo, head)
        return {
            "schemaVersion": 1,
            "sourceCommit": head,
            "expected": [
                {"name": n, "sha256": digest(b)} for n, b in sorted(sql.items())
            ],
            "applied": [
                {
                    "name": n,
                    "checksum": digest(b),
                    "finished": True,
                    "rolledBack": False,
                }
                for n, b in sorted(sql.items())
            ],
        }

    def verify(self, proof):
        return verify_migrations(proof, self.repo, proof["sourceCommit"])

    def test_17_19_25_against_immutable_commits_not_current_head(self):
        for count in self.heads:
            with self.subTest(count=count):
                self.assertEqual(self.verify(self.proof(count)), count)

    def test_same_count_wrong_name_rejected(self):
        p = self.proof()
        p["applied"][0]["name"] = "different_migration"
        with self.assertRaises(AssertionError):
            self.verify(p)

    def test_missing_extra_duplicate_checksum_and_status_rejected(self):
        for kind in [
            "missing",
            "extra",
            "duplicate",
            "checksum",
            "unfinished",
            "rolledback",
        ]:
            with self.subTest(kind=kind):
                p = self.proof()
                if kind == "missing":
                    p["applied"].pop()
                elif kind == "extra":
                    p["applied"].append(copy.deepcopy(p["applied"][0]))
                elif kind == "duplicate":
                    p["applied"][1] = copy.deepcopy(p["applied"][0])
                elif kind == "checksum":
                    p["applied"][0]["checksum"] = "0" * 64
                elif kind == "unfinished":
                    p["applied"][0]["finished"] = False
                else:
                    p["applied"][0]["rolledBack"] = True
                with self.assertRaises(AssertionError):
                    self.verify(p)

    def test_forged_inventory_rejected(self):
        p = self.proof()
        p["expected"][0]["sha256"] = "0" * 64
        with self.assertRaises(AssertionError):
            self.verify(p)

    def test_wrong_expected_head_rejected(self):
        with self.assertRaises(AssertionError):
            verify_migrations(self.proof(17), self.repo, self.heads[25])

    def test_crlf_checksum_allowed_but_content_change_rejected(self):
        p = self.proof()
        sql = sql_at_commit(self.repo, p["sourceCommit"])
        for row in p["applied"]:
            row["checksum"] = digest(sql[row["name"]].replace(b"\n", b"\r\n"))
        self.assertEqual(self.verify(p), 25)
        self.assertNotIn(digest(b"SELECT 999;\n"), allowed_checksums(b"SELECT 1;\n"))

    def test_dirty_working_sql_rejected_before_runtime(self):
        head = self.heads[25]
        path = self.repo / "BE/prisma/migrations/m00/migration.sql"
        original = path.read_bytes()
        try:
            source_inventory(self.repo, head)
            path.write_bytes(original.replace(b"\n", b"\r\n"))
            source_inventory(self.repo, head)
            path.write_bytes(original + b"SELECT 999;\n")
            with self.assertRaises(AssertionError):
                source_inventory(self.repo, head)
        finally:
            path.write_bytes(original)


if __name__ == "__main__":
    unittest.main()
