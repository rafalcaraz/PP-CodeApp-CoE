#!/usr/bin/env python3
"""Render the Molina FSA aggregation as a deterministic PDF **on the Contoso
Healthcare letterhead**.

This is the *fancy* (branded) renderer. It reuses the validated aggregation
engine (molina_summary.py, same folder) and the same three tables as the plain
renderer, but every page is stamped onto the Contoso letterhead:
  * blue header band with "CONTOSO HEALTHCARE",
  * green divider rule,
  * bottom-right footer box (name / URL / phone),
  * faint diagonal watermark.

The letterhead is taken **from the bundled asset**
`assets/contoso_healthcare_letterhead_v2.pdf` at run time -- its single-page
vector content is extracted and drawn as the background of every page. If the
brand team ships an updated letterhead PDF (same page size, same /F1 Helvetica +
/F2 Helvetica-Bold fonts, optional /gRLs0 ExtGState), the skill picks it up with
no code change. Nothing is rasterized: text stays crisp and the same input plus
the same letterhead always yields a byte-identical document.

Pure standard library -- NO third-party packages (no Pillow, no reportlab, no
pypdf). Base-14 fonts only (Helvetica / Helvetica-Bold / Courier / Courier-Bold).

Usage:
    python scripts/render_pdf.py input.json -o FSA-Summary.pdf
    python scripts/render_pdf.py input.json                 # -> FSA-Summary.pdf
    cat input.json | python scripts/render_pdf.py - -o out.pdf
    # override the letterhead:
    python scripts/render_pdf.py input.json --letterhead path\to\brand.pdf

input.json shape (identical to molina_summary.py):
    { "files": [ { "name": "4-2-2026 ... .xlsx", "values": [ [..Sheet1..] ] }, ... ] }
"""
import argparse
import base64
import json
import os
import re
import sys
import zlib

import molina_summary as M

# ---- page geometry (PDF points; 72 per inch; US Letter) ----
PAGE_W, PAGE_H = 612.0, 792.0
ML, MR = 54.0, 54.0
# Top margin clears the letterhead header band + green rule (rule sits at y=692).
# Bottom margin clears the letterhead footer box (top edge at y=80).
MT, MB = 130.0, 96.0
XR = PAGE_W - MR  # right content edge

# Default letterhead asset, resolved relative to this script (../assets/...).
DEFAULT_LETTERHEAD = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    os.pardir, "assets", "contoso_healthcare_letterhead_v2.pdf",
)

# fonts
F_REG, F_BOLD, F_MONO, F_MONOB = "F1", "F2", "F3", "F4"

PF_HDR = {
    "Medical FSA": "Medical FSA",
    "Limited Purpose FSA": "Ltd Purpose FSA",
    "Dependent Care FSA": "Dep Care FSA",
    "HRA": "HRA",
}
PF_COLS = [M.short_label(a) for a in M.ORDER]
NUM_W = 80.0
PF_SIZE = 7.5
PF_RIGHTS = [XR - NUM_W * (len(PF_COLS) - 1 - i) for i in range(len(PF_COLS))]
PF_NAME_RIGHT = PF_RIGHTS[0] - NUM_W


def _g(x):
    return ("%g" % x)


def _esc(s):
    return str(s).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _mono_w(s, size):
    """Width of a Courier string (every glyph advances 0.6 em)."""
    return len(s) * size * 0.6


# ---------------------------------------------------------------------------
# Letterhead extraction: pull the single page's vector content stream out of the
# bundled PDF so it can be drawn as every page's background. Uses only stdlib.
# ---------------------------------------------------------------------------
def load_letterhead_ops(path):
    """Return the letterhead page's decoded content-stream operators as a str,
    or "" if the asset is missing/unreadable (renderer then produces an unbranded
    but still valid PDF)."""
    try:
        raw = open(path, "rb").read()
    except OSError:
        return ""
    # The letterhead is single-page: there is exactly one /Contents N 0 R.
    mref = re.search(rb"/Contents\s+(\d+)\s+0\s+R", raw)
    if not mref:
        return ""
    num = mref.group(1)
    mobj = re.search(rb"\b" + num + rb"\s+0\s+obj\b(.*?)\bendobj", raw, re.S)
    if not mobj:
        return ""
    body = mobj.group(1)
    mdict = re.search(rb"<<(.*?)>>\s*stream", body, re.S)
    mstream = re.search(rb"stream\r?\n(.*?)endstream", body, re.S)
    if not mstream:
        return ""
    dictpart = mdict.group(1) if mdict else b""
    data = mstream.group(1).rstrip(b"\r\n")
    # Apply the declared filters in order (ASCII85Decode then FlateDecode).
    if b"ASCII85Decode" in dictpart or b"/A85" in dictpart:
        s = data.strip()
        if s.endswith(b"~>"):
            s = s[:-2]
        data = base64.a85decode(s)
    if b"FlateDecode" in dictpart or b"/Fl" in dictpart:
        data = zlib.decompress(data)
    return data.decode("latin-1")


