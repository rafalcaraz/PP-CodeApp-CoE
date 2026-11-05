import assert from "node:assert/strict";
import { test } from "node:test";
import { toPacPublishConfig, validatePublishConfig } from "./prepare-code-app-publish.mjs";

function fixture() {
  return {
    connectionReferences: {
      graph: {
        id: "/providers/Microsoft.PowerApps/apis/shared_webcontents",
        xrmConnectionReferenceLogicalName: "test_Graph",
        sharedConnectionId: "/connections/test-graph",
        dataSources: ["webcontents"],
      },
      licensing: {
        id: "/providers/Microsoft.PowerApps/apis/shared_webcontents",
        xrmConnectionReferenceLogicalName: "test_Licensing",
        sharedConnectionId: "/connections/test-licensing",
      },
      flow: {
        id: "/providers/Microsoft.PowerApps/apis/shared_logicflows",
        workflowDetails: {
          workflowEntityId: "test-flow",
          workflowName: "test-flow",
          workflowDisplayName: "Licensing",
          dependencies: { "shared_webcontents-1": "licensing" },
        },
      },
    },
    databaseReferences: {
      "default.cds": {
        dataSources: { users: { entitySetName: "aadusers", logicalName: "aaduser" } },
        environmentVariableName: "",
      },
    },
  };
}

test("preserves logical references while translating flow dependencies for PAC", () => {
  const config = fixture();
  const original = structuredClone(config);
  const output = toPacPublishConfig(config);
  assert.deepEqual(config, original);
  assert.equal(output.connectionReferences.graph.xrmConnectionReferenceLogicalName, "test_Graph");
  assert.equal(output.connectionReferences.licensing.xrmConnectionReferenceLogicalName, "test_Licensing");
  assert.equal(output.connectionReferences.graph.sharedConnectionId, "/connections/test-graph");
  assert.deepEqual(output.connectionReferences.flow.dependencies, ["licensing"]);
  assert.deepEqual(output.connectionReferences.licensing.dependents, ["flow"]);
  assert.deepEqual(output.connectionReferences.graph.dependents, []);
  assert.deepEqual(output.connectionReferences.flow.parameterHintsV2["shared_webcontents-1"], { value: "licensing" });
  assert.deepEqual(output.connectionReferences.flow.parameterHints.workflowEntityId, { value: "test-flow" });
  assert.ok(!("workflowDetails" in output.connectionReferences.flow));
  assert.deepEqual(output.databaseReferences["default.cds"].dataSources, config.databaseReferences["default.cds"].dataSources);
  assert.equal(output.databaseReferences["default.cds"].databaseDetails.environmentName, "default.cds");
});

test("rejects unresolved or non-solution-aware HTTP bindings", () => {
  for (const binding of [undefined, "/connections/<connection-id>"]) {
    const config = fixture();
    config.connectionReferences.graph.sharedConnectionId = binding;
    assert.throws(() => toPacPublishConfig(config), /placeholder|resolved binding/);
  }
  const config = fixture();
  delete config.connectionReferences.graph.xrmConnectionReferenceLogicalName;
  assert.throws(() => toPacPublishConfig(config), /logical reference/);
});

test("rejects dangling dependencies and accidental flow-to-flow mappings", () => {
  for (const target of ["missing", "flow"]) {
    const config = fixture();
    config.connectionReferences.flow.workflowDetails.dependencies["shared_webcontents-1"] = target;
    assert.throws(() => toPacPublishConfig(config), /existing connector/);
  }
});

test("deduplicates graph edges while retaining every invoker alias", () => {
  const config = fixture();
  config.connectionReferences.flow.workflowDetails.dependencies.anotherAlias = "licensing";
  const { connectionReferences: refs } = toPacPublishConfig(config);
  assert.deepEqual(refs.flow.dependencies, ["licensing"]);
  assert.deepEqual(refs.licensing.dependents, ["flow"]);
  assert.deepEqual(refs.flow.parameterHintsV2.anotherAlias, { value: "licensing" });
});

test("private publish configuration may resolve bindings without changing registration", () => {
  const expected = fixture();
  const config = structuredClone(expected);
  config.connectionReferences.graph.sharedConnectionId = "/connections/source-graph";
  config.connectionReferences.flow.workflowDetails.workflowName = "export-created-runtime-name";
  validatePublishConfig(config, expected);
});

for (const [name, mutate] of [
  ["wrong app", (c) => { c.appId = "other-app"; }],
  ["wrong environment", (c) => { c.environmentId = "other-environment"; }],
  ["lost logical name", (c) => { delete c.connectionReferences.licensing.xrmConnectionReferenceLogicalName; }],
  ["lost flow dependency", (c) => { c.connectionReferences.flow.workflowDetails.dependencies = {}; }],
  ["stale workflow", (c) => { c.connectionReferences.flow.workflowDetails.workflowEntityId = "old-flow"; }],
  ["missing connector", (c) => { delete c.connectionReferences.graph; }],
  ["changed data source", (c) => { c.connectionReferences.graph.dataSources = ["different"]; }],
  ["changed Dataverse registration", (c) => { c.databaseReferences = {}; }],
  ["reused HTTP audience binding", (c) => {
    c.connectionReferences.licensing.sharedConnectionId = c.connectionReferences.graph.sharedConnectionId;
  }],
]) {
  test(`publish preparation rejects ${name} instead of publishing stale private metadata`, () => {
    const expected = fixture();
    const config = structuredClone(expected);
    mutate(config);
    assert.throws(() => validatePublishConfig(config, expected), /canonical|stale|distinct HTTP/);
  });
}
