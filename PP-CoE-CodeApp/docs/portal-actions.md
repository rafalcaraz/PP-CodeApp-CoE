# Portal actions engine

> **What this is.** A small registry-driven engine that renders a D365-style
> command-bar strip at the top of every entity detail page. Each button
> deep-links into an external Power Platform portal (Copilot Studio, PPAC,
> Power Apps maker, Power Automate maker, …) using context the page already
> has loaded.
>
> **Why a registry.** Adding a portal or wiring a new entity type is a
> one-file change. Detail pages don't care which portals exist — they just
> hand a `PortalContext` to `<PortalActionsBar>` and the registry decides
> what's applicable.

## File layout

```
src/components/PortalActions/
  types.ts             — PortalEntityKind, PortalContext, PortalDefinition,
                          PortalAction, PortalKind, resourceTypeToEntityKind()
  registry.ts          — PORTAL_REGISTRY[] + getPortalActions(ctx)
  PortalActionsBar.tsx — the toolbar component consumers render
  index.ts             — barrel re-export
```

## Concepts

- **`PortalEntityKind`** — narrow union of the entity shapes the engine
  understands today: `agent`, `canvasApp`, `modelDrivenApp`, `codeApp`,
  `appBuilderApp`, `cloudFlow`, `agentFlow`, `workflowAgentFlow`,
  `environment`, `environmentGroup`. Decoupled from the raw
  `microsoft.*/...` resource type strings so URL builders can branch
  exhaustively without re-parsing them. `resourceTypeToEntityKind()` maps
  one direction; the reverse isn't needed.

- **`PortalContext`** — everything a URL builder might want. `entityKind`
  and `entityId` are required; the rest (`environmentId`, `schemaName`,
  `logicalName`, `appModuleId`, `workflowEntityId`) are optional. URL
  builders that need a field guard for it via `isApplicable(ctx)`.

  > **GUIDs only.** Both `entityId` and `environmentId` are bare GUIDs.
  > That matches what the inventory data layer (`src/data/inventory.ts`)
  > stores — `id` is read from `item.name`, which the API guarantees to be
  > a GUID; `environmentId` likewise.

- **`PortalKind`** — stable identifier per portal entry. Treat existing
  values as frozen (telemetry / tests may key off them); freely add new
  ones.

- **`PortalDefinition`** — `{ kind, portalName, label?(ctx),
  description?(ctx), icon, isApplicable(ctx), buildUrl(ctx) }`. Registry
  entries live in `PORTAL_REGISTRY` in `registry.ts`.

- **`<PortalActionsBar context={...} />`** — Fluent `Toolbar` of
  `ToolbarButton`s. Each button:
  - Opens in a new tab (`target="_blank" rel="noopener noreferrer"`).
  - Shows leading icon + label, flat (`appearance="subtle"`), regular
    weight — matches the D365 / model-driven command bar look.
  - Has a `Tooltip` describing the destination + the URL.
  - The bar breaks out of the page's `spacingHorizontalXXL` content
    padding via negative inline margin so the strip spans edge-to-edge.
  - Renders nothing (`null`) when no portal action is applicable, so it's
    safe to mount unconditionally.

## How to add a portal

1. Add a new value to `PortalKind` in `types.ts`.
2. Append an entry to `PORTAL_REGISTRY` in `registry.ts`:
   ```ts
   {
     kind: "myPortal",
     portalName: "My Portal",
     icon: createElement(SomeIconRegular),
     isApplicable: (ctx) => ctx.entityKind === "..." && !!ctx.environmentId,
     buildUrl: (ctx) => `https://.../${encodeURIComponent(ctx.entityId)}`,
     label: (ctx) => "Open in My Portal",      // optional
     description: (ctx) => "...",              // optional
   }
   ```
3. If the URL needs a field that isn't on `PortalContext` yet, add it as
   an optional field on the interface (and pass it from the relevant
   detail page).

That's it — every detail page already mounting `<PortalActionsBar>` will
automatically pick up the new button when `isApplicable` returns true.

## How to wire a detail page

```tsx
import { PortalActionsBar } from "../components/PortalActions";

<PortalActionsBar
  context={{
    entityKind: "agent",          // or "canvasApp" / "cloudFlow" / ...
    entityId: row.id,             // bare GUID
    environmentId: row.environmentId,
    // schemaName, logicalName, appModuleId, workflowEntityId as needed
  }}
