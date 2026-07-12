import unittest

from . import _pathsetup  # noqa: F401  (must run before importing lib.gametora_reference)

from lib import gametora_reference as gt


class DistanceCategoryTests(unittest.TestCase):
    def test_short_boundary(self):
        self.assertEqual(gt.get_distance_category_label(1400), "Short")
        self.assertEqual(gt.get_distance_category_label(1401), "Mile")

    def test_mile_boundary(self):
        self.assertEqual(gt.get_distance_category_label(1800), "Mile")
        self.assertEqual(gt.get_distance_category_label(1801), "Medium")

    def test_medium_boundary(self):
        self.assertEqual(gt.get_distance_category_label(2400), "Medium")
        self.assertEqual(gt.get_distance_category_label(2401), "Long")

    def test_varies_sentinel(self):
        self.assertEqual(gt.get_distance_category_label(99999), "Varies")

    def test_slug_matches_label_casing(self):
        self.assertEqual(gt.get_distance_category_slug(1200), "short")
        self.assertEqual(gt.get_distance_category_slug(99999), "varies")

    def test_from_code_mapping(self):
        self.assertEqual(gt.get_distance_category_from_code(1), "Short")
        self.assertEqual(gt.get_distance_category_from_code(4), "Long")
        self.assertEqual(gt.get_distance_category_from_code(999), "Unknown")

    def test_slug_from_code_mapping(self):
        self.assertEqual(gt.get_distance_category_slug_from_code(2), "mile")
        self.assertEqual(gt.get_distance_category_slug_from_code(999), "unknown")


class CourseLayoutSlugTests(unittest.TestCase):
    def test_known_codes(self):
        self.assertEqual(gt.get_course_layout_slug(1), "main")
        self.assertEqual(gt.get_course_layout_slug(4), "outer-to-inner")
        self.assertEqual(gt.get_course_layout_slug(99999), "varies")

    def test_unknown_code_falls_back(self):
        self.assertEqual(gt.get_course_layout_slug(12345), "unknown")


class RaceGradeLabelTests(unittest.TestCase):
    def test_known_group_and_grade(self):
        self.assertEqual(gt.get_race_grade_label(1, 100), "G1")
        self.assertEqual(gt.get_race_grade_label(1, 400), "OP")

    def test_unknown_grade_in_known_group_falls_back(self):
        self.assertEqual(gt.get_race_grade_label(1, 999), "Unknown grade")


def make_source_config(entity_key="supports"):
    return {
        "sourceSite": "GameTora",
        "entities": [{"key": entity_key, "label": "Supports", "datasetKeys": [], "pageUrls": []}],
        "assets": {},
    }


def make_source_metadata():
    return {"datasets": {}}


def make_support_card(**overrides):
    card = {
        "support_id": 30098,
        "char_id": 1001,
        "char_name": "Special Week",
        "rarity": 3,
        "type": "speed",
        "hints": {},
    }
    card.update(overrides)
    return card


class NormalizeSupportsTests(unittest.TestCase):
    # GameTora started returning some cards' hint_others as a mix of flat hint
    # objects and nested lists of hint objects (e.g. support 30098) instead of
    # always-flat objects, which crashed normalize_supports with
    # AttributeError: 'list' object has no attribute 'get'. This pins the fix.
    def test_grouped_hint_others_are_flattened(self):
        card = make_support_card(
            hints={
                "hint_others": [
                    {"hint_type": 1, "hint_value": 5},
                    [{"hint_type": 2, "hint_value": 2}, {"hint_type": 3, "hint_value": 6}],
                ]
            }
        )
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        hint_effects = result["items"][0]["hint_other_effects"]
        self.assertEqual(
            hint_effects,
            [
                {"hint_type": 1, "hint_value": 5},
                {"hint_type": 2, "hint_value": 2},
                {"hint_type": 3, "hint_value": 6},
            ],
        )

    def test_non_dict_hint_entries_are_skipped(self):
        card = make_support_card(hints={"hint_others": [{"hint_type": 1, "hint_value": 5}, "garbage", 42, None]})
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        self.assertEqual(result["items"][0]["hint_other_effects"], [{"hint_type": 1, "hint_value": 5}])

    def test_missing_hints_produce_no_hint_effects(self):
        card = make_support_card(hints=None)
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        self.assertEqual(result["items"][0]["hint_other_effects"], [])

    def test_basic_item_shape_and_name_fallback(self):
        card = make_support_card(char_name=None, name_jp="スペシャルウィーク")
        result = gt.normalize_supports(make_source_config(), make_source_metadata(), [card], [], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "30098")
        self.assertEqual(item["support_id"], 30098)
        self.assertEqual(item["character_id"], 1001)
        self.assertEqual(item["rarity"], 3)
        self.assertEqual(item["name"], "スペシャルウィーク")


def make_character_card(**overrides):
    card = {
        "card_id": 100101,
        "char_id": 1001,
        "name_en": "Special Week",
        "title_en_gl": "[Special Dreamer]",
        "rarity": 3,
        # turf, dirt, short, mile, medium, long, runner, leader, betweener, chaser
        "aptitude": ["A", "G", "B", "A", "A", "C", "A", "B", "C", "D"],
        "stat_bonus": [10, 10, 5, 5, 0],
        "base_stats": [90, 80, 70, 60, 50],
        "four_star_stats": [100, 90, 80, 70, 60],
        "five_star_stats": [110, 100, 90, 80, 70],
    }
    card.update(overrides)
    return card


