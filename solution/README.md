# Solution — Dataverse-side artifacts

This folder holds the **unpacked** Power Platform solution that wraps the
**PP CoE Code App**. The solution unique name in Dataverse is **`PPCoECodeApp`**.

| Component | Purpose |
|---|---|
| **Other/Solution.xml** | Solution manifest (unique name, **version**, dependencies, root components) |
| **Other/Customizations.xml** | Connection references, root component declarations |
| **CanvasApps/\<appName\>.meta.xml** | Code App metadata stub for PP CoE Code App |

> **Note:** The compiled Code App bundle (`CanvasApps/<appName>_CodeAppPackages/`) is gitignored — it's regenerated on every `npx power-apps push` and on every `node scripts/pack-solution.mjs`. Only the `.meta.xml` stub is tracked.

The Cost Controls connector is included with
`msftcsa_MACCostControlsConnRef`. Its OAuth settings reference
`msftcsa_MACCostControlsClientId` and `msftcsa_MACCostControlsClientSecret`;
their committed definitions contain only the nonfunctional placeholders
`MAC-CLIENT-ID` and `CLIENT-SECRET`, never actual credentials.
Supply the values privately in the destination environment and create/bind
the connector connection there. Never commit exported defaults containing
credentials, signed connector download URLs, or resolved connection IDs.
The tracked Code App metadata preserves logical connection references without
source-environment connection IDs; resolve bindings in the destination.

Before publishing, run `node --test scripts/connection-config.test.mjs` from
the repository root. This checks that each exported flow's invoker connections
are mapped to the matching app dependencies, including the licensing wrapper.
The checked-in HTTP connection IDs are placeholders: resolve Graph, licensing,
and Power Platform API bindings privately in the source environment before
pushing. This check verifies source wiring, not published metadata or player
consent. Inspect the exported app's logical references and flow dependencies
after publishing, before releasing the managed ZIP.

### Local-development connection admission

`npm run dev` uses the modern Vite plugin, which serves the active app-root
`power.config.json` at `__vite_powerapps_plugin__/power.config.json`. The local
player admits **all registered connections**, including flow dependencies and
unused feature routes, before the React app can run. A deployed app uses its
published registration instead; healthy deployed consent does not prove that
the local configuration is resolved.

The tracked configuration deliberately has three `<connection-id>` HTTP
placeholders. The dev-only local binding overlay resolves these from
`PP-CoE-CodeApp/power.bindings.local`, which is excluded by the existing
`*.local` ignore rule. Keep tracked `power.config.json` unchanged. Bind each
logical reference to an existing healthy connection in its configured environment,
keeping logical references and flow aliases unchanged:

| Logical reference | Purpose / audience | Invoker dependency |
|---|---|---|
| `msftcsa_HTTPEntraPreAuthGraph` | Direct Graph calls, `https://graph.microsoft.com` | None (`webcontents` data source) |
| `msftcsa_PPLicensingAPI` | `https://licensing.powerplatform.microsoft.com` | `PPLicensingAPI-Wrapper-Flow`, `shared_webcontents-1` |
| `msftcsa_HTTPWithEntraPPAPI` | `https://api.powerplatform.com` | `PP-API-Wrapper-Flow`, `shared_webcontents` |

The HTTP display names are identical, but these are not duplicate references.
Do not bind all three to the healthy Power Platform API connection or switch
flows from invoker to embedded connections to bypass admission.

The private file is JSON with exactly `environmentId` and `sharedConnections`.
The latter maps the three logical names above to full
`/providers/Microsoft.PowerApps/apis/shared_webcontents/connections/<connection-id>`
paths. Its environment must equal the tracked configuration's environment.
The overlay replaces only existing `sharedConnectionId` fields; it does not add
connectors, change flow mappings, or pin unshared OAuth connectors. Invalid private
metadata returns an explicit admission error, not unresolved fallback bindings.
The file is read on each metadata request, and its raw file URL is blocked.
It is not included in production builds or publishing configuration.

