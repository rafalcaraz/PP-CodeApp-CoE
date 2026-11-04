import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

function readJsonElement(xml, name) {
  const matches = [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))];
  assert.equal(matches.length, 1, `Expected exactly one app ${name} element; use a single-app metadata file.`);
  const json = matches[0][1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#([0-9]+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&amp;/g, "&");
  return JSON.parse(json);
}

export function verifyCodeAppExport(xml, config) {
  const actual = readJsonElement(xml, "ConnectionReferences");
  const cds = readJsonElement(xml, "CdsDependencies");
  const expected = config.connectionReferences;
  assert.ok(expected && Object.keys(expected).length > 0, "Expected configuration must contain app connections.");
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), "App connection keys changed.");
  const reverseDependencies = Object.fromEntries(Object.keys(expected).map((key) => [key, []]));
  const cdsNames = new Set(cds.cdsdependencies
    .filter((dependency) => Number(dependency.componenttype) === 10156)
    .map((dependency) => dependency.logicalname));
  const missingLogical = Object.entries(expected)
    .filter(([key, ref]) => ref.xrmConnectionReferenceLogicalName
      && actual[key]?.xrmConnectionReferenceLogicalName !== ref.xrmConnectionReferenceLogicalName)
    .map(([, ref]) => ref.xrmConnectionReferenceLogicalName);
  const missingHttpDependencies = Object.values(expected)
    .filter((ref) => ref.id.toLowerCase().endsWith("/shared_webcontents")
      && !cdsNames.has(ref.xrmConnectionReferenceLogicalName))
    .map((ref) => ref.xrmConnectionReferenceLogicalName);
  assert.ok(missingLogical.length === 0 && missingHttpDependencies.length === 0,
    `Nonportable app registration: ${missingLogical.length} missing/changed logical references [${missingLogical.join(", ")}]; `
    + `${missingHttpDependencies.length} missing HTTP solution dependencies [${missingHttpDependencies.join(", ")}]. `
    + "Republish the source app with the connection-safe adapter and export again; do not repair the ZIP by hand.");
  for (const [key, reference] of Object.entries(expected)) {
    const exported = actual[key];
    assert.equal(exported.id.toLowerCase(), reference.id.toLowerCase(), `Connector identity changed for ${key}.`);
    assert.deepEqual(
      [...(exported.dataSources ?? [])].sort(),
      [...(reference.dataSources ?? [])].sort(),
      `Data sources changed for ${key}.`,
    );
    if (reference.xrmConnectionReferenceLogicalName) {
      assert.equal(
        exported.xrmConnectionReferenceLogicalName,
        reference.xrmConnectionReferenceLogicalName,
        `Logical reference missing or changed for ${key}.`,
      );
    }
    if (reference.id.toLowerCase().endsWith("/shared_webcontents")) {
      assert.ok(reference.xrmConnectionReferenceLogicalName, `Expected HTTP reference missing for ${key}.`);
      assert.ok(cdsNames.has(reference.xrmConnectionReferenceLogicalName), `HTTP solution dependency missing for ${key}.`);
      assert.ok(!exported.sharedConnectionId?.includes("<"), `Export contains a placeholder HTTP binding for ${key}.`);
    }
    const dependencies = reference.workflowDetails?.dependencies ?? {};
    const targets = [...new Set(Object.values(dependencies))];
    assert.deepEqual([...(exported.dependencies ?? [])].sort(), targets.sort(), `Flow dependencies changed for ${key}.`);
    if (reference.workflowDetails) {
      assert.equal(
        exported.parameterHintsV2?.workflowEntityId?.value,
        reference.workflowDetails.workflowEntityId,
        `Workflow identity changed for ${key}.`,
      );
      const aliases = Object.keys(exported.parameterHintsV2 ?? {})
        .filter((name) => !["workflowEntityId", "workflowDisplayName", "workflowName"].includes(name));
      assert.deepEqual(aliases.sort(), Object.keys(dependencies).sort(), `Invoker aliases changed for ${key}.`);
    }
    for (const [alias, target] of Object.entries(dependencies)) {
      assert.ok(expected[target] && !expected[target].workflowDetails, `Invalid expected connector dependency for ${key}.`);
      assert.equal(exported.parameterHintsV2?.[alias]?.value, target, `Invoker mapping changed for ${key}.`);
    }
    for (const target of targets) reverseDependencies[target].push(key);
  }
  for (const [key, dependents] of Object.entries(reverseDependencies)) {
    assert.deepEqual([...(actual[key].dependents ?? [])].sort(), dependents.sort(), `Reverse dependencies changed for ${key}.`);
  }
}

export function verifySolutionDirectory(directory, config) {
  const appDirectory = path.join(directory, "CanvasApps");
  const files = readdirSync(appDirectory).filter((name) => name.endsWith(".meta.xml"));
  assert.equal(files.length, 1, "Expected exactly one exported Code App metadata file.");
  verifyCodeAppExport(readFileSync(path.join(appDirectory, files[0]), "utf8"), config);
}

function main() {
  const { values } = parseArgs({
    options: { xml: { type: "string" }, config: { type: "string" } },
  });
  if (!values.xml) {
    throw new Error("Usage: node scripts/verify-code-app-export.mjs --xml <exported-customizations-or-app-meta.xml> [--config <modern-power.config.json>]");
  }
  const configPath = values.config ?? fileURLToPath(new URL("../PP-CoE-CodeApp/power.config.json", import.meta.url));
  verifyCodeAppExport(readFileSync(values.xml, "utf8"), JSON.parse(readFileSync(configPath, "utf8")));
  console.log("Export verified: logical references, HTTP solution dependencies and complete flow dependency graph match the app configuration.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Export verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
