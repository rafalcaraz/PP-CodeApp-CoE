import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { localConnectionBindings, resolveLocalBindings } from "../PP-CoE-CodeApp/scripts/localConnectionBindings.ts";

const config = () => ({
  environmentId: "synthetic-env",
  connectionReferences: {
    graph: {
      id: "/providers/Microsoft.PowerApps/apis/shared_webcontents",
      xrmConnectionReferenceLogicalName: "synthetic_Graph",
      sharedConnectionId: "/providers/Microsoft.PowerApps/apis/shared_webcontents/connections/<connection-id>",
      dataSources: ["webcontents"],
    },
    flow: { workflowDetails: { dependencies: { shared_webcontents: "graph" } } },
    custom: { id: "/providers/Microsoft.PowerApps/apis/shared_custom", xrmConnectionReferenceLogicalName: "synthetic_Custom", dataSources: ["custom"] },
  },
});
const bindings = () => ({
  environmentId: "synthetic-env",
  sharedConnections: { synthetic_Graph: "/providers/Microsoft.PowerApps/apis/shared_webcontents/connections/synthetic-connection" },
});

test("replaces only an existing private shared binding without modifying tracked config or aliases", () => {
  const original = config();
  const before = structuredClone(original);
  const resolved = resolveLocalBindings(original, bindings());
  assert.deepEqual(original, before);
  assert.equal(resolved.connectionReferences.graph.sharedConnectionId, bindings().sharedConnections.synthetic_Graph);
  assert.deepEqual(resolved.connectionReferences.flow, before.connectionReferences.flow);
  assert.deepEqual(resolved.connectionReferences.custom, before.connectionReferences.custom);
  assert.deepEqual(resolved.connectionReferences.graph.dataSources, ["webcontents"]);
});

test("rejects environment mismatch, secret fields, wrong connector and unresolved IDs", () => {
  for (const invalid of [
    { ...bindings(), environmentId: "other-env" },
    { ...bindings(), token: "synthetic-not-a-token" },
    { ...bindings(), sharedConnections: { synthetic_Graph: "/providers/Microsoft.PowerApps/apis/shared_custom/connections/synthetic" } },
    { ...bindings(), sharedConnections: { synthetic_Graph: config().connectionReferences.graph.sharedConnectionId } },
    { ...bindings(), sharedConnections: { synthetic_Graph: "/providers/Microsoft.PowerApps/apis/shared_webcontents/connections/synthetic/details" } },
  ]) assert.throws(() => resolveLocalBindings(config(), invalid));
});

test("cannot add a reference, pin an unshared custom connector or pick duplicate logical names", () => {
  for (const key of ["missing", "synthetic_Custom"]) {
    assert.throws(() => resolveLocalBindings(config(), { ...bindings(), sharedConnections: { [key]: "synthetic" } }));
  }
  const duplicate = config();
  duplicate.connectionReferences.secondGraph = structuredClone(duplicate.connectionReferences.graph);
  assert.throws(() => resolveLocalBindings(duplicate, bindings()));
});

test("base configuration stays portable and the private override is already gitignored", () => {
  const base = JSON.parse(readFileSync(new URL("../PP-CoE-CodeApp/power.config.json", import.meta.url), "utf8"));
  const http = Object.values(base.connectionReferences).filter((ref) => ref.id.toLowerCase().endsWith("/shared_webcontents"));
  assert.equal(http.length, 3);
  assert.ok(http.every((ref) => ref.sharedConnectionId.includes("<connection-id>")));
  assert.match(readFileSync(new URL("../PP-CoE-CodeApp/.gitignore", import.meta.url), "utf8"), /^\*\.local$/m);
});

test("dev-only middleware blocks raw bindings and invalid admission metadata instead of falling back", () => {
  const root = mkdtempSync(join(tmpdir(), "ppcoe-synthetic-bindings-"));
  try {
    writeFileSync(join(root, "power.config.json"), JSON.stringify(config()));
    writeFileSync(join(root, "power.bindings.local"), JSON.stringify(bindings()));
    let middleware;
    const errors = [];
    const plugin = localConnectionBindings();
    assert.equal(plugin.apply, "serve");
    plugin.configureServer({ config: { root, logger: { error: (message) => errors.push(message) } }, middlewares: { use: (handler) => { middleware = handler; } } });
    const request = (url) => {
      const headers = {};
      const response = { statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, end: (value) => { response.body = value; } };
      let forwarded = false;
      middleware({ url, method: "GET" }, response, () => { forwarded = true; });
      return { ...response, headers, forwarded };
    };
    const valid = request("/__vite_powerapps_plugin__/power.config.json");
    assert.equal(valid.forwarded, false);
    assert.equal(valid.headers["Cache-Control"], "no-store");
    assert.equal(JSON.parse(valid.body).connectionReferences.graph.sharedConnectionId, bindings().sharedConnections.synthetic_Graph);
    assert.equal(request("/power.bindings.local").statusCode, 404);
    assert.equal(request("/src/main.tsx").forwarded, true);
    writeFileSync(join(root, "power.bindings.local"), "{");
    const invalid = request("/__vite_powerapps_plugin__/power.config.json");
    assert.equal(invalid.statusCode, 503);
    assert.equal(invalid.forwarded, false);
    assert.match(invalid.body, /no fallback/);
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes("synthetic-connection"));
    rmSync(join(root, "power.bindings.local"));
    assert.equal(request("/__vite_powerapps_plugin__/power.config.json").forwarded, true);
  } finally {
    rmSync(root, { recursive: true });
  }
});
