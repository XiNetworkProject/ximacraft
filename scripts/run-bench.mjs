/**
 * Bundle + exécute le benchmark CPU headless (scripts/bench-perf.ts).
 * Même approche que run-weather-tests.mjs (esbuild embarqué par Vite).
 *
 *   node scripts/run-bench.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function findEsbuild() {
  const base = join(root, "node_modules", "@esbuild");
  if (!existsSync(base)) throw new Error("@esbuild introuvable dans node_modules");
  for (const entry of readdirSync(base)) {
    const exe = join(base, entry, "esbuild.exe");
    if (existsSync(exe)) return exe;
    const bin = join(base, entry, "bin", "esbuild");
    if (existsSync(bin)) return bin;
  }
  throw new Error("binaire esbuild introuvable");
}

const esbuild = findEsbuild();
const out = join(mkdtempSync(join(tmpdir(), "ximacraft-bench-")), "bench.mjs");
const entry = join(here, "bench-perf.ts");

console.log("Bundling benchmark with esbuild...");
execFileSync(esbuild, [entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${out}`], {
  stdio: "inherit",
});

console.log("Running...");
execFileSync(process.execPath, ["--expose-gc", out], { stdio: "inherit" });
