import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyCodeAppExport } from "./verify-code-app-export.mjs";

const config = JSON.parse(readFileSync(new URL("../PP-CoE-CodeApp/power.config.json", import.meta.url), "utf8"));
const workflowDir = new URL("../solution/src/Workflows/", import.meta.url);
const workflowFiles = readdirSync(workflowDir).filter((name) => name.endsWith(".json"));

for (const flow of Object.values(config.connectionReferences).filter((ref) => ref.workflowDetails)) {
  const { workflowEntityId, workflowDisplayName, dependencies = {} } = flow.workflowDetails;
  test(`${workflowDisplayName} maps every invoker connection to its solution reference`, () => {
    const file = workflowFiles.find((name) => name.toLowerCase().includes(workflowEntityId.toLowerCase()));
    assert.ok(file, `No exported workflow definition for ${workflowDisplayName}`);
    const workflow = JSON.parse(readFileSync(new URL(file, workflowDir), "utf8"));
    const invokers = Object.entries(workflow.properties.connectionReferences)
      .filter(([, ref]) => ref.runtimeSource?.toLowerCase() === "invoker");

    for (const [alias, ref] of invokers) {
      assert.ok(dependencies[alias], `Missing dependency mapping for ${alias}`);
      const dependency = config.connectionReferences[dependencies[alias]];
      assert.ok(dependency, `Dependency ${alias} points to a missing app connection`);
      assert.equal(dependency.xrmConnectionReferenceLogicalName, ref.connection.connectionReferenceLogicalName);
      assert.equal(dependency.id.toLowerCase().split("/").at(-1), ref.api.name.toLowerCase());
    }
    assert.deepEqual(Object.keys(dependencies).sort(), invokers.map(([alias]) => alias).sort());
  });
}

test("direct Graph calls retain their dedicated logical connection reference", () => {
  const graph = Object.values(config.connectionReferences).find((ref) => ref.dataSources?.includes("webcontents"));
  assert.ok(graph, "Missing direct Graph data source");
  assert.equal(graph.xrmConnectionReferenceLogicalName, "msftcsa_HTTPEntraPreAuthGraph");
});

test("PP API wrapper preserves HTTP status, headers and binary body in its string response", () => {
  const file = workflowFiles.find((name) => name.startsWith("PP-API-Wrapper-Flow-"));
  assert.ok(file);
  const { actions } = JSON.parse(readFileSync(new URL(file, workflowDir), "utf8")).properties.definition;
  assert.equal(actions.Main.actions.Set_variable.inputs.value, "@string(outputs('Invoke_an_HTTP_request'))");
  assert.ok(actions.Set_variable_1.inputs.value.includes("outputs('Invoke_an_HTTP_request')"));
  assert.ok(actions.Set_variable_1.inputs.value.includes('"error":"PP-API HTTP action failed'));
  assert.deepEqual(actions.Set_variable_1.runAfter.Main, ["TimedOut", "Failed"]);
  assert.equal(actions.Respond_to_a_Power_App_or_flow.inputs.body.response, "@{variables('response')}");
});

test("three HTTP audiences have distinct solution references with their documented endpoints", () => {
  const customizations = readFileSync(new URL("../solution/src/Other/Customizations.xml", import.meta.url), "utf8");
  for (const [logicalName, audience] of [
    ["msftcsa_HTTPEntraPreAuthGraph", "https://graph.microsoft.com"],
    ["msftcsa_PPLicensingAPI", "https://licensing.powerplatform.microsoft.com"],
    ["msftcsa_HTTPWithEntraPPAPI", "https://api.powerplatform.com"],
  ]) {
    const references = Object.values(config.connectionReferences)
      .filter((ref) => ref.xrmConnectionReferenceLogicalName === logicalName);
    assert.equal(references.length, 1);
    assert.ok(references[0].id.toLowerCase().endsWith("/shared_webcontents"));
    const definition = customizations.match(new RegExp(
      `<connectionreference connectionreferencelogicalname="${logicalName}">([\\s\\S]*?)</connectionreference>`,
    ));
    assert.ok(definition, `Missing solution connection reference ${logicalName}`);
    assert.ok(definition[1].includes(`<description>Use ${audience}</description>`));
  }
});

test("credit report generation flow returns the initial operation location with the registered input order", () => {
  const file = workflowFiles.find((name) => name.startsWith("PP-Request-Credit-Licensing-Report-"));
  assert.ok(file);
  const { actions } = JSON.parse(readFileSync(new URL(file, workflowDir), "utf8")).properties.definition;
  const generate = actions["Main-Op"].actions.Generate_Licensing_Report;
  assert.equal(generate.operationOptions, "DisableAsyncPattern");
  assert.deepEqual(generate.inputs.parameters, {
    ReportName: "@triggerBody()['text']",
    "api-version": "2024-10-01",
    "body/endDate": "@triggerBody()['text_1']",
    "body/startDate": "@triggerBody()['text_2']",
    "body/granularity": "@triggerBody()['text_3']",
  });
  assert.equal(actions["Main-Op"].actions["Set-Location"].inputs.value,
    "@{coalesce(outputs('Generate_Licensing_Report')?['headers']?['Location'],outputs('Generate_Licensing_Report')?['headers']?['location'])}");
  assert.equal(actions.Respond_to_a_Power_App_or_flow.inputs.body.reportlocation, "@variables('reportLocation')");
});

test("credit report download flow returns the CSV body as the registered result text", () => {
  const file = workflowFiles.find((name) => name.startsWith("PP-Download-Credit-Licensing-Report-"));
  assert.ok(file);
  const { actions } = JSON.parse(readFileSync(new URL(file, workflowDir), "utf8")).properties.definition;
  assert.deepEqual(actions.Main.actions.DownloadReport.inputs.parameters, {
    ReportName: "@triggerBody()['text']",
    FileName: "@triggerBody()['text_1']",
    "api-version": "2024-10-01",
  });
  assert.equal(actions.Main.actions.Set_variable.inputs.value, "@{string(body('DownloadReport'))}");
  assert.equal(actions.Respond_to_a_Power_App_or_flow.inputs.body.result, "@variables('result')");
});

test("tracked app metadata preserves configured logical references and flow mappings without source connection IDs", () => {
  const directory = new URL("../solution/src/CanvasApps/", import.meta.url);
  const files = readdirSync(directory).filter((name) => name.endsWith(".meta.xml"));
  assert.equal(files.length, 1, "Expected the single configured Code App metadata file");
  const xml = readFileSync(new URL(files[0], directory), "utf8");
  verifyCodeAppExport(xml, config);
  assert.ok(!xml.includes("sharedConnectionId"), "Tracked metadata must not contain resolved connection IDs");
});
