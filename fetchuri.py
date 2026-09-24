import re
from ddgs import DDGS

TRACK_URL = re.compile(
    r"https?://open\.spotify\.com/(?:intl-[a-z-]+/)?track/([A-Za-z0-9]{22})",
    re.IGNORECASE,
)

def extract_track_id(href):
    match = TRACK_URL.search(href or "")
    return match.group(1) if match else None

def get_spotify_uri(query, max_results=3):
    search_query = f"{query} site:open.spotify.com/track"
    for r in DDGS().text(search_query, max_results=max_results):
        track_id = extract_track_id(r.get("href"))
        if track_id:
            return track_id
    return None