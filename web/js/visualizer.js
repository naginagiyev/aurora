const Visualizer = (() => {
  let renderer, scene, camera, raf, canvas;
  let cassette, reelL, reelR, labelTex, packL, packR;
  let bodyMat, backMat;
  let shell = null;
  let analyser, freq, audioCtx, source;
  let mode = null;
  let ctx2d;
  let track = { title: '', artist: '' };
  let progress = 0;
  let spinning = false;
  let spin = 0;
  let angL = 0;
  let angR = 0;
  let last = 0;
  let reduced = false;
  let fontReady = false;
  const bands = { bass: 0, mid: 0, treble: 0 };
  const smooth = { bass: 0, mid: 0, treble: 0 };

  const GOLD = 0xd9a441;
  const W = 2.0;
  const H = 1.30;
  const D = 0.24;
  const BEVEL = 0.012;
  const FRONT = D / 2 + BEVEL;
  const PAPER_W = 1.80;
  const PAPER_H = 0.62;
  const PAPER_Y = 0.36;
  const WELL_W = 1.52;
  const WELL_H = 0.52;
  const WELL_Y = -0.20;
  const REEL_X = 0.37;
  const REEL_Y = -0.19;
  const R_MIN = 0.068;
  const R_MAX = 0.170;
  const INSIDE_Z = -0.045;

  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 1800;
  labelCanvas.height = 620;

  const glassCanvas = document.createElement('canvas');
  glassCanvas.width = 512;
  glassCanvas.height = 256;

  const PACK_VERT = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const PACK_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform float uRadius;
    uniform float uAngle;

    void main(){
      vec2 p = (vUv - 0.5) * 2.0;
      float d = length(p);
      if (d > 1.0) discard;

      float r = d * uRadius;
      float rings = sin(r * 620.0);
      float w = fwidth(r) * 620.0;
      rings /= (1.0 + w * w * 2.0);

      vec3 base = mix(vec3(0.080, 0.058, 0.041), vec3(0.205, 0.152, 0.106), 0.5 + 0.5 * rings);

      float a = atan(p.y, p.x) + uAngle;
      float sheen = pow(abs(cos(a * 0.5)), 3.0) * smoothstep(0.25, 1.0, d);
      base += vec3(0.20, 0.15, 0.09) * sheen * 0.38;

      float edge = smoothstep(0.90, 1.0, d);
      base = mix(base, vec3(0.042, 0.030, 0.022), edge * 0.8);

      float inner = 1.0 - smoothstep(0.0, 0.34, d);
      base = mix(base, vec3(0.030, 0.022, 0.016), inner * 0.6);

      gl_FragColor = vec4(base, 1.0);
    }
  `;

  function ensureFont() {
    if (fontReady || !document.fonts) return Promise.resolve();
    return Promise.all([
      document.fonts.load('600 96px Caveat'),
      document.fonts.load('500 56px Caveat'),
    ]).then(() => { fontReady = true; }).catch(() => {});
  }

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function hashOf(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function edgePoints(ax, ay, bx, by, segs, amp, bias, rand) {
    const pts = [];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const taper = 0.35 + 0.65 * Math.sin(Math.PI * t);
      let j = (rand() * 2 - 1) * amp * taper;
      if (rand() > 0.86) j *= 2.1;
      j += bias * taper;
      pts.push([ax + dx * t + nx * j, ay + dy * t + ny * j]);
    }
    return pts;
  }

  function tornOutline(x0, y0, x1, y1, rand) {
    return [
      ...edgePoints(x0, y0, x1, y0, 34, 5, -2, rand),
      ...edgePoints(x1, y0, x1, y1, 9, 26, 6, rand),
      ...edgePoints(x1, y1, x0, y1, 44, 13, 4, rand),
      ...edgePoints(x0, y1, x0, y0, 7, 30, 8, rand),
    ];
  }

  function tracePoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  function drawTapeStrip(g, cx, cy, len, wide, angle, rand) {
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);

    const h = wide / 2;
    const jag = (sign) => {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([sign * (len / 2) + sign * (rand() * 2 - 1) * 7, -h + wide * t]);
      }
      return pts;
    };
    const right = jag(1);
    const left = jag(-1).reverse();

    g.beginPath();
    g.moveTo(-len / 2, -h);
    g.lineTo(len / 2, -h);
    right.forEach(([x, y]) => g.lineTo(x, y));
    g.lineTo(len / 2, h);
    g.lineTo(-len / 2, h);
    left.forEach(([x, y]) => g.lineTo(x, y));
    g.closePath();

    const sheen = g.createLinearGradient(-len / 2, -h, len / 2, h);
    sheen.addColorStop(0, 'rgba(255,255,255,.055)');
    sheen.addColorStop(0.35, 'rgba(232,240,255,.19)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,.10)');
    sheen.addColorStop(1, 'rgba(226,236,255,.17)');
    g.fillStyle = sheen;
    g.fill();

    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 2;
    g.stroke();

    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const y = -h + wide * (0.25 + i * 0.25);
      g.beginPath();
      g.moveTo(-len / 2 + 8, y + (rand() * 2 - 1) * 2);
      g.lineTo(len / 2 - 8, y + (rand() * 2 - 1) * 2);
      g.stroke();
    }
    g.restore();
  }

  function fitHand(g, text, maxWidth, startPx, weight, minPx) {
    let size = startPx;
    while (size > minPx) {
      g.font = `${weight} ${size}px Caveat, "Segoe Script", cursive`;
      if (g.measureText(text).width <= maxWidth) return { size, text };
      size -= 3;
    }
    g.font = `${weight} ${minPx}px Caveat, "Segoe Script", cursive`;
    let t = text;
    while (t.length > 3 && g.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return { size: minPx, text: t + '…' };
  }

  function drawLabel() {
    const c = labelCanvas;
    const g = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);

    const title = (track.title || 'untitled')
      .replace(/\s*[-–—]\s*(Love Theme|Remaster(ed)?).*$/i, '')
      .replace(/\s*\(feat\..*?\)\s*/i, ' ')
      .trim();
    const rand = makeRng(hashOf(title + track.artist));

    const px0 = 150, py0 = 128, px1 = w - 150, py1 = h - 150;
    const tilt = (rand() * 2 - 1) * 0.026;
    const pts = tornOutline(px0, py0, px1, py1, rand);

    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(tilt);
    g.translate(-w / 2, -h / 2);

    g.save();
    g.shadowColor = 'rgba(0,0,0,.55)';
    g.shadowBlur = 26;
    g.shadowOffsetY = 12;
    tracePoly(g, pts);
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.fill();
    g.restore();

    tracePoly(g, pts);
    g.save();
    g.clip();

    const paper = g.createLinearGradient(0, py0, 0, py1);
    paper.addColorStop(0, '#e4dcc6');
    paper.addColorStop(0.5, '#dbd1b8');
    paper.addColorStop(1, '#cbc09f');
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);

    for (let i = 0; i < 2200; i++) {
      g.fillStyle = `rgba(122,104,70,${rand() * 0.075})`;
      g.fillRect(px0 + rand() * (px1 - px0), py0 + rand() * (py1 - py0), 2, 2);
    }
    for (let i = 0; i < 6; i++) {
      const x = px0 + rand() * (px1 - px0);
      const y = py0 + rand() * (py1 - py0);
      const r = 40 + rand() * 110;
      const stain = g.createRadialGradient(x, y, 0, x, y, r);
      stain.addColorStop(0, 'rgba(150,118,64,0.07)');
      stain.addColorStop(1, 'rgba(150,118,64,0)');
      g.fillStyle = stain;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    g.strokeStyle = 'rgba(96,114,140,.15)';
    g.lineWidth = 3.2;
    const cell = 58;
    for (let x = px0 - cell; x < px1 + cell; x += cell) {
      g.beginPath();
      g.moveTo(x, py0 - cell);
      g.lineTo(x, py1 + cell);
      g.stroke();
    }
    for (let y = py0 - cell; y < py1 + cell; y += cell) {
      g.beginPath();
      g.moveTo(px0 - cell, y);
      g.lineTo(px1 + cell, y);
      g.stroke();
    }

    const cx = (px0 + px1) / 2;
    const cy = (py0 + py1) / 2;
    g.save();
    g.translate(cx, cy + 22);
    g.rotate(-0.019);
    const t = fitHand(g, title, px1 - px0 - 130, 132, '600', 52);
    g.font = `600 ${t.size}px Caveat, "Segoe Script", cursive`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(28,42,56,.18)';
    g.fillText(t.text, 3, 3.5);
    g.fillStyle = '#1c2a38';
    g.fillText(t.text, 0, 0);
    g.textAlign = 'left';
    g.restore();
    g.restore();

    tracePoly(g, pts);
    g.strokeStyle = 'rgba(252,248,238,.75)';
    g.lineWidth = 7;
    g.stroke();
    tracePoly(g, pts);
    g.strokeStyle = 'rgba(126,106,70,.30)';
    g.lineWidth = 2;
    g.stroke();

    g.restore();

    drawTapeStrip(g, px0 + 34, py0 + 6, 300, 92, -0.62, rand);
    drawTapeStrip(g, px1 - 30, py1 - 4, 300, 92, -0.62, rand);

    if (labelTex) labelTex.needsUpdate = true;
  }

  function drawGlass() {
    const g = glassCanvas.getContext('2d');
    const w = glassCanvas.width;
    const h = glassCanvas.height;
    g.clearRect(0, 0, w, h);

    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, 'rgba(210,225,255,.10)');
    base.addColorStop(0.5, 'rgba(180,200,235,.03)');
    base.addColorStop(1, 'rgba(200,218,250,.08)');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    g.save();
    g.translate(w * 0.34, h * 0.5);
    g.rotate(-0.5);
    const streak = g.createLinearGradient(0, -h, 0, h);
    streak.addColorStop(0, 'rgba(255,255,255,0)');
    streak.addColorStop(0.5, 'rgba(255,255,255,.17)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = streak;
    g.fillRect(-w * 0.09, -h * 1.4, w * 0.18, h * 2.8);
    g.restore();

    g.save();
    g.translate(w * 0.72, h * 0.5);
    g.rotate(-0.5);
    const streak2 = g.createLinearGradient(0, -h, 0, h);
    streak2.addColorStop(0, 'rgba(255,255,255,0)');
    streak2.addColorStop(0.5, 'rgba(255,255,255,.08)');
    streak2.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = streak2;
    g.fillRect(-w * 0.035, -h * 1.4, w * 0.07, h * 2.8);
    g.restore();
  }

  function roundedInto(path, w, h, r, cx, cy) {
    const x = cx - w / 2, y = cy - h / 2;
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.quadraticCurveTo(x + w, y, x + w, y + r);
    path.lineTo(x + w, y + h - r);
    path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    path.lineTo(x + r, y + h);
    path.quadraticCurveTo(x, y + h, x, y + h - r);
    path.lineTo(x, y + r);
    path.quadraticCurveTo(x, y, x + r, y);
    return path;
  }

  function shapeRect(w, h, r, cx = 0, cy = 0) {
    return roundedInto(new THREE.Shape(), w, h, r, cx, cy);
  }

  function pathRect(w, h, r, cx = 0, cy = 0) {
    return roundedInto(new THREE.Path(), w, h, r, cx, cy);
  }

  function buildReel(x, ref) {
    const group = new THREE.Group();
    group.position.set(x, REEL_Y, INSIDE_Z);

    const mat = new THREE.ShaderMaterial({
      vertexShader: PACK_VERT,
      fragmentShader: PACK_FRAG,
      extensions: { derivatives: true },
      uniforms: { uRadius: { value: R_MAX }, uAngle: { value: 0 } },
    });
    ref.mat = mat;

    const pack = new THREE.Mesh(new THREE.CircleGeometry(1, 64), mat);
    group.add(pack);

    const hub = new THREE.Group();
    hub.position.z = 0.010;

    hub.add(new THREE.Mesh(
      new THREE.RingGeometry(0.047, 0.062, 28),
      new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 0.2, roughness: 0.6 })
    ));
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.047, 28),
      new THREE.MeshStandardMaterial({ color: 0x0f0f14, roughness: 0.8 })
    );
    core.position.z = -0.002;
    hub.add(core);

    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.019, 0.038, 0.014),
        new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 0.25, roughness: 0.55 })
      );
      const a = (i / 6) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.030, Math.sin(a) * 0.030, 0.003);
      tooth.rotation.z = a;
      hub.add(tooth);
    }
    group.add(hub);

    group.userData = { pack, hub };
    return group;
  }

  function buildCassette() {
    const group = new THREE.Group();

    const shell = shapeRect(W, H, 0.075);
    shell.holes.push(pathRect(WELL_W, WELL_H, 0.05, 0, WELL_Y));

    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shell, {
        depth: D, bevelEnabled: true, bevelSize: BEVEL,
        bevelThickness: BEVEL, bevelSegments: 3, curveSegments: 14,
      }),
      new THREE.MeshStandardMaterial({
        color: shell ? shell.body : 0x191920, roughness: 0.34, metalness: 0.32,
      })
    );
    bodyMat = body.material;
    body.position.z = -D / 2;
    group.add(body);

    const backPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(WELL_W + 0.14, WELL_H + 0.14),
      new THREE.MeshStandardMaterial({
        color: shell ? shell.deep : 0x08080c, roughness: 0.95,
      })
    );
    backMat = backPlate.material;
    backPlate.position.set(0, WELL_Y, -D / 2 + 0.012);
    group.add(backPlate);

    packL = {};
    packR = {};
    reelL = buildReel(-REEL_X, packL);
    reelR = buildReel(REEL_X, packR);
    group.add(reelL, reelR);

    const glassTex = new THREE.CanvasTexture(glassCanvas);
    const glass = new THREE.Mesh(
      new THREE.ShapeGeometry(shapeRect(WELL_W - 0.01, WELL_H - 0.01, 0.05, 0, WELL_Y), 14),
      new THREE.MeshBasicMaterial({
        map: glassTex, transparent: true, opacity: 0.85, depthWrite: false,
      })
    );
    glass.position.z = FRONT - 0.010;
    glass.renderOrder = 3;
    group.add(glass);

    const edge = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        shapeRect(WELL_W, WELL_H, 0.05, 0, WELL_Y).getPoints(48)
      ),
      new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.26 })
    );
    edge.position.z = FRONT + 0.001;
    group.add(edge);

    labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.anisotropy = 8;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W, PAPER_H),
      new THREE.MeshStandardMaterial({
        map: labelTex, transparent: true, depthWrite: false,
        roughness: 0.88, metalness: 0.0,
        emissive: 0xffffff, emissiveMap: labelTex, emissiveIntensity: 0.015,
      })
    );
    label.position.set(0, PAPER_Y, FRONT + 0.005);
    label.renderOrder = 4;
    group.add(label);

    const holeMat = new THREE.MeshStandardMaterial({ color: 0x030306, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), holeMat);
      hole.position.set(-0.62 + i * 0.31, -0.595, FRONT + 0.003);
      group.add(hole);
    }

    const screwMat = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.92, roughness: 0.3 });
    [[-0.92, 0.60], [0.92, 0.60], [-0.92, -0.60], [0.92, -0.60], [0, -0.60]].forEach(([x, y]) => {
      const screw = new THREE.Mesh(new THREE.CircleGeometry(0.019, 14), screwMat);
      screw.position.set(x, y, FRONT + 0.003);
      group.add(screw);
      const slot = new THREE.Mesh(
        new THREE.PlaneGeometry(0.022, 0.005),
        new THREE.MeshStandardMaterial({ color: 0x141419, roughness: 0.7 })
      );
      slot.position.set(x, y, FRONT + 0.005);
      slot.rotation.z = 0.7;
      group.add(slot);
    });

    [-0.86, 0.86].forEach((x) => {
      const notch = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.06, 0.11),
        new THREE.MeshStandardMaterial({ color: 0x07070b, roughness: 0.92 })
      );
      notch.position.set(x, 0.63, 0);
      group.add(notch);
    });

    return group;
  }

  function connect(audio) {
    if (analyser) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      audioCtx = new Ctx();
      source = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      analyser = null;
    }
  }

  function resume() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function readBands() {
    if (!analyser) {
      bands.bass = bands.mid = bands.treble = 0;
      return;
    }
    analyser.getByteFrequencyData(freq);
    const n = freq.length;
    const avg = (from, to) => {
      let sum = 0;
      const a = Math.floor(n * from), b = Math.floor(n * to);
      for (let i = a; i < b; i++) sum += freq[i];
      return sum / Math.max(1, b - a) / 255;
    };
    bands.bass = avg(0, 0.06);
    bands.mid = avg(0.06, 0.28);
    bands.treble = avg(0.28, 0.72);
  }

  function initGL(el) {
    const width = el.clientWidth || 600;
    const height = el.clientHeight || 500;
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);

    scene = new THREE.Scene();
    const d = 1.46;
    const aspect = width / height;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, -20, 20);
    camera.position.set(0, 0, 6);

    drawGlass();
    drawLabel();
    cassette = buildCassette();
    cassette.rotation.set(-0.30, 0.44, -0.05);
    scene.add(cassette);

    scene.add(new THREE.AmbientLight(0xffffff, 0.52));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(-2.2, -1.0, 4.0);
    scene.add(key);
    const rim = new THREE.DirectionalLight(GOLD, 0.40);
    rim.position.set(3.4, 1.5, 0.5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8fa4c8, 0.26);
    fill.position.set(-1.2, 2.6, 1.4);
    scene.add(fill);
    const inner = new THREE.PointLight(0xffe6c0, 0.40, 2.2);
    inner.position.set(0, WELL_Y, 0.02);
    scene.add(inner);
  }

  function init2D(el) {
    ctx2d = el.getContext('2d');
  }

  function resize() {
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (mode === 'gl' && renderer) {
      renderer.setSize(width, height, false);
      const d = 1.46;
      const aspect = width / height;
      camera.left = -d * aspect;
      camera.right = d * aspect;
      camera.top = d;
      camera.bottom = -d;
      camera.updateProjectionMatrix();
    } else if (mode === '2d' && ctx2d) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function draw2D() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx2d.clearRect(0, 0, width, height);
    const s = Math.min(width / 2.9, height / 2.3);
    ctx2d.save();
    ctx2d.translate(width / 2, height / 2);
    ctx2d.transform(1, -0.15, 0.2, 1, 0, 0);

    ctx2d.fillStyle = '#191920';
    ctx2d.fillRect(-W / 2 * s, -H / 2 * s, W * s, H * s);
    ctx2d.fillStyle = '#08080c';
    ctx2d.fillRect(-WELL_W / 2 * s, -(WELL_Y + WELL_H / 2) * s, WELL_W * s, WELL_H * s);

    const rl = R_MIN + (R_MAX - R_MIN) * (1 - progress);
    const rr = R_MIN + (R_MAX - R_MIN) * progress;
    [[-REEL_X, rl, angL], [REEL_X, rr, angR]].forEach(([x, r, a]) => {
      ctx2d.save();
      ctx2d.translate(x * s, -REEL_Y * s);
      ctx2d.beginPath();
      ctx2d.arc(0, 0, r * s, 0, Math.PI * 2);
      ctx2d.fillStyle = '#231a12';
      ctx2d.fill();
      ctx2d.rotate(a);
      ctx2d.beginPath();
      ctx2d.arc(0, 0, 0.055 * s, 0, Math.PI * 2);
      ctx2d.strokeStyle = '#d8d4cc';
      ctx2d.lineWidth = 3;
      ctx2d.stroke();
      ctx2d.restore();
    });

    ctx2d.drawImage(labelCanvas, -PAPER_W / 2 * s, -(PAPER_Y + PAPER_H / 2) * s, PAPER_W * s, PAPER_H * s);
    ctx2d.restore();
  }

  function loop(time) {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0.016;
    last = time;

    readBands();
    const ease = reduced ? 0.05 : 0.13;
    smooth.bass += (bands.bass - smooth.bass) * ease;
    smooth.mid += (bands.mid - smooth.mid) * ease;
    smooth.treble += (bands.treble - smooth.treble) * ease;
    const level = smooth.bass * 0.7 + smooth.mid * 0.3;

    const target = spinning ? 1 : 0;
    spin += (target - spin) * (spinning ? 0.10 : 0.055);
    if (!spinning && spin < 0.004) spin = 0;

    const rl = R_MIN + (R_MAX - R_MIN) * (1 - progress);
    const rr = R_MIN + (R_MAX - R_MIN) * progress;
    angL += (0.52 / rl) * spin * dt;
    angR += (0.52 / rr) * spin * dt;

    if (mode === 'gl' && cassette) {
      reelL.userData.pack.scale.setScalar(rl);
      reelR.userData.pack.scale.setScalar(rr);
      packL.mat.uniforms.uRadius.value = rl;
      packR.mat.uniforms.uRadius.value = rr;
      packL.mat.uniforms.uAngle.value = angL;
      packR.mat.uniforms.uAngle.value = angR;
      reelL.userData.hub.rotation.z = angL;
      reelR.userData.hub.rotation.z = angR;

      const sway = reduced ? 0 : 1;
      cassette.rotation.y = 0.44 + Math.sin(time * 0.00034) * 0.05 * sway;
      cassette.rotation.x = -0.30 + Math.sin(time * 0.00027) * 0.028 * sway;
      cassette.position.y = Math.sin(time * 0.00045) * 0.03 * sway + level * 0.04;
      cassette.scale.setScalar(1 + level * 0.02);

      renderer.render(scene, camera);
    } else if (mode === '2d' && ctx2d) {
      draw2D();
    }
  }

  function mount(el) {
    canvas = el;
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (raf) cancelAnimationFrame(raf);
    mode = null;
    last = 0;
    renderer = scene = camera = cassette = ctx2d = null;

    ensureFont().then(drawLabel);

    if (window.THREE) {
      try {
        initGL(el);
        mode = 'gl';
      } catch (e) {
        mode = null;
      }
    }
    if (!mode) {
      drawGlass();
      drawLabel();
      init2D(el);
      mode = '2d';
    }
    resize();
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (renderer) renderer.dispose();
    renderer = scene = camera = cassette = ctx2d = null;
    canvas = null;
    mode = null;
  }

  function setTrack(title, artist) {
    track = { title: title || '', artist: artist || '' };
    ensureFont().then(drawLabel);
  }

  function applyShell() {
    if (bodyMat) bodyMat.color.set(shell ? shell.body : 0x191920);
    if (backMat) backMat.color.set(shell ? shell.deep : 0x08080c);
  }

  function setCover(url) {
    if (!url) {
      shell = null;
      applyShell();
      return;
    }
    Palette.fromCover(url).then((found) => {
      shell = found;
      applyShell();
    });
  }

  function setProgress(ratio) {
    progress = Math.min(1, Math.max(0, ratio || 0));
  }

  function setPlaying(on) {
    spinning = !!on;
  }

  window.addEventListener('resize', resize);

  return { mount, unmount, connect, resume, setCover, setTrack, setProgress, setPlaying };
})();
