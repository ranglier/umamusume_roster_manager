#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys

from lib.gametora_reference import update_umamusume_reference


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync local Umamusume reference data, normalized datasets, assets, and static bundle."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force a full refresh of raw datasets and visual assets.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    summary = update_umamusume_reference(force=args.force)

    print("")
    print("Update complete.")
    print(f"Raw datasets synced : {summary['rawDatasetCount']}")
    print(f"Normalized entities : {summary['normalizedEntityCount']}")
    print(f"Visual assets       : {summary['assetCount']}")
    print(f"Asset failures      : {summary['assetFailureCount']}")
    print(f"App output          : {summary['appEntry']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
