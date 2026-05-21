# Roadmap

Parking lot for ideas not yet built. Each entry has enough context for a
future Copilot session (or human) to pick it up cold — schema sketches,
integration touchpoints, and references back into the existing codebase.

When you build one, move the section into the changelog / plan.md and prune
or update it here.

---

## Saved queries in a Dataverse table

> **User goal.** The Queries playground (`src/views/QueriesView.tsx`) now
> persists saved queries to **localStorage** (see `src/data/savedQueries.ts`)
> and supports a paste-clauses lane for sharing complex queries by copy/paste.
> The next evolution is moving the store from localStorage to **Dataverse**
> so favorites survive browser wipes, follow the user across machines, and
> can be shared org-wide without manual JSON ferrying.

### What already shipped (localStorage tier)

- `src/data/savedQueries.ts` — `SavedQuery` type, CRUD wrappers, storage
  key `ppcoe.savedQueries.v1`. Stores both `spec` (when source = builder)
  and `clauses` (always) so the durable contract is preserved even if the
  builder shape evolves.
- Queries view: a "Saved queries" card above Templates, a Basic/Advanced
  tab toggle in the Builder (Advanced = a live-parsed clauses textarea),
  Save / Edit / Delete actions, and a "Source: Basic / Advanced" badge.
- **Tile editor** (`src/components/TileEditorDialog.tsx`): a "Start from"
  picker lists every saved query. Picking a **Basic** saved query prefills
  the visual builder (still fully editable). Picking an **Advanced** saved
  query switches the tile into raw-clauses mode — Resource types / Filters
  / Sort hide, only KPI and Table viz types remain available, and the
  clauses JSON is shown read-only. `DashboardTile.source` / `clauses` /
  `savedQueryId` carry the raw payload through to render time;
  `TileView.tsx` runs raw tiles directly via `runRawQuery`.
- Sharing today = copy JSON out, paste JSON in. No backend, no link
  shortener, no auth surface — but also no discovery or org-wide sharing.

Moving to Dataverse keeps every public function in `savedQueries.ts`
intact at the call site; only the storage implementation swaps. Tiles
that reference a saved query via `savedQueryId` will need a small
migration to point at Dataverse row IDs.

### Prerequisites the user will set up

1. **Create the table in Dataverse** (in the same environment the app is
   published to). Suggested logical name: `coe_savedquery`.
2. **Add the Dataverse connector** to the code app via:

   ```pwsh
   npx power-apps add-data-source
   ```

   Pick *Microsoft Dataverse*, then select the `coe_savedquery` table.
   This generates a typed client under `src/generated/` and adds the
   connection reference to `power.config.json` — same flow we did for
   `shared_powerplatformadminv2`.
3. Decide on ownership/sharing model — see notes below.

### Suggested table schema

| Logical name | Display name | Type | Notes |
| --- | --- | --- | --- |
| `coe_name` | Name | Text (100) | Primary column. |
| `coe_description` | Description | Multiline text (500) | Optional. |
| `coe_clausesjson` | Clauses JSON | Multiline text (~16 KB) | Serialized `Clause[]` payload — what `runRawQuery` consumes. Source of truth so the saved query keeps working even if the visual builder shape changes. |
| `coe_specjson` | Builder spec JSON | Multiline text (~4 KB) | Serialized `QuerySpec` — what the visual builder needs to round-trip a save. |
| `coe_resourcetypes` | Resource types | Multiline text | Semicolon-joined `type` values; lets us filter/group in the saved-queries UI without parsing the spec. |
| `coe_visibility` | Visibility | Choice | `Private` (creator only), `Shared` (whole tenant), `LinkOnly` (anyone with the GUID) — optional, depends on sharing model below. |
| `coe_pagesize` | Page size | Whole number | Optional default for the run. |
| `coe_tags` | Tags | Multiline text | Optional `tag1;tag2`. |
| Audit fields | — | — | Dataverse provides `createdon`, `createdby`, `modifiedon`, `modifiedby`, `ownerid` automatically. |

