// Keep the staging target and its Node contract in sync with the published npm manifest.
export const UPSTREAM_VERSION = "0.2.3-alpha.2";
export const NODE_RANGE = "^24.22.3 || >=26.13.1";

export function supportsNode(version) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) return false; // Neither branch of the range admits prereleases.
  const [major, minor, patch] = match.slice(1).map(Number);
  return (major === 24 && (minor > 22 || (minor === 22 && patch >= 3))) ||
    major > 26 || (major === 26 && (minor > 13 || (minor === 13 && patch >= 1)));
}

export function assertUpstream(manifest) {
  if (manifest.name !== "@deepseek-ai/dsh" || manifest.version !== UPSTREAM_VERSION || manifest.engines?.node !== NODE_RANGE) {
    throw new Error(`expected @deepseek-ai/dsh@${UPSTREAM_VERSION} with Node ${NODE_RANGE}; found ${manifest.name}@${manifest.version} (${manifest.engines?.node})`);
  }
}
