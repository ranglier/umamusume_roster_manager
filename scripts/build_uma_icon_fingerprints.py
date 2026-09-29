#!/usr/bin/env python3
"""Precompute the uma icon fingerprints shipped with the app.

The screenshot import identifies trainees by comparing a cell against the
per-variant in-game icon. Those icons come from a third-party mirror (see
`scripts/fetch_chara_icons.py`), are gitignored like every other binary asset,
and therefore vanish on a fresh clone — which silently turns the whole uma
import into "nothing matches at all".

The matcher never needs the pixels, only the fingerprint: a 64-bit dHash plus a
coarse 6x6x6 colour histogram. Those are tiny (~75 KB for the whole set) and are
committed, so identification works out of the box and no longer depends on the
mirror staying up. Regenerate with:

    python3 scripts/fetch_chara_icons.py          # downloads the icons
    python3 scripts/build_uma_icon_fingerprints.py

IMPORTANT — this file mirrors, in Python, the fingerprinting of
`src/ui/assets/js/roster_import_cv.js` (`umaReferenceFingerprint`, `dhash64`,
`colorHistogram`, `resizeImage`, `flattenAlpha`, `cropFractional`,
`serializeFingerprint`). The JS is the source of truth; any change there must be
mirrored here. Divergence is caught by regenerating and checking that the
browser recomputes distance 0 against the shipped values.
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from datetime import datetime, timezone
from math import floor
from operator import add
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ICONS_ROOT = PROJECT_ROOT / "dist" / "media" / "reference" / "characters" / "icons"
OUTPUT_PATH = PROJECT_ROOT / "src" / "ui" / "assets" / "uma-icon-fingerprints.json"
DIST_OUTPUT_PATH = PROJECT_ROOT / "dist" / "assets" / "uma-icon-fingerprints.json"

SCHEMA_VERSION = "1.0.0"
SOURCE_NOTE = (
    "Derived from the per-variant trainee icons fetched by "
    "scripts/fetch_chara_icons.py. Perceptual hash + coarse colour histogram "
    "only; the source artwork is not redistributed."
)

# --- constants mirrored from roster_import_cv.js ---
UMA_ICON_ART = {"left": 28 / 256, "top": 46 / 280, "right": 238 / 256, "bottom": 227 / 280}
HIST_BINS = 6
HIST_STEP = 256 // HIST_BINS + (1 if 256 % HIST_BINS else 0)  # 43
HIST_SIZE = 32
HIST_SAMPLES = HIST_SIZE * HIST_SIZE  # 1024


# --- minimal PNG decode (stdlib only; the repo has no imaging dependency) ---

_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png(path: Path) -> tuple[int, int, bytearray]:
    buf = path.read_bytes()
    if buf[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path.name}")
    pos = 8
    width = height = depth = color_type = interlace = 0
    palette = trns = None
    idat: list[bytes] = []
    while pos < len(buf):
        (length,) = struct.unpack(">I", buf[pos:pos + 4])
        chunk = buf[pos + 4:pos + 8]
        data = buf[pos + 8:pos + 8 + length]
        if chunk == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", data[:13])
        elif chunk == b"PLTE":
            palette = data
        elif chunk == b"tRNS":
            trns = data
        elif chunk == b"IDAT":
            idat.append(data)
        elif chunk == b"IEND":
            break
        pos += 12 + length
    if depth != 8 or interlace != 0:
        raise ValueError(f"unsupported PNG (depth={depth}, interlace={interlace}): {path.name}")

    raw = zlib.decompress(b"".join(idat))
    channels = _CHANNELS[color_type]
    stride = width * channels
    lines = bytearray(height * stride)
    read = 0
    for y in range(height):
        filter_type = raw[read]
        read += 1
        base = y * stride
        lines[base:base + stride] = raw[read:read + stride]
        read += stride
        prev = base - stride
        if filter_type == 0:
            continue
        for i in range(stride):
            a = lines[base + i - channels] if i >= channels else 0
            b = lines[prev + i] if y else 0
            if filter_type == 1:
                lines[base + i] = (lines[base + i] + a) & 0xFF
            elif filter_type == 2:
                lines[base + i] = (lines[base + i] + b) & 0xFF
            elif filter_type == 3:
                lines[base + i] = (lines[base + i] + ((a + b) >> 1)) & 0xFF
            elif filter_type == 4:
                c = lines[prev + i - channels] if (y and i >= channels) else 0
                lines[base + i] = (lines[base + i] + _paeth(a, b, c)) & 0xFF
            else:
                raise ValueError(f"bad PNG filter {filter_type} in {path.name}")

    out = bytearray(width * height * 4)
    for i in range(width * height):
        o = i * 4
        if color_type == 2:
            s = i * 3
            out[o:o + 3] = lines[s:s + 3]
            out[o + 3] = 255
        elif color_type == 6:
            s = i * 4
            out[o:o + 4] = lines[s:s + 4]
        elif color_type == 3:
            idx = lines[i]
            out[o:o + 3] = palette[idx * 3:idx * 3 + 3]
            out[o + 3] = trns[idx] if (trns and idx < len(trns)) else 255
        elif color_type == 0:
            out[o] = out[o + 1] = out[o + 2] = lines[i]
            out[o + 3] = 255
        elif color_type == 4:
            out[o] = out[o + 1] = out[o + 2] = lines[i * 2]
            out[o + 3] = lines[i * 2 + 1]
    return width, height, out


# --- fingerprinting (mirrors roster_import_cv.js) ---

def _js_round(value: float) -> int:
    """Math.round: half away from zero. Python's round() is banker's rounding."""
    return int(floor(value + 0.5))


def crop(img, x: int, y: int, w: int, h: int):
    width, _height, data = img
    out = bytearray(w * h * 4)
    for row in range(h):
        start = ((y + row) * width + x) * 4
        out[row * w * 4:(row + 1) * w * 4] = data[start:start + w * 4]
    return (w, h, out)


def resize(img, tw: int, th: int):
    width, height, data = img
    x_bounds = []
    for tx in range(tw):
        x0 = (tx * width) // tw
        x_bounds.append((x0, max(x0 + 1, ((tx + 1) * width) // tw)))
    out = bytearray(tw * th * 4)
    for ty in range(th):
        y0 = (ty * height) // th
        y1 = max(y0 + 1, ((ty + 1) * height) // th)
        acc = [0] * (width * 4)
        for y in range(y0, y1):
            acc = list(map(add, acc, data[y * width * 4:(y + 1) * width * 4]))
        for tx in range(tw):
            x0, x1 = x_bounds[tx]
            n = (y1 - y0) * (x1 - x0)
            r = g = b = a = 0
            for x in range(x0, x1):
                o = x * 4
                r += acc[o]
                g += acc[o + 1]
                b += acc[o + 2]
                a += acc[o + 3]
            o = (ty * tw + tx) * 4
            out[o] = _js_round(r / n)
            out[o + 1] = _js_round(g / n)
            out[o + 2] = _js_round(b / n)
            out[o + 3] = _js_round(a / n)
    return (tw, th, out)


def flatten_alpha(img, r: int = 255, g: int = 255, b: int = 255):
    width, height, data = img
    out = bytearray(len(data))
    for i in range(0, len(data), 4):
        alpha = data[i + 3] / 255
        out[i] = _js_round(data[i] * alpha + r * (1 - alpha))
        out[i + 1] = _js_round(data[i + 1] * alpha + g * (1 - alpha))
        out[i + 2] = _js_round(data[i + 2] * alpha + b * (1 - alpha))
        out[i + 3] = 255
    return (width, height, out)


def crop_fractional(img, frac):
    width, height, _ = img
    x0 = max(0, floor(width * frac["left"]))
    y0 = max(0, floor(height * frac["top"]))
    x1 = min(width, floor(width * frac["right"]))
    y1 = min(height, floor(height * frac["bottom"]))
    return crop(img, x0, y0, x1 - x0, y1 - y0)


def dhash64(img) -> tuple[int, int]:
    """Returns (hi, lo), the two unsigned 32-bit halves the JS stores."""
    _w, _h, small = resize(img, 9, 8)
    bits = 0
    for row in range(8):
        for col in range(8):
            i = (row * 9 + col) * 4
            left = 0.299 * small[i] + 0.587 * small[i + 1] + 0.114 * small[i + 2]
            right = 0.299 * small[i + 4] + 0.587 * small[i + 5] + 0.114 * small[i + 6]
            bits = (bits << 1) | (1 if left > right else 0)
    return (bits >> 32) & 0xFFFFFFFF, bits & 0xFFFFFFFF


def histogram_sparse(img) -> dict[str, int]:
    _w, _h, small = resize(img, HIST_SIZE, HIST_SIZE)
    counts = [0] * (HIST_BINS ** 3)
    for i in range(HIST_SIZE * HIST_SIZE):
        o = i * 4
        r = small[o] // HIST_STEP
        g = small[o + 1] // HIST_STEP
        b = small[o + 2] // HIST_STEP
        counts[r * HIST_BINS * HIST_BINS + g * HIST_BINS + b] += 1
    # serializeFingerprint stores Math.round(hist[i] * HIST_SAMPLES); hist[i] is
    # count / HIST_SAMPLES, so this round-trips to the exact integer count.
    return {str(i): c for i, c in enumerate(counts) if c}


def fingerprint(icon_path: Path) -> dict:
    art = crop_fractional(flatten_alpha(decode_png(icon_path)), UMA_ICON_ART)
    hi, lo = dhash64(art)
    return {"h": [hi, lo], "s": histogram_sparse(art)}


def main() -> int:
    if not ICONS_ROOT.is_dir():
        raise SystemExit(
            f"no icon directory at {ICONS_ROOT}.\n"
            "Run `python3 scripts/fetch_chara_icons.py` first."
        )
    icons = sorted(p for p in ICONS_ROOT.glob("*.png"))
    if not icons:
        raise SystemExit(f"no PNG in {ICONS_ROOT}; run scripts/fetch_chara_icons.py first.")

    cards: dict[str, dict] = {}
    failures: list[str] = []
    for index, path in enumerate(icons, start=1):
        try:
            cards[path.stem] = fingerprint(path)
        except Exception as error:  # noqa: BLE001 - one bad icon must not stop the build
            failures.append(f"{path.name}: {error}")
        if index % 25 == 0 or index == len(icons):
            print(f"  {index}/{len(icons)}", flush=True)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE_NOTE,
        "icon_art": UMA_ICON_ART,
        "count": len(cards),
        "cards": cards,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    if DIST_OUTPUT_PATH.parent.is_dir():
        DIST_OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"{len(cards)} fingerprints -> {OUTPUT_PATH.relative_to(PROJECT_ROOT)} ({size_kb:.0f} KB)")
    for failure in failures:
        print(f"  FAILED {failure}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
