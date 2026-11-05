import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveLocalBindings } from "../PP-CoE-CodeApp/scripts/localConnectionBindings.ts";
import { toPacPublishConfig, validatePublishConfig } from "./prepare-code-app-publish.mjs";
import { verifyCodeAppExport, verifySolutionDirectory } from "./verify-code-app-export.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function windowsCommand(executable, args) {
  if ([executable, ...args].some((value) => /["%\r\n\0]/.test(value))) {
    throw new Error("Windows tool paths/arguments cannot contain quotes, percent expansion or control characters.");
  }
  const quote = (value) => `"${value.replace(/\\+$/g, "$&$&")}"`;
  return ["/d", "/v:off", "/s", "/c", `"${[executable, ...args].map(quote).join(" ")}"`];
}

export function resolvePacLauncher(shim, probe = spawnSync) {
  const source = readFileSync(shim, "utf8").replace(/\r\n/g, "\n").trim();
  if (!/^@echo off\s*\n"%~dp0pac\.launcher\.exe" %\*$/i.test(source)) {
    throw new Error("Unrecognized PAC batch launcher; cannot establish native exit-code propagation. No publication was started.");
  }
  const directory = path.dirname(shim);
  const launcher = path.join(directory, "pac.launcher.exe");
  const help = probe(launcher, ["help"], { encoding: "utf8" });
  const version = help.stdout?.match(/^Version: (\d+\.\d+\.\d+)(?:[+\s]|$)/m)?.[1];
  if (help.error || help.status !== 0 || !version || /^Error:/m.test(`${help.stdout}\n${help.stderr}`)) {
    throw new Error("PAC launcher did not identify its selected installed version. No publication was started.");
  }
  const native = path.join(directory, `Microsoft.PowerApps.CLI.${version}`, "tools", "pac.exe");
  if (!existsSync(native)) throw new Error("Selected native PAC executable is missing; refusing a launcher that can hide failures.");
  const nativeHelp = probe(native, ["help"], { encoding: "utf8" });
  if (nativeHelp.error || nativeHelp.status !== 0
    || nativeHelp.stdout?.match(/^Version: (\d+\.\d+\.\d+)(?:[+\s]|$)/m)?.[1] !== version
    || !/^\s+env\s/m.test(nativeHelp.stdout)
    || /^Error:/m.test(`${nativeHelp.stdout}\n${nativeHelp.stderr}`)) {
    throw new Error("Selected native PAC version or env command could not be verified. No publication was started.");
  }
  return native;
}

export function runCommand(tool, args, cwd) {
  let executable = tool;
  let parameters = args;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32" && tool !== process.execPath) {
    let resolved;
    if (path.isAbsolute(tool)) {
      if (existsSync(tool) && /\.(exe|cmd|bat)$/i.test(tool)) resolved = tool;
    } else {
      const lookup = spawnSync("where.exe", [tool], { encoding: "utf8" });
      if (lookup.error || lookup.status !== 0) throw new Error(`Required tool "${tool}" is not on PATH.`);
      resolved = lookup.stdout.trim().split(/\r?\n/).find((candidate) => /\.(exe|cmd|bat)$/i.test(candidate));
    }
    if (!resolved) throw new Error(`Required Windows executable for "${tool}" is not on PATH.`);
    if (tool.toLowerCase() === "pac" && /\.(cmd|bat)$/i.test(resolved)) {
      // The official launcher can return 0 for a failed child PAC command.
      executable = resolvePacLauncher(resolved);
    } else if (/\.(cmd|bat)$/i.test(resolved)) {
      executable = process.env.ComSpec || "cmd.exe";
      parameters = windowsCommand(resolved, args);
      windowsVerbatimArguments = true;
    } else {
      executable = resolved;
    }
  }
  const result = spawnSync(executable, parameters, { cwd, stdio: "inherit", windowsVerbatimArguments });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(tool)} ${args.slice(0, 2).join(" ")} failed${result.status === null ? "" : ` (exit ${result.status})`}.`);
  }
}

function verifyStage(config, staged) {
  const cds = {
    cdsdependencies: Object.values(config.connectionReferences)
      .filter((ref) => ref.xrmConnectionReferenceLogicalName)
      .map((ref) => ({ logicalname: ref.xrmConnectionReferenceLogicalName, componenttype: 10156 })),
  };
  verifyCodeAppExport(
    `<ConnectionReferences>${JSON.stringify(staged.connectionReferences)}</ConnectionReferences>`
    + `<CdsDependencies>${JSON.stringify(cds)}</CdsDependencies>`,
    config,
  );
}

export async function pushCodeApp({
  root = repoRoot,
  dryRun = false,
  yes = false,
  run = runCommand,
  confirm,
  log = console.log,
  temporaryRoot = tmpdir(),
} = {}) {
  const appRoot = path.join(root, "PP-CoE-CodeApp");
  const configFile = path.join(appRoot, "power.config.json");
  const originalConfig = readFileSync(configFile, "utf8");
  const config = JSON.parse(originalConfig);
  if (!guid.test(config.appId ?? "") || !guid.test(config.environmentId ?? "")) {
    throw new Error("An existing source appId and environmentId are required in power.config.json; this command never initializes an app.");
  }
  for (const ref of Object.values(config.connectionReferences ?? {})) {
    if (ref.id.toLowerCase().endsWith("/shared_logicflows")) {
      if (!guid.test(ref.workflowDetails?.workflowEntityId ?? "")) {
        throw new Error("Every flow must retain its source workflow entity ID in modern workflowDetails.");
      }
    } else if (!ref.xrmConnectionReferenceLogicalName) {
      throw new Error("Every connector must retain its solution logical connection-reference name.");
    }
  }
  const bindingFile = path.join(appRoot, "power.bindings.local");
  if (!existsSync(bindingFile)) {
    throw new Error("Missing PP-CoE-CodeApp/power.bindings.local. Configure its environmentId and the three audience-specific HTTP bindings once; see solution/README.md.");
  }
  const originalBindings = readFileSync(bindingFile, "utf8");
  let bindings;
  try {
    bindings = JSON.parse(originalBindings);
  } catch {
    throw new Error("Invalid JSON in power.bindings.local; no build or publication was started.");
  }
  const resolved = resolveLocalBindings(config, bindings);
  for (const ref of Object.values(config.connectionReferences)) {
    if (ref.id.toLowerCase().endsWith("/shared_webcontents")
      && !bindings.sharedConnections[ref.xrmConnectionReferenceLogicalName]) {
      throw new Error(`Missing private HTTP binding for ${ref.xrmConnectionReferenceLogicalName}.`);
    }
  }
  validatePublishConfig(resolved, config);
  toPacPublishConfig(resolved);
  const label = config.appDisplayName || "Code App";
  log(`Target: ${label}\nSource environment: ${config.environmentId}\nExisting app: ${config.appId}`);
  log("Coordinate other publishers and preserve any newer/cloud-only changes before replacing this source app.");
  if (!dryRun && !yes && (!confirm || !await confirm())) {
    throw new Error("Publish cancelled. No tenant operations were performed.");
  }
  const lockId = createHash("sha256").update(`${config.environmentId.toLowerCase()}:${config.appId.toLowerCase()}`).digest("hex");
  const lock = path.join(temporaryRoot, `ppcoe-push-${lockId}.lock`);
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Another push owns this source target. If a previous process crashed, confirm it is stopped before removing only this lock directory: ${lock}`);
  }
  let working;
  let published = false;
  let pushAttempted = false;
  const unchanged = () => {
    if (readFileSync(configFile, "utf8") !== originalConfig || readFileSync(bindingFile, "utf8") !== originalBindings) {
      throw new Error("Configuration or private bindings changed during the build; rerun against the current files.");
    }
  };
  try {
    writeFileSync(path.join(lock, "pid"), String(process.pid), { mode: 0o600 });
    working = mkdtempSync(path.join(temporaryRoot, "ppcoe-push-"));
    chmodSync(working, 0o700);
    if (!dryRun) run("pac", ["env", "who", "--environment", config.environmentId], appRoot);
    log("Building this checkout (never reusing an earlier dist or prepared publish folder)...");
    rmSync(path.join(appRoot, "dist"), { recursive: true, force: true });
    run("npm", ["run", "build"], appRoot);
    unchanged();
    const input = path.join(working, "resolved-power.config.json");
    const stage = path.join(working, "stage");
    writeFileSync(input, JSON.stringify(resolved, null, 2), { mode: 0o600 });
    run(process.execPath, [
      path.join(root, "scripts", "prepare-code-app-publish.mjs"), "--config", input, "--output", stage,
    ], root);
    const staged = JSON.parse(readFileSync(path.join(stage, "power.config.json"), "utf8"));
    if (staged.appId !== config.appId || staged.environmentId !== config.environmentId) {
      throw new Error("Prepared stage targets a different app or environment.");
    }
    verifyStage(config, staged);
    if (!existsSync(path.join(stage, staged.buildPath, staged.buildEntryPoint))) {
      throw new Error("Prepared stage has no built entry point.");
    }
    if (dryRun) {
      log("Dry run passed: built current source and verified private PAC staging. No tenant commands ran.");
      return;
    }
    unchanged();
    const backupDirectory = mkdtempSync(path.join(temporaryRoot, "ppcoe-source-backup-"));
    chmodSync(backupDirectory, 0o700);
    const backup = path.join(backupDirectory, "before-push-unmanaged.zip");
    run("pac", [
      "solution", "export", "--environment", config.environmentId, "--name", "PPCoECodeApp",
      "--path", backup, "--managed", "false",
    ], root);
    if (!existsSync(backup)) throw new Error("Source backup export did not create its ZIP; publication stopped.");
    log(`Private source backup retained: ${backup}`);
    unchanged();
    pushAttempted = true;
    run("pac", ["code", "push", "--environment", config.environmentId, "--solutionName", "PPCoECodeApp"], stage);
    published = true;
    log("Published. Checking a fresh source solution export before it can be distributed...");
    const zip = path.join(working, "verify-unmanaged.zip");
    const unpacked = path.join(working, "verify-unpacked");
    run("pac", [
      "solution", "export", "--environment", config.environmentId, "--name", "PPCoECodeApp",
      "--path", zip, "--managed", "false",
    ], root);
    run("pac", ["solution", "unpack", "--zipFile", zip, "--folder", unpacked, "--packageType", "Unmanaged"], root);
    verifySolutionDirectory(unpacked, config);
    log("Published and verified source export: logical references, HTTP dependencies and flow mappings preserved.");
    log("No release ZIP retained or destination imported. Managed release artifacts and destination consent/calls still require verification.");
  } catch (error) {
    if (published) {
      throw new Error(`Published, but export verification failed; do not distribute this publication. No rollback was attempted. ${error.message}`);
    }
    if (pushAttempted) {
      throw new Error(`Publish command failed; source state may have changed. No rollback was attempted. ${error.message}`);
    }
    throw error;
  } finally {
    if (working) rmSync(working, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: { help: { type: "boolean" }, "dry-run": { type: "boolean" }, yes: { type: "boolean" } },
  });
  if (values.help) {
    console.log("Usage: npm run push -- [--dry-run] [--yes]\n"
      + "Build and publish this checkout's existing source app via PAC, then verify a fresh source export.\n"
      + "Requires Node 22.18+, npm, authenticated PAC and ignored PP-CoE-CodeApp/power.bindings.local.\n"
      + "Default: confirm target interactively. --yes: explicitly approve the displayed configured target.\n"
      + "--dry-run: build and verify local staging only; no PAC/tenant commands.\n"
      + "No login, connection creation, destination import or managed release is performed.\n"
      + "A private source backup is retained; a temporary post-push unmanaged verification export is removed.\n"
      + "Export/check the managed release ZIP separately. Coordinate other publishers and preserve newer cloud-only work.");
    return;
  }
  await pushCodeApp({
    dryRun: values["dry-run"],
    yes: values.yes,
    confirm: async () => {
      if (!process.stdin.isTTY) throw new Error("Interactive target confirmation requires a terminal; use --yes only to approve the configured target explicitly.");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await prompt.question("Publish this checkout over the source app shown above? Type yes: ")).trim().toLowerCase() === "yes";
      } finally {
        prompt.close();
      }
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Push failed: ${error.message}`);
    process.exitCode = 1;
  });
}
