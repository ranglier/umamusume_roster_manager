# Refactor Plan: Splitting the Monoliths

## Why

`scripts/serve_reference.py` (3310 lines, ~120 functions) and `src/ui/assets/app.js`
(7318 lines, single IIFE) have grown into monoliths. Both still work, but they are
hard to navigate and every change risks a silent regression somewhere else in the
same file.

The `tests/` suite added alongside this plan is the safety net: it pins down the
exact behavior of the riskiest pure functions (legacy sparks, progression math,
roster/build validation, id generation). Run it after every single step below.

```bash
python -m unittest discover -s tests -t . -v
```

If a step makes a test fail, the refactor introduced a behavior change — fix the
refactor, not the test.

## Guiding principle

Every function in `serve_reference.py` falls into one of two buckets:

- **Pure**: takes plain data in (dicts, lists, strings, ints) and returns plain
  data out. No calls to `load_*`, `read_*`, `save_*`, `atomic_write_json`, or any
  `*_path` helper. These are safe to move anywhere and safe to unit test without
  fixtures on disk.
- **I/O-bound**: reads or writes `data/user/...`, `data/normalized/...`, or
  `dist/data/...`. These need `PROJECT_ROOT`-relative paths and stay close to the
  HTTP handler, or move to a small `*_store.py` module that owns that I/O.

The split below always moves pure functions into `scripts/lib/`, and leaves
I/O-bound orchestration in `serve_reference.py` (or a `*_store.py` module later,
if `serve_reference.py` is still too big once the pure logic is gone).

## Step 0 — extract shared primitives first

Create `scripts/lib/common.py` with the small generic helpers that everything
else depends on, so later modules don't import back from `serve_reference.py`
(which would create circular imports):

- `utc_timestamp`
- `clamp_int`
- `normalize_string_list`

These three are already fully covered by `tests/test_serve_reference.py`
(`ClampIntTests`, `NormalizeStringListTests`). After moving them, update that
test file's import (`from lib import common as sr_common`, or re-export them
from `serve_reference` if you'd rather not touch the tests yet — either works,
but importing from the new location directly is the point of the exercise).

## Step 1 — `scripts/lib/legacy_factors.py` (highest value, fully scoped below)

This is the biggest, most fragile domain (parent/legacy sparks) and it's
already the part of the app the docs flag as "still evolving." It is also
already 100% unit-tested, so this is the safest place to start.

**Move these functions** (all pure, verified by reading each body):

```
get_character_detail
get_character_unique_skill
character_supports_green_spark
legacy_factor_label
normalize_legacy_factor
build_legacy_factor
default_legacy_grandparents
dedupe_legacy_factors
dedupe_legacy_white_sparks
normalize_blue_spark
normalize_pink_spark
normalize_green_spark
normalize_white_sparks
migrate_legacy_sparks_from_factors
legacy_entry_to_factors
build_legacy_spark_summary
normalize_legacy_grandparent
normalize_legacy_grandparents
legacy_entry_grandparents
get_legacy_lineage_entries
build_lineage_completion
normalize_legacy_entry
next_legacy_id
build_pair_compatibility
summarize_legacy_factors
build_legacy_reference_button
build_legacy_grandparent_view_item
build_lineage_factor_summary
build_empty_legacy_view
build_aptitude_coverage
build_detailed_aptitude_coverage
build_compact_pair_summary
```

Also move the constants they use, since nothing outside the legacy domain
touches them:

```
LEGACY_STAT_LABELS
LEGACY_SURFACE_LABELS
LEGACY_DISTANCE_LABELS
LEGACY_STYLE_LABELS
LEGACY_FACTOR_KIND_LABELS
LEGACY_RATING_OPTIONS
LEGACY_ID_PATTERN
```

`legacy_factors.py` should import `clamp_int`, `normalize_string_list`,
`utc_timestamp` from `lib.common` (step 0), and nothing else from
`serve_reference.py`.

**Leave these in `serve_reference.py`** — they all do disk I/O (they call
`load_reference_entity`, `load_reference_items_lookup`,
`build_legacy_reference_catalogs`, `load_roster`, or read/write
`data/user/profiles/<id>/legacy.json`):

```
build_legacy_reference_catalogs
profile_legacy_path
inspect_legacy_document        # calls build_legacy_reference_catalogs()
normalize_legacy_document       # wraps inspect_legacy_document
load_legacies / read_raw_legacies / save_legacies / persist_unresolved_legacies
create_legacy_entry / update_legacy_entry / delete_legacy_entry
build_legacy_view
build_legacy_simulator_preview
```

`serve_reference.py` then does:

```python
from lib.legacy_factors import (
    normalize_legacy_factor, dedupe_legacy_factors, normalize_legacy_entry,
    build_pair_compatibility, build_legacy_view_helpers...  # etc, list what's actually called
)
```

**Verify**: re-run the test suite (should still be 83/83 green — only the
import path for these functions changes, not their behavior), then actually
start the server and click through `My Roster > Legacy` for one profile to
confirm the simulator and lineage views still render.

## Step 2 — `scripts/lib/roster_progression.py`

