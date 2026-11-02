import assert from "node:assert/strict";
import { test } from "node:test";
import { toPacPublishConfig } from "./prepare-code-app-publish.mjs";
import { verifyCodeAppExport } from "./verify-code-app-export.mjs";

function fixture() {
  const config = {
    connectionReferences: {
      http: {
        id: "/providers/Microsoft.PowerApps/apis/shared_webcontents",
        xrmConnectionReferenceLogicalName: "test_HTTP",
        sharedConnectionId: "/connections/test",
      },
      flow: {
        id: "/providers/Microsoft.PowerApps/apis/shared_logicflows",
        dataSources: ["wrapper"],
        workflowDetails: {
          workflowEntityId: "test-flow",
          workflowName: "test-flow",
          workflowDisplayName: "Wrapper",
          dependencies: { "shared_webcontents-1": "http" },
        },
      },
    },
  };
  return {
    config,
    refs: toPacPublishConfig(config).connectionReferences,
    cds: { cdsdependencies: [{ logicalname: "test_HTTP", componenttype: 10156 }] },
  };
}

function xml({ refs, cds }) {
  return `<ConnectionReferences>${JSON.stringify(refs)}</ConnectionReferences><CdsDependencies>${JSON.stringify(cds)}</CdsDependencies>`;
}

test("accepts valid exported metadata despite export-generated runtime IDs", () => {
  const f = fixture();
  f.refs.http.sharedConnectionId = "/connections/export-specific";
  f.refs.flow.parameterHints.workflowName.value = "export-specific-flow";
  f.refs.flow.parameterHintsV2.workflowName.value = "export-specific-flow";
  verifyCodeAppExport(xml(f), f.config);
  verifyCodeAppExport(xml(f).replaceAll('"', "&quot;"), f.config);
});

for (const [name, breakExport] of [
  ["dropped logical reference", (f) => { delete f.refs.http.xrmConnectionReferenceLogicalName; }],
  ["missing solution dependency", (f) => { f.cds.cdsdependencies = []; }],
  ["missing flow dependency", (f) => { f.refs.flow.dependencies = []; }],
  ["incorrect invoker alias", (f) => { f.refs.flow.parameterHintsV2["shared_webcontents-1"].value = "flow"; }],
  ["extra invoker alias", (f) => { f.refs.flow.parameterHintsV2.unexpected = { value: "http" }; }],
  ["lost reverse dependency", (f) => { f.refs.http.dependents = []; }],
  ["changed connector", (f) => { f.refs.http.id = "/apis/shared_other"; }],
  ["changed data source", (f) => { f.refs.flow.dataSources = ["different"]; }],
  ["changed workflow identity", (f) => { f.refs.flow.parameterHintsV2.workflowEntityId.value = "other"; }],
  ["placeholder connection", (f) => { f.refs.http.sharedConnectionId = "/connections/<connection-id>"; }],
  ["missing app connection", (f) => { delete f.refs.http; }],
]) {
  test(`rejects ${name}`, () => {
    const f = fixture();
    breakExport(f);
    assert.throws(() => verifyCodeAppExport(xml(f), f.config));
  });
}

test("rejects ambiguous or missing app metadata instead of passing another app", () => {
  const f = fixture();
  assert.throws(() => verifyCodeAppExport(xml(f) + xml(f), f.config), /exactly one/);
  assert.throws(() => verifyCodeAppExport("<Customizations />", f.config), /exactly one/);
});
