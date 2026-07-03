from __future__ import annotations

import re


def next_profile_id(profiles: list[dict]) -> str:
    next_number = 1
    for profile in profiles:
        match = re.match(r"^p_(\d+)$", profile["id"])
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"p_{next_number:03d}"


def unique_profile_name(base_name: str, existing_names: set[str]) -> str:
    if base_name not in existing_names:
        return base_name

    suffix = " (imported)"
    candidate = f"{base_name}{suffix}"
    if candidate not in existing_names:
        return candidate

    index = 2
    while True:
        candidate = f"{base_name}{suffix} {index}"
        if candidate not in existing_names:
            return candidate
        index += 1
