#!/usr/bin/env node
/**
 * Idempotent fixup for generated Power Apps connector clients.
 *
 * The OpenAPI-derived generator that produces `src/generated/services/*.ts`
 * has a long-standing bug: query parameters whose **on-the-wire** name
 * contains a hyphen (most commonly `api-version`) are emitted into
 * TypeScript verbatim. Hyphens are not legal in JS identifiers, so the
 * generated file fails to parse with TS1005 / TS1109 errors anywhere it
 * appears — as a function parameter, as a type-literal key, or as an
 * object-shorthand value.
 *
 * The sibling `PowerPlatformforAdminsV2Service.ts` was hand-fixed by the
 * connector team using a consistent pattern; this script applies the
 * same pattern to every service file under `src/generated/services/`.
 *
 * Transforms (all idempotent — running on already-fixed code is a no-op):
 *   1. Function param signature:  `api-version?: string`  → `apiVersion?: string`
 *   2. Type-literal key:          `{ api-version?: T }`   → `{ "api-version"?: T }`
 *   3. Value-position shorthand:  `{ api-version, ... }`  → `{ "api-version": apiVersion, ... }`
 *   4. NewEnvironmentPolicy bug:  required `environment` after optional `apiVersion`
 *                                 → make `environment` optional
 *
 * Wired into `PP-CoE-CodeApp/package.json` as the `postinstall` script,
 * so `npm ci` / `npm install` self-heal after a connector regeneration.
 * Also safe to run manually:
 *
 *   node scripts/fixup-generated-connectors.mjs
 *
 * Exits 0 if files are clean or were patched; non-zero only on I/O error.
 * See `PP-CoE-CodeApp/docs/connector-generator-fixup.md` for context.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = resolve(
  __dirname,
  "..",
  "PP-CoE-CodeApp",
  "src",
  "generated",
  "services"
);

if (!existsSync(SERVICES_DIR)) {
  // No generated folder yet (fresh clone before any data source was added).
  // postinstall must not break the install — just exit quietly.
  console.log(`[fixup] ${SERVICES_DIR} not found. Skipping (no connectors yet).`);
  process.exit(0);
}

/** Apply the four transforms to one file's text. Returns the new text
 *  and a per-transform count of how many sites changed. */
function transform(source) {
  let s = source;
  const counts = { params: 0, typeKeys: 0, shorthand: 0, paramOrder: 0 };

  // (1) Function parameter signatures. Scoped to `public static async X(...)`
  //     so we don't touch type-literal occurrences (those are step 2).
  s = s.replace(
    /(public static async \w+\()([^)]*)(\))/g,
    (_m, head, paramList, tail) => {
      let changed = 0;
      const fixed = paramList.replace(/\bapi-version\b/g, () => {
        changed++;
        return "apiVersion";
      });
      counts.params += changed;
      return `${head}${fixed}${tail}`;
    }
  );

  // (2) Type-literal property keys. After step 1, any remaining unquoted
  //     `api-version` immediately followed by `?:` or `:` is a property key.
  s = s.replace(/\bapi-version(\??):/g, (_m, opt) => {
    counts.typeKeys++;
    return `"api-version"${opt}:`;
  });

  // (3) Object shorthand in value position. After step 2, the only remaining
  //     unquoted `api-version` tokens are inside `{ ... api-version, ... }`
  //     assignments. Expand to longhand keyed off the renamed parameter.
  s = s.replace(/([{,]\s*)api-version(\s*[,}])/g, (_m, lead, trail) => {
    counts.shorthand++;
    return `${lead}"api-version": apiVersion${trail}`;
  });

  // (4) Specific pre-existing generator bug in `NewEnvironmentPolicy`:
  //     `environment: string` is required but follows optional `apiVersion?`.
  //     Make `environment` optional throughout the method to satisfy
  //     "required parameter cannot follow optional parameter" (TS1016) and
  //     keep the params record consistent.
  //
  //     Anchored to the METHOD DECLARATION (`public static async
  //     NewEnvironmentPolicy(`) — not just the bare name — because the
  //     identifier also appears as an `operationName` string literal in
  //     every method's body, and a loose anchor would leak into the next
  //     method's `const params:` / `executeAsync<...>` blocks.
  //
  //     Idempotent: rewrites every `environment: string` in the method
  //     body to `environment?: string`; on already-fixed code the regex
  //     finds nothing and the callback never fires.
  s = s.replace(
    /(public static async NewEnvironmentPolicy\([\s\S]*?\n  \})/,
    (block) => {
      const fixed = block.replace(/\benvironment:\s*string\b/g, () => {
        counts.paramOrder++;
        return "environment?: string";
      });
      return fixed;
    }
  );

  return { text: s, counts };
}

const files = readdirSync(SERVICES_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(SERVICES_DIR, f));

if (files.length === 0) {
  console.log("[fixup] No service files to scan.");
  process.exit(0);
}

let totalChanged = 0;
for (const file of files) {
  const original = readFileSync(file, "utf8");
  const { text, counts } = transform(original);
  if (text === original) continue;

  writeFileSync(file, text, "utf8");
  totalChanged++;
  const summary = [
    counts.params && `${counts.params} param(s)`,
    counts.typeKeys && `${counts.typeKeys} type key(s)`,
    counts.shorthand && `${counts.shorthand} shorthand`,
    counts.paramOrder && `${counts.paramOrder} param-order`,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(`[fixup] Patched ${file.replace(SERVICES_DIR, "src/generated/services")}: ${summary}`);
}

if (totalChanged === 0) {
  console.log("[fixup] All generated connector files already clean. No changes.");
}