`msftcsa_MACCostControlsConnRef` is a separate custom-connector connection. Its
lack of a pinned `sharedConnectionId` is not itself an error. If the player asks
to refresh it, inspect that connection's actual failure in the configured
environment and its solution binding. Its OAuth configuration depends on
`msftcsa_MACCostControlsClientId` / `msftcsa_MACCostControlsClientSecret`; the
tracked placeholders do not establish the live values. Token expiry, missing
consent, invalid client settings and permissions need the actual connection
error to distinguish. Do not assume expiry or change credentials automatically.

Use the **Local Play** URL printed by the current dev server after local
private-binding updates. Never commit resolved connection IDs or credentials, and
never apply the legacy PAC publishing translation to the modern local-dev
configuration. Repairing local bindings does not require publishing or
changing/removing the app's capabilities.

### Connection-safe publishing workaround (`pa` 1.3.0)

The `pa` 1.3.0 push mapper omits `xrmConnectionReferenceLogicalName`, even when
registration saved it correctly. Publishing with it can drop solution-aware
HTTP bindings from the exported app. The older `pac code push` preserves those
fields, but requires flow connections in its older dependency/hint format,
not the modern `workflowDetails` format.

After building, use the adapter below with a **privately resolved modern
configuration**. It preserves logical reference names, translates flow
dependencies and Dataverse metadata, and rejects unresolved HTTP bindings.
It writes only to a new directory outside the repository and does not publish.

```powershell
node --test scripts\connection-config.test.mjs scripts\prepare-code-app-publish.test.mjs
node scripts\prepare-code-app-publish.mjs --config "<private-resolved-power.config.json>" --output "<new-private-publish-directory>"
Push-Location "<new-private-publish-directory>"
pac code push --environment "<source-environment-id>" --solutionName PPCoECodeApp
Pop-Location
```

Verify a fresh solution export before releasing: the app's
`ConnectionReferences` and `CdsDependencies` must retain
`msftcsa_HTTPEntraPreAuthGraph`, `msftcsa_PPLicensingAPI`, and
`msftcsa_HTTPWithEntraPPAPI`. The licensing flow must depend on its HTTP entry
through `parameterHintsV2.shared_webcontents-1`; the Dataverse wrapper flows
must still depend on the Admins V2 connector. A successful CLI exit is not
sufficient evidence. Do not feed the translated publish configuration back
into modern `pa app add` commands, or publish again with `pa` 1.3.0 and undo
the workaround.

Run the export verifier on the actual ZIP's expanded metadata (not the older
tracked `.meta.xml`). For example, from the repository root:

```powershell
Expand-Archive -LiteralPath "<exported-managed.zip>" -DestinationPath "<new-private-export-directory>"
node scripts\verify-code-app-export.mjs --xml "<new-private-export-directory>\customizations.xml"
```

The verifier checks every app connection identity, logical reference, HTTP
solution dependency, flow entity ID, invoker alias, and both directions of the
dependency graph against modern `power.config.json`. An export-created runtime
connection ID or `workflowName` may legitimately differ; those are not used as
equality checks. A failure is a release blocker, not a reason to edit the ZIP
to conceal the dependency. If the export contains multiple apps, pass the
individual app's exported metadata file instead of the combined customizations.

CI runs the root connection and publishing regression tests, including the
verifier's rejection cases. It does not publish or authenticate to a tenant.
Only one session should publish to the shared source app at a time; take a
private backup and check for newer cloud changes before publishing from a
worktree.

---

## ⬇️ Pull cloud changes back into the repo

Made a change in the maker portal (new flow, variable, connection ref, version bump…)? From the repo root:

```powershell
node scripts/pull-solution.mjs
```

It exports the unmanaged solution from your currently-selected `pac` env, unpacks it into `solution/src/`, strips the compiled bundle (regenerated by pack-solution), and prints a `git status` drift report. Review, commit, push.

> **Switch envs first** with `pac auth list` / `pac org select` if `pac org who` shows the wrong env.

---

## 🔄 Build a self-contained zip (from source)