def make_base_character(**overrides):
    base = {
        "char_id": 1001,
        "url_name": "special-week",
        "sex": 2,
        "birth_month": 3,
        "birth_day": 2,
        "playable": True,
    }
    base.update(overrides)
    return base


class NormalizeCharactersTests(unittest.TestCase):
    def test_basic_item_shape(self):
        card = make_character_card()
        base = make_base_character()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [base], [card], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "100101")
        self.assertEqual(item["card_id"], 100101)
        self.assertEqual(item["base_character_id"], 1001)
        self.assertEqual(item["base_url_name"], "special-week")
        self.assertEqual(item["rarity"], 3)
        self.assertEqual(item["name"], "Special Week")

    def test_aptitude_grades_map_to_named_slots(self):
        card = make_character_card()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        aptitudes = result["items"][0]["aptitudes"]
        self.assertEqual(aptitudes["surface"], {"turf": "A", "dirt": "G"})
        self.assertEqual(aptitudes["distance"], {"short": "B", "mile": "A", "medium": "A", "long": "C"})
        self.assertEqual(aptitudes["style"], {"runner": "A", "leader": "B", "betweener": "C", "chaser": "D"})

    def test_viable_aptitudes_keep_only_a_grade_and_above(self):
        card = make_character_card()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        viable = result["items"][0]["viable_aptitudes"]
        self.assertEqual(viable["surface"], ["turf"])
        self.assertEqual(viable["distance"], ["mile", "medium"])
        self.assertEqual(viable["style"], ["runner"])

    # A card can reference a base_character_id that isn't in the base
    # characters dataset (e.g. datasets fetched slightly out of sync) — the
    # profile section must degrade to None fields instead of crashing.
    def test_missing_base_character_leaves_profile_fields_none(self):
        card = make_character_card(char_id=9999)
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        item = result["items"][0]
        self.assertIsNone(item["base_url_name"])
        self.assertEqual(
            item["profile"],
            {
                "birthday": None,
                "height_cm": None,
                "measurements": None,
                "sex": None,
                "race": None,
                "playable": None,
                "active": None,
                "voice_actor": None,
                "real_life": None,
            },
        )

    def test_profile_resolves_sex_and_birthday_from_base_character(self):
        card = make_character_card()
        result = gt.normalize_characters(make_source_config("characters"), make_source_metadata(), [make_base_character()], [card], [])
        profile = result["items"][0]["profile"]
        self.assertEqual(profile["sex"], "Stallion")
        self.assertEqual(profile["birthday"], "03-02")


class NormalizeTrainingEventChoicesTests(unittest.TestCase):
    def test_pair_form_splits_token_and_effect_tokens(self):
        result = gt.normalize_training_event_choices([["speed_up", ["stat_speed", "stat_power"]]])
        self.assertEqual(result[0]["choice_token"], "speed_up")
        self.assertEqual(result[0]["choice_label"], "Speed Up")
        self.assertEqual(result[0]["effect_tokens"], ["stat_speed", "stat_power"])
        self.assertEqual(result[0]["effect_count"], 2)

    def test_bare_scalar_choice_has_no_token_and_falls_back_to_choice_n_label(self):
        result = gt.normalize_training_event_choices(["stat_speed"])
        self.assertIsNone(result[0]["choice_token"])
        self.assertEqual(result[0]["choice_label"], "Choice 1")
        self.assertEqual(result[0]["effect_tokens"], ["stat_speed"])

    def test_index_increments_starting_at_one(self):
        result = gt.normalize_training_event_choices([["a", ["x"]], ["b", ["y"]]])
        self.assertEqual([entry["index"] for entry in result], [1, 2])

    def test_none_or_empty_choices_yield_an_empty_list(self):
        self.assertEqual(gt.normalize_training_event_choices(None), [])
        self.assertEqual(gt.normalize_training_event_choices([]), [])


class NormalizeCharacterProgressionTests(unittest.TestCase):
    def make_skills(self):
        return [
            {"id": "100", "name_en": "Skill A"},
            {"id": "101", "name_en": "Skill B"},
        ]

    def make_upgrade(self, talent_group_id, talent_level, **overrides):
        row = {
            "talent_group_id": talent_group_id,
            "talent_level": talent_level,
            "item_category_1": "material",
            "item_id_1": 5000,
            "item_num_1": 3,
        }
        row.update(overrides)
        return row

    def test_talent_group_falls_back_to_talent_group_id_then_card_id(self):
        card = {"card_id": 100101, "char_id": 1001}
        result = gt.normalize_character_progression(make_source_config("character_progression"), make_source_metadata(), [card], [], [])
        self.assertEqual(result["items"][0]["talent_group_id"], 100101)

    def test_awakening_levels_map_talent_level_to_skill_by_index(self):
        card = {"card_id": 100101, "char_id": 1001, "talent_group": 5, "skills_awakening": ["100", "101"], "name_en": "Special Week"}
        upgrades = [self.make_upgrade("5", 2), self.make_upgrade("5", 3)]
        result = gt.normalize_character_progression(make_source_config("character_progression"), make_source_metadata(), [card], upgrades, self.make_skills())
        item = result["items"][0]
        self.assertEqual(item["awakening_skill_count"], 2)
        levels = item["awakening_levels"]
        self.assertEqual([lvl["talent_level"] for lvl in levels], [2, 3])
        self.assertEqual(levels[0]["skill"]["name"], "Skill A")
        self.assertEqual(levels[1]["skill"]["name"], "Skill B")

    def test_awakening_level_beyond_available_skills_has_no_skill(self):
        card = {"card_id": 100101, "char_id": 1001, "talent_group": 5, "skills_awakening": ["100"]}
        upgrades = [self.make_upgrade("5", 2), self.make_upgrade("5", 3)]
        result = gt.normalize_character_progression(make_source_config("character_progression"), make_source_metadata(), [card], upgrades, self.make_skills())
        levels = result["items"][0]["awakening_levels"]
        self.assertIsNotNone(levels[0]["skill"])
        self.assertIsNone(levels[1]["skill"])

    def test_cost_slots_stop_once_all_three_fields_are_empty(self):
        upgrade = self.make_upgrade("5", 2, item_category_2=None, item_id_2=None, item_num_2=None)
        card = {"card_id": 100101, "char_id": 1001, "talent_group": 5}
        result = gt.normalize_character_progression(make_source_config("character_progression"), make_source_metadata(), [card], [upgrade], [])
        costs = result["items"][0]["awakening_levels"][0]["costs"]
        self.assertEqual(len(costs), 1)
        self.assertEqual(costs[0]["slot_index"], 1)

    def test_cards_without_a_card_id_are_skipped(self):
        result = gt.normalize_character_progression(make_source_config("character_progression"), make_source_metadata(), [{"char_id": 1001}], [], [])
        self.assertEqual(result["items"], [])


