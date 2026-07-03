"""Adds the `scripts/` directory to sys.path so tests can `import serve_reference`
and `import lib.gametora_reference` the same way the app does at runtime."""

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
