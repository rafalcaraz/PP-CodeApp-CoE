---
name: molina-fsa-funding-aggregator-move
description: >-
  Run the Molina FSA monthly/periodic funding aggregation AND file the processed
  reports out of the Input folder. Reads the four reimbursement accounts (Medical
  FSA, Limited Purpose FSA, Dependent Care FSA, HRA) from each FSA Funding Report
  workbook's Sheet1 in an Input folder, sums every matching row across all
  sections and files (current year + prior-year runout combined), returns a Final
  Summary Table, a Per-File Contributions table, and a Processed Files List, and
  THEN moves every successfully-processed file into a per-run subfolder of an
  Output folder. Point it at the reports by pasting the Input and Output
  SharePoint folder URLs. This skill ALWAYS moves the processed files — do NOT
  use if the files must stay in place, and do NOT use for per-employee (Sheet2)
  detail, which contains PII and is out of scope.
---

# Molina FSA Funding Aggregator (with file move)

Produces the Molina-format funding summary — a per-account grand total, a
per-file breakdown, and the list of files processed — and then **moves every
successfully-processed file** from the **Input** folder into a per-run subfolder
of an **Output** folder. This skill owns the full procedure: it resolves the
folders, calls the agent's Microsoft Graph HTTP action to read each Sheet1, runs
a bundled script to aggregate, and finally relocates the processed files.

## Execution & memory behavior (critical)
- **Fresh run every time.** Do not retain, reuse, or reference any memory,
  cache, or prior results. Re-read the files in the Input folder and recompute
  every total from scratch. Never accumulate across runs.
- **One file at a time.** Process files sequentially; keep a running total for
  the current run only.
- **Cap:** process at most **50 files** per run. If more are present, process
  the first 50 (oldest first) and note how many remain.
- **Resilient:** if a single file fails (no Sheet1, unreadable), **skip it and
  continue** — never abort the whole run. List skipped files at the end.
- **Move only what was processed.** A file is moved **only** if it was read
  **and** included in the rendered summary. Skipped/failed files **stay in
  Input** so they're visible and retried next run.

## When to use
- "Run the Molina FSA aggregation and move the processed files to Output."
- "Total the FSA reports, then clear them out of the Input folder."
- "Process my FSA reports at `<Input URL>` and file them into `<Output URL>`."

## When NOT to use
- Per-employee detail — that lives on **Sheet2** and contains PII. Out of scope.
- A current-year-only roll-up that drops prior-year runout — this Molina skill
  always **combines** current year + prior-year runout.

## Required agent action (prerequisite)
This skill drives **one** action: **"Invoke an HTTP request"** — the *HTTP with
Microsoft Entra ID (preauthorized)* connector (Base Resource URL
`https://graph.microsoft.com`). It is used for every Graph call below. The read
half is all **GET**; the move half additionally needs **POST** (create the run
subfolder) and **PATCH** (reparent each file). The preauthorized app must have
**write** scope (`Files.ReadWrite.All` / `Sites.ReadWrite.All`) and the action
must allow POST + PATCH. If the action is missing or read-only, stop and tell the
user.

Everything — read, list, and move — runs through this **one** Graph action, on
the `driveId` + `itemId` the folder listing returns (the move is a Graph `PATCH`,
not a separate file-move action).

## Inputs
- **inputFolderUrl** *(required)* — a SharePoint folder URL (browser address bar,
  the `.../AllItems.aspx?id=…` form is ideal) for the **Input** folder. Parse it
  with `scripts/resolve_folder_url.py`. Alternatively **driveId** + **folderId** /
  **folderPath**.
- **outputFolderUrl** *(required)* — a SharePoint folder URL for the **Output**
  folder the processed files are moved into. Pass it as the **second argument**
  to `scripts/resolve_folder_url.py`. The Output folder is normally a sibling of
  Input in the **same** library/drive (the simple case). Alternatively
  **outputFolderId**.
- **files / date range** — optional subset; default is *all* files in Input
  (up to the 50 cap).