class Report:
    def __init__(self, letterhead_ops=""):
        self.pages = []
        self.ops = []
        self.y = PAGE_H - MT
        self.letterhead = letterhead_ops

    def _newpage(self):
        if self.ops:
            self.pages.append(self.ops)
        self.ops = []
        self.y = PAGE_H - MT

    def need(self, h):
        if self.y - h < MB:
            self._newpage()
            return True
        return False

    def text(self, x, y, s, font, size):
        self.ops.append(
            "BT /%s %s Tf 1 0 0 1 %.2f %.2f Tm (%s) Tj ET"
            % (font, _g(size), x, y, _esc(s))
        )

    def rtext(self, xr, y, s, font, size):
        self.text(xr - _mono_w(s, size), y, s, font, size)

    def line(self, x1, y1, x2, y2, w=0.5, gray=0.0):
        self.ops.append(
            "%.3f G %.2f w %.2f %.2f m %.2f %.2f l S 0 G"
            % (gray, w, x1, y1, x2, y2)
        )

    def heading(self, s, size, font=F_BOLD, gap_before=0.0, gap_after=6.0):
        self.need(size + gap_before + gap_after)
        self.y -= gap_before
        self.text(ML, self.y - size, s, font, size)
        self.y -= size + gap_after

    def finish(self):
        if self.ops:
            self.pages.append(self.ops)
            self.ops = []


def _render(report, data):
    # Primary contract: the agent emits already-aggregated JSON
    # (final_summary / per_file / processed_files / file_count, plus optional
    # run_date). Fallback: raw {"files":[{name,values}]} -> aggregate here.
    if "final_summary" in data:
        js = data
    else:
        js = M.to_json(data["files"])
    final = {r["account"]: r["total"] for r in js["final_summary"]}
    per_file = js["per_file"]
    processed = js.get("processed_files") or [r["file"] for r in per_file]
    n = js.get("file_count", len(per_file))
    run_date = js.get("run_date")

    # ---- title block ----
    report.text(ML, report.y - 18, "FSA Aggregation - Run Summary", F_BOLD, 18)
    report.y -= 18 + 4
    subtitle = (
        "%d file%s processed - amounts combine current year + prior-year runout."
        % (n, "" if n == 1 else "s")
    )
    if run_date:
        subtitle += "  Run date: %s." % run_date
    report.text(ML, report.y - 10, subtitle, F_REG, 10)
    report.y -= 10 + 6
    report.line(ML, report.y, XR, report.y, w=1.0)
    report.y -= 14

    # ---- 1) Final Summary Table ----
    report.heading("Final Summary Table", 13, gap_after=8.0)
    acct_x, tot_right = ML, ML + 380.0
    report.text(acct_x, report.y - 10, "Account", F_BOLD, 10)
    report.rtext(tot_right, report.y - 10, "Total Amount", F_MONOB, 10)
    report.y -= 14
    report.line(ML, report.y + 2, XR, report.y + 2, w=0.7, gray=0.45)
    report.y -= 4
    for a in M.ORDER:
        report.need(16)
        base = report.y - 11
        report.text(acct_x, base, a, F_REG, 10)
        report.rtext(tot_right, base, M._money(final.get(a, 0.0)), F_MONO, 10)
        report.y -= 16
    report.line(ML, report.y + 4, XR, report.y + 4, w=0.7, gray=0.45)
    report.y -= 18

    # ---- 2) Per-File Contributions ----
    report.heading("Per-File Contributions", 13, gap_after=8.0)

    def pf_header():
        report.text(ML, report.y - PF_SIZE, "File Name", F_BOLD, PF_SIZE)
        for short, xr in zip(PF_COLS, PF_RIGHTS):
            report.rtext(xr, report.y - PF_SIZE, PF_HDR[short], F_MONOB, PF_SIZE)
        report.y -= PF_SIZE + 4
        report.line(ML, report.y + 2, XR, report.y + 2, w=0.6, gray=0.5)
        report.y -= 3

    pf_header()
    for r in per_file:
        if report.need(PF_SIZE + 4):
            pf_header()
        base = report.y - PF_SIZE
        report.text(ML, base, r["file"], F_MONO, PF_SIZE)
        for short, xr in zip(PF_COLS, PF_RIGHTS):
            report.rtext(xr, base, M._num_fmt(r["accounts"].get(short, 0.0)),
                         F_MONO, PF_SIZE)
        report.y -= PF_SIZE + 4
    # totals row
    report.line(ML, report.y + 3, XR, report.y + 3, w=0.6, gray=0.5)
    report.y -= 4
    base = report.y - PF_SIZE
    report.text(ML, base, "TOTAL", F_BOLD, PF_SIZE)
    for a, xr in zip(M.ORDER, PF_RIGHTS):
        report.rtext(xr, base, M._num_fmt(final.get(a, 0.0)), F_MONOB, PF_SIZE)
    report.y -= PF_SIZE + 14

    # ---- 3) Processed Files List ----
    report.heading("Processed Files List (%d)" % len(processed), 13, gap_after=8.0)
    for i, name in enumerate(processed, 1):
        report.need(12)
        report.text(ML, report.y - 9, "%d.  %s" % (i, name), F_MONO, 9)
        report.y -= 12


