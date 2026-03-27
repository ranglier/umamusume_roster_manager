from __future__ import annotations

import json
import re
import shutil
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .sqlite_reference import build_reference_database


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = "1.0.0"
USER_AGENT = "Umamusume-Roster-Manager/1.0 (+local reference build)"
ProgressCallback = Callable[[dict[str, Any]], None]

TRACK_NAMES = {
    "10001": "Sapporo",
    "10002": "Hakodate",
    "10003": "Niigata",
    "10004": "Fukushima",
    "10005": "Nakayama",
    "10006": "Tokyo",
    "10007": "Chukyo",
    "10008": "Kyoto",
    "10009": "Hanshin",
    "10010": "Kokura",
    "10101": "Ooi",
    "10103": "Kawasaki",
    "10104": "Funabashi",
    "10105": "Morioka",
    "10201": "Longchamp",
    "10202": "Santa Anita Park",
}

TRACK_SLUGS = {
    "10001": "sapporo",
    "10002": "hakodate",
    "10003": "niigata",
    "10004": "fukushima",
    "10005": "nakayama",
    "10006": "tokyo",
    "10007": "chukyo",
    "10008": "kyoto",
    "10009": "hanshin",
    "10010": "kokura",
    "10101": "ooi",
    "10103": "kawasaki",
    "10104": "funabashi",
    "10105": "morioka",
    "10201": "longchamp",
    "10202": "santa-anita-park",
}

APTITUDE_ORDER = {
    "S": 8,
    "A": 7,
    "B": 6,
    "C": 5,
    "D": 4,
    "E": 3,
    "F": 2,
    "G": 1,
}

APTITUDE_DISPLAY_LABELS = {
    "turf": "Turf",
    "dirt": "Dirt",
    "short": "Short",
    "mile": "Mile",
    "medium": "Medium",
    "long": "Long",
    "runner": "Front",
    "leader": "Pace",
    "betweener": "Late",
    "chaser": "End",
}

SKILL_TAG_DISPLAY_LABELS = {
    "tur": "Turf",
    "dir": "Dirt",
    "sho": "Short",
    "mil": "Mile",
    "med": "Medium",
    "lng": "Long",
    "run": "Front",
    "ldr": "Pace",
    "btw": "Late",
    "cha": "End",
    "str": "Straight",
    "cor": "Corner",
    "slo": "Slope",
    "f_s": "Final Straight",
    "f_c": "Final Corner",
    "l_0": "Early Race",
    "l_1": "Mid Race",
    "l_2": "Late Race",
    "l_3": "Last Spurt",
    "dbf": "Debuff",
    "nac": "General",
}

WEATHER_LABELS = {
    1: "Sunny",
    2: "Cloudy",
    3: "Rain",
    4: "Snow",
    99999: "Varies",
}

TRACK_CONDITION_LABELS = {
    1: "Good",
    2: "Yielding",
    3: "Soft",
    4: "Heavy",
    99999: "Varies",
}

TRAINING_EVENT_SOURCE_LABELS = {
    "shared": "Shared",
    "char": "Character",
    "char_card": "Character Card",
    "friend": "Friend",
    "group": "Group",
    "scenario": "Scenario",
    "sr": "SR Support",
    "ssr": "SSR Support",
}

SCENARIO_DISPLAY_NAMES = {
    "scenario_ura": "URA Finale",
    "scenario_aoharu": "Aoharu Cup",
    "scenario_make_a_new_track": "Make a New Track",
    "scenario_gl": "Grand Live",
    "scenario_gm": "Grand Masters",
    "scenario_larc": "Project L'Arc",
    "scenario_uaf": "U.A.F. Ready GO!",
    "scenario_cooking": "Harvest Festival",
    "scenario_mecha": "Run! Mecha Umamusume",
    "scenario_legend": "Twinkle Legends",
}


def ensure_directory(path: Path | str | None) -> None:
    if not path:
        return
    Path(path).mkdir(parents=True, exist_ok=True)


def write_utf8_file(path: Path | str, content: str, *, with_bom: bool = False) -> None:
    target = Path(path)
    ensure_directory(target.parent)
    target.write_text(content, encoding="utf-8-sig" if with_bom else "utf-8")


def write_binary_file(path: Path | str, payload: bytes) -> None:
    target = Path(path)
    ensure_directory(target.parent)
    target.write_bytes(payload)


def write_json_file(path: Path | str, obj: Any, *, compress: bool = False) -> None:
    if compress:
        content = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        content = json.dumps(obj, ensure_ascii=False, indent=2)
    write_utf8_file(path, content + "\n")


def read_json_file(path: Path | str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def as_array(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def get_named_value(container: Any, name: str) -> Any:
    if container is None:
        return None
    if isinstance(container, dict):
        return container.get(name)
    return getattr(container, name, None)


def coalesce(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            if value.strip():
                return value
            continue
        return value
    return None


def get_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_config() -> dict[str, Any]:
    return read_json_file(PROJECT_ROOT / "config" / "sources.json")


def join_url_path(base: str, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def expand_template_string(template: str, values: dict[str, Any]) -> str:
    result = template
    for key, value in values.items():
        result = result.replace("{" + key + "}", str(value))
    return result


def new_asset_descriptor(config: dict[str, Any], asset_key: str, tokens: dict[str, Any], alt: str) -> dict[str, Any] | None:
    definition = get_named_value(config.get("assets"), asset_key)
    if definition is None:
        return None

    relative_path = expand_template_string(definition["pathTemplate"], tokens).replace("\\", "/")
    url_path = expand_template_string(definition["urlTemplate"], tokens)

    return OrderedDict(
        [
            ("key", asset_key),
            ("role", definition["role"]),
            ("type", "image"),
            ("relative_path", relative_path),
            ("source_url", join_url_path(config["assetBaseUrl"], url_path)),
            ("content_type", "image/png"),
            ("alt", alt),
        ]
    )


def _build_request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})


def invoke_remote_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(_build_request(url)) as response:
        payload = response.read()
    raw = payload.decode("utf-8")
    return {"Raw": raw, "Json": json.loads(raw)}


def invoke_remote_binary(url: str) -> bytes:
    with urllib.request.urlopen(_build_request(url)) as response:
        return response.read()


def get_raw_dataset_path(raw_root: Path, key: str, hash_value: str) -> Path:
    segments = key.split("/")
    directory = raw_root.joinpath(*segments[:-1]) if len(segments) > 1 else raw_root
    leaf = f"{segments[-1]}.{hash_value}.json"
    return directory / leaf


def get_metadata_path() -> Path:
    return PROJECT_ROOT / "data" / "raw" / "metadata.json"


def get_asset_metadata_path() -> Path:
    return PROJECT_ROOT / "data" / "raw" / "assets" / "metadata.json"


def get_existing_raw_metadata() -> dict[str, Any]:
    path = get_metadata_path()
    if path.exists():
        return read_json_file(path)
    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("game", "umamusume"),
            ("datasets", OrderedDict()),
        ]
    )


def get_existing_asset_metadata() -> dict[str, Any]:
    path = get_asset_metadata_path()
    if path.exists():
        return read_json_file(path)
    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("generated_at", None),
            ("asset_base_url", None),
            ("asset_serve_base_path", None),
            (
                "counts",
                OrderedDict(
                    [
                        ("total", 0),
                        ("downloaded", 0),
                        ("reused", 0),
                        ("stale", 0),
                        ("failed", 0),
                    ]
                ),
            ),
            ("assets", OrderedDict()),
        ]
    )


def get_entity_definition(config: dict[str, Any], entity_key: str) -> dict[str, Any]:
    for entity in as_array(config.get("entities")):
        if entity.get("key") == entity_key:
            return entity
    raise ValueError(f"Unknown entity definition: {entity_key}")


def new_source_stamp(config: dict[str, Any], metadata: dict[str, Any], entity_key: str) -> dict[str, Any]:
    entity = get_entity_definition(config, entity_key)
    datasets: list[dict[str, Any]] = []
    hashes: dict[str, Any] = OrderedDict()
    latest: str | None = None

    for dataset_key in as_array(entity.get("datasetKeys")):
        entry = get_named_value(metadata.get("datasets"), dataset_key)
        if entry is None:
            continue

        hashes[dataset_key] = entry["hash"]
        datasets.append(
            OrderedDict(
                [
                    ("key", dataset_key),
                    ("hash", entry["hash"]),
                    ("url", entry["url"]),
                    ("local_path", entry["local_path"]),
                    ("downloaded_at", entry["downloaded_at"]),
                ]
            )
        )

        downloaded_at = entry.get("downloaded_at")
        if downloaded_at and (latest is None or downloaded_at > latest):
            latest = downloaded_at

    return OrderedDict(
        [
            ("entity", entity_key),
            ("label", entity["label"]),
            ("source_site", config["sourceSite"]),
            ("imported_at", latest),
            ("page_urls", as_array(entity.get("pageUrls"))),
            ("dataset_keys", as_array(entity.get("datasetKeys"))),
            ("dataset_hashes", hashes),
            ("datasets", datasets),
        ]
    )


def sync_reference_raw_data(*, force: bool = False, progress_callback: ProgressCallback | None = None) -> dict[str, Any]:
    config = get_config()
    raw_root = PROJECT_ROOT / "data" / "raw" / "umamusume"
    manifest_root = PROJECT_ROOT / "data" / "raw" / "manifests"
    ensure_directory(raw_root)
    ensure_directory(manifest_root)

    existing_metadata = get_existing_raw_metadata()
    manifest_result = invoke_remote_json(config["manifestUrl"])
    manifest = manifest_result["Json"]
    manifest_path = manifest_root / "umamusume.json"
    write_utf8_file(manifest_path, manifest_result["Raw"])

    dataset_metadata: dict[str, Any] = OrderedDict()
    datasets = as_array(config.get("datasets"))
    total_datasets = max(1, len(datasets))
    for index, dataset in enumerate(datasets, start=1):
        key = dataset["key"]
        if progress_callback:
            progress = 4 + round((index - 1) / total_datasets * 12)
            progress_callback(
                {
                    "progress": progress,
                    "message": f"Syncing source dataset {index}/{total_datasets}: {key}",
                    "current_task": f"Fetching source dataset {key}",
                }
            )
        hash_value = get_named_value(manifest, key)
        if not hash_value:
            raise ValueError(f"Missing manifest hash for dataset key: {key}")

        local_path = get_raw_dataset_path(raw_root, key, hash_value)
        remote_url = f"{config['datasetBaseUrl']}/{key}.{hash_value}.json"
        previous = get_named_value(existing_metadata.get("datasets"), key)

        should_download = force or not local_path.exists()
        if not should_download and previous is not None:
            should_download = previous.get("hash") != hash_value

        downloaded_at = previous.get("downloaded_at") if previous else None
        status = "reused"

        if should_download:
            print(f"Syncing raw dataset {key}...")
            dataset_result = invoke_remote_json(remote_url)
            write_utf8_file(local_path, dataset_result["Raw"])
            downloaded_at = get_now_iso()
            status = "downloaded"

        dataset_metadata[key] = OrderedDict(
            [
                ("key", key),
                ("hash", hash_value),
                ("url", remote_url),
                ("page_url", dataset["pageUrl"]),
                ("local_path", str(local_path)),
                ("downloaded_at", downloaded_at),
                ("checked_at", get_now_iso()),
                ("status", status),
            ]
        )

    metadata = OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("game", config["game"]),
            ("source_site", config["sourceSite"]),
            ("manifest_url", config["manifestUrl"]),
            ("manifest_local_path", str(manifest_path)),
            ("manifest_checked_at", get_now_iso()),
            ("datasets", dataset_metadata),
        ]
    )
    write_json_file(get_metadata_path(), metadata)
    return OrderedDict([("config", config), ("manifest", manifest), ("metadata", metadata)])


def load_raw_dataset_by_key(metadata: dict[str, Any], key: str) -> Any:
    entry = get_named_value(metadata.get("datasets"), key)
    if entry is None:
        raise ValueError(f"Dataset metadata missing for key: {key}")
    return read_json_file(entry["local_path"])


def get_track_name(track_id: str) -> str:
    return TRACK_NAMES.get(str(track_id), "Unknown racetrack")


def get_track_slug(track_id: str) -> str:
    return TRACK_SLUGS.get(str(track_id), "unknown-racetrack")


def get_terrain_label(value: Any) -> str:
    return {1: "Turf", 2: "Dirt", 99999: "Varies"}.get(int(value), "Unknown")


def get_terrain_slug(value: Any) -> str:
    return {1: "turf", 2: "dirt", 99999: "varies"}.get(int(value), "unknown")


def get_direction_label(value: Any) -> str:
    return {1: "Right", 2: "Left", 3: "Straight", 4: "Straight", 99999: "Varies"}.get(int(value), "Unknown")


def get_direction_slug(value: Any) -> str:
    return {1: "right", 2: "left", 3: "straight", 4: "straight", 99999: "varies"}.get(int(value), "unknown")


def get_season_label(value: Any) -> str:
    return {1: "Spring", 2: "Summer", 3: "Fall", 4: "Winter", 5: "Spring"}.get(int(value), "Unknown")


def get_season_slug(value: Any) -> str:
    return {1: "spring", 2: "summer", 3: "fall", 4: "winter", 5: "spring"}.get(int(value), "unknown")