class NormalizeSupportProgressionTests(unittest.TestCase):
    def make_level_row(self, rarity, level, **overrides):
        row = {"id": rarity * 100 + level, "rarity": rarity, "level": level, "total_exp": level * 1000}
        row.update(overrides)
        return row

    def test_groups_levels_by_rarity_with_known_labels(self):
        cards = [{"rarity": 3}, {"rarity": 3}, {"rarity": 1}]
        levels = [self.make_level_row(3, 1), self.make_level_row(3, 2), self.make_level_row(1, 1)]
        result = gt.normalize_support_progression(make_source_config("support_progression"), make_source_metadata(), levels, cards)
        by_rarity = {item["rarity"]: item for item in result["items"]}
        self.assertEqual(by_rarity[3]["label"], "SSR")
        self.assertEqual(by_rarity[3]["card_count"], 2)
        self.assertEqual(by_rarity[3]["max_level"], 2)
        self.assertEqual(by_rarity[1]["label"], "R")

    def test_unknown_rarity_falls_back_to_r_prefixed_label(self):
        result = gt.normalize_support_progression(make_source_config("support_progression"), make_source_metadata(), [self.make_level_row(5, 1)], [])
        self.assertEqual(result["items"][0]["label"], "R5")

    def test_levels_are_sorted_ascending_regardless_of_input_order(self):
        levels = [self.make_level_row(3, 3), self.make_level_row(3, 1), self.make_level_row(3, 2)]
        result = gt.normalize_support_progression(make_source_config("support_progression"), make_source_metadata(), levels, [])
        self.assertEqual([lvl["level"] for lvl in result["items"][0]["levels"]], [1, 2, 3])

    def test_rows_with_non_positive_rarity_or_level_are_dropped(self):
        levels = [self.make_level_row(0, 1), self.make_level_row(3, 0)]
        result = gt.normalize_support_progression(make_source_config("support_progression"), make_source_metadata(), levels, [])
        self.assertEqual(result["items"], [])


def make_skill(**overrides):
    skill = {"id": 200452, "rarity": 1, "name_en": "Corner Recovery", "jpname": "コーナーリカバリー"}
    skill.update(overrides)
    return skill


class NormalizeSkillsTests(unittest.TestCase):
    def test_basic_item_shape_and_name_fallback_chain(self):
        skill = make_skill(name_en=None, enname="Corner Recovery EN", jpname="fallback")
        result = gt.normalize_skills(make_source_config("skills"), make_source_metadata(), [skill], [], [], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "200452")
        self.assertEqual(item["skill_id"], 200452)
        self.assertEqual(item["name"], "Corner Recovery EN")
        self.assertEqual(item["rarity"], 1)

    def test_cost_falls_back_to_gene_version_cost_when_missing(self):
        skill = make_skill(cost=None, gene_version={"cost": 120})
        result = gt.normalize_skills(make_source_config("skills"), make_source_metadata(), [skill], [], [], [])
        self.assertEqual(result["items"][0]["cost"], 120)

    def test_gene_version_is_none_when_absent(self):
        skill = make_skill(gene_version=None)
        result = gt.normalize_skills(make_source_config("skills"), make_source_metadata(), [skill], [], [], [])
        self.assertIsNone(result["items"][0]["gene_version"])

    def test_gene_version_is_expanded_when_present(self):
        skill = make_skill(
            gene_version={
                "id": 200453,
                "name_en": "Corner Recovery (Inherited)",
                "rarity": 2,
                "cost": 150,
                "inherited": True,
                "parent_skills": [200452],
            }
        )
        result = gt.normalize_skills(make_source_config("skills"), make_source_metadata(), [skill], [], [], [])
        gene_version = result["items"][0]["gene_version"]
        self.assertEqual(gene_version["name"], "Corner Recovery (Inherited)")
        self.assertEqual(gene_version["parent_skill_ids"], [200452])

    def test_icon_asset_is_built_only_when_iconid_is_present(self):
        config = make_source_config("skills")
        config["assetBaseUrl"] = "https://gametora.com"
        config["assets"] = {
            "skill_icon": {"role": "icon", "pathTemplate": "skills/{icon_id}.png", "urlTemplate": "/images/skills/utx_ico_skill_{icon_id}.png"},
        }
        with_icon = make_skill(iconid=99)
        without_icon = make_skill(id=200453, iconid=None)
        result = gt.normalize_skills(config, make_source_metadata(), [with_icon, without_icon], [], [], [])
        self.assertIsNotNone(result["items"][0]["assets"]["icon"])
        self.assertEqual(result["items"][0]["assets"]["icon"]["relative_path"], "skills/99.png")
        self.assertIsNone(result["items"][1]["assets"]["icon"])

    def test_effect_and_condition_reference_values_pass_through_at_top_level(self):
        result = gt.normalize_skills(make_source_config("skills"), make_source_metadata(), [make_skill()], {"a": 1}, {"b": 2}, [{"name": "season"}])
        self.assertEqual(result["references"]["effect_values"], {"a": 1})
        self.assertEqual(result["references"]["condition_values"], {"b": 2})
        self.assertEqual(result["references"]["condition_descriptions"], [{"name": "season"}])


