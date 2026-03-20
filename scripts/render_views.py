from __future__ import annotations

from pathlib import Path

from roster_lib import VIEWS_DIR, entity_label, load_dataset, readiness_rank


def sort_characters(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda item: (readiness_rank(item["readiness_state"]), entity_label(item)))


def format_character_line(character: dict) -> str:
    roles = ", ".join(character.get("possible_roles", []))
    blockers = character.get("readiness", {}).get("blockers", [])
    blocker_text = blockers[0] if blockers else "Aucun blocage majeur."
    return (
        f"- {entity_label(character)}: {character['readiness_state']} | theorie {character['theoretical_power']} | "
        f"pratique {character['practical_fit']} | roles {roles}\n"
        f"  Blocage ou note cle: {blocker_text}"
    )


def format_support_line(support: dict) -> str:
    return (
        f"- {entity_label(support)}: {support['availability']} | {support['status']} | "
        f"apporte {', '.join(support.get('interest_tags', []))}\n"
        f"  Usage: {support['usage_primary']}"
    )


def format_parent_line(parent: dict) -> str:
    return (
        f"- {parent['representative_name']}: {parent['status']} | {parent['scope']} | {parent['role_summary']}\n"
        f"  Fixes: {', '.join(parent.get('aptitude_fixes', []))}"
    )


def render_overview(dataset: dict) -> str:
    account = dataset["account"]
    active_cm = dataset["cms"][account["active_cm_id"]]
    characters = list(dataset["characters"].values())
    builds = dataset["builds_by_cm"].get(active_cm["id"], [])

    ready = sort_characters([item for item in characters if item["readiness_state"] == "ready_now"])
    farm_needed = sort_characters([item for item in characters if item["readiness_state"] == "farm_needed"])
    blocked = sort_characters([item for item in characters if item["readiness_state"] == "blocked"])
    watch_supports = sorted(
        [
            item
            for item in dataset["supports"].values()
            if item["availability"] != "available"
        ],
        key=lambda item: (item["availability"], entity_label(item)),
    )
    parents = sorted(
        dataset["parents"].values(),
        key=lambda item: ({"excellent": 0, "good": 1, "usable": 2, "to_do": 3, "farming": 4, "replace": 5}.get(item["status"], 9), entity_label(item)),
    )

    lines = [
        "# Overview",
        "",
        "Vue globale du roster et de la preparation Champions Meeting a partir des donnees versionnees du depot.",
        "",
        "## Snapshot du compte",
        f"- Compte: {account['owner_display_name']} ({account['account_id']})",
        f"- Region: {account['region']}",
        f"- CM active: {active_cm['name']} ({active_cm['id']})",
        f"- Borrow limit par training: {account['borrow_limit_per_training']}",
        f"- Scenarios suivis: {', '.join(account.get('supported_training_scenarios', []))}",
        "",
        "## Candidates pretes maintenant",
    ]

    if ready:
        lines.extend(format_character_line(item) for item in ready)
    else:
        lines.append("- Aucune candidate marquee `ready_now`.")

    lines.extend(["", "## Candidates presque pretes"])
    if farm_needed:
        lines.extend(format_character_line(item) for item in farm_needed)
    else:
        lines.append("- Aucune candidate marquee `farm_needed`.")

    lines.extend(["", "## Candidates bloquees"])
    if blocked:
        lines.extend(format_character_line(item) for item in blocked)
    else:
        lines.append("- Aucune candidate marquee `blocked`.")

    lines.extend(["", "## Supports a surveiller"])
    if watch_supports:
        lines.extend(format_support_line(item) for item in watch_supports)
    else:
        lines.append("- Aucune support manquante ou borrow-only suivie.")

    lines.extend(["", "## Parents a forte valeur"])
    lines.extend(format_parent_line(item) for item in parents)

    lines.extend(
        [
            "",
            "## CM active",
            f"- Piste: {active_cm['track_name']} | {active_cm['surface']} | {active_cm['distance']} | {active_cm['turn']}",
            f"- Strategie: {active_cm['general_strategy']}",
            f"- Archetypes: {', '.join(active_cm.get('playable_archetypes', []))}",
            f"- Candidats valides: {', '.join(entity_label(dataset['characters'][cid]) for cid in active_cm.get('candidate_ids_validated', [])) or 'Aucun'}",
            "",
            "### Priorites de farm",
        ]
    )
    lines.extend(f"- {item}" for item in active_cm.get("farm_goals", []))

    lines.extend(["", "### Builds suivis"])
    if builds:
        for build in builds:
            candidate = dataset["characters"][build["candidate_id"]]
            lines.append(
                f"- {entity_label(candidate)} | {build['build_profile']} | {build['viability']} | {build['progress_state']}"
            )
    else:
        lines.append("- Aucun build suivi sur le CM actif.")

    return "\n".join(lines) + "\n"