## Graph calls (all via "Invoke an HTTP request")
Run `python scripts/resolve_folder_url.py "<inputFolderUrl>" "<outputFolderUrl>"`
once; it emits every URL below under `calls`. Placeholders `{siteId}`,
`{driveId}`, `{itemId}`, `{outputFolderId}`, `{runSubfolderId}` are filled from
prior responses.

**Read half (GET):**
- **R — Resolve a site id:**
  `GET .../v1.0/sites/{host}:{sitePath}?$select=id`
- **L — List files in the Input folder:**
  `GET .../v1.0/sites/{siteId}/drive/root:/{inputFolder}:/children?$select=name,id,parentReference`
  The children carry each file's `id` **and** `parentReference.driveId` — capture
  that `driveId` (used by every later call, read and move).
- **B — Read a workbook's Sheet1 values:**
  `GET .../v1.0/drives/{driveId}/items/{itemId}/workbook/worksheets('Sheet1')/usedRange(valuesOnly=true)?$select=values`

**Move half (run LAST, after the tables render — see Procedure step 5):**
- **O — Resolve the Output folder id** (GET):
  `GET .../v1.0/sites/{siteId}/drive/root:/{outputFolder}?$select=id` → `{outputFolderId}`
- **S — Create a per-run subfolder under Output** (POST):
  `POST .../v1.0/drives/{driveId}/items/{outputFolderId}/children`
  body: `{ "name": "<runStamp>", "folder": {}, "@microsoft.graph.conflictBehavior": "rename" }`
  → capture the new subfolder's `id` as `{runSubfolderId}`. Use a sortable
  `runStamp` like `Processed-2026-06-30T16-32` (UTC, no characters illegal in a
  SharePoint folder name).
- **M — Move each processed file into the run subfolder** (PATCH):
  `PATCH .../v1.0/drives/{driveId}/items/{itemId}`
  body: `{ "parentReference": { "id": "{runSubfolderId}" } }`

> **CRITICAL URL rules:**
> - Every URL **must** include the **`/v1.0/`** segment (omitting it 404s with
>   *"Invalid version: drives"*).
> - Folder paths are **relative to the drive root** — never include the
>   document-library name (e.g. `Shared Documents`). The resolver strips it.
> - **Same-drive assumption:** the move uses `parentReference.id` only, which
>   requires Output to be in the **same drive** as Input. If the resolver's
>   `notes` flag a different site/drive, add `"driveId"` to the PATCH
>   `parentReference`.

## Procedure
1. **Resolve folders.** Run
   `python scripts/resolve_folder_url.py "<inputFolderUrl>" "<outputFolderUrl>"`,
   then call **R** (siteId) and **L** (`calls.listChildren` with siteId) → keep
   each `.xlsx` file's `id` + `name` and the `parentReference.driveId`. Sort
   oldest-first and take at most 50.
2. **For each file, sequentially:**
   a. Read its Sheet1 via **B** (using `driveId` + the file `id`). On failure,
      record it as **skipped** (leave it in Input) and continue.
   b. Add its `{ "name", "values", "id" }` to the run's file list. Keep the
      `id` — you'll need it to move the file later.
3. **Aggregate & render** — pass the collected files to the script:
   ```
   python scripts/molina_summary.py input.json
   ```
   where `input.json` is `{ "files": [ { "name": "...xlsx", "values": [...] }, ... ] }`.
   Add `--json` for a structured payload. The script sums the four accounts
   (each matching row once, all sections, blank/non-numeric = 0) and builds the
   three output tables.
4. **Present** the script's Markdown as-is: **Final Summary Table**,
   **Per-File Contributions**, **Processed Files List**. Append any skipped files
   and the remaining-files count if the 50 cap was hit. **The tables are the
   source of truth and must be produced before anything is moved.**
5. **Move the processed files (LAST).** Only the files that appear in the
   Processed Files List are eligible. Then:
   a. **O** — resolve `{outputFolderId}`.
   b. **S** — create the per-run subfolder → `{runSubfolderId}`.
   c. **M** — for each processed file, PATCH it into `{runSubfolderId}` using the
      `driveId` + the file `id` you kept in step 2b.
   d. Record each move as moved / failed. A move failure **never** aborts the
      run — continue with the rest.
