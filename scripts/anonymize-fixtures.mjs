#!/usr/bin/env node
/**
 * One-off anonymizer + trimmer for raw captured payloads.
 *
 * Reads raw captures from attachment paths (not committed), produces
 * safe-to-commit fixtures under PP-CoE-CodeApp/src/test/fixtures/.
 *
 * Anonymization rules:
 *  - Tenant ID → 11111111-1111-1111-1111-111111111111
 *  - All other GUIDs → sequential placeholders, consistent within ONE
 *    fixture (so cross-references like ownerId === createdBy survive).
 *  - Display names → "Fixture Env N", "Fixture App N", "Fixture User N".
 *  - Email / UPN → fixture-N@contoso.example.
 *  - Dataverse / blob URLs → contoso.example placeholders.
 *  - Trims `data[]` to first 5 representative rows per fixture to keep
 *    test data lean.
 *  - Preserves shape, casing, nulls, ordering, all field names.
 *
 * Run with `node scripts/anonymize-fixtures.mjs`. Idempotent — re-runs
 * overwrite the fixture files.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(
  REPO_ROOT,
  "PP-CoE-CodeApp",
  "src",
  "test",
  "fixtures",
);

const ATTACHMENTS = "C:\\Users\\ralop\\.copilot\\workspaces\\bd5323f2-08f2-4da6-87a8-08b01bba756c\\attachments";
const RAW = {
  envsTruncated: path.join(ATTACHMENTS, "pasted-text-9513c5e8-616e-4801-bc53-95503cf3a7db.txt"),
  envsPage1: path.join(ATTACHMENTS, "pasted-text-d16ba5bc-e047-46f5-bf35-6bc342798c73.txt"),
  appsModelDriven: path.join(ATTACHMENTS, "pasted-text-a72f41ec-8945-487c-a190-8bc32429f1c4.txt"),
  adminApp: path.join(ATTACHMENTS, "pasted-text-e729daba-b293-4f90-8a6b-fa604551f10b.txt"),
  dlpTrace: "C:\\Users\\ralop\\AppData\\Local\\Temp\\1779808352132-copilot-tool-output-6n8egf.txt",
};

// ---------------------------------------------------------------------------
// GUID anonymization
// ---------------------------------------------------------------------------

const FIXED_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const REAL_TENANT_ID = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function makeGuidAnonymizer() {
  const map = new Map();
  map.set(REAL_TENANT_ID.toLowerCase(), FIXED_TENANT_ID);
  let counter = 0;
  return function anonymizeGuid(g) {
    const lower = g.toLowerCase();
    if (map.has(lower)) return map.get(lower);
    counter += 1;
    const padded = String(counter).padStart(12, "0");
    const replacement = `00000000-0000-0000-0000-${padded}`;
    map.set(lower, replacement);
    return replacement;
  };
}

function anonymizeText(text, anon) {
  return text.replace(GUID_RE, anon);
}

// ---------------------------------------------------------------------------
// Field-level scrubbing for display names / URLs / emails
// ---------------------------------------------------------------------------

const ENV_NAME_COUNTER = { n: 0 };
const APP_NAME_COUNTER = { n: 0 };
const USER_NAME_COUNTER = { n: 0 };

function scrubDisplayName(value, kind) {
  if (typeof value !== "string" || !value) return value;
  if (kind === "env") {
    ENV_NAME_COUNTER.n += 1;
    return `Fixture Env ${ENV_NAME_COUNTER.n}`;
  }
  if (kind === "app") {
    APP_NAME_COUNTER.n += 1;
    return `Fixture App ${APP_NAME_COUNTER.n}`;
  }
  if (kind === "user") {
    USER_NAME_COUNTER.n += 1;
    return `Fixture User ${USER_NAME_COUNTER.n}`;
  }
  return value;
}

function scrubBlobUrl(value) {
  if (typeof value !== "string") return value;
  if (value.includes("blob.core.windows.net") || value.includes("apps.powerapps.com")) {
    return "https://blob.example/fixture";
  }
  if (value.includes(".crm.dynamics.com")) {
    return "https://contoso.crm.dynamics.com";
  }
  return value;
}

function scrubEmail(value) {
  if (typeof value !== "string") return value;
  if (value.includes("@")) {
    USER_NAME_COUNTER.n += 1;
    return `fixture-${USER_NAME_COUNTER.n}@contoso.example`;
  }
  return value;
}

function scrubObject(obj, kindForName) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((x) => scrubObject(x, kindForName));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "displayName" && typeof v === "string") {
      out[k] = scrubDisplayName(v, kindForName);
    } else if ((k === "email" || k === "userPrincipalName") && typeof v === "string") {
      out[k] = scrubEmail(v);
    } else if (k === "domainName" && typeof v === "string") {
      out[k] = "contoso";
    } else if (k === "url" && typeof v === "string" && v.includes(".crm.dynamics.com")) {
      out[k] = "https://contoso.crm.dynamics.com";
    } else if ((k === "documentUri" || k === "readonlyValue" || k === "value" || k === "iconUri" || k === "backgroundImageUri" || k === "teamsColorIconUrl" || k === "teamsOutlineIconUrl" || k === "appOpenUri" || k === "appPlayUri" || k === "appPlayEmbeddedUri" || k === "appPlayTeamsUri" || k === "appOpenProtocolUri") && typeof v === "string") {
      out[k] = scrubBlobUrl(v);
    } else {
      out[k] = scrubObject(v, kindForName);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-fixture builders
// ---------------------------------------------------------------------------

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(`  wrote ${path.relative(REPO_ROOT, filePath)}`);
}

function buildQueryResources(rawPath, opts) {
  const { sliceTo, kind, outName, headerComment } = opts;
  // Reset counters per fixture for stable, scoped placeholders.
  ENV_NAME_COUNTER.n = 0;
  APP_NAME_COUNTER.n = 0;
  USER_NAME_COUNTER.n = 0;
  const anon = makeGuidAnonymizer();

  const raw = fs.readFileSync(rawPath, "utf8");
  const anonText = anonymizeText(raw, anon);
  const parsed = JSON.parse(anonText);
  if (Array.isArray(parsed.data)) {
    parsed.data = parsed.data.slice(0, sliceTo);
  }
  const scrubbed = scrubObject(parsed, kind);
  // Add a stable skipToken if the raw had one (it gets anonymized
  // because it's base64-encoded JSON without any GUIDs, but still
  // worth keeping intact). The anonymizer doesn't touch base64.
  writeJson(path.join(FIXTURES_DIR, outName), scrubbed);
  return { totalRecords: scrubbed.totalRecords, count: (scrubbed.data ?? []).length };
}

function buildAdminAppFixture() {
  ENV_NAME_COUNTER.n = 0;
  APP_NAME_COUNTER.n = 0;
  USER_NAME_COUNTER.n = 0;
  const anon = makeGuidAnonymizer();
  const raw = fs.readFileSync(RAW.adminApp, "utf8");
  const anonText = anonymizeText(raw, anon);
  const parsed = JSON.parse(anonText);
  // Truncate connection references to 2 for compactness; keep the rest.
  if (Array.isArray(parsed.properties?.connectionReferences)) {
    parsed.properties.connectionReferences = parsed.properties.connectionReferences.slice(0, 2);
  }
  const scrubbed = scrubObject(parsed, "app");
  writeJson(path.join(FIXTURES_DIR, "get-admin-app.json"), scrubbed);
  return scrubbed;
}

function buildAdminEnvFixture() {
  // The env admin response was inline in the chat — write it directly.
  // Anonymized at author time so we don't depend on a temp file.
  const env = {
    id: "00000000-0000-0000-0000-000000000001",
    displayName: "Fixture Env 1",
    tenantId: FIXED_TENANT_ID,
    type: "Production",
    geo: "unitedstates",
    azureRegion: "eastus",
    createdDateTime: "2021-04-07T20:23:35.028307Z",
    deletedDateTime: "1970-01-01T00:00:00Z",
    dataverseId: "00000000-0000-0000-0000-000000000002",
    url: "https://contoso.crm.dynamics.com",
    version: "9.2.26043.177",
    domainName: "contoso",
    state: "Enabled",
    adminMode: "Disabled",
    backgroundOperationsState: "Enabled",
    protectionLevel: "Standard",
    createdBy: {
      id: "00000000-0000-0000-0000-000000000003",
      type: "User",
    },
    retentionDetails: {
      retentionPeriod: "P28D",
      availableFromDateTime: "2026-04-28T14:51:45.0573005Z",
    },
  };
  writeJson(path.join(FIXTURES_DIR, "get-environment-by-id-for-user.json"), env);
}

function buildDlpTraceFixture() {
  ENV_NAME_COUNTER.n = 0;
  APP_NAME_COUNTER.n = 0;
  USER_NAME_COUNTER.n = 0;
  const anon = makeGuidAnonymizer();
  // The temp file has a console-log header line — strip it to get clean JSON.
  let raw = fs.readFileSync(RAW.dlpTrace, "utf8");
  // Skip the first line (User responded: hmm this is...) and find first '{'.
  const firstBrace = raw.indexOf("{");
  raw = raw.slice(firstBrace);
  // The console log dumps the object TWICE — once inline and once
  // pretty-printed. We want the pretty-printed JSON which is the
  // larger structured block.
  // Find the END of the first "{ ... }" by tracking brace depth.
  let depth = 0;
  let endIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  // The "first block" in the file is the abbreviated console.log
  // representation (single line with truncated trace). Skip it and
  // grab the SECOND block which is the full pretty-printed JSON.
  const remaining = raw.slice(endIdx);
  const nextBrace = remaining.indexOf("{");
  const fullJsonRaw = nextBrace >= 0 ? remaining.slice(nextBrace) : raw.slice(0, endIdx);
  const anonText = anonymizeText(fullJsonRaw, anon);
  // Re-find the end after anonymization (lengths can change).
  let d = 0, e = -1;
  for (let i = 0; i < anonText.length; i++) {
    const ch = anonText[i];
    if (ch === "{") d++;
    else if (ch === "}") {
      d--;
      if (d === 0) {
        e = i + 1;
        break;
      }
    }
  }
  const trimmed = e > 0 ? anonText.slice(0, e) : anonText;
  const parsed = JSON.parse(trimmed);
  // Keep first 6 trace entries: the 1 that applies + 5 that don't, for variety.
  const applies = parsed.trace.filter((t) => t.applies === true);
  const notApplies = parsed.trace.filter((t) => t.applies !== true).slice(0, 5);
  parsed.trace = [...applies, ...notApplies];
  const scrubbed = scrubObject(parsed, "user");
  writeJson(path.join(FIXTURES_DIR, "dlp-evaluation-trace.json"), scrubbed);
  return scrubbed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Writing fixtures to ${FIXTURES_DIR}`);

console.log("[1/5] envs page1 (with skipToken)");
buildQueryResources(RAW.envsPage1, {
  sliceTo: 6,
  kind: "env",
  outName: "query-resources-envs-page1.json",
});

console.log("[2/5] envs truncated (no skipToken, resultTruncated: 1)");
buildQueryResources(RAW.envsTruncated, {
  sliceTo: 6,
  kind: "env",
  outName: "query-resources-envs-truncated.json",
});

console.log("[3/5] apps model-driven (with skipToken)");
buildQueryResources(RAW.appsModelDriven, {
  sliceTo: 6,
  kind: "app",
  outName: "query-resources-apps-modeldriven.json",
});

console.log("[4/5] admin app (Get_AdminApp)");
buildAdminAppFixture();

console.log("[5/5] dlp evaluation trace");
buildDlpTraceFixture();

console.log("[5b/5] admin env (GetEnvironmentByIdForUser) — author-time anonymized");
buildAdminEnvFixture();

console.log("Done.");
