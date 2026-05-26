# Coverage gaps

A live inventory of files in `src/` that **do not** have direct test
coverage, ranked by complexity (line count = rough proxy for risk).

This is auto-discoverable but documented here so future sessions can
pick up high-value targets without re-doing the analysis.

For **how** to add tests, see [`TESTING.md`](./TESTING.md).

> **Updated:** 2026-05-26. Last analysis: 125 source files, 30 test files. 70 untested non-barrel/route files.

## 🔴 High priority — large + behaviorally rich

These are the files where a regression is most likely to ship undetected and most likely to be costly:

| File | Lines | Why it matters | Test approach |
|---|---|---|---|
| `data/inventory.ts` | 2248 | The data layer's beating heart. Has tested clause builders + row mappers + paginator — but the **uncovered surface includes** specialized fetchers (`listEnvironmentGroups`, `listResourcesInEnvironment`, `countResourcesByTypeForGroup`, etc.) | More data-layer tests with mocked `QueryResources`, same `vi.hoisted` pattern as `inventory.runQuery.test.ts` |
| `features/queries/QueriesView.tsx` | 1336 | Custom query builder + raw editor + saved query CRUD. Lots of state. | View smoke + interaction tests (type clauses, click save, etc.) |
| `features/security/DlpImpact.tsx` | 1029 | Renders the DLP Impact picker + results. Calls `runImpactQuery`. | View smoke + assert hidden-connector affordances render |
| `features/security/Impact.tsx` | 831 | ACP impact equivalent. Same shape. | View smoke |
| `components/TileEditorDialog.tsx` | 809 | Dashboard tile editor. Complex form state. | View smoke + at least one "save tile" interaction test |
| `features/security/Comparator.tsx` | 774 | ACP comparator. Pure-ish (diff logic already tested) but the view orchestration isn't. | View smoke |
| `features/security/DlpComparator.tsx` | 690 | DLP comparator. Same as above. | View smoke |
| `features/environments/PdeLandscape.tsx` | 654 | Personal Developer Environment landscape view. Three-bucket categorization. | View smoke + assert bucket counts render |
| `components/TileView.tsx` | 636 | Dashboard tile renderer. Important: chart tiles must stay `source: "builder"` per AGENTS.md. | View smoke + pin the chart-tile constraint |

## 🟠 Medium priority — moderate complexity

| File | Lines | Notes |
|---|---|---|
| `components/ruleRenderers/ModelARulesetRenderer.tsx` | 485 | Renders Model A governance rules. Pure-ish — needs fixtures from `docs/admin-payload-samples.md`. |
| `data/dashboardTemplates.ts` | 430 | Built-in dashboard tile templates. Pure data — should have at least a shape-pin test. |
| `components/ruleRenderers/RuleSetRenderer.tsx` | 414 | Renders Model B rule-based policy sets. Same as Model A. |
| `components/AdminAccessGate.tsx` | 392 | Admin role check gate. Async + retry. **Worth testing the retry path.** |
| `components/UserLookupDialog.tsx` | 391 | Cmd+K user lookup. Hooks into `userEnrichment`. |
| `features/agents/AgentDetail.tsx` | 391 | Already has a smoke test through routes; could use a fuller test that exercises the connectors card, sharing block, etc. |
| `data/dashboards.ts` | 346 | Dashboard CRUD against localStorage. Easy to test (similar to `savedQueries.test.ts`). |
| `components/SideNav.tsx` | 311 | Renders sections, expanded/collapsed state. Feature-flag gated. View smoke worth having. |
| `components/CopilotChat/CopilotChatPanel.tsx` | 270 | MCS chat panel. Feature-flagged. Skip if flag is off in CI. |
| `features/dashboards/DashboardsList.tsx` | 261 | List view; mirror the AgentsList smoke pattern. |
| `features/dashboards/DashboardDetail.tsx` | 235 | Detail view; mirror AgentDetail pattern. |
| `components/UserChip.tsx` | 229 | Resolves a GUID via `useUserDisplay`. Test the three states (unknown / resolved / missing). |
| `components/ConnectorsCard.tsx` | 214 | Renders the connectors block on detail pages. Pure render — easy smoke. |

## 🟡 Zones (de-prioritized per user — prototype area)