def make_race(**overrides):
    race = {
        "id": 10001,
        "track": 99999,
        "race_id": 20001,
        "url_name": "test-race",
        "name_en": "Test Cup",
        "course_id": 101,
        "banner_id": None,
        "terrain": 1,
        "distance": 2000,
        "direction": 2,
        "season": 1,
        "time": 2,
        "entries": 18,
        "grade": 100,
        "group": 1,
        "course": "A",
        "list_ura": [],
        "factor": None,
    }
    race.update(overrides)
    return race


class NormalizeRacesTests(unittest.TestCase):
    def test_basic_item_shape_with_unknown_track_falls_back(self):
        result = gt.normalize_races(make_source_config("races"), make_source_metadata(), [make_race()], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "10001")
        self.assertEqual(item["race_id"], 20001)
        self.assertEqual(item["track_name"], "Unknown racetrack")
        self.assertEqual(item["surface"], "Turf")
        self.assertEqual(item["distance_category"], "Medium")
        self.assertEqual(item["direction"], "Left")
        self.assertEqual(item["season"], "Spring")
        self.assertEqual(item["time_of_day"], "Daytime")
        self.assertEqual(item["grade"], "G1")

    def test_factor_summary_collects_only_present_effects(self):
        result = gt.normalize_races(make_source_config("races"), make_source_metadata(), [make_race(factor={"effect_1": "Speed +10%"})], [])
        self.assertEqual(result["items"][0]["factor_summary"], ["Speed +10%"])

        result_both = gt.normalize_races(
            make_source_config("races"), make_source_metadata(), [make_race(factor={"effect_1": "Speed +10%", "effect_2": "Stamina +5%"})], []
        )
        self.assertEqual(result_both["items"][0]["factor_summary"], ["Speed +10%", "Stamina +5%"])

    def test_factor_summary_is_empty_without_a_factor(self):
        result = gt.normalize_races(make_source_config("races"), make_source_metadata(), [make_race(factor=None)], [])
        self.assertEqual(result["items"][0]["factor_summary"], [])

    def test_banner_asset_is_built_only_when_banner_id_is_present(self):
        config = make_source_config("races")
        config["assetBaseUrl"] = "https://gametora.com"
        config["assets"] = {
            "race_banner": {"role": "banner", "pathTemplate": "races/{banner_id}.png", "urlTemplate": "/images/races/{banner_id}.png"},
        }
        result = gt.normalize_races(config, make_source_metadata(), [make_race(banner_id=55), make_race(id=10002, banner_id=None)], [])
        self.assertEqual(result["items"][0]["banner_id"], 55)
        self.assertIsNotNone(result["items"][0]["assets"]["banner"])
        self.assertIsNone(result["items"][1]["assets"]["banner"])

    # A race with no banner (banner_id missing/None) used to crash normalize_races
    # with TypeError: int() argument must be ... not 'NoneType' - the plain
    # banner_id field called int() unconditionally while the assets.banner
    # descriptor a few lines below it already guarded the same value with
    # `if race.get("banner_id") is not None`. Pins the fix.
    def test_a_race_without_a_banner_does_not_crash_and_reports_a_null_banner_id(self):
        result = gt.normalize_races(make_source_config("races"), make_source_metadata(), [make_race(banner_id=None)], [])
        self.assertIsNone(result["items"][0]["banner_id"])

    def test_related_racetracks_matches_by_exact_course_id_not_track_attribute_heuristics(self):
        # Unlike cm_targets, a race carries an exact course_id - this is a
        # direct foreign-key lookup, so a race whose own `track` field
        # doesn't even match the racetrack's track id should still link,
        # as long as the course_id matches.
        track = {"id": 55, "courses": [make_racetrack_course(id=101)]}
        result = gt.normalize_races(make_source_config("races"), make_source_metadata(), [make_race(course_id=101, track=99999)], [track])
        related = result["items"][0]["related_racetracks"]
        self.assertEqual(len(related), 1)
        self.assertEqual(related[0]["entityKey"], "racetracks")
        self.assertEqual(related[0]["id"], "101")

    def test_related_racetracks_is_empty_when_no_course_matches(self):
        track = {"id": 55, "courses": [make_racetrack_course(id=999)]}
        result = gt.normalize_races(make_source_config("races"), make_source_metadata(), [make_race(course_id=101)], [track])
        self.assertEqual(result["items"][0]["related_racetracks"], [])


def make_racetrack_course(**overrides):
    course = {
        "id": 101,
        "terrain": 1,
        "distance": 2,
        "length": 2000,
        "turn": 2,
        "inout": 1,
        "corners": [],
        "straights": [],
        "slopes": [],
    }
    course.update(overrides)
    return course