def render_deck_table(build: dict, supports: dict) -> list[str]:
    lines = ["| Slot | Support | Borrow | Raison |", "| --- | --- | --- | --- |"]
    for item in sorted(build.get("deck", []), key=lambda entry: entry["slot"]):
        support = supports[item["support_id"]]
        borrow = "yes" if item["borrow"] else "no"
        lines.append(f"| {item['slot']} | {entity_label(support)} | {borrow} | {item['reason']} |")
    return lines


def render_parent_lines(build: dict, parents: dict) -> list[str]:
    lines: list[str] = []
    for item in build.get("parent_plan", []):
        parent = parents[item["parent_id"]]
        lines.append(f"- {parent['representative_name']} ({item['role']}): {item['reason']}")
    return lines


def render_cm_view(dataset: dict, cm: dict, builds: list[dict]) -> str:
    characters = dataset["characters"]
    supports = dataset["supports"]
    parents = dataset["parents"]

    lines = [
        f"# {cm['name']}",
        "",
        f"- Fenetre: {cm['event_window']}",
        f"- Piste: {cm['track_name']}",
        f"- Surface / distance: {cm['surface']} / {cm['distance']} ({cm['distance_m']}m)",
        f"- Sens: {cm['turn']}",
        f"- Saison / meteo: {cm['season']} / {cm['weather']}",
        f"- Etat de prep: {cm['prep_status']}",
        "",
        "## Points techniques",
    ]
    lines.extend(f"- {item}" for item in cm.get("technical_points", []))

    features = cm.get("track_features", {})
    lines.extend(
        [
            "",
            "## Lecture de piste",
            f"- Final corner: {features.get('final_corner', '')}",
            f"- Final straight: {features.get('final_straight', '')}",
            f"- Spurt start: {features.get('spurt_start', '')}",
            f"- Elevation: {features.get('elevation', '')}",
            f"- Positioning: {features.get('positioning', '')}",
            f"- Green skills: {', '.join(features.get('relevant_green_skills', []))}",
            f"- Accel notes: {', '.join(features.get('relevant_accel_skills', []))}",
            "",
            "## Implications skills",
        ]
    )
    lines.extend(f"- {item}" for item in cm.get("skill_implications", []))

    lines.extend(["", "## Candidats suivis", "| Candidate | Etat | Theorie | Pratique | Roles |", "| --- | --- | --- | --- | --- |"])
    for candidate_id in cm.get("candidate_ids_considered", []):
        candidate = characters[candidate_id]
        roles = ", ".join(candidate.get("possible_roles", []))
        lines.append(
            f"| {entity_label(candidate)} | {candidate['readiness_state']} | {candidate['theoretical_power']} | {candidate['practical_fit']} | {roles} |"
        )

    lines.extend(["", "## Parents recommandes"])
    for parent_id in cm.get("recommended_parent_ids", []):
        parent = parents[parent_id]
        lines.append(f"- {parent['representative_name']}: {parent['role_summary']}")

    lines.extend(["", "## Supports importantes"])
    for support_id in cm.get("important_support_ids", []):
        support = supports[support_id]
        lines.append(f"- {entity_label(support)}: {support['usage_primary']}")

    lines.extend(["", "## Blocages identifies"])
    lines.extend(f"- {item}" for item in cm.get("identified_blockers", []))

    lines.extend(["", "## Plan de preparation"])
    lines.extend(f"- {item}" for item in cm.get("prep_plan", []))

    lines.extend(["", "## Builds suivis"])
    if not builds:
        lines.append("- Aucun build versionne pour ce CM.")
    for build in builds:
        candidate = characters[build["candidate_id"]]
        borrow_support = supports[build["borrow_plan"]["support_id"]]
        lines.extend(
            [
                "",
                f"### {entity_label(candidate)} - {build['build_profile']}",
                f"- Role: {build['role_in_team']}",
                f"- Style: {build['chosen_style']}",
                f"- Scenario: {build['scenario']}",
                f"- Viabilite: {build['viability']}",
                f"- Difficulte: {build['difficulty']}",
                f"- Progression: {build['progress_state']}",
                f"- Objectif: {build['build_objective']}",
                f"- Borrow: {entity_label(borrow_support)} ({build['borrow_plan']['reason']})",
                f"- Dependances: {', '.join(build.get('dependencies', []))}",
                "",
                "#### Priorites de skills",
            ]
        )
        lines.extend(f"- {item}" for item in build.get("skills_priority", []))
        lines.extend(["", "#### Deck support"])
        lines.extend(render_deck_table(build, supports))
        lines.extend(["", "#### Plan parents"])
        lines.extend(render_parent_lines(build, parents))

    return "\n".join(lines) + "\n"


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> int:
    dataset = load_dataset()
    write_text(VIEWS_DIR / "overview.md", render_overview(dataset))
    for cm_id, cm in dataset["cms"].items():
        builds = dataset["builds_by_cm"].get(cm_id, [])
        write_text(VIEWS_DIR / "cms" / f"{cm_id}.md", render_cm_view(dataset, cm, builds))
    print("Views rendered.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
