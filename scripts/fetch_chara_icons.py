#!/usr/bin/env python3
"""Fetch the in-game per-variant character icons for the uma roster import.

Source: https://github.com/wrrwrr111/pretty-derby (public/img/chara_card/,
files named chr_icon_<chara>_<variant>_01.png — the exact "Trainee Umamusume"
list asset). Scoping, verdict and known risks (coverage, freshness) are in
docs/EXTERNAL_SOURCES_PLAN.md, section "Umas debloquees".

This is deliberately a one-shot script separate from update_reference.py:
different source than GameTora, different cadence, and the icons only matter
for the screenshot import feature. Re-run it after a reference update to pick
up icons for newly imported variants. Idempotent: existing valid files are
kept, corrupt/HTML downloads are rejected by PNG signature.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
NORMALIZED_CHARACTERS = PROJECT_ROOT / "data" / "normalized" / "characters.json"
ICONS_ROOT = PROJECT_ROOT / "dist" / "media" / "reference" / "characters" / "icons"
MANIFEST_PATH = ICONS_ROOT / "icons_manifest.json"

REPO = "wrrwrr111/pretty-derby"
TREE_URL = f"https://api.github.com/repos/{REPO}/git/trees/master?recursive=1"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/master"
ICON_PREFIX = "public/img/chara_card/chr_icon_"
USER_AGENT = "umamusume-roster-manager (local roster import asset fetch)"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def load_catalog_variant_ids() -> set[str]:
    if not NORMALIZED_CHARACTERS.exists():
        raise SystemExit(
            "data/normalized/characters.json introuvable — lancer d'abord "
            "python scripts/update_reference.py"
        )
    document = json.loads(NORMALIZED_CHARACTERS.read_text(encoding="utf-8"))
    return {str(item["id"]) for item in document.get("items", [])}


def list_repo_icon_paths() -> dict[str, str]:
    tree = json.loads(http_get(TREE_URL).decode("utf-8"))
    paths: dict[str, str] = {}
    for entry in tree.get("tree", []):
        path = entry.get("path", "")
        if not path.startswith(ICON_PREFIX) or not path.endswith(".png"):
            continue
        # chr_icon_<chara>_<variant>_01.png -> variant id
        parts = Path(path).stem.split("_")
        if len(parts) >= 4:
            paths[parts[3]] = path
    return paths


def main() -> int:
    catalog = load_catalog_variant_ids()
    repo_icons = list_repo_icon_paths()
    covered = sorted(catalog & set(repo_icons))
    missing = sorted(catalog - set(repo_icons))
    print(f"catalogue: {len(catalog)} variantes | repo: {len(repo_icons)} icones | couvertes: {len(covered)}")

    ICONS_ROOT.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    skipped = 0
    failed: list[str] = []
    for variant_id in covered:
        destination = ICONS_ROOT / f"{variant_id}.png"
        if destination.exists() and destination.read_bytes()[:8] == PNG_SIGNATURE:
            skipped += 1
            continue
        try:
            payload = http_get(f"{RAW_BASE}/{repo_icons[variant_id]}")
        except Exception as exc:  # noqa: BLE001 - reporte et continue
            failed.append(variant_id)
            print(f"  ECHEC {variant_id}: {exc}")
            continue
        if payload[:8] != PNG_SIGNATURE:
            failed.append(variant_id)
            print(f"  REJET {variant_id}: le contenu servi n'est pas un PNG")
            continue
        destination.write_bytes(payload)
        downloaded += 1
        if downloaded % 25 == 0:
            print(f"  ... {downloaded} telechargees")

    manifest = {
        "source": f"https://github.com/{REPO}",
        "asset_path": ICON_PREFIX + "*",
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "catalog_variants": len(catalog),
        "covered": len(covered) - len(failed),
        "failed": failed,
        "missing_from_source": missing,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"telechargees: {downloaded} | deja presentes: {skipped} | echecs: {len(failed)}")
    print(f"manquantes a la source: {len(missing)} (liste dans {MANIFEST_PATH.relative_to(PROJECT_ROOT)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
