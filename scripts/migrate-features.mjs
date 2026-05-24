#!/usr/bin/env node
/**
 * One-shot migration script: move src/views/*.tsx into src/features/<name>/
 * and rewrite imports.
 *
 * Run from PP-CoE-CodeApp/ via `node ../scripts/migrate-features.mjs`.
 *
 * After this runs successfully, the script can be deleted (it's a one-time
 * refactor tool; no need to keep it in tree). Kept under scripts/ so the
 * commit shows what was done.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");

// Feature → views map. Each "views" entry is a top-level .tsx file under src/views/.
// "data" is the list of symbol names (functions / types) that the feature
// imports from src/data/inventory.ts — captured into the per-feature data.ts
// wrapper. Types vs values: types listed in `dataTypes` use `export type`.
const FEATURES = [
  {
    name: "apps",
    views: ["AppsList", "AppDetail"],
    data: ["listAppsPage", "getApp", "ALL_APP_TYPES", "shortResourceType", "friendlyResourceType"],
    dataTypes: ["AppRow", "AppFilters", "ResourceConnector", "ResourceConnectorOperation"],
  },
  {
    name: "flows",
    views: ["FlowsList", "FlowDetail"],
    data: ["listFlowsPage", "getFlow", "ALL_FLOW_TYPES", "shortResourceType", "friendlyResourceType"],
    dataTypes: ["FlowRow", "FlowFilters", "FlowTrigger", "ResourceConnector"],
  },
  {
    name: "environments",
    views: ["EnvironmentsList", "EnvironmentDetail", "PdeLandscape"],
    data: [
      "listEnvironmentsPage",
      "listEnvironments",
      "listEnvironmentsStreaming",
      "getEnvironment",
      "categorizePdeEnvironment",
    ],
    dataTypes: ["EnvironmentRow", "PdeCategory"],
  },
  {
    name: "environment-groups",
    views: ["EnvironmentGroupsList", "EnvironmentGroupDetail"],
    data: ["listEnvironmentGroups", "getEnvironmentGroup", "listEnvironmentsInGroup"],
    dataTypes: ["EnvironmentGroupRow", "EnvironmentRow"],
  },
  {
    name: "dashboards",
    views: ["DashboardsList", "DashboardDetail"],
    data: [],
    dataTypes: [],
  },
  {
    name: "zones",
    views: ["ZonesView", "ZoneDetailView", "StandardCustomGroupDetailView"],
    subfolderRename: { from: "zones", to: "_components" },
    data: [],
    dataTypes: [],
  },
  {
    name: "security",
    views: ["Comparator", "DlpComparator", "Impact", "DlpImpact"],
    data: [],
    dataTypes: [],
  },
  {
    name: "queries",
    views: ["QueriesView"],
    data: [],
    dataTypes: [],
  },
  {
    name: "settings",
    views: ["SettingsView"],
    data: [],
    dataTypes: [],
  },
];

function gitMove(from, to) {
  // Ensure target dir exists.
  const dir = path.dirname(to);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  execSync(
    `git mv "${path.relative(ROOT, from).replace(/\\/g, "/")}" "${path.relative(ROOT, to).replace(/\\/g, "/")}"`,
    { stdio: "pipe", cwd: ROOT },
  );
}

/**
 * Rewrite imports inside a file that just moved from src/views/ (or
 * src/views/zones/) to src/features/<name>/ (or src/features/zones/_components/).
 *
 *   - `from "../data/inventory"` (or absolute equivalent) — left alone in
 *     features that have a per-feature data.ts wrapper; rewritten to
 *     the deeper relative path for features without one.
 *   - All other shared dirs (`components/`, `hooks/`, `services/`,
 *     `featureFlags/`, `generated/`, `data/<x>` other than inventory)
 *     get an extra `../` prepended.
 *   - zones/ subfolder moves under _components/, so `./zones/X` → `./_components/X`
 *     for top-level zones views, and intra-_components imports stay `./X`.
 */
