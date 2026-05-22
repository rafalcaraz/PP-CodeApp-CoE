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
  we've already paid for. Maintain this file as the schema evolves.
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
