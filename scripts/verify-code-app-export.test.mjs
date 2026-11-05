import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { toPacPublishConfig } from "./prepare-code-app-publish.mjs";
import { verifyCodeAppExport, verifySolutionDirectory } from "./verify-code-app-export.mjs";

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
  ["wrong solution dependency component type", (f) => { f.cds.cdsdependencies[0].componenttype = 29; }],
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

function fullFixture() {
  const config = JSON.parse(readFileSync(new URL("../PP-CoE-CodeApp/power.config.json", import.meta.url), "utf8"));
  const resolved = structuredClone(config);
  for (const [key, ref] of Object.entries(resolved.connectionReferences)) {
    if (ref.sharedConnectionId) ref.sharedConnectionId = `/connections/fixture-${key}`;
  }
  return {
    config,
    refs: toPacPublishConfig(resolved).connectionReferences,
    cds: {
      cdsdependencies: Object.values(resolved.connectionReferences)
        .filter((ref) => ref.xrmConnectionReferenceLogicalName)
        .map((ref) => ({ logicalname: ref.xrmConnectionReferenceLogicalName, componenttype: 10156 })),
    },
  };
}

test("reports the recurring 11-connection export's seven missing names and three HTTP dependencies together", () => {
  const f = fullFixture();
  assert.equal(Object.keys(f.refs).length, 11);
  verifyCodeAppExport(xml(f), f.config);
  for (const ref of Object.values(f.refs)) delete ref.xrmConnectionReferenceLogicalName;
  const httpNames = Object.values(f.config.connectionReferences)
    .filter((ref) => ref.id.toLowerCase().endsWith("/shared_webcontents"))
    .map((ref) => ref.xrmConnectionReferenceLogicalName);
  f.cds.cdsdependencies = f.cds.cdsdependencies.filter((ref) => !httpNames.includes(ref.logicalname));
  assert.throws(() => verifyCodeAppExport(xml(f), f.config),
    /7 missing\/changed logical references.*3 missing HTTP solution dependencies/);
});

test("every logical reference is required, not just HTTP references", () => {
  const f = fullFixture();
  for (const [key, ref] of Object.entries(f.config.connectionReferences)) {
    if (!ref.xrmConnectionReferenceLogicalName) continue;
    const broken = structuredClone(f);
    delete broken.refs[key].xrmConnectionReferenceLogicalName;
    assert.throws(() => verifyCodeAppExport(xml(broken), broken.config), /1 missing\/changed logical references/);
  }
});

