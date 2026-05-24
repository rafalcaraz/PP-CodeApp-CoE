# PP-CodeApp-CoE
This a code prototype to demonstrate an idea of creating custom CoE based on inventory data provided

## Repo layout

```
PP-CodeApp-CoE/
├── PP-CoE-CodeApp/       # The Power Apps Code App (React 19 + TS + Vite + Fluent UI)
├── solution/             # Unpacked Power Platform solution (PPCoECodeApp)
│   ├── src/              # Tracked: Solution.xml, Customizations.xml, CanvasApps/*.meta.xml
│   └── out/              # (gitignored) Packed solution zips
├── scripts/
│   ├── pack-solution.mjs # Build the Code App + pack the solution zip
│   └── pull-solution.mjs # Re-sync solution/src/ from Dataverse
└── .github/
    └── workflows/        # CI, CodeQL, release
```

## Reference docs

- **[Inventory schema samples](./PP-CoE-CodeApp/docs/inventory-schema-samples.md)** —
  real `properties` payloads for every resource type the app reads (canvas
  apps, model-driven apps, code apps, app-builder apps, cloud flows, agents,
  environments, environment groups), plus the KQL / clause-builder gotchas
  we've already paid for. Includes the canonical
  [Owner / creator GUID resolution](./PP-CoE-CodeApp/docs/inventory-schema-samples.md#owner--creator-guid-resolution)
  callout — what `ownerId` / `createdBy` GUIDs can actually point to
  (member user, guest, deleted account, **service principal /
  Enterprise Application**, managed identity), why an `aaduser` miss
  ≠ "deleted user", and the implications for ownerless-asset tiles
  and maker-attribution rollups. **Read that section before adding any
  owner name lookup, ownerless filter, or maker-attribution dashboard.**
  Maintain this file as the schema evolves.
- **[Roadmap](./PP-CoE-CodeApp/docs/roadmap.md)** — parking lot for ideas
  not yet built (saved queries in Dataverse, connector inventory rollups,
  bundle splitting, etc.). Each entry has enough context to start from cold.
- **[Portal actions engine](./PP-CoE-CodeApp/docs/portal-actions.md)** —
  the registry-driven command-bar strip at the top of each detail page
  (Open in Copilot Studio, PPAC, Power Apps maker, Power Automate maker,
  Manage MCS credits, …). Read this before adding a new portal button or
  wiring the bar onto another detail page.
- **[Admin connector inventory](./PP-CoE-CodeApp/docs/admin-connector-inventory.md)** —
  parking lot of read-only Power Platform / PowerApps / Power Automate
  admin-connector operations we *could* surface as **supplemental,
  on-demand** enrichments (never part of the bulk inventory load). Read
  this before adding a "Load admin details" / "Fetch role assignments" /
  capacity-style button.
- **[Admin payload samples](./PP-CoE-CodeApp/docs/admin-payload-samples.md)** —
  real, redacted payloads captured from a live tenant for the
  admin-connector enrichments. Sibling to `inventory-schema-samples.md`
  but for the per-record `Get_*` / `List_*` calls. Includes the critical
  "two governance models for env groups" caveat (legacy ruleset
  parameters vs. new rule-based-policy `ruleSets`).
- **[Governance rules catalog](./PP-CoE-CodeApp/docs/governance-rules-catalog.md)** —
  the full schema reference for every known env-group rule (Model A
  parameter buckets and Model B rule-based policies). Lists PPAC
  display names, input schemas, value domains, and which rules have
  typed renderers vs. fall through to raw JSON. Read this before
  adding a new rule renderer to `src/components/ruleRenderers/`.
- **[Copilot Studio integration](./PP-CoE-CodeApp/docs/copilot-studio-integration.md)** —
  how the global floating "CoE Assistant" chat panel is wired to a
  Microsoft Copilot Studio agent, and how it is gated behind the
  `copilotStudioAssistant` feature flag (default **off**). Covers
  prereqs (`pac connection list`, publishing the agent), the one-time
  `pac code add-data-source` for `shared_microsoftcopilotstudio`, the
  two placeholders you need to replace (`AGENT_NAME` + the MCS
  connectionId in `power.config.json`), the user-facing toggle at
  Settings → Feature flags, and the documented troubleshooting checklist.
- **[Connector generator fixup](./PP-CoE-CodeApp/docs/connector-generator-fixup.md)** —
  why `src/generated/services/*.ts` sometimes ships with invalid
  TypeScript (hyphenated `api-version` params, etc.), how the
  `postinstall` hook in `PP-CoE-CodeApp/package.json` auto-heals it
  via `scripts/fixup-generated-connectors.mjs`, and what to do when
  you add a new data source.

## Releases

The Code App is packaged into a Power Platform managed solution
(`PPCoECodeApp`) and shipped as a GitHub Release. See
[`solution/README.md`](./solution/README.md) for:

- How to pull cloud changes back into git (`node scripts/pull-solution.mjs`)
- How to build a self-contained zip from source (`node scripts/pack-solution.mjs [--managed]`)
- How the [release workflow](./.github/workflows/release.yml) ships managed zips
  to GitHub Releases (manually dispatched, tagged `v${version}` from
  `Solution.xml`)

CI (lint + type-check + build) runs on every push/PR via
[`ppcoecodeapp-ci.yml`](./.github/workflows/ppcoecodeapp-ci.yml); CodeQL runs
on push/PR + weekly via
[`ppcoecodeapp-codeql.yml`](./.github/workflows/ppcoecodeapp-codeql.yml).
