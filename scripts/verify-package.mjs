#!/usr/bin/env node
/**
 * verify-package.mjs <package-dir> <expected-version>
 * Structural + patch-marker gate for the Termux package.
 */
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const [root, expectedVersion] = process.argv.slice(2);
if (!root || !expectedVersion) throw new Error("usage: verify-package.mjs <dir> <version>");

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.name !== "dsh-termux" || manifest.version !== expectedVersion) {
  throw new Error(`unexpected package identity ${manifest.name}@${manifest.version}`);
}
if (!Array.isArray(manifest.bundledDependencies) || manifest.bundledDependencies.length === 0) {
  throw new Error("bundledDependencies missing");
}

const required = [
  "lib/bin.js",
  "node_modules/node-pty/prebuilds/android-arm64/pty.node",
  "node_modules/node-pty/build/Release/pty.node",
  "node_modules/koffi/build/koffi/android_arm64/koffi.node",
  "node_modules/@img/sharp-wasm32/lib",
  "node_modules/@emnapi/runtime",
];
for (const relativePath of required) await access(join(root, relativePath));

const markers = [
  ["node_modules/koffi/lib/native/base/base.cc", "defined(__ANDROID__)"],
  ["node_modules/koffi/lib/native/base/base.cc", "__ANDROID_API__ < 28"],
  ["node_modules/koffi/src/koffi/CMakeLists.txt", "--unresolved-symbols=ignore-all"],
  ["node_modules/@deepseek-ai/dsh-fs-local/lib/index.js", "publishNewFile"],
  ["node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js", "publishLinkOrCopy"],
  ["node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js", "durability walk tops out"],
  ["node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js", "async function publishExclusive"],
  ["node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js", "await publishExclusive(tmp, finalPath)"],
  ["node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js", "await publishExclusive(staged, currentPath, internals.fs.link)"],
  ["node_modules/@deepseek-ai/node-addon-system/lib/flock.js", "platform === 'android'"],
  ["node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js", "resolveBashShell"],
  ["node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js", "process.env.PREFIX"],
  ["node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js", "systemRipgrep"],
  ["node_modules/node-addon-require-builtin/lib/index.js", "expose-internals"],
];
for (const [relativePath, needle] of markers) {
  const source = await readFile(join(root, relativePath), "utf8");
  if (!source.includes(needle)) throw new Error(`missing patch marker ${JSON.stringify(needle)} in ${relativePath}`);
}

const binSource = await readFile(join(root, "lib/bin.js"), "utf8");
const shebang = binSource.split("\n")[0];
if (!shebang.startsWith("#!") || !shebang.includes("--expose-internals")) {
  throw new Error(`unexpected bin.js shebang: ${shebang}`);
}

const versions = new Map();
for (const name of ["node-pty", "koffi", "sharp", "@img/sharp-wasm32", "node-addon-require-builtin"]) {
  const pkg = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
  versions.set(name, pkg.version);
}
console.log(`verified dsh-termux@${expectedVersion}`);
console.log(`  shebang: ${shebang}`);
console.log(`  natives: ${[...versions].map(([k, v]) => `${k}@${v}`).join(", ")}`);
