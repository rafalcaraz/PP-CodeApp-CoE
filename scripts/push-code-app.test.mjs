import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pushCodeApp, windowsCommand } from "./push-code-app.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ppcoe push fixture "));
  const app = path.join(root, "PP-CoE-CodeApp");
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ppcoe private staging "));
  mkdirSync(path.join(app, ".power"), { recursive: true });
  mkdirSync(path.join(app, "dist"));
  writeFileSync(path.join(app, "dist", "stale.js"), "must not be published");
  mkdirSync(path.join(root, "scripts"));
  for (const name of ["prepare-code-app-publish.mjs", "verify-code-app-export.mjs"]) {
    cpSync(new URL(name, import.meta.url), path.join(root, "scripts", name));
  }
  const config = JSON.parse(readFileSync(new URL("../PP-CoE-CodeApp/power.config.json", import.meta.url), "utf8"));
  config.appId = "00000000-0000-0000-0000-000000000001";
  config.environmentId = "00000000-0000-0000-0000-000000000002";
  config.appDisplayName = "Fixture app";
  const bindings = { environmentId: config.environmentId, sharedConnections: {} };
  for (const ref of Object.values(config.connectionReferences)) {
    if (ref.id.toLowerCase().endsWith("/shared_webcontents")) {
      bindings.sharedConnections[ref.xrmConnectionReferenceLogicalName] = `${ref.id}/connections/fixture-${Object.keys(bindings.sharedConnections).length}`;
    }
  }
  const configFile = path.join(app, "power.config.json");
  const bindingFile = path.join(app, "power.bindings.local");
  writeFileSync(configFile, JSON.stringify(config));
  writeFileSync(bindingFile, JSON.stringify(bindings));
  const calls = [];
  const messages = [];
  let staged;
  const f = {
    root, app, temporaryRoot, config, bindings, configFile, bindingFile, calls, messages,
    fail: undefined,
    options: undefined,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(temporaryRoot, { recursive: true, force: true });
    },
  };
  const run = (tool, args, cwd) => {
    const operation = tool === process.execPath ? "adapter" : `${tool} ${args.slice(0, 2).join(" ")}`;
    calls.push({ operation, args, cwd });
    const backup = operation === "pac solution export"
      && path.basename(args[args.indexOf("--path") + 1]) === "before-push-unmanaged.zip";
    if ((f.fail === operation && !backup) || (f.fail === "backup" && backup)) throw new Error(`synthetic ${operation} failure`);
    if (operation === "npm run build") {
      assert.ok(!existsSync(path.join(app, "dist", "stale.js")));
      mkdirSync(path.join(app, "dist"), { recursive: true });
      writeFileSync(path.join(app, "dist", "index.html"), "fresh build");
      if (f.fail === "changed config") writeFileSync(configFile, JSON.stringify({ ...config, description: "changed" }));
    } else if (operation === "adapter") {
      const result = spawnSync(tool, args, { cwd, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const stage = args[args.indexOf("--output") + 1];
      staged = JSON.parse(readFileSync(path.join(stage, "power.config.json"), "utf8"));
      if (f.fail === "wrong stage") {
        staged.appId = "00000000-0000-0000-0000-000000000099";
        writeFileSync(path.join(stage, "power.config.json"), JSON.stringify(staged));
      }
      if (f.fail === "bad stage") {
        delete Object.values(staged.connectionReferences).find((ref) => ref.xrmConnectionReferenceLogicalName)?.xrmConnectionReferenceLogicalName;
        writeFileSync(path.join(stage, "power.config.json"), JSON.stringify(staged));
      }
    } else if (operation === "pac code push") {
      assert.equal(staged.appId, config.appId);
      assert.equal(staged.environmentId, config.environmentId);
      assert.equal(Object.keys(staged.connectionReferences).length, 11);
      assert.equal(Object.values(staged.connectionReferences).filter((ref) => ref.xrmConnectionReferenceLogicalName).length, 7);
      assert.equal(readFileSync(path.join(cwd, "dist", "index.html"), "utf8"), "fresh build");
      assert.ok(!existsSync(path.join(cwd, "dist", "stale.js")));
      assert.ok(!JSON.stringify(staged).includes("<connection-id>"));
    } else if (operation === "pac solution export") {
      writeFileSync(args[args.indexOf("--path") + 1], "fixture zip");
    } else if (operation === "pac solution unpack") {
      const out = path.join(args[args.indexOf("--folder") + 1], "CanvasApps");
      mkdirSync(out, { recursive: true });
      const cds = {
        cdsdependencies: Object.values(config.connectionReferences).filter((ref) => ref.xrmConnectionReferenceLogicalName)
          .map((ref) => ({ logicalname: ref.xrmConnectionReferenceLogicalName, componenttype: 10156 })),
      };
      if (f.fail === "verifier") cds.cdsdependencies = [];
      writeFileSync(path.join(out, "fixture.meta.xml"),
        `<ConnectionReferences>${JSON.stringify(staged.connectionReferences)}</ConnectionReferences><CdsDependencies>${JSON.stringify(cds)}</CdsDependencies>`);
    }
  };
  f.options = { root, temporaryRoot, yes: true, run, log: (message) => messages.push(message) };
  return f;
}

test("builds invoking checkout, prepares complete current registration, pushes explicit source and verifies fresh export", async () => {
  const f = fixture();
  try {
    const before = readFileSync(f.configFile, "utf8");
    const privateBefore = readFileSync(f.bindingFile, "utf8");
    await pushCodeApp(f.options);
    assert.deepEqual(f.calls.map((call) => call.operation),
      ["pac org who", "npm run build", "adapter", "pac solution export", "pac code push", "pac solution export", "pac solution unpack"]);
    assert.ok(f.calls.filter((call) => ["pac org who", "pac code push", "pac solution export"].includes(call.operation))
      .every((call) => call.args[call.args.indexOf("--environment") + 1] === f.config.environmentId));
    assert.equal(f.calls[1].cwd, f.app);
    assert.equal(readFileSync(f.configFile, "utf8"), before);
    assert.equal(readFileSync(f.bindingFile, "utf8"), privateBefore);
    const retained = readdirSync(f.temporaryRoot);
    assert.equal(retained.length, 1);
    assert.ok(retained[0].startsWith("ppcoe-source-backup-"));
    assert.ok(existsSync(path.join(f.temporaryRoot, retained[0], "before-push-unmanaged.zip")));
    assert.ok(f.messages.some((message) => message.includes("Published and verified source export")));
    assert.ok(f.messages.every((message) => !message.includes("/connections/fixture")));
  } finally { f.cleanup(); }
});

test("dry run builds and validates adapter output without ANY tenant command", async () => {
  const f = fixture();
  try {
    await pushCodeApp({ ...f.options, yes: false, dryRun: true });
    assert.deepEqual(f.calls.map((call) => call.operation), ["npm run build", "adapter"]);
    assert.deepEqual(readdirSync(f.temporaryRoot), []);
  } finally { f.cleanup(); }
});

for (const operation of [
  "pac org who", "npm run build", "adapter", "changed config", "wrong stage", "bad stage",
  "backup", "pac code push", "pac solution export", "pac solution unpack", "verifier",
]) {
  test(`fails safely and cleans owned staging/lock on ${operation}`, async () => {
    const f = fixture();
    try {
      f.fail = operation;
      const afterPush = ["pac solution export", "pac solution unpack", "verifier"].includes(operation);
      await assert.rejects(pushCodeApp(f.options), afterPush ? /Published, but export verification failed; do not distribute/ : /failed|failure|changed|different|Nonportable/);
      if (!afterPush && operation !== "pac code push") assert.ok(!f.calls.some((call) => call.operation === "pac code push"));
      assert.ok(readdirSync(f.temporaryRoot).every((name) => name.startsWith("ppcoe-source-backup-")));
      assert.ok(!f.messages.some((message) => message.includes("Published and verified")));
    } finally { f.cleanup(); }
  });
}

for (const failure of ["missing file", "invalid JSON", "missing binding", "wrong environment", "duplicate audience", "no app", "lost logical reference", "lost workflow identity", "cancelled"]) {
  test(`rejects ${failure} before invoking any build or tenant operation`, async () => {
    const f = fixture();
    try {
      if (failure === "missing file") rmSync(f.bindingFile);
      if (failure === "invalid JSON") writeFileSync(f.bindingFile, "{");
      if (failure === "missing binding") {
        delete f.bindings.sharedConnections.msftcsa_PPLicensingAPI;
        writeFileSync(f.bindingFile, JSON.stringify(f.bindings));
      }
      if (failure === "wrong environment") writeFileSync(f.bindingFile, JSON.stringify({ ...f.bindings, environmentId: "other-env" }));
      if (failure === "duplicate audience") {
        const values = Object.keys(f.bindings.sharedConnections);
        f.bindings.sharedConnections[values[1]] = f.bindings.sharedConnections[values[0]];
        writeFileSync(f.bindingFile, JSON.stringify(f.bindings));
      }
      if (failure === "no app") writeFileSync(f.configFile, JSON.stringify({ ...f.config, appId: "" }));
      if (failure === "lost logical reference") {
        const custom = Object.values(f.config.connectionReferences).find((ref) => ref.xrmConnectionReferenceLogicalName === "msftcsa_MACCostControlsConnRef");
        delete custom.xrmConnectionReferenceLogicalName;
        writeFileSync(f.configFile, JSON.stringify(f.config));
      }
      if (failure === "lost workflow identity") {
        delete Object.values(f.config.connectionReferences).find((ref) => ref.workflowDetails).workflowDetails;
        writeFileSync(f.configFile, JSON.stringify(f.config));
      }
      await assert.rejects(pushCodeApp({ ...f.options, yes: failure !== "cancelled", confirm: async () => false }));
      assert.deepEqual(f.calls, []);
      assert.deepEqual(readdirSync(f.temporaryRoot), []);
    } finally { f.cleanup(); }
  });
}

test("target lock blocks another checkout without removing its lock", async () => {
  const f = fixture();
  try {
    const id = createHash("sha256").update(`${f.config.environmentId}:${f.config.appId}`).digest("hex");
    const lock = path.join(f.temporaryRoot, `ppcoe-push-${id}.lock`);
    mkdirSync(lock);
    writeFileSync(path.join(lock, "pid"), "other-publisher");
    await assert.rejects(pushCodeApp(f.options), /Another push owns/);
    assert.equal(readFileSync(path.join(lock, "pid"), "utf8"), "other-publisher");
    assert.deepEqual(f.calls, []);
  } finally { f.cleanup(); }
});

test("Windows executable/arguments preserve spaces, quotes and shell metacharacters as literal arguments", () => {
  const arguments_ = windowsCommand("C:\\Program Files\\PAC\\pac.cmd", ["solution", "unpack", "--folder", "C:\\User's files\\a&b"]);
  const command = Buffer.from(arguments_.at(-1), "base64").toString("utf16le");
  assert.equal(command, "& 'C:\\Program Files\\PAC\\pac.cmd' '\"solution\"' '\"unpack\"' '\"--folder\"' '\"C:\\User''s files\\a&b\"'; exit $LASTEXITCODE");
  for (const unsafe of ['a"b', "a%PATH%b", "a\nb"]) {
    assert.throws(() => windowsCommand("pac.cmd", [unsafe]), /cannot contain/);
  }
});

test("Windows launcher delivers spaced paths and metacharacters unchanged to a native batch tool", {
  skip: process.platform !== "win32",
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ppcoe command test "));
  try {
    const probe = path.join(directory, "probe.mjs");
    const batch = path.join(directory, "native tool.cmd");
    writeFileSync(probe, "console.log(JSON.stringify(process.argv.slice(2)))");
    writeFileSync(batch, `@echo off\r\n"${process.execPath}" "${probe}" %*\r\n`);
    const args = ["C:\\User's files\\a&b", "simple", "C:\\a&b"];
    const result = spawnSync("powershell.exe", windowsCommand(batch, args), { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), args);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("npm exposes push without changing local dev and help works from root or app directory", () => {
  const manifest = JSON.parse(readFileSync(new URL("../PP-CoE-CodeApp/package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts.push, "node ../scripts/push-code-app.mjs");
  assert.equal(manifest.scripts.dev, "vite");
  for (const cwd of [fileURLToPath(new URL("../", import.meta.url)), fileURLToPath(new URL("../PP-CoE-CodeApp/", import.meta.url))]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./push-code-app.mjs", import.meta.url)), "--help"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--dry-run/);
  }
});
