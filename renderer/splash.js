// Vyuha opening animation, shown once when the app starts (about 5 s; click or any key skips it).
// The Chakravyuha: you can't see the way in, so a comet finds it. It comes in from a screen corner (a
// different one each launch), slips through each ring's opening to the core, gathering your datasets,
// code, files, workflows, models and AI on the way. Then the rings lock into the Vyuha logo and the app appears.
// Purely visual: it draws an overlay on top of the UI and removes itself when done.
(() => {
  const DURATION = 4.8;   // length of the choreography (in "story" seconds)
  const SLOW = 1.05;      // played slightly slower than the choreography: about 5 s on screen
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = x => 1 - Math.pow(1 - x, 3);
  const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const P = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [64 + r * Math.cos(a), 64 + r * Math.sin(a)]; };
  const f = n => n.toFixed(2);

  const css = `
    #vys { position: fixed; inset: 0; z-index: 100000; background: #0b1416; cursor: pointer; overflow: hidden; }
    #vys canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    #vys svg.vys-scene { position: absolute; left: 50%; top: 50%; overflow: visible; }
    #vys .vys-brand { position: absolute; left: 0; right: 0; text-align: center; pointer-events: none; }
    #vys .vys-word { font-family: 'Space Grotesk', 'Segoe UI', sans-serif; font-weight: 700; color: #F1F6F5; letter-spacing: -0.045em; line-height: 1; }
    #vys .vys-tag { font-family: 'Segoe UI', system-ui, sans-serif; color: #7FD8CB; letter-spacing: .32em; text-transform: uppercase; margin-top: 18px; }
    #vys .vys-skip { position: absolute; right: 22px; bottom: 18px; font: 12px 'Segoe UI', sans-serif; color: rgba(200, 230, 226, .45); letter-spacing: .08em; }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'vys';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Vyuha');
  root.innerHTML = `<canvas></canvas>
    <svg class="vys-scene" viewBox="0 0 128 128" aria-hidden="true">
      <defs>
        <linearGradient id="vys-g" gradientUnits="userSpaceOnUse" x1="12" y1="12" x2="116" y2="116"><stop offset="0" stop-color="#5EEAD4"/><stop offset="0.55" stop-color="#14B8A6"/><stop offset="1" stop-color="#0D9488"/></linearGradient>
        <linearGradient id="vys-tailg" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E0FFFA"/><stop offset="1" stop-color="#2DD4BF"/></linearGradient>
        <radialGradient id="vys-bloomg"><stop offset="0" stop-color="#E9FFFB" stop-opacity="1"/><stop offset="0.35" stop-color="#5EEAD4" stop-opacity=".5"/><stop offset="1" stop-color="#14B8A6" stop-opacity="0"/></radialGradient>
        <radialGradient id="vys-headg"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.4" stop-color="#C9FFF6"/><stop offset="1" stop-color="#2DD4BF" stop-opacity="0"/></radialGradient>
        <filter id="vys-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="vys-softglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g data-k="turn">
        <g data-k="rings" filter="url(#vys-glow)" stroke="url(#vys-g)" stroke-linecap="round" fill="none">
          <path data-k="r1" pathLength="1" d="M46.21 15.14 A52 52 0 1 1 15.14 46.21"/>
          <path data-k="r2" pathLength="1" d="M74.23 97.47 A35 35 0 1 1 97.47 74.23"/>
          <path data-k="r3" pathLength="1" d="M60.87 46.27 A18 18 0 1 1 46.27 60.87"/>
        </g>
        <path data-k="route" fill="none" stroke="none"/>
        <path data-k="trace" fill="none" stroke="#9FF5E8" stroke-width="0.8" stroke-linecap="round" pathLength="1" stroke-dasharray="0 2" opacity="0"/>
        <path data-k="tail" fill="none" stroke="url(#vys-tailg)" stroke-width="3" stroke-linecap="round" pathLength="1" stroke-dasharray="0 2" filter="url(#vys-softglow)"/>
        <g data-k="planets"></g>
        <circle data-k="headglow" r="8" fill="url(#vys-headg)" opacity="0"/>
        <circle data-k="head" r="2.4" fill="#FFFFFF" opacity="0" filter="url(#vys-softglow)"/>
      </g>
      <circle data-k="bloom" cx="64" cy="64" r="0" fill="url(#vys-bloomg)"/>
      <circle data-k="core" cx="64" cy="64" r="0" fill="url(#vys-g)"/>
    </svg>
    <div class="vys-brand"><div class="vys-word">vyuha</div><div class="vys-tag">Find your way in</div></div>
    <div class="vys-skip">Click to skip</div>`;
  document.body.appendChild(root);
  const el = k => root.querySelector(`[data-k="${k}"]`);
  const E = {};
  for (const k of ['turn', 'rings', 'r1', 'r2', 'r3', 'route', 'trace', 'tail', 'planets', 'headglow', 'head', 'bloom', 'core']) E[k] = el(k);
  const scene = root.querySelector('svg.vys-scene'), brand = root.querySelector('.vys-brand');
  const word = root.querySelector('.vys-word'), tag = root.querySelector('.vys-tag');
  const cv = root.querySelector('canvas'), cx = cv.getContext('2d');
  // keep any web page view hidden while the opening plays
  try { if (window.vyuha && window.vyuha.overlay) window.vyuha.overlay(true); } catch (e) { /* not in the app */ }

  // the comet comes in from one corner, never the same one twice in a row
  const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  let last = null; try { last = localStorage.getItem('vyuha.opening.corner'); } catch (e) { /* no storage */ }
  const choices = CORNERS.filter(c => c !== last);
  const corner = choices[Math.floor(Math.random() * choices.length)];
  try { localStorage.setItem('vyuha.opening.corner', corner); } catch (e) { /* no storage */ }

  // "All the stuff" orbiting the rings: datasets, code, files, workflows, ML models, AI
  const ICONS = {
    dataset: '<ellipse cx="0" cy="-1.9" rx="2.5" ry="0.95"/><path d="M-2.5 -1.9 V1.9 A2.5 0.95 0 0 0 2.5 1.9 V-1.9 M-2.5 0 A2.5 0.95 0 0 0 2.5 0"/>',
    code: '<path d="M-0.9 -2.1 L-2.6 0 L-0.9 2.1 M0.9 -2.1 L2.6 0 L0.9 2.1"/>',
    file: '<path d="M-1.9 -2.6 H0.7 L2 -1.3 V2.6 H-1.9 Z M0.7 -2.6 V-1.3 H2 M-1 0.2 H1 M-1 1.4 H1"/>',
    workflow: '<path d="M-1.6 -1.6 L1.6 -1.6 M-1.9 -1.1 L-0.3 1.6 M1.9 -1.1 L0.3 1.6"/><circle cx="-2.1" cy="-1.6" r="0.9" fill="#fff"/><circle cx="2.1" cy="-1.6" r="0.9" fill="#fff"/><circle cx="0" cy="2.1" r="0.9" fill="#fff"/>',
    model: '<path d="M-2.2 -1.8 L2.2 0 M-2.2 1.8 L2.2 0 M-2.2 -1.8 L-2.2 1.8"/><circle cx="-2.2" cy="-1.8" r="0.8" fill="#fff"/><circle cx="-2.2" cy="1.8" r="0.8" fill="#fff"/><circle cx="2.2" cy="0" r="0.9" fill="#fff"/>',
    ai: '<path d="M0 -2.8 Q0.45 -0.45 2.8 0 Q0.45 0.45 0 2.8 Q-0.45 0.45 -2.8 0 Q-0.45 -0.45 0 -2.8 Z" fill="#fff" stroke="none"/>'
  };
  const PLANETS = [
    { r: 52, a: 40, w: 20, c: '#F59E0B', icon: 'dataset' }, { r: 52, a: 160, w: 20, c: '#8B5CF6', icon: 'code' }, { r: 52, a: 280, w: 20, c: '#0EA5E9', icon: 'file' },
    { r: 35, a: 95, w: -32, c: '#F43F5E', icon: 'workflow' }, { r: 35, a: 265, w: -32, c: '#22C55E', icon: 'model' },
    { r: 18, a: 175, w: 52, c: '#EC4899', icon: 'ai' }
  ];
  for (const p of PLANETS) {
    const g = document.createElementNS(NS, 'g');
    g.innerHTML = `<circle r="6.6" fill="${p.c}" stroke="#061012" stroke-width="0.9"/><g fill="none" stroke="#fff" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" transform="scale(1.45)">${ICONS[p.icon]}</g>`;
    E.planets.appendChild(g); p.el = g;
  }

  let W = 0, H = 0, S = 0, faceDeg = 0, routeLen = 1;
  const dirDeg = (dx, dy) => (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;   // clockwise from 12 o'clock
  function layout() {
    W = innerWidth; H = innerHeight;
    cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio;
    S = Math.min(W, H) * 0.72;
    // turn the Vyuha so its outer opening (at 315 degrees) faces the comet's corner
    const dx = (corner.includes('left') ? 0 : W) - W / 2, dy = (corner.includes('top') ? 0 : H) - H / 2;
    faceDeg = dirDeg(dx, dy) - 315;
    // the way in, in the Vyuha's own (unturned) coordinates: from the corner, through each ring's opening, to the core
    const dist = Math.hypot(dx, dy) * (128 / S) * 1.04;
    const [sx, sy] = P(dist, 315), [qx, qy] = P(dist * 0.55, 300), [bx, by] = P(60, 315), [c1x, c1y] = P(43.5, 315);
    const arc = (r, d) => { const [x, y] = P(r, d); return `A${r} ${r} 0 0 1 ${f(x)} ${f(y)}`; };
    const [m1x, m1y] = P(26.5, 135), [i1x, i1y] = P(9, 315);
    const d = `M${f(sx)} ${f(sy)} Q${f(qx)} ${f(qy)} ${f(bx)} ${f(by)} L${f(c1x)} ${f(c1y)} ${arc(43.5, 45)} ${arc(43.5, 135)} L${f(m1x)} ${f(m1y)} ${arc(26.5, 225)} ${arc(26.5, 315)} L${f(i1x)} ${f(i1y)} L64 64`;
    for (const k of ['route', 'trace', 'tail']) E[k].setAttribute('d', d);
    routeLen = E.route.getTotalLength();
  }

  // the Vyuha around you: faint formation rings and spokes, slowly turning
  function drawBackground(t, size, cyPx, pulse) {
    cx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const g = cx.createRadialGradient(W / 2, cyPx, 0, W / 2, cyPx, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#11312f'); g.addColorStop(0.45, '#0c1d1f'); g.addColorStop(1, '#091214');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    const a = easeOut(span(t, 0, 0.8)), R0 = size * 0.5;
    cx.save(); cx.translate(W / 2, cyPx);
    for (let i = 0; i < 7; i++) {
      cx.save(); cx.rotate(((i % 2 ? -1 : 1) * t * (4 + i)) * Math.PI / 180);
      cx.strokeStyle = `rgba(94, 234, 212, ${(a * (0.09 - i * 0.009)).toFixed(3)})`;
      cx.lineWidth = 1; cx.setLineDash(i % 2 ? [2, 9] : [26, 14]);
      cx.beginPath(); cx.arc(0, 0, R0 * (1.18 + i * 0.3), 0, Math.PI * 2); cx.stroke();
      cx.restore();
    }
    cx.setLineDash([]);
    cx.rotate(t * 2 * Math.PI / 180);
    for (let s = 0; s < 32; s++) {
      const ang = s / 32 * Math.PI * 2, r1 = R0 * 1.12, r2 = Math.max(W, H);
      const grad = cx.createLinearGradient(Math.cos(ang) * r1, Math.sin(ang) * r1, Math.cos(ang) * r2, Math.sin(ang) * r2);
      grad.addColorStop(0, `rgba(94, 234, 212, ${(a * 0.05).toFixed(3)})`); grad.addColorStop(1, 'rgba(94, 234, 212, 0)');
      cx.strokeStyle = grad; cx.beginPath(); cx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1); cx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2); cx.stroke();
    }
    cx.restore();
    if (pulse > 0 && pulse < 1) {   // arrival: one soft wave rolls out from the core
      cx.strokeStyle = `rgba(110, 240, 220, ${(0.35 * (1 - pulse)).toFixed(3)})`;
      cx.lineWidth = 2 + 6 * (1 - pulse);
      cx.beginPath(); cx.arc(W / 2, cyPx, R0 * (0.2 + 2.2 * easeOut(pulse)), 0, Math.PI * 2); cx.stroke();
    }
  }

  function render(t) {
    // big in the centre, then it rises, shrinks and becomes the logo
    const settle = easeInOut(span(t, 3.25, 3.95));
    const size = S * (1 - 0.5 * settle);
    const cyPx = H * 0.5 - settle * H * 0.1;
    drawBackground(t, size, cyPx, span(t, 2.95, 3.9));
    scene.style.width = scene.style.height = size + 'px';
    scene.style.transform = 'translate(-50%, -50%)';
    scene.style.top = cyPx + 'px';

    // facing the comet, then turning back into the logo's orientation
    let turn = faceDeg; if (turn > 180) turn -= 360; if (turn < -180) turn += 360;
    const back = 1 - easeInOut(span(t, 3.0, 3.8));
    E.turn.setAttribute('transform', `rotate(${f(turn * back)} 64 64)`);

    // thin rings that thicken into the logo once the way in is found
    const lit = easeOut(span(t, 2.95, 3.35)), thick = easeInOut(span(t, 3.0, 3.8));
    E.rings.setAttribute('stroke-width', f(4.6 + (10.5 - 4.6) * thick));
    [['r1', 0.35, 1.15], ['r2', 0.5, 1.3], ['r3', 0.65, 1.45]].forEach(([k, a, b]) => {
      const p = easeOut(span(t, a, b));
      E[k].setAttribute('stroke-dasharray', p < 0.02 ? '0 1' : `${p} 1`);
      E[k].setAttribute('opacity', (p * (0.55 + 0.45 * lit)).toFixed(3));
    });

    // the icons orbit, then get pulled into the core
    const pin = easeOut(span(t, 0.9, 1.4)), gather = easeInOut(span(t, 2.95, 3.4));
    for (const p of PLANETS) {
      const [x, y] = P(p.r * (1 - gather), p.a + p.w * t);
      p.el.setAttribute('transform', `translate(${f(x)} ${f(y)}) rotate(${f(-turn * back)}) scale(${Math.max(0.001, pin * (1 - 0.75 * gather)).toFixed(3)})`);
      p.el.setAttribute('opacity', (pin * (1 - span(t, 3.25, 3.45))).toFixed(3));
    }

    // the comet comes in from the corner and finds the way to the core
    const prog = easeInOut(span(t, 1.15, 2.95));
    const flying = t > 1.12 && t < 3.0;
    const pt = E.route.getPointAtLength(prog * routeLen);
    for (const k of ['head', 'headglow']) { E[k].setAttribute('cx', f(pt.x)); E[k].setAttribute('cy', f(pt.y)); }
    E.head.setAttribute('opacity', flying ? 1 : 0);
    E.headglow.setAttribute('opacity', flying ? 0.9 : 0);
    const tailLen = 0.12;
    E.tail.setAttribute('stroke-dasharray', `${tailLen} 2`);
    E.tail.setAttribute('stroke-dashoffset', f(tailLen - prog));
    E.tail.setAttribute('opacity', flying ? 0.95 : (t > 2.9 ? 0.95 * (1 - span(t, 2.95, 3.2)) : 0));
    E.trace.setAttribute('stroke-dasharray', `${prog} 2`);
    E.trace.setAttribute('opacity', (0.45 * span(t, 1.2, 1.5) * (1 - span(t, 2.88, 3.05))).toFixed(3));

    // arrival: a soft burst, the core lights up and becomes the logo's centre
    const b = span(t, 2.92, 3.6);
    E.bloom.setAttribute('r', f(8 + 58 * easeOut(b)));
    E.bloom.setAttribute('opacity', (b > 0 ? (1 - b) : 0).toFixed(3));
    E.core.setAttribute('r', f(7.5 * easeOut(span(t, 2.95, 3.25))));

    // the name and the line
    brand.style.top = (cyPx + size * 0.6) + 'px';
    const wa = easeOut(span(t, 3.5, 4.05));
    word.style.fontSize = Math.round(Math.min(W, H) * 0.12) + 'px';
    word.style.opacity = wa; word.style.transform = `translateY(${(1 - wa) * 14}px)`;
    const ta = easeOut(span(t, 3.75, 4.2));
    tag.style.fontSize = Math.max(13, Math.round(Math.min(W, H) * 0.028)) + 'px';
    tag.style.opacity = ta; tag.style.letterSpacing = (0.6 - 0.28 * ta).toFixed(3) + 'em';

    // hand over to the app
    const out = span(t, 4.35, DURATION);
    root.style.opacity = (1 - easeInOut(out)).toFixed(3);
    root.style.transform = `scale(${(1 + 0.04 * easeInOut(out)).toFixed(4)})`;
  }

  let now = 0, start = null, done = false;
  const onResize = () => { layout(); render(now); };
  const finish = () => {
    if (done) return;
    done = true;
    removeEventListener('resize', onResize);
    removeEventListener('keydown', finish, true);
    root.remove(); style.remove();
    try { if (window.vyuha && window.vyuha.overlay) window.vyuha.overlay(false); } catch (e) { /* not in the app */ }
  };
  layout();
  addEventListener('resize', onResize);
  root.addEventListener('click', finish);
  addEventListener('keydown', finish, true);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {   // just the logo, briefly
    render(3.95);
    setTimeout(() => { root.style.transition = 'opacity .4s'; root.style.opacity = 0; setTimeout(finish, 450); }, 700);
    return;
  }
  render(0);
  const loop = ts => {
    if (done) return;
    if (start == null) start = ts;
    now = (ts - start) / 1000 / SLOW;
    render(Math.min(now, DURATION));
    if (now < DURATION) requestAnimationFrame(loop); else finish();
  };
  const go = () => requestAnimationFrame(loop);
  if (document.fonts && document.fonts.load) document.fonts.load('700 40px "Space Grotesk"').then(go, go); else go();
})();