> **Why store both `coe_clausesjson` and `coe_specjson`?** The clauses are
> what the connector actually consumes — they're the contract. The spec is
> what the visual builder needs to repopulate its UI. Storing both means
> opening a saved query both runs correctly *and* shows the same controls
> the original author saw, even if we evolve the builder later.

### Ownership / sharing model — two reasonable paths

- **User-owned rows.** Simplest. Each user sees only what they created
  (Dataverse's default user/team security). Add a "Share with…" button later
  that calls the Dataverse `GrantAccess` action.
- **Org-owned rows + `coe_visibility` field.** Rows visible to everyone in
  the env, but the app filters/respects the `Private`/`Shared`/`LinkOnly`
  flag. Use `_createdby_value` to enforce "Private" client-side. Easier to
  bootstrap but trusts the client.

Recommendation: **start with user-owned rows + an optional org-shared role
for power users**. Defer per-row visibility until needed.

### Data layer changes

Add a new module — e.g. `src/data/savedQueries.ts` — that wraps the
generated Dataverse client and exposes:

```ts
export interface SavedQuery {
  id: string;            // Dataverse row id
  name: string;
  description: string;
  spec: QuerySpec;       // parsed from coe_specjson
  clauses: Clause[];     // parsed from coe_clausesjson
  resourceTypes: ResourceTypeValue[];
  pageSize: number;
  tags: string[];
  createdBy: string;
  createdOn: string;
  modifiedOn: string;
  isOwnedByMe: boolean;
}

export async function listSavedQueries(): Promise<DataResult<SavedQuery[]>>;
export async function getSavedQuery(id: string): Promise<DataResult<SavedQuery | null>>;
export async function createSavedQuery(input: { name; description; spec; clauses; pageSize?; tags? }): Promise<DataResult<SavedQuery>>;
export async function updateSavedQuery(id: string, patch: Partial<...>): Promise<DataResult<SavedQuery>>;
export async function deleteSavedQuery(id: string): Promise<DataResult<void>>;
```

Use the same `DataResult<T>` discriminated union we already have in
`inventory.ts` (and the `formatError` helper) so error UX is consistent.

### View changes (`src/views/QueriesView.tsx`)

- **New "Save query" button** next to **Run query**. Opens a dialog asking
  for Name, Description, Tags, Visibility (if we go that route). Persists
  the current `spec` + the generated `clauses` (`buildClausesFromSpec(spec)`).
- **New section above Templates: "Saved queries (N)"** — same card pattern.
  Each card shows name + description + a small chip strip of resource
  types + tags. Click → load the spec into the builder (just like
  `applyTemplate`). Long-press / hover button to **Run directly without
  loading into builder** (nice future ergonomic).
- Each saved card has **Edit** (rename, retag), **Duplicate**, and
  **Delete** (with confirm) actions.
- When the user runs a saved query and tweaks it, show an
  "Unsaved changes — Update saved query?" hint at the top.
- Optional: **Run on schedule** field (datetime + frequency) — saved
  rows become candidates for a future scheduled-export feature.

### Optional follow-up ideas this unlocks

- **Saved queries → scheduled CSV exports.** A Power Automate flow that
  runs nightly, reads all saved queries with `coe_schedule != null`,
  calls the inventory API with each clauses payload, and dumps the CSV
  into SharePoint / OneDrive / blob.
- **Saved queries → alerts.** Add a `coe_alertcondition` field
  ("rowCount > X", "any row matches Y"). A daily flow fires Teams
  notifications when a condition trips.
- **Shareable links.** `/queries?savedId=<guid>` deep-link that hydrates
  the builder from a saved row. Requires HashRouter to honor query
  strings — check current routing config.
- **Org templates.** Promote a saved query to a "Tenant template" that
  all users see — extends the existing static `QUERY_TEMPLATES` with a
  Dataverse-backed list.

### File touchpoints when this is built

- New: `src/data/savedQueries.ts` (Dataverse CRUD wrapper).
- Edit: `src/views/QueriesView.tsx` (Saved Queries section + Save dialog).
- Edit: `src/data/inventory.ts` — re-export `Clause` if not already, since
  the saved-queries module needs the type. (Currently only exported via
  `import type { Clause } from "../generated/models/..."`.)
- Add: `power.config.json` gains a new connection ref for Dataverse.
- Add: `src/generated/...` will grow with the new Dataverse client.

### Things to verify before building

- Confirm the code-app host actually allows opening multiple connectors
  in one app (we've only used one so far). The
  [add-flows docs](https://learn.microsoft.com/power-apps/developer/code-apps/how-to/add-flows)
  suggest yes, but worth a quick smoke test.
- Confirm the user identity flows through cleanly so `createdby` is the
  actual user (not a service principal).
- Decide whether to also expose this in non-Queries views (e.g. save a
  filter state from `/apps` as a "saved view"). Probably out of scope for
  v1, but the table is generic enough.

---

## Other parked ideas (one-liners)

- **Connector inventory rollup** — top-level view that fans out across all
  apps/flows/agents and rolls up which connectors are most used, which
  envs use SQL, etc. The data is already in our existing detail-row
  payload (`row.connectors`).
- **Server-side `where contains` on connectorId** — let a user filter the
  Apps list to "apps using shared_office365". Needs validation that
  `where properties.powerPlatformConnectors contains 'shared_office365'`
  actually works against a nested array — may need an `extend`/`mv-expand`
  trick.
- **Operation-level audit** — find every app that uses
  `shared_sql / ExecuteStoredProcedure`. Same trick as above.
- **Bundle splitting** — see the **Bundle optimization** section below for the full plan.
- **Lazy route loading** — covered in the **Bundle optimization** section.
- **Env picker → Combobox with typeahead** — the current Dropdown shows
  only the first 500 envs. Replace with a Combobox that types-down to
  the server when a tenant has more.
- **Saved CSV export presets** — let the user pick which columns to include
  in a CSV (instead of always flattening everything).
- **Sticky filters via URL params** — push current filter state into the URL
  so links are shareable and back/forward works.

---

## Bundle optimization (split vendor + lazy routes)

> **Status as of last session.** Build produces a single
> `dist/assets/index-*.js` ≈ **1.49 MB** (≈ 395 KB gzip). Vite emits its
> 500 KB chunk-size warning on every build. Fine while iterating locally;
> not fine when this app is published — every cold load downloads the whole
> thing before the user sees a thing.

### What's actually in the 1.5 MB

Three sources dominate, roughly:

| Component | Estimated size | Why |
| --- | --- | --- |
| `@fluentui/react-components` (+ icons + griffel + react-aria deps) | ~700–900 KB | Every view imports several components. We pay for the *entire* library because Vite has no chunk hints. |
| `recharts` (+ d3 deps) | ~440 KB | Pulled in by `TileView` only. Only the Dashboards / Home routes need it — every other route loads it for nothing today. |
| Our app code + generated client | ~150 KB | The generated `PowerPlatformforAdminsV2Service` is the biggest of these — has bindings for every action on the connector. |

### Plan

Two changes, independent, in priority order:

#### 1. Lazy-load every view (biggest win, lowest risk)

Wrap each route in `React.lazy` so the bundle is naturally code-split per
route. Wrapped views download only when the user navigates to them.

```tsx
// src/App.tsx
import { Suspense, lazy } from "react";
import { LoadingPane } from "./components/Status";

const EnvironmentGroupsList = lazy(() =>
  import("./views/EnvironmentGroupsList").then((m) => ({ default: m.EnvironmentGroupsList }))
);
const EnvironmentGroupDetail = lazy(() =>
  import("./views/EnvironmentGroupDetail").then((m) => ({ default: m.EnvironmentGroupDetail }))
);
// …and so on for every other view…

function AppShell() {
  return (
    <div className={styles.app}>
      <TopBar />
      <div className={styles.body}>
        <SideNav />
        <main className={styles.content}>
          <Suspense fallback={<LoadingPane label="Loading…" />}>
            <Routes>
              {/* unchanged */}
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
```

**Why this helps so much:** `recharts` is currently in the eager bundle
because *some* view (TileView) statically imports it. Move TileView to a
lazy boundary (Dashboard routes) and recharts moves with it. Users who
never open Dashboards stop downloading 440 KB.

**Watch-outs:**

- `HomeRedirect` resolves synchronously from localStorage — keep it
  *eager*, since it runs at `/` for every cold load. Lazy-loading it
  would add a flash.
- The `Suspense` fallback must not itself be lazy. Reuse the existing
  `LoadingPane`.
- A few components are imported from non-view modules (e.g.
  `EnvironmentPicker` is reused by AppsList, FlowsList, AgentsList,
  QueriesView). Those stay eager — they're shared across multiple lazy
  chunks and Vite will pull them into the common chunk automatically.

#### 2. Manual chunks for the heavyweights

Tell Rollup to split Fluent + recharts into named long-lived chunks. These
hashes change rarely, so returning users get them from cache.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "vite-plugin-power-apps"; // existing

export default defineConfig({
  plugins: [react(), powerApps()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // 700–900 KB — almost everything Fluent depends on.
          fluent: [
            "@fluentui/react-components",
            "@fluentui/react-icons",
          ],
          // 440 KB — only loaded behind Dashboards once lazy-loading is on.
          charts: ["recharts"],
          // 150 KB — only QueriesView + dashboards need router APIs deeply.
          router: ["react-router-dom"],
        },
      },
    },
  },
});
```

After both changes, expect (approximate, tenant-agnostic):

| Chunk | Size (raw / gzip) | When downloaded |
| --- | --- | --- |
| `index` (app shell + Home + redirect) | ~100–150 KB / ~35 KB | Always, on cold load |
| `fluent` | ~800 KB / ~210 KB | First view that needs it (= immediately, but cached on later loads) |
| `charts` | ~440 KB / ~120 KB | First Dashboard visit only |
| Per-view chunks | 5–30 KB each | On route navigation |

Net effect: first paint cost drops to roughly `index + fluent` (~245 KB
gzip) instead of the current `~395 KB gzip` everything-in-one bundle, and
the heaviest piece (charts) is paid only when warranted.

### How to verify

After the changes:

```pwsh
npm run build
```

- Watch for the chunk-size warning to disappear (or shrink to just
  `fluent`, which is acceptable for a vendor chunk).
- Inspect the `dist/assets/` listing — there should now be a handful of
  files, not one. Names like `index-*.js`, `fluent-*.js`, `charts-*.js`,
  and per-view chunks (`QueriesView-*.js`, `DashboardDetail-*.js`, …).
- Open the app, navigate Home → Apps → Dashboards. The Network panel
  should show new `.js` files load on each navigation, only once.

### Things that could trip this up

- **Generated client.** `PowerPlatformforAdminsV2Service` is statically
  imported by `inventory.ts`. That keeps the connector binding in the
  index chunk — fine, since every view talks to inventory. Don't try to
  lazy-load it.
- **Fluent dynamic theming.** If we add Dark mode + theme switching
  later (it's in the parked-ideas list), keep the `FluentProvider`
  eager — it wraps every route.
- **Power Apps host quirks.** Some embedded hosts have been known to
  rewrite asset paths. If routes 404 on JS chunks after deploy, check
  the `base` setting in `vite.config.ts` and confirm the host honors
  hashed filenames.

### Out of scope (for now)

- Switching component libraries to shrink Fluent. We're using a lot of
  Fluent and the cost is justified by the UX consistency. Don't go
  there.
- Tree-shaking individual Fluent icon imports. Fluent's icons package is
  already side-effect-free per its `package.json` — Vite handles this
  via `import { X } from "@fluentui/react-icons"` style we already use.
- Dynamic-import of recharts at the tile level (instead of route level).
  Route-level is simpler and just as effective.

