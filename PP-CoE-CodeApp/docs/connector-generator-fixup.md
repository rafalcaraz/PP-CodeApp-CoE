# Connector generator fixup

The Power Apps Code App tooling generates typed clients into
`src/generated/services/` and `src/generated/models/` whenever you add
or update a connector data source (e.g. via maker portal "Add data",
`pac code add-data-source`, or the Vite Power Apps plugin on startup).

Some of those generated files contain **invalid TypeScript** out of the
box. We patch them mechanically so the project compiles. This doc
explains the bug, the fix, and how to recover when a regeneration
clobbers the patches.

## TL;DR

- A regen of `src/generated/services/*.ts` may reintroduce TS1005 /
  TS1109 / TS1016 errors.
- We auto-heal via a **postinstall** hook that runs
  [`scripts/fixup-generated-connectors.mjs`](../../scripts/fixup-generated-connectors.mjs).
- If you ever see syntax errors in `src/generated/services/`, run:

  ```sh
  node scripts/fixup-generated-connectors.mjs
  ```

  or just `npm install` again from `PP-CoE-CodeApp/` — the postinstall
  fires either way.

## The underlying bug

The generator emits OpenAPI **on-the-wire** parameter names (e.g.
`api-version`) directly into TypeScript signatures and type literals
without quoting them. Hyphens are not legal JS identifier characters, so
the file fails to parse:

```ts
// ❌ As-generated (invalid TS):
public static async GetPolicyV2(policy: string, api-version?: string)
const params: { policy: string, api-version?: string } = { policy, api-version };
```

The sibling V2 service (`PowerPlatformforAdminsV2Service.ts`) was
hand-fixed by the connector team using this pattern:

```ts
// ✅ Hand-fixed:
public static async GetPolicyV2(policy: string, apiVersion?: string)
const params: { policy: string, "api-version"?: string } = { policy, "api-version": apiVersion };
```

The legacy `PowerPlatformforAdminsService.ts` did not get the fix, and
new connectors with `api-version` parameters tend to ship broken.

## The fixup

`scripts/fixup-generated-connectors.mjs` walks every file under
`src/generated/services/` and applies four idempotent transforms:

| # | Transform | Pattern |
|---|-----------|---------|
| 1 | Function parameter rename | `(api-version?: T)` → `(apiVersion?: T)` |
| 2 | Type-literal key quoting  | `{ api-version?: T }` → `{ "api-version"?: T }` |
| 3 | Shorthand expansion       | `{ api-version, ... }` → `{ "api-version": apiVersion, ... }` |
| 4 | `NewEnvironmentPolicy` param-order | required `environment` after optional `apiVersion` → make `environment` optional |

All four are idempotent — running on already-fixed code is a silent
no-op. If Microsoft ever fixes the generator upstream, the script
gracefully matches nothing and stops doing anything; remove it then.

## Why the auto-run

The script is wired into `PP-CoE-CodeApp/package.json` as `postinstall`:

```json
{
  "scripts": {
    "postinstall": "node ../scripts/fixup-generated-connectors.mjs"
  }
}
```

That means:

- `npm ci` (local + CI) self-heals on first install
- `npm install` after pulling a branch with regenerated files self-heals
- After running `pac code add-data-source` and `npm install` to refresh
  dependencies, the new connector is healed in the same step

CI separately runs `npx tsc --noEmit`, which would loudly fail the build
if a regen ever slips through unhealed — so you have a safety net even
if the postinstall is bypassed.

## When you add a new data source

1. Add the connector via your normal flow (maker portal / `pac` / VS Code).
2. The Code App tooling writes new files into `src/generated/services/`
   and `src/generated/models/` and updates `.power/schemas/`.
3. Run `npm install` (or `npm ci`) in `PP-CoE-CodeApp/`. The postinstall
   fires and patches anything broken.
4. Build / typecheck. If `tsc --noEmit` still fails, the connector has a
   **new** bug pattern not covered by this script. Extend
   `scripts/fixup-generated-connectors.mjs` with another transform and
   update this doc.

## Files this script will touch

Only files matching `PP-CoE-CodeApp/src/generated/services/*.ts`. It
never touches:

- `src/generated/models/*` (model types are emitted correctly)
- `.power/schemas/*` (raw connector schema JSON)
- `src/data/*` (your hand-written code — including
  `src/data/dlpPolicies.ts`, the narrow DLP wrapper)
- Anything outside `src/generated/services/`

If you need a non-mechanical fix (a bug pattern the regex transforms
can't safely handle), do it in your hand-written wrapper in
`src/data/`, not in the generated file.
