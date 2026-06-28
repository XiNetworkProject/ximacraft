/**
 * Lance les tests headless de l'atlas météo (logique pure).
 *
 * Il n'y a pas de runner TS dans le projet (build = `tsc && vite build`). On
 * réutilise l'esbuild embarqué par Vite pour bundler le test (résolution des
 * imports sans extension + suppression des enums TS), puis on exécute avec Node.
 *
 *   node scripts/run-weather-tests.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Trouve le binaire esbuild embarqué (le dossier @esbuild a un suffixe variable). */
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
const out = join(mkdtempSync(join(tmpdir(), "weather-test-")), "weather.test.mjs");
const entry = join(here, "weather.test.ts");

console.log("Bundling weather atlas tests with esbuild...");
execFileSync(esbuild, [entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${out}`], {
  stdio: "inherit",
});

console.log("Running...");
try {
  execFileSync(process.execPath, [out], { stdio: "inherit" });
} catch {
  process.exit(1);
}