class NormalizeRacetracksTests(unittest.TestCase):
    def test_basic_course_item_shape(self):
        track = {"id": 10, "courses": [make_racetrack_course()]}
        result = gt.normalize_racetracks(make_source_config("racetracks"), make_source_metadata(), [track])
        item = result["items"][0]
        self.assertEqual(item["id"], "101")
        self.assertEqual(item["track_id"], "10")
        self.assertEqual(item["track_name"], "Unknown racetrack")
        self.assertEqual(item["surface"], "Turf")
        self.assertEqual(item["distance_category"], "Mile")
        self.assertEqual(item["layout"], "Main")

    def test_multiple_courses_on_one_track_all_become_items(self):
        track = {"id": 10, "courses": [make_racetrack_course(id=101), make_racetrack_course(id=102)]}
        result = gt.normalize_racetracks(make_source_config("racetracks"), make_source_metadata(), [track])
        self.assertEqual([item["id"] for item in result["items"]], ["101", "102"])

    def test_uphill_and_downhill_counts_from_slope_signs(self):
        course = make_racetrack_course(slopes=[{"slope": 10}, {"slope": -5}, {"slope": 20}])
        track = {"id": 10, "courses": [course]}
        result = gt.normalize_racetracks(make_source_config("racetracks"), make_source_metadata(), [track])
        item = result["items"][0]
        self.assertEqual(item["uphill_count"], 2)
        self.assertEqual(item["downhill_count"], 1)
        self.assertTrue(item["has_slopes"])

    def test_no_slopes_means_zero_counts_and_has_slopes_false(self):
        track = {"id": 10, "courses": [make_racetrack_course(slopes=[])]}
        result = gt.normalize_racetracks(make_source_config("racetracks"), make_source_metadata(), [track])
        item = result["items"][0]
        self.assertEqual(item["uphill_count"], 0)
        self.assertEqual(item["downhill_count"], 0)
        self.assertFalse(item["has_slopes"])

    def test_corner_and_straight_counts_from_list_lengths(self):
        course = make_racetrack_course(corners=[{"a": 1}, {"a": 2}], straights=[{"b": 1}])
        track = {"id": 10, "courses": [course]}
        result = gt.normalize_racetracks(make_source_config("racetracks"), make_source_metadata(), [track])
        item = result["items"][0]
        self.assertEqual(item["corner_count"], 2)
        self.assertEqual(item["straight_count"], 1)


def make_g1_race(**overrides):
    race = {
        "id": 500,
        "race_id": 42,
        "track": 99999,
        "name_en": "Tokyo Yushun",
        "terrain": 1,
        "distance": 2400,
        "direction": 2,
        "season": 1,
        "time": 2,
        "group": 1,
        "grade": 100,
        "url_name": "tokyo-yushun",
        "list_ura": ["career_1"],
        "factor": None,
    }
    race.update(overrides)
    return race


def make_g1_factor(**overrides):
    factor = {"id": 900, "race_id": 42, "name_en": "Tokyo Yushun Aptitude", "type": 1, "effects": []}
    factor.update(overrides)
    return factor


class NormalizeG1FactorsTests(unittest.TestCase):
    def test_basic_item_shape_and_related_race_details(self):
        result = gt.normalize_g1_factors(
            make_source_config("g1_factors"), make_source_metadata(), {"race": [make_g1_factor()]}, [make_g1_race()], []
        )
        item = result["items"][0]
        self.assertEqual(item["id"], "900")
        self.assertEqual(item["race_id"], "42")
        self.assertEqual(item["name"], "Tokyo Yushun Aptitude")
        self.assertEqual(len(item["related_races"]), 1)
        self.assertEqual(item["related_races"][0]["name"], "Tokyo Yushun")
        self.assertEqual(item["career_years"], ["career_1"])
        self.assertEqual(item["surfaces"], ["turf"])
        self.assertEqual(item["distance_categories"], ["medium"])

    def test_factor_with_no_related_races_still_produces_an_item(self):
        result = gt.normalize_g1_factors(
            make_source_config("g1_factors"), make_source_metadata(), {"race": [make_g1_factor(race_id=999)]}, [make_g1_race()], []
        )
        item = result["items"][0]
        self.assertEqual(item["related_races"], [])
        self.assertEqual(item["career_years"], [])

    def test_effect_summary_collects_effect_2_before_effect_1_and_dedupes(self):
        races = [
            make_g1_race(id=1, factor={"effect_1": "Speed +10%", "effect_2": "Stamina +5%"}),
            make_g1_race(id=2, factor={"effect_1": "Speed +10%"}),
        ]
        result = gt.normalize_g1_factors(make_source_config("g1_factors"), make_source_metadata(), {"race": [make_g1_factor()]}, races, [])
        self.assertEqual(result["items"][0]["effect_summary"], ["Speed +10%", "Stamina +5%"])

    def test_effect_type_41_attaches_a_skill_reference(self):
        skills = [{"id": "200452", "name_en": "Corner Recovery"}]
        factor = make_g1_factor(effects=[{"type": 41, "value_1": ["200452"], "value_2": []}])
        result = gt.normalize_g1_factors(make_source_config("g1_factors"), make_source_metadata(), {"race": [factor]}, [], skills)
        detail = result["items"][0]["effect_details"][0]
        self.assertEqual(detail["skill"]["name"], "Corner Recovery")

    def test_other_effect_types_have_no_skill_key(self):
        factor = make_g1_factor(effects=[{"type": 1, "value_1": [10], "value_2": []}])
        result = gt.normalize_g1_factors(make_source_config("g1_factors"), make_source_metadata(), {"race": [factor]}, [], [])
        detail = result["items"][0]["effect_details"][0]
        self.assertNotIn("skill", detail)


