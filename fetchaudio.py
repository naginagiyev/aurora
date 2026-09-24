import os
import requests
from playwright.sync_api import sync_playwright

DOWNLOAD_BUTTON = (
    "#download-section > div > div > div > div.mb-3.grid-container"
    " > div:nth-child(3) > form > div > button"
)
LINK_TIMEOUT = 120000

class SpotiDownloader:
    def __init__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        self.context = self.browser.new_context(viewport={"width": 1920, "height": 1080})
        self.page = self.context.new_page()
        self.page.set_default_timeout(30000)

    def download_song(self, name: str, author: str, uri: str, path: str = None, progress=None):
        self.page.goto("https://spotidown.app/")
        self.page.fill("#url", f"https://open.spotify.com/track/{uri}")
        self.page.click("#send")
        self.page.click(DOWNLOAD_BUTTON)
        popup = self.page.locator("#popup").first
        popup.wait_for(state="attached", timeout=LINK_TIMEOUT)
        download_url = popup.get_attribute("href")
        path = path or f"./songs/{name} by {author}.wav"
        if download_url:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://spotidown.app/"}
            r = requests.get(download_url, headers=headers, stream=True)
            if r.status_code == 200:
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                with open(path, "wb") as f:
                    for chunk in r.iter_content(65536):
                        f.write(chunk)
                        done += len(chunk)
                        if progress and not progress(done, total):
                            return None
                return path

    def close(self):
        self.browser.close()
        self.playwright.stop()