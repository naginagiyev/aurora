const Palette = (() => {
  const GOLD_HUES = [38, 42, 46, 34, 50];
  const cache = new Map();

  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }

  function analyse(img) {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);

    let data;
    try {
      data = ctx.getImageData(0, 0, size, size).data;
    } catch (e) {
      return null;
    }

    const buckets = new Array(24).fill(null).map(() => ({ n: 0, w: 0, s: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (l < 0.10 || l > 0.95 || s < 0.14) continue;
      const bucket = buckets[Math.floor(h / 15) % 24];
      bucket.n += 1;
      bucket.w += s * s;
      bucket.s += s;
    }

    const ranked = buckets
      .map((b, i) => ({ i, ...b }))
      .filter((b) => b.n > 0)
      .sort((x, y) => y.w - x.w);

    if (!ranked.length) return null;
    const top = ranked[0];
    return {
      hue: top.i * 15 + 7.5,
      sat: Math.min(0.85, Math.max(0.2, top.s / top.n)),
    };
  }

  function shellFrom(img) {
    const found = analyse(img);
    if (!found) return null;
    const sat = Math.min(0.55, Math.max(0.26, found.sat * 0.72));
    return {
      body: hslToHex(found.hue, sat, 0.215),
      deep: hslToHex(found.hue, Math.min(0.62, sat + 0.06), 0.085),
      hue: found.hue,
      sat,
    };
  }

  function fromCover(url) {
    if (!url) return Promise.resolve(null);
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const shell = shellFrom(img);
        cache.set(url, shell);
        resolve(shell);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function seeded(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 100000;
    const hue = GOLD_HUES[hash % GOLD_HUES.length];
    const light = 0.34 + ((hash >> 3) % 5) * 0.045;
    const sat = 0.42 + ((hash >> 7) % 4) * 0.07;
    return {
      a: hslToHex(hue, sat, light),
      b: hslToHex((hue + 16) % 360, sat * 0.72, Math.max(0.10, light - 0.20)),
    };
  }

  return { seeded, hslToHex, fromCover };
})();
