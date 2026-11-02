import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fixOdataTypeAliases(source) {
  const aliases = [...source.matchAll(/^export type ([A-Za-z_$][\w$]*@odata_type)(?=\s*=)/gm)];
  let result = source;
  for (const [, alias] of aliases) {
    const replacement = alias.replace("@odata_type", "OdataType");
    if (new RegExp(`\\b(?:type|interface) ${replacement}\\b`).test(source)) {
      throw new Error(`Generated model alias collision: ${replacement}`);
    }
    result = result
      .replaceAll(`export type ${alias}`, `export type ${replacement}`)
      .replaceAll(new RegExp(`(:\\s*)${alias}(?=\\s*[;|])`, "g"), `$1${replacement}`);
  }
  return result;
}

export function fixGeneratedModels() {
  const folder = new URL("../PP-CoE-CodeApp/src/generated/models/", import.meta.url);
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".ts"))) {
    const path = new URL(file, folder);
    const original = readFileSync(path, "utf8");
    const fixed = fixOdataTypeAliases(original);
    if (fixed === original) continue;
    writeFileSync(path, fixed, "utf8");
    console.log(`[fixup] Patched model OData type aliases: ${fileURLToPath(path)}`);
  }
}
