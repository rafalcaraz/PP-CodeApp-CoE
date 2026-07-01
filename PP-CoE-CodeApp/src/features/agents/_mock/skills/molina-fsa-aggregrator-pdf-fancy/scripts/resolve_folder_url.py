#!/usr/bin/env python3
"""Resolve a pasted SharePoint folder URL into the pieces + Graph calls the
FSA aggregator skill needs. Pure standard library — no auth, no network.

Usage:
    python scripts/resolve_folder_url.py "<sharepoint_folder_url>"
    echo "<url>" | python scripts/resolve_folder_url.py

Emits JSON to stdout:
    host, sitePath, library, defaultLibrary, folderInLibrary, and a `calls`
    object with ready-to-use Graph URLs. Placeholders {siteId} / {driveId} /
    {itemId} are filled in by the agent from prior call responses.

The agent then (1) GETs calls.siteId -> siteId, (2) GETs calls.listChildren
(substituting siteId) -> files (+ parentReference.driveId), (3) GETs
calls.readSheet1 per file. Folder paths are addressed relative to the drive
root, so the document library segment (e.g. "Shared Documents") is stripped.
"""
import json
import sys
from urllib.parse import urlparse, parse_qs, unquote, quote

GRAPH = "https://graph.microsoft.com/v1.0"
DEFAULT_LIBS = {"shared documents", "documents"}


def _enc(path: str) -> str:
    """Percent-encode each path segment (spaces -> %20) but keep the slashes."""
    return "/".join(quote(seg) for seg in path.split("/") if seg != "")


def resolve(url: str) -> dict:
    u = urlparse(url.strip())
    host = u.netloc
    if not host:
        raise ValueError("URL has no host — is this a full SharePoint URL?")

    # The real folder path lives in the ?id= query param (server-relative,
    # URL-encoded). Fall back to the path itself for direct folder links.
    q = parse_qs(u.query)
    if "id" in q and q["id"]:
        server_rel = unquote(q["id"][0])
    else:
        server_rel = unquote(u.path)
        # Drop a trailing view page like /Forms/AllItems.aspx if present.
        low = server_rel.lower()
        for marker in ("/forms/allitems.aspx", "/allitems.aspx"):
            if low.endswith(marker):
                server_rel = server_rel[: -len(marker)]
                break

    parts = [p for p in server_rel.strip("/").split("/") if p != ""]
    if not parts:
        raise ValueError("Could not find a folder path in the URL.")

    # Site path = /sites/<name> or /teams/<name>; otherwise the root site.
    if parts[0].lower() in ("sites", "teams") and len(parts) >= 2:
        site_path = "/" + "/".join(parts[:2])
        rest = parts[2:]
    else:
        site_path = ""  # root site
        rest = parts

    if not rest:
        raise ValueError("URL points at a site root, not a document folder.")

    library = rest[0]
    folder_in_library = "/".join(rest[1:])
    default_library = library.lower() in DEFAULT_LIBS

    # Call 1: resolve the site id.
    if site_path:
        site_id_url = f"{GRAPH}/sites/{host}:{site_path}?$select=id"
    else:
        site_id_url = f"{GRAPH}/sites/{host}?$select=id"

    enc_folder = _enc(folder_in_library)
    notes = []

    # Call 2: list the folder's children (the response carries each file's id
    # AND parentReference.driveId — so the driveId for call 3 comes for free).
    if default_library:
        list_children = (
            f"{GRAPH}/sites/{{siteId}}/drive/root:/{enc_folder}:/children"
            "?$select=name,id,parentReference"
        )
    else:
        list_children = (
            f"{GRAPH}/drives/{{driveId}}/root:/{enc_folder}:/children"
            "?$select=name,id,parentReference"
        )
        notes.append(
            f"Non-default library '{library}': first GET "
            f"{GRAPH}/sites/{{siteId}}/drives?$select=id,name and pick the "
            f"drive whose name == '{library}' to get {{driveId}}."
        )

    if not folder_in_library:
        notes.append(
            "URL points at the library root (no sub-folder); listing the "
            "library root."
        )

    return {
        "host": host,
        "sitePath": site_path,
        "library": library,
        "defaultLibrary": default_library,
        "folderInLibrary": folder_in_library,
        "calls": {
            "siteId": site_id_url,
            "listChildren": list_children,
            "readSheet1": (
                f"{GRAPH}/drives/{{driveId}}/items/{{itemId}}/workbook/"
                "worksheets('Sheet1')/usedRange(valuesOnly=true)?$select=values"
            ),
        },
        "notes": notes,
    }


def main(argv):
    raw = argv[1] if len(argv) > 1 else sys.stdin.read()
    raw = (raw or "").strip().strip('"').strip("'")
    if not raw:
        print(json.dumps({"error": "No URL provided."}))
        return 2
    try:
        result = resolve(raw)
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the agent
        print(json.dumps({"error": str(exc)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
