#!/usr/bin/env python3

from __future__ import annotations

import argparse
import errno
import functools
import http.server
import json
import re
import shutil
import socketserver
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from lib.gametora_reference import update_umamusume_reference


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = PROJECT_ROOT / "dist"
REFERENCE_META_PATH = DIST_ROOT / "data" / "reference-meta.json"
USER_DATA_ROOT = PROJECT_ROOT / "data" / "user"
PROFILES_INDEX_PATH = USER_DATA_ROOT / "profiles.json"
PROFILE_DATA_ROOT = USER_DATA_ROOT / "profiles"
PROFILE_ID_PATTERN = re.compile(r"^p_\d{3,}$")


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def default_profiles_index() -> dict:
    return {
        "version": 1,
        "last_profile_id": None,
        "profiles": [],
    }


def default_roster() -> dict:
    return {
        "version": 1,
        "updated_at": utc_timestamp(),
        "characters": {},
        "supports": {},
    }


def ensure_user_data_roots() -> None:
    USER_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    PROFILE_DATA_ROOT.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, fallback_factory):
    if not path.exists():
        return fallback_factory()

    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return fallback_factory()


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp_path.replace(path)


def normalize_profiles_index(raw_index: object) -> dict:
    default_index = default_profiles_index()
    if not isinstance(raw_index, dict):
        return default_index

    profiles = []
    for raw_profile in raw_index.get("profiles", []):
        if not isinstance(raw_profile, dict):
            continue

        profile_id = str(raw_profile.get("id") or "").strip()
        name = str(raw_profile.get("name") or "").strip()
        created_at = str(raw_profile.get("created_at") or "").strip()
        updated_at = str(raw_profile.get("updated_at") or "").strip()

        if not PROFILE_ID_PATTERN.match(profile_id) or not name:
            continue

        profiles.append(
            {
                "id": profile_id,
                "name": name,
                "created_at": created_at or utc_timestamp(),
                "updated_at": updated_at or utc_timestamp(),
            }
        )

    last_profile_id = raw_index.get("last_profile_id")
    valid_profile_ids = {profile["id"] for profile in profiles}
    if last_profile_id not in valid_profile_ids:
        last_profile_id = None

    return {
        "version": 1,
        "last_profile_id": last_profile_id,
        "profiles": profiles,
    }


def load_profiles_index() -> dict:
    ensure_user_data_roots()
    return normalize_profiles_index(read_json(PROFILES_INDEX_PATH, default_profiles_index))


def save_profiles_index(index: dict) -> dict:
    normalized = normalize_profiles_index(index)
    atomic_write_json(PROFILES_INDEX_PATH, normalized)
    return normalized


def profile_roster_path(profile_id: str) -> Path:
    return PROFILE_DATA_ROOT / profile_id / "roster.json"


def profile_exists(profile_id: str) -> bool:
    return profile_id in {profile["id"] for profile in load_profiles_index()["profiles"]}


def normalize_roster_entry(entity_key: str, raw_entry: object) -> dict | None:
    if not isinstance(raw_entry, dict):
        return None

    normalized: dict[str, object] = {}

    if "owned" in raw_entry:
        if not isinstance(raw_entry["owned"], bool):
            raise ValueError(f"{entity_key}.owned must be a boolean.")
        normalized["owned"] = raw_entry["owned"]

    if "favorite" in raw_entry:
        if not isinstance(raw_entry["favorite"], bool):
            raise ValueError(f"{entity_key}.favorite must be a boolean.")
        normalized["favorite"] = raw_entry["favorite"]

    if "note" in raw_entry:
        note = raw_entry["note"]
        if not isinstance(note, str):
            raise ValueError(f"{entity_key}.note must be a string.")
        if len(note) > 2000:
            raise ValueError(f"{entity_key}.note is too long.")
        normalized["note"] = note

    if entity_key == "characters":
        if "stars" in raw_entry:
            stars = raw_entry["stars"]
            if not isinstance(stars, int) or stars < 0 or stars > 5:
                raise ValueError("characters.stars must be an integer between 0 and 5.")
            normalized["stars"] = stars
        if "awakening" in raw_entry:
            awakening = raw_entry["awakening"]
            if not isinstance(awakening, int) or awakening < 0 or awakening > 5:
                raise ValueError("characters.awakening must be an integer between 0 and 5.")
            normalized["awakening"] = awakening

    if entity_key == "supports":
        if "level" in raw_entry:
            level = raw_entry["level"]
            if not isinstance(level, int) or level < 1 or level > 50:
                raise ValueError("supports.level must be an integer between 1 and 50.")
            normalized["level"] = level
        if "limit_break" in raw_entry:
            limit_break = raw_entry["limit_break"]
            if not isinstance(limit_break, int) or limit_break < 0 or limit_break > 4:
                raise ValueError("supports.limit_break must be an integer between 0 and 4.")
            normalized["limit_break"] = limit_break

    return normalized or None