Move (pure):

```
get_support_level_cap
get_support_curve_progress
resolve_support_effect_value
summarize_character_progression
summarize_support_progression
normalize_roster_entry
```

`normalize_roster` itself calls `load_reference_items_lookup("supports")` to
build a rarity lookup — that one call makes it I/O-bound as written. Two
options: leave `normalize_roster` in `serve_reference.py`, or refactor its
signature to `normalize_roster(raw_roster, support_rarity_lookup)` so the
caller passes the lookup in and the function becomes pure too. The second
option is slightly more work but is the right long-term shape — worth doing
once step 1 has proven the pattern.

Leave in `serve_reference.py`: `build_character_progression_lookup`,
`build_support_progression_lookup`, `build_roster_view`, `load_roster`,
`save_roster`.

## Step 3 — builds validation helpers

Move (pure, add to `lib/common.py` or a new `lib/builds_validation.py`):

```
normalize_build_id_list
normalize_build_stats
normalize_build_aptitudes
normalize_build_legacy_pair
next_build_id
```

Leave: `validate_build_references` (does 4 separate disk lookups),
`normalize_build_entry` (calls `validate_build_references`),
`normalize_builds_document`, `load_builds`, `save_builds`,
`create_build_entry`, `update_build_entry`, `delete_build_entry`.

## Step 4 — profile helpers

Move (pure): `unique_profile_name`, `next_profile_id`.

Everything else in the profile CRUD section (`create_profile`,
`rename_profile`, `delete_profile`, `export_profile_archive_bytes`,
`import_profile_archive_bytes`, backups, admin jobs) is I/O-bound by nature
(it's reading/writing zip archives and JSON files) — leave it in
`serve_reference.py`, or in a later pass give it its own
`scripts/lib/profiles_store.py` if the file is still unwieldy once steps 1-3
are done.

## Step 5 — the HTTP handler (`ReferenceRequestHandler`)

Do this last, once steps 1-4 have already shrunk the file. At that point
`do_GET` / `do_POST` / `do_PUT` / `do_DELETE` are mostly a long chain of
`re.fullmatch(...)` route matches, each calling one function from a domain
module. That's a reasonable shape for a stdlib `http.server` app without a
framework — you probably don't need to break the class itself apart, just
confirm each route handler is a thin call into `lib.legacy_factors` /
`lib.roster_progression` / etc. rather than inline logic.

If it's still too long to navigate at that point, consider splitting route
registration by resource (`_handle_profile_routes`, `_handle_legacy_routes`,
`_handle_roster_routes` as private methods called from `do_GET`/`do_POST` in
sequence) rather than introducing a routing framework — stay consistent with
the project's "no new dependencies" philosophy.

## Execution recipe (repeat for each step above)

1. Create the new file under `scripts/lib/` with the listed functions, copied
   verbatim (don't "improve" them while moving — that's a separate change).
2. Add the necessary `from lib.common import ...` (or similar) imports at the
   top of the new file.
3. Delete the moved functions from `serve_reference.py` and add
   `from lib.<new_module> import (...)` near the existing
   `from lib.gametora_reference import ...` line.
4. Run `python -m unittest discover -s tests -t . -v`. Fix any import errors
   in `tests/test_serve_reference.py` (some tests call `sr.normalize_legacy_factor`
   etc. directly — update those to import from the new module instead, or
   split them into a new `tests/test_legacy_factors.py` file that mirrors the
   new module boundary).
5. Start the server (`python ./scripts/serve_reference.py --open`) and click
   through the affected screen once by hand.
6. Commit before moving to the next step. Small, reviewable commits make it
   easy to `git revert` a single step if something surfaces later.

## After the Python split: `src/ui/assets/app.js`

Different technique, same principle. The project has no bundler and no
frontend build step today, and there's no need to add one just for this:

1. Change `src/ui/index.html`'s script tag to
   `<script type="module" src="assets/app.js"></script>` — browsers support ES
   modules natively, no tooling required.
2. Split by feature area, mirroring the backend domains: `assets/js/catalog.js`,
   `assets/js/roster.js`, `assets/js/legacy.js`, `assets/js/admin.js`,
   `assets/js/dom-utils.js` (the ~30 `document.getElementById` lookups and
   shared render helpers), with `app.js` becoming a thin entry point that
   imports and wires them together.
3. Update the UI-sync step in `scripts/lib/gametora_reference.py` (search for
   `ui_root = PROJECT_ROOT / "src" / "ui"`) so it copies the new
   `assets/js/*.js` files into `dist/assets/js/` too, not just `app.js` /
   `app.css`.
4. There is currently zero frontend test coverage. Before or during this
   split, it's worth adding a handful of smoke checks (even just "does the
   page load and render the character list without a console error", driven
   with Playwright, which is already available in dev environments like this
   one) so the split has at least minimal regression protection. This is
   optional but strongly recommended given how much bigger and more
   interconnected `app.js` is compared to the Python side.

Do this only after the Python split is stable — it's a bigger, riskier change
on a part of the codebase with no tests at all yet.