def get_time_of_day_label(value: Any) -> str:
    return {1: "Morning", 2: "Daytime", 3: "Evening", 4: "Night"}.get(int(value), "Unknown")


def get_time_of_day_slug(value: Any) -> str:
    return {1: "morning", 2: "daytime", 3: "evening", 4: "night"}.get(int(value), "unknown")


def get_weather_label(value: Any) -> str:
    return WEATHER_LABELS.get(int(value), f"Weather {value}")


def get_weather_slug(value: Any) -> str:
    return slugify_text(get_weather_label(value))


def get_track_condition_label(value: Any) -> str:
    return TRACK_CONDITION_LABELS.get(int(value), f"Condition {value}")


def get_track_condition_slug(value: Any) -> str:
    return slugify_text(get_track_condition_label(value))


def get_course_layout_label(value: Any) -> str:
    return {1: "Main", 2: "Inner", 3: "Outer", 4: "Outer to Inner", 99999: "Varies"}.get(int(value), "Unknown")


def get_course_layout_slug(value: Any) -> str:
    return {1: "main", 2: "inner", 3: "outer", 4: "outer-to-inner", 99999: "varies"}.get(int(value), "unknown")


def get_distance_category_label(meters: Any) -> str:
    meters = int(meters)
    if meters >= 99999:
        return "Varies"
    if meters < 1401:
        return "Short"
    if meters < 1801:
        return "Mile"
    if meters < 2401:
        return "Medium"
    return "Long"


def get_distance_category_slug(meters: Any) -> str:
    meters = int(meters)
    if meters >= 99999:
        return "varies"
    if meters < 1401:
        return "short"
    if meters < 1801:
        return "mile"
    if meters < 2401:
        return "medium"
    return "long"


def get_distance_category_from_code(value: Any) -> str:
    return {1: "Short", 2: "Mile", 3: "Medium", 4: "Long", 99999: "Varies"}.get(int(value), "Unknown")


def get_distance_category_slug_from_code(value: Any) -> str:
    return {1: "short", 2: "mile", 3: "medium", 4: "long", 99999: "varies"}.get(int(value), "unknown")


def get_race_grade_label(group: Any, grade: Any) -> str:
    group_id = int(group)
    grade_id = int(grade)
    mapping = {
        1: {100: "G1", 200: "G2", 300: "G3", 400: "OP", 700: "Pre-OP"},
        2: {999: "EX"},
        7: {100: "EX", 800: "Maiden", 900: "Debut"},
        8: {100: "EX"},
        9: {100: "G1"},
        61: {100: "G1"},
    }
    return mapping.get(group_id, {}).get(grade_id, "Unknown grade")


def get_sex_label(value: Any) -> str:
    return {1: "Mare", 2: "Stallion"}.get(int(value), "Unknown")


def slugify_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    slug = re.sub(r"[^a-z0-9]+", "-", text)
    return slug.strip("-")


def unix_timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def get_training_event_source_label(value: Any) -> str:
    return TRAINING_EVENT_SOURCE_LABELS.get(str(value), convert_display_label(str(value), None) or str(value))


def get_scenario_display_name(key: Any, factor_name: Any = None) -> str:
    key_str = str(key or "").strip()
    if key_str in SCENARIO_DISPLAY_NAMES:
        return SCENARIO_DISPLAY_NAMES[key_str]
    if factor_name:
        return str(factor_name)
    normalized = key_str.replace("scenario_", "").replace("_", " ").strip()
    return normalized.title() if normalized else "Scenario"


def build_reference_entry(entity_key: str, item: Any, *, subtitle: str | None = None) -> dict[str, Any] | None:
    if item is None:
        return None

    item_id = str(get_named_value(item, "id") or "").strip()
    if not item_id:
        return None

    title = coalesce(get_named_value(item, "name"), get_named_value(item, "title"), item_id)
    resolved_subtitle = subtitle if subtitle is not None else get_named_value(item, "subtitle")
    availability_en = None
    release = get_named_value(item, "release")
    available = get_named_value(item, "available")
    if release is not None:
        availability_en = "available" if get_named_value(release, "en") else "unreleased"
    elif isinstance(available, dict):
        availability_en = "available" if available.get("en") else "unreleased"

    return OrderedDict(
        [
            ("entityKey", entity_key),
            ("id", item_id),
            ("title", str(title)),
            ("subtitle", resolved_subtitle),
            ("availabilityEn", availability_en),
        ]
    )


def convert_skill_ref(skill_id: Any, skill_lookup: dict[str, Any]) -> dict[str, Any] | None:
    if skill_id is None:
        return None

    key = str(skill_id)
    skill = get_named_value(skill_lookup, key)
    gene_version = get_named_value(skill, "gene_version") if skill else None
    skill_name = (
        coalesce(
            get_named_value(skill, "name_en"),
            get_named_value(skill, "enname"),
            get_named_value(skill, "jpname"),
        )
        if skill
        else None
    )
    skill_rarity = get_named_value(skill, "rarity") if skill else None
    skill_cost = (
        coalesce(
            get_named_value(skill, "cost"),
            get_named_value(gene_version, "cost"),
        )
        if skill
        else None
    )

    return OrderedDict(
        [
            ("id", int(skill_id)),
            ("name", skill_name),
            ("rarity", int(skill_rarity) if skill_rarity is not None else None),
            ("cost", skill_cost),
        ]
    )


def convert_skill_id_list(ids: Any, skill_lookup: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for skill_id in as_array(ids):
        ref = convert_skill_ref(skill_id, skill_lookup)
        if ref is not None:
            result.append(ref)
    return result


def convert_condition_groups(condition_groups: Any) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for group in as_array(condition_groups):
        effects: list[dict[str, Any]] = []
        for effect in as_array(group.get("effects")):
            effects.append(
                OrderedDict(
                    [
                        ("type", int(effect["type"])),
                        ("value", coalesce(effect.get("value"), effect.get("value_1"))),
                    ]
                )
            )
        groups.append(
            OrderedDict(
                [
                    ("base_time", group.get("base_time")),
                    ("precondition", group.get("precondition")),
                    ("condition", group.get("condition")),
                    ("effects", effects),
                ]
            )
        )
    return groups


def convert_support_effect_entries(raw_effects: Any, effect_lookup: dict[str, Any]) -> list[dict[str, Any]]:
    effects: list[dict[str, Any]] = []
    for raw in as_array(raw_effects):
        values_raw = as_array(raw)
        if len(values_raw) < 1:
            continue

        effect_id = int(values_raw[0])
        catalog = get_named_value(effect_lookup, str(effect_id))
        values: list[dict[str, Any]] = []

        for index, value in enumerate(values_raw[1:], start=1):
            numeric_value = float(value)
            if numeric_value >= 0:
                values.append(OrderedDict([("stage_index", index), ("value", numeric_value)]))

        max_value = max((entry["value"] for entry in values), default=None)
        effects.append(
            OrderedDict(
                [
                    ("effect_id", effect_id),
                    ("name", coalesce(get_named_value(catalog, "name_en_eon"), get_named_value(catalog, "name_en"), get_named_value(catalog, "name_ja")) if catalog else None),
                    ("description", coalesce(get_named_value(catalog, "desc_en_eon"), get_named_value(catalog, "desc_en"), get_named_value(catalog, "desc_ja")) if catalog else None),
                    ("calc", get_named_value(catalog, "calc") if catalog else None),
                    ("symbol", get_named_value(catalog, "symbol") if catalog else None),
                    ("max_value", max_value),
                    ("values", values),
                ]
            )
        )
    return effects


def convert_support_unique_effects(unique: Any, effect_lookup: dict[str, Any]) -> list[dict[str, Any]]:
    if unique is None:
        return []

    effects: list[dict[str, Any]] = []
    for entry in as_array(unique.get("effects")):
        catalog = get_named_value(effect_lookup, str(entry["type"]))
        effects.append(
            OrderedDict(
                [
                    ("effect_id", int(entry["type"])),
                    ("name", coalesce(get_named_value(catalog, "name_en_eon"), get_named_value(catalog, "name_en"), get_named_value(catalog, "name_ja")) if catalog else None),
                    ("description", coalesce(get_named_value(catalog, "desc_en_eon"), get_named_value(catalog, "desc_en"), get_named_value(catalog, "desc_ja")) if catalog else None),
                    ("calc", get_named_value(catalog, "calc") if catalog else None),
                    ("symbol", get_named_value(catalog, "symbol") if catalog else None),
                    ("value", entry.get("value")),
                ]
            )
        )
    return effects


def get_aptitude_value(letter: str | None) -> int:
    if not letter:
        return 0
    return APTITUDE_ORDER.get(letter.upper(), 0)


def get_viable_aptitudes(mapping: dict[str, Any]) -> list[str]:
    threshold = get_aptitude_value("A")
    result = [key for key, value in mapping.items() if get_aptitude_value(str(value)) >= threshold]
    return result


def get_birthday_string(record: dict[str, Any]) -> str | None:
    year = coalesce(record.get("birth_year"), record.get("birthYear"))
    month = coalesce(record.get("birth_month"), record.get("birthMonth"))
    day = coalesce(record.get("birth_day"), record.get("birthDay"))

    if month is None or day is None:
        return None
    if year is None:
        return f"{int(month):02d}-{int(day):02d}"
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def build_lookup(items: Any, prop: str) -> dict[str, Any]:
    lookup: dict[str, Any] = {}
    for item in as_array(items):
        value = str(get_named_value(item, prop) or "")
        if value.strip():
            lookup[value] = item
    return lookup


def build_group_lookup(items: Any, prop: str) -> dict[str, list[Any]]:
    lookup: dict[str, list[Any]] = {}
    for item in as_array(items):
        value = str(get_named_value(item, prop) or "")
        if not value.strip():
            continue
        lookup.setdefault(value, []).append(item)
    return lookup


def is_training_event_entry(value: Any) -> bool:
    return isinstance(value, list) and len(value) >= 3 and isinstance(value[2], (int, str))


def is_training_event_group(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0 and all(is_training_event_entry(entry) for entry in value)


def normalize_training_event_choices(choices: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, choice in enumerate(as_array(choices), start=1):
        if isinstance(choice, list) and len(choice) >= 2:
            token = choice[0]
            effect_tokens = as_array(choice[1])
        else:
            token = None
            effect_tokens = as_array(choice)
        normalized.append(
            OrderedDict(
                [
                    ("index", index),
                    ("choice_token", token),
                    ("choice_label", convert_display_label(str(token), None) if token is not None else f"Choice {index}"),
                    ("effect_tokens", effect_tokens),
                    ("effect_count", len(effect_tokens)),
                ]
            )
        )
    return normalized


def build_training_event_name_lookup(te_pairs_en: Any) -> dict[str, list[str]]:
    lookup: dict[str, list[str]] = {}
    for pair in as_array(te_pairs_en):
        if not isinstance(pair, list) or len(pair) < 2:
            continue
        name = str(pair[0] or "").strip()
        owner_id = str(pair[1] or "").strip()
        if not name or not owner_id:
            continue
        lookup.setdefault(owner_id, []).append(name)
    return lookup


def build_character_card_reference_from_raw(card: Any) -> dict[str, Any] | None:
    if card is None:
        return None
    return OrderedDict(
        [
            ("entityKey", "characters"),
            ("id", str(card["card_id"])),
            ("title", coalesce(card.get("name_en"), card.get("name_jp"), card["card_id"])),
            ("subtitle", f"{coalesce(card.get('title_en_gl'), card.get('title_jp'), 'Variant')} | {card['rarity']}-star"),
            ("availabilityEn", "available" if card.get("release_en") else "unreleased"),
        ]
    )


def build_support_reference_from_raw(card: Any) -> dict[str, Any] | None:
    if card is None:
        return None
    rarity_label = {1: "R", 2: "SR", 3: "SSR"}.get(int(card["rarity"]), f"R{card['rarity']}")
    return OrderedDict(
        [
            ("entityKey", "supports"),
            ("id", str(card["support_id"])),
            ("title", coalesce(card.get("char_name"), card.get("name_jp"), card["support_id"])),
            ("subtitle", f"{card.get('type') or 'Support'} | {rarity_label}"),
            ("availabilityEn", "available" if card.get("release_en") else "unreleased"),
        ]
    )


def build_scenario_reference_from_raw(scenario_id: Any, scenario_entry: Any) -> dict[str, Any] | None:
    if scenario_id is None:
        return None
    scenario_key = get_named_value(scenario_entry, "str")
    factors = as_array(get_named_value(scenario_entry, "factors"))
    first_factor = factors[0] if factors else None
    title = get_scenario_display_name(scenario_key, coalesce(get_named_value(first_factor, "name_en"), get_named_value(first_factor, "name_ja")))
    subtitle = convert_display_label(str(scenario_key).replace("scenario_", ""), None) if scenario_key else None
    return OrderedDict(
        [
            ("entityKey", "scenarios"),
            ("id", str(scenario_id)),
            ("title", title),
            ("subtitle", subtitle),
            ("availabilityEn", None),
        ]
    )


def normalize_characters(
    config: dict[str, Any],
    metadata: dict[str, Any],
    base_characters: Any,
    character_cards: Any,
    skills: Any,
) -> dict[str, Any]:
    base_lookup = build_lookup(base_characters, "char_id")
    skill_lookup = build_lookup(skills, "id")
    items: list[dict[str, Any]] = []

    for card in as_array(character_cards):
        base = get_named_value(base_lookup, str(card["char_id"]))

        surface = OrderedDict([("turf", card["aptitude"][0]), ("dirt", card["aptitude"][1])])
        distance = OrderedDict(
            [
                ("short", card["aptitude"][2]),
                ("mile", card["aptitude"][3]),
                ("medium", card["aptitude"][4]),
                ("long", card["aptitude"][5]),
            ]
        )
        style = OrderedDict(
            [
                ("runner", card["aptitude"][6]),
                ("leader", card["aptitude"][7]),
                ("betweener", card["aptitude"][8]),
                ("chaser", card["aptitude"][9]),
            ]
        )

        skills_evo: list[dict[str, Any]] = []
        for evo in as_array(card.get("skills_evo")):
            skills_evo.append(
                OrderedDict(
                    [
                        ("from", convert_skill_ref(evo.get("old"), skill_lookup)),
                        ("to", convert_skill_ref(evo.get("new"), skill_lookup)),
                    ]
                )
            )

        name = coalesce(card.get("name_en"), card.get("name_jp"))
        title = coalesce(card.get("title_en_gl"), card.get("title_jp"), "portrait")
        items.append(
            OrderedDict(
                [
                    ("id", str(card["card_id"])),
                    ("card_id", int(card["card_id"])),
                    ("base_character_id", int(card["char_id"])),
                    ("url_name", card.get("url_name")),
                    ("base_url_name", base.get("url_name") if base else None),
                    ("name", name),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", card.get("name_en")),
                                ("ja", card.get("name_jp")),
                                ("ko", card.get("name_ko")),
                                ("zh_tw", card.get("name_tw")),
                            ]
                        ),
                    ),
                    ("variant", card.get("title_en_gl")),
                    (
                        "titles",
                        OrderedDict(
                            [
                                ("en", card.get("title_en_gl")),
                                ("ja", card.get("title_jp")),
                                ("ko", card.get("title_ko")),
                                ("zh_tw", card.get("title_tw")),
                            ]
                        ),
                    ),
                    ("rarity", int(card["rarity"])),
                    ("obtained", card.get("obtained")),
                    (
                        "release",
                        OrderedDict(
                            [
                                ("jp", card.get("release")),
                                ("en", card.get("release_en")),
                                ("ko", card.get("release_ko")),
                                ("zh_tw", card.get("release_zh_tw")),
                            ]
                        ),
                    ),
                    (
                        "assets",
                        OrderedDict(
                            [
                                (
                                    "portrait",
                                    new_asset_descriptor(
                                        config,
                                        "character_portrait",
                                        {"base_character_id": int(card["char_id"]), "card_id": int(card["card_id"])},
                                        f"{name} {title}",
                                    ),
                                )
                            ]
                        ),
                    ),
                    ("aptitudes", OrderedDict([("surface", surface), ("distance", distance), ("style", style)])),
                    (
                        "viable_aptitudes",
                        OrderedDict(
                            [
                                ("surface", get_viable_aptitudes(surface)),
                                ("distance", get_viable_aptitudes(distance)),
                                ("style", get_viable_aptitudes(style)),
                            ]
                        ),
                    ),
                    (
                        "stat_bonus",
                        OrderedDict(
                            [
                                ("speed", card["stat_bonus"][0]),
                                ("stamina", card["stat_bonus"][1]),
                                ("power", card["stat_bonus"][2]),
                                ("guts", card["stat_bonus"][3]),
                                ("wit", card["stat_bonus"][4]),
                            ]
                        ),
                    ),
                    (
                        "stats",
                        OrderedDict(
                            [
                                (
                                    "base",
                                    OrderedDict(
                                        [
                                            ("speed", card["base_stats"][0]),
                                            ("stamina", card["base_stats"][1]),
                                            ("power", card["base_stats"][2]),
                                            ("guts", card["base_stats"][3]),
                                            ("wit", card["base_stats"][4]),
                                        ]
                                    ),
                                ),
                                (
                                    "four_star",
                                    OrderedDict(
                                        [
                                            ("speed", card["four_star_stats"][0]),
                                            ("stamina", card["four_star_stats"][1]),
                                            ("power", card["four_star_stats"][2]),
                                            ("guts", card["four_star_stats"][3]),
                                            ("wit", card["four_star_stats"][4]),
                                        ]
                                    ),
                                ),
                                (
                                    "five_star",
                                    OrderedDict(
                                        [
                                            ("speed", card["five_star_stats"][0]),
                                            ("stamina", card["five_star_stats"][1]),
                                            ("power", card["five_star_stats"][2]),
                                            ("guts", card["five_star_stats"][3]),
                                            ("wit", card["five_star_stats"][4]),
                                        ]
                                    ),
                                ),
                            ]
                        ),
                    ),
                    (
                        "skill_links",
                        OrderedDict(
                            [
                                ("unique", convert_skill_id_list(card.get("skills_unique"), skill_lookup)),
                                ("innate", convert_skill_id_list(card.get("skills_innate"), skill_lookup)),
                                ("awakening", convert_skill_id_list(card.get("skills_awakening"), skill_lookup)),
                                ("event", convert_skill_id_list(card.get("skills_event"), skill_lookup)),
                                ("evolution", skills_evo),
                            ]
                        ),
                    ),
                    (
                        "profile",
                        OrderedDict(
                            [
                                ("birthday", get_birthday_string(base) if base else None),
                                ("height_cm", base.get("height") if base else None),
                                ("measurements", base.get("three_sizes") if base else None),
                                ("sex", get_sex_label(base["sex"]) if base and base.get("sex") is not None else None),
                                ("race", base.get("race") if base else None),
                                (
                                    "playable",
                                    OrderedDict(
                                        [
                                            ("jp", bool(base.get("playable"))),
                                            ("en", bool(base.get("playable_en"))),
                                            ("ko", bool(base.get("playable_ko"))),
                                            ("zh_tw", bool(base.get("playable_zh_tw"))),
                                        ]
                                    )
                                    if base
                                    else None,
                                ),
                                (
                                    "active",
                                    OrderedDict(
                                        [
                                            ("jp", bool(base.get("active"))),
                                            ("en", bool(base.get("active_en"))),
                                            ("ko", bool(base.get("active_ko"))),
                                            ("zh_tw", bool(base.get("active_zh_tw"))),
                                        ]
                                    )
                                    if base
                                    else None,
                                ),
                                (
                                    "voice_actor",
                                    OrderedDict(
                                        [
                                            ("en", base.get("va_en")),
                                            ("ja", base.get("va_ja")),
                                            ("ko", base.get("va_ko")),
                                            ("zh_tw", base.get("va_zh_tw")),
                                            ("link", base.get("va_link")),
                                        ]
                                    )
                                    if base
                                    else None,
                                ),
                                ("real_life", base.get("rl") if base else None),
                            ]
                        ),
                    ),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "characters"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "characters")),
            ("items", items),
        ]
    )


