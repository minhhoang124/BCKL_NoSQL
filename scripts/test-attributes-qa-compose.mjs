// Explicit Docker QA proof only. Creates new scoped volumes, never reset/drop/down.
// Credentials live in this process/child environment; artifact report is redacted.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import net from "node:net";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.equal(
  process.argv.length,
  2,
  "No arbitrary target/project arguments allowed",
);
for (const file of [".env", "BE/.env", "tools/attributes-qa/.env"])
  assert(!existsSync(path.join(root, file)), "Refuse dotenv checkout");
const require = createRequire(path.join(root, "BE/package.json"));
const { Client } = require("pg");
const stamp = Date.now().toString(36) + "-" + randomBytes(3).toString("hex");
const directory = path.join(
  root,
  "artifacts",
  "attributes-compose-proof-" + stamp,
);
mkdirSync(directory, { recursive: true });
const results = [],
  projects = [],
  secrets = [];
const redact = (value) =>
  secrets
    .reduce(
      (text, secret) => text.split(secret).join("[QA_SECRET]"),
      String(value ?? ""),
    )
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "[QA_DATABASE_URL]");
function command(program, args, env = process.env, cwd = root) {
  const child = spawnSync(program, args, {
    cwd,
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = redact(child.stdout) + redact(child.stderr);
  writeFileSync(path.join(directory, "run.log"), output, { flag: "a" });
  if (child.error || child.status !== 0)
    throw Error(
      `QA child failed: ${path.basename(program)} exit${child.status ?? "unknown"}; see redacted run.log`,
    );
  return String(child.stdout ?? "").trim();
}
const docker = (args) => command("docker", args);
function compose(project, env, args) {
  assert(/^bckl-attr-proof-[a-z0-9-]+-[ab]$/.test(project));
  return command(
    "docker",
    [
      "compose",
      "--project-directory",
      path.join(root, "tools/attributes-qa"),
      "-f",
      path.join(root, "tools/attributes-qa/compose.yaml"),
      "-p",
      project,
      ...args,
    ],
    env,
  );
}
async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
  });
}
async function connection(url) {
  for (let i = 0; i < 30; i++) {
    const client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 1500,
    });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => {});
      await pause(500);
    }
  }
  throw Error("Fresh QA role/database did not become available");
}
async function swagger(env) {
  assert(
    !(await portOpen(3014)),
    "Port3014 belongs to another process; refuse",
  );
  const child = spawn(
    process.execPath,
    [path.join(root, "scripts/run-attributes-handoff-qa.mjs"), "--serve"],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += redact(chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    output += redact(chunk.toString());
  });
  try {
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) throw Error("QA API exited before Swagger");
      try {
        const response = await fetch("http://127.0.0.1:3014/docs-json", {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) {
          const document = await response.json();
          for (const [route, method] of [
            ["/admin/categories/{categoryId}/attributes", "post"],
            [
              "/admin/categories/{categoryId}/attributes/{attributeId}",
              "patch",
            ],
            [
              "/admin/categories/{categoryId}/attributes/{attributeId}/options",
              "post",
            ],
            [
              "/admin/categories/{categoryId}/attributes/{attributeId}/options/{optionId}",
              "patch",
            ],
          ])
            assert(
              document.paths[route]?.[method],
              "Missing Attributes runtime route",
            );
          return 200;
        }
      } catch (error) {
        if (error?.code === "ERR_ASSERTION") throw error;
      }
      await pause(500);
    }
    throw Error("QA Swagger unavailable");
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once("exit", resolve);
        setTimeout(resolve, 3000).unref();
      }
    });
    writeFileSync(path.join(directory, "run.log"), output, { flag: "a" });
  }
}
try {
  assert.equal(
    docker(["inspect", "--format", "{{.State.Running}}", "bckl_postgres"]),
    "false",
    "Demo must remain stopped",
  );
  assert(
    !(await portOpen(5549)),
    "Port5549 is already in use; do not stop another container",
  );
  const checkoutMode = execFileSync(
    "git",
    ["ls-files", "--stage", "tools/attributes-qa/init-qa.sh"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  ).split(" ")[0];
  for (const suffix of ["a", "b"]) {
    const project = `bckl-attr-proof-${stamp}-${suffix}`;
    const prefix = project + "_attributes-qa-data";
    assert.equal(
      docker([
        "volume",
        "ls",
        "--filter",
        `name=${prefix}`,
        "--format",
        "{{.Name}}",
      ]),
      "",
      "Refuse existing proof volume",
    );
    const bootstrap = randomBytes(24).toString("hex"),
      migrator = randomBytes(24).toString("hex");
    const access = randomBytes(32).toString("hex"),
      refresh = randomBytes(32).toString("hex");
    const url = `postgresql://bckl_attributes_qa:${migrator}@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v1`;
    secrets.push(bootstrap, migrator, access, refresh, url);
    const env = {
      ...process.env,
      ATTRIBUTES_QA_BOOTSTRAP_PASSWORD: bootstrap,
      ATTRIBUTES_QA_MIGRATOR_PASSWORD: migrator,
      DATABASE_URL: url,
      JWT_ACCESS_SECRET: access,
      JWT_REFRESH_SECRET: refresh,
      GITHUB_ACTIONS: "false",
      SEARCH_SYNC_ENABLED: "false",
      SEARCH_RECONCILIATION_ENABLED: "false",
      PRODUCT_IMAGE_REPAIR_ENABLED: "false",
      ORDER_AUTO_COMPLETE_ENABLED: "false",
      QA_HANDOFF_OUTPUT_ROOT: path.join(directory, project, "private-fixture"),
    };
    projects.push({ project, env });
    compose(project, env, ["config", "--quiet"]);
    compose(project, env, [
      "up",
      "-d",
      "--build",
      "--wait",
      "--wait-timeout",
      "60",
    ]);
    const imageMode = compose(project, env, [
      "exec",
      "-T",
      "postgres",
      "stat",
      "-c",
      "%a",
      "/docker-entrypoint-initdb.d/10-attributes-qa.sh",
    ]);
    assert.equal(imageMode, "755", "Image init mode is not executable");
    const client = await connection(url);
    let role;
    try {
      role = (
        await client.query(
          "SELECT current_database() AS db,current_user AS actor,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      assert.equal(role.actor, "bckl_attributes_qa");
      assert.equal(
        role.db,
        "bckl_order_resolution_test_attributes_20261019_v1",
      );
      assert(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole);
    } finally {
      await client.end();
    }
    command(
      process.execPath,
      [
        path.join(root, "BE/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      env,
      path.join(root, "BE"),
    );
    for (let attempt = 0; attempt < 2; attempt++)
      command(
        process.execPath,
        [path.join(root, "scripts/run-attributes-handoff-qa.mjs")],
        env,
      );
    const status = await swagger(env);
    const verification = await connection(url);
    let migrations;
    try {
      migrations = Number(
        (
          await verification.query(
            "SELECT count(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
          )
        ).rows[0].count,
      );
    } finally {
      await verification.end();
    }
    const result = {
      project,
      freshVolume: prefix,
      checkoutGitMode: checkoutMode,
      hostMode: (
        statSync(path.join(root, "tools/attributes-qa/init-qa.sh")).mode & 0o777
      ).toString(8),
      imageMode,
      role,
      migrations,
      seedRuns: 2,
      swaggerStatus: status,
      result: "PASS",
    };
    results.push(result);
    console.log(JSON.stringify(result));
    compose(project, env, ["stop"]);
  }
} catch (error) {
  results.push({ result: "FAIL", message: redact(error.message) });
  process.exitCode = 1;
} finally {
  for (const { project, env } of projects) {
    try {
      compose(project, env, ["stop"]);
    } catch {
      /* Keep failed volume and report, never reset/restart it. */
    }
  }
  writeFileSync(
    path.join(directory, "results.json"),
    JSON.stringify(
      {
        host: process.platform,
        architecture: process.arch,
        results,
        limitations: [
          "Native macOS/ARM64 not executed here",
          "Volumes and immutable fixtures retained; no down/reset/drop",
          "Private fixture credentials are local only; share results.json, not the whole artifact folder",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      report: path.join(directory, "results.json"),
      passed: results.filter((result) => result.result === "PASS").length,
      failed: results.filter((result) => result.result === "FAIL").length,
    }),
  );
}