def make_relation_member(relation_type, chara_id):
    return {"relation_type": relation_type, "chara_id": chara_id}


def make_base_character_row(char_id, **overrides):
    row = {"char_id": char_id, "en_name": f"Character {char_id}", "playable": True, "playable_en": True}
    row.update(overrides)
    return row


class NormalizeCompatibilityTests(unittest.TestCase):
    def test_two_characters_sharing_one_relation_become_mutual_top_matches(self):
        result = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [{"relation_type": "classmate", "relation_point": 10}],
            [make_relation_member("classmate", 1), make_relation_member("classmate", 2)],
            [make_base_character_row(1), make_base_character_row(2)],
            [],
        )
        by_id = {item["character_id"]: item for item in result["items"]}
        self.assertEqual(by_id[1]["top_matches"][0]["character_id"], 2)
        self.assertEqual(by_id[1]["top_matches"][0]["base_points"], 10)
        self.assertEqual(by_id[2]["top_matches"][0]["character_id"], 1)

    def test_multiple_shared_relation_types_sum_base_points(self):
        result = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [
                {"relation_type": "classmate", "relation_point": 10},
                {"relation_type": "rival", "relation_point": 5},
            ],
            [
                make_relation_member("classmate", 1),
                make_relation_member("classmate", 2),
                make_relation_member("rival", 1),
                make_relation_member("rival", 2),
            ],
            [make_base_character_row(1), make_base_character_row(2)],
            [],
        )
        by_id = {item["character_id"]: item for item in result["items"]}
        match = by_id[1]["top_matches"][0]
        self.assertEqual(match["base_points"], 15)
        self.assertEqual(match["shared_relation_count"], 2)
        self.assertEqual(sorted(match["shared_relation_types"]), ["classmate", "rival"])

    def test_max_pairwise_points_reflects_the_highest_scoring_pair(self):
        result = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [{"relation_type": "classmate", "relation_point": 30}],
            [make_relation_member("classmate", 1), make_relation_member("classmate", 2)],
            [make_base_character_row(1), make_base_character_row(2)],
            [],
        )
        self.assertEqual(result["model"]["max_pairwise_points"], 30)

    def test_variants_are_attached_and_counted_per_character(self):
        result = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [{"relation_type": "classmate", "relation_point": 10}],
            [make_relation_member("classmate", 1), make_relation_member("classmate", 2)],
            [make_base_character_row(1), make_base_character_row(2)],
            [{"card_id": 100101, "char_id": 1, "name_en": "Special Week", "title_en_gl": "[Dreamer]"}],
        )
        item = next(entry for entry in result["items"] if entry["character_id"] == 1)
        self.assertEqual(item["variant_count"], 1)
        self.assertEqual(item["variants"][0]["card_id"], 100101)

    # A character only shows up in the compatibility entity at all if it's a
    # member of at least one succession_relation group - char_groups/
    # pairs_by_char are both keyed off relation membership, never off having
    # variants. A character with zero relations (e.g. very recently added)
    # simply isn't in "items", regardless of how many card variants it has.
    def test_a_character_with_no_relations_at_all_produces_no_item(self):
        result = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [],
            [],
            [make_base_character_row(1)],
            [{"card_id": 100101, "char_id": 1, "name_en": "Special Week", "title_en_gl": "[Dreamer]"}],
        )
        self.assertEqual(result["items"], [])

    def test_relation_groups_are_sorted_by_point_then_member_count_then_type(self):
        result = gt.normalize_compatibility(
            make_source_config("compatibility"),
            make_source_metadata(),
            [
                {"relation_type": "rival", "relation_point": 5},
                {"relation_type": "classmate", "relation_point": 20},
            ],
            [
                make_relation_member("rival", 1),
                make_relation_member("rival", 2),
                make_relation_member("classmate", 1),
                make_relation_member("classmate", 2),
            ],
            [make_base_character_row(1), make_base_character_row(2)],
            [],
        )
        groups = next(item for item in result["items"] if item["character_id"] == 1)["relation_groups"]
        self.assertEqual([group["relation_type"] for group in groups], ["classmate", "rival"])


def make_cm_event(**overrides):
    event = {
        "id": 44,
        "resource_id": 900,
        "name_en": "44th Champions Meeting",
        "name": "第44回",
        "start": 1700000000,
        "end": 1700500000,
        "race": {"track": "10", "ground": 1, "distance": 2400, "turn": 2, "season": 1, "weather": 1, "condition": 1},
    }
    event.update(overrides)
    return event


def make_cm_race_candidate(**overrides):
    race = {"id": 500, "track": "10", "terrain": 1, "distance": 2400, "direction": 2, "season": 1, "name_en": "Tokyo Yushun", "group": 1, "grade": 100}
    race.update(overrides)
    return race


def make_cm_racetrack(**overrides):
    track = {"id": "10", "courses": [{"id": 101, "terrain": 1, "distance": 3, "turn": 2, "length": 2400}]}
    track.update(overrides)
    return track