def normalize_supports(
    config: dict[str, Any],
    metadata: dict[str, Any],
    support_cards: Any,
    support_effects: Any,
    skills: Any,
) -> dict[str, Any]:
    effect_lookup = build_lookup(support_effects, "id")
    skill_lookup = build_lookup(skills, "id")
    items: list[dict[str, Any]] = []

    for card in as_array(support_cards):
        hint_other: list[dict[str, Any]] = []
        hints = card.get("hints") or {}
        for hint in as_array(get_named_value(hints, "hint_others")):
            hint_other.append(
                OrderedDict(
                    [
                        ("hint_type", hint.get("hint_type")),
                        ("hint_value", hint.get("hint_value")),
                    ]
                )
            )

        name = coalesce(card.get("char_name"), card.get("name_jp"))
        items.append(
            OrderedDict(
                [
                    ("id", str(card["support_id"])),
                    ("support_id", int(card["support_id"])),
                    ("character_id", int(card["char_id"])),
                    ("url_name", card.get("url_name")),
                    ("name", name),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", card.get("char_name")),
                                ("ja", card.get("name_jp")),
                                ("ko", card.get("name_ko")),
                                ("zh_tw", card.get("name_tw")),
                            ]
                        ),
                    ),
                    ("type", card.get("type")),
                    ("rarity", int(card["rarity"])),
                    ("obtained", card.get("obtained")),
                    (
                        "release",
                        OrderedDict(
                            [
                                ("jp", card.get("release")),
                                ("en", card.get("release_en")),
                                ("ko", card.get("release_ko")),
                                ("zh_tw", card.get("release_zh_tw")),
                            ]
                        ),
                    ),
                    (
                        "assets",
                        OrderedDict(
                            [
                                (
                                    "cover",
                                    new_asset_descriptor(
                                        config,
                                        "support_cover",
                                        {"support_id": int(card["support_id"])},
                                        f"{name} support card illustration",
                                    ),
                                ),
                                (
                                    "icon",
                                    new_asset_descriptor(
                                        config,
                                        "support_icon",
                                        {"support_id": int(card["support_id"])},
                                        f"{name} support card icon",
                                    ),
                                ),
                            ]
                        ),
                    ),
                    ("effects", convert_support_effect_entries(card.get("effects"), effect_lookup)),
                    ("unique_effects", convert_support_unique_effects(get_named_value(card, "unique"), effect_lookup)),
                    ("unique_effect_unlock_level", get_named_value(card.get("unique"), "level") if get_named_value(card, "unique") else None),
                    ("hint_skills", convert_skill_id_list(get_named_value(hints, "hint_skills"), skill_lookup)),
                    ("hint_other_effects", hint_other),
                    ("event_skills", convert_skill_id_list(card.get("event_skills"), skill_lookup)),
                ]
            )
        )

    effect_catalog: list[dict[str, Any]] = []
    for effect in as_array(support_effects):
        effect_catalog.append(
            OrderedDict(
                [
                    ("effect_id", int(effect["id"])),
                    ("name", coalesce(effect.get("name_en_eon"), effect.get("name_en"), effect.get("name_ja"))),
                    ("description", coalesce(effect.get("desc_en_eon"), effect.get("desc_en"), effect.get("desc_ja"))),
                    ("calc", effect.get("calc")),
                    ("symbol", effect.get("symbol")),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "supports"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "supports")),
            ("effect_catalog", effect_catalog),
            ("items", items),
        ]
    )


def normalize_character_progression(
    config: dict[str, Any],
    metadata: dict[str, Any],
    character_cards: Any,
    card_talent_upgrade: Any,
    skills: Any,
) -> dict[str, Any]:
    skill_lookup = build_lookup(skills, "id")
    cost_lookup: dict[str, list[dict[str, Any]]] = {}

    for upgrade in as_array(card_talent_upgrade):
        talent_group_id = str(upgrade.get("talent_group_id") or "").strip()
        if not talent_group_id:
            continue

        costs: list[dict[str, Any]] = []
        for slot_index in range(1, 9):
            item_category = upgrade.get(f"item_category_{slot_index}")
            item_id = upgrade.get(f"item_id_{slot_index}")
            item_num = upgrade.get(f"item_num_{slot_index}")
            if item_category is None and item_id is None and item_num is None:
                continue
            costs.append(
                OrderedDict(
                    [
                        ("slot_index", slot_index),
                        ("item_category", item_category),
                        ("item_id", item_id),
                        ("item_num", item_num),
                    ]
                )
            )

        cost_lookup.setdefault(talent_group_id, []).append(
            OrderedDict(
                [
                    ("talent_level", int(upgrade.get("talent_level") or 0)),
                    ("costs", costs),
                ]
            )
        )

    items: list[dict[str, Any]] = []
    for card in as_array(character_cards):
        card_id = str(card.get("card_id") or "").strip()
        if not card_id:
            continue

        talent_group_id = int(card.get("talent_group") or card.get("talent_group_id") or card.get("card_id") or 0)
        awakening_skills = convert_skill_id_list(card.get("skills_awakening"), skill_lookup)
        awakening_levels: list[dict[str, Any]] = []
        for level_entry in sorted(cost_lookup.get(str(talent_group_id), []), key=lambda entry: entry.get("talent_level") or 0):
            talent_level = int(level_entry.get("talent_level") or 0)
            awakening_skills_index = max(0, talent_level - 2)
            awakening_skill = awakening_skills[awakening_skills_index] if awakening_skills_index < len(awakening_skills) else None
            awakening_levels.append(
                OrderedDict(
                    [
                        ("talent_level", talent_level),
                        ("awakening_level", talent_level),
                        ("skill", awakening_skill),
                        ("costs", level_entry.get("costs") or []),
                    ]
                )
            )

        items.append(
            OrderedDict(
                [
                    ("id", card_id),
                    ("card_id", int(card.get("card_id") or 0)),
                    ("base_character_id", int(card.get("char_id") or 0)),
                    ("talent_group_id", talent_group_id),
                    ("name", coalesce(card.get("name_en"), card.get("name_jp"))),
                    ("awakening_skill_count", len(awakening_skills)),
                    ("awakening_levels", awakening_levels),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "character_progression"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "character_progression")),
            ("items", items),
        ]
    )


