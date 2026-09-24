import os
import time
import uuid
import queue
import library
import threading
from fetchlyrics import get_lyrics
from fetchuri import get_spotify_uri
from fetchaudio import SpotiDownloader
from fetchcover import get_track_info, download_cover
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

AUDIO_SPAN = 62
WEIGHTS = {"queued": 0, "searching": 4, "info": 14, "cover": 22, "lyrics": 30, "audio": 38}

_jobs = {}
_jobs_lock = threading.Lock()
_queue = queue.Queue()
_worker = None
_worker_lock = threading.Lock()
_downloader = None

def _set(job_id, **fields):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)
            job["updated_at"] = time.time()

def _stage(job_id, stage):
    _set(job_id, stage=stage, percent=WEIGHTS.get(stage, 0))

def _cancelled(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return bool(job and job.get("cancel"))

def jobs():
    with _jobs_lock:
        return sorted(_jobs.values(), key=lambda j: j["created_at"])

def cancel(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job["stage"] in ("done", "failed", "cancelled"):
            return False
        job["cancel"] = True
        if job["stage"] == "queued":
            job["stage"] = "cancelled"
            job["percent"] = 0
        return True

def clear_finished():
    with _jobs_lock:
        for job_id in [k for k, v in _jobs.items() if v["stage"] in ("done", "failed", "cancelled")]:
            del _jobs[job_id]

def _get_downloader():
    global _downloader
    if _downloader is None:
        _downloader = SpotiDownloader()
    return _downloader

def _reset_downloader():
    global _downloader
    if _downloader is not None:
        try:
            _downloader.close()
        except Exception:
            pass
    _downloader = None

def _cleanup(track_id):
    for path in (
        os.path.join(library.SONGS_DIR, track_id + ".mp3"),
        os.path.join(library.COVERS_DIR, track_id + ".jpg"),
        os.path.join(library.LYRICS_DIR, track_id + ".lrc"),
    ):
        try:
            os.remove(path)
        except OSError:
            pass

def _download_error(exc):
    if isinstance(exc, PlaywrightTimeoutError):
        return "The download site did not respond in time. Try again."
    detail = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    label = f"Download failed: {exc.__class__.__name__}"
    return f"{label} - {detail[:160]}" if detail else label

def _run(job):
    job_id = job["id"]
    query = job["query"]

    if _cancelled(job_id):
        _set(job_id, stage="cancelled")
        return

    _stage(job_id, "searching")
    try:
        uri = get_spotify_uri(query)
    except Exception:
        _set(job_id, stage="failed",
             error="Search is busy right now. Wait a moment and try again.")
        return
    if not uri:
        _set(job_id, stage="failed", error="No Spotify track found for that search.")
        return
    if _cancelled(job_id):
        _set(job_id, stage="cancelled")
        return

    if library.track_exists(uri):
        existing = library.get_track(uri)
        _set(job_id, stage="done", percent=100, track_id=uri,
             title=existing["title"], artist=existing["artist"], duplicate=True)
        return

    _stage(job_id, "info")
    _set(job_id, track_id=uri)
    info = get_track_info(f"https://open.spotify.com/track/{uri}")
    title = info.get("title") or query
    artist = info.get("artist") or "Unknown artist"
    _set(job_id, title=title, artist=artist)
    if _cancelled(job_id):
        _set(job_id, stage="cancelled")
        return

    _stage(job_id, "cover")
    try:
        download_cover(info.get("cover_url"), os.path.join(library.COVERS_DIR, uri + ".jpg"))
    except Exception:
        pass
    if _cancelled(job_id):
        _cleanup(uri)
        _set(job_id, stage="cancelled")
        return

    _stage(job_id, "lyrics")
    try:
        get_lyrics(f"{artist} {title}", save_path=os.path.join(library.LYRICS_DIR, uri + ".lrc"))
    except Exception:
        pass
    if _cancelled(job_id):
        _cleanup(uri)
        _set(job_id, stage="cancelled")
        return

    _stage(job_id, "audio")
    path = os.path.join(library.SONGS_DIR, uri + ".mp3")

    def on_progress(done, total):
        if _cancelled(job_id):
            return False
        if total:
            _set(job_id, percent=WEIGHTS["audio"] + int(done / total * AUDIO_SPAN),
                 bytes_done=done, bytes_total=total)
        else:
            _set(job_id, bytes_done=done, bytes_total=0)
        return True

    try:
        _get_downloader().download_song(title, artist, uri, path=path, progress=on_progress)
    except Exception as exc:
        _reset_downloader()
        _cleanup(uri)
        _set(job_id, stage="failed", error=_download_error(exc))
        return

    if _cancelled(job_id):
        _cleanup(uri)
        _set(job_id, stage="cancelled")
        return

    if not os.path.exists(path) or os.path.getsize(path) == 0:
        _cleanup(uri)
        _set(job_id, stage="failed", error="The download service returned no audio.")
        return

    library.add_track({
        "id": uri,
        "title": title,
        "artist": artist,
        "uri": uri,
        "has_cover": os.path.exists(os.path.join(library.COVERS_DIR, uri + ".jpg")),
        "has_lyrics": os.path.exists(os.path.join(library.LYRICS_DIR, uri + ".lrc")),
    })
    _set(job_id, stage="done", percent=100, track_id=uri)

def _loop():
    while True:
        job = _queue.get()
        try:
            if job["stage"] == "cancelled":
                continue
            _run(job)
        except Exception as exc:
            _set(job["id"], stage="failed", error=f"{exc.__class__.__name__}: {exc}")
        finally:
            _queue.task_done()

def _ensure_worker():
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, daemon=True)
            _worker.start()

def enqueue(query):
    library.ensure_dirs()
    _ensure_worker()
    job = {
        "id": uuid.uuid4().hex[:12],
        "query": query,
        "stage": "queued",
        "percent": 0,
        "title": query,
        "artist": "",
        "track_id": None,
        "error": None,
        "cancel": False,
        "bytes_done": 0,
        "bytes_total": 0,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    with _jobs_lock:
        _jobs[job["id"]] = job
    _queue.put(job)
    return job