6. **Append the Moved Files manifest** (see Output template): every file moved,
   its destination subfolder, and — loudly — any file that was **counted but not
   moved** (it will be re-counted next run unless you move/remove it).

## Aggregation rules (implemented in scripts/molina_summary.py)
- Match Column 1 against the four target accounts: **Medical Flexible Spending
  Account, Limited Purpose Flexible Spending Account, Dependent Care Flexible
  Spending Account, Health Reimbursement Arrangement**.
- For every matching row, add **Column 2**; blank or non-numeric = **0**. Count
  each row once. This sums all sections/subsections (current + prior-year runout
  combined) and all files in the run.
- Final Summary = per-account totals across the run. Per-File Contributions =
  one row per file (short account headers: Medical FSA / Limited Purpose FSA /
  Dependent Care FSA / HRA). Files are listed oldest-first.

## Data handling / PHI
Sheet1 is **aggregate-only** (no names or identifiers), so this skill is PHI-safe
by design. Only ever read **Sheet1** — never Sheet2 — and surface totals, not
individuals.

## Output template
Present the three aggregation tables exactly as the script renders them, then
append:

```
### Moved Files (<N>)
Moved into Output / Processed-2026-06-30T16-32:
1. 4-2-2026 FSA Funding Report.xlsx
2. 4-3-2026 FSA Funding Report.xlsx
...

### Not moved
- Skipped during read (left in Input): <files, or "none">
- ⚠ Counted this run but move FAILED (still in Input — will be re-counted next
  run unless you move/remove them): <files, or "none">
```

If the 50-file cap was hit, also note how many Input files remain.

## Gotchas
- **Move only after a successful read AND a rendered summary.** Never move a file
  you couldn't read, and never move before the tables exist. Move-last keeps the
  whole run re-runnable if anything fails mid-way.
- **The dangerous case — read OK but move failed.** That file is already in this
  run's totals *and* still in Input, so the next fresh run will **double-count**
  it. Don't bury it: surface it under "⚠ Counted this run but move FAILED".
- **Totals "reset" as files move out.** Because every run is a fresh total of
  whatever is *currently* in Input, moving processed files means the next run
  only reflects what remains. That is the intended "process this period's new
  files" behavior — but say so, and always print the Moved Files manifest so the
  transcript records exactly which files each total covered.
- **Name clashes in Output → 409.** File names embed dates and runs repeat, so a
  flat Output folder would collide. The per-run timestamped subfolder (step 5b,
  `conflictBehavior: rename`) prevents this and doubles as an audit trail. Do not
  PATCH files into the Output **root**.
- **A move is a relocation, not a destroy.** Graph PATCH reparenting preserves
  the same item id and version history — the file is filed away in Output, not
  rewritten. Output should be treated as a keep-forever archive (never auto-purged).
- **Cross-drive Output.** If Output is in a different site/library/drive than
  Input, the resolver's `notes` will say so; add `"driveId"` to the PATCH
  `parentReference`. The common case (sibling folders, same library) needs only
  `parentReference.id`.
- **Always include `/v1.0/`; never include the library name** in a path.

## Guardrails
- When given a folder URL, **always** parse it with
  `scripts/resolve_folder_url.py` (Input as arg 1, Output as arg 2) rather than
  hand-decoding `%2F`/`%2D`/`%20` or hand-building any URL.
- Every Graph call goes through the one **"Invoke an HTTP request"** action —
  always include `/v1.0/` and never include the document-library name in a path.
- Read **Sheet1 only**; never read Sheet2.
- **Move only successfully-processed files, and only after the tables render.**
  Failed/skipped files stay in Input. Move into the per-run subfolder, never the
  Output root.
- Do not echo employee names or identifiers; report aggregate totals only.

## Dependencies
None — both `scripts/resolve_folder_url.py` and `scripts/molina_summary.py` use
only the Python standard library.