def normalize_support_progression(
    config: dict[str, Any],
    metadata: dict[str, Any],
    support_card_level: Any,
    support_cards: Any,
) -> dict[str, Any]:
    cards_by_rarity: dict[int, int] = {}
    for card in as_array(support_cards):
        rarity = int(card.get("rarity") or 0)
        cards_by_rarity[rarity] = cards_by_rarity.get(rarity, 0) + 1

    curve_by_rarity: dict[int, list[dict[str, Any]]] = {}
    for row in as_array(support_card_level):
        rarity = int(row.get("rarity") or 0)
        level = int(row.get("level") or 0)
        if rarity <= 0 or level <= 0:
            continue
        curve_by_rarity.setdefault(rarity, []).append(
            OrderedDict(
                [
                    ("curve_id", int(row.get("id") or 0)),
                    ("level", level),
                    ("total_exp", int(row.get("total_exp") or 0)),
                ]
            )
        )

    items: list[dict[str, Any]] = []
    for rarity, levels in sorted(curve_by_rarity.items()):
        ordered_levels = sorted(levels, key=lambda entry: entry["level"])
        items.append(
            OrderedDict(
                [
                    ("id", f"rarity_{rarity}"),
                    ("rarity", rarity),
                    ("label", {1: "R", 2: "SR", 3: "SSR"}.get(rarity, f"R{rarity}")),
                    ("card_count", cards_by_rarity.get(rarity, 0)),
                    ("max_level", ordered_levels[-1]["level"] if ordered_levels else 0),
                    ("levels", ordered_levels),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "support_progression"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "support_progression")),
            ("items", items),
        ]
    )


def normalize_skills(
    config: dict[str, Any],
    metadata: dict[str, Any],
    skills: Any,
    skill_effect_values: Any,
    skill_condition_values: Any,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for skill in as_array(skills):
        loc_en = get_named_value(skill.get("loc"), "en") or {}
        gene_version = skill.get("gene_version")
        name = coalesce(skill.get("name_en"), skill.get("enname"), skill.get("jpname"))
        items.append(
            OrderedDict(
                [
                    ("id", str(skill["id"])),
                    ("skill_id", int(skill["id"])),
                    ("name", name),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", coalesce(skill.get("name_en"), skill.get("enname"))),
                                ("ja", skill.get("jpname")),
                                ("ko", skill.get("name_ko")),
                                ("zh_tw", skill.get("name_tw")),
                            ]
                        ),
                    ),
                    ("rarity", int(skill["rarity"])),
                    ("cost", coalesce(skill.get("cost"), get_named_value(gene_version, "cost"))),
                    ("icon_id", skill.get("iconid")),
                    (
                        "assets",
                        OrderedDict(
                            [
                                (
                                    "icon",
                                    new_asset_descriptor(
                                        config,
                                        "skill_icon",
                                        {"icon_id": int(skill["iconid"])},
                                        f"{name} icon",
                                    )
                                    if skill.get("iconid") is not None
                                    else None,
                                )
                            ]
                        ),
                    ),
                    ("activation", skill.get("activation")),
                    ("type_tags", as_array(skill.get("type"))),
                    ("localized_type_tags", as_array(get_named_value(loc_en, "type"))),
                    (
                        "descriptions",
                        OrderedDict(
                            [
                                ("en", coalesce(skill.get("desc_en"), skill.get("endesc"))),
                                ("ja", skill.get("jpdesc")),
                                ("ko", skill.get("desc_ko")),
                                ("zh_tw", skill.get("desc_tw")),
                            ]
                        ),
                    ),
                    ("related_character_ids", as_array(skill.get("char"))),
                    ("versions", as_array(skill.get("versions"))),
                    ("condition_groups", convert_condition_groups(skill.get("condition_groups"))),
                    (
                        "gene_version",
                        OrderedDict(
                            [
                                ("id", gene_version.get("id")),
                                ("name", coalesce(gene_version.get("name_en"), gene_version.get("jpname"))),
                                ("rarity", gene_version.get("rarity")),
                                ("cost", gene_version.get("cost")),
                                ("inherited", gene_version.get("inherited")),
                                ("parent_skill_ids", as_array(gene_version.get("parent_skills"))),
                                (
                                    "descriptions",
                                    OrderedDict(
                                        [
                                            ("en", gene_version.get("desc_en")),
                                            ("ja", gene_version.get("jpdesc")),
                                            ("ko", gene_version.get("desc_ko")),
                                            ("zh_tw", gene_version.get("desc_tw")),
                                        ]
                                    ),
                                ),
                                ("condition_groups", convert_condition_groups(gene_version.get("condition_groups"))),
                            ]
                        )
                        if gene_version is not None
                        else None,
                    ),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "skills"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "skills")),
            (
                "references",
                OrderedDict(
                    [
                        ("effect_values", skill_effect_values),
                        ("condition_values", skill_condition_values),
                    ]
                ),
            ),
            ("items", items),
        ]
    )


def normalize_races(config: dict[str, Any], metadata: dict[str, Any], races: Any) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for race in as_array(races):
        track_id = str(race["track"])
        factor_summary: list[str] = []
        factor = race.get("factor")
        if factor is not None:
            if factor.get("effect_1"):
                factor_summary.append(factor["effect_1"])
            if factor.get("effect_2"):
                factor_summary.append(factor["effect_2"])

        name = coalesce(race.get("name_en"), race.get("name_jp"))
        items.append(
            OrderedDict(
                [
                    ("id", str(race["id"])),
                    ("race_instance_id", int(race["id"])),
                    ("race_id", int(race["race_id"])),
                    ("url_name", race.get("url_name")),
                    ("name", name),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", race.get("name_en")),
                                ("ja", race.get("name_jp")),
                                ("ko", race.get("name_ko")),
                                ("zh_tw", race.get("name_tw")),
                            ]
                        ),
                    ),
                    ("track_id", track_id),
                    ("track_name", get_track_name(track_id)),
                    ("track_slug", get_track_slug(track_id)),
                    ("course_id", int(race["course_id"])),
                    ("banner_id", int(race["banner_id"])),
                    (
                        "assets",
                        OrderedDict(
                            [
                                (
                                    "banner",
                                    new_asset_descriptor(
                                        config,
                                        "race_banner",
                                        {"banner_id": int(race["banner_id"])},
                                        f"{name} banner",
                                    )
                                    if race.get("banner_id") is not None
                                    else None,
                                )
                            ]
                        ),
                    ),
                    ("surface", get_terrain_label(race["terrain"])),
                    ("surface_slug", get_terrain_slug(race["terrain"])),
                    ("distance_m", int(race["distance"])),
                    ("distance_category", get_distance_category_label(race["distance"])),
                    ("distance_category_slug", get_distance_category_slug(race["distance"])),
                    ("direction", get_direction_label(race["direction"])),
                    ("direction_slug", get_direction_slug(race["direction"])),
                    ("season", get_season_label(race["season"])),
                    ("season_slug", get_season_slug(race["season"])),
                    ("time_of_day", get_time_of_day_label(race["time"])),
                    ("time_of_day_slug", get_time_of_day_slug(race["time"])),
                    ("entries", int(race["entries"])),
                    ("grade_code", int(race["grade"])),
                    ("group_code", int(race["group"])),
                    ("grade", get_race_grade_label(race["group"], race["grade"])),
                    ("course_code", race.get("course")),
                    ("career_years", as_array(race.get("list_ura"))),
                    ("factor_summary", factor_summary),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "races"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "races")),
            ("items", items),
        ]
    )


def normalize_racetracks(config: dict[str, Any], metadata: dict[str, Any], racetracks: Any) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for track in as_array(racetracks):
        track_id = str(track["id"])
        for course in as_array(track.get("courses")):
            uphill_count = 0
            downhill_count = 0
            for slope in as_array(course.get("slopes")):
                slope_value = int(slope["slope"])
                if slope_value > 0:
                    uphill_count += 1
                elif slope_value < 0:
                    downhill_count += 1

            items.append(
                OrderedDict(
                    [
                        ("id", str(course["id"])),
                        ("course_id", int(course["id"])),
                        ("track_id", track_id),
                        ("track_name", get_track_name(track_id)),
                        ("track_slug", get_track_slug(track_id)),
                        ("surface", get_terrain_label(course["terrain"])),
                        ("surface_slug", get_terrain_slug(course["terrain"])),
                        ("distance_category", get_distance_category_from_code(course["distance"])),
                        ("distance_category_slug", get_distance_category_slug_from_code(course["distance"])),
                        ("length_m", int(course["length"])),
                        ("turn", get_direction_label(course["turn"])),
                        ("turn_slug", get_direction_slug(course["turn"])),
                        ("layout", get_course_layout_label(course["inout"])),
                        ("layout_slug", get_course_layout_slug(course["inout"])),
                        ("corner_count", len(as_array(course.get("corners")))),
                        ("straight_count", len(as_array(course.get("straights")))),
                        ("uphill_count", uphill_count),
                        ("downhill_count", downhill_count),
                        ("has_slopes", len(as_array(course.get("slopes"))) > 0),
                        ("position_keep_end", course.get("positionKeepEnd")),
                        ("stat_thresholds", as_array(course.get("statThresholds"))),
                        ("phases", as_array(course.get("phases"))),
                        ("corners", as_array(course.get("corners"))),
                        ("straights", as_array(course.get("straights"))),
                        ("laps", as_array(course.get("laps"))),
                        ("slopes", as_array(course.get("slopes"))),
                        ("overlaps", as_array(course.get("overlaps"))),
                        ("no_mans_land", as_array(course.get("noMansLand"))),
                        ("terrain_changes", as_array(course.get("terrainChanges"))),
                        ("spurt_start", course.get("spurtStart")),
                    ]
                )
            )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "racetracks"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "racetracks")),
            ("items", items),
        ]
    )


def _sorted_unique(values: list[Any], *, key=str) -> list[Any]:
    unique = []
    seen = set()
    for value in values:
        marker = json.dumps(value, sort_keys=True, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
        if marker in seen:
            continue
        seen.add(marker)
        unique.append(value)
    return sorted(unique, key=key)


def normalize_g1_factors(
    config: dict[str, Any],
    metadata: dict[str, Any],
    factors: Any,
    races: Any,
    skills: Any,
) -> dict[str, Any]:
    skill_lookup = build_lookup(skills, "id")
    races_by_base_id = build_group_lookup(races, "race_id")
    items: list[dict[str, Any]] = []

    for factor in as_array(get_named_value(factors, "race")):
        related_races = as_array(get_named_value(races_by_base_id, str(factor["race_id"])))
        summary: list[str] = []
        career_years: list[Any] = []
        track_names: list[str] = []
        surfaces: list[str] = []
        distance_categories: list[str] = []
        race_details: list[dict[str, Any]] = []

        for race in related_races:
            career_years.extend(as_array(race.get("list_ura")))
            track_names.append(get_track_name(str(race["track"])))
            surfaces.append(get_terrain_slug(race["terrain"]))
            distance_categories.append(get_distance_category_slug(race["distance"]))

            race_details.append(
                OrderedDict(
                    [
                        ("race_instance_id", int(race["id"])),
                        ("name", coalesce(race.get("name_en"), race.get("name_jp"))),
                        ("track_name", get_track_name(str(race["track"]))),
                        ("surface", get_terrain_label(race["terrain"])),
                        ("distance_m", int(race["distance"])),
                        ("distance_category", get_distance_category_label(race["distance"])),
                        ("direction", get_direction_label(race["direction"])),
                        ("season", get_season_label(race["season"])),
                        ("time_of_day", get_time_of_day_label(race["time"])),
                        ("grade", get_race_grade_label(race["group"], race["grade"])),
                        ("url_name", race.get("url_name")),
                    ]
                )
            )

            race_factor = race.get("factor")
            if race_factor is not None:
                if race_factor.get("effect_2"):
                    summary.append(race_factor["effect_2"])
                if race_factor.get("effect_1"):
                    summary.append(race_factor["effect_1"])

        effect_details: list[dict[str, Any]] = []
        for effect in as_array(factor.get("effects")):
            detail: dict[str, Any] = OrderedDict(
                [
                    ("type", int(effect["type"])),
                    ("value_1", as_array(effect.get("value_1"))),
                    ("value_2", as_array(effect.get("value_2"))),
                ]
            )
            if int(effect["type"]) == 41 and len(as_array(effect.get("value_1"))) > 0:
                detail["skill"] = convert_skill_ref(as_array(effect.get("value_1"))[0], skill_lookup)
            effect_details.append(detail)

        items.append(
            OrderedDict(
                [
                    ("id", str(factor["id"])),
                    ("factor_id", str(factor["id"])),
                    ("race_id", str(factor["race_id"])),
                    ("name", coalesce(factor.get("name_en"), factor.get("name_ja"))),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", coalesce(factor.get("name_en"), factor.get("name_en_gl"))),
                                ("ja", factor.get("name_ja")),
                                ("ko", factor.get("name_ko")),
                                ("zh_tw", factor.get("name_zh_tw")),
                            ]
                        ),
                    ),
                    ("effect_summary", _sorted_unique(summary, key=str)),
                    ("effect_details", effect_details),
                    ("related_races", race_details),
                    ("career_years", _sorted_unique(career_years, key=str)),
                    ("track_names", _sorted_unique(track_names, key=str)),
                    ("surfaces", _sorted_unique(surfaces, key=str)),
                    ("distance_categories", _sorted_unique(distance_categories, key=str)),
                    ("factor_type", int(factor["type"])),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "g1_factors"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "g1_factors")),
            ("items", items),
        ]
    )


