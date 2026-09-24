const UI = (() => {
  const toasts = document.getElementById('toasts');
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('modal');

  function toast(message, bad) {
    const node = document.createElement('div');
    node.className = `toast${bad ? ' bad' : ''}`;
    node.textContent = message;
    toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 340);
    }, bad ? 4200 : 2400);
  }

  function closeModal() {
    overlay.hidden = true;
    modal.innerHTML = '';
  }

  function openModal(html, onReady) {
    modal.innerHTML = html;
    overlay.hidden = false;
    if (onReady) onReady(modal);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });

  function prompt(title, value, placeholder) {
    return new Promise((resolve) => {
      openModal(`
        <h2>${esc(title)}</h2>
        <input id="m-input" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}" autocomplete="off">
        <div class="modal-acts">
          <button class="btn" id="m-cancel">Cancel</button>
          <button class="btn accent" id="m-ok">Save</button>
        </div>`, (root) => {
        const input = root.querySelector('#m-input');
        input.focus();
        input.select();
        const done = (v) => { closeModal(); resolve(v); };
        root.querySelector('#m-cancel').onclick = () => done(null);
        root.querySelector('#m-ok').onclick = () => done(input.value.trim() || null);
        input.onkeydown = (e) => {
          if (e.key === 'Enter') done(input.value.trim() || null);
        };
      });
    });
  }

  function confirm(title, label) {
    return new Promise((resolve) => {
      openModal(`
        <h2>${esc(title)}</h2>
        <div class="modal-acts">
          <button class="btn" id="m-cancel">Cancel</button>
          <button class="btn danger" id="m-ok">${esc(label || 'Delete')}</button>
        </div>`, (root) => {
        root.querySelector('#m-cancel').onclick = () => { closeModal(); resolve(false); };
        root.querySelector('#m-ok').onclick = () => { closeModal(); resolve(true); };
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  return { toast, openModal, closeModal, prompt, confirm, esc };
})();

const Views = (() => {
  const view = document.getElementById('view');
  const esc = UI.esc;
  let state = { tracks: [], playlists: [] };
  let jobTimer = null;

  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M3 8h3l2-2h8l2 2h3v11H3z"/><circle cx="12" cy="13" r="3.4"/></svg>',
    search: '<svg class="mag" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M4 7h11M4 12h11M4 17h7"/><circle cx="18" cy="15" r="3"/><path d="M21 15V7"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
    dice: '<svg viewBox="0 0 24 24"><path d="M3 7h4l3 5M21 7h-5l-6 10H3M21 17h-5"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  };

  const STAGE_TEXT = {
    queued: 'Waiting in line',
    searching: 'Finding it on Spotify',
    info: 'Reading the details',
    cover: 'Fetching cover art',
    lyrics: 'Looking for lyrics',
    audio: 'Downloading audio',
    done: 'Ready',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  async function refresh() {
    state = await API.library();
    return state;
  }

  function trackById(id) {
    return state.tracks.find((t) => t.id === id);
  }

  function monogram(name) {
    return esc((name || '?').trim().charAt(0).toUpperCase() || '?');
  }

  function avatarStyle(playlist) {
    if (playlist.cover) {
      return `--art:url('${API.playlistCoverUrl(playlist.cover)}');background-image:url('${API.playlistCoverUrl(playlist.cover)}');background-size:cover;background-position:center`;
    }
    const c = Palette.seeded(playlist.id + playlist.name);
    return `background-image:linear-gradient(145deg,${c.a},${c.b})`;
  }

  function rowHtml(track, index, opts) {
    const playing = Player.isPlaying(track.id);
    const acts = [];
    if (opts && opts.playlistId) {
      acts.push(`<button data-act="remove" title="Remove from playlist">${ICON.x}</button>`);
    } else {
      acts.push(`<button data-act="rename" title="Rename song">${ICON.pen}</button>`);
      acts.push(`<button data-act="add" title="Add to playlist">${ICON.plus}</button>`);
      acts.push(`<button data-act="delete" title="Delete from library">${ICON.trash}</button>`);
    }
    const idx = playing
      ? '<div class="row-bars"><i></i><i></i><i></i></div>'
      : index + 1;
    return `
      <div class="row${playing ? ' on' : ''}" data-id="${esc(track.id)}" data-index="${index}" ${opts && opts.draggable ? 'draggable="true"' : ''}>
        <div class="row-idx">${idx}</div>
        <div class="row-art" style="background-image:url('${API.coverUrl(track.id)}')"></div>
        <div class="row-meta">
          <div class="row-title">${esc(track.title)}</div>
          <div class="row-artist">${esc(track.artist)}</div>
        </div>
        <div class="row-acts">${acts.join('')}</div>
      </div>`;
  }

  function bindRows(root, tracks, opts) {
    root.querySelectorAll('.row').forEach((row) => {
      const id = row.dataset.id;
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-act]')) return;
        Player.play(tracks, Number(row.dataset.index));
      });
      row.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'delete') {
            const track = trackById(id);
            if (!await UI.confirm(`Delete "${track ? track.title : 'this track'}" from your library?`)) return;
            await API.deleteTrack(id);
            UI.toast('Removed from library');
            await refresh();
            render();
          } else if (act === 'rename') {
            const track = trackById(id);
            const name = await UI.prompt('Rename song', track ? track.title : '', 'Song name');
            if (!name || (track && name === track.title)) return;
            try {
              await API.renameTrack(id, name);
              await refresh();
              if (Player.isPlaying(id)) Player.relabel(id, name);
              UI.toast('Renamed');
              render();
            } catch (err) {
              UI.toast(err.message, true);
            }
          } else if (act === 'add') {
            addToPlaylistDialog(id);
          } else if (act === 'remove') {
            await API.removeFromPlaylist(opts.playlistId, id);
            await refresh();
            render();
          }
        });
      });
    });
  }

  async function addToPlaylistDialog(trackId) {
    if (!state.playlists.length) {
      const name = await UI.prompt('Name your first playlist', '', 'Late nights');
      if (!name) return;
      const playlist = await API.createPlaylist(name);
      await API.addToPlaylist(playlist.id, trackId);
      await refresh();
      UI.toast(`Added to ${name}`);
      render();
      return;
    }
    const items = state.playlists.map((p) => `
      <button class="modal-item" data-id="${esc(p.id)}">
        <div class="av" style="${avatarStyle(p)}">${p.cover ? '' : monogram(p.name)}</div>
        <div>
          <div class="nm">${esc(p.name)}</div>
          <div class="ct">${p.track_ids.length} ${p.track_ids.length === 1 ? 'song' : 'songs'}</div>
        </div>
      </button>`).join('');

    UI.openModal(`
      <h2>Add to playlist</h2>
      <div class="modal-list">${items}</div>
      <div class="modal-acts"><button class="btn" id="m-new">New playlist</button></div>`, (root) => {
      root.querySelectorAll('.modal-item').forEach((btn) => {
        btn.onclick = async () => {
          UI.closeModal();
          const playlist = state.playlists.find((p) => p.id === btn.dataset.id);
          await API.addToPlaylist(btn.dataset.id, trackId);
          await refresh();
          UI.toast(`Added to ${playlist.name}`);
          render();
        };
      });
      root.querySelector('#m-new').onclick = async () => {
        UI.closeModal();
        const name = await UI.prompt('New playlist', '', 'Late nights');
        if (!name) return;
        const playlist = await API.createPlaylist(name);
        await API.addToPlaylist(playlist.id, trackId);
        await refresh();
        UI.toast(`Added to ${name}`);
        render();
      };
    });
  }

  function pickImage(playlistId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        await API.uploadCover(playlistId, file);
        await refresh();
        UI.toast('Playlist picture updated');
        render();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };
    input.click();
  }

  /* ---------- now playing ---------- */

  function renderNow() {
    const track = Player.current();
    if (!track) {
      view.innerHTML = `
        <div class="now">
          <div class="now-empty">
            <h1>Quiet in here</h1>
            <p>Search for a song in your library and the room will come alive.</p>
            <a class="btn accent" href="#/library">${ICON.search} Find something</a>
          </div>
        </div>`;
      Lyrics.unmount();
      Visualizer.unmount();
      return;
    }

    view.innerHTML = `
      <div class="now">
        <div class="stage">
          <div class="stage-glow"></div>
          <canvas id="orb"></canvas>
        </div>
        <div class="lyrics-wrap"><div id="lyrics"></div></div>
      </div>`;

    Visualizer.mount(view.querySelector('#orb'));
    Visualizer.setTrack(track.title, track.artist);
    Visualizer.setCover(API.coverUrl(track.id));
    Visualizer.setPlaying(!Player.paused);
    Lyrics.mount(view.querySelector('.lyrics-wrap'), view.querySelector('#lyrics'));
    Lyrics.load(track.id);
  }

  /* ---------- library ---------- */

  function jobHtml(job) {
    return `
      <div class="job ${esc(job.stage)}" data-job="${esc(job.id)}">
        <div class="job-spin"></div>
        <div class="job-body">
          <div class="job-title"></div>
          <div class="job-stage"></div>
          <div class="job-track"><div class="job-bar"></div></div>
        </div>
        <div class="job-pct"></div>
        <button class="job-x" data-act="cancel" title="Cancel">${ICON.x}</button>
      </div>`;
  }

  function jobLabel(job) {
    if (job.stage === 'failed') return job.error || 'Something went wrong';
    if (job.stage === 'cancelled') return 'Cancelled';
    if (job.stage === 'audio' && job.bytes_total) {
      const mb = (n) => (n / 1048576).toFixed(1);
      return `Downloading audio — ${mb(job.bytes_done)} / ${mb(job.bytes_total)} MB`;
    }
    return STAGE_TEXT[job.stage] || job.stage;
  }

  function paintJob(node, job) {
    const done = job.stage === 'failed' || job.stage === 'cancelled';
    node.className = `job ${job.stage}`;
    const title = job.title || job.query;
    node.querySelector('.job-title').textContent =
      title + (job.artist ? ` — ${job.artist}` : '');
    node.querySelector('.job-stage').textContent = jobLabel(job);
    node.querySelector('.job-bar').style.width = `${job.percent || 0}%`;
    node.querySelector('.job-pct').textContent = done ? '' : `${job.percent || 0}%`;
    const btn = node.querySelector('.job-x');
    btn.title = done ? 'Dismiss' : 'Cancel';
    btn.dataset.act = done ? 'dismiss' : 'cancel';
  }

  function renderLibrary(prefill) {
    const tracks = state.tracks.slice().sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
    view.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div class="eyebrow">Library</div>
          <h1>${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}</h1>
        </div>
        <div class="searchbar">
          ${ICON.search}
          <input id="q" placeholder="Search a song to download — try “kanye west - power”" autocomplete="off" spellcheck="false">
          <span class="hint">Enter</span>
        </div>
        <div class="jobs" id="jobs"></div>
        ${tracks.length ? `
        <div class="lib-bar">
          <button class="chip gold" id="play-order">${ICON.play} Play in order</button>
          <button class="chip" id="play-random">${ICON.dice} Shuffle</button>
          <div class="spacer"></div>
        </div>` : ''}
        <div class="rows" id="rows">
          ${tracks.length ? tracks.map((t, i) => rowHtml(t, i)).join('') : ''}
        </div>
        ${tracks.length ? '' : `
          <div class="empty">
            ${ICON.note}
            <p>Nothing here yet. Type an artist and song above, and it will land in your library.</p>
          </div>`}
      </div>`;

    bindRows(view, tracks);

    const inOrder = view.querySelector('#play-order');
    if (inOrder) {
      inOrder.addEventListener('click', () => Player.playAll(tracks, false));
      view.querySelector('#play-random').addEventListener('click', () => Player.playAll(tracks, true));
    }

    const input = view.querySelector('#q');
    if (prefill) {
      input.value = prefill;
      setTimeout(() => { input.focus(); input.select(); }, 60);
    }
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const query = input.value.trim();
      if (!query) return;
      input.value = '';
      try {
        await API.download(query);
        pollJobs();
      } catch (err) {
        UI.toast(err.message, true);
      }
    });

    pollJobs();
  }

  async function pollJobs() {
    if (!document.getElementById('jobs')) {
      if (jobTimer) { clearTimeout(jobTimer); jobTimer = null; }
      return;
    }
    let jobs = [];
    try { jobs = await API.jobs(); } catch (e) { jobs = []; }

    const box = document.getElementById('jobs');
    if (!box) return;

    const live = jobs.filter((j) => j.stage !== 'done');
    const seen = new Set();

    live.forEach((job) => {
      seen.add(job.id);
      let node = box.querySelector(`[data-job="${job.id}"]`);
      if (!node) {
        box.insertAdjacentHTML('beforeend', jobHtml(job));
        node = box.querySelector(`[data-job="${job.id}"]`);
        node.querySelector('.job-x').onclick = async () => {
          const act = node.querySelector('.job-x').dataset.act;
          if (act === 'cancel') {
            await API.cancelJob(job.id);
            UI.toast('Download cancelled');
          } else {
            node.remove();
            await API.clearJobs();
          }
          pollJobs();
        };
      }
      paintJob(node, job);
    });

    box.querySelectorAll('[data-job]').forEach((node) => {
      if (!seen.has(node.dataset.job)) node.remove();
    });

    const finished = jobs.filter((j) => j.stage === 'done');
    if (finished.length) {
      const known = new Set(state.tracks.map((t) => t.id));
      await API.clearJobs();
      await refresh();
      const added = state.tracks.filter((t) => !known.has(t.id));
      added.forEach((t) => UI.toast(`${t.title} — ${t.artist} is ready`));
      const rows = document.getElementById('rows');
      if (rows && location.hash.replace('#', '') === '/library') {
        renderLibrary();
        return;
      }
    }

    if (jobTimer) clearTimeout(jobTimer);
    if (live.some((j) => j.stage !== 'failed' && j.stage !== 'cancelled')) {
      jobTimer = setTimeout(pollJobs, 700);
    }
  }

  /* ---------- playlists ---------- */

  function renderPlaylists() {
    const cards = state.playlists.map((p) => `
      <div class="tile" data-id="${esc(p.id)}">
        <div class="card" style="${avatarStyle(p)}">
          <button class="card-del" data-act="del" title="Delete playlist">${ICON.trash}</button>
          ${p.cover ? '' : `<span class="mono">${monogram(p.name)}</span>`}
          <div class="card-edit" data-act="cover">
            ${ICON.camera}
            <span>${p.cover ? 'Change photo' : 'Add photo'}</span>
          </div>
        </div>
        <div class="tile-name">${esc(p.name)}</div>
        <div class="tile-count">${p.track_ids.length} ${p.track_ids.length === 1 ? 'song' : 'songs'}</div>
      </div>`).join('');

    view.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div class="eyebrow">Playlists</div>
          <h1>Your collections</h1>
          <div class="sub">Hover a cover to change its photo.</div>
        </div>
        <div class="grid">
          ${cards}
          <div class="tile">
            <div class="card new" id="new-playlist">
              <div class="card-new-in">${ICON.plus}<span>New playlist</span></div>
            </div>
          </div>
        </div>
      </div>`;

    view.querySelectorAll('.tile[data-id]').forEach((tile) => {
      const id = tile.dataset.id;
      tile.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'cover') { e.stopPropagation(); pickImage(id); return; }
        if (act && act.dataset.act === 'del') { e.stopPropagation(); removePlaylist(id); return; }
        location.hash = `#/playlist/${id}`;
      });
    });

    view.querySelector('#new-playlist').addEventListener('click', async () => {
      const name = await UI.prompt('New playlist', '', 'Late nights');
      if (!name) return;
      await API.createPlaylist(name);
      await refresh();
      render();
    });
  }

  async function removePlaylist(id) {
    const playlist = state.playlists.find((p) => p.id === id);
    if (!await UI.confirm(`Delete the playlist "${playlist ? playlist.name : ''}"?`)) return;
    await API.deletePlaylist(id);
    await refresh();
    UI.toast('Playlist deleted');
    render();
  }

  function renderPlaylist(id) {
    const playlist = state.playlists.find((p) => p.id === id);
    if (!playlist) {
      location.hash = '#/playlists';
      return;
    }
    const tracks = playlist.track_ids.map(trackById).filter(Boolean);

    view.innerHTML = `
      <div class="page">
        <div class="pl-head">
          <div class="pl-art" id="pl-art" style="${avatarStyle(playlist)}">
            ${playlist.cover ? '' : `<span class="mono">${monogram(playlist.name)}</span>`}
            <span class="edit">${ICON.camera}</span>
          </div>
          <div class="pl-info">
            <div class="eyebrow">Playlist</div>
            <h1 class="pl-name" contenteditable="plaintext-only" spellcheck="false">${esc(playlist.name)}</h1>
            <div class="sub">${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}</div>
            <div class="pl-actions">
              <button class="btn accent" id="pl-play">${ICON.play} Play all</button>
              <button class="btn danger" id="pl-del">${ICON.trash} Delete</button>
            </div>
          </div>
        </div>
        <div class="rows" id="rows">
          ${tracks.map((t, i) => rowHtml(t, i, { playlistId: id, draggable: true })).join('')}
        </div>
        ${tracks.length ? '' : `
          <div class="empty">
            ${ICON.list}
            <p>This playlist is empty. Add songs from your library using the + button.</p>
          </div>`}
      </div>`;

    bindRows(view, tracks, { playlistId: id });

    view.querySelector('#pl-art').addEventListener('click', () => pickImage(id));
    view.querySelector('#pl-del').addEventListener('click', () => removePlaylist(id));
    view.querySelector('#pl-play').addEventListener('click', () => {
      if (tracks.length) Player.play(tracks, 0);
    });

    const name = view.querySelector('.pl-name');
    const commit = async () => {
      const value = name.textContent.trim();
      if (!value || value === playlist.name) { name.textContent = playlist.name; return; }
      await API.renamePlaylist(id, value);
      await refresh();
      UI.toast('Renamed');
    };
    name.addEventListener('blur', commit);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') { name.textContent = playlist.name; name.blur(); }
    });

    enableDrag(view.querySelector('#rows'), id);
  }

  function enableDrag(root, playlistId) {
    if (!root) return;
    let dragged = null;
    root.querySelectorAll('.row').forEach((row) => {
      row.addEventListener('dragstart', () => {
        dragged = row;
        row.classList.add('drag');
      });
      row.addEventListener('dragend', async () => {
        row.classList.remove('drag');
        root.querySelectorAll('.row').forEach((r) => r.classList.remove('over'));
        const ids = [...root.querySelectorAll('.row')].map((r) => r.dataset.id);
        await API.reorderPlaylist(playlistId, ids);
        await refresh();
        render();
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragged || dragged === row) return;
        row.classList.add('over');
        const rect = row.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        root.insertBefore(dragged, after ? row.nextSibling : row);
      });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
    });
  }

  /* ---------- router ---------- */

  function render() {
    const raw = (location.hash || '#/').replace('#', '');
    const qAt = raw.indexOf('?');
    const route = qAt === -1 ? raw : raw.slice(0, qAt);
    const params = new URLSearchParams(qAt === -1 ? '' : raw.slice(qAt + 1));
    document.querySelectorAll('.rail-link').forEach((a) => {
      const target = a.dataset.route;
      a.classList.toggle('on', route === target || (target === '/playlists' && route.startsWith('/playlist/')));
    });

    if (route !== '/') Visualizer.unmount();
    if (route !== '/') Lyrics.unmount();

    if (route.startsWith('/playlist/')) renderPlaylist(route.split('/')[2]);
    else if (route === '/playlists') renderPlaylists();
    else if (route === '/library') renderLibrary(params.get('q') || '');
    else renderNow();
  }

  return { render, refresh, pollJobs, get state() { return state; } };
})();
