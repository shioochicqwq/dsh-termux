#!/usr/bin/env node
/**
 * verify-package.mjs <package-dir> <expected-version>
 * Structural + patch-marker gate for the Termux package.
 */
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NODE_RANGE } from "./target.mjs";

const [root, expectedVersion] = process.argv.slice(2);
if (!root || !expectedVersion) throw new Error("usage: verify-package.mjs <dir> <version>");

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.name !== "dsh-termux" || manifest.version !== expectedVersion) {
  throw new Error(`unexpected package identity ${manifest.name}@${manifest.version}`);
}
if (manifest.engines?.node !== NODE_RANGE || manifest.os?.join() !== "android" || manifest.cpu?.join() !== "arm64") {
  throw new Error("unexpected Node or platform requirements");
}
if (!Array.isArray(manifest.bundledDependencies) || manifest.bundledDependencies.length === 0 ||
    manifest.bundledDependencies.join("\n") !== Object.keys(manifest.dependencies).join("\n")) {
  throw new Error("bundledDependencies must match dependencies");
}

// The source-only gate is useful on Linux. The build always invokes full verification.
const mode = process.argv[4];
if (mode !== undefined && mode !== "--source-only") throw new Error(`unknown verification mode: ${mode}`);
const nativeFiles = [
  "node_modules/node-pty/prebuilds/android-arm64/pty.node",
  "node_modules/node-pty/build/Release/pty.node",
  "node_modules/koffi/build/koffi/android_arm64/koffi.node",
];
const required = [
  "lib/bin.js",
  ...(mode === "--source-only" ? [] : nativeFiles),
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
  ["node_modules/@deepseek-ai/dsh-session-persistence-sqlite/lib/index.js", "await copyFile(temporary, path, fsConstants.COPYFILE_EXCL)"],
  ["node_modules/@deepseek-ai/node-addon-system/lib/flock.js", "platform === 'android'"],
  ["node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js", "resolveBashShell"],
  ["node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js", "process.env.PREFIX"],
  ["node_modules/@deepseek-ai/dsh-util-ripgrep/lib/index.js", "Termux ripgrep not found"],
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
console.log(`verified dsh-termux@${expectedVersion}${mode === "--source-only" ? " (source and metadata only; no native artifact check)" : ""}`);
console.log(`  shebang: ${shebang}`);
console.log(`  native-related packages: ${[...versions].map(([k, v]) => `${k}@${v}`).join(", ")}`);
