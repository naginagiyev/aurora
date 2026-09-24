import os
import time
import uuid
import json
import threading

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
SONGS_DIR = os.path.join(BASE, "songs")
COVERS_DIR = os.path.join(BASE, "covers")
LYRICS_DIR = os.path.join(BASE, "lyrics")
PLAYLIST_COVERS_DIR = os.path.join(BASE, "playlist_covers")
DB_PATH = os.path.join(DATA_DIR, "library.json")

_lock = threading.RLock()

def ensure_dirs():
    for d in (DATA_DIR, SONGS_DIR, COVERS_DIR, LYRICS_DIR, PLAYLIST_COVERS_DIR):
        os.makedirs(d, exist_ok=True)

def _load():
    if not os.path.exists(DB_PATH):
        return {"tracks": [], "playlists": []}
    try:
        with open(DB_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (ValueError, OSError):
        return {"tracks": [], "playlists": []}
    data.setdefault("tracks", [])
    data.setdefault("playlists", [])
    return data

def _save(data):
    ensure_dirs()
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, DB_PATH)

def snapshot():
    with _lock:
        return _load()

def all_tracks():
    return snapshot()["tracks"]

def get_track(track_id):
    for t in snapshot()["tracks"]:
        if t["id"] == track_id:
            return t
    return None

def track_exists(track_id):
    return get_track(track_id) is not None

def add_track(track):
    with _lock:
        data = _load()
        data["tracks"] = [t for t in data["tracks"] if t["id"] != track["id"]]
        track.setdefault("added_at", time.time())
        data["tracks"].append(track)
        _save(data)
        return track

def rename_track(track_id, title):
    with _lock:
        data = _load()
        for t in data["tracks"]:
            if t["id"] == track_id:
                t["title"] = title
                _save(data)
                return t
        return None

def remove_track(track_id):
    with _lock:
        data = _load()
        data["tracks"] = [t for t in data["tracks"] if t["id"] != track_id]
        for p in data["playlists"]:
            p["track_ids"] = [i for i in p["track_ids"] if i != track_id]
        _save(data)
    for path in (
        os.path.join(SONGS_DIR, track_id + ".mp3"),
        os.path.join(COVERS_DIR, track_id + ".jpg"),
        os.path.join(LYRICS_DIR, track_id + ".lrc"),
    ):
        try:
            os.remove(path)
        except OSError:
            pass

def create_playlist(name):
    with _lock:
        data = _load()
        playlist = {
            "id": uuid.uuid4().hex[:12],
            "name": name or "Untitled",
            "cover": None,
            "track_ids": [],
            "created_at": time.time(),
        }
        data["playlists"].append(playlist)
        _save(data)
        return playlist

def _find_playlist(data, playlist_id):
    for p in data["playlists"]:
        if p["id"] == playlist_id:
            return p
    return None

def get_playlist(playlist_id):
    return _find_playlist(snapshot(), playlist_id)

def rename_playlist(playlist_id, name):
    with _lock:
        data = _load()
        p = _find_playlist(data, playlist_id)
        if not p:
            return None
        p["name"] = name or p["name"]
        _save(data)
        return p

def delete_playlist(playlist_id):
    with _lock:
        data = _load()
        p = _find_playlist(data, playlist_id)
        if not p:
            return False
        if p.get("cover"):
            try:
                os.remove(os.path.join(PLAYLIST_COVERS_DIR, p["cover"]))
            except OSError:
                pass
        data["playlists"] = [x for x in data["playlists"] if x["id"] != playlist_id]
        _save(data)
        return True

def set_playlist_cover(playlist_id, filename):
    with _lock:
        data = _load()
        p = _find_playlist(data, playlist_id)
        if not p:
            return None
        old = p.get("cover")
        if old and old != filename:
            try:
                os.remove(os.path.join(PLAYLIST_COVERS_DIR, old))
            except OSError:
                pass
        p["cover"] = filename
        _save(data)
        return p

def add_to_playlist(playlist_id, track_id):
    with _lock:
        data = _load()
        p = _find_playlist(data, playlist_id)
        if not p or track_id in p["track_ids"]:
            return p
        p["track_ids"].append(track_id)
        _save(data)
        return p

def remove_from_playlist(playlist_id, track_id):
    with _lock:
        data = _load()
        p = _find_playlist(data, playlist_id)
        if not p:
            return None
        p["track_ids"] = [i for i in p["track_ids"] if i != track_id]
        _save(data)
        return p

def reorder_playlist(playlist_id, track_ids):
    with _lock:
        data = _load()
        p = _find_playlist(data, playlist_id)
        if not p:
            return None
        known = set(p["track_ids"])
        ordered = [i for i in track_ids if i in known]
        ordered += [i for i in p["track_ids"] if i not in set(ordered)]
        p["track_ids"] = ordered
        _save(data)
        return p