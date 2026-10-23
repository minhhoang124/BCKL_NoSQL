"""Opt-in local Search integration. Creates only fresh QA artifacts; never resets data."""

import argparse
import hashlib
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

if sys.flags.optimize:
    raise RuntimeError("QA safety checks require Python without -O/PYTHONOPTIMIZE")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--checkout", type=Path, required=True)
parser.add_argument("--head", required=True)
parser.add_argument("--run-name", required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--python", type=Path, required=True)
parser.add_argument("--image", type=Path, required=True)
parser.add_argument("--image-model", type=Path, required=True)
parser.add_argument("--text-model", type=Path, required=True)
parser.add_argument("--image-gateway", action="store_true")
parser.add_argument("--pg-container", default="dat-pr89-85-87-review-20261021")
args = parser.parse_args()
root = args.checkout.resolve()
output = args.output.resolve()
kit = Path(__file__).resolve().parent
assert re.fullmatch(r"[a-z0-9_]{1,20}", args.run_name), (
    "Use a unique lowercase QA run name"
)
assert re.fullmatch(r"[0-9a-f]{40}", args.head), "Full commit SHA required"
assert (
    subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    == args.head
)
assert all(not (root / p).exists() for p in [".env", "BE/.env", "AI_CLIP/.env"])
for p in [args.python, args.image, args.image_model, args.text_model]:
    assert p.exists(), "An explicit external dependency is missing"
image_revision = args.image_model.name
text_revision = args.text_model.name
assert re.fullmatch(r"[0-9a-f]{40}", image_revision)
assert re.fullmatch(r"[0-9a-f]{40}", text_revision)
assert not output.exists(), "Refuse existing evidence/runtime directory"
pg = args.pg_container
assert pg == "dat-pr89-85-87-review-20261021" or re.fullmatch(
    r"dat-search-live-qa-[a-z0-9-]{1,30}", pg
), "Refuse non-QA container name"
for port in [19263, 19264, 8140, 8141, 3361, 3362]:
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", port))
es = "dat-search-live-" + args.run_name.replace("_", "-")
database = "bckl_order_resolution_test_search_live_" + args.run_name
role = "qa_search_live_" + args.run_name
password = secrets.token_hex(32)
env = dict(os.environ)
for key in [
    "DATABASE_URL",
    "UPLOAD_ROOT",
    "SEARCH_INTERNAL_HEALTH_TOKEN",
    "AI_INTERNAL_HEALTH_TOKEN",
    "SERVER_WORKERS",
    "WEB_CONCURRENCY",
    "PRODUCT_SYNC_STATE_PATH",
    "ELASTICSEARCH_URL",
    "ELASTICSEARCH_INDEX_NAME",
]:
    env.pop(key, None)
env.update(
    GITHUB_ACTIONS="false",
    NODE_ENV="test",
    HF_HUB_OFFLINE="1",
    TRANSFORMERS_OFFLINE="1",
    HF_HUB_DISABLE_TELEMETRY="1",
    AI_LOAD_RUNTIME_ON_STARTUP="true",
    DATABASE_URL=f"postgresql://{role}:{password}@127.0.0.1:5549/{database}?schema=public",
    JWT_ACCESS_SECRET=secrets.token_hex(32),
    JWT_REFRESH_SECRET=secrets.token_hex(32),
    JWT_ACCESS_TTL_SECONDS="900",
    JWT_REFRESH_TTL_SECONDS="604800",
    JWT_ISSUER="klcn-ecommerce-api",
    JWT_AUDIENCE="klcn-ecommerce-web",
    AI_SERVICE_URL="http://127.0.0.1:8141",
    AI_SEARCH_TIMEOUT_MS="10000",
    AI_IMAGE_MODEL_NAME=str(args.image_model.resolve()),
    AI_TEXT_MODEL_NAME=str(args.text_model.resolve()),
    AI_FAISS_INDEX_PATH=str(output / "runtime/products.faiss"),
    AI_FAISS_STATE_PATH=str(output / "runtime/faiss_state.json"),
    AI_PRODUCT_SYNC_STATE_PATH=str(output / "runtime/product_sync_state.json"),
    AI_ARTIFACTS_DIR=str(output / "runtime"),
    AI_ELASTICSEARCH_URL="http://127.0.0.1:19264",
    AI_ELASTICSEARCH_INDEX_NAME="search-live-" + args.run_name.replace("_", "-"),
    AI_IMAGE_URL_ALLOWED_HOSTS="127.0.0.1,localhost",
    AI_RRF_K="60",
    AI_SERVER_WORKERS="1",
    AI_DEVICE="cpu",
    AI_OMP_NUM_THREADS="1",
    OMP_NUM_THREADS="1",
    SEARCH_SYNC_ENABLED="false",
    SEARCH_RECONCILIATION_ENABLED="false",
    PRODUCT_IMAGE_REPAIR_ENABLED="false",
    ORDER_AUTO_COMPLETE_ENABLED="false",
    QA_CHECKOUT_ROOT=str(root),
    QA_EVIDENCE_DIR=str(output),
    QA_IMAGE_PATH=str(args.image.resolve()),
    QA_EXPECTED_HEAD=args.head,
    QA_IMAGE_GATEWAY=str(args.image_gateway).lower(),
    # Do not resolve the venv executable symlink: doing so loses pyvenv.cfg.
    QA_PYTHON=str(args.python.absolute()),
    QA_IMAGE_REVISION=image_revision,
    QA_TEXT_REVISION=text_revision,
)
env["QA_ES_INDEX"] = env["AI_ELASTICSEARCH_INDEX_NAME"]
output.mkdir(parents=True)
(output / "runtime").mkdir()


def redact(value):
    for secret in [password, env["JWT_ACCESS_SECRET"], env["JWT_REFRESH_SECRET"]]:
        value = value.replace(secret, "<redacted>")
    value = re.sub(r"postgres(?:ql)?://[^\s\"\x27]+", "<redacted-db-url>", value)
    return re.sub(
        r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "<redacted-jwt>", value
    )


def command(label, argv, cwd=root):
    print("START " + label, flush=True)
    start = time.monotonic()
    p = subprocess.run(
        argv, cwd=cwd, env=env, text=True, capture_output=True, check=False
    )
    raw = redact(p.stdout + p.stderr)
    record = f"HEAD={args.head}\nCOMMAND={' '.join(map(str, argv))}\n{raw}\nEXIT_STATUS={p.returncode}\nSECONDS={time.monotonic() - start:.2f}\n"
    (output / (label + ".log")).write_text(record)
    print(f"END {label} exit={p.returncode}", flush=True)
    print(raw[-3000:], flush=True)
    if p.returncode:
        raise RuntimeError(label + " failed; see sanitized log")


def admin(sql, db="postgres"):
    p = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            pg,
            "sh",
            "-c",
            'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -At',
            "qa-admin",
            db,
        ],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if p.returncode:
        raise RuntimeError("QA database operation failed; credentials suppressed")
    return p.stdout.strip()


