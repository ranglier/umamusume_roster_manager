from __future__ import annotations

from pathlib import Path
from typing import Any
import tomllib

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
VIEWS_DIR = ROOT / "views"


def read_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        data = tomllib.load(handle)
    data["_path"] = path
    return data


def load_entity_dir(dirname: str) -> dict[str, dict[str, Any]]:
    entities: dict[str, dict[str, Any]] = {}
    directory = DATA_DIR / dirname
    for path in sorted(directory.glob("*.toml")):
        data = read_toml(path)
        entity_id = data.get("id", path.stem)
        entities[entity_id] = data
    return entities


def load_account() -> dict[str, Any]:
    data = read_toml(DATA_DIR / "account" / "profile.toml")
    data.setdefault("id", "account-profile")
    return data


def load_cms() -> dict[str, dict[str, Any]]:
    cms: dict[str, dict[str, Any]] = {}
    cms_dir = DATA_DIR / "cms"
    for cm_dir in sorted(cms_dir.iterdir()):
        if not cm_dir.is_dir():
            continue
        cm_path = cm_dir / "cm.toml"
        if not cm_path.exists():
            continue
        data = read_toml(cm_path)
        data["_dir"] = cm_dir
        cms[data["id"]] = data
    return cms


def load_builds(cms: dict[str, dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    builds: dict[str, dict[str, Any]] = {}
    builds_by_cm: dict[str, list[dict[str, Any]]] = {}
    for cm_id, cm in cms.items():
        items: list[dict[str, Any]] = []
        builds_dir = cm["_dir"] / "builds"
        if builds_dir.exists():
            for path in sorted(builds_dir.glob("*.toml")):
                data = read_toml(path)
                data["_cm_dir"] = cm["_dir"]
                builds[data["id"]] = data
                items.append(data)
        builds_by_cm[cm_id] = items
    return builds, builds_by_cm


def load_dataset() -> dict[str, Any]:
    account = load_account()
    characters = load_entity_dir("characters")
    supports = load_entity_dir("supports")
    parents = load_entity_dir("parents")
    cms = load_cms()
    builds, builds_by_cm = load_builds(cms)
    return {
        "account": account,
        "characters": characters,
        "supports": supports,
        "parents": parents,
        "cms": cms,
        "builds": builds,
        "builds_by_cm": builds_by_cm,
    }


def entity_label(entity: dict[str, Any]) -> str:
    if "alt" in entity:
        return f"{entity['name']} [{entity['alt']}]"
    if "version" in entity:
        return f"{entity['name']} [{entity['version']}]"
    if "representative_name" in entity:
        return entity["representative_name"]
    return entity.get("name", entity.get("id", "unknown"))


def relative_to_root(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def readiness_rank(state: str) -> int:
    order = {"ready_now": 0, "farm_needed": 1, "blocked": 2}
    return order.get(state, 99)