def normalize_roster(raw_roster: object) -> dict:
    roster = default_roster()
    if not isinstance(raw_roster, dict):
        return roster

    normalized = {
        "version": 1,
        "updated_at": str(raw_roster.get("updated_at") or roster["updated_at"]),
        "characters": {},
        "supports": {},
    }

    for entity_key in ("characters", "supports"):
        bucket = raw_roster.get(entity_key, {})
        if not isinstance(bucket, dict):
            continue

        for item_id, raw_entry in bucket.items():
            entry_id = str(item_id).strip()
            if not entry_id:
                continue

            entry = normalize_roster_entry(entity_key, raw_entry)
            if entry is not None:
                normalized[entity_key][entry_id] = entry

    return normalized


def load_roster(profile_id: str) -> dict:
    return normalize_roster(read_json(profile_roster_path(profile_id), default_roster))


def save_roster(profile_id: str, roster: dict) -> dict:
    normalized = normalize_roster(roster)
    normalized["updated_at"] = utc_timestamp()
    atomic_write_json(profile_roster_path(profile_id), normalized)
    return normalized


def next_profile_id(profiles: list[dict]) -> str:
    next_number = 1
    for profile in profiles:
        match = re.match(r"^p_(\d+)$", profile["id"])
        if match:
            next_number = max(next_number, int(match.group(1)) + 1)
    return f"p_{next_number:03d}"


def create_profile(name: str) -> tuple[dict, dict]:
    normalized_name = str(name or "").strip()
    if not normalized_name:
        raise ValueError("Profile name is required.")
    if len(normalized_name) > 80:
        raise ValueError("Profile name must be 80 characters or fewer.")

    index = load_profiles_index()
    timestamp = utc_timestamp()
    profile = {
        "id": next_profile_id(index["profiles"]),
        "name": normalized_name,
        "created_at": timestamp,
        "updated_at": timestamp,
    }

    index["profiles"].append(profile)
    index["last_profile_id"] = profile["id"]
    saved_index = save_profiles_index(index)
    save_roster(profile["id"], default_roster())
    return saved_index, profile


def set_last_profile(profile_id: str) -> dict:
    if not PROFILE_ID_PATTERN.match(profile_id) or not profile_exists(profile_id):
        raise FileNotFoundError("Profile not found.")

    index = load_profiles_index()
    index["last_profile_id"] = profile_id
    return save_profiles_index(index)


def delete_profile(profile_id: str) -> dict:
    if not PROFILE_ID_PATTERN.match(profile_id):
        raise FileNotFoundError("Profile not found.")

    index = load_profiles_index()
    profiles = [profile for profile in index["profiles"] if profile["id"] != profile_id]
    if len(profiles) == len(index["profiles"]):
        raise FileNotFoundError("Profile not found.")

    profile_dir = PROFILE_DATA_ROOT / profile_id
    if profile_dir.exists():
        shutil.rmtree(profile_dir)

    index["profiles"] = profiles
    if index.get("last_profile_id") == profile_id:
        index["last_profile_id"] = profiles[0]["id"] if profiles else None

    return save_profiles_index(index)


class ReferenceRequestHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "UmamusumeReferenceHTTP/2.0"

    def end_headers(self) -> None:
        request_path = urlparse(self.path).path
        if request_path.startswith("/api/") or request_path in ("/", "/index.html", "/__health", "/__meta"):
            self.send_header("Cache-Control", "no-store")
        elif request_path.startswith("/data/"):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path

        if request_path == "/__health":
            self._send_json(
                {
                    "status": "ok",
                    "dist_exists": DIST_ROOT.exists(),
                    "reference_meta_exists": REFERENCE_META_PATH.exists(),
                    "user_data_exists": USER_DATA_ROOT.exists(),
                }
            )
            return

        if request_path == "/__meta":
            if not REFERENCE_META_PATH.exists():
                self._send_api_error(404, "Reference metadata not found. Run the update command first.")
                return
            self._send_json(json.loads(REFERENCE_META_PATH.read_text(encoding="utf-8-sig")))
            return

        if request_path == "/api/profiles":
            self._send_json(load_profiles_index())
            return

        roster_profile_id = self._match_profile_roster_path(request_path)
        if roster_profile_id:
            if not profile_exists(roster_profile_id):
                self._send_api_error(404, "Profile not found.")
                return
            self._send_json(load_roster(roster_profile_id))
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path

        if request_path == "/api/profiles":
            try:
                payload = self._read_json_body()
            except ValueError:
                return
            try:
                saved_index, profile = create_profile(payload.get("name"))
            except ValueError as exc:
                self._send_api_error(400, str(exc))
                return

            self._send_json(
                {
                    "profiles": saved_index,
                    "created_profile": profile,
                },
                status=201,
            )
            return

        if request_path == "/api/profiles/select":
            try:
                payload = self._read_json_body()
            except ValueError:
                return
            profile_id = str(payload.get("profile_id") or "").strip()
            try:
                index = set_last_profile(profile_id)
            except FileNotFoundError:
                self._send_api_error(404, "Profile not found.")
                return

            self._send_json(index)
            return

        self._send_api_error(404, "API route not found.")

    def do_PUT(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        roster_profile_id = self._match_profile_roster_path(request_path)
        if not roster_profile_id:
            self._send_api_error(404, "API route not found.")
            return

        if not profile_exists(roster_profile_id):
            self._send_api_error(404, "Profile not found.")
            return

        try:
            payload = self._read_json_body()
        except ValueError:
            return
        try:
            saved_roster = save_roster(roster_profile_id, payload)
        except ValueError as exc:
            self._send_api_error(400, str(exc))
            return

        self._send_json(saved_roster)

    def do_DELETE(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        match = re.fullmatch(r"/api/profiles/(p_\d{3,})", request_path)
        if not match:
            self._send_api_error(404, "API route not found.")
            return

        try:
            index = delete_profile(match.group(1))
        except FileNotFoundError:
            self._send_api_error(404, "Profile not found.")
            return

        self._send_json(index)

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(403, "Directory listing is disabled.")
        return None

    def _read_json_body(self) -> dict:
        content_length = self.headers.get("Content-Length")
        if not content_length:
            return {}

        try:
            raw_body = self.rfile.read(int(content_length))
        except (TypeError, ValueError):
            self._send_api_error(400, "Invalid request body.")
            raise ValueError("invalid-body") from None

        if not raw_body:
            return {}

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_api_error(400, "Request body must be valid JSON.")
            raise ValueError("invalid-json") from None

        if not isinstance(payload, dict):
            self._send_api_error(400, "Request body must be a JSON object.")
            raise ValueError("invalid-object") from None

        return payload

    def _match_profile_roster_path(self, request_path: str) -> str | None:
        match = re.fullmatch(r"/api/profiles/(p_\d{3,})/roster", request_path)
        if not match:
            return None
        return match.group(1)

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_api_error(self, status: int, message: str) -> None:
        self._send_json({"error": message}, status=status)


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the generated local reference bundle over HTTP for browser compatibility."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind. Default: 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="TCP port to bind. Default: 8000",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the local reference in the default browser after the server starts.",
    )
    parser.add_argument(
        "--update-first",
        action="store_true",
        help="Run the reference update pipeline before starting the server.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.update_first:
        print("Running local reference update before starting the server...")
        summary = update_umamusume_reference(force=False)
        print("")
        print("Update complete.")
        print(f"Raw datasets synced : {summary['rawDatasetCount']}")
        print(f"Normalized entities : {summary['normalizedEntityCount']}")
        print(f"Visual assets       : {summary['assetCount']}")
        print(f"Asset failures      : {summary['assetFailureCount']}")
        print(f"App output          : {summary['appEntry']}")
        print("")

    if not DIST_ROOT.exists():
        print("Missing dist/ bundle. Run `python ./scripts/update_reference.py` first.", file=sys.stderr)
        return 1

    ensure_user_data_roots()
    handler = functools.partial(ReferenceRequestHandler, directory=str(DIST_ROOT))

    try:
        httpd = ThreadingTCPServer((args.host, args.port), handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(
                f"Port {args.port} is already in use on {args.host}. "
                "Choose another port with `--port`.",
                file=sys.stderr,
            )
            return 1
        raise

    with httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"Serving local reference at {url}")
        print(f"Health endpoint: {url}__health")
        print(f"Metadata endpoint: {url}__meta")
        print(f"Profiles endpoint: {url}api/profiles")
        print("Press Ctrl+C to stop.")

        if args.open:
            webbrowser.open(url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
