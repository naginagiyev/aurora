import re
import requests

def get_track_info(track_url):
    oembed = requests.get("https://open.spotify.com/oembed", params={"url": track_url}).json()
    page = requests.get(track_url).text

    title = oembed.get("title")
    cover_url = oembed.get("thumbnail_url")

    match = re.search(r'<meta property="og:description" content="([^"]+)"', page)
    artist = None
    if match:
        artist = match.group(1).split(" · ")[0]

    return {
        "title": title,
        "artist": artist,
        "cover_url": cover_url
    }

def download_cover(cover_url, filename="cover.jpg"):
    if not cover_url:
        return None
    img_data = requests.get(cover_url).content
    with open(filename, "wb") as f:
        f.write(img_data)
    return filename