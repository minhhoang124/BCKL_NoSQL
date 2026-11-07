"""Negative preflight checks: must reject before touching Docker or a database."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RunnerPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.repo = Path(__file__).resolve().parents[2]
        self.head = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=self.repo, text=True
        ).strip()
        self.model = self.folder / ("a" * 40)
        self.model.mkdir()
        self.image = self.folder / "fixture.jpg"
        self.image.write_bytes(b"not used: preflight only")
        self.marker = self.folder / "docker-was-called"
        docker = self.folder / "docker"
        docker.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(self.marker)!r}).touch()\nraise SystemExit(99)\n"
        )
        docker.chmod(0o755)
        self.env = dict(
            os.environ, PATH=str(self.folder) + os.pathsep + os.environ["PATH"]
        )

    def rejected(self, **changes):
        values = {
            "checkout": self.repo,
            "head": self.head,
            "run-name": "preflight",
            "output": self.folder / "output",
            "python": sys.executable,
            "image": self.image,
            "image-model": self.model,
            "text-model": self.model,
        }
        values.update(changes)
        command = [sys.executable, str(self.repo / "scripts/qa/run_search_live.py")]
        for key, value in values.items():
            command += ["--" + key, str(value)]
        result = subprocess.run(
            command, env=self.env, text=True, capture_output=True, check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.marker.exists(), "Preflight reached Docker")
        return result.stderr

    def test_invalid_run_name(self):
        self.assertIn("unique lowercase", self.rejected(**{"run-name": "BAD/name"}))

    def test_wrong_checkout_head(self):
        self.assertIn("AssertionError", self.rejected(head="0" * 40))

    def test_missing_dependency(self):
        self.assertIn(
            "external dependency", self.rejected(image=self.folder / "missing.jpg")
        )

    def test_unpinned_model(self):
        self.assertIn("AssertionError", self.rejected(**{"image-model": self.folder}))

    def test_existing_output(self):
        self.assertIn("existing evidence", self.rejected(output=self.folder))

    def test_demo_container(self):
        self.assertIn(
            "non-QA container", self.rejected(**{"pg-container": "bckl_postgres"})
        )

    def test_optimized_python(self):
        self.env["PYTHONOPTIMIZE"] = "1"
        self.assertIn("without -O", self.rejected())


if __name__ == "__main__":
    unittest.main()