def normalize_compatibility(
    config: dict[str, Any],
    metadata: dict[str, Any],
    relations: Any,
    relation_members: Any,
    base_characters: Any,
    character_cards: Any,
) -> dict[str, Any]:
    base_lookup = build_lookup(base_characters, "char_id")
    variants_by_char = build_group_lookup(character_cards, "char_id")
    members_by_type: dict[str, list[int]] = {}
    for member in as_array(relation_members):
        relation_type = str(member["relation_type"])
        members_by_type.setdefault(relation_type, []).append(int(member["chara_id"]))

    for relation_type, members in list(members_by_type.items()):
        members_by_type[relation_type] = sorted(set(members))

    char_groups: dict[str, list[dict[str, Any]]] = {}
    pair_map: dict[str, dict[str, Any]] = {}

    for relation in as_array(relations):
        relation_type = str(relation["relation_type"])
        point = int(relation["relation_point"])
        members = members_by_type.get(relation_type, [])

        for char_id in members:
            key = str(char_id)
            char_groups.setdefault(key, []).append(
                OrderedDict(
                    [
                        ("relation_type", relation_type),
                        ("relation_point", point),
                        ("member_count", len(members)),
                        ("other_character_ids", [member for member in members if member != char_id]),
                    ]
                )
            )

        for left_index in range(len(members)):
            for right_index in range(left_index + 1, len(members)):
                left = str(members[left_index])
                right = str(members[right_index])
                if int(left) > int(right):
                    left, right = right, left

                pair_key = f"{left}|{right}"
                pair = pair_map.setdefault(
                    pair_key,
                    OrderedDict(
                        [
                            ("left_character_id", left),
                            ("right_character_id", right),
                            ("base_points", 0),
                            ("relation_types", []),
                        ]
                    ),
                )
                pair["base_points"] += point
                pair["relation_types"].append(relation_type)

    pairs_by_char: dict[str, list[dict[str, Any]]] = {}
    for pair in pair_map.values():
        relation_types = _sorted_unique(pair["relation_types"], key=str)
        for char_id in (pair["left_character_id"], pair["right_character_id"]):
            pairs_by_char.setdefault(char_id, [])

        left_base = get_named_value(base_lookup, pair["left_character_id"])
        right_base = get_named_value(base_lookup, pair["right_character_id"])

        pairs_by_char[pair["left_character_id"]].append(
            OrderedDict(
                [
                    ("character_id", int(pair["right_character_id"])),
                    ("name", coalesce(get_named_value(right_base, "en_name"), get_named_value(right_base, "jp_name")) if right_base else None),
                    ("base_points", pair["base_points"]),
                    ("shared_relation_count", len(relation_types)),
                    ("shared_relation_types", relation_types),
                    ("available_en", bool(get_named_value(right_base, "playable_en")) if right_base else False),
                ]
            )
        )
        pairs_by_char[pair["right_character_id"]].append(
            OrderedDict(
                [
                    ("character_id", int(pair["left_character_id"])),
                    ("name", coalesce(get_named_value(left_base, "en_name"), get_named_value(left_base, "jp_name")) if left_base else None),
                    ("base_points", pair["base_points"]),
                    ("shared_relation_count", len(relation_types)),
                    ("shared_relation_types", relation_types),
                    ("available_en", bool(get_named_value(left_base, "playable_en")) if left_base else False),
                ]
            )
        )

    all_character_ids = sorted(set(char_groups.keys()) | set(pairs_by_char.keys()), key=lambda value: int(value))
    items: list[dict[str, Any]] = []
    max_base_points = 0

    for char_id in all_character_ids:
        base = get_named_value(base_lookup, char_id)
        variants = as_array(get_named_value(variants_by_char, char_id))
        matches = sorted(
            as_array(get_named_value(pairs_by_char, char_id)),
            key=lambda entry: (-entry["base_points"], entry.get("name") or ""),
        )
        top = matches[:25]
        if top and top[0]["base_points"] > max_base_points:
            max_base_points = top[0]["base_points"]

        variant_refs: list[dict[str, Any]] = []
        for variant in variants:
            variant_refs.append(
                OrderedDict(
                    [
                        ("card_id", int(variant["card_id"])),
                        ("name", coalesce(variant.get("name_en"), variant.get("name_jp"))),
                        ("variant", variant.get("title_en_gl")),
                    ]
                )
            )

        relation_groups = sorted(
            as_array(get_named_value(char_groups, char_id)),
            key=lambda group: (-group["relation_point"], -group["member_count"], group["relation_type"]),
        )

        items.append(
            OrderedDict(
                [
                    ("id", str(char_id)),
                    ("character_id", int(char_id)),
                    ("name", coalesce(get_named_value(base, "en_name"), get_named_value(base, "jp_name")) if base else None),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", get_named_value(base, "en_name") if base else None),
                                ("ja", get_named_value(base, "jp_name") if base else None),
                                ("ko", get_named_value(base, "name_ko") if base else None),
                                ("zh_tw", get_named_value(base, "name_tw") if base else None),
                            ]
                        )
                        if base
                        else None,
                    ),
                    (
                        "available",
                        OrderedDict(
                            [
                                ("jp", bool(get_named_value(base, "playable"))),
                                ("en", bool(get_named_value(base, "playable_en"))),
                                ("ko", bool(get_named_value(base, "playable_ko"))),
                                ("zh_tw", bool(get_named_value(base, "playable_zh_tw"))),
                            ]
                        )
                        if base
                        else None,
                    ),
                    ("variants", variant_refs),
                    ("variant_count", len(variant_refs)),
                    ("top_matches", top),
                    ("relation_groups", relation_groups),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "compatibility"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "compatibility")),
            (
                "model",
                OrderedDict(
                    [
                        ("pairwise_points_source", "sum of shared succession_relation groups by base character id"),
                        ("g1_bonus_included", False),
                        ("g1_bonus_reference", "g1_factors"),
                        ("version_rule", "character versions do not change compatibility; base character ids are used"),
                        ("max_pairwise_points", max_base_points),
                    ]
                ),
            ),
            ("items", items),
        ]
    )


def normalize_cm_targets(
    config: dict[str, Any],
    metadata: dict[str, Any],
    cm_events: Any,
    races: Any,
    racetracks: Any,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for event in as_array(cm_events):
        race = event.get("race") or {}
        track_id = str(race.get("track") or "")
        surface = get_terrain_label(race.get("ground", 99999))
        distance_m = int(race.get("distance") or 0)
        distance_category = get_distance_category_label(distance_m if distance_m else 99999)
        direction = get_direction_label(race.get("turn", 99999))
        season = get_season_label(race.get("season", 99999))
        weather = get_weather_label(race.get("weather", 99999))
        condition = get_track_condition_label(race.get("condition", 99999))

        related_races: list[dict[str, Any]] = []
        for candidate in as_array(races):
            if str(candidate.get("track")) != track_id:
                continue
            if int(candidate.get("terrain", -1)) != int(race.get("ground", -1)):
                continue
            if int(candidate.get("distance", -1)) != distance_m:
                continue
            if int(candidate.get("direction", -1)) != int(race.get("turn", -1)):
                continue
            if int(candidate.get("season", -1)) != int(race.get("season", -1)):
                continue
            related_races.append(
                OrderedDict(
                    [
                        ("entityKey", "races"),
                        ("id", str(candidate["id"])),
                        ("title", coalesce(candidate.get("name_en"), candidate.get("name_jp"), candidate["id"])),
                        ("subtitle", f"{get_track_name(track_id)} | {get_race_grade_label(candidate['group'], candidate['grade'])} | {candidate['distance']}m"),
                    ]
                )
            )

        related_racetracks: list[dict[str, Any]] = []
        for track in as_array(racetracks):
            if str(track.get("id")) != track_id:
                continue
            for course in as_array(track.get("courses")):
                if int(course.get("terrain", -1)) != int(race.get("ground", -1)):
                    continue
                if get_distance_category_from_code(course.get("distance", 99999)) != distance_category:
                    continue
                if get_direction_label(course.get("turn", 99999)) != direction:
                    continue
                related_racetracks.append(
                    OrderedDict(
                        [
                            ("entityKey", "racetracks"),
                            ("id", str(course["id"])),
                            ("title", f"{get_track_name(track_id)} #{course['id']}"),
                            ("subtitle", f"{surface} | {get_distance_category_from_code(course['distance'])} | {course['length']}m"),
                        ]
                    )
                )

        name = coalesce(event.get("name_en"), event.get("name"), f"CM {event['id']}")
        items.append(
            OrderedDict(
                [
                    ("id", f"cm_{int(event['id']):03d}"),
                    ("cm_id", int(event["id"])),
                    ("resource_id", int(event["resource_id"])) if event.get("resource_id") is not None else ("resource_id", None),
                    ("slug", slugify_text(coalesce(event.get("name_en"), event.get("name"), event["id"])) or f"cm-{event['id']}"),
                    ("name", name),
                    (
                        "names",
                        OrderedDict(
                            [
                                ("en", event.get("name_en")),
                                ("ja", event.get("name")),
                            ]
                        ),
                    ),
                    ("start_at", unix_timestamp_to_iso(event.get("start"))),
                    ("end_at", unix_timestamp_to_iso(event.get("end"))),
                    ("start_ts", int(event["start"])) if event.get("start") is not None else ("start_ts", None),
                    ("end_ts", int(event["end"])) if event.get("end") is not None else ("end_ts", None),
                    (
                        "race_profile",
                        OrderedDict(
                            [
                                ("track_id", track_id),
                                ("track_name", get_track_name(track_id)),
                                ("track_slug", get_track_slug(track_id)),
                                ("surface", surface),
                                ("surface_slug", get_terrain_slug(race.get("ground", 99999))),
                                ("distance_m", distance_m),
                                ("distance_category", distance_category),
                                ("distance_category_slug", get_distance_category_slug(distance_m if distance_m else 99999)),
                                ("direction", direction),
                                ("direction_slug", get_direction_slug(race.get("turn", 99999))),
                                ("season", season),
                                ("season_slug", get_season_slug(race.get("season", 99999))),
                                ("weather", weather),
                                ("weather_slug", get_weather_slug(race.get("weather", 99999))),
                                ("condition", condition),
                                ("condition_slug", get_track_condition_slug(race.get("condition", 99999))),
                            ]
                        ),
                    ),
                    ("related_races", related_races),
                    ("related_racetracks", related_racetracks),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "cm_targets"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "cm_targets")),
            ("items", items),
        ]
    )


def normalize_scenarios(
    config: dict[str, Any],
    metadata: dict[str, Any],
    scenarios: Any,
    static_scenarios: Any,
    scenario_factors: Any,
) -> dict[str, Any]:
    scenario_lookup = build_lookup(scenarios, "id")
    static_lookup = build_lookup(static_scenarios, "id")
    factor_lookup = build_lookup(scenario_factors, "id")
    all_ids = sorted(set(scenario_lookup.keys()) | set(static_lookup.keys()) | set(factor_lookup.keys()), key=lambda value: int(value))
    items: list[dict[str, Any]] = []

    stat_keys = ["speed", "stamina", "power", "guts", "wit"]
    for scenario_id in all_ids:
        dynamic = get_named_value(scenario_lookup, scenario_id) or {}
        static = get_named_value(static_lookup, scenario_id) or {}
        factor_source = get_named_value(factor_lookup, scenario_id) or {}
        factors = as_array(static.get("factors")) or as_array(factor_source.get("factors"))
        first_factor = factors[0] if factors else None
        scenario_key = coalesce(static.get("str"), factor_source.get("str"), f"scenario_{scenario_id}")
        factor_rows: list[dict[str, Any]] = []
        factor_effects: list[str] = []
        for factor in factors:
            effect_labels = [convert_display_label(effect, None) for effect in [factor.get("effect_1"), factor.get("effect_2")] if effect]
            factor_effects.extend(effect_labels)
            factor_rows.append(
                OrderedDict(
                    [
                        ("id", int(factor["id"])) if factor.get("id") is not None else ("id", None),
                        ("name", coalesce(factor.get("name_en"), factor.get("name_ja"), factor.get("id"))),
                        (
                            "names",
                            OrderedDict(
                                [
                                    ("en", factor.get("name_en")),
                                    ("ja", factor.get("name_ja")),
                                    ("ko", factor.get("name_ko")),
                                    ("zh_tw", factor.get("name_zh_tw")),
                                ]
                            ),
                        ),
                        ("effects", effect_labels),
                    ]
                )
            )

        stats_values = as_array(dynamic.get("stats"))
        stat_caps = OrderedDict((stat_key, int(stats_values[index])) for index, stat_key in enumerate(stat_keys) if index < len(stats_values))
        name = get_scenario_display_name(scenario_key, coalesce(get_named_value(first_factor, "name_en"), get_named_value(first_factor, "name_ja")))
        items.append(
            OrderedDict(
                [
                    ("id", str(scenario_id)),
                    ("scenario_id", int(scenario_id)),
                    ("key", scenario_key),
                    ("slug", slugify_text(scenario_key)),
                    ("name", name),
                    ("order", int(dynamic["order"])) if dynamic.get("order") is not None else ("order", None),
                    ("program", int(dynamic["program"])) if dynamic.get("program") is not None else ("program", None),
                    ("program_label", f"Program {dynamic['program']}") if dynamic.get("program") is not None else ("program_label", None),
                    ("stat_caps", stat_caps),
                    ("factor_effects", _sorted_unique([label for label in factor_effects if label], key=str)),
                    ("factors", factor_rows),
                ]
            )
        )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "scenarios"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "scenarios")),
            ("items", items),
        ]
    )