class NormalizeCmTargetsTests(unittest.TestCase):
    def test_basic_item_shape(self):
        result = gt.normalize_cm_targets(make_source_config("cm_targets"), make_source_metadata(), [make_cm_event()], [], [])
        item = result["items"][0]
        self.assertEqual(item["id"], "cm_044")
        self.assertEqual(item["cm_id"], 44)
        self.assertEqual(item["resource_id"], 900)
        self.assertEqual(item["name"], "44th Champions Meeting")
        self.assertEqual(item["slug"], "44th-champions-meeting")
        self.assertTrue(item["start_at"].startswith("2023-11-14"))
        self.assertEqual(item["start_ts"], 1700000000)

    def test_missing_resource_id_and_timestamps_are_null_not_zero(self):
        event = make_cm_event(resource_id=None, start=None, end=None)
        result = gt.normalize_cm_targets(make_source_config("cm_targets"), make_source_metadata(), [event], [], [])
        item = result["items"][0]
        self.assertIsNone(item["resource_id"])
        self.assertIsNone(item["start_ts"])
        self.assertIsNone(item["start_at"])

    def test_race_profile_derives_labels_from_the_event_race(self):
        result = gt.normalize_cm_targets(make_source_config("cm_targets"), make_source_metadata(), [make_cm_event()], [], [])
        profile = result["items"][0]["race_profile"]
        self.assertEqual(profile["surface"], "Turf")
        self.assertEqual(profile["distance_category"], "Medium")
        self.assertEqual(profile["direction"], "Left")
        self.assertEqual(profile["season"], "Spring")

    def test_related_races_only_include_exact_criteria_matches(self):
        matching = make_cm_race_candidate(id=500)
        mismatched_distance = make_cm_race_candidate(id=501, distance=1600)
        result = gt.normalize_cm_targets(make_source_config("cm_targets"), make_source_metadata(), [make_cm_event()], [matching, mismatched_distance], [])
        related_ids = [race["id"] for race in result["items"][0]["related_races"]]
        self.assertEqual(related_ids, ["500"])

    def test_related_racetracks_only_include_courses_matching_the_race_profile(self):
        matching_track = make_cm_racetrack()
        mismatched_track = make_cm_racetrack(id="20", courses=[{"id": 201, "terrain": 2, "distance": 1, "turn": 2, "length": 1200}])
        result = gt.normalize_cm_targets(
            make_source_config("cm_targets"), make_source_metadata(), [make_cm_event()], [], [matching_track, mismatched_track]
        )
        related_ids = [track["id"] for track in result["items"][0]["related_racetracks"]]
        self.assertEqual(related_ids, ["101"])


def make_dynamic_scenario(**overrides):
    scenario = {"id": "10", "order": 1, "program": 2, "stats": [1200, 1150, 1000, 1000, 900], "name_en": "URA Finale", "start_en": 1750897800}
    scenario.update(overrides)
    return scenario


def make_static_scenario(**overrides):
    scenario = {
        "id": "10",
        "str": "scenario_ura",
        "factors": [{"id": 1, "name_en": "URA Speed Factor", "effect_1": "stat_speed_up", "effect_2": None}],
    }
    scenario.update(overrides)
    return scenario


class NormalizeScenariosTests(unittest.TestCase):
    def test_basic_item_shape_and_stat_caps(self):
        result = gt.normalize_scenarios(
            make_source_config("scenarios"), make_source_metadata(), [make_dynamic_scenario()], [make_static_scenario()], []
        )
        item = result["items"][0]
        self.assertEqual(item["id"], "10")
        self.assertEqual(item["scenario_id"], 10)
        self.assertEqual(item["key"], "scenario_ura")
        self.assertEqual(item["order"], 1)
        self.assertEqual(item["program"], 2)
        self.assertEqual(item["program_label"], "Program 2")
        self.assertEqual(item["stat_caps"], {"speed": 1200, "stamina": 1150, "power": 1000, "guts": 1000, "wit": 900})

    def test_global_name_and_release_are_carried_from_gametora(self):
        result = gt.normalize_scenarios(
            make_source_config("scenarios"), make_source_metadata(), [make_dynamic_scenario()], [make_static_scenario()], []
        )
        item = result["items"][0]
        self.assertEqual(item["name_en"], "URA Finale")
        self.assertEqual(item["start_en"], 1750897800)

    def test_start_en_is_null_for_a_scenario_not_yet_on_global(self):
        dynamic = make_dynamic_scenario(start_en=None)
        result = gt.normalize_scenarios(make_source_config("scenarios"), make_source_metadata(), [dynamic], [make_static_scenario()], [])
        self.assertIsNone(result["items"][0]["start_en"])

    def test_order_and_program_are_null_when_absent_from_dynamic_data(self):
        dynamic = make_dynamic_scenario(order=None, program=None)
        result = gt.normalize_scenarios(make_source_config("scenarios"), make_source_metadata(), [dynamic], [make_static_scenario()], [])
        item = result["items"][0]
        self.assertIsNone(item["order"])
        self.assertIsNone(item["program"])
        self.assertIsNone(item["program_label"])

    def test_factors_prefer_static_over_the_scenario_factors_fallback(self):
        fallback_factors = [{"id": 2, "name_en": "Fallback Factor", "effect_1": "fallback"}]
        result = gt.normalize_scenarios(
            make_source_config("scenarios"),
            make_source_metadata(),
            [make_dynamic_scenario()],
            [make_static_scenario()],
            [{"id": "10", "factors": fallback_factors}],
        )
        self.assertEqual(result["items"][0]["factors"][0]["name"], "URA Speed Factor")

    def test_falls_back_to_scenario_factors_when_static_has_none(self):
        static_without_factors = make_static_scenario(factors=[])
        fallback_factors = [{"id": 2, "name_en": "Fallback Factor", "effect_1": "fallback_effect"}]
        result = gt.normalize_scenarios(
            make_source_config("scenarios"),
            make_source_metadata(),
            [make_dynamic_scenario()],
            [static_without_factors],
            [{"id": "10", "factors": fallback_factors}],
        )
        self.assertEqual(result["items"][0]["factors"][0]["name"], "Fallback Factor")

    def test_a_scenario_present_only_in_the_factor_lookup_still_gets_an_item(self):
        result = gt.normalize_scenarios(make_source_config("scenarios"), make_source_metadata(), [], [], [{"id": "99", "factors": []}])
        self.assertEqual(result["items"][0]["id"], "99")


