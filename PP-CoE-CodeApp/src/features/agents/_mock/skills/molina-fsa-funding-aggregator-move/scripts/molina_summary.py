#!/usr/bin/env python3
"""Molina-ready FSA Funding Report summary.

Reads one or more FSA Funding Report Sheet1 value arrays and produces a
Molina-formatted summary with three parts:

  1. Final Summary Table   — total per account across ALL files in the run.
  2. Per-File Contributions — one row per file, one column per account.
  3. Processed Files List   — numbered list of the files included.

Aggregation logic (matches Molina's documented spec):
  * Scan Column 1 of Sheet1 for rows whose label is one of the four target
    accounts (Medical FSA, Limited Purpose FSA, Dependent Care FSA, HRA).
  * Sum Column 2 for every matching row — across all sections/subsections and
    all occurrences in the file (so current-year and prior-year runout are
    COMBINED), counting each row exactly once.
  * Blank or non-numeric amounts count as 0.
  * Then aggregate per account across every processed file in the run.

Input JSON (path arg or stdin):
  {
    "files": [
      { "name": "4-2-2026 FSA Funding Report.xlsx", "values": [ [..Sheet1..] ] },
      ...
    ]
  }

Usage:
  python scripts/molina_summary.py input.json          # Markdown
  python scripts/molina_summary.py input.json --json   # structured JSON
  cat input.json | python scripts/molina_summary.py
"""
import json
import re
import sys

DATE_IN_NAME = re.compile(r"(\d{1,2})-(\d{1,2})-(\d{4})")

# The four target accounts, in display order. Keys are normalized (lower/trim)
# labels as they appear in Column 1; values are the canonical display names.
ACCOUNTS = {
    "medical flexible spending account": "Medical Flexible Spending Account",
    "limited purpose flexible spending account": "Limited Purpose Flexible Spending Account",
    "dependent care flexible spending account": "Dependent Care Flexible Spending Account",
    "health reimbursement arrangement": "Health Reimbursement Arrangement",
}
ORDER = [
    "Medical Flexible Spending Account",
    "Limited Purpose Flexible Spending Account",
    "Dependent Care Flexible Spending Account",
    "Health Reimbursement Arrangement",
]
SHORT = {
    "Medical Flexible Spending Account": "Medical FSA",
    "Limited Purpose Flexible Spending Account": "Limited Purpose FSA",
    "Dependent Care Flexible Spending Account": "Dependent Care FSA",
    "Health Reimbursement Arrangement": "HRA",
}


def _num(v):
    """Parse a cell to a float; blank or non-numeric -> 0.0 (per Molina rule)."""
    if isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace("$", "")
        if s in ("", "-", "\u2014"):
            return 0.0
        try:
            return float(s)
        except ValueError:
            return 0.0
    return 0.0


def short_label(full):
    return SHORT.get(full, full)


def extract_accounts(values):
    """Return {canonical_account_name: summed_amount} for the four target
    accounts, summing every matching row in the sheet (each row once)."""
    totals = {}
    for row in values or []:
        a = row[0] if len(row) > 0 else ""
        key = a.strip().lower() if isinstance(a, str) else ""
        if key in ACCOUNTS:
            b = row[1] if len(row) > 1 else ""
            canon = ACCOUNTS[key]
            totals[canon] = totals.get(canon, 0.0) + _num(b)
    return totals


def build(files):
    per_file = []
    for f in files:
        name = f.get("name") or f.get("label") or "(unnamed)"
        accts = extract_accounts(f.get("values"))
        m = DATE_IN_NAME.search(name)
        date_key = (int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else (9999, 99, 99)
        per_file.append({"name": name, "date_key": date_key, "accounts": accts})
    per_file.sort(key=lambda r: r["date_key"])
    totals = {a: 0.0 for a in ORDER}
    for r in per_file:
        for a in ORDER:
            totals[a] += r["accounts"].get(a, 0.0)
    return per_file, ORDER, totals


def _money(x):
    return f"${x:,.2f}"


def _num_fmt(x):
    return f"{x:,.2f}"


def render_markdown(files):
    per_file, ordered, totals = build(files)
    out = []
    out.append("## FSA Aggregation \u2014 Run Summary")
    out.append("")
    out.append("### Final Summary Table")
    out.append("")
    out.append("| Account Name | Total Amount |")
    out.append("| --- | --- |")
    for a in ordered:
        out.append(f"| {a} | {_money(totals[a])} |")
    out.append("")
    out.append("### Per-File Contributions")
    out.append("")
    headers = ["File Name"] + [short_label(a) for a in ordered]
    out.append("| " + " | ".join(headers) + " |")
    out.append("|" + "|".join([" --- "] * len(headers)) + "|")
    for r in per_file:
        cells = [r["name"]] + [_num_fmt(r["accounts"].get(a, 0.0)) for a in ordered]
        out.append("| " + " | ".join(cells) + " |")
    out.append("")
    out.append(f"### Processed Files List ({len(per_file)})")
    out.append("")
    for i, r in enumerate(per_file, 1):
        out.append(f"{i}. {r['name']}")
    return "\n".join(out)


def to_json(files):
    per_file, ordered, totals = build(files)
    return {
        "final_summary": [{"account": a, "total": round(totals[a], 2)} for a in ordered],
        "per_file": [
            {
                "file": r["name"],
                "accounts": {short_label(a): round(r["accounts"].get(a, 0.0), 2) for a in ordered},
            }
            for r in per_file
        ],
        "processed_files": [r["name"] for r in per_file],
        "file_count": len(per_file),
    }


def main(argv):
    args = [a for a in argv[1:] if a != "--json"]
    want_json = "--json" in argv[1:]
    if args:
        with open(args[0], "r", encoding="utf-8") as fh:
            raw = fh.read()
    else:
        raw = sys.stdin.read()
    data = json.loads(raw)
    files = data.get("files", [])
    if not files:
        print("No files provided.", file=sys.stderr)
        return 2
    if want_json:
        print(json.dumps(to_json(files), indent=2))
    else:
        print(render_markdown(files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