def normalize_training_events(
    config: dict[str, Any],
    metadata: dict[str, Any],
    datasets: dict[str, Any],
    character_cards: Any,
    support_cards: Any,
    static_scenarios: Any,
) -> dict[str, Any]:
    names_by_owner = build_training_event_name_lookup(datasets.get("te_pairs_en"))
    character_card_lookup = build_lookup(character_cards, "card_id")
    character_cards_by_base = build_group_lookup(character_cards, "char_id")
    support_lookup = build_lookup(support_cards, "support_id")
    scenario_lookup = build_lookup(static_scenarios, "id")

    items: list[dict[str, Any]] = []
    source_order = ["shared", "char", "char_card", "friend", "group", "scenario", "sr", "ssr"]
    for source_key in source_order:
        dataset = datasets.get(source_key)
        if dataset is None:
            continue

        for row in as_array(dataset):
            if not isinstance(row, list) or len(row) < 2:
                continue

            owner_id = str(row[0])
            segments = row[1:]
            metadata_segments = [segment for segment in segments if not is_training_event_group(segment)]
            event_groups = [segment for segment in segments if is_training_event_group(segment)]
            known_names = names_by_owner.get(owner_id, [])
            flat_index = 0

            linked_entities: list[dict[str, Any]] = []
            linked_character_ids: list[str] = []
            linked_support_id: str | None = None
            linked_scenario_id: str | None = None
            group_member_character_refs: list[dict[str, Any]] = []

            if source_key in {"shared", "char"}:
                for card in as_array(get_named_value(character_cards_by_base, owner_id)):
                    ref = build_character_card_reference_from_raw(card)
                    if ref is not None:
                        linked_entities.append(ref)
                        linked_character_ids.append(ref["id"])
            elif source_key == "char_card":
                card = get_named_value(character_card_lookup, owner_id)
                ref = build_character_card_reference_from_raw(card)
                if ref is not None:
                    linked_entities.append(ref)
                    linked_character_ids.append(ref["id"])
            elif source_key in {"friend", "group", "sr", "ssr"}:
                support = get_named_value(support_lookup, owner_id)
                ref = build_support_reference_from_raw(support)
                if ref is not None:
                    linked_entities.append(ref)
                    linked_support_id = ref["id"]
                if source_key == "group" and len(row) > 1 and isinstance(row[1], list):
                    for member_base_id in as_array(row[1]):
                        for card in as_array(get_named_value(character_cards_by_base, str(member_base_id))):
                            member_ref = build_character_card_reference_from_raw(card)
                            if member_ref is not None and member_ref["id"] not in linked_character_ids:
                                linked_character_ids.append(member_ref["id"])
                                group_member_character_refs.append(member_ref)
            elif source_key == "scenario":
                scenario_entry = get_named_value(scenario_lookup, owner_id)
                ref = build_scenario_reference_from_raw(owner_id, scenario_entry)
                if ref is not None:
                    linked_entities.append(ref)
                    linked_scenario_id = ref["id"]

            linked_entities.extend(group_member_character_refs)

            for group_index, group in enumerate(event_groups, start=1):
                for sequence_index, event in enumerate(group, start=1):
                    flat_index += 1
                    event_id = str(event[2])
                    choices = normalize_training_event_choices(event[1] if len(event) > 1 else [])
                    event_name = known_names[flat_index - 1] if flat_index - 1 < len(known_names) else None
                    if not event_name:
                        event_name = f"Event {event_id}"

                    subtitle_parts = [get_training_event_source_label(source_key), f"Owner {owner_id}"]
                    if linked_support_id:
                        subtitle_parts.append(f"Support {linked_support_id}")
                    elif linked_scenario_id:
                        subtitle_parts.append(f"Scenario {linked_scenario_id}")
                    elif linked_character_ids:
                        subtitle_parts.append(f"{len(linked_character_ids)} linked character(s)")

                    items.append(
                        OrderedDict(
                            [
                                ("id", f"{source_key}:{owner_id}:{event_id}:{group_index}:{sequence_index}"),
                                ("event_source", source_key),
                                ("source_label", get_training_event_source_label(source_key)),
                                ("owner_id", owner_id),
                                ("event_id", event_id),
                                ("group_index", group_index),
                                ("sequence_index", sequence_index),
                                ("name", event_name),
                                ("name_source", "te_pairs_en" if flat_index - 1 < len(known_names) else "fallback_event_id"),
                                ("title", event_name),
                                ("subtitle", " | ".join(subtitle_parts)),
                                ("linked_character_ids", linked_character_ids),
                                ("linked_support_id", linked_support_id),
                                ("linked_scenario_id", linked_scenario_id),
                                ("linked_entities", linked_entities),
                                ("group_member_character_refs", group_member_character_refs),
                                ("choice_count", len(choices)),
                                ("has_branching", len(choices) > 1),
                                ("choices", choices),
                                ("raw_choice_token", event[0] if len(event) > 0 else None),
                                ("raw_extras", event[3:] if len(event) > 3 else []),
                                ("source_metadata", metadata_segments),
                                ("raw_payload", event),
                            ]
                        )
                    )

    return OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("entity", "training_events"),
            ("generated_at", get_now_iso()),
            ("source", new_source_stamp(config, metadata, "training_events")),
            ("items", items),
        ]
    )


def build_normalized_reference(config: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    raw = OrderedDict(
        [
            ("characters", load_raw_dataset_by_key(metadata, "characters")),
            ("character_cards", load_raw_dataset_by_key(metadata, "character-cards")),
            ("support_cards", load_raw_dataset_by_key(metadata, "support-cards")),
            ("support_effects", load_raw_dataset_by_key(metadata, "support_effects")),
            ("skills", load_raw_dataset_by_key(metadata, "skills")),
            ("skill_effect_values", load_raw_dataset_by_key(metadata, "static/skill_effect_values")),
            ("skill_condition_values", load_raw_dataset_by_key(metadata, "static/skill_condition_values")),
            ("races", load_raw_dataset_by_key(metadata, "races")),
            ("racetracks", load_raw_dataset_by_key(metadata, "racetracks")),
            ("factors", load_raw_dataset_by_key(metadata, "factors")),
            ("cm_targets", load_raw_dataset_by_key(metadata, "events/champions-meeting")),
            ("scenarios", load_raw_dataset_by_key(metadata, "scenarios")),
            ("static_scenarios", load_raw_dataset_by_key(metadata, "static/scenarios")),
            ("scenario_factors", load_raw_dataset_by_key(metadata, "static/scenario_factors")),
            ("training_events_shared", load_raw_dataset_by_key(metadata, "training_events/shared")),
            ("training_events_char", load_raw_dataset_by_key(metadata, "training_events/char")),
            ("training_events_char_card", load_raw_dataset_by_key(metadata, "training_events/char_card")),
            ("training_events_friend", load_raw_dataset_by_key(metadata, "training_events/friend")),
            ("training_events_group", load_raw_dataset_by_key(metadata, "training_events/group")),
            ("training_events_scenario", load_raw_dataset_by_key(metadata, "training_events/scenario")),
            ("training_events_sr", load_raw_dataset_by_key(metadata, "training_events/sr")),
            ("training_events_ssr", load_raw_dataset_by_key(metadata, "training_events/ssr")),
            ("training_event_names", load_raw_dataset_by_key(metadata, "dict/te_pairs_en")),
            ("succession_relation", load_raw_dataset_by_key(metadata, "db-files/succession_relation")),
            ("succession_relation_member", load_raw_dataset_by_key(metadata, "db-files/succession_relation_member")),
            ("support_card_level", load_raw_dataset_by_key(metadata, "db-files/support_card_level")),
            ("card_talent_upgrade", load_raw_dataset_by_key(metadata, "db-files/card_talent_upgrade")),
        ]
    )

    return OrderedDict(
        [
            ("characters", normalize_characters(config, metadata, raw["characters"], raw["character_cards"], raw["skills"])),
            (
                "character_progression",
                normalize_character_progression(
                    config,
                    metadata,
                    raw["character_cards"],
                    raw["card_talent_upgrade"],
                    raw["skills"],
                ),
            ),
            ("supports", normalize_supports(config, metadata, raw["support_cards"], raw["support_effects"], raw["skills"])),
            (
                "support_progression",
                normalize_support_progression(
                    config,
                    metadata,
                    raw["support_card_level"],
                    raw["support_cards"],
                ),
            ),
            ("skills", normalize_skills(config, metadata, raw["skills"], raw["skill_effect_values"], raw["skill_condition_values"])),
            ("races", normalize_races(config, metadata, raw["races"])),
            ("racetracks", normalize_racetracks(config, metadata, raw["racetracks"])),
            ("g1_factors", normalize_g1_factors(config, metadata, raw["factors"], raw["races"], raw["skills"])),
            ("cm_targets", normalize_cm_targets(config, metadata, raw["cm_targets"], raw["races"], raw["racetracks"])),
            ("scenarios", normalize_scenarios(config, metadata, raw["scenarios"], raw["static_scenarios"], raw["scenario_factors"])),
            (
                "training_events",
                normalize_training_events(
                    config,
                    metadata,
                    OrderedDict(
                        [
                            ("shared", raw["training_events_shared"]),
                            ("char", raw["training_events_char"]),
                            ("char_card", raw["training_events_char_card"]),
                            ("friend", raw["training_events_friend"]),
                            ("group", raw["training_events_group"]),
                            ("scenario", raw["training_events_scenario"]),
                            ("sr", raw["training_events_sr"]),
                            ("ssr", raw["training_events_ssr"]),
                            ("te_pairs_en", raw["training_event_names"]),
                        ]
                    ),
                    raw["character_cards"],
                    raw["support_cards"],
                    raw["static_scenarios"],
                ),
            ),
            (
                "compatibility",
                normalize_compatibility(
                    config,
                    metadata,
                    raw["succession_relation"],
                    raw["succession_relation_member"],
                    raw["characters"],
                    raw["character_cards"],
                ),
            ),
        ]
    )


def save_normalized_reference(normalized: dict[str, Any]) -> None:
    normalized_root = PROJECT_ROOT / "data" / "normalized"
    ensure_directory(normalized_root)
    reference_meta: dict[str, Any] = OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("generated_at", get_now_iso()),
            ("entities", OrderedDict()),
        ]
    )

    for entity_name, dataset in normalized.items():
        write_json_file(normalized_root / f"{entity_name}.json", dataset)
        reference_meta["entities"][entity_name] = OrderedDict(
            [
                ("count", len(as_array(dataset.get("items")))),
                ("source", dataset.get("source")),
            ]
        )

    write_json_file(normalized_root / "reference-meta.json", reference_meta)


def get_asset_map_entries(asset_map: Any) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    if asset_map is None:
        return entries
    if isinstance(asset_map, dict):
        return [OrderedDict([("key", key), ("value", value)]) for key, value in asset_map.items()]
    for key, value in getattr(asset_map, "items", lambda: [])():
        entries.append(OrderedDict([("key", key), ("value", value)]))
    return entries


def get_normalized_asset_catalog(normalized: dict[str, Any]) -> dict[str, Any]:
    catalog: dict[str, Any] = {}
    for entity_name, dataset in normalized.items():
        for item in as_array(dataset.get("items")):
            for asset_entry in get_asset_map_entries(get_named_value(item, "assets")):
                asset = asset_entry["value"]
                if asset is None:
                    continue
                relative_path = str(get_named_value(asset, "relative_path") or "").replace("\\", "/")
                source_url = str(get_named_value(asset, "source_url") or "")
                if not relative_path or not source_url:
                    continue
                asset_key = relative_path
                if asset_key not in catalog:
                    catalog[asset_key] = OrderedDict(
                        [
                            ("key", asset_key),
                            ("role", get_named_value(asset, "role")),
                            ("type", get_named_value(asset, "type")),
                            ("relative_path", asset_key),
                            ("source_url", source_url),
                            ("content_type", get_named_value(asset, "content_type")),
                            ("alt", get_named_value(asset, "alt")),
                            ("owners", []),
                        ]
                    )
                catalog[asset_key]["owners"].append(
                    OrderedDict(
                        [
                            ("entity", entity_name),
                            ("item_id", str(item["id"])),
                            ("slot", asset_entry["key"]),
                        ]
                    )
                )
    return catalog


