# Notes for working in this repo

See `docs/PROJECT_STATUS.md` for the full project narrative and `docs/REFACTOR_PLAN.md`
for the `serve_reference.py` / `app.js` module split. This file is just the
footguns that have actually bitten a session before.

## Getting real data into `dist/` for local testing

`data/raw/`, `data/normalized/`, `dist/data/`, and `dist/media/` are gitignored.
A fresh clone (or a dev sandbox without a prior import) has none of them. To
get a working local app with real entities and images:

```bash
python scripts/update_reference.py
```

This needs network access to GameTora but reuses `data/raw/` if it's already
present (no full re-download). It's the only supported way to populate
`dist/` — don't hand-roll a fake `dist/data/reference-data.js` for testing;
see the next section for why.

## Don't call `save_static_app()` with a partial payload

`save_static_app(payload, asset_metadata=None)` in `scripts/lib/gametora_reference.py`
unconditionally rewrites `dist/data/reference-data.js` from `payload` (it's the
same function that copies `index.html`/`app.css`/`app.js`/`assets/js/*.js` into
`dist/`). If you call it with anything less than the full `{"reference": ..., "entities": {...}}`
shape just to refresh the static assets, you silently blow away real reference
data with a stub — this happened twice in one session and produced a very
convincing but entirely fake "images are broken" regression.

If you only need to refresh `dist/assets/*` and `dist/index.html` after
editing `src/ui/`, copy those specific files yourself instead of calling
`save_static_app()`. If you need a fully consistent `dist/`, run
`python scripts/update_reference.py`.

## Test suites

```bash
python -m unittest discover -s tests -t . -v   # backend, stdlib unittest
node --test tests/js/                           # frontend, stdlib node:test
```

This dev environment has no `node` binary — frontend test correctness was
verified by running the equivalent assertions live in the browser preview
first, then confirmed for real in CI (`.github/workflows/tests.yml`, job
`js-unittest`). If you add JS tests here and can't run Node either, do the
same: verify behavior via the browser preview, then let CI be the first real
execution, and say so.

## Don't run mypy on `serve_reference.py` or `gametora_reference.py` as-is

Tried it, verdict is in `docs/PROJECT_STATUS.md` under "Outillage qualite": mypy
hangs (90s+, still not done) on `scripts/lib/gametora_reference.py` and
`scripts/serve_reference.py`, almost certainly because of the huge nested
`OrderedDict([...])` literals and heavy `Any` typing in those two files. The
small `scripts/lib/*.py` modules check instantly. Don't burn CI minutes (or
your own) re-running the full `scripts/` tree through mypy expecting it to
just finish — it won't, without either scoping it to the small modules only
or actually restructuring the expensive functions first.

## Previewing the app

`.claude/launch.json` defines a `reference-server` config
(`python3 ./scripts/serve_reference.py --port 8420`) for the Preview tool.
