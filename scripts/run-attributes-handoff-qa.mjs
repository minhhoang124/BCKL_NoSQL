// Opt-in QA only. No dotenv, DB creation/reset/migration, remote code or secrets
// in output. Run from the exact reviewed checkout, not the shared demo checkout.
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "BE/package.json"));
const { Client } = require("pg");
const raw = process.env.DATABASE_URL;
let client;
let app;
try {
  const serve = process.argv.length === 3 && process.argv[2] === "--serve";
  const checkTarget = process.argv.length === 3 && process.argv[2] === "--check-target";
  if (
    (!serve && !checkTarget && process.argv.length !== 2) ||
    [".env", "BE/.env"].some((p) => existsSync(path.join(root, p)))
  )
    throw Error("Clean isolated checkout required");
  const url = new URL(raw ?? "");
  const databasePassword = decodeURIComponent(url.password);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5549" ||
    !/^\/bckl_order_resolution_test_attributes_20261019(?:_v[1-9][0-9]{0,7})?$/.test(
      url.pathname,
    ) ||
    !url.username ||
    databasePassword.length < 12 ||
    url.hash ||
    [...url.searchParams].some(([k, v]) => k !== "schema" || v !== "public") ||
    url.searchParams.getAll("schema").length > 1
  )
    throw Error("Explicit isolated QA target required");
  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"])
    if (typeof process.env[key] !== "string" || process.env[key].length < 32)
      throw Error("Explicit QA JWT secrets required");
  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET)
    throw Error("Distinct QA JWT secrets required");
  client = new Client({ connectionString: raw, connectionTimeoutMillis: 3000 });
  await client.connect();
  const role = (
    await client.query(
      "SELECT current_database() AS db, rolsuper, rolcreaterole FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (role.db !== url.pathname.slice(1) || role.rolsuper || role.rolcreaterole)
    throw Error("Unsafe QA database or role");
  if (checkTarget) {
    await client.end(); client = null;
    console.log('Attributes QA target verified: loopback5549/restricted role. No mutation executed.');
    process.exit(0);
  }
  const expected = readdirSync(path.join(root, "BE/prisma/migrations"), {
    withFileTypes: true,
  })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const rows = (
    await client.query(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations",
    )
  ).rows;
  const applied = rows
    .filter((r) => r.finished_at !== null && r.rolled_back_at === null)
    .map((r) => r.migration_name);
  if (
    rows.some((r) => r.finished_at === null && r.rolled_back_at === null) ||
    applied.length !== expected.length ||
    expected.some((n) => !applied.includes(n))
  )
    throw Error("QA migrations do not match checkout");
  await client.end();
  client = null;
  if (serve) {
    for (const key of [
      "SEARCH_SYNC_ENABLED",
      "SEARCH_RECONCILIATION_ENABLED",
      "PRODUCT_IMAGE_REPAIR_ENABLED",
      "ORDER_AUTO_COMPLETE_ENABLED",
    ])
      process.env[key] = "false";
    require("reflect-metadata");
    const { NestFactory } = require("@nestjs/core");
    const { SwaggerModule, DocumentBuilder } = require("@nestjs/swagger");
    const { AppModule } = await import(
      pathToFileURL(path.join(root, "BE/dist/app.module.js")).href
    );
    const { configureApp } = await import(
      pathToFileURL(path.join(root, "BE/dist/configure-app.js")).href
    );
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    configureApp(app);
    SwaggerModule.setup(
      "docs",
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle("Attributes isolated QA")
          .setVersion("1")
          .addBearerAuth()
          .build(),
      ),
    );
    await app.listen(3014, "127.0.0.1");
    console.log(
      "Attributes QA: http://127.0.0.1:3014/docs (loopback only). Ctrl+C stops API; database is retained.",
    );
    let stopping = false;
    const stop = async () => {
      if (!stopping) {
        stopping = true;
        await app.close();
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else {
    const commonGit = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const commonRoot = path.dirname(path.resolve(root, commonGit));
    const child = spawnSync(
      process.execPath,
      [
        path.join(root, "BE/node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.config.attribute-handoff.ts",
      ],
      {
        cwd: path.join(root, "BE"),
        windowsHide: true,
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          DATABASE_URL: raw,
          QA_HANDOFF_OUTPUT_ROOT: path.join(
            commonRoot,
            "artifacts",
            "attributes-handoff-qa",
          ),
          SEARCH_SYNC_ENABLED: "false",
          SEARCH_RECONCILIATION_ENABLED: "false",
          PRODUCT_IMAGE_REPAIR_ENABLED: "false",
          ORDER_AUTO_COMPLETE_ENABLED: "false",
        },
      },
    );
    const redact = (v) =>
      String(v ?? "")
        .split(raw)
        .join("[QA_DATABASE_URL]")
        .split(url.password)
        .join("[QA_SECRET]")
        .split(databasePassword)
        .join("[QA_SECRET]")
        .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "[DATABASE_URL]")
        .split(process.env.JWT_ACCESS_SECRET)
        .join("[QA_SECRET]")
        .split(process.env.JWT_REFRESH_SECRET)
        .join("[QA_SECRET]");
    process.stdout.write(redact(child.stdout));
    process.stderr.write(redact(child.stderr));
    if (child.status !== 0 || child.error) throw Error("QA fixture failed");
  }
} catch {
  await app?.close().catch(() => {});
  process.stderr.write(
    "Attributes QA refused/failed; configuration withheld. Check the isolated-target handoff guide.\n",
  );
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