def make_te_event(event_id, *, choice_token="intro", choices=None, extras=None):
    entry = [choice_token, choices or [["speed_up", ["stat_speed"]]], str(event_id)]
    if extras:
        entry.extend(extras)
    return entry


def make_te_row(owner_id, *segments):
    return [owner_id, *segments]


def make_te_character_card(**overrides):
    card = {"card_id": 100101, "char_id": 1001, "name_en": "Special Week", "title_en_gl": "[Dreamer]", "rarity": 3, "release_en": True}
    card.update(overrides)
    return card


def make_te_support_card(**overrides):
    card = {"support_id": 30098, "char_name": "Special Week", "rarity": 3, "type": "speed", "release_en": True}
    card.update(overrides)
    return card


class NormalizeTrainingEventsTests(unittest.TestCase):
    def test_shared_source_links_all_character_cards_sharing_the_base_id(self):
        row = make_te_row("1001", [make_te_event(5001)], "unused_metadata_flag")
        datasets = {"shared": [row]}
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, [make_te_character_card()], [], []
        )
        item = result["items"][0]
        self.assertEqual(item["id"], "shared:1001:5001:1:1")
        self.assertEqual(item["event_source"], "shared")
        self.assertEqual(item["linked_character_ids"], ["100101"])
        self.assertEqual(item["choice_count"], 1)
        self.assertFalse(item["has_branching"])
        self.assertEqual(item["source_metadata"], ["unused_metadata_flag"])

    def test_char_card_source_links_a_single_card_by_card_id(self):
        row = make_te_row("100101", [make_te_event(5002)])
        datasets = {"char_card": [row]}
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, [make_te_character_card()], [], []
        )
        item = result["items"][0]
        self.assertEqual(item["event_source"], "char_card")
        self.assertEqual(item["linked_character_ids"], ["100101"])

    def test_friend_source_links_a_support_card_and_mentions_it_in_the_subtitle(self):
        row = make_te_row("30098", [make_te_event(5003)])
        datasets = {"friend": [row]}
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, [], [make_te_support_card()], []
        )
        item = result["items"][0]
        self.assertEqual(item["linked_support_id"], "30098")
        self.assertIn("Support 30098", item["subtitle"])

    def test_group_source_links_the_support_card_plus_its_member_characters(self):
        row = make_te_row("30098", [1001, 1002], [make_te_event(5004)])
        datasets = {"group": [row]}
        member_cards = [make_te_character_card(card_id=100101, char_id=1001), make_te_character_card(card_id=100201, char_id=1002, name_en="Silence Suzuka")]
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, member_cards, [make_te_support_card()], []
        )
        item = result["items"][0]
        self.assertEqual(item["linked_support_id"], "30098")
        self.assertEqual(sorted(item["linked_character_ids"]), ["100101", "100201"])
        self.assertEqual(len(item["group_member_character_refs"]), 2)

    def test_scenario_source_links_a_scenario_and_mentions_it_in_the_subtitle(self):
        row = make_te_row("10", [make_te_event(5005)])
        datasets = {"scenario": [row]}
        static_scenarios = [{"id": "10", "str": "scenario_ura", "factors": []}]
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, [], [], static_scenarios
        )
        item = result["items"][0]
        self.assertEqual(item["linked_scenario_id"], "10")
        self.assertIn("Scenario 10", item["subtitle"])

    def test_event_name_prefers_te_pairs_en_and_falls_back_to_event_id(self):
        row = make_te_row("1001", [make_te_event(5001), make_te_event(5006)])
        datasets = {"shared": [row], "te_pairs_en": [["Named Event", "1001"]]}
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, [make_te_character_card()], [], []
        )
        first, second = result["items"]
        self.assertEqual(first["name"], "Named Event")
        self.assertEqual(first["name_source"], "te_pairs_en")
        self.assertEqual(second["name"], "Event 5006")
        self.assertEqual(second["name_source"], "fallback_event_id")

    def test_group_and_sequence_indexes_increment_across_multiple_groups_and_events(self):
        row = make_te_row("1001", [make_te_event(5001), make_te_event(5002)], [make_te_event(5003)])
        datasets = {"shared": [row]}
        result = gt.normalize_training_events(
            make_source_config("training_events"), make_source_metadata(), datasets, [make_te_character_card()], [], []
        )
        indexes = [(item["group_index"], item["sequence_index"]) for item in result["items"]]
        self.assertEqual(indexes, [(1, 1), (1, 2), (2, 1)])

    def test_malformed_rows_are_skipped_without_crashing(self):
        datasets = {"shared": ["not-a-row", ["only-one-element"], None, 42]}
        result = gt.normalize_training_events(make_source_config("training_events"), make_source_metadata(), datasets, [], [], [])
        self.assertEqual(result["items"], [])

    def test_a_missing_dataset_for_a_source_key_is_skipped(self):
        result = gt.normalize_training_events(make_source_config("training_events"), make_source_metadata(), {}, [], [], [])
        self.assertEqual(result["items"], [])


if __name__ == "__main__":
    unittest.main()
