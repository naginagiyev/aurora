(async () => {
  try {
    await Views.refresh();
  } catch (e) {
    UI.toast('Could not reach the server.', true);
  }

  Player.restore(Views.state.tracks);
  Views.render();

  window.addEventListener('hashchange', Views.render);

  Player.on(() => {
    const route = (location.hash || '#/').replace('#', '');
    if (route === '/' ) {
      if (!document.getElementById('orb')) Views.render();
      else {
        const track = Player.current();
        const meta = document.querySelector('.stage-meta');
        if (track && meta) {
          meta.querySelector('.t').textContent = track.title;
          meta.querySelector('.a').textContent = track.artist;
        }
      }
    } else {
      document.querySelectorAll('.row').forEach((row) => {
        const on = Player.isPlaying(row.dataset.id);
        row.classList.toggle('on', on);
        const idx = row.querySelector('.row-idx');
        if (on && !idx.querySelector('.row-bars')) {
          idx.innerHTML = '<div class="row-bars"><i></i><i></i><i></i></div>';
        } else if (!on && idx.querySelector('.row-bars')) {
          idx.textContent = String(Number(row.dataset.index) + 1);
        }
      });
    }
  });

  document.getElementById('rail-search').addEventListener('click', () => {
    location.hash = '#/library';
    setTimeout(() => {
      const input = document.getElementById('q');
      if (input) input.focus();
    }, 80);
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.key === '/') {
      e.preventDefault();
      location.hash = '#/library';
      setTimeout(() => {
        const input = document.getElementById('q');
        if (input) input.focus();
      }, 80);
    }
  });

  Views.pollJobs();
})();
