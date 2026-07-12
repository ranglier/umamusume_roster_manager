#!/usr/bin/env python3
"""Fetch a dated community meta snapshot from uma.moe (Phase 4, Meta/Insights).

This is an OFFLINE tool, never called at UI runtime. It pages the public
`/api/v3/search` borrow-listing endpoint (records already sorted by borrow
popularity), counts how often each support card and each trained parent uma
appears in the top listings, normalizes those to a 0..1 popularity, and writes:

  - data/meta/uma_moe/<YYYY-MM-DD>.json   (dated archive, gitignored)
  - data/meta/latest.json                 (the one the app copies into dist)
  - dist/data/meta/latest.json            (served statically, best-effort load)

IDs are the game's numeric ids (identity-mapped to our reference; see
docs/EXTERNAL_SOURCES_PLAN.md "Spike uma.moe"). Be polite: bounded pages,
delay between requests, exponential backoff on HTTP 429. This samples the
*popular* pool (top listings) - it is an observational signal, labeled as such
in the UI, not canonical truth.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://uma.moe/api/v3/search"
USER_AGENT = "umamusume-roster-manager meta-snapshot (offline, polite)"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def fetch_page(page: int, limit: int, timeout: float, max_retries: int = 6) -> list[dict]:
    url = f"{API_URL}?page={page}&limit={limit}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Origin": "https://uma.moe", "Accept": "application/json"},
    )
    backoff = 10.0
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
            return payload.get("items") or []
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < max_retries - 1:
                print(f"  page {page}: rate-limited (429), backing off {backoff:.0f}s...")
                time.sleep(backoff)
                backoff *= 2
                continue
            raise
    return []


def aggregate(pages: int, limit: int, delay: float, timeout: float) -> tuple[Counter, Counter, int]:
    support_counts: Counter = Counter()
    character_counts: Counter = Counter()
    records = 0
    for page in range(pages):
        items = fetch_page(page, limit, timeout)
        if not items:
            print(f"  page {page}: empty, stopping early.")
            break
        for item in items:
            records += 1
            support = item.get("support_card") or {}
            support_id = support.get("support_card_id")
            if support_id is not None:
                support_counts[str(support_id)] += 1
            inheritance = item.get("inheritance") or {}
            main_parent_id = inheritance.get("main_parent_id")
            if main_parent_id is not None:
                character_counts[str(main_parent_id)] += 1
        print(f"  page {page}: {len(items)} listings (total {records})")
        if page < pages - 1:
            time.sleep(delay)
    return support_counts, character_counts, records


def to_popularity(counts: Counter, top: int) -> dict:
    if not counts:
        return {}
    max_count = max(counts.values())
    result = {}
    for entry_id, count in counts.most_common(top):
        result[entry_id] = {"count": count, "popularity": round(count / max_count, 4)}
    return result


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a dated uma.moe meta snapshot (offline).")
    parser.add_argument("--pages", type=int, default=15, help="Number of listing pages to sample (default 15).")
    parser.add_argument("--limit", type=int, default=100, help="Listings per page (max 100).")
    parser.add_argument("--delay", type=float, default=1.5, help="Seconds between requests (politeness).")
    parser.add_argument("--timeout", type=float, default=25.0, help="Per-request timeout in seconds.")
    parser.add_argument("--top", type=int, default=300, help="Keep the top-N most popular ids per category.")
    args = parser.parse_args()

    print(f"Sampling {args.pages} pages x {args.limit} listings from {API_URL} ...")
    support_counts, character_counts, records = aggregate(args.pages, min(args.limit, 100), args.delay, args.timeout)
    if not records:
        print("No records fetched - aborting (no snapshot written).")
        return 1

    snapshot = {
        "schema_version": 1,
        "source": "uma.moe",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sample_size": records,
        "pages": args.pages,
        "supports": to_popularity(support_counts, args.top),
        "characters": to_popularity(character_counts, args.top),
    }

    date_stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dated = PROJECT_ROOT / "data" / "meta" / "uma_moe" / f"{date_stamp}.json"
    latest = PROJECT_ROOT / "data" / "meta" / "latest.json"
    dist_latest = PROJECT_ROOT / "dist" / "data" / "meta" / "latest.json"
    write_json(dated, snapshot)
    write_json(latest, snapshot)
    write_json(dist_latest, snapshot)

    print("")
    print(f"Snapshot written: {dated}")
    print(f"  also: {latest}  and  {dist_latest}")
    print(f"  records: {records}  supports: {len(snapshot['supports'])}  characters: {len(snapshot['characters'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
