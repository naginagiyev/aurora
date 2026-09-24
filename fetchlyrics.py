import syncedlyrics

def get_lyrics(query, save_path):
    return syncedlyrics.search(query, save_path=save_path)