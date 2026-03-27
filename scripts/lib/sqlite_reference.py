from __future__ import annotations

import json
import sqlite3
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SQLITE_RUNTIME_SCHEMA_VERSION = "1.2.0"

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

SUPPORT_STAT_GAIN_LABELS = {
    "1": "Speed",
    "2": "Stamina",
    "3": "Power",
    "4": "Guts",
    "5": "Wisdom",
    "30": "Skill Pt",
}

RARITY_LABELS = {
    "1": "R",
    "2": "SR",
    "3": "SSR",
}

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE reference_build (
  build_id INTEGER PRIMARY KEY CHECK (build_id = 1),
  runtime_schema_version TEXT NOT NULL,
  reference_schema_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  asset_synced_at TEXT,
  asset_count INTEGER NOT NULL DEFAULT 0,
  asset_downloaded_count INTEGER NOT NULL DEFAULT 0,
  asset_reused_count INTEGER NOT NULL DEFAULT 0,
  asset_stale_count INTEGER NOT NULL DEFAULT 0,
  asset_failed_count INTEGER NOT NULL DEFAULT 0,
  reference_json TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE reference_source_entities (
  entity_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  imported_at TEXT,
  source_json TEXT NOT NULL
);

CREATE TABLE reference_documents (
  document_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE reference_assets (
  entity_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  role TEXT,
  type TEXT,
  relative_path TEXT,
  source_url TEXT,
  local_path TEXT,
  content_type TEXT,
  alt TEXT,
  downloaded_at TEXT,
  checked_at TEXT,
  status TEXT,
  size_bytes INTEGER,
  owners_json TEXT,
  PRIMARY KEY (entity_key, item_id, asset_key)
);

CREATE TABLE entity_filter_values (
  entity_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  filter_key TEXT NOT NULL,
  filter_value TEXT NOT NULL,
  PRIMARY KEY (entity_key, item_id, filter_key, filter_value)
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  card_id INTEGER NOT NULL,
  base_character_id INTEGER NOT NULL,
  url_name TEXT,
  base_url_name TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  variant TEXT,
  title_en TEXT,
  rarity INTEGER NOT NULL,
  obtained TEXT,
  release_jp TEXT,
  release_en TEXT,
  availability_en INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  media_json TEXT,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE character_aptitudes (
  character_id TEXT NOT NULL,
  category TEXT NOT NULL,
  aptitude_key TEXT NOT NULL,
  aptitude_label TEXT NOT NULL,
  grade TEXT NOT NULL,
  is_viable INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (character_id, category, aptitude_key),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE character_stat_bonuses (
  character_id TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  stat_value INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (character_id, stat_key),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE character_stats (
  character_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  stat_value INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (character_id, tier, stat_key),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE character_skill_links (
  character_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  skill_id TEXT,
  linked_skill_id TEXT,
  skill_name TEXT,
  linked_skill_name TEXT,
  payload_json TEXT,
  PRIMARY KEY (character_id, link_type, slot_index),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE character_progression (
  character_id TEXT PRIMARY KEY,
  card_id INTEGER NOT NULL,
  base_character_id INTEGER NOT NULL,
  talent_group_id INTEGER,
  awakening_skill_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE character_progression_levels (
  character_id TEXT NOT NULL,
  awakening_level INTEGER NOT NULL,
  linked_skill_id TEXT,
  linked_skill_name TEXT,
  costs_json TEXT,
  payload_json TEXT,
  PRIMARY KEY (character_id, awakening_level),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE supports (
  id TEXT PRIMARY KEY,
  support_id INTEGER NOT NULL,
  character_id INTEGER,
  url_name TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  type TEXT,
  rarity INTEGER NOT NULL,
  obtained TEXT,
  release_jp TEXT,
  release_en TEXT,
  availability_en INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  media_json TEXT,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE support_effect_catalog (
  effect_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  calc TEXT,
  symbol TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE support_effects (
  support_id TEXT NOT NULL,
  effect_scope TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  effect_id INTEGER,
  effect_name TEXT,
  level INTEGER,
  description TEXT,
  payload_json TEXT,
  PRIMARY KEY (support_id, effect_scope, slot_index),
  FOREIGN KEY (support_id) REFERENCES supports(id) ON DELETE CASCADE
);

CREATE TABLE support_skill_links (
  support_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  skill_id TEXT,
  skill_name TEXT,
  payload_json TEXT,
  PRIMARY KEY (support_id, link_type, slot_index),
  FOREIGN KEY (support_id) REFERENCES supports(id) ON DELETE CASCADE
);

CREATE TABLE support_hint_other_effects (
  support_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  hint_type TEXT,
  hint_value INTEGER,
  display_label TEXT,
  payload_json TEXT,
  PRIMARY KEY (support_id, slot_index),
  FOREIGN KEY (support_id) REFERENCES supports(id) ON DELETE CASCADE
);

CREATE TABLE support_progression (
  rarity INTEGER PRIMARY KEY,
  label TEXT,
  card_count INTEGER NOT NULL DEFAULT 0,
  max_level INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE TABLE support_progression_levels (
  rarity INTEGER NOT NULL,
  level INTEGER NOT NULL,
  total_exp INTEGER NOT NULL,
  curve_id INTEGER,
  PRIMARY KEY (rarity, level),
  FOREIGN KEY (rarity) REFERENCES support_progression(rarity) ON DELETE CASCADE
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  skill_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  rarity INTEGER NOT NULL,
  cost INTEGER,
  icon_id INTEGER,
  activation TEXT,
  character_specific INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  media_json TEXT,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE skill_tags (
  skill_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  tag_value TEXT NOT NULL,
  display_label TEXT NOT NULL,
  PRIMARY KEY (skill_id, slot_index),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE skill_related_characters (
  skill_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (skill_id, slot_index),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE skill_condition_groups (
  skill_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (skill_id, scope, slot_index),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE races (
  id TEXT PRIMARY KEY,
  race_instance_id INTEGER NOT NULL,
  race_id INTEGER NOT NULL,
  url_name TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  track_id TEXT,
  track_name TEXT,
  track_slug TEXT,
  course_id INTEGER,
  banner_id INTEGER,
  surface TEXT,
  surface_slug TEXT,
  distance_m INTEGER,
  distance_category TEXT,
  direction TEXT,
  season TEXT,
  time_of_day TEXT,
  grade TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  media_json TEXT,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE racetracks (
  id TEXT PRIMARY KEY,
  course_id INTEGER NOT NULL,
  track_id TEXT,
  track_name TEXT,
  track_slug TEXT,
  surface TEXT,
  surface_slug TEXT,
  distance_category TEXT,
  distance_category_slug TEXT,
  length_m INTEGER,
  turn TEXT,
  turn_slug TEXT,
  layout TEXT,
  layout_slug TEXT,
  corner_count INTEGER,
  straight_count INTEGER,
  uphill_count INTEGER,
  downhill_count INTEGER,
  has_slopes INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE g1_factors (
  id TEXT PRIMARY KEY,
  factor_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  factor_type INTEGER,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE g1_factor_related_races (
  factor_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  race_instance_id INTEGER,
  name TEXT,
  track_name TEXT,
  surface TEXT,
  distance_m INTEGER,
  grade TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (factor_id, slot_index),
  FOREIGN KEY (factor_id) REFERENCES g1_factors(id) ON DELETE CASCADE
);

CREATE TABLE cm_targets (
  id TEXT PRIMARY KEY,
  cm_id INTEGER NOT NULL,
  resource_id INTEGER,
  slug TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  start_at TEXT,
  end_at TEXT,
  start_ts INTEGER,
  end_ts INTEGER,
  track_id TEXT,
  track_name TEXT,
  track_slug TEXT,
  surface TEXT,
  surface_slug TEXT,
  distance_m INTEGER,
  distance_category TEXT,
  distance_category_slug TEXT,
  direction TEXT,
  direction_slug TEXT,
  season TEXT,
  season_slug TEXT,
  weather TEXT,
  weather_slug TEXT,
  condition TEXT,
  condition_slug TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE cm_target_related_entities (
  cm_target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  entity_key TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (cm_target_id, relation_type, slot_index),
  FOREIGN KEY (cm_target_id) REFERENCES cm_targets(id) ON DELETE CASCADE
);

CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  scenario_id INTEGER NOT NULL,
  scenario_key TEXT,
  slug TEXT,
  name TEXT NOT NULL,
  order_index INTEGER,
  program INTEGER,
  program_label TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE scenario_stat_caps (
  scenario_id TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  stat_value INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (scenario_id, stat_key),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

CREATE TABLE scenario_factors (
  scenario_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  factor_id INTEGER,
  name TEXT,
  effects_json TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (scenario_id, slot_index),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

CREATE TABLE training_events (
  id TEXT PRIMARY KEY,
  event_source TEXT NOT NULL,
  source_label TEXT,
  owner_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  sequence_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_source TEXT,
  linked_support_id TEXT,
  linked_scenario_id TEXT,
  choice_count INTEGER NOT NULL,
  has_branching INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE training_event_linked_entities (
  training_event_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  entity_key TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  availability_en TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (training_event_id, slot_index),
  FOREIGN KEY (training_event_id) REFERENCES training_events(id) ON DELETE CASCADE
);

CREATE TABLE training_event_choices (
  training_event_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  choice_token TEXT,
  choice_label TEXT,
  effect_count INTEGER NOT NULL,
  effect_tokens_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (training_event_id, slot_index),
  FOREIGN KEY (training_event_id) REFERENCES training_events(id) ON DELETE CASCADE
);

CREATE TABLE compatibility (
  id TEXT PRIMARY KEY,
  character_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  name_ja TEXT,
  variant_count INTEGER NOT NULL,
  available_en INTEGER NOT NULL,
  top_score INTEGER NOT NULL,
  score_band TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  badges_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE compatibility_variants (
  compatibility_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  card_id INTEGER,
  name TEXT,
  variant TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (compatibility_id, slot_index),
  FOREIGN KEY (compatibility_id) REFERENCES compatibility(id) ON DELETE CASCADE
);

CREATE TABLE compatibility_top_matches (
  compatibility_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  name TEXT,
  base_points INTEGER NOT NULL,
  shared_relation_count INTEGER NOT NULL,
  available_en INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (compatibility_id, slot_index),
  FOREIGN KEY (compatibility_id) REFERENCES compatibility(id) ON DELETE CASCADE
);

CREATE TABLE compatibility_relation_groups (
  compatibility_id TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  relation_type TEXT NOT NULL,
  relation_point INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (compatibility_id, group_index),
  FOREIGN KEY (compatibility_id) REFERENCES compatibility(id) ON DELETE CASCADE
);

CREATE TABLE compatibility_relation_group_members (
  compatibility_id TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  other_character_id INTEGER NOT NULL,
  PRIMARY KEY (compatibility_id, group_index, slot_index),
  FOREIGN KEY (compatibility_id, group_index) REFERENCES compatibility_relation_groups(compatibility_id, group_index) ON DELETE CASCADE
);

CREATE INDEX idx_reference_assets_relative_path ON reference_assets(relative_path);
CREATE INDEX idx_entity_filter_values_lookup ON entity_filter_values(entity_key, filter_key, filter_value);

CREATE INDEX idx_characters_base_character_id ON characters(base_character_id);
CREATE INDEX idx_characters_rarity ON characters(rarity);
CREATE INDEX idx_characters_availability_en ON characters(availability_en);
CREATE INDEX idx_character_aptitudes_lookup ON character_aptitudes(category, aptitude_key, is_viable);
CREATE INDEX idx_character_skill_links_lookup ON character_skill_links(skill_id, link_type);

CREATE INDEX idx_supports_type ON supports(type);
CREATE INDEX idx_supports_rarity ON supports(rarity);
CREATE INDEX idx_supports_availability_en ON supports(availability_en);
CREATE INDEX idx_support_skill_links_lookup ON support_skill_links(skill_id, link_type);

CREATE INDEX idx_skills_rarity ON skills(rarity);
CREATE INDEX idx_skills_cost ON skills(cost);
CREATE INDEX idx_skills_character_specific ON skills(character_specific);
CREATE INDEX idx_skill_tags_lookup ON skill_tags(tag_value);
CREATE INDEX idx_skill_related_characters_lookup ON skill_related_characters(character_id);

CREATE INDEX idx_races_track_name ON races(track_name);
CREATE INDEX idx_races_surface ON races(surface);
CREATE INDEX idx_races_distance_category ON races(distance_category);
CREATE INDEX idx_races_grade ON races(grade);

CREATE INDEX idx_racetracks_track_name ON racetracks(track_name);
CREATE INDEX idx_racetracks_surface ON racetracks(surface);
CREATE INDEX idx_racetracks_distance_category ON racetracks(distance_category);
CREATE INDEX idx_racetracks_has_slopes ON racetracks(has_slopes);

CREATE INDEX idx_g1_factor_related_races_track_name ON g1_factor_related_races(track_name);
CREATE INDEX idx_cm_targets_track_name ON cm_targets(track_name);
CREATE INDEX idx_cm_targets_surface ON cm_targets(surface);
CREATE INDEX idx_cm_targets_distance_category ON cm_targets(distance_category);
CREATE INDEX idx_cm_targets_direction ON cm_targets(direction);
CREATE INDEX idx_cm_targets_season ON cm_targets(season);
CREATE INDEX idx_scenarios_program ON scenarios(program);
CREATE INDEX idx_scenarios_key ON scenarios(scenario_key);
CREATE INDEX idx_training_events_source ON training_events(event_source);
CREATE INDEX idx_training_events_owner ON training_events(owner_id);
CREATE INDEX idx_training_events_linked_support ON training_events(linked_support_id);
CREATE INDEX idx_training_events_linked_scenario ON training_events(linked_scenario_id);
CREATE INDEX idx_compatibility_available_en ON compatibility(available_en);
CREATE INDEX idx_compatibility_top_score ON compatibility(top_score DESC);
CREATE INDEX idx_compatibility_matches_character_id ON compatibility_top_matches(character_id);
CREATE INDEX idx_character_progression_talent_group ON character_progression(talent_group_id);
CREATE INDEX idx_support_progression_levels_rarity ON support_progression_levels(rarity);

CREATE VIEW browse_characters AS
SELECT id, title, subtitle, badges_json, media_json, search_text, rarity, availability_en
FROM characters;

CREATE VIEW roster_character_projection AS
SELECT
  c.id,
  c.card_id,
  c.base_character_id,
  c.title,
  c.subtitle,
  c.rarity,
  c.availability_en,
  cp.talent_group_id,
  cp.awakening_skill_count
FROM characters c
LEFT JOIN character_progression cp ON cp.character_id = c.id;

CREATE VIEW browse_supports AS
SELECT id, title, subtitle, badges_json, media_json, search_text, type, rarity, availability_en
FROM supports;

CREATE VIEW roster_support_projection AS
SELECT
  s.id,
  s.support_id,
  s.character_id,
  s.title,
  s.subtitle,
  s.rarity,
  s.availability_en,
  sp.max_level AS rarity_max_level
FROM supports s
LEFT JOIN support_progression sp ON sp.rarity = s.rarity;

CREATE VIEW browse_skills AS
SELECT id, title, subtitle, badges_json, media_json, search_text, rarity, cost, character_specific
FROM skills;

CREATE VIEW browse_races AS
SELECT id, title, subtitle, badges_json, media_json, search_text, track_name, surface, distance_category, direction, season, time_of_day, grade
FROM races;

CREATE VIEW browse_racetracks AS
SELECT id, title, subtitle, badges_json, search_text, track_name, surface, distance_category, turn, layout, has_slopes
FROM racetracks;

CREATE VIEW browse_g1_factors AS
SELECT id, title, subtitle, badges_json, search_text
FROM g1_factors;

CREATE VIEW browse_cm_targets AS
SELECT id, title, subtitle, badges_json, search_text, track_name, surface, distance_category, direction, season, weather, condition
FROM cm_targets;

CREATE VIEW browse_scenarios AS
SELECT id, title, subtitle, badges_json, search_text, program, scenario_key
FROM scenarios;

CREATE VIEW browse_training_events AS
SELECT id, title, subtitle, badges_json, search_text, event_source, linked_support_id, linked_scenario_id, has_branching
FROM training_events;

CREATE VIEW browse_compatibility AS
SELECT id, title, subtitle, badges_json, search_text, available_en, top_score, score_band
FROM compatibility;
"""


def as_array(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


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


def encode_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


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


def get_asset_entries(asset_map: Any) -> list[tuple[str, Any]]:
    if asset_map is None:
        return []
    if isinstance(asset_map, dict):
        return list(asset_map.items())
    items_method = getattr(asset_map, "items", None)
    if callable(items_method):
        return list(items_method())
    return []


def ensure_directory(path: Path | str | None) -> None:
    if not path:
        return
    Path(path).mkdir(parents=True, exist_ok=True)


def bool_int(value: Any) -> int:
    return 1 if bool(value) else 0


def availability_int(value: Any) -> int:
    return 1 if value is not None and value is not False else 0


def get_reference_database_path() -> Path:
    return PROJECT_ROOT / "data" / "runtime" / "reference.sqlite"


def score_band_for_value(score: int) -> str:
    if score >= 20:
        return "20+"
    if score >= 15:
        return "15-19"
    if score >= 10:
        return "10-14"
    return "0-9"


def build_reference_database(
    config: dict[str, Any],
    normalized: dict[str, Any],
    asset_metadata: dict[str, Any] | None = None,
    *,
    target_path: Path | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    database_path = Path(target_path) if target_path else get_reference_database_path()
    ensure_directory(database_path.parent)
    temp_path = database_path.with_suffix(f"{database_path.suffix}.tmp")
    if temp_path.exists():
        temp_path.unlink()

    asset_lookup = asset_metadata.get("assets", {}) if isinstance(asset_metadata, dict) else {}
    counts = asset_metadata.get("counts", {}) if isinstance(asset_metadata, dict) else {}

    connection = sqlite3.connect(temp_path)
    try:
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA temp_store=MEMORY")
        connection.executescript(SCHEMA_SQL)

        with connection:
            if progress_callback:
                progress_callback({"progress": 83, "message": "Creating SQLite runtime schema...", "current_task": "Initializing SQLite schema"})
            _insert_reference_build(connection, config, normalized, asset_metadata, counts)
            if progress_callback:
                progress_callback({"progress": 85, "message": "Indexing source datasets...", "current_task": "Writing source metadata"})
            _insert_reference_sources(connection, normalized)
            _insert_reference_documents(connection, normalized)
            _insert_reference_assets(connection, normalized, asset_lookup)
            if progress_callback:
                progress_callback({"progress": 88, "message": "Importing characters into SQLite...", "current_task": "Writing characters"})
            _insert_characters(connection, normalized["characters"])
            _insert_character_progression(connection, normalized["character_progression"])
            if progress_callback:
                progress_callback({"progress": 90, "message": "Importing supports into SQLite...", "current_task": "Writing supports"})
            _insert_supports(connection, normalized["supports"])
            _insert_support_progression(connection, normalized["support_progression"])
            if progress_callback:
                progress_callback({"progress": 92, "message": "Importing skills into SQLite...", "current_task": "Writing skills"})
            _insert_skills(connection, normalized["skills"])
            if progress_callback:
                progress_callback({"progress": 94, "message": "Importing races into SQLite...", "current_task": "Writing races"})
            _insert_races(connection, normalized["races"])
            _insert_racetracks(connection, normalized["racetracks"])
            _insert_g1_factors(connection, normalized["g1_factors"])
            _insert_cm_targets(connection, normalized["cm_targets"])
            _insert_scenarios(connection, normalized["scenarios"])
            _insert_training_events(connection, normalized["training_events"])
            _insert_compatibility(connection, normalized["compatibility"])
            if progress_callback:
                progress_callback({"progress": 97, "message": "Finalizing SQLite indexes...", "current_task": "Running ANALYZE"})
            connection.execute("ANALYZE")
    finally:
        connection.close()

    temp_path.replace(database_path)
    return OrderedDict(
        [
            ("path", str(database_path)),
            ("size_bytes", database_path.stat().st_size),
            ("runtime_schema_version", SQLITE_RUNTIME_SCHEMA_VERSION),
        ]
    )


def read_reference_database_meta(path: Path | None = None) -> dict[str, Any] | None:
    database_path = Path(path) if path else get_reference_database_path()
    if not database_path.exists():
        return None

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        build_row = connection.execute(
            """
            SELECT runtime_schema_version, reference_schema_version, generated_at,
                   asset_synced_at, asset_count, asset_downloaded_count,
                   asset_reused_count, asset_stale_count, asset_failed_count
            FROM reference_build
            WHERE build_id = 1
            """
        ).fetchone()
        entity_rows = connection.execute(
            """
            SELECT entity_key, label, item_count, imported_at
            FROM reference_source_entities
            ORDER BY entity_key
            """
        ).fetchall()
    finally:
        connection.close()

    if build_row is None:
        return None

    return OrderedDict(
        [
            ("path", str(database_path)),
            ("size_bytes", database_path.stat().st_size),
            (
                "build",
                OrderedDict(
                    [
                        ("runtime_schema_version", build_row["runtime_schema_version"]),
                        ("reference_schema_version", build_row["reference_schema_version"]),
                        ("generated_at", build_row["generated_at"]),
                        ("asset_synced_at", build_row["asset_synced_at"]),
                        (
                            "assets",
                            OrderedDict(
                                [
                                    ("count", build_row["asset_count"]),
                                    ("downloaded", build_row["asset_downloaded_count"]),
                                    ("reused", build_row["asset_reused_count"]),
                                    ("stale", build_row["asset_stale_count"]),
                                    ("failed", build_row["asset_failed_count"]),
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
                        (
                            row["entity_key"],
                            OrderedDict(
                                [
                                    ("label", row["label"]),
                                    ("count", row["item_count"]),
                                    ("imported_at", row["imported_at"]),
                                ]
                            ),
                        )
                        for row in entity_rows
                    ]
                ),
            ),
        ]
    )


def _insert_reference_build(
    connection: sqlite3.Connection,
    config: dict[str, Any],
    normalized: dict[str, Any],
    asset_metadata: dict[str, Any] | None,
    counts: dict[str, Any],
) -> None:
    reference_json = OrderedDict(
        [
            ("entities", OrderedDict((key, len(as_array(dataset.get("items")))) for key, dataset in normalized.items())),
            ("assets", asset_metadata.get("counts") if asset_metadata else {}),
        ]
    )
    reference_schema_version = coalesce(normalized.get("characters", {}).get("schema_version"), "1.0.0")
    generated_at = max((dataset.get("generated_at") or "" for dataset in normalized.values()), default="")
    connection.execute(
        """
        INSERT INTO reference_build (
          build_id, runtime_schema_version, reference_schema_version, generated_at,
          asset_synced_at, asset_count, asset_downloaded_count, asset_reused_count,
          asset_stale_count, asset_failed_count, reference_json, config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            1,
            SQLITE_RUNTIME_SCHEMA_VERSION,
            reference_schema_version,
            generated_at,
            asset_metadata.get("generated_at") if asset_metadata else None,
            int(counts.get("total") or 0),
            int(counts.get("downloaded") or 0),
            int(counts.get("reused") or 0),
            int(counts.get("stale") or 0),
            int(counts.get("failed") or 0),
            encode_json(reference_json),
            encode_json(config),
        ),
    )


def _insert_reference_sources(connection: sqlite3.Connection, normalized: dict[str, Any]) -> None:
    for entity_key, dataset in normalized.items():
        source = dataset.get("source") or {}
        connection.execute(
            """
            INSERT INTO reference_source_entities (entity_key, label, item_count, imported_at, source_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                entity_key,
                source.get("label") or entity_key.replace("_", " ").title(),
                len(as_array(dataset.get("items"))),
                source.get("imported_at"),
                encode_json(source),
            ),
        )


def _insert_reference_documents(connection: sqlite3.Connection, normalized: dict[str, Any]) -> None:
    skills_references = normalized.get("skills", {}).get("references") or {}
    compatibility_model = normalized.get("compatibility", {}).get("model")
    documents = OrderedDict(
        [
            ("skills.effect_values", skills_references.get("effect_values")),
            ("skills.condition_values", skills_references.get("condition_values")),
            ("compatibility.model", compatibility_model),
        ]
    )
    for document_key, payload in documents.items():
        if payload is None:
            continue
        connection.execute(
            "INSERT INTO reference_documents (document_key, payload_json) VALUES (?, ?)",
            (document_key, encode_json(payload)),
        )


def _insert_reference_assets(connection: sqlite3.Connection, normalized: dict[str, Any], asset_lookup: dict[str, Any]) -> None:
    for entity_key, dataset in normalized.items():
        for item in as_array(dataset.get("items")):
            item_id = str(item.get("id"))
            for asset_key, asset in get_asset_entries(item.get("assets")):
                if asset is None:
                    continue
                relative_path = str(asset.get("relative_path") or "")
                metadata_entry = asset_lookup.get(relative_path) or {}
                connection.execute(
                    """
                    INSERT INTO reference_assets (
                      entity_key, item_id, asset_key, role, type, relative_path, source_url,
                      local_path, content_type, alt, downloaded_at, checked_at, status,
                      size_bytes, owners_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        entity_key,
                        item_id,
                        asset_key,
                        asset.get("role"),
                        asset.get("type"),
                        relative_path,
                        asset.get("source_url"),
                        metadata_entry.get("local_path"),
                        asset.get("content_type"),
                        asset.get("alt"),
                        metadata_entry.get("downloaded_at"),
                        metadata_entry.get("checked_at"),
                        metadata_entry.get("status"),
                        metadata_entry.get("size_bytes"),
                        encode_json(metadata_entry.get("owners") or []),
                    ),
                )


def _insert_filter_values(
    connection: sqlite3.Connection,
    entity_key: str,
    item_id: str,
    filters: dict[str, Any],
) -> None:
    for filter_key, raw_values in (filters or {}).items():
        for filter_value in as_array(raw_values):
            if filter_value is None or str(filter_value).strip() == "":
                continue
            connection.execute(
                """
                INSERT OR IGNORE INTO entity_filter_values (entity_key, item_id, filter_key, filter_value)
                VALUES (?, ?, ?, ?)
                """,
                (entity_key, item_id, filter_key, str(filter_value)),
            )


def _insert_characters(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    aptitude_orders = {
        "surface": {"turf": 1, "dirt": 2},
        "distance": {"short": 1, "mile": 2, "medium": 3, "long": 4},
        "style": {"runner": 1, "leader": 2, "betweener": 3, "chaser": 4},
    }
    stat_order = {"speed": 1, "stamina": 2, "power": 3, "guts": 4, "wit": 5}

    for item in as_array(dataset.get("items")):
        badges = convert_display_label_list(
            as_array(item.get("viable_aptitudes", {}).get("surface"))
            + as_array(item.get("viable_aptitudes", {}).get("distance"))
            + as_array(item.get("viable_aptitudes", {}).get("style")),
            APTITUDE_DISPLAY_LABELS,
        )
        subtitle = f"{item.get('variant')} | {item['rarity']}-star"
        filters = OrderedDict(
            [
                ("rarity", str(item["rarity"])),
                ("surface", as_array(item.get("viable_aptitudes", {}).get("surface"))),
                ("distance", as_array(item.get("viable_aptitudes", {}).get("distance"))),
                ("style", as_array(item.get("viable_aptitudes", {}).get("style"))),
                ("availability_en", "available" if item.get("release", {}).get("en") is not None else "unreleased"),
            ]
        )
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                item.get("variant"),
                item.get("titles", {}).get("en"),
                badges,
            ]
        )

        connection.execute(
            """
            INSERT INTO characters (
              id, card_id, base_character_id, url_name, base_url_name, name, name_en, name_ja,
              variant, title_en, rarity, obtained, release_jp, release_en, availability_en,
              title, subtitle, badges_json, media_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["card_id"]),
                int(item["base_character_id"]),
                item.get("url_name"),
                item.get("base_url_name"),
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                item.get("variant"),
                item.get("titles", {}).get("en"),
                int(item["rarity"]),
                item.get("obtained"),
                item.get("release", {}).get("jp"),
                item.get("release", {}).get("en"),
                availability_int(item.get("release", {}).get("en")),
                item.get("name"),
                subtitle,
                encode_json(badges),
                encode_json(item.get("assets") or {}),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "characters", str(item["id"]), filters)

        for category in ("surface", "distance", "style"):
            viable = set(as_array(item.get("viable_aptitudes", {}).get(category)))
            for aptitude_key, grade in (item.get("aptitudes", {}).get(category) or {}).items():
                connection.execute(
                    """
                    INSERT INTO character_aptitudes (
                      character_id, category, aptitude_key, aptitude_label, grade, is_viable, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(item["id"]),
                        category,
                        aptitude_key,
                        convert_display_label(aptitude_key, APTITUDE_DISPLAY_LABELS),
                        str(grade),
                        1 if aptitude_key in viable else 0,
                        aptitude_orders[category].get(aptitude_key, 99),
                    ),
                )

        for stat_key, stat_value in (item.get("stat_bonus") or {}).items():
            connection.execute(
                """
                INSERT INTO character_stat_bonuses (character_id, stat_key, stat_value, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (str(item["id"]), stat_key, int(stat_value), stat_order.get(stat_key, 99)),
            )

        for tier_key, tier_values in (item.get("stats") or {}).items():
            for stat_key, stat_value in (tier_values or {}).items():
                connection.execute(
                    """
                    INSERT INTO character_stats (character_id, tier, stat_key, stat_value, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (str(item["id"]), tier_key, stat_key, int(stat_value), stat_order.get(stat_key, 99)),
                )

        skill_links = item.get("skill_links") or {}
        for link_type in ("unique", "innate", "awakening", "event"):
            for slot_index, skill in enumerate(as_array(skill_links.get(link_type))):
                connection.execute(
                    """
                    INSERT INTO character_skill_links (
                      character_id, link_type, slot_index, skill_id, linked_skill_id,
                      skill_name, linked_skill_name, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(item["id"]),
                        link_type,
                        slot_index,
                        str(skill.get("id")) if skill and skill.get("id") is not None else None,
                        None,
                        skill.get("name") if skill else None,
                        None,
                        encode_json(skill),
                    ),
                )

        for slot_index, evolution in enumerate(as_array(skill_links.get("evolution"))):
            previous_skill = (evolution or {}).get("from") or {}
            next_skill = (evolution or {}).get("to") or {}
            connection.execute(
                """
                INSERT INTO character_skill_links (
                  character_id, link_type, slot_index, skill_id, linked_skill_id,
                  skill_name, linked_skill_name, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    "evolution",
                    slot_index,
                    str(previous_skill.get("id")) if previous_skill.get("id") is not None else None,
                    str(next_skill.get("id")) if next_skill.get("id") is not None else None,
                    previous_skill.get("name"),
                    next_skill.get("name"),
                    encode_json(evolution),
                ),
            )


def _insert_character_progression(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        character_id = str(item.get("id") or "")
        if not character_id:
            continue

        connection.execute(
            """
            INSERT INTO character_progression (
              character_id, card_id, base_character_id, talent_group_id, awakening_skill_count, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                character_id,
                int(item.get("card_id") or 0),
                int(item.get("base_character_id") or 0),
                int(item.get("talent_group_id") or 0) if item.get("talent_group_id") is not None else None,
                int(item.get("awakening_skill_count") or 0),
                encode_json(item),
            ),
        )

        for level in as_array(item.get("awakening_levels")):
            skill = level.get("skill") or {}
            connection.execute(
                """
                INSERT INTO character_progression_levels (
                  character_id, awakening_level, linked_skill_id, linked_skill_name, costs_json, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    character_id,
                    int(level.get("awakening_level") or level.get("talent_level") or 0),
                    str(skill.get("id")) if skill.get("id") is not None else None,
                    skill.get("name"),
                    encode_json(level.get("costs") or []),
                    encode_json(level),
                ),
            )


def _insert_supports(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for effect in as_array(dataset.get("effect_catalog")):
        connection.execute(
            """
            INSERT INTO support_effect_catalog (effect_id, name, description, calc, symbol, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                int(effect["effect_id"]),
                effect.get("name"),
                effect.get("description"),
                effect.get("calc"),
                effect.get("symbol"),
                encode_json(effect),
            ),
        )

    for item in as_array(dataset.get("items")):
        badges = [effect.get("name") for effect in as_array(item.get("effects"))[:4] if effect and effect.get("name")]
        subtitle = f"{item.get('type')} | {RARITY_LABELS.get(str(item['rarity']), item['rarity'])}"
        filters = OrderedDict(
            [
                ("type", item.get("type")),
                ("rarity", str(item["rarity"])),
                ("obtained", item.get("obtained")),
                ("availability_en", "available" if item.get("release", {}).get("en") is not None else "unreleased"),
            ]
        )
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("ja"),
                item.get("type"),
                item.get("obtained"),
                [skill.get("name") for skill in as_array(item.get("hint_skills"))],
            ]
        )

        connection.execute(
            """
            INSERT INTO supports (
              id, support_id, character_id, url_name, name, name_en, name_ja, type, rarity,
              obtained, release_jp, release_en, availability_en, title, subtitle, badges_json,
              media_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["support_id"]),
                int(item["character_id"]),
                item.get("url_name"),
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                item.get("type"),
                int(item["rarity"]),
                item.get("obtained"),
                item.get("release", {}).get("jp"),
                item.get("release", {}).get("en"),
                availability_int(item.get("release", {}).get("en")),
                item.get("name"),
                subtitle,
                encode_json(badges),
                encode_json(item.get("assets") or {}),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "supports", str(item["id"]), filters)

        for slot_index, effect in enumerate(as_array(item.get("effects"))):
            connection.execute(
                """
                INSERT INTO support_effects (
                  support_id, effect_scope, slot_index, effect_id, effect_name, level, description, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    "standard",
                    slot_index,
                    int(effect["effect_id"]) if effect.get("effect_id") is not None else None,
                    effect.get("name"),
                    int(effect["level"]) if effect.get("level") is not None else None,
                    effect.get("description"),
                    encode_json(effect),
                ),
            )

        for slot_index, effect in enumerate(as_array(item.get("unique_effects"))):
            connection.execute(
                """
                INSERT INTO support_effects (
                  support_id, effect_scope, slot_index, effect_id, effect_name, level, description, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    "unique",
                    slot_index,
                    int(effect["effect_id"]) if effect.get("effect_id") is not None else None,
                    effect.get("name"),
                    int(item["unique_effect_unlock_level"]) if item.get("unique_effect_unlock_level") is not None else None,
                    effect.get("description"),
                    encode_json(effect),
                ),
            )

        for link_type, skills in (("hint", item.get("hint_skills")), ("event", item.get("event_skills"))):
            for slot_index, skill in enumerate(as_array(skills)):
                connection.execute(
                    """
                    INSERT INTO support_skill_links (support_id, link_type, slot_index, skill_id, skill_name, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(item["id"]),
                        link_type,
                        slot_index,
                        str(skill.get("id")) if skill and skill.get("id") is not None else None,
                        skill.get("name") if skill else None,
                        encode_json(skill),
                    ),
                )

        for slot_index, effect in enumerate(as_array(item.get("hint_other_effects"))):
            hint_type = str(effect.get("hint_type")) if effect.get("hint_type") is not None else None
            connection.execute(
                """
                INSERT INTO support_hint_other_effects (
                  support_id, slot_index, hint_type, hint_value, display_label, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    hint_type,
                    int(effect["hint_value"]) if effect.get("hint_value") is not None else None,
                    SUPPORT_STAT_GAIN_LABELS.get(hint_type),
                    encode_json(effect),
                ),
            )


def _insert_support_progression(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        rarity = int(item.get("rarity") or 0)
        if rarity <= 0:
            continue

        connection.execute(
            """
            INSERT INTO support_progression (rarity, label, card_count, max_level, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                rarity,
                item.get("label"),
                int(item.get("card_count") or 0),
                int(item.get("max_level") or 0),
                encode_json(item),
            ),
        )

        for level in as_array(item.get("levels")):
            connection.execute(
                """
                INSERT INTO support_progression_levels (rarity, level, total_exp, curve_id)
                VALUES (?, ?, ?, ?)
                """,
                (
                    rarity,
                    int(level.get("level") or 0),
                    int(level.get("total_exp") or 0),
                    int(level.get("curve_id") or 0) if level.get("curve_id") is not None else None,
                ),
            )


def _insert_skills(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        badge_labels = convert_display_label_list(as_array(item.get("type_tags"))[:4], SKILL_TAG_DISPLAY_LABELS)
        search_labels = convert_display_label_list(item.get("type_tags"), SKILL_TAG_DISPLAY_LABELS)
        subtitle = f"Rarity {item['rarity']}"
        if item.get("cost") is not None:
            subtitle += f" | Cost {item['cost']}"
        filters = OrderedDict(
            [
                ("rarity", str(item["rarity"])),
                ("type_tags", item.get("type_tags")),
                ("has_cost", "yes" if item.get("cost") is not None else "no"),
                ("character_specific", "yes" if len(as_array(item.get("related_character_ids"))) > 0 else "no"),
            ]
        )
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("ja"),
                item.get("descriptions", {}).get("en"),
                item.get("type_tags"),
                item.get("localized_type_tags"),
                search_labels,
            ]
        )

        connection.execute(
            """
            INSERT INTO skills (
              id, skill_id, name, name_en, name_ja, rarity, cost, icon_id, activation,
              character_specific, title, subtitle, badges_json, media_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["skill_id"]),
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                int(item["rarity"]),
                int(item["cost"]) if item.get("cost") is not None else None,
                int(item["icon_id"]) if item.get("icon_id") is not None else None,
                item.get("activation"),
                1 if len(as_array(item.get("related_character_ids"))) > 0 else 0,
                item.get("name"),
                subtitle,
                encode_json(badge_labels),
                encode_json(item.get("assets") or {}),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "skills", str(item["id"]), filters)

        for slot_index, tag in enumerate(as_array(item.get("type_tags"))):
            connection.execute(
                """
                INSERT INTO skill_tags (skill_id, slot_index, tag_value, display_label)
                VALUES (?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    str(tag),
                    convert_display_label(str(tag), SKILL_TAG_DISPLAY_LABELS) or str(tag),
                ),
            )

        for slot_index, character_id in enumerate(as_array(item.get("related_character_ids"))):
            connection.execute(
                """
                INSERT INTO skill_related_characters (skill_id, slot_index, character_id)
                VALUES (?, ?, ?)
                """,
                (str(item["id"]), slot_index, str(character_id)),
            )

        for slot_index, group in enumerate(as_array(item.get("condition_groups"))):
            connection.execute(
                """
                INSERT INTO skill_condition_groups (skill_id, scope, slot_index, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                (str(item["id"]), "base", slot_index, encode_json(group)),
            )

        gene_version = item.get("gene_version")
        if gene_version:
            for slot_index, group in enumerate(as_array(gene_version.get("condition_groups"))):
                connection.execute(
                    """
                    INSERT INTO skill_condition_groups (skill_id, scope, slot_index, payload_json)
                    VALUES (?, ?, ?, ?)
                    """,
                    (str(item["id"]), "gene_version", slot_index, encode_json(group)),
                )


def _insert_races(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        filters = OrderedDict(
            [
                ("track_name", item.get("track_name")),
                ("surface", item.get("surface")),
                ("distance", item.get("distance_category")),
                ("direction", item.get("direction")),
                ("season", item.get("season")),
                ("time_of_day", item.get("time_of_day")),
                ("grade", item.get("grade")),
            ]
        )
        badges = [item.get("surface"), item.get("distance_category"), item.get("direction")]
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("ja"),
                item.get("track_name"),
                item.get("grade"),
                item.get("factor_summary"),
            ]
        )

        connection.execute(
            """
            INSERT INTO races (
              id, race_instance_id, race_id, url_name, name, name_en, name_ja, track_id, track_name,
              track_slug, course_id, banner_id, surface, surface_slug, distance_m, distance_category,
              direction, season, time_of_day, grade, title, subtitle, badges_json, media_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["race_instance_id"]),
                int(item["race_id"]),
                item.get("url_name"),
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                item.get("track_id"),
                item.get("track_name"),
                item.get("track_slug"),
                int(item["course_id"]) if item.get("course_id") is not None else None,
                int(item["banner_id"]) if item.get("banner_id") is not None else None,
                item.get("surface"),
                item.get("surface_slug"),
                int(item["distance_m"]) if item.get("distance_m") is not None else None,
                item.get("distance_category"),
                item.get("direction"),
                item.get("season"),
                item.get("time_of_day"),
                item.get("grade"),
                item.get("name"),
                f"{item.get('track_name')} | {item.get('grade')} | {item.get('distance_m')}m",
                encode_json([badge for badge in badges if badge]),
                encode_json(item.get("assets") or {}),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "races", str(item["id"]), filters)


def _insert_racetracks(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        filters = OrderedDict(
            [
                ("track_name", item.get("track_name")),
                ("surface", item.get("surface")),
                ("distance", item.get("distance_category")),
                ("turn", item.get("turn")),
                ("layout", item.get("layout")),
                ("has_slopes", "yes" if item.get("has_slopes") else "no"),
            ]
        )
        search_text = join_search_text(
            [
                item.get("track_name"),
                item.get("course_id"),
                item.get("surface"),
                item.get("distance_category"),
                item.get("turn"),
                item.get("layout"),
            ]
        )
        badges = [item.get("turn"), item.get("layout"), f"Corners {item.get('corner_count')}"]

        connection.execute(
            """
            INSERT INTO racetracks (
              id, course_id, track_id, track_name, track_slug, surface, surface_slug, distance_category,
              distance_category_slug, length_m, turn, turn_slug, layout, layout_slug, corner_count,
              straight_count, uphill_count, downhill_count, has_slopes, title, subtitle, badges_json,
              search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["course_id"]),
                item.get("track_id"),
                item.get("track_name"),
                item.get("track_slug"),
                item.get("surface"),
                item.get("surface_slug"),
                item.get("distance_category"),
                item.get("distance_category_slug"),
                int(item["length_m"]) if item.get("length_m") is not None else None,
                item.get("turn"),
                item.get("turn_slug"),
                item.get("layout"),
                item.get("layout_slug"),
                int(item["corner_count"]) if item.get("corner_count") is not None else None,
                int(item["straight_count"]) if item.get("straight_count") is not None else None,
                int(item["uphill_count"]) if item.get("uphill_count") is not None else None,
                int(item["downhill_count"]) if item.get("downhill_count") is not None else None,
                bool_int(item.get("has_slopes")),
                f"{item.get('track_name')} #{item.get('course_id')}",
                f"{item.get('surface')} | {item.get('distance_category')} | {item.get('length_m')}m",
                encode_json([badge for badge in badges if badge]),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "racetracks", str(item["id"]), filters)


def _insert_g1_factors(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        filters = OrderedDict(
            [
                ("track_name", item.get("track_names")),
                ("surface", item.get("surfaces")),
                ("distance", item.get("distance_categories")),
                ("effect", item.get("effect_summary")),
            ]
        )
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("ja"),
                item.get("effect_summary"),
                item.get("track_names"),
            ]
        )

        connection.execute(
            """
            INSERT INTO g1_factors (
              id, factor_id, race_id, factor_type, name, name_en, name_ja, title, subtitle,
              badges_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                str(item["factor_id"]),
                str(item["race_id"]),
                int(item["factor_type"]) if item.get("factor_type") is not None else None,
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                item.get("name"),
                f"Race spark | Race ID {item.get('race_id')}",
                encode_json(as_array(item.get("effect_summary"))[:3]),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "g1_factors", str(item["id"]), filters)

        for slot_index, race in enumerate(as_array(item.get("related_races"))):
            connection.execute(
                """
                INSERT INTO g1_factor_related_races (
                  factor_id, slot_index, race_instance_id, name, track_name, surface,
                  distance_m, grade, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    int(race["race_instance_id"]) if race.get("race_instance_id") is not None else None,
                    race.get("name"),
                    race.get("track_name"),
                    race.get("surface"),
                    int(race["distance_m"]) if race.get("distance_m") is not None else None,
                    race.get("grade"),
                    encode_json(race),
                ),
            )


def _insert_cm_targets(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        race_profile = item.get("race_profile") or {}
        filters = OrderedDict(
            [
                ("track_name", race_profile.get("track_name")),
                ("surface", race_profile.get("surface")),
                ("distance", race_profile.get("distance_category")),
                ("direction", race_profile.get("direction")),
                ("season", race_profile.get("season")),
                ("weather", race_profile.get("weather")),
                ("condition", race_profile.get("condition")),
            ]
        )
        badges = [race_profile.get("surface"), race_profile.get("distance_category"), race_profile.get("direction")]
        subtitle = f"{race_profile.get('track_name')} | {race_profile.get('distance_m')}m | {race_profile.get('season')}"
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("ja"),
                race_profile.get("track_name"),
                race_profile.get("surface"),
                race_profile.get("distance_category"),
                race_profile.get("direction"),
                race_profile.get("season"),
                race_profile.get("weather"),
                race_profile.get("condition"),
            ]
        )

        connection.execute(
            """
            INSERT INTO cm_targets (
              id, cm_id, resource_id, slug, name, name_en, name_ja, start_at, end_at, start_ts, end_ts,
              track_id, track_name, track_slug, surface, surface_slug, distance_m, distance_category,
              distance_category_slug, direction, direction_slug, season, season_slug, weather, weather_slug,
              condition, condition_slug, title, subtitle, badges_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["cm_id"]),
                int(item["resource_id"]) if item.get("resource_id") is not None else None,
                item.get("slug"),
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                item.get("start_at"),
                item.get("end_at"),
                int(item["start_ts"]) if item.get("start_ts") is not None else None,
                int(item["end_ts"]) if item.get("end_ts") is not None else None,
                race_profile.get("track_id"),
                race_profile.get("track_name"),
                race_profile.get("track_slug"),
                race_profile.get("surface"),
                race_profile.get("surface_slug"),
                int(race_profile["distance_m"]) if race_profile.get("distance_m") is not None else None,
                race_profile.get("distance_category"),
                race_profile.get("distance_category_slug"),
                race_profile.get("direction"),
                race_profile.get("direction_slug"),
                race_profile.get("season"),
                race_profile.get("season_slug"),
                race_profile.get("weather"),
                race_profile.get("weather_slug"),
                race_profile.get("condition"),
                race_profile.get("condition_slug"),
                item.get("name"),
                subtitle,
                encode_json([badge for badge in badges if badge]),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "cm_targets", str(item["id"]), filters)

        for relation_type in ("related_races", "related_racetracks"):
            for slot_index, related in enumerate(as_array(item.get(relation_type))):
                connection.execute(
                    """
                    INSERT INTO cm_target_related_entities (
                      cm_target_id, relation_type, slot_index, entity_key, entity_id, title, subtitle, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(item["id"]),
                        relation_type,
                        slot_index,
                        related.get("entityKey"),
                        related.get("id"),
                        related.get("title"),
                        related.get("subtitle"),
                        encode_json(related),
                    ),
                )


def _insert_scenarios(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    stat_order = {"speed": 1, "stamina": 2, "power": 3, "guts": 4, "wit": 5}
    for item in as_array(dataset.get("items")):
        filters = OrderedDict(
            [
                ("program", item.get("program_label")),
                ("scenario_key", item.get("key")),
                ("factor_effect", item.get("factor_effects")),
            ]
        )
        subtitle = f"{item.get('program_label') or 'Program -'} | {len(as_array(item.get('factors')))} factor(s)"
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("key"),
                item.get("program_label"),
                item.get("factor_effects"),
                [factor.get("name") for factor in as_array(item.get("factors"))],
            ]
        )

        connection.execute(
            """
            INSERT INTO scenarios (
              id, scenario_id, scenario_key, slug, name, order_index, program, program_label,
              title, subtitle, badges_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["scenario_id"]),
                item.get("key"),
                item.get("slug"),
                item.get("name"),
                int(item["order"]) if item.get("order") is not None else None,
                int(item["program"]) if item.get("program") is not None else None,
                item.get("program_label"),
                item.get("name"),
                subtitle,
                encode_json(as_array(item.get("factor_effects"))[:4]),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "scenarios", str(item["id"]), filters)

        for stat_key, stat_value in (item.get("stat_caps") or {}).items():
            connection.execute(
                """
                INSERT INTO scenario_stat_caps (scenario_id, stat_key, stat_value, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    stat_key,
                    int(stat_value),
                    stat_order.get(stat_key, 99),
                ),
            )

        for slot_index, factor in enumerate(as_array(item.get("factors"))):
            connection.execute(
                """
                INSERT INTO scenario_factors (scenario_id, slot_index, factor_id, name, effects_json, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    int(factor["id"]) if factor.get("id") is not None else None,
                    factor.get("name"),
                    encode_json(as_array(factor.get("effects"))),
                    encode_json(factor),
                ),
            )


def _insert_training_events(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        linked_characters = [entry.get("title") for entry in as_array(item.get("linked_entities")) if entry.get("entityKey") == "characters"]
        linked_supports = [entry.get("title") for entry in as_array(item.get("linked_entities")) if entry.get("entityKey") == "supports"]
        linked_scenarios = [entry.get("title") for entry in as_array(item.get("linked_entities")) if entry.get("entityKey") == "scenarios"]
        filters = OrderedDict(
            [
                ("event_source", item.get("event_source")),
                ("linked_character", linked_characters),
                ("linked_support", linked_supports),
                ("linked_scenario", linked_scenarios),
                ("has_branching", "yes" if item.get("has_branching") else "no"),
            ]
        )
        badges = [item.get("source_label"), "Branching" if item.get("has_branching") else None, f"{item.get('choice_count')} choice(s)"]
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("subtitle"),
                item.get("event_source"),
                item.get("source_label"),
                item.get("event_id"),
                linked_characters,
                linked_supports,
                linked_scenarios,
            ]
        )

        connection.execute(
            """
            INSERT INTO training_events (
              id, event_source, source_label, owner_id, event_id, group_index, sequence_index, name, name_source,
              linked_support_id, linked_scenario_id, choice_count, has_branching, title, subtitle, badges_json,
              search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                item.get("event_source"),
                item.get("source_label"),
                str(item.get("owner_id")),
                str(item.get("event_id")),
                int(item["group_index"]),
                int(item["sequence_index"]),
                item.get("name"),
                item.get("name_source"),
                item.get("linked_support_id"),
                item.get("linked_scenario_id"),
                int(item.get("choice_count") or 0),
                bool_int(item.get("has_branching")),
                item.get("title") or item.get("name"),
                item.get("subtitle"),
                encode_json([badge for badge in badges if badge]),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "training_events", str(item["id"]), filters)

        for slot_index, linked in enumerate(as_array(item.get("linked_entities"))):
            connection.execute(
                """
                INSERT INTO training_event_linked_entities (
                  training_event_id, slot_index, entity_key, entity_id, title, subtitle, availability_en, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    linked.get("entityKey"),
                    linked.get("id"),
                    linked.get("title"),
                    linked.get("subtitle"),
                    linked.get("availabilityEn"),
                    encode_json(linked),
                ),
            )

        for slot_index, choice in enumerate(as_array(item.get("choices"))):
            connection.execute(
                """
                INSERT INTO training_event_choices (
                  training_event_id, slot_index, choice_token, choice_label, effect_count, effect_tokens_json, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    str(choice.get("choice_token")) if choice.get("choice_token") is not None else None,
                    choice.get("choice_label"),
                    int(choice.get("effect_count") or 0),
                    encode_json(as_array(choice.get("effect_tokens"))),
                    encode_json(choice),
                ),
            )


def _insert_compatibility(connection: sqlite3.Connection, dataset: dict[str, Any]) -> None:
    for item in as_array(dataset.get("items")):
        top_matches = as_array(item.get("top_matches"))
        top_score = int(top_matches[0]["base_points"]) if top_matches else 0
        score_band = score_band_for_value(top_score)
        filters = OrderedDict(
            [
                ("availability_en", "available" if item.get("available", {}).get("en") else "unreleased"),
                ("score_band", score_band),
            ]
        )
        search_text = join_search_text(
            [
                item.get("name"),
                item.get("names", {}).get("ja"),
                [variant.get("variant") for variant in as_array(item.get("variants"))],
            ]
        )

        connection.execute(
            """
            INSERT INTO compatibility (
              id, character_id, name, name_en, name_ja, variant_count, available_en, top_score,
              score_band, title, subtitle, badges_json, search_text, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item["id"]),
                int(item["character_id"]),
                item.get("name"),
                item.get("names", {}).get("en"),
                item.get("names", {}).get("ja"),
                int(item["variant_count"]),
                bool_int(item.get("available", {}).get("en")),
                top_score,
                score_band,
                item.get("name"),
                f"Variants {item.get('variant_count')} | Best base score {top_score}",
                encode_json([score_band]),
                search_text,
                encode_json(item),
            ),
        )
        _insert_filter_values(connection, "compatibility", str(item["id"]), filters)

        for slot_index, variant in enumerate(as_array(item.get("variants"))):
            connection.execute(
                """
                INSERT INTO compatibility_variants (
                  compatibility_id, slot_index, card_id, name, variant, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    int(variant["card_id"]) if variant.get("card_id") is not None else None,
                    variant.get("name"),
                    variant.get("variant"),
                    encode_json(variant),
                ),
            )

        for slot_index, match in enumerate(top_matches):
            connection.execute(
                """
                INSERT INTO compatibility_top_matches (
                  compatibility_id, slot_index, character_id, name, base_points,
                  shared_relation_count, available_en, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    slot_index,
                    int(match["character_id"]),
                    match.get("name"),
                    int(match["base_points"]),
                    int(match["shared_relation_count"]),
                    bool_int(match.get("available_en")),
                    encode_json(match),
                ),
            )

        for group_index, group in enumerate(as_array(item.get("relation_groups"))):
            connection.execute(
                """
                INSERT INTO compatibility_relation_groups (
                  compatibility_id, group_index, relation_type, relation_point,
                  member_count, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(item["id"]),
                    group_index,
                    str(group.get("relation_type")),
                    int(group["relation_point"]),
                    int(group["member_count"]),
                    encode_json(group),
                ),
            )
            for slot_index, other_character_id in enumerate(as_array(group.get("other_character_ids"))):
                connection.execute(
                    """
                    INSERT INTO compatibility_relation_group_members (
                      compatibility_id, group_index, slot_index, other_character_id
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        str(item["id"]),
                        group_index,
                        slot_index,
                        int(other_character_id),
                    ),
                )
ProgressCallback = Callable[[dict[str, Any]], None]
