const API = (() => {
  async function req(method, url, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  return {
    library: () => req('GET', '/api/library'),
    download: (query) => req('POST', '/api/download', { query }),
    jobs: () => req('GET', '/api/jobs'),
    clearJobs: () => req('POST', '/api/jobs/clear'),
    cancelJob: (id) => req('POST', `/api/jobs/${id}/cancel`),
    lyrics: (id) => req('GET', `/api/lyrics/${id}`),
    renameTrack: (id, title) => req('PATCH', `/api/tracks/${id}`, { title }),
    deleteTrack: (id) => req('DELETE', `/api/tracks/${id}`),
    createPlaylist: (name) => req('POST', '/api/playlists', { name }),
    renamePlaylist: (id, name) => req('PATCH', `/api/playlists/${id}`, { name }),
    reorderPlaylist: (id, track_ids) => req('PATCH', `/api/playlists/${id}`, { track_ids }),
    deletePlaylist: (id) => req('DELETE', `/api/playlists/${id}`),
    addToPlaylist: (id, track_id) => req('POST', `/api/playlists/${id}/tracks`, { track_id }),
    removeFromPlaylist: (id, track_id) => req('DELETE', `/api/playlists/${id}/tracks/${track_id}`),
    uploadCover: (id, file) => {
      const fd = new FormData();
      fd.append('image', file);
      return req('POST', `/api/playlists/${id}/cover`, fd);
    },
    coverUrl: (id) => `/api/cover/${id}`,
    streamUrl: (id) => `/api/stream/${id}`,
    playlistCoverUrl: (f) => `/api/playlist-cover/${f}`,
  };
})();
