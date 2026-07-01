---
name: molina-fsa-aggregrator-pdf-fancy
description: >-
  Render the Molina FSA funding aggregation as a polished, branded PDF on the
  Contoso Healthcare letterhead. Use when asked to "generate the PDF", "produce
  the branded / letterhead FSA summary", "make the fancy FSA funding PDF", or
  export the monthly FSA funding roll-up as a professional document. Takes the
  already-aggregated result (final_summary, per_file, processed_files,
  file_count) and stamps a Final Summary Table, a Per-File Contributions grid
  with a TOTAL row, and a Processed Files List onto every page of the Contoso
  letterhead (blue header band, green rule, footer box, watermark). Output is
  produced by a bundled, dependency-free Python writer, so identical input plus
  the same letterhead always yields a byte-identical PDF. Scales to 30+ files
  (auto-paginates, letterhead repeats on each page). Do NOT use for the plain
  (unbranded) PDF — use molina-fsa-aggregator-pdf; for the raw aggregation math —
  use molina-fsa-aggregator-pdf/-singlefile; or for per-employee (Sheet2 / PII)
  detail — out of scope.
---

# Molina FSA Funding Aggregator → Branded (Contoso letterhead) PDF

The **fancy** variant: same numbers as the standard Molina FSA aggregation, but
the document is stamped onto the **Contoso Healthcare letterhead**. Every page
carries the blue header band ("CONTOSO HEALTHCARE"), the green divider rule, the
bottom-right footer box, and the faint diagonal watermark.

## Why a bundled renderer (not "let the model make a PDF")
The layout and branding are fixed and must look identical every run, so the PDF
is written by the bundled `scripts/render_pdf.py`, **not** improvised at runtime.
It uses only the Python standard library and the PDF base-14 fonts (Helvetica /
Courier) — **no Pillow, no reportlab, no pypdf, no font files, no pip installs.**
Identical input + the same letterhead ⇒ **byte-identical** PDF.

## When to use
- "Generate the branded / letterhead FSA funding PDF."
- "Produce the fancy Molina FSA run summary as a document."
- "Export the monthly FSA roll-up on the Contoso letterhead."

## When NOT to use
- **Plain / unbranded** PDF → use `molina-fsa-aggregator-pdf`.
- You only need the **aggregation math** or an inline/Markdown table → use
  `molina-fsa-aggregator-pdf` / `molina-fsa-aggregator-singlefile`.
- **Per-employee** detail (Sheet2) — contains PII, out of scope.

## Input (the primary contract)
This skill renders the **already-aggregated** run result that the upstream
aggregation produces — pass it straight through as `input.json`:

```json
{
  "final_summary": [
    { "account": "Medical Flexible Spending Account", "total": 22609.72 },
    { "account": "Limited Purpose Flexible Spending Account", "total": 708.19 },
    { "account": "Dependent Care Flexible Spending Account", "total": 6325.23 },
    { "account": "Health Reimbursement Arrangement", "total": 400.58 }
  ],
  "per_file": [
    { "file": "3-31-2026 FSA Funding Report.xlsx",
      "accounts": { "Medical FSA": 9650.40, "Limited Purpose FSA": 497.19,
                    "Dependent Care FSA": 2435.00, "HRA": 400.58 } }
  ],
  "processed_files": ["3-31-2026 FSA Funding Report.xlsx"],
  "file_count": 1,
  "run_date": "2026-07-01"
}
```

Field notes (must match exactly):
- `final_summary[].account` uses the **full** account names; `per_file[].accounts`
  keys use the **short** labels `Medical FSA` / `Limited Purpose FSA` /
  `Dependent Care FSA` / `HRA`.
- `run_date` *(optional)* is shown in the subtitle. **Do not** feed `run_stamp`
  or any wall-clock time into the body — that would break byte-repeatability.
- `processed_files` / `file_count` are optional; if omitted they are derived from
  `per_file`.
- **Fallback:** if you only have raw workbook values, pass
  `{ "files": [ { "name": "...xlsx", "values": [[..Sheet1..]] } ] }` instead and
  the renderer aggregates via the bundled `molina_summary.py` (same rules as the
  standard skill).

## Procedure
1. **Obtain the aggregated result.** In production it comes from the upstream FSA
   aggregation (the standard aggregator's Graph read of each workbook's Sheet1).
   Save it as `input.json`.
2. **Render the branded PDF:**
   ```
   python scripts/render_pdf.py input.json -o FSA-Summary.pdf
   ```
   The letterhead is taken from `assets/contoso_healthcare_letterhead_v2.pdf`.
   To use a different brand file: `--letterhead path\to\brand.pdf`. If the
   letterhead is missing/unreadable the renderer **fails with a non-zero exit**
   (it will not silently ship an unbranded document); pass `--allow-unbranded`
   only if you deliberately want a plain PDF. Run `--help` for full usage.
3. **Deliver `FSA-Summary.pdf`** to the user via the host's file/attachment
   mechanism. Note any skipped files / remaining count if a cap applied upstream.

## Output (what the PDF contains)
- **Title** — "FSA Aggregation - Run Summary" + a one-line note (file count,
  combined-year wording, optional run date).
- **Final Summary Table** — the four accounts (full names) with `$#,##0.00` totals.
- **Per-File Contributions** — one row per file (oldest-first as delivered) with
  compact columns (Medical FSA / Ltd Purpose FSA / Dep Care FSA / HRA) + a
  **TOTAL** row.
- **Processed Files List** — numbered list of every file in the run.
- **On every page:** the Contoso letterhead; page number ("Page X of Y") bottom-**left**.

## Gotchas (learned building this)
- **Content must clear the letterhead.** The header band + green rule occupy the
  top (rule at y=692) and the footer box the bottom-right (top edge y=80). The
  renderer sets `MT=130` / `MB=96` so tables never collide; page numbers sit
  bottom-**left** because the letterhead owns the bottom-right.
- **Isolate the letterhead's graphics state.** Its watermark uses stroke alpha
  (`/gRLs0` ExtGState, CA .2); the background is drawn inside `q … Q` so that
  alpha/colour/CTM never leak into the table rules (otherwise the table lines go
  faint). The `/gRLs0` ExtGState is declared in each page's `/Resources`.
- **Letterhead fonts must match.** The asset references `/F1` Helvetica and `/F2`
  Helvetica-Bold — the renderer maps those to the same base-14 fonts, so a
  drop-in brand PDF works only if it uses the same font names (or none).
- **Never inject timestamps.** Determinism depends on it; only echo `run_date`
  from the input, never `datetime.now()`.
- **Aggregate-only, PHI-safe.** These totals come from Sheet1; never render
  Sheet2 / employee names or identifiers.

## Dependencies
**None beyond the Python standard library.** `scripts/render_pdf.py`,
`scripts/molina_summary.py`, and `scripts/resolve_folder_url.py` use only stdlib
— no Pillow, no reportlab, no pypdf, no fonts, no pip installs. The only asset is
the letterhead PDF in `assets/`.