def wait_http(url, seconds, expected=None, process=None):
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        if process is not None and process.poll() is not None:
            raise RuntimeError("AI process exited before readiness; see AI log")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                value = json.load(response)
            if expected is None or all(value.get(k) == v for k, v in expected.items()):
                return value
        except (
            urllib.error.URLError,
            TimeoutError,
            ConnectionError,
            json.JSONDecodeError,
        ):
            pass
        time.sleep(0.5)
    raise RuntimeError("Service readiness deadline exceeded")


ai = None
ai_log = None
pg_started = False
es_created = False
try:
    running = subprocess.check_output(
        ["docker", "inspect", "--format", "{{.State.Running}}", pg], text=True
    ).strip()
    assert running == "false", "Refuse an already running shared QA PostgreSQL"
    ports = json.loads(
        subprocess.check_output(
            ["docker", "inspect", "--format", "{{json .HostConfig.PortBindings}}", pg],
            text=True,
        )
    )
    assert ports.get("5432/tcp") == [{"HostIp": "127.0.0.1", "HostPort": "5549"}], (
        "Refuse non-loopback QA port binding"
    )
    exists = subprocess.run(["docker", "inspect", es], capture_output=True, check=False)
    assert exists.returncode != 0, "Refuse existing Elasticsearch container"
    subprocess.run(["docker", "start", pg], check=True, capture_output=True)
    pg_started = True
    for _ in range(60):
        ready = subprocess.run(
            [
                "docker",
                "exec",
                pg,
                "sh",
                "-c",
                'pg_isready -U "$POSTGRES_USER" -d postgres',
            ],
            capture_output=True,
            check=False,
        )
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("PostgreSQL readiness deadline")
    assert (
        admin(f"SELECT count(*) FROM pg_database WHERE datname='{database}';") == "0"
    ), "Refuse existing DB"
    assert admin(f"SELECT count(*) FROM pg_roles WHERE rolname='{role}';") == "0", (
        "Refuse existing role"
    )
    admin(
        f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{password}';\nCREATE DATABASE {database} OWNER {role};"
    )
    command(
        "migrations",
        ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"],
        root / "BE",
    )
    command(
        "prisma-generate",
        ["node", "node_modules/prisma/build/index.js", "generate"],
        root / "BE",
    )
    command(
        "be-build",
        ["node", "node_modules/@nestjs/cli/bin/nest.js", "build"],
        root / "BE",
    )
    command(
        "es-start",
        [
            "docker",
            "run",
            "-d",
            "--name",
            es,
            "-p",
            "127.0.0.1:19263:9200",
            "-e",
            "discovery.type=single-node",
            "-e",
            "xpack.security.enabled=false",
            "-e",
            "ES_JAVA_OPTS=-Xms512m -Xmx512m",
            "--pull=never",
            "docker.elastic.co/elasticsearch/elasticsearch:8.19.21",
        ],
    )
    es_created = True
    es_info = wait_http("http://127.0.0.1:19263", 90)
    command(
        "empty-faiss",
        [
            str(args.python),
            "-c",
            'import faiss,os; faiss.write_index(faiss.IndexIDMap2(faiss.IndexFlatIP(512)),os.environ["AI_FAISS_INDEX_PATH"])',
        ],
    )
    ai_log = (output / "ai-service.log").open("w")
    ai = subprocess.Popen(
        [
            str(args.python),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8140",
            "--workers",
            "1",
        ],
        cwd=root / "AI_CLIP",
        env=env,
        stdout=ai_log,
        stderr=subprocess.STDOUT,
    )
    wait_http(
        "http://127.0.0.1:8140/health",
        120,
        {"modelLoaded": True, "indexLoaded": True, "vectorCount": 0},
        ai,
    )
    command(
        "python-runtime",
        [
            str(args.python),
            "-c",
            'import importlib.metadata as m,json,platform; print(json.dumps({"python":platform.python_version(),"platform":platform.platform(),"packages":{k:m.version(k) for k in ["fastapi","uvicorn","pydantic","sentence-transformers","transformers","torch","faiss-cpu","numpy","pillow"]}}))',
        ],
    )
    command("live-search", ["node", str(kit / "search-live.mjs")])
    summary = {
        "sourceCommit": args.head,
        "database": database,
        "migrations": int(
            admin(
                "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;",
                database,
            )
        ),
        "roleFlags": admin(
            f"SELECT rolsuper || ':' || rolcreatedb || ':' || rolcreaterole FROM pg_roles WHERE rolname='{role}';"
        ),
        "elasticsearchVersion": es_info["version"]["number"],
        "elasticsearchImageId": subprocess.check_output(
            ["docker", "inspect", "--format", "{{.Image}}", es], text=True
        ).strip(),
        "status": "PASS",
        "nodeVersion": subprocess.check_output(
            ["node", "--version"], text=True
        ).strip(),
    }
    (output / "qa-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary), flush=True)
finally:
    if ai is not None:
        ai.terminate()
        try:
            ai.wait(timeout=10)
        except subprocess.TimeoutExpired:
            ai.kill()
            ai.wait()
    if ai_log is not None:
        ai_log.close()
    for name, stop in [(es, es_created), (pg, pg_started)]:
        if stop:
            p = subprocess.run(
                ["docker", "stop", name], capture_output=True, check=False
            )
            print(f"STOP {name} exit={p.returncode}", flush=True)
    # Preserve DBs, indexes, fault evidence and stopped containers for inspection.
    hashes = {
        str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(output.rglob("*"))
        if p.is_file() and p.name != "SHA256SUMS.json"
    }
    (output / "SHA256SUMS.json").write_text(json.dumps(hashes, indent=2) + "\n")