Use this when a contributor wants to take a fresh clone and produce a working solution zip — no `npx power-apps push` required. From the repo root:

```powershell
node scripts/pack-solution.mjs            # → PPCoECodeApp_unmanaged_<MMDDYY_HHMM>.zip
node scripts/pack-solution.mjs --managed  # → PPCoECodeApp_managed_<MMDDYY_HHMM>.zip
```

What it does (see [`../scripts/pack-solution.mjs`](../scripts/pack-solution.mjs)):

1. `npm --prefix PP-CoE-CodeApp run build` → `PP-CoE-CodeApp/dist/`
2. Mirrors `PP-CoE-CodeApp/dist/` into `solution/src/CanvasApps/<appName>_CodeAppPackages/`
3. Regenerates the `<CodeAppPackageUris>` block in the `.meta.xml` so it references the freshly-hashed bundle filenames
4. `pac solution pack ... --packageType Unmanaged` (or `Managed` if you pass `--managed`) → `solution/out/PPCoECodeApp_<type>_<MMDDYY_HHMM>.zip`

The output zip is **self-contained**: it bundles the compiled Code App alongside connection references. Import it into a fresh Dataverse env and the app works end-to-end after wiring the connection.

> **Note:** `pack-solution` rewrites the `.meta.xml`'s `<CodeAppPackageUris>` block to match the current build's content-hashed filenames. Expect `.meta.xml` diffs after each pack — that's normal.

### Manual pack (if you don't want to rebuild)

```powershell
pac solution pack `
  --folder solution\src `
  --zipFile solution\out\PPCoECodeApp.zip `
  --packageType Unmanaged
```

Then import via maker portal *or*:

```powershell
pac solution import --path solution\out\PPCoECodeApp.zip
```

### Unpack (after re-exporting from maker → refresh local source)

```powershell
pac solution unpack `
  --zipFile <path-to-downloaded-export>.zip `
  --folder solution\src `
  --packageType Unmanaged
```

> ⚠️ Unpack overwrites files in-place. Commit local changes first. The `pull-solution.mjs` script does this for you with `--allowDelete` to mirror cloud deletions.

---

## 🚀 Releases

Releases are produced by [`.github/workflows/release.yml`](../.github/workflows/release.yml), which:

1. Reads `<Version>` from `solution/src/Other/Solution.xml`
2. `pac solution export --managed` from the target Dataverse env (controlled by `PAC_ENVIRONMENT_ID` secret)
3. Uploads the managed zip to a GitHub Release tagged `v${version}`

The release ships **whatever is currently published in the target Dataverse env** — not what's in source. If you want source to be the release artifact instead, switch the workflow to call `node scripts/pack-solution.mjs --managed`.

**Bump the version** by editing the solution version in the maker portal (or directly in `Solution.xml`), then run `node scripts/pull-solution.mjs` to sync into git, commit, push, and dispatch the release workflow.

Required repo secrets:

| Secret | Description |
|---|---|
| `PAC_APP_ID` | App registration (client) ID with system admin in the target env |
| `PAC_CLIENT_SECRET` | Client secret for the app registration |
| `PAC_TENANT_ID` | AAD tenant ID |
| `PAC_ENVIRONMENT_ID` | Target Dataverse environment URL or ID to export from |

---

## 🆕 First-time setup (new contributor)

1. Authenticate `pac` to your env: `pac auth create --environment <url>`
2. From repo root: `node scripts/pull-solution.mjs` — seeds `solution/src/` from your env
3. From repo root: `node scripts/pack-solution.mjs` — produces `solution/out/PPCoECodeApp_unmanaged_<stamp>.zip`
4. `pac solution import --path solution\out\PPCoECodeApp_unmanaged_<stamp>.zip`
5. In maker → **Connection References**, set the Power Platform for Admins V2 connection
6. (Only if you'll iterate on the app locally) `cd PP-CoE-CodeApp` → `npm install` → `npm run dev` / `npx power-apps push`

See the root [`README.md`](../README.md) for ongoing dev workflow.
