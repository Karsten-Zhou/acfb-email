// Deploy the Worker while keeping `wrangler.jsonc` clean.
//
// `wrangler deploy` (via automatic resource provisioning) writes resource IDs
// and a generated-config-relative `migrations_dir` into `wrangler.jsonc`. That
// path is only valid relative to the generated build config (dist/acfb_email/),
// so committing it breaks the standalone `wrangler d1 migrations apply`
// command (see README "Trace upstream issues"). Snapshot the config, deploy,
// then restore it — resources stay linked to the Worker by name regardless.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "wrangler.jsonc");
const backupPath = resolve(root, "node_modules", ".cache", "deploy-wrangler.jsonc.bak");

// Snapshot the pristine config before Wrangler can rewrite it.
mkdirSync(dirname(backupPath), { recursive: true });
copyFileSync(configPath, backupPath);

function run(command: string, args: string[] = []): number {
  const res = spawnSync(command, args, {
    stdio: "inherit",
    // On Windows, `npx.cmd`/`npm.cmd` are batch files that only run through
    // the shell; spawnSync cannot exec a .cmd directly without `shell`.
    shell: process.platform === "win32",
  });
  if (res.error) {
    console.error(`Failed to run: ${command} ${args.join(" ")}`);
    console.error(res.error.message);
    return 1;
  }
  return res.status ?? 1;
}

// Spawn the local binaries via `npx`, which resolves node_modules/.bin on both
// Unix (npx) and Windows (npx.cmd) without assuming the installing runtime.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

let exitCode = run(npx, ["vite", "build"]);
if (exitCode === 0) {
  exitCode = run(npx, ["wrangler", "deploy"]);
}

// Restore the pristine config, even on failure, so `wrangler d1 migrations
// apply` keeps working afterwards.
copyFileSync(backupPath, configPath);
rmSync(backupPath, { force: true });

process.exit(exitCode);
