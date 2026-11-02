import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function toPacPublishConfig(config) {
  const references = config.connectionReferences ?? {};
  const translated = {};
  for (const [key, ref] of Object.entries(references)) {
    if (ref.sharedConnectionId?.includes("<")) {
      throw new Error("Resolve placeholder connection IDs privately before publishing.");
    }
    if (ref.id.toLowerCase().endsWith("/shared_webcontents")
      && (!ref.sharedConnectionId || !ref.xrmConnectionReferenceLogicalName)) {
      throw new Error("Every HTTP connection requires a resolved binding and logical reference.");
    }
    const { workflowDetails, ...connection } = ref;
    translated[key] = {
      ...connection,
      dataSources: connection.dataSources ?? [],
      dataSets: connection.dataSets ?? {},
      dependencies: [],
      dependents: [],
      parameterHints: {},
      parameterHintsV2: {},
    };
    if (!workflowDetails) continue;
    const { dependencies = {}, ...hints } = workflowDetails;
    for (const target of Object.values(dependencies)) {
      if (!references[target] || references[target].workflowDetails) {
        throw new Error("Flow dependencies must resolve to existing connector references.");
      }
    }
    translated[key].dependencies = [...new Set(Object.values(dependencies))];
    translated[key].parameterHints = Object.fromEntries(
      Object.entries(hints).map(([name, value]) => [name, { value }]),
    );
    translated[key].parameterHintsV2 = Object.fromEntries(
      Object.entries({ ...hints, ...dependencies }).map(([name, value]) => [name, { value }]),
    );
  }
  for (const [key, ref] of Object.entries(translated)) {
    for (const dependency of ref.dependencies) {
      translated[dependency].dependents.push(key);
    }
  }
  return {
    ...config,
    connectionReferences: translated,
    databaseReferences: Object.fromEntries(Object.entries(config.databaseReferences ?? {}).map(([key, ref]) => [
      key,
      {
        dataSources: ref.dataSources,
        databaseDetails: {
          environmentName: key,
          overrideValues: { environmentVariableName: ref.environmentVariableName ?? "" },
        },
      },
    ])),
  };
}

function main() {
  const { values } = parseArgs({
    options: { config: { type: "string" }, output: { type: "string" } },
  });
  if (!values.config || !values.output) {
    throw new Error("Usage: node scripts/prepare-code-app-publish.mjs --config <resolved-config> --output <private-directory>");
  }
  const output = path.resolve(values.output);
  const relative = path.relative(repoRoot, output);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    throw new Error("The publish directory must be outside the repository to keep resolved connection IDs private.");
  }
  if (existsSync(output)) {
    throw new Error("Use a new publish directory; existing directories are not overwritten.");
  }
  const config = JSON.parse(readFileSync(path.resolve(values.config), "utf8"));
  if (!config.appId || !config.environmentId) {
    throw new Error("An existing app ID and explicit source environment ID are required.");
  }
  const compatible = toPacPublishConfig(config);
  const appRoot = path.join(repoRoot, "PP-CoE-CodeApp");
  if (!existsSync(path.join(appRoot, "dist", config.buildEntryPoint))) {
    throw new Error("Build the app before preparing a publish directory.");
  }
  if (path.isAbsolute(config.buildPath) || config.buildPath.split(/[\\/]/).includes("..")) {
    throw new Error("The build path must be relative and stay inside the publish directory.");
  }
  mkdirSync(output, { recursive: true });
  cpSync(path.join(appRoot, "dist"), path.join(output, config.buildPath), { recursive: true });
  cpSync(path.join(appRoot, ".power"), path.join(output, ".power"), { recursive: true });
  writeFileSync(path.join(output, "power.config.json"), JSON.stringify(compatible, null, 2));
  console.log("Prepared private PAC-compatible publish directory. No app was published.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Publish preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