All files under `features/zones/_components/` (`GroupEnvLane`, `ZoneColumn`, `EnvRow`, `AvailableEnvsPanel`, `GroupChip`, dialogs, etc.) plus `ZonesView`, `ZoneDetailView`, `StandardCustomGroupDetailView`. Approximately 4000 lines total. Smoke tests recommended once the area stabilizes.

The pure data layers under `data/zones.ts` and `data/standardGroups.ts` **are** tested (Phase 1) — only the UI side is untested.

## 🟢 Low priority — small / trivial

| File | Lines | Notes |
|---|---|---|
| `hooks/useSelection.ts` | 66 | Pure hook with set state. Easy `renderHook` test. |
| `hooks/useCopilotChat.ts` | 71 | Feature-flagged chat hook. |
| `hooks/useUserDisplay.ts` | 59 | useSyncExternalStore wrapper. |
| `hooks/useZones.ts` | 58 | localStorage listener subscription. |
| `featureFlags/FeatureFlagsProvider.tsx` | 49 | Provider — test that children consume context correctly. |
| `hooks/useAdminAccess.ts` | 43 | Async admin role check. Worth a quick mock test. |
| `components/UserLookupProvider.tsx` | 40 | Provider only. |
| `featureFlags/useFeatureFlag.ts` | 24 | One-line hook over context. |
| `components/detail/DateWithRelative.tsx` | 19 | Trivial render — `formatRelative` is already tested. |
| `components/detail/Meta.tsx` | 18 | Label + value pair. Skip. |
| `hooks/useUserLookup.ts` | 17 | Tiny imperative bridge. |
| `hooks/useDebouncedValue.ts` | 11 | One-liner. Quick fake-timer test. |

## ⚫ Skip — barrels, routes, types, context shells

These files are intentionally not in the inventory above:
- `*/index.ts` — re-export barrels (covered indirectly by `src/test/feature-routes.test.tsx`)
- `*/routes.tsx` — route definitions (same)
- `*/types.ts` — type-only files
- `*/context.ts` — context shells (tested via the provider)
- `src/App.tsx`, `src/main.tsx`, `src/app/HomeRedirect.tsx` — app shell
- `test/setup.ts` — vitest setup itself

## Data layer still missing

A few uncovered data-layer functions worth pulling in:

- `data/inventory.ts`: `listResourcesInEnvironment`, `countResourcesByTypeForEnvironment`, `countResourcesByTypeForGroup`, `categorizePdeEnvironment`, the streaming variants. Mock the same way `inventory.runQuery.test.ts` does.
- `data/dashboards.ts`: localStorage CRUD — mirror `savedQueries.test.ts`.
- `data/dashboardTemplates.ts`: template list — at minimum a shape-pin test that asserts the count + names.
- `data/dlpImpact.ts`: `runImpactQuery` / `queryDlpImpact` — needs mocked QueryResources fixtures. Pure helpers (extract*, count*, resolve*) are already covered.
- `data/acpImpact.ts`: `queryAcpImpact` — same.

## Suggested next sessions (in priority order)

1. **High-priority list-view smoke tests** — `QueriesView`, `DlpImpact`, `Impact`, `Comparator`, `DlpComparator`, `PdeLandscape`, `DashboardsList`, `DashboardDetail`. Each ~30 lines following the `AppsList.test.tsx` template. Total ~200 new tests for ~8h of work.

2. **Component smoke tests** — `TileEditorDialog`, `TileView`, `SideNav`, `UserChip`, `ConnectorsCard`, `AdminAccessGate`. ~50 tests for ~3h.

3. **Hook tests** — `useSelection`, `useDebouncedValue`, `useAdminAccess`, `useFeatureFlag`. ~15 tests for ~1h.

4. **Data layer fills** — `dashboards.ts`, `dashboardTemplates.ts`, residual `inventory.ts` fetchers, impact runners with captured fixtures. ~30 tests for ~3h.

5. **Rule renderers** — `ModelARulesetRenderer`, `RuleSetRenderer`, `GovernanceRuleCard`. Best done with fixtures from `docs/admin-payload-samples.md`. ~20 tests for ~2h.

6. **E2E smoke expansion** — add specs for the security pages, dashboards, queries. Each ~5 tests. Total ~30 tests for ~2h (mostly waiting on Playwright).
