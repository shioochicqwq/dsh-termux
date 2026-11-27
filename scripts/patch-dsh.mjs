#!/usr/bin/env node
/**
 * Android/Termux source patches for the pinned @deepseek-ai/dsh staging target.
 * Run against the assembled Termux package dir (has lib/bin.js + node_modules/).
 * Every replacement asserts an exact match count.
 * Derived from sunflower2333/dsh-android scripts/patch-dsh.mjs (MIT),
 * Vengisk/deepseek-harness-termux patches, rebased onto 0.2.1-rc.2 (unchanged for rc.4).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertUpstream } from "./target.mjs";

const root = process.argv[2];
if (!root) throw new Error("usage: patch-dsh.mjs <dsh-package-directory>");
assertUpstream(JSON.parse(await readFile(join(root, "package.json"), "utf8")));

// Validate every source match before writing any files to the fresh staging tree.
const applied = [];
const staged = new Map();
async function readSource(path) {
  return staged.get(path) ?? await readFile(join(root, path), "utf8");
}
function stage(path, source, label) {
  staged.set(path, source);
  applied.push(label);
}
async function replaceOnce(relativePath, before, after, label) {
  const source = await readSource(relativePath);
  const matches = source.split(before).length - 1;
  if (matches !== 1) throw new Error(`${label}: expected exactly one match in ${relativePath}, found ${matches}`);
  stage(relativePath, source.replace(before, () => after), label);
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
await replaceOnce(koffiPath, ...koffiMatches[0], "koffi: fstatat fallback on Android");

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

// 4b. fs-local: the no-replace publish path uses link(2), which some Android
//     sandboxes refuse (EACCES) — every write/edit creating a NEW file failed
//     with FS_IO_ERROR. Fall back to an exclusive copy, keeping the caller's
//     no-clobber contract (EEXIST when a concurrent writer won).
const fsLocalPath = "node_modules/@deepseek-ai/dsh-fs-local/lib/index.js";
const fsLocalImport = 'import { chmod, link, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";';
const fsLocalImportPatched = 'import { chmod, copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";';
await replaceOnce(fsLocalPath, fsLocalImport, fsLocalImportPatched, "fs-local: import copyFile");
await replaceOnce(
  fsLocalPath,
  "\tconst linkFile = internals.linkFile ?? link;",
  `\tconst linkFile = internals.linkFile ?? link;
\t/** Android: link(2) may be refused; publish with an exclusive copy instead. */
\tconst publishNewFile = async (from, to) => {
\t\ttry {
\t\t\tawait linkFile(from, to);
\t\t} catch (error) {
\t\t\tif (!["EACCES", "EPERM", "ENOSYS", "ENOTSUP", "EXDEV"].includes(error?.code)) throw error;
\t\t\tawait copyFile(from, to, 1 /* fs.constants.COPYFILE_EXCL */);
\t\t\tconst copied = await open(to, "r");
\t\t\ttry { await copied.sync(); } finally { await copied.close(); }
\t\t}
\t};`,
  "fs-local: exclusive-copy publish helper",
);
await replaceOnce(
  fsLocalPath,
  "\t\t\tawait linkFile(tempPath, absolutePath);",
  "\t\t\tawait publishNewFile(tempPath, absolutePath);",
  "fs-local: use the publish helper",
);

// 4c. attachment-local: staged objects and image aliases are published with
//     link(2) too, so attachments/read_image could not be stored on Android.
const attachPath = "node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js";
const attachImport = 'import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";';
const attachImportPatched = 'import { chmod, copyFile, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";';
await replaceOnce(attachPath, attachImport, attachImportPatched, "attachment-local: import copyFile");
await replaceOnce(
  attachPath,
  "async function publishImmutableAlias(",
  `/** Android: link(2) may be refused; alias with an exclusive copy (EEXIST stays the race signal). */