def _footers(pages):
    """Bottom-LEFT page number (bottom-right is occupied by the letterhead footer
    box)."""
    total = len(pages)
    for i, ops in enumerate(pages, 1):
        s = "Page %d of %d" % (i, total)
        size = 8.0
        ops.append(
            "0.4 g BT /%s %s Tf 1 0 0 1 %.2f %.2f Tm (%s) Tj ET 0 g"
            % (F_MONO, _g(size), ML, 40.0, _esc(s))
        )


def build_pdf(pages, letterhead_ops=""):
    _footers(pages)
    p = len(pages)
    objs = {}
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    page_nums = [6 + i for i in range(p)]
    content_nums = [6 + p + i for i in range(p)]
    kids = " ".join("%d 0 R" % nm for nm in page_nums)
    objs[2] = ("<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, p)).encode("latin-1")
    objs[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objs[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    objs[5] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"
    courier_bold_num = 6 + 2 * p
    # Resources: the four fonts + the letterhead's watermark ExtGState (gRLs0).
    res = (
        "<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 %d 0 R >> "
        "/ExtGState << /gRLs0 << /Type /ExtGState /CA .2 /ca .2 >> >> >>"
        % courier_bold_num
    )
    # Wrap the letterhead in q/Q so its colour/alpha/CTM state never leaks into
    # the table drawing that follows.
    bg = ("q\n%s\nQ\n" % letterhead_ops) if letterhead_ops else ""
    for i in range(p):
        pn, cn = page_nums[i], content_nums[i]
        objs[pn] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources %s /Contents %d 0 R >>" % (res, cn)
        ).encode("latin-1")
        stream = (bg + "\n".join(pages[i])).encode("latin-1", "replace")
        objs[cn] = (b"<< /Length %d >>\nstream\n" % len(stream)) + stream + b"\nendstream"
    objs[courier_bold_num] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>"

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num in sorted(objs):
        offsets[num] = len(out)
        out += ("%d 0 obj\n" % num).encode("latin-1") + objs[num] + b"\nendobj\n"
    xref_pos = len(out)
    size = max(objs) + 1
    out += ("xref\n0 %d\n" % size).encode("latin-1")
    out += b"0000000000 65535 f \n"
    for num in range(1, size):
        out += ("%010d 00000 n \n" % offsets[num]).encode("latin-1")
    out += b"trailer\n"
    out += ("<< /Size %d /Root 1 0 R >>" % size).encode("latin-1")
    out += b"\nstartxref\n" + ("%d" % xref_pos).encode("latin-1") + b"\n%%EOF\n"
    return bytes(out)


def main(argv):
    ap = argparse.ArgumentParser(
        prog="render_pdf.py",
        description="Render the Molina FSA aggregation as a deterministic, "
                    "branded PDF on the Contoso Healthcare letterhead.",
    )
    ap.add_argument(
        "input", nargs="?", default="-",
        help="Aggregated JSON (final_summary/per_file/processed_files/file_count, "
             "optional run_date) or raw {\"files\":[{name,values}]}. '-' or omitted "
             "reads stdin.",
    )
    ap.add_argument(
        "-o", "--output", default="FSA-Summary.pdf",
        help="Output PDF path (default: FSA-Summary.pdf).",
    )
    ap.add_argument(
        "--letterhead", default=DEFAULT_LETTERHEAD,
        help="Letterhead PDF to stamp onto (default: the bundled "
             "assets/contoso_healthcare_letterhead_v2.pdf).",
    )
    ap.add_argument(
        "--allow-unbranded", action="store_true",
        help="Permit writing an UNBRANDED PDF when the letterhead is "
             "missing/unreadable. Default: refuse with a non-zero exit, because "
             "this skill's purpose is the branded document.",
    )
    ns = ap.parse_args(argv[1:])

    if ns.input == "-":
        raw = sys.stdin.read()
    else:
        with open(ns.input, "r", encoding="utf-8") as fh:
            raw = fh.read()
    data = json.loads(raw)
    if not (data.get("final_summary") or data.get("files")):
        print("No data provided (expected 'final_summary' or 'files').",
              file=sys.stderr)
        return 2

    letterhead_ops = load_letterhead_ops(ns.letterhead)
    if not letterhead_ops:
        if not ns.allow_unbranded:
            print("ERROR: letterhead not found/unreadable at %s. This skill "
                  "renders the branded Contoso letterhead PDF and will not "
                  "silently write an unbranded document. Fix the --letterhead "
                  "path or pass --allow-unbranded to override." % ns.letterhead,
                  file=sys.stderr)
            return 3
        print("WARNING: letterhead not found/unreadable at %s -- writing "
              "unbranded PDF (--allow-unbranded)." % ns.letterhead,
              file=sys.stderr)

    report = Report(letterhead_ops)
    _render(report, data)
    report.finish()
    pdf = build_pdf(report.pages, letterhead_ops)
    with open(ns.output, "wb") as fh:
        fh.write(pdf)
    branded = "branded" if letterhead_ops else "UNBRANDED"
    print("Wrote %s (%d bytes, %d page(s), %s)."
          % (ns.output, len(pdf), len(report.pages), branded))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
