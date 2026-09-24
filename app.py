import os
import re
import library
import pipeline
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE, "web")
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
LRC_LINE = re.compile(r"((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)")
LRC_TAG = re.compile(r"\[(\d+):(\d+)(?:[.:](\d+))?\]")

app = Flask(__name__, static_folder=None)
library.ensure_dirs()

def _safe_id(value):
    if not value or not re.fullmatch(r"[A-Za-z0-9]{1,40}", value):
        abort(404)
    return value

@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")

@app.route("/css/<path:filename>")
def css(filename):
    return send_from_directory(os.path.join(WEB_DIR, "css"), filename)

@app.route("/js/<path:filename>")
def js(filename):
    return send_from_directory(os.path.join(WEB_DIR, "js"), filename)

@app.get("/api/library")
def api_library():
    return jsonify(library.snapshot())

@app.post("/api/download")
def api_download():
    query = (request.get_json(silent=True) or {}).get("query", "").strip()
    if not query:
        return jsonify({"error": "Empty search."}), 400
    return jsonify(pipeline.enqueue(query))

@app.get("/api/jobs")
def api_jobs():
    return jsonify(pipeline.jobs())

@app.post("/api/jobs/<job_id>/cancel")
def api_job_cancel(job_id):
    return jsonify({"ok": pipeline.cancel(job_id)})

@app.post("/api/jobs/clear")
def api_jobs_clear():
    pipeline.clear_finished()
    return jsonify({"ok": True})

@app.get("/api/stream/<track_id>")
def api_stream(track_id):
    path = os.path.join(library.SONGS_DIR, _safe_id(track_id) + ".mp3")
    if not os.path.exists(path):
        abort(404)
    return send_file(path, mimetype="audio/mpeg", conditional=True)

@app.get("/api/cover/<track_id>")
def api_cover(track_id):
    path = os.path.join(library.COVERS_DIR, _safe_id(track_id) + ".jpg")
    if not os.path.exists(path):
        abort(404)
    return send_file(path, mimetype="image/jpeg", conditional=True)

@app.get("/api/lyrics/<track_id>")
def api_lyrics(track_id):
    path = os.path.join(library.LYRICS_DIR, _safe_id(track_id) + ".lrc")
    if not os.path.exists(path):
        return jsonify({"synced": False, "lines": []})
    with open(path, encoding="utf-8", errors="ignore") as f:
        raw = f.read()

    synced = []
    plain = []
    for line in raw.splitlines():
        match = LRC_LINE.match(line.strip())
        if match:
            text = match.group(2).strip()
            for tag in LRC_TAG.finditer(match.group(1)):
                minutes, seconds, frac = tag.groups()
                t = int(minutes) * 60 + int(seconds)
                if frac:
                    t += int(frac) / (10 ** len(frac))
                synced.append({"t": round(t, 2), "text": text})
        elif line.strip() and not line.strip().startswith("["):
            plain.append(line.strip())

    if synced:
        synced.sort(key=lambda x: x["t"])
        return jsonify({"synced": True, "lines": synced})
    return jsonify({"synced": False, "lines": [{"t": None, "text": t} for t in plain]})

@app.patch("/api/tracks/<track_id>")
def api_rename_track(track_id):
    title = ((request.get_json(silent=True) or {}).get("title") or "").strip()
    if not title:
        return jsonify({"error": "Name cannot be empty."}), 400
    result = library.rename_track(_safe_id(track_id), title[:200])
    if not result:
        abort(404)
    return jsonify(result)

@app.delete("/api/tracks/<track_id>")
def api_delete_track(track_id):
    library.remove_track(_safe_id(track_id))
    return jsonify({"ok": True})

@app.get("/api/playlists")
def api_playlists():
    return jsonify(library.snapshot()["playlists"])

@app.post("/api/playlists")
def api_create_playlist():
    name = (request.get_json(silent=True) or {}).get("name", "").strip()
    return jsonify(library.create_playlist(name))

@app.patch("/api/playlists/<playlist_id>")
def api_patch_playlist(playlist_id):
    body = request.get_json(silent=True) or {}
    if "track_ids" in body:
        result = library.reorder_playlist(_safe_id(playlist_id), body["track_ids"])
    else:
        result = library.rename_playlist(_safe_id(playlist_id), (body.get("name") or "").strip())
    if not result:
        abort(404)
    return jsonify(result)

@app.delete("/api/playlists/<playlist_id>")
def api_delete_playlist(playlist_id):
    if not library.delete_playlist(_safe_id(playlist_id)):
        abort(404)
    return jsonify({"ok": True})

@app.post("/api/playlists/<playlist_id>/cover")
def api_playlist_cover(playlist_id):
    playlist_id = _safe_id(playlist_id)
    upload = request.files.get("image")
    if not upload or not upload.filename:
        return jsonify({"error": "No image provided."}), 400
    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({"error": "Unsupported image type."}), 400
    filename = f"{playlist_id}{ext}"
    upload.save(os.path.join(library.PLAYLIST_COVERS_DIR, filename))
    result = library.set_playlist_cover(playlist_id, filename)
    if not result:
        abort(404)
    return jsonify(result)

@app.get("/api/playlist-cover/<filename>")
def api_playlist_cover_file(filename):
    if "/" in filename or "\\" in filename or ".." in filename:
        abort(404)
    path = os.path.join(library.PLAYLIST_COVERS_DIR, filename)
    if not os.path.exists(path):
        abort(404)
    return send_file(path, conditional=True)

@app.post("/api/playlists/<playlist_id>/tracks")
def api_playlist_add(playlist_id):
    track_id = (request.get_json(silent=True) or {}).get("track_id", "")
    result = library.add_to_playlist(_safe_id(playlist_id), _safe_id(track_id))
    if not result:
        abort(404)
    return jsonify(result)

@app.delete("/api/playlists/<playlist_id>/tracks/<track_id>")
def api_playlist_remove(playlist_id, track_id):
    result = library.remove_from_playlist(_safe_id(playlist_id), _safe_id(track_id))
    if not result:
        abort(404)
    return jsonify(result)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True, debug=False)