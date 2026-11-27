import assert from "node:assert/strict";
import test from "node:test";
import { assertUpstream, NODE_RANGE, supportsNode, UPSTREAM_VERSION } from "./target.mjs";

test("Node engine range respects both lower bounds, the gap and prereleases", () => {
  for (const version of ["v24.22.3", "24.23.0", "26.13.1", "27.0.0", "26.13.1+build.1"]) {
    assert.equal(supportsNode(version), true, version);
  }
  for (const version of ["24.22.2", "25.99.0", "26.13.0", "24.22.3-rc.1", "26.13.1-alpha", "27.0.0-alpha", "v24.022.3"]) {
    assert.equal(supportsNode(version), false, version);
  }
});

test("staging rejects an unexpected upstream package, version or engine contract", () => {
  const manifest = { name: "@deepseek-ai/dsh", version: UPSTREAM_VERSION, engines: { node: NODE_RANGE } };
  assert.doesNotThrow(() => assertUpstream(manifest));
  assert.throws(() => assertUpstream({ ...manifest, name: "dsh-termux" }));
  assert.throws(() => assertUpstream({ ...manifest, version: "0.2.1-rc.4" }));
  assert.throws(() => assertUpstream({ ...manifest, engines: { node: ">=24" } }));
});
