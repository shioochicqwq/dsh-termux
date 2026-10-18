#!/usr/bin/env node
/**
 * patch-021.mjs — Android/Termux source patches for @deepseek-ai/dsh 0.2.1-rc.2.
 * Run against the assembled Termux package dir (has lib/bin.js + node_modules/).
 * Every replacement asserts an exact match count.
 * Derived from sunflower2333/dsh-android scripts/patch-dsh.mjs (MIT),
 * Vengisk/deepseek-harness-termux patches, rebased onto 0.2.1-rc.2.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: patch-021.mjs <dsh-package-directory>");

const applied = [];
async function replaceOnce(relativePath, before, after, label) {
  const filename = join(root, relativePath);
  const source = await readFile(filename, "utf8");
  const matches = source.split(before).length - 1;
  if (matches !== 1) throw new Error(`${label}: expected exactly one match in ${relativePath}, found ${matches}`);
  await writeFile(filename, source.replace(before, after));
  applied.push(label);
  console.log(`patched: ${label}`);
}

// 1. koffi statx fallback on Android
const koffiPath = "node_modules/koffi/lib/native/base/base.cc";
const koffiSource = await readFile(join(root, koffiPath), "utf8");
const koffiVariants = [
  ["#if defined(__linux__)\n    const char *pathname = filename;",
   "#if defined(__linux__) && !defined(__ANDROID__)\n    const char *pathname = filename;"],
  ["#if defined(__linux__) && defined(STATX_TYPE) && !defined(CORE_NO_STATX)\n    const char *pathname = filename;",
   "#if defined(__linux__) && !defined(__ANDROID__) && defined(STATX_TYPE) && !defined(CORE_NO_STATX)\n    const char *pathname = filename;"],
  ["#if defined(__linux__) && defined(STATX_TYPE)\n    {\n        const char *pathname = filename;",
   "#if defined(__linux__) && !defined(__ANDROID__) && defined(STATX_TYPE)\n    {\n        const char *pathname = filename;"],
];
const koffiMatches = koffiVariants.filter(([before]) => koffiSource.split(before).length - 1 === 1);
if (koffiMatches.length !== 1) throw new Error(`koffi: expected exactly one known statx condition, found ${koffiMatches.length}`);
await writeFile(join(root, koffiPath), koffiSource.replace(...koffiMatches[0]));
applied.push("koffi statx"); console.log("patched: koffi: fstatat fallback on Android");

// 2. koffi: disable posix_spawn helper below API 28
await replaceOnce(koffiPath,
`bool ExecuteCommandLine(const char *cmd_line, const ExecuteInfo &info,
                        FunctionRef<Span<const uint8_t>()> in_func,
                        FunctionRef<void(Span<uint8_t> buf)> out_func, int *out_code)
{
    BlockAllocator temp_alloc;`,
`bool ExecuteCommandLine(const char *cmd_line, const ExecuteInfo &info,
                        FunctionRef<Span<const uint8_t>()> in_func,
                        FunctionRef<void(Span<uint8_t> buf)> out_func, int *out_code)
{
#if defined(__ANDROID__) && __ANDROID_API__ < 28
    errno = ENOSYS;
    return false;
#else
    BlockAllocator temp_alloc;`,
"koffi: disable command execution below Android API 28");

// 3. koffi: close that guard
await replaceOnce(koffiPath,
`    return true;
}

#endif

bool ExecuteCommandLine(const char *cmd_line, const ExecuteInfo &info,`,
`    return true;
#endif
}

#endif

bool ExecuteCommandLine(const char *cmd_line, const ExecuteInfo &info,`,
"koffi: close Android command execution guard");

// 4. koffi: unresolved Node-API symbols OK at link time
await replaceOnce("node_modules/koffi/src/koffi/CMakeLists.txt",
"    target_link_options(koffi PRIVATE -Wl,--gc-sections)",
`    target_link_options(koffi PRIVATE -Wl,--gc-sections)
    if(ANDROID)
        target_link_options(koffi PRIVATE -Wl,--unresolved-symbols=ignore-all)
    endif()`,
"koffi: resolve Node-API symbols at module load time on Android");

// 5. session-persistence-jsonl: no link(2) on Android
const spPath = "node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js";
const spSource = await readFile(join(root, spPath), "utf8");
const spImportVariants = [
  ['import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
   'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";'],
  ['import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
   'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";'],
];
const spImportMatches = spImportVariants.filter(([before]) => spSource.split(before).length - 1 === 1);
if (spImportMatches.length !== 1) throw new Error(`session persistence: known import not found (${spImportMatches.length})`);
await writeFile(join(root, spPath), spSource.replace(...spImportMatches[0]));
applied.push("sp import"); console.log("patched: session persistence: import rename");

await replaceOnce(spPath,
"\t\t\tawait link(tmp, finalPath);",
'\t\t\tif (process.platform === "android") await rename(tmp, finalPath);\n\t\t\telse await link(tmp, finalPath);',
"session persistence: publish with rename on Android");

await replaceOnce(spPath,
"\t\tawait internals.fs.link(staged, currentPath);",
'\t\tif (internals.platform === "android") await rename(staged, currentPath);\n\t\telse await internals.fs.link(staged, currentPath);',
"session persistence: migrate with rename on Android");

// 6. terminal-bash: resolve a real shell binary
const tbPath = "node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js";
await replaceOnce(tbPath,
'import { ENCODING_PREAMBLE, resolvePwshPath } from "@deepseek-ai/dsh-pwsh-local";',
'import { ENCODING_PREAMBLE, resolvePwshPath } from "@deepseek-ai/dsh-pwsh-local";\nimport { existsSync } from "node:fs";',
"terminal-bash: import existsSync");
await replaceOnce(tbPath,
'/** Bash dialect default executable. */\nconst DEFAULT_BASH_SHELL = "/bin/bash";',
`/** Bash dialect default executable. */
const DEFAULT_BASH_SHELL = "/bin/bash";
/** Shell candidates probed when no explicit shellPath is configured (Termux first). */
const BASH_SHELL_CANDIDATES = [
	process.env.DSH_BASH_SHELL,
	"/data/data/com.termux/files/usr/bin/bash",
	"/bin/bash"
];
/** Resolve the bash dialect default the way the host can actually execute it. */
function resolveBashShell() {
	for (const candidate of BASH_SHELL_CANDIDATES) {
		if (typeof candidate !== "string" || candidate.length === 0) continue;
		if (existsSync(candidate)) return candidate;
	}
	return DEFAULT_BASH_SHELL;
}`,
"terminal-bash: shell candidate probing");
await replaceOnce(tbPath,
': shellDialect === "pwsh" ? resolvePwshPath() : DEFAULT_BASH_SHELL,',
': shellDialect === "pwsh" ? resolvePwshPath() : resolveBashShell(),',
"terminal-bash: use resolved shell on Android");

