import os
import sys
import time
import socket
import subprocess
import webbrowser
import urllib.parse

PORT = 5000
HOST = "127.0.0.1"
BASE = os.path.dirname(os.path.abspath(__file__))

def listening():
    with socket.socket() as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((HOST, PORT)) == 0

def start_server():
    exe = os.path.join(BASE, ".venv", "Scripts", "pythonw.exe")
    if not os.path.exists(exe):
        exe = sys.executable
    flags = 0
    if os.name == "nt":
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(
        [exe, os.path.join(BASE, "app.py")],
        cwd=BASE, creationflags=flags, close_fds=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

def main():
    query = " ".join(sys.argv[1:]).strip()

    if listening():
        print("Aurora is already running.")
    else:
        print("Starting Aurora...")
        start_server()
        for _ in range(80):
            if listening():
                break
            time.sleep(0.25)
        else:
            print("Aurora did not start. Try running app.py directly to see the error.")
            return 1

    url = f"http://{HOST}:{PORT}/"
    if query:
        url += "#/library?q=" + urllib.parse.quote(query)
    print(f"Opening {url}")
    webbrowser.open(url)
    return 0

if __name__ == "__main__":
    sys.exit(main())