def sync_reference_assets(
    config: dict[str, Any],
    normalized: dict[str, Any],
    *,
    force: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    raw_asset_root = PROJECT_ROOT / "data" / "raw" / "assets" / "umamusume"
    ensure_directory(raw_asset_root)

    existing_metadata = get_existing_asset_metadata()
    catalog = get_normalized_asset_catalog(normalized)
    asset_entries: dict[str, Any] = OrderedDict()
    downloaded_count = 0
    reused_count = 0
    stale_count = 0
    failed_count = 0

    asset_keys = sorted(catalog.keys())
    total_assets = max(1, len(asset_keys))
    for index, asset_key in enumerate(asset_keys, start=1):
        asset = catalog[asset_key]
        if progress_callback and (index == 1 or index % 25 == 0 or index == total_assets):
            progress = 28 + round(index / total_assets * 44)
            progress_callback(
                {
                    "progress": progress,
                    "message": f"Syncing visual assets {index}/{total_assets}",
                    "current_task": f"Processing asset {asset_key}",
                }
            )
        relative_path = Path(asset["relative_path"].replace("/", str(Path("/"))).lstrip("/"))
        local_path = raw_asset_root / relative_path
        previous = get_named_value(existing_metadata.get("assets"), asset_key)
        checked_at = get_now_iso()
        downloaded_at = previous.get("downloaded_at") if previous else None
        status = "reused"
        error_message = None
        size_bytes = None

        should_download = force or not local_path.exists()
        if should_download:
            try:
                print(f"Syncing asset {asset_key}...")
                payload = invoke_remote_binary(asset["source_url"])
                write_binary_file(local_path, payload)
                downloaded_at = get_now_iso()
                status = "downloaded"
                size_bytes = len(payload)
                downloaded_count += 1
            except Exception as exc:  # noqa: BLE001
                error_message = str(exc)
                if local_path.exists():
                    status = "stale"
                    size_bytes = local_path.stat().st_size
                    stale_count += 1
                else:
                    status = "failed"
                    failed_count += 1
        else:
            reused_count += 1
            size_bytes = local_path.stat().st_size

        asset_entries[asset_key] = OrderedDict(
            [
                ("key", asset_key),
                ("role", asset.get("role")),
                ("type", asset.get("type")),
                ("relative_path", asset.get("relative_path")),
                ("source_url", asset.get("source_url")),
                ("local_path", str(local_path)),
                ("content_type", asset.get("content_type")),
                ("alt", asset.get("alt")),
                ("owners", asset.get("owners")),
                ("downloaded_at", downloaded_at),
                ("checked_at", checked_at),
                ("status", status),
                ("size_bytes", size_bytes),
                ("error", error_message),
            ]
        )

    metadata = OrderedDict(
        [
            ("schema_version", SCHEMA_VERSION),
            ("generated_at", get_now_iso()),
            ("asset_base_url", config["assetBaseUrl"]),
            ("asset_serve_base_path", config["assetServeBasePath"]),
            (
                "counts",
                OrderedDict(
                    [
                        ("total", len(asset_entries)),
                        ("downloaded", downloaded_count),
                        ("reused", reused_count),
                        ("stale", stale_count),
                        ("failed", failed_count),
                    ]
                ),
            ),
            ("assets", asset_entries),
        ]
    )
    write_json_file(get_asset_metadata_path(), metadata)
    return OrderedDict([("metadata", metadata), ("assetRoot", str(raw_asset_root))])


def convert_app_asset_map(config: dict[str, Any], asset_map: Any) -> dict[str, Any]:
    result: dict[str, Any] = OrderedDict()
    for entry in get_asset_map_entries(asset_map):
        asset = entry["value"]
        if asset is None:
            continue
        relative_path = str(get_named_value(asset, "relative_path") or "")
        if not relative_path:
            continue
        result[entry["key"]] = OrderedDict(
            [
                ("role", get_named_value(asset, "role")),
                ("type", get_named_value(asset, "type")),
                ("alt", get_named_value(asset, "alt")),
                ("src", join_url_path(config["assetServeBasePath"], relative_path.replace("\\", "/"))),
                ("source_url", get_named_value(asset, "source_url")),
            ]
        )
    return result


def join_search_text(values: list[Any]) -> str:
    parts: list[str] = []
    for value in values:
        for entry in as_array(value):
            if isinstance(entry, str):
                if entry.strip():
                    parts.append(entry.strip())
            elif entry is not None:
                parts.append(str(entry))
    unique_parts = list(OrderedDict.fromkeys(part for part in parts if part.strip()))
    return " ".join(unique_parts)


def convert_display_label(value: str | None, mapping: dict[str, str] | None) -> str | None:
    if not value or not value.strip():
        return value
    if mapping and value in mapping:
        return mapping[value]
    normalized = value.replace("_", " ").replace("-", " ").strip()
    if not normalized:
        return value
    return normalized.title()


def convert_display_label_list(values: Any, mapping: dict[str, str] | None) -> list[str]:
    labels: list[str] = []
    for value in as_array(values):
        label = convert_display_label(str(value), mapping)
        if label and label not in labels:
            labels.append(label)
    return labels


def new_filter_definition(key: str, label: str, option_labels: dict[str, str] | None = None) -> dict[str, Any]:
    return OrderedDict([("key", key), ("label", label), ("optionLabels", option_labels or {})])


def get_filter_options(items: Any, definitions: Any) -> dict[str, Any]:
    options: dict[str, Any] = OrderedDict()
    for definition in as_array(definitions):
        counts: dict[str, int] = {}
        for item in as_array(items):
            values = as_array(get_named_value(item.get("filters"), definition["key"]))
            for value in values:
                key = str(value or "")
                if not key.strip():
                    continue
                counts[key] = counts.get(key, 0) + 1

        option_list: list[dict[str, Any]] = []
        for value in sorted(counts.keys()):
            label = definition["optionLabels"].get(value, value)
            option_list.append(OrderedDict([("value", value), ("label", label), ("count", counts[value])]))
        options[definition["key"]] = option_list
    return options


def new_app_entity(label: str, source: Any, definitions: Any, items: Any, model: Any = None) -> dict[str, Any]:
    return OrderedDict(
        [
            ("label", label),
            ("source", source),
            ("model", model),
            ("filter_definitions", definitions),
            ("filter_options", get_filter_options(items, definitions)),
            ("items", items),
        ]
    )


def build_static_app_payload(config: dict[str, Any], normalized: dict[str, Any], asset_metadata: Any = None) -> dict[str, Any]:
    characters_defs = [
        new_filter_definition("rarity", "Rarity", {"1": "1-star", "2": "2-star", "3": "3-star"}),
        new_filter_definition("surface", "A Surface", APTITUDE_DISPLAY_LABELS),
        new_filter_definition("distance", "A Distance", APTITUDE_DISPLAY_LABELS),
        new_filter_definition("style", "A Style", APTITUDE_DISPLAY_LABELS),
        new_filter_definition("availability_en", "EN Availability", {"available": "Available", "unreleased": "Unreleased"}),
    ]
    supports_defs = [
        new_filter_definition("type", "Type"),
        new_filter_definition("rarity", "Rarity", {"1": "R", "2": "SR", "3": "SSR"}),
        new_filter_definition("obtained", "Obtained"),
        new_filter_definition("availability_en", "EN Availability", {"available": "Available", "unreleased": "Unreleased"}),
    ]
    skills_defs = [
        new_filter_definition("rarity", "Rarity"),
        new_filter_definition("type_tags", "Type Tags", SKILL_TAG_DISPLAY_LABELS),
        new_filter_definition("has_cost", "Cost", {"yes": "Has cost", "no": "No cost"}),
        new_filter_definition("character_specific", "Character Specific", {"yes": "Yes", "no": "No"}),
    ]
    races_defs = [
        new_filter_definition("track_name", "Track"),
        new_filter_definition("surface", "Surface"),
        new_filter_definition("distance", "Distance"),
        new_filter_definition("direction", "Direction"),
        new_filter_definition("season", "Season"),
        new_filter_definition("time_of_day", "Time"),
        new_filter_definition("grade", "Grade"),
    ]
    racetracks_defs = [
        new_filter_definition("track_name", "Track"),
        new_filter_definition("surface", "Surface"),
        new_filter_definition("distance", "Distance"),
        new_filter_definition("turn", "Turn"),
        new_filter_definition("layout", "Layout"),
        new_filter_definition("has_slopes", "Slopes", {"yes": "Has slopes", "no": "No slopes"}),
    ]
    g1_defs = [
        new_filter_definition("track_name", "Track"),
        new_filter_definition("surface", "Surface"),
        new_filter_definition("distance", "Distance"),
        new_filter_definition("effect", "Effect"),
    ]
    compat_defs = [
        new_filter_definition("availability_en", "EN Availability", {"available": "Available", "unreleased": "Unreleased"}),
        new_filter_definition("score_band", "Top Match Score"),
    ]
    cm_defs = [
        new_filter_definition("track_name", "Track"),
        new_filter_definition("surface", "Surface"),
        new_filter_definition("distance", "Distance"),
        new_filter_definition("direction", "Direction"),
        new_filter_definition("season", "Season"),
        new_filter_definition("weather", "Weather"),
        new_filter_definition("condition", "Condition"),
    ]
    scenarios_defs = [
        new_filter_definition("program", "Program"),
        new_filter_definition("scenario_key", "Scenario Key"),
        new_filter_definition("factor_effect", "Factor Effect"),
    ]
    training_events_defs = [
        new_filter_definition("event_source", "Event Source", TRAINING_EVENT_SOURCE_LABELS),
        new_filter_definition("linked_character", "Linked Character"),
        new_filter_definition("linked_support", "Linked Support"),
        new_filter_definition("linked_scenario", "Linked Scenario"),
        new_filter_definition("has_branching", "Branching", {"yes": "Yes", "no": "No"}),
    ]

    characters_items: list[dict[str, Any]] = []
    for item in as_array(normalized["characters"]["items"]):
        badge_labels = convert_display_label_list(
            as_array(item["viable_aptitudes"]["surface"]) + as_array(item["viable_aptitudes"]["distance"]) + as_array(item["viable_aptitudes"]["style"]),
            APTITUDE_DISPLAY_LABELS,
        )
        characters_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", f"{item.get('variant')} | {item['rarity']}-star"),
                    ("media", convert_app_asset_map(config, item.get("assets"))),
                    ("badges", badge_labels),
                    ("search_text", join_search_text([item["name"], item["names"]["en"], item["names"]["ja"], item.get("variant"), item["titles"]["en"], badge_labels])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("rarity", str(item["rarity"])),
                                ("surface", as_array(item["viable_aptitudes"]["surface"])),
                                ("distance", as_array(item["viable_aptitudes"]["distance"])),
                                ("style", as_array(item["viable_aptitudes"]["style"])),
                                ("availability_en", "available" if item["release"].get("en") is not None else "unreleased"),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    supports_items: list[dict[str, Any]] = []
    rarity_labels = ["R", "SR", "SSR"]
    for item in as_array(normalized["supports"]["items"]):
        subtitle = f"{item['type']} | {rarity_labels[int(item['rarity']) - 1]}"
        supports_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", subtitle),
                    ("media", convert_app_asset_map(config, item.get("assets"))),
                    ("badges", [effect.get("name") for effect in as_array(item.get("effects"))[:4]]),
                    ("search_text", join_search_text([item["name"], item["names"]["ja"], item["type"], item.get("obtained"), [skill.get("name") for skill in as_array(item.get("hint_skills"))]])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("type", item["type"]),
                                ("rarity", str(item["rarity"])),
                                ("obtained", item.get("obtained")),
                                ("availability_en", "available" if item["release"].get("en") is not None else "unreleased"),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    skills_items: list[dict[str, Any]] = []
    for item in as_array(normalized["skills"]["items"]):
        badge_labels = convert_display_label_list(as_array(item.get("type_tags"))[:4], SKILL_TAG_DISPLAY_LABELS)
        search_labels = convert_display_label_list(item.get("type_tags"), SKILL_TAG_DISPLAY_LABELS)
        subtitle = f"Rarity {item['rarity']}"
        if item.get("cost") is not None:
            subtitle += f" | Cost {item['cost']}"
        skills_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", subtitle),
                    ("media", convert_app_asset_map(config, item.get("assets"))),
                    ("badges", badge_labels),
                    ("search_text", join_search_text([item["name"], item["names"]["ja"], item["descriptions"]["en"], item.get("type_tags"), item.get("localized_type_tags"), search_labels])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("rarity", str(item["rarity"])),
                                ("type_tags", item.get("type_tags")),
                                ("has_cost", "yes" if item.get("cost") is not None else "no"),
                                ("character_specific", "yes" if len(as_array(item.get("related_character_ids"))) > 0 else "no"),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    races_items: list[dict[str, Any]] = []
    for item in as_array(normalized["races"]["items"]):
        races_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", f"{item['track_name']} | {item['grade']} | {item['distance_m']}m"),
                    ("media", convert_app_asset_map(config, item.get("assets"))),
                    ("badges", [item["surface"], item["distance_category"], item["direction"]]),
                    ("search_text", join_search_text([item["name"], item["names"]["ja"], item["track_name"], item["grade"], item.get("factor_summary")])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("track_name", item["track_name"]),
                                ("surface", item["surface"]),
                                ("distance", item["distance_category"]),
                                ("direction", item["direction"]),
                                ("season", item["season"]),
                                ("time_of_day", item["time_of_day"]),
                                ("grade", item["grade"]),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    racetracks_items: list[dict[str, Any]] = []
    for item in as_array(normalized["racetracks"]["items"]):
        racetracks_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", f"{item['track_name']} #{item['course_id']}"),
                    ("subtitle", f"{item['surface']} | {item['distance_category']} | {item['length_m']}m"),
                    ("badges", [item["turn"], item["layout"], f"Corners {item['corner_count']}"]),
                    ("search_text", join_search_text([item["track_name"], item["course_id"], item["surface"], item["distance_category"], item["turn"], item["layout"]])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("track_name", item["track_name"]),
                                ("surface", item["surface"]),
                                ("distance", item["distance_category"]),
                                ("turn", item["turn"]),
                                ("layout", item["layout"]),
                                ("has_slopes", "yes" if item["has_slopes"] else "no"),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    g1_items: list[dict[str, Any]] = []
    for item in as_array(normalized["g1_factors"]["items"]):
        g1_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", f"Race spark | Race ID {item['race_id']}"),
                    ("badges", as_array(item.get("effect_summary"))[:3]),
                    ("search_text", join_search_text([item["name"], item["names"]["ja"], item.get("effect_summary"), item.get("track_names")])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("track_name", item.get("track_names")),
                                ("surface", item.get("surfaces")),
                                ("distance", item.get("distance_categories")),
                                ("effect", item.get("effect_summary")),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    compat_items: list[dict[str, Any]] = []
    for item in as_array(normalized["compatibility"]["items"]):
        top_score = int(as_array(item.get("top_matches"))[0]["base_points"]) if as_array(item.get("top_matches")) else 0
        if top_score >= 20:
            score_band = "20+"
        elif top_score >= 15:
            score_band = "15-19"
        elif top_score >= 10:
            score_band = "10-14"
        else:
            score_band = "0-9"

        compat_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", f"Variants {item['variant_count']} | Best base score {top_score}"),
                    ("badges", [score_band]),
                    ("search_text", join_search_text([item["name"], item["names"]["ja"], [variant.get("variant") for variant in as_array(item.get("variants"))]])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("availability_en", "available" if item["available"]["en"] else "unreleased"),
                                ("score_band", score_band),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    cm_items: list[dict[str, Any]] = []
    for item in as_array(normalized["cm_targets"]["items"]):
        race_profile = item.get("race_profile") or {}
        cm_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", f"{race_profile.get('track_name')} | {race_profile.get('distance_m')}m | {race_profile.get('season')}"),
                    ("badges", [race_profile.get("surface"), race_profile.get("distance_category"), race_profile.get("direction")]),
                    ("search_text", join_search_text([item["name"], item["names"]["ja"], race_profile.get("track_name"), race_profile.get("surface"), race_profile.get("distance_category"), race_profile.get("season"), race_profile.get("weather"), race_profile.get("condition")])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("track_name", race_profile.get("track_name")),
                                ("surface", race_profile.get("surface")),
                                ("distance", race_profile.get("distance_category")),
                                ("direction", race_profile.get("direction")),
                                ("season", race_profile.get("season")),
                                ("weather", race_profile.get("weather")),
                                ("condition", race_profile.get("condition")),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    scenarios_items: list[dict[str, Any]] = []
    for item in as_array(normalized["scenarios"]["items"]):
        scenarios_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", f"{item.get('program_label') or 'Program -'} | {len(as_array(item.get('factors')))} factor(s)"),
                    ("badges", as_array(item.get("factor_effects"))[:4]),
                    ("search_text", join_search_text([item["name"], item.get("key"), item.get("program_label"), item.get("factor_effects"), [factor.get("name") for factor in as_array(item.get("factors"))]])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("program", item.get("program_label")),
                                ("scenario_key", item.get("key")),
                                ("factor_effect", item.get("factor_effects")),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    training_events_items: list[dict[str, Any]] = []
    for item in as_array(normalized["training_events"]["items"]):
        linked_characters = [entry.get("title") for entry in as_array(item.get("linked_entities")) if entry.get("entityKey") == "characters"]
        linked_supports = [entry.get("title") for entry in as_array(item.get("linked_entities")) if entry.get("entityKey") == "supports"]
        linked_scenarios = [entry.get("title") for entry in as_array(item.get("linked_entities")) if entry.get("entityKey") == "scenarios"]
        training_events_items.append(
            OrderedDict(
                [
                    ("id", item["id"]),
                    ("title", item["name"]),
                    ("subtitle", item["subtitle"]),
                    ("badges", [item.get("source_label"), "Branching" if item.get("has_branching") else None, f"{item.get('choice_count')} choice(s)"]),
                    ("search_text", join_search_text([item["name"], item.get("subtitle"), item.get("event_source"), item.get("source_label"), item.get("event_id"), linked_characters, linked_supports, linked_scenarios])),
                    (
                        "filters",
                        OrderedDict(
                            [
                                ("event_source", item.get("event_source")),
                                ("linked_character", linked_characters),
                                ("linked_support", linked_supports),
                                ("linked_scenario", linked_scenarios),
                                ("has_branching", "yes" if item.get("has_branching") else "no"),
                            ]
                        ),
                    ),
                    ("detail", item),
                ]
            )
        )

    payload = OrderedDict(
        [
            (
                "reference",
                OrderedDict(
                    [
                        ("schema_version", SCHEMA_VERSION),
                        ("generated_at", get_now_iso()),
                        (
                            "assets",
                            OrderedDict(
                                [
                                    ("local_base_path", config["assetServeBasePath"]),
                                    ("count", asset_metadata["counts"]["total"] if asset_metadata else 0),
                                    ("downloaded", asset_metadata["counts"]["downloaded"] if asset_metadata else 0),
                                    ("reused", asset_metadata["counts"]["reused"] if asset_metadata else 0),
                                    ("stale", asset_metadata["counts"]["stale"] if asset_metadata else 0),
                                    ("failed", asset_metadata["counts"]["failed"] if asset_metadata else 0),
                                    ("synced_at", asset_metadata.get("generated_at") if asset_metadata else None),
                                ]
                            ),
                        ),
                        (
                            "entities",
                            OrderedDict(
                                [
                                    ("characters", OrderedDict([("count", len(characters_items)), ("imported_at", normalized["characters"]["source"]["imported_at"])])),
                                    ("supports", OrderedDict([("count", len(supports_items)), ("imported_at", normalized["supports"]["source"]["imported_at"])])),
                                    ("skills", OrderedDict([("count", len(skills_items)), ("imported_at", normalized["skills"]["source"]["imported_at"])])),
                                    ("races", OrderedDict([("count", len(races_items)), ("imported_at", normalized["races"]["source"]["imported_at"])])),
                                    ("racetracks", OrderedDict([("count", len(racetracks_items)), ("imported_at", normalized["racetracks"]["source"]["imported_at"])])),
                                    ("g1_factors", OrderedDict([("count", len(g1_items)), ("imported_at", normalized["g1_factors"]["source"]["imported_at"])])),
                                    ("cm_targets", OrderedDict([("count", len(cm_items)), ("imported_at", normalized["cm_targets"]["source"]["imported_at"])])),
                                    ("scenarios", OrderedDict([("count", len(scenarios_items)), ("imported_at", normalized["scenarios"]["source"]["imported_at"])])),
                                    ("training_events", OrderedDict([("count", len(training_events_items)), ("imported_at", normalized["training_events"]["source"]["imported_at"])])),
                                    ("compatibility", OrderedDict([("count", len(compat_items)), ("imported_at", normalized["compatibility"]["source"]["imported_at"])])),
                                ]
                            ),
                        ),
                    ]
                ),
            ),
            (
                "entities",
                OrderedDict(
                    [
                        ("characters", new_app_entity("Characters", normalized["characters"]["source"], characters_defs, characters_items)),
                        ("supports", new_app_entity("Supports", normalized["supports"]["source"], supports_defs, supports_items)),
                        ("skills", new_app_entity("Skills", normalized["skills"]["source"], skills_defs, skills_items)),
                        ("races", new_app_entity("Races", normalized["races"]["source"], races_defs, races_items)),
                        ("racetracks", new_app_entity("Racetracks", normalized["racetracks"]["source"], racetracks_defs, racetracks_items)),
                        ("g1_factors", new_app_entity("G1 Factors", normalized["g1_factors"]["source"], g1_defs, g1_items)),
                        ("cm_targets", new_app_entity("CM Targets", normalized["cm_targets"]["source"], cm_defs, cm_items)),
                        ("scenarios", new_app_entity("Scenarios", normalized["scenarios"]["source"], scenarios_defs, scenarios_items)),
                        ("training_events", new_app_entity("Training Events", normalized["training_events"]["source"], training_events_defs, training_events_items)),
                        ("compatibility", new_app_entity("Compatibility", normalized["compatibility"]["source"], compat_defs, compat_items, normalized["compatibility"]["model"])),
                    ]
                ),
            ),
        ]
    )
    return payload


def save_static_app(payload: dict[str, Any], asset_metadata: Any = None) -> None:
    dist_root = PROJECT_ROOT / "dist"
    dist_assets = dist_root / "assets"
    dist_data = dist_root / "data"
    dist_media = dist_root / "media" / "reference"
    ensure_directory(dist_root)
    ensure_directory(dist_assets)
    ensure_directory(dist_data)
    ensure_directory(dist_media)

    ui_root = PROJECT_ROOT / "src" / "ui"
    write_utf8_file(dist_root / "index.html", (ui_root / "index.html").read_text(encoding="utf-8"), with_bom=True)
    write_utf8_file(dist_assets / "app.css", (ui_root / "assets" / "app.css").read_text(encoding="utf-8"), with_bom=True)
    write_utf8_file(dist_assets / "app.js", (ui_root / "assets" / "app.js").read_text(encoding="utf-8"), with_bom=True)
    for ui_asset_path in (ui_root / "assets").iterdir():
        if not ui_asset_path.is_file():
            continue
        if ui_asset_path.name in {"app.css", "app.js"}:
            continue
        shutil.copy2(ui_asset_path, dist_assets / ui_asset_path.name)

    if asset_metadata is not None:
        for asset_entry in get_asset_map_entries(asset_metadata.get("assets")):
            asset = asset_entry["value"]
            if asset is None:
                continue
            local_path = Path(asset["local_path"])
            if not local_path.exists():
                continue
            dist_path = dist_media / Path(asset["relative_path"])
            ensure_directory(dist_path.parent)
            shutil.copy2(local_path, dist_path)

    write_json_file(dist_data / "reference-meta.json", payload["reference"])

    legacy_json_path = dist_data / "reference-data.json"
    if legacy_json_path.exists():
        legacy_json_path.unlink()

    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    write_utf8_file(dist_data / "reference-data.js", f"window.UMA_REFERENCE_DATA = {payload_json};\n", with_bom=True)


def update_umamusume_reference(*, force: bool = False, progress_callback: ProgressCallback | None = None) -> dict[str, Any]:
    if progress_callback:
        progress_callback(
            {
                "progress": 2,
                "message": "Preparing local reference update. This may take several minutes.",
                "current_task": "Preparing update",
            }
        )

    print("Step 1/5: syncing raw GameTora datasets...")
    sync = sync_reference_raw_data(force=force, progress_callback=progress_callback)

    print("Step 2/5: normalizing local reference schemas...")
    if progress_callback:
        progress_callback(
            {
                "progress": 18,
                "message": "Normalizing reference datasets...",
                "current_task": "Normalizing raw data",
            }
        )
    normalized = build_normalized_reference(sync["config"], sync["metadata"])
    if progress_callback:
        progress_callback(
            {
                "progress": 24,
                "message": "Saving normalized datasets locally...",
                "current_task": "Writing normalized JSON files",
            }
        )
    save_normalized_reference(normalized)

    print("Step 3/5: syncing local visual assets...")
    if progress_callback:
        progress_callback(
            {
                "progress": 28,
                "message": "Syncing local visual assets. This is often the longest step.",
                "current_task": "Preparing asset synchronization",
            }
        )
    asset_sync = sync_reference_assets(sync["config"], normalized, force=force, progress_callback=progress_callback)

    print("Step 4/5: building static local app bundle...")
    if progress_callback:
        progress_callback(
            {
                "progress": 74,
                "message": "Building the local app bundle...",
                "current_task": "Building static frontend payload",
            }
        )
    payload = build_static_app_payload(sync["config"], normalized, asset_sync["metadata"])
    if progress_callback:
        progress_callback(
            {
                "progress": 80,
                "message": "Saving local app bundle...",
                "current_task": "Writing dist files",
            }
        )
    save_static_app(payload, asset_sync["metadata"])

    print("Step 5/5: materializing local SQLite reference...")
    if progress_callback:
        progress_callback(
            {
                "progress": 82,
                "message": "Materializing the local SQLite reference database...",
                "current_task": "Preparing SQLite runtime database",
            }
        )
    sqlite_summary = build_reference_database(
        sync["config"],
        normalized,
        asset_sync["metadata"],
        progress_callback=progress_callback,
    )

    if progress_callback:
        progress_callback(
            {
                "progress": 100,
                "message": "Local reference update completed.",
                "current_task": "Completed",
            }
        )

    return OrderedDict(
        [
            ("rawDatasetCount", len(as_array(sync["config"].get("datasets")))),
            ("normalizedEntityCount", len(normalized.keys())),
            ("assetCount", asset_sync["metadata"]["counts"]["total"]),
            ("assetFailureCount", asset_sync["metadata"]["counts"]["failed"]),
            ("appEntry", str(PROJECT_ROOT / "dist" / "index.html")),
            ("referenceDbPath", sqlite_summary["path"]),
            ("referenceDbSizeBytes", sqlite_summary["size_bytes"]),
            ("referenceDbSchemaVersion", sqlite_summary["runtime_schema_version"]),
        ]
    )
