const Lyrics = (() => {
  let lines = [];
  let synced = false;
  let el = null;
  let wrap = null;
  let nodes = [];
  let active = -1;
  let token = 0;

  function mount(wrapEl, listEl) {
    wrap = wrapEl;
    el = listEl;
    render();
  }

  function unmount() {
    wrap = null;
    el = null;
    nodes = [];
  }

  async function load(trackId) {
    const mine = ++token;
    lines = [];
    synced = false;
    active = -1;
    render();
    if (!trackId) return;
    try {
      const data = await API.lyrics(trackId);
      if (mine !== token) return;
      lines = data.lines || [];
      synced = !!data.synced;
      if (synced && lines.length && lines[0].t > 4) {
        lines.unshift({ t: 0, text: '' });
      }
    } catch (e) {
      lines = [];
      synced = false;
    }
    if (mine !== token) return;
    render();
    if (synced) sync(Player.currentTime());
  }

  function render() {
    if (!el) return;
    el.innerHTML = '';
    nodes = [];

    if (!lines.length) {
      el.style.transform = 'none';
      el.classList.remove('lyrics-static');
      wrap.classList.add('bare');
      el.innerHTML = `
        <div class="lyrics-none">
          <div class="notes">
            <span class="note n1">&#9834;</span>
            <span class="note n2">&#9835;</span>
            <span class="note n3">&#9833;</span>
            <span class="note n4">&#9836;</span>
            <span class="note n5">&#9834;</span>
            <span class="note-main">&#9834;</span>
          </div>
          <p>No lyrics for this one.<br>Just listen.</p>
        </div>`;
      return;
    }

    wrap.classList.remove('bare');
    el.classList.toggle('lyrics-static', !synced);

    lines.forEach((line, i) => {
      const node = document.createElement('div');
      const blank = !line.text || !line.text.trim();
      node.className = blank ? 'lyric inst' : 'lyric';
      if (blank) {
        node.innerHTML = '<span>&#9834;</span><span>&#9835;</span><span>&#9834;</span>';
      } else {
        node.textContent = line.text;
      }
      if (synced) {
        node.addEventListener('click', () => Player.seekTo(line.t));
      }
      el.appendChild(node);
      nodes.push(node);
      void i;
    });

    if (synced) {
      active = -1;
      sync(0);
    } else {
      el.style.transform = 'translateY(-8%)';
    }
  }

  function indexFor(time) {
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= time + 0.18) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return found;
  }

  function sync(time) {
    if (!synced || !el || !nodes.length) return;
    const i = indexFor(time);
    if (i === active) return;
    active = i;

    nodes.forEach((node, n) => {
      const d = Math.abs(n - i);
      node.classList.toggle('on', n === i);
      node.classList.toggle('near', d === 1);
      node.classList.toggle('far', d === 2 || d === 3);
      node.classList.toggle('faraway', d > 3);
    });

    const target = nodes[Math.max(0, i)];
    if (!target) return;
    const offset = target.offsetTop + target.offsetHeight / 2;
    el.style.transform = `translateY(${-offset}px)`;
  }

  function has() {
    return lines.length > 0;
  }

  return { mount, unmount, load, sync, has, get synced() { return synced; } };
})();