function rewriteImports(filePath, opts) {
  const { hasFeatureData, isZonesSub, isZonesTop, featureName } = opts;
  const before = fs.readFileSync(filePath, "utf8");
  let s = before;

  // Depth from feature subdir back to src/: 2 for src/features/X/, 3 for src/features/X/_components/.
  const upToSrc = isZonesSub ? "../../../" : "../../";

  if (hasFeatureData) {
    // Inventory imports redirected to the feature's local data.ts barrel.
    s = s.replace(/from\s+"\.\.\/data\/inventory"/g, 'from "./data"');
    s = s.replace(/from\s+"\.\.\/\.\.\/data\/inventory"/g, 'from "./data"');
  } else {
    s = s.replace(/from\s+"\.\.\/data\/inventory"/g, `from "${upToSrc}data/inventory"`);
  }

  // Other src/data/<x> (non-inventory): need depth adjustment.
  s = s.replace(/from\s+"\.\.\/data\/([^"]+)"/g, (m, rest) => {
    if (rest === "inventory") return m; // already handled above
    return `from "${upToSrc}data/${rest}"`;
  });

  // src/components/<x>
  s = s.replace(/from\s+"\.\.\/components\/([^"]+)"/g, `from "${upToSrc}components/$1"`);
  s = s.replace(/from\s+"\.\.\/components"/g, `from "${upToSrc}components"`);
  // src/hooks/<x>
  s = s.replace(/from\s+"\.\.\/hooks\/([^"]+)"/g, `from "${upToSrc}hooks/$1"`);
  // src/services/<x>
  s = s.replace(/from\s+"\.\.\/services\/([^"]+)"/g, `from "${upToSrc}services/$1"`);
  // src/featureFlags
  s = s.replace(/from\s+"\.\.\/featureFlags"/g, `from "${upToSrc}featureFlags"`);
  s = s.replace(/from\s+"\.\.\/featureFlags\/([^"]+)"/g, `from "${upToSrc}featureFlags/$1"`);
  // src/generated/<x>
  s = s.replace(/from\s+"\.\.\/generated"/g, `from "${upToSrc}generated"`);
  s = s.replace(/from\s+"\.\.\/generated\/([^"]+)"/g, `from "${upToSrc}generated/$1"`);

  // Zones-specific: top-level zones views import ./zones/* → ./_components/*
  if (isZonesTop && featureName === "zones") {
    s = s.replace(/from\s+"\.\/zones\/([^"]+)"/g, 'from "./_components/$1"');
  }

  if (s !== before) {
    fs.writeFileSync(filePath, s, "utf8");
    return true;
  }
  return false;
}

function writeFeatureDataBarrel(featureDir, feature) {
  const lines = [];
  lines.push("/**");
  lines.push(` * ${feature.name[0].toUpperCase()}${feature.name.slice(1)} feature — data layer.`);
  lines.push(" *");
  lines.push(" * Thin wrapper that re-exports just the relevant pieces of the shared");
  lines.push(" * inventory data layer. Views in this folder MUST import from `./data`");
  lines.push(" * (or its barrel), never directly from `../../data/inventory`, so that:");
  lines.push(" *");
  lines.push(" *  1. The view layer only sees feature-shaped types.");
  lines.push(" *  2. When `data/inventory.ts` is later carved into");
  lines.push(" *     `shared/inventory-core/`, only this file needs to change.");
  lines.push(" *  3. ESLint boundary rules can pin this folder's views to this");
  lines.push(" *     module as the single inventory entry point.");
  lines.push(" */");
  if (feature.data.length > 0) {
    lines.push(`export {`);
    feature.data.forEach((s) => lines.push(`  ${s},`));
    lines.push(`} from "../../data/inventory";`);
    lines.push("");
  }
  if (feature.dataTypes.length > 0) {
    lines.push(`export type {`);
    feature.dataTypes.forEach((s) => lines.push(`  ${s},`));
    lines.push(`} from "../../data/inventory";`);
    lines.push("");
  }
  fs.writeFileSync(path.join(featureDir, "data.ts"), lines.join("\n"));
}

