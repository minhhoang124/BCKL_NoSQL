"""Real Git checkout and captured stdout regressions; standard library only."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parent.parent
REPO = DOCS.parents[2]
REL = ROOT.relative_to(REPO)
EXPECTED = "2c745fbf82ffa339c3b3ad93399078e3000c67579bf7f148fa89d25a3d626350"


class PortabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="evaluation-portability-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.fixture = Path(cls.temporary.name) / "index-source"
        cls.fixture.mkdir()
        subprocess.run(["git", "init", "--quiet", str(cls.fixture)], check=True)
        paths = [DOCS / "evaluation-lock-v2.json",
                 DOCS / "ai-assisted-evaluation-protocol-proposal-2026-10-21.md"]
        if (REPO / ".gitattributes").is_file():
            paths.append(REPO / ".gitattributes")
        for name in ("2026-10-20-seven-query", "2026-10-21-pending-57", ROOT.name):
            paths.extend(p for p in (ROOT.parent / name).iterdir() if p.is_file())
        cls.paths = [p.relative_to(REPO) for p in paths]
        for source, rel in zip(paths, cls.paths):
            target = cls.fixture / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        subprocess.run(["git", "-c", "core.autocrlf=false", "-C", str(cls.fixture),
                        "add", "--all"], check=True, capture_output=True)

    def check_capture(self, captured):
        self.assertEqual(captured.returncode, 0, captured.stderr.decode("utf-8", errors="replace"))
        raw = captured.stdout
        self.assertEqual(raw.count(b"\r"), 0, "Canonical stdout contains CR bytes")
        self.assertTrue(raw.endswith(b"\n"))
        self.assertEqual(hashlib.sha256(raw).hexdigest(), EXPECTED)
        rows = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
        self.assertEqual(len(rows), 1032)
        self.assertEqual(sum(r["relevance"] is not None for r in rows), 978)
        self.assertEqual(sum(r["relevance"] is None for r in rows), 54)

    def test_real_git_checkout_both_autocrlf_modes(self):
        for mode in ("false", "true"):
            with self.subTest(autocrlf=mode):
                target = Path(self.temporary.name) / ("checkout-" + mode)
                target.mkdir(exist_ok=True)
                # core.eol=crlf challenges text attributes even on non-Windows.
                subprocess.run(["git", "-c", "core.autocrlf=" + mode, "-c", "core.eol=crlf",
                                "-C", str(self.fixture), "checkout-index", "--all", "--force",
                                "--prefix=" + target.as_posix() + "/"], check=True, capture_output=True)
                for rel in self.paths:
                    self.assertEqual(hashlib.sha256((target / rel).read_bytes()).hexdigest(),
                                     hashlib.sha256((REPO / rel).read_bytes()).hexdigest(), str(rel))
                scripts = [target / REL / "verify_decision.py",
                           target / REL.parent / "2026-10-21-pending-57" / "verify_review.py",
                           target / REL.parent / "2026-10-20-seven-query" / "verify_review_package.py"]
                env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
                for script in scripts:
                    result = subprocess.run([sys.executable, str(script)], env=env, capture_output=True)
                    self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
                for encoding in ("utf-8", "cp1258", "ascii"):
                    env["PYTHONIOENCODING"] = encoding
                    self.check_capture(subprocess.run([sys.executable, str(scripts[0]), "--labels"],
                                                       env=env, capture_output=True))

    def test_windows_text_stdout_translation_and_legacy_codepages(self):
        # Exercise Windows TextIO newline conversion on any host, plus native
        # subprocess captures above on the Windows CI runner itself.
        wrapper = (
            "import io,os,runpy,sys; "
            "sys.stdout=io.TextIOWrapper(sys.stdout.buffer,"
            "encoding=os.environ['PORTABILITY_ENCODING'],newline='\\r\\n'); "
            "script=sys.argv[1]; sys.argv=[script,'--labels']; "
            "runpy.run_path(script,run_name='__main__')"
        )
        for encoding in ("utf-8", "cp1258", "ascii"):
            with self.subTest(stdout=encoding):
                env = dict(os.environ, PORTABILITY_ENCODING=encoding, PYTHONDONTWRITEBYTECODE="1")
                self.check_capture(subprocess.run([sys.executable, "-c", wrapper,
                                                   str(ROOT / "verify_decision.py")],
                                                  env=env, capture_output=True))

    def test_modified_historical_protocol_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="evaluation-tamper-") as scratch:
            target = Path(scratch)
            for rel in self.paths:
                destination = target / rel
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REPO / rel, destination)
            snapshot = target / REL.parent / "2026-10-21-pending-57" / "protocol-proposal.snapshot.md"
            snapshot.write_bytes(snapshot.read_bytes() + b"\nTampered historical input\n")
            result = subprocess.run([sys.executable, str(target / REL / "verify_decision.py")],
                                    env=dict(os.environ, PYTHONIOENCODING="utf-8"), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"protocol-proposal.md", result.stderr)


if __name__ == "__main__":
    unittest.main()
