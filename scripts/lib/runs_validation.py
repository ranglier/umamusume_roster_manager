from __future__ import annotations

import re


def next_run_id(entries: list[dict]) -> str:
    next_number = 1
    for entry in entries:
        match = re.match(r"^run_(\d+)$", str(entry.get("id") or ""))
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"run_{next_number:03d}"