async function publishLinkOrCopy(from, to) {
\ttry {
\t\tawait link(from, to);
\t} catch (error) {
\t\tif (!["EACCES", "EPERM", "ENOSYS", "ENOTSUP", "EXDEV"].includes(error?.code)) throw error;
\t\tawait copyFile(from, to, 1 /* fs.constants.COPYFILE_EXCL */);
\t\tconst copied = await open(to, "r");
\t\ttry { await copied.sync(); } finally { await copied.close(); }
\t}
}
async function publishImmutableAlias(`,
  "attachment-local: exclusive-copy alias helper",
);
await replaceOnce(attachPath, "\t\t\tawait link(source, target);", "\t\t\tawait publishLinkOrCopy(source, target);", "attachment-local: alias publication");
await replaceOnce(attachPath, "\t\t\tawait link(staged.path, target);", "\t\t\tawait publishLinkOrCopy(staged.path, target);", "attachment-local: staged publication");

// 4d. attachment-local durability walk: fsync every ancestor directory, but
//     Android's untrusted_app domain cannot open("/data/data"), so the walk
//     threw before storing any attachment (read_image included). Skip ancestors
//     the sandbox refuses to open; still fsync everything we may.
await replaceOnce(
  attachPath,
  `async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	const handle = await open(path, constants.O_RDONLY);`,
  `async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY);
	} catch (error) {
		// Android's untrusted_app domain cannot open ancestors such as /data/data,
		// so the durability walk tops out there: fsync what we may, skip the rest.
		if (process.platform === "android" && (error?.code === "EACCES" || error?.code === "EPERM")) return;
		throw error;
	}`,
  "attachment-local: tolerate unopenable ancestors",
);

// 5. session-persistence-jsonl: exclusive publish without depending on link(2)
//    Upstream publishes with link(2) on purpose: it never overwrites, and EEXIST
//    tells the caller another writer won. Some Android sandboxes refuse link(2),
//    so fall back to copyFile(COPYFILE_EXCL) only when link itself is refused —
//    still no-clobber, still EEXIST on collision (a plain rename would silently
//    overwrite a concurrent writer's log).
const spPath = "node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js";
const spSource = await readFile(join(root, spPath), "utf8");
const spImportVariants = [
  'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
  'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
];
const spImportMatches = spImportVariants.filter((before) => spSource.split(before).length - 1 === 1);
if (spImportMatches.length !== 1) throw new Error(`session persistence: known import not found (${spImportMatches.length})`);
await replaceOnce(spPath, spImportMatches[0], `${spImportMatches[0].replace("{ link,", "{ copyFile, link,")}
/** Android: link(2) may be refused by the app sandbox; publish with an exclusive copy instead. */
async function publishExclusive(source, target, linkFn = link) {
	try {
		await linkFn(source, target);
	} catch (error) {
		if (!["EACCES", "EPERM", "ENOSYS", "ENOTSUP", "EXDEV"].includes(error?.code)) throw error;
		await copyFile(source, target, 1 /* fs.constants.COPYFILE_EXCL */);
		const copied = await open(target, "r");
		try { await copied.sync(); } finally { await copied.close(); }
	}
}`, "session persistence: exclusive publish helper");

await replaceOnce(spPath,
"\t\t\tawait link(tmp, finalPath);",
"\t\t\tawait publishExclusive(tmp, finalPath);",
"session persistence: materialize with exclusive publish");

await replaceOnce(spPath,
"\t\tawait internals.fs.link(staged, currentPath);",
"\t\tawait publishExclusive(staged, currentPath, internals.fs.link);",
"session persistence: migrate with exclusive publish");

// SQLite retains a durable no-clobber routing marker (not the database file).
// Keep its Windows and other POSIX paths unchanged, and preserve EEXIST.
const sqlitePath = "node_modules/@deepseek-ai/dsh-session-persistence-sqlite/lib/index.js";
await replaceOnce(sqlitePath,
  'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat } from "node:fs/promises";',
  'import { copyFile, link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat } from "node:fs/promises";\nimport { constants as fsConstants } from "node:fs";',
  "SQLite routing: import exclusive copy support");
await replaceOnce(sqlitePath,
  '\t\t\t\telse await link(temporary, path);',
  `\t\t\t\telse {
\t\t\t\t\ttry {
\t\t\t\t\t\tawait link(temporary, path);
\t\t\t\t\t} catch (error) {
\t\t\t\t\t\tif (process.platform !== "android" || !["EACCES", "EPERM", "ENOSYS", "ENOTSUP", "EXDEV"].includes(error?.code)) throw error;
\t\t\t\t\t\tawait copyFile(temporary, path, fsConstants.COPYFILE_EXCL);
\t\t\t\t\t\tconst copied = await open(path, "r");
\t\t\t\t\t\ttry { await copied.sync(); } finally { await copied.close(); }
\t\t\t\t\t}
\t\t\t\t}`,
  "SQLite routing: fall back to exclusive copy on Android");

// 5b. node-addon-system flock: the native binding ships linux/darwin only and
//     throws ERR_FLOCK_UNSUPPORTED_PLATFORM on Android, so every session write
//     lock (create, append) would fail. Bind libc flock(2) through koffi (already
//     compiled for Android in this package). LOCK_EX|LOCK_NB = 6; the binding
//     contract is "callback(0 | positive errno)" (flock.js calls getSystemErrorName(-errno)).
await replaceOnce("node_modules/@deepseek-ai/node-addon-system/lib/flock.js",
`    const { platform, arch } = process;
    if (platform !== 'linux' && platform !== 'darwin') {`,
`    const { platform, arch } = process;
    if (platform === 'android') {
        const koffi = createRequire(import.meta.url)('koffi');
        const flock = koffi.load('libc.so').func('int flock(int fd, int op)');
        binding = { tryLock(fd, callback) { const result = flock(fd, 6); callback(result === 0 ? 0 : koffi.errno()); } };
        return binding;
    }
    if (platform !== 'linux' && platform !== 'darwin') {`,
"node-addon-system: flock via koffi on Android");

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
	\`\${process.env.PREFIX ?? "/data/data/com.termux/files/usr"}/bin/bash\`,
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

// 7. The alpha moved ripgrep resolution out of tool-fs-search into a shared utility.
await replaceOnce("node_modules/@deepseek-ai/dsh-util-ripgrep/lib/index.js",
'\t\tif ("pkg" in process && existsSync(executableSidecar)) return executableSidecar;\n\t\tconst dependency = (await import("@vscode/ripgrep")).rgPath;',
`\t\tif ("pkg" in process && existsSync(executableSidecar)) return executableSidecar;
		if (process.platform === "android") {
			const systemRipgrep = process.env.DSH_RG_PATH ?? \`\${process.env.PREFIX ?? "/data/data/com.termux/files/usr"}/bin/rg\`;
			if (existsSync(systemRipgrep)) return systemRipgrep;
			throw new Error("Termux ripgrep not found: install it with pkg install ripgrep, or set DSH_RG_PATH");
		}
		if (process.env.DSH_RG_PATH && existsSync(process.env.DSH_RG_PATH)) return process.env.DSH_RG_PATH;
		const dependency = (await import("@vscode/ripgrep")).rgPath;`,
"tool-fs-search: system ripgrep fallback on Android");

// The alpha launcher no longer contains the legacy patch-file watcher.
// node-addon-require-builtin: pure-JS bridge to Node internals.
const requireBuiltinPath = "node_modules/node-addon-require-builtin/lib/index.js";
const requireBuiltinSource = await readSource(requireBuiltinPath);
const nativeLoader = "const api = createEntryApi(node_path_1.default.resolve(__dirname, '..'));";
if (requireBuiltinSource.split(nativeLoader).length - 1 !== 1) throw new Error("require-builtin: unexpected upstream native loader");
stage(requireBuiltinPath, `"use strict";
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
    if (!isAllowedInternalId(moduleId)) throw new TypeError("expected a Node internal module ID");
    return internalRequire(moduleId);
}
function isAllowedInternalId(moduleId) {
    return typeof moduleId === "string" && /^internal(?:\\/[a-zA-Z0-9_-]+)+$/.test(moduleId);
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
`, "require-builtin: expose-internals shim");

// lib/bin.js: --expose-internals must be a direct argument, not NODE_OPTIONS.
const launcher = process.env.DSH_NODE_BIN ?? "/data/data/com.termux/files/usr/bin/node";
if (!/^\/\S+$/.test(launcher)) throw new Error("DSH_NODE_BIN must be an absolute Node path without whitespace");
await replaceOnce("lib/bin.js", "#!/usr/bin/env node\n", `#!${launcher} --expose-internals\n`, "lib/bin.js: node --expose-internals");

for (const [path, source] of staged) await writeFile(join(root, path), source);
for (const label of applied) console.log(`patched: ${label}`);
console.log(`\npatch summary: ${applied.length} edits applied`);