test("solution-directory gate validates exported metadata, not the tracked baseline", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ppcoe-export-test-"));
  try {
    mkdirSync(path.join(directory, "CanvasApps"));
    const metadata = path.join(directory, "CanvasApps", "fixture.meta.xml");
    const f = fullFixture();
    writeFileSync(metadata, xml(f));
    verifySolutionDirectory(directory, f.config);
    f.cds.cdsdependencies = [];
    writeFileSync(metadata, xml(f));
    assert.throws(() => verifySolutionDirectory(directory, f.config), /3 missing HTTP solution dependencies/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pack rejects broken source metadata before building or producing a ZIP", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ppcoe-pack-test-"));
  try {
    mkdirSync(path.join(directory, "scripts"));
    mkdirSync(path.join(directory, "PP-CoE-CodeApp"));
    mkdirSync(path.join(directory, "solution", "src", "CanvasApps"), { recursive: true });
    for (const name of ["pack-solution.mjs", "verify-code-app-export.mjs"]) {
      cpSync(new URL(name, import.meta.url), path.join(directory, "scripts", name));
    }
    const f = fullFixture();
    writeFileSync(path.join(directory, "PP-CoE-CodeApp", "power.config.json"), JSON.stringify(f.config));
    for (const ref of Object.values(f.refs)) delete ref.xrmConnectionReferenceLogicalName;
    writeFileSync(path.join(directory, "solution", "src", "CanvasApps", "fixture.meta.xml"), xml(f));
    const result = spawnSync(process.execPath, [path.join(directory, "scripts", "pack-solution.mjs")], {
      cwd: directory, encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /7 missing\/changed logical references/);
    assert.ok(!result.stdout.includes("npm"), "The gate must run before the build");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const pipeline of ["pull", "pack"]) {
  test(`${pipeline} gates the actual PAC-unpacked artifact before accepting it (simulated CLI)`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), `ppcoe-${pipeline}-gate-`));
    try {
      for (const folder of [
        ["scripts"], ["tools"], ["PP-CoE-CodeApp"], ["solution", "src", "CanvasApps"], ["solution", "src", "Other"],
      ]) {
        mkdirSync(path.join(directory, ...folder), { recursive: true });
      }
      for (const name of [`${pipeline}-solution.mjs`, "verify-code-app-export.mjs"]) {
        cpSync(new URL(name, import.meta.url), path.join(directory, "scripts", name));
      }
      const f = fullFixture();
      const goodXml = xml(f) + "<CodeAppPackageUris>old-bundle</CodeAppPackageUris>";
      const sourceMetadata = path.join(directory, "solution", "src", "CanvasApps", "fixture.meta.xml");
      writeFileSync(sourceMetadata, goodXml);
      writeFileSync(path.join(directory, "solution", "src", "Other", "Solution.xml"), "<Managed>0</Managed>");
      writeFileSync(path.join(directory, "PP-CoE-CodeApp", "power.config.json"), JSON.stringify(f.config));
      for (const ref of Object.values(f.refs)) delete ref.xrmConnectionReferenceLogicalName;
      f.cds.cdsdependencies = [];
      const runner = path.join(directory, "tools", "runner.mjs");
      writeFileSync(runner, `
        import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
        import path from "node:path";
        const [tool, ...args] = process.argv.slice(2);
        appendFileSync("events.txt", tool + " " + args.join(" ") + "\\n");
        const option = (name) => args[args.indexOf(name) + 1];
        if (tool === "npm") {
          mkdirSync("PP-CoE-CodeApp/dist", { recursive: true });
          writeFileSync("PP-CoE-CodeApp/dist/index.html", "fixture build");
        } else if (args[1] === "export" || args[1] === "pack") {
          writeFileSync(option(args[1] === "export" ? "--path" : "--zipFile"), "simulated ZIP");
        } else if (args[1] === "unpack") {
          const target = path.join(option("--folder"), "CanvasApps");
          mkdirSync(target, { recursive: true });
          writeFileSync(path.join(target, "fixture.meta.xml"), process.env.TEST_INCOMING_XML);
        }
      `);
      for (const command of ["npm", "pac"]) {
        const windows = process.platform === "win32";
        writeFileSync(path.join(directory, "tools", `${command}${windows ? ".cmd" : ""}`),
          windows ? `@echo off\r\n"${process.execPath}" "${runner}" ${command} %*\r\n`
            : `#!/bin/sh\nexec "${process.execPath}" "${runner}" ${command} "$@"\n`,
          { mode: 0o755 });
      }
      const environment = Object.fromEntries(Object.entries(process.env)
        .filter(([name]) => name.toLowerCase() !== "path"));
      const result = spawnSync(process.execPath, [path.join(directory, "scripts", `${pipeline}-solution.mjs`)], {
        cwd: directory, encoding: "utf8",
        env: {
          ...environment,
          PATH: `${path.join(directory, "tools")}${path.delimiter}${process.env.PATH}`,
          TEST_INCOMING_XML: xml(f),
        },
      });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /7 missing\/changed logical references.*3 missing HTTP solution dependencies/);
      assert.ok(!result.stdout.includes("Done"));
      const events = readFileSync(path.join(directory, "events.txt"), "utf8");
      assert.match(events, /pac solution unpack/);
      if (pipeline === "pull") {
        assert.equal(readFileSync(sourceMetadata, "utf8"), goodXml);
        assert.ok(!events.includes("--allowDelete"), "Broken exports must never overwrite tracked solution source");
      } else {
        assert.match(events, /pac solution pack/);
        assert.match(result.stderr, /do not import/);
        assert.equal(readFileSync(path.join(directory, "solution", "src", "Other", "Solution.xml"), "utf8"), "<Managed>0</Managed>");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