// 7. tool-fs-search: system ripgrep fallback on Android
await replaceOnce("node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js",
'\t\tif ("pkg" in process && existsSync(executableSidecar)) return executableSidecar;\n\t\tconst dependency = (await import("@vscode/ripgrep")).rgPath;',
`\t\tif ("pkg" in process && existsSync(executableSidecar)) return executableSidecar;
		const systemRipgrep = process.platform === "android" ? process.env.DSH_RG_PATH ?? "/data/data/com.termux/files/usr/bin/rg" : process.env.DSH_RG_PATH;
		if (typeof systemRipgrep === "string" && systemRipgrep.length > 0 && existsSync(systemRipgrep)) return systemRipgrep;
		const dependency = (await import("@vscode/ripgrep")).rgPath;`,
"tool-fs-search: system ripgrep fallback on Android");

// 8. HMR guard, only if the launcher still ships the patch-file watcher
const libFiles = await readdir(join(root, "lib"));
const profileBootMatches = [];
for (const name of libFiles) {
  if (!/^profile-boot-.*\.js$/.test(name)) continue;
  const source = await readFile(join(root, "lib", name), "utf8");
  if (source.includes("watchUserPatches(ctx")) profileBootMatches.push(join("lib", name));
}
if (profileBootMatches.length > 1) throw new Error(`HMR patch: expected one impl chunk, found ${profileBootMatches.length}`);
if (profileBootMatches.length === 1) {
  await replaceOnce(profileBootMatches[0],
`\t\tif (ctx.get("hmr") === void 0) {`,
`\t\tif (ctx.get("hmr") === void 0 && process.execArgv.includes("--expose-internals")) {`,
"dsh: skip HMR without --expose-internals");
} else {
  console.log("skipped: HMR patch — 0.2.1 launcher has no patch-file watcher");
}

// 9. node-addon-require-builtin: pure-JS bridge to Node internals
const requireBuiltinPath = "node_modules/node-addon-require-builtin/lib/index.js";
await writeFile(join(root, requireBuiltinPath), `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireBuiltin = requireBuiltin;
exports.isAllowedInternalId = isAllowedInternalId;
exports.getBindingInfo = getBindingInfo;
const node_module_1 = require("node:module");
/**
 * Pure-JS stand-in for the native \`node-addon-require-builtin\` binding.
 *
 * Upstream reads Node's internal modules through a N-API addon that ships no
 * Android/arm64 build and publishes no source. Termux runs the harness with
 * \`--expose-internals\`, which makes \`require("internal/...")\` legal, so this
 * shim forwards to Node's own internal loader instead of a native binding.
 */
const internalRequire = (0, node_module_1.createRequire)(__filename);
function requireBuiltin(moduleId) {
    return internalRequire(moduleId);
}
function isAllowedInternalId(moduleId) {
    return typeof moduleId === "string";
}
function getBindingInfo() {
    return {
        mode: "expose-internals",
        product: "node-addon-require-builtin",
        backend: "napi",
        abi: "napi-v9"
    };
}
exports.default = { requireBuiltin, isAllowedInternalId, getBindingInfo };
`);
applied.push("require-builtin shim");
console.log("patched: require-builtin: expose-internals shim");

// 10. lib/bin.js: launch node with --expose-internals (required by that shim
//     and by the internal-module interception the 0.2.x boot performs)
const binPath = "lib/bin.js";
const binSource = await readFile(join(root, binPath), "utf8");
if (!binSource.startsWith("#!")) throw new Error("bin.js: missing shebang");
if (!binSource.includes("--expose-internals")) {
	const [shebang, ...rest] = binSource.split("\n");
	const launcher = process.env.DSH_NODE_BIN ?? "/data/data/com.termux/files/usr/bin/node";
	await writeFile(join(root, binPath), `#!${launcher} --expose-internals\n${rest.join("\n")}`);
	applied.push("bin.js shebang");
	console.log("patched: lib/bin.js: node --expose-internals");
} else {
	console.log("skipped: lib/bin.js shebang already carries --expose-internals");
}

console.log(`\npatch summary: ${applied.length} edits applied`);