function writeRoutes(featureDir, feature) {
  const lazyImports = feature.views
    .map(
      (v) =>
        `const ${v} = lazy(() =>\n  import("./${v}").then((m) => ({ default: m.${v} })),\n);`,
    )
    .join("\n");
  // Route path mapping. We'll use heuristics; explicit map for the
  // weird ones below the heuristic.
  const ROUTE_PATHS = {
    apps: { AppsList: "/apps", AppDetail: "/apps/:appId" },
    flows: { FlowsList: "/flows", FlowDetail: "/flows/:flowId" },
    environments: {
      EnvironmentsList: "/environments",
      EnvironmentDetail: "/environments/:envId",
      PdeLandscape: "/pde-landscape",
    },
    "environment-groups": {
      EnvironmentGroupsList: "/environment-groups",
      EnvironmentGroupDetail: "/environment-groups/:groupId",
    },
    dashboards: {
      DashboardsList: "/dashboards",
      DashboardDetail: "/dashboards/:dashboardId",
    },
    zones: {
      ZonesView: "/zones",
      ZoneDetailView: "/zones/:zoneId",
      StandardCustomGroupDetailView: "/zones/custom-groups/:groupId",
    },
    security: {
      Comparator: ["/security/dlp-comparator", "/security/comparator"],
      DlpComparator: null,
      Impact: ["/security/dlp-impact", "/security/impact"],
      DlpImpact: null,
    },
    queries: { QueriesView: "/queries" },
    settings: { SettingsView: "/settings" },
  };
  const map = ROUTE_PATHS[feature.name];
  const routeLines = [];
  for (const v of feature.views) {
    const p = map[v];
    if (p === null) continue; // legacy alias views
    const paths = Array.isArray(p) ? p : [p];
    for (const rp of paths) {
      const key = `${feature.name}-${v}-${rp}`.replace(/[^a-z0-9-]/gi, "-");
      routeLines.push(`    <Route key="${key}" path="${rp}" element={<${v} />} />,`);
    }
  }
  const fnName = `${feature.name.replace(/(-|^)([a-z])/g, (_, __, c) => c.toUpperCase())}Routes`;
  const camel = fnName.charAt(0).toLowerCase() + fnName.slice(1);
  const content = `import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
${lazyImports}

/**
 * Returns the \`<Route>\` elements for the ${feature.name} feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a \`<Routes>\` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function ${camel}() {
  return [
${routeLines.join("\n")}
  ];
}
`;
  fs.writeFileSync(path.join(featureDir, "routes.tsx"), content);
  return camel;
}

function writeIndex(featureDir, feature, routesFn) {
  const content = `/**
 * ${feature.name[0].toUpperCase()}${feature.name.slice(1)} feature — public API.
 *
 * Only the routes are exported. Views, the feature-scoped data layer, and
 * any future internal components are intentionally NOT re-exported — other
 * features must not reach into them. ESLint boundary rules pin this barrel
 * as the single allowed entry point.
 */
export { ${routesFn} } from "./routes";
`;
  fs.writeFileSync(path.join(featureDir, "index.ts"), content);
}

// --- main ---
for (const feature of FEATURES) {
  const featureDir = path.join(SRC, "features", feature.name);
  if (!fs.existsSync(featureDir)) {
    fs.mkdirSync(featureDir, { recursive: true });
  }
  console.log(`\n=== ${feature.name} ===`);

  // Move top-level view files
  for (const v of feature.views) {
    const src = path.join(SRC, "views", `${v}.tsx`);
    const dst = path.join(featureDir, `${v}.tsx`);
    if (!fs.existsSync(src)) {
      console.log(`  SKIP ${v}.tsx (not found)`);
      continue;
    }
    gitMove(src, dst);
    rewriteImports(dst, {
      hasFeatureData: feature.data.length > 0 || feature.dataTypes.length > 0,
      isZonesSub: false,
      isZonesTop: feature.name === "zones",
      featureName: feature.name,
    });
    console.log(`  moved ${v}.tsx → features/${feature.name}/`);
  }

  // Subfolder move (zones)
  if (feature.subfolderRename) {
    const subSrc = path.join(SRC, "views", feature.subfolderRename.from);
    const subDst = path.join(featureDir, feature.subfolderRename.to);
    if (fs.existsSync(subSrc)) {
      // Move each file individually so git tracks renames cleanly.
      if (!fs.existsSync(subDst)) fs.mkdirSync(subDst, { recursive: true });
      for (const entry of fs.readdirSync(subSrc)) {
        const f = path.join(subSrc, entry);
        const t = path.join(subDst, entry);
        gitMove(f, t);
        rewriteImports(t, {
          hasFeatureData: feature.data.length > 0 || feature.dataTypes.length > 0,
          isZonesSub: true,
          isZonesTop: false,
          featureName: feature.name,
        });
        console.log(`  moved zones/${entry} → features/zones/_components/`);
      }
      fs.rmdirSync(subSrc);
    }
  }

  // Write feature data wrapper, routes, index
  if (feature.data.length > 0 || feature.dataTypes.length > 0) {
    writeFeatureDataBarrel(featureDir, feature);
    console.log(`  wrote data.ts`);
  }
  const routesFn = writeRoutes(featureDir, feature);
  writeIndex(featureDir, feature, routesFn);
  console.log(`  wrote routes.tsx + index.ts`);
}

console.log("\nDone.");
