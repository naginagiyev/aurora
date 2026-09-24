const Player = (() => {
  const audio = document.getElementById('audio');
  const bar = document.getElementById('bar');
  const elArt = document.getElementById('bar-art');
  const elTitle = document.getElementById('bar-title');
  const elArtist = document.getElementById('bar-artist');
  const elNow = document.getElementById('t-now');
  const elEnd = document.getElementById('t-end');
  const seek = document.getElementById('seek');
  const seekFill = document.getElementById('seek-fill');
  const vol = document.getElementById('vol');
  const volFill = document.getElementById('vol-fill');
  const btnPlay = document.getElementById('btn-play');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnShuffle = document.getElementById('btn-shuffle');
  const btnRepeat = document.getElementById('btn-repeat');
  const btnMute = document.getElementById('btn-mute');

  let queue = [];
  let order = [];
  let pos = -1;
  let shuffle = false;
  let repeat = 'off';
  let connected = false;
  const listeners = new Set();

  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach((fn) => fn(current())); }

  function current() {
    return pos >= 0 && pos < order.length ? queue[order[pos]] : null;
  }

  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function buildOrder(startIndex) {
    order = queue.map((_, i) => i);
    if (shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (startIndex != null) {
        const at = order.indexOf(startIndex);
        if (at > 0) [order[0], order[at]] = [order[at], order[0]];
      }
    }
    pos = startIndex == null ? -1 : order.indexOf(startIndex);
  }

  function setQueue(tracks, startIndex) {
    queue = tracks.slice();
    buildOrder(startIndex == null ? 0 : startIndex);
  }

  function play(tracks, startIndex) {
    if (tracks) setQueue(tracks, startIndex);
    const track = current();
    if (!track) return;
    audio.src = API.streamUrl(track.id);
    audio.play().catch(() => {});
    paint(track);
    Lyrics.load(track.id);
    Visualizer.setTrack(track.title, track.artist);
    Visualizer.setCover(API.coverUrl(track.id));
    Visualizer.setProgress(0);
    save();
    emit();
  }

  function playAll(tracks, wantShuffle) {
    if (!tracks || !tracks.length) return;
    if (shuffle !== !!wantShuffle) {
      shuffle = !!wantShuffle;
      btnShuffle.classList.toggle('on', shuffle);
    }
    const start = wantShuffle ? Math.floor(Math.random() * tracks.length) : 0;
    play(tracks, start);
  }

  function paint(track) {
    bar.classList.toggle('idle', !track);
    if (!track) {
      elTitle.textContent = 'Nothing playing';
      elArtist.textContent = 'Pick something from your library';
      elArt.style.backgroundImage = '';
      return;
    }
    elTitle.textContent = track.title;
    elArtist.textContent = track.artist;
    elArt.style.backgroundImage = `url("${API.coverUrl(track.id)}")`;

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        artwork: [{ src: API.coverUrl(track.id), sizes: '640x640', type: 'image/jpeg' }],
      });
    }
  }

  function toggle() {
    if (!current()) return;
    if (audio.paused) {
      Visualizer.resume();
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function next(auto) {
    if (!queue.length) return;
    if (auto && repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (pos + 1 >= order.length) {
      if (repeat === 'all') pos = -1;
      else if (auto) { audio.pause(); return; }
      else pos = -1;
    }
    pos += 1;
    play();
  }

  function prev() {
    if (!queue.length) return;
    if (audio.currentTime > 4) { audio.currentTime = 0; return; }
    pos = pos - 1 < 0 ? order.length - 1 : pos - 1;
    play();
  }

  function seekTo(t) {
    if (!isFinite(t)) return;
    audio.currentTime = Math.max(0, t);
  }

  function currentTime() { return audio.currentTime || 0; }

  function relabel(trackId, title) {
    queue.forEach((t) => { if (t.id === trackId) t.title = title; });
    const track = current();
    if (track && track.id === trackId) {
      paint(track);
      Visualizer.setTrack(track.title, track.artist);
    }
  }

  function isPlaying(trackId) {
    const track = current();
    return !!track && track.id === trackId;
  }

  function save() {
    try {
      const track = current();
      localStorage.setItem('aurora', JSON.stringify({
        id: track ? track.id : null,
        t: audio.currentTime,
        v: audio.volume,
        shuffle,
        repeat,
      }));
    } catch (e) { /* storage unavailable */ }
  }

  function restore(tracks) {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('aurora') || 'null'); } catch (e) { state = null; }
    if (state) {
      setVolume(typeof state.v === 'number' ? state.v : 0.7);
      shuffle = !!state.shuffle;
      repeat = state.repeat || 'off';
      btnShuffle.classList.toggle('on', shuffle);
      btnRepeat.classList.toggle('on', repeat !== 'off');
      btnRepeat.classList.toggle('one', repeat === 'one');
    } else {
      setVolume(0.7);
    }
    if (!state || !state.id || !tracks.length) return;
    const idx = tracks.findIndex((t) => t.id === state.id);
    if (idx < 0) return;
    setQueue(tracks, idx);
    const track = current();
    audio.src = API.streamUrl(track.id);
    audio.currentTime = state.t || 0;
    paint(track);
    Lyrics.load(track.id);
    Visualizer.setTrack(track.title, track.artist);
    Visualizer.setCover(API.coverUrl(track.id));
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = state.t || 0;
    }, { once: true });
    emit();
  }

  function setVolume(v) {
    audio.volume = Math.min(1, Math.max(0, v));
    volFill.style.width = `${audio.volume * 100}%`;
    btnMute.classList.toggle('muted', audio.volume === 0);
  }

  function ratioFrom(event, el) {
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  }

  function dragger(el, onMove) {
    const move = (e) => onMove(ratioFrom(e, el));
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      move(e);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    elNow.textContent = fmt(audio.currentTime);
    elEnd.textContent = fmt(d);
    seekFill.style.width = d ? `${(audio.currentTime / d) * 100}%` : '0%';
    Visualizer.setProgress(d ? audio.currentTime / d : 0);
    Lyrics.sync(audio.currentTime);
  });

  audio.addEventListener('loadedmetadata', () => {
    elEnd.textContent = fmt(audio.duration || 0);
  });

  audio.addEventListener('play', () => {
    document.body.classList.add('playing');
    Visualizer.setPlaying(true);
    if (!connected) { Visualizer.connect(audio); connected = true; }
    Visualizer.resume();
    emit();
  });

  audio.addEventListener('pause', () => {
    document.body.classList.remove('playing');
    Visualizer.setPlaying(false);
    save();
    emit();
  });

  audio.addEventListener('ended', () => next(true));

  audio.addEventListener('error', () => {
    if (audio.src) UI.toast('That file could not be played.', true);
  });

  setInterval(() => { if (!audio.paused) save(); }, 5000);

  btnPlay.addEventListener('click', toggle);
  btnNext.addEventListener('click', () => next(false));
  btnPrev.addEventListener('click', prev);

  btnShuffle.addEventListener('click', () => {
    shuffle = !shuffle;
    btnShuffle.classList.toggle('on', shuffle);
    const track = current();
    buildOrder(track ? queue.indexOf(track) : 0);
    save();
    UI.toast(shuffle ? 'Shuffle on' : 'Shuffle off');
  });

  btnRepeat.addEventListener('click', () => {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    btnRepeat.classList.toggle('on', repeat !== 'off');
    btnRepeat.classList.toggle('one', repeat === 'one');
    save();
    UI.toast(repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one');
  });

  let lastVolume = 0.7;
  btnMute.addEventListener('click', () => {
    if (audio.volume > 0) { lastVolume = audio.volume; setVolume(0); }
    else setVolume(lastVolume || 0.7);
    save();
  });

  dragger(seek, (r) => {
    if (audio.duration) audio.currentTime = r * audio.duration;
  });
  dragger(vol, (r) => { setVolume(r); save(); });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); audio.currentTime += 5; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime -= 5; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume(audio.volume + 0.05); save(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume(audio.volume - 0.05); save(); }
    else if (e.key === 'n') next(false);
    else if (e.key === 'p') prev();
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => toggle());
    navigator.mediaSession.setActionHandler('pause', () => toggle());
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  }

  return {
    play, playAll, toggle, next, prev, seekTo, currentTime, current, isPlaying, relabel,
    restore, setQueue, on,
    get paused() { return audio.paused; },
  };
})();
