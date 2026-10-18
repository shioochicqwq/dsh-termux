#!/usr/bin/env node
/**
 * prepare-package.mjs <package-dir> <termux-version>
 * Renames the assembled tree into the `dsh-termux` npm package and marks every
 * installed package as bundled, so `npm i -g` never re-resolves or rebuilds.
 * (Adapted from sunflower2333/dsh-android, MIT.)
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [root, packageVersion] = process.argv.slice(2);
if (!root || !packageVersion) throw new Error("usage: prepare-package.mjs <dir> <version>");

const manifestPath = join(root, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.name = "dsh-termux";
manifest.version = packageVersion;
manifest.bin = { dsh: "lib/bin.js", "dsh-termux": "lib/bin.js" };
delete manifest.scripts;
delete manifest.devDependencies;
delete manifest.optionalDependencies;

const packageDirectories = [];
for (const entry of await readdir(join(root, "node_modules"), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === ".bin") continue;
  if (!entry.name.startsWith("@")) { packageDirectories.push(entry.name); continue; }
  for (const scoped of await readdir(join(root, "node_modules", entry.name), { withFileTypes: true })) {
    if (scoped.isDirectory()) packageDirectories.push(join(entry.name, scoped.name));
  }
}

const installed = [];
for (const directory of packageDirectories) {
  let dependency;
  try {
    dependency = JSON.parse(await readFile(join(root, "node_modules", directory, "package.json"), "utf8"));
  } catch {
    console.warn(`skip: ${directory} has no readable package.json`);
    continue;
  }
  if (typeof dependency.name !== "string" || typeof dependency.version !== "string") {
    throw new Error(`invalid installed package metadata in ${directory}`);
  }
  installed.push([dependency.name, dependency.version]);
}
installed.sort(([left], [right]) => left.localeCompare(right));

manifest.dependencies = Object.fromEntries(installed);
const dependencies = installed.map(([name]) => name);
for (const required of ["@img/sharp-wasm32", "@emnapi/runtime"]) {
  if (!dependencies.includes(required)) throw new Error(`package is missing required dependency ${required}`);
}
manifest.bundledDependencies = dependencies;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`prepared ${manifest.name}@${manifest.version} with ${dependencies.length} bundled dependencies`);