/>
```

**Placement.** Drop it as a sibling of the page title block — between the
`<Breadcrumb>` and the `<div className={styles.headerBlock}>` (or the
equivalent header div on the page). The bar handles its own edge-to-edge
break-out so consumers don't need any wrapping `<div>` or extra styles.

## Wiring status

| Detail page                  | Wired? |
| ---                          | ---    |
| `AgentDetail.tsx`            | ✅     |
| `EnvironmentDetail.tsx`      | ✅     |
| `AppDetail.tsx`              | ✅     |
| `FlowDetail.tsx`             | ✅     |
| `EnvironmentGroupDetail.tsx` | ✅     |

All five resource detail pages render the bar; the registry handles every
entity kind they surface. `DashboardDetail.tsx` is intentionally
out-of-scope — it's a user-editable tile dashboard, not a Power Platform
resource view, so no external portal applies.

## Portal entries today

| Kind                 | Entity kinds                                                                 | URL template                                                                                          |
| ---                  | ---                                                                          | ---                                                                                                   |
| `copilotStudio`      | `agent`                                                                      | `https://copilotstudio.microsoft.com/environments/{env}/bots/{id}/overview`                           |
| `ppac`               | `environment`, `environmentGroup`                                            | env → `.../manage/environments/environment/{id}/hub`; group → `.../manage/envgroups/{id}/details`     |
| `ppacMcsCredits`     | `environment`                                                                | `https://admin.preview.powerplatform.microsoft.com/billing/licenses/CopilotStudio/environmentview/{env}` |
| `powerAppsMaker`     | `canvasApp`, `modelDrivenApp`, `codeApp`, `appBuilderApp`, `environment`     | canvas → `.../environments/{env}/canvas/canvasapps/{id}/details`; others → `.../environments/{env}/apps/{id}`; env → `.../environments/{env}/apps` |
| `powerAutomateMaker` | `cloudFlow`, `agentFlow`, `workflowAgentFlow`, `environment`                 | flow → `.../environments/{env}/flows/{id}/details`; env → `.../environments/{env}/flows`              |

## URL gotchas (don't relearn these)

1. **Copilot Studio bot key is the agent GUID, NOT the schema name.** Using
   `schemaName` 404s. `entityId` (= inventory `id` = `item.name`) is what
   the portal routes on.
2. **MCS credits view lives on the preview admin host today**
   (`admin.preview.powerplatform.microsoft.com`). When it graduates to GA,
   flip `PPAC_PREVIEW_BASE` → `PPAC_BASE` in `registry.ts` (one line) and
   delete the preview constant if nothing else uses it.
3. **All URL params are `encodeURIComponent`'d.** GUIDs don't strictly
   need it, but environment names occasionally get repurposed for display
   IDs — keep the encoding so future entity kinds (Dataverse table editor,
   solution explorer, etc.) don't surprise us.
4. **`isApplicable` should guard every field its `buildUrl` reads.**
   Otherwise an entity without an `environmentId` silently produces
   `.../environments//apps/...`. The existing entries all do this; copy
   the pattern.

## Future portal candidates (parking lot)

Drop these in when there's a need; each is a single registry entry.

- **Dataverse Tables editor** — `make.powerapps.com/e/{env}/data/tables/{logicalName}`
  for model-driven apps when `logicalName` is known.
- **Solutions explorer** — `make.powerapps.com/environments/{env}/solutions`
  on environment, or `/solutions/{solutionId}` if we ever surface solution
  membership.
- **Power Platform Advisor / CoE Starter Kit** — if/when the tenant uses
  the public CoE solution, a deep-link into its model-driven dashboards.
- **Run the app** — `apps.powerapps.com/play/e/{env}/a/{id}` for canvas
  apps (different host from the maker portal).
- **Flow runs history** — `make.powerautomate.com/environments/{env}/flows/{id}/runs`.
- **Power Pages** — if/when the inventory schema starts exposing them.
- **Agent test chat** — Copilot Studio test surface (
  `copilotstudio.microsoft.com/environments/{env}/bots/{id}/test`).

Each is a one-entry add and (if the URL needs a new context field) a
one-line addition to `PortalContext`.
