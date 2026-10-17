/* geometry.js — Grille Atelier: units, page formats, line clipping and every grid generator.
 * Pure functions, no DOM: the same code runs in the browser (window.Geo) and in Node (unit tests).
 * Everything is computed in millimetres, origin at the top-left corner of the trimmed page, y pointing down.
 * Original code, MIT licence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MM_PER_IN = 25.4, PX_PER_IN = 96, PHI = (1 + Math.sqrt(5)) / 2, EPS = 1e-9;
  const RAD = Math.PI / 180;

  /* ------------------------------------------------------------------ units */
  /** Convert a length in `unit` (mm | in | px, px = CSS pixel at 96 px/in) to millimetres. */
  function toMm(v, unit) { v = Number(v); return unit === 'in' ? v * MM_PER_IN : unit === 'px' ? (v / PX_PER_IN) * MM_PER_IN : v; }
  /** Convert millimetres to `unit`. */
  function fromMm(mm, unit) { return unit === 'in' ? mm / MM_PER_IN : unit === 'px' ? (mm / MM_PER_IN) * PX_PER_IN : mm; }
  /** Pixel size of a length in mm at a given resolution (dots per inch). */
  const mmToDots = (mm, dpi) => Math.round((mm / MM_PER_IN) * dpi);
  /** Round to `d` decimals (default 3) — used to keep SVG files compact and tests stable. */
  const round = (n, d = 3) => { const k = 10 ** d; return Math.round(n * k) / k || 0; };

  /* ------------------------------------------------------------------ page formats */
  // Base sizes in millimetres, smaller side first; orientation decides which side is the width.
  const FORMATS = {
    A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], B5: [182, 257],
    letter: [215.9, 279.4], legal: [215.9, 355.6], tabloid: [279.4, 431.8],
    comicUS: [168.275, 258.763], square: [200, 200], r169: [toMm(1080, 'px'), toMm(1920, 'px')],
  };
  /** Trimmed page size {w,h} in mm for a settings object. */
  function pageSize(s) {
    let w, h;
    if (s.format === 'custom' || !FORMATS[s.format]) { w = +s.cusW || 210; h = +s.cusH || 297; return { w, h }; }
    [w, h] = FORMATS[s.format];
    if (w === h) return { w, h };
    return s.orient === 'landscape' ? { w: Math.max(w, h), h: Math.min(w, h) } : { w: Math.min(w, h), h: Math.max(w, h) };
  }

  /* ------------------------------------------------------------------ clipping (Liang–Barsky) */
  /** Clip the parametric line P(t) = (x0,y0) + t·(dx,dy), t ∈ [t0,t1], to rectangle a {x,y,w,h}.
   *  Returns [x1,y1,x2,y2] or null when nothing (or only a point) is left. */
  function clipParam(x0, y0, dx, dy, t0, t1, a) {
    const p = [-dx, dx, -dy, dy], q = [x0 - a.x, a.x + a.w - x0, y0 - a.y, a.y + a.h - y0];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) { if (q[i] < -EPS) return null; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    if (!isFinite(t0) || !isFinite(t1)) return null;
    const seg = [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
    return Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) < 1e-6 ? null : seg;
  }
  const clipSegment = (x1, y1, x2, y2, a) => clipParam(x1, y1, x2 - x1, y2 - y1, 0, 1, a);
  const clipLine = (x0, y0, dx, dy, a) => clipParam(x0, y0, dx, dy, -Infinity, Infinity, a);
  const clipRay = (x0, y0, dx, dy, a) => clipParam(x0, y0, dx, dy, 0, Infinity, a);
  const inside = (x, y, a, e = 1e-7) => x >= a.x - e && x <= a.x + a.w + e && y >= a.y - e && y <= a.y + a.h + e;
  const mod = (n, m) => ((n % m) + m) % m;

  /* ------------------------------------------------------------------ primitive helpers
   * A scene is a flat list of primitives, each on a layer L: shade | minor | major | accent | marks.
   *  {t:'l', x1,y1,x2,y2, L, dash?}  line segment      {t:'d', x,y,r, L}   filled dot
   *  {t:'c', x,y,r, L, dash?}        stroked circle    {t:'p', pts:[x,y,…], closed, fill, L, dash?}  polyline / polygon
   *  {t:'r', x,y,w,h, rx, fill, L}   rectangle */
  const L = (seg, layer, dash) => (seg ? { t: 'l', x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], L: layer, dash: !!dash } : null);
  const push = (out, p) => { if (p) out.push(p); };

  /** Family of parallel lines with direction `deg` (0° = horizontal, 90° = vertical), perpendicular spacing
   *  `gap`, passing through (ox,oy), clipped to `a`. Every `every`-th line (counting from the one through the
   *  origin) is "major". Returns line primitives. */
  function parallelFamily(a, deg, gap, ox, oy, every = 1, minorLayer = 'minor') {
    const out = [];
    if (!(gap > 0.05)) return out;
    const th = deg * RAD, dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
    const pr = [[a.x, a.y], [a.x + a.w, a.y], [a.x, a.y + a.h], [a.x + a.w, a.y + a.h]].map(([cx, cy]) => (cx - ox) * nx + (cy - oy) * ny);
    const k0 = Math.ceil(Math.min(...pr) / gap - 1e-7), k1 = Math.floor(Math.max(...pr) / gap + 1e-7);
    if (k1 - k0 > 20000) return out; // safety net against absurd densities
    for (let k = k0; k <= k1; k++) {
      const seg = clipLine(ox + k * gap * nx, oy + k * gap * ny, dx, dy, a);
      push(out, L(seg, every > 1 && mod(k, every) !== 0 ? minorLayer : 'major'));
    }
    return out;
  }

  /** Grid origin: area centre or top-left corner. */
  const origin = (a, centered) => (centered ? [a.x + a.w / 2, a.y + a.h / 2] : [a.x, a.y]);

  /* ------------------------------------------------------------------ grid generators (all return primitives) */
  /** Square / graph paper: major cells of `cell` mm, each split into `sub` minor divisions. */
  function squareGrid(a, s) {
    const sub = Math.max(1, Math.round(s.sub)), gap = s.cell / sub, [ox, oy] = origin(a, s.center);
    return [...parallelFamily(a, 90, gap, ox, oy, sub), ...parallelFamily(a, 0, gap, ox, oy, sub)];
  }

  /** Dot grid: a dot every `cell` mm; every `sub`-th dot in both directions is a larger "major" dot. */
  function dotGrid(a, s) {
    const out = [], g = s.cell, [ox, oy] = origin(a, s.center), sub = Math.max(1, Math.round(s.sub));
    if (!(g > 0.5)) return out;
    const i0 = Math.ceil((a.x - ox) / g - 1e-7), i1 = Math.floor((a.x + a.w - ox) / g + 1e-7);
    const j0 = Math.ceil((a.y - oy) / g - 1e-7), j1 = Math.floor((a.y + a.h - oy) / g + 1e-7);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 250000) return out;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const big = sub > 1 && mod(i, sub) === 0 && mod(j, sub) === 0;
      out.push({ t: 'd', x: ox + i * g, y: oy + j * g, r: big ? s.dotR * 1.8 : s.dotR, L: big ? 'major' : 'minor' });
    }
    return out;
  }

  /** Axonometric lattice (isometric when alpha = 30°, dimetric otherwise): two families of slanted lines at
   *  ±alpha and optional verticals, all meeting at common lattice points. `cell` is the edge length measured
   *  along the slanted lines. Returns {lines, u, v} (u: vertical-line spacing, v: lattice step on a vertical). */
  function axoGrid(a, s, alpha) {
    const sub = Math.max(1, Math.round(s.sub)), al = alpha * RAD;
    const u = s.cell * Math.cos(al), v = 2 * u * Math.tan(al), p = 2 * u * Math.sin(al);
    const [ox, oy] = origin(a, s.center), out = [];
    out.push(...parallelFamily(a, alpha, p / sub, ox, oy, sub), ...parallelFamily(a, 180 - alpha, p / sub, ox, oy, sub));
    if (s.isoVert) out.push(...parallelFamily(a, 90, u / sub, ox, oy, sub));
    out.u = u; out.v = v; out.p = p;
    return out;
  }

  /** Isometric dot grid: dots on the triangular lattice of side `cell` (vertical columns). */
  function isoDotGrid(a, s) {
    const out = [], u = s.cell * Math.cos(30 * RAD), v = s.cell, [ox, oy] = origin(a, s.center);
    if (!(s.cell > 0.5)) return out;
    const i0 = Math.ceil((a.x - ox) / u - 1e-7), i1 = Math.floor((a.x + a.w - ox) / u + 1e-7);
    if ((i1 - i0 + 1) * (a.h / v + 2) > 250000) return out;
    const sub = Math.max(1, Math.round(s.sub));
    for (let i = i0; i <= i1; i++) {
      const off = mod(i, 2) ? v / 2 : 0, j0 = Math.ceil((a.y - oy - off) / v - 1e-7), j1 = Math.floor((a.y + a.h - oy - off) / v + 1e-7);
      for (let j = j0; j <= j1; j++) {
        const big = sub > 1 && mod(i, 2 * sub) === 0 && mod(j, sub) === 0; // larger dot on a coarser sub-lattice
        out.push({ t: 'd', x: ox + i * u, y: oy + off + j * v, r: big ? s.dotR * 1.8 : s.dotR, L: big ? 'major' : 'minor' });
      }
    }
    return out;
  }

  /** Triangular grid: equilateral triangles of side `cell` with one family horizontal. */
  function triangleGrid(a, s) {
    const sub = Math.max(1, Math.round(s.sub)), h = (s.cell * Math.sqrt(3)) / 2 / sub, [ox, oy] = origin(a, s.center);
    return [0, 60, 120].flatMap((d) => parallelFamily(a, d, h, ox, oy, sub));
  }

  /** Hexagonal grid of side `cell` (pointy- or flat-topped). Shared edges are emitted once. With hexInner,
   *  minor spokes split every hexagon into six triangles. */
  function hexGrid(a, s) {
    const out = [], r = s.cell, flat = s.hexOrient === 'flat';
    if (!(r > 0.5)) return out;
    // work in a frame where hexagons are pointy-topped; flat-topped = same with x and y swapped
    const A = flat ? { x: a.y, y: a.x, w: a.h, h: a.w } : a;
    const W = Math.sqrt(3) * r, H = 1.5 * r, [ox, oy] = origin(A, s.center);
    const j0 = Math.floor((A.y - oy) / H) - 1, j1 = Math.ceil((A.y + A.h - oy) / H) + 1;
    const i0 = Math.floor((A.x - ox) / W) - 2, i1 = Math.ceil((A.x + A.w - ox) / W) + 1;
    if ((j1 - j0) * (i1 - i0) > 60000) return out;
    const seen = new Set(), sw = (x1, y1, x2, y2) => (flat ? [y1, x1, y2, x2] : [x1, y1, x2, y2]);
    const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = ox + i * W + (mod(j, 2) ? W / 2 : 0), cy = oy + j * H;
      const vs = [];
      for (let k = 0; k < 6; k++) { const an = (-90 + 60 * k) * RAD; vs.push([cx + r * Math.cos(an), cy + r * Math.sin(an)]); }
      for (let k = 0; k < 6; k++) {
        const [x1, y1] = vs[k], [x2, y2] = vs[(k + 1) % 6], kk = key((x1 + x2) / 2, (y1 + y2) / 2);
        if (seen.has(kk)) continue;
        seen.add(kk);
        const c = sw(x1, y1, x2, y2);
        push(out, L(clipSegment(c[0], c[1], c[2], c[3], a), 'major'));
      }
      if (s.hexInner) for (let k = 0; k < 3; k++) { // three long diagonals = six spokes
        const [x1, y1] = vs[k], [x2, y2] = vs[k + 3], c = sw(x1, y1, x2, y2);
        push(out, L(clipSegment(c[0], c[1], c[2], c[3], a), 'minor'));
      }
    }
    return out;
  }

  /** Ruled paper (school / Seyès style): horizontal lines every cell/sub, a major line every `sub`,
   *  optional vertical lines every cell and an accent margin line `rMargin` mm from the left. */
  function ruledGrid(a, s) {
    const sub = Math.max(1, Math.round(s.sub)), out = parallelFamily(a, 0, s.cell / sub, a.x, a.y, sub);
    if (s.rVert) out.push(...parallelFamily(a, 90, s.cell, a.x, a.y, 1));
    if (s.rMargin > 0 && s.rMargin < a.w) push(out, L(clipSegment(a.x + s.rMargin, a.y, a.x + s.rMargin, a.y + a.h, a), 'accent'));
    return out;
  }

  /** Polar / radial (mandala) grid centred at (cx,cy): rings every ringGap (minor rings between when sub>1),
   *  `spokes` major radii and spokeSub−1 minor radii inside each sector. polarPoly draws rings as polygons. */
  function polarGrid(a, s, cx, cy) {
    const out = [], far = Math.max(...[[a.x, a.y], [a.x + a.w, a.y], [a.x, a.y + a.h], [a.x + a.w, a.y + a.h]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
    const sub = Math.max(1, Math.round(s.sub)), gap = s.ringGap / sub, n = Math.max(1, Math.round(s.spokes)), ss = Math.max(1, Math.round(s.spokeSub));
    const start = -90 * RAD;
    if (gap > 0.2 && far / gap < 4000) {
      for (let k = 1; k * gap <= far + 1e-6; k++) {
        const r = k * gap, layer = k % sub === 0 ? 'major' : 'minor';
        if (s.polarPoly && n >= 3) {
          const pts = [];
          for (let i = 0; i < n; i++) { const an = start + (2 * Math.PI * i) / n; pts.push(cx + r * Math.cos(an), cy + r * Math.sin(an)); }
          out.push({ t: 'p', pts, closed: true, L: layer });
        } else out.push({ t: 'c', x: cx, y: cy, r, L: layer });
      }
    }
    const total = n * ss;
    if (total <= 3600) for (let i = 0; i < total; i++) {
      const an = start + (2 * Math.PI * i) / total;
      push(out, L(clipSegment(cx, cy, cx + far * Math.cos(an), cy + far * Math.sin(an), a), i % ss === 0 ? 'major' : 'minor'));
    }
    return out;
  }

  /* ------------------------------------------------------------------ perspective */
  /** Angles (radians) of `n` rays from point (vx,vy). If the point lies outside the area, the rays are spread
   *  evenly over the angle the area subtends from it (so every one of them crosses the page); otherwise, or when
   *  spread = 'full', over 360°. */
  function rayAngles(vx, vy, n, a, spread) {
    n = Math.max(1, Math.round(n));
    if (spread === 'full' || inside(vx, vy, a, -1e-6)) return Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n);
    const base = Math.atan2(a.y + a.h / 2 - vy, a.x + a.w / 2 - vx);
    const d = [[a.x, a.y], [a.x + a.w, a.y], [a.x, a.y + a.h], [a.x + a.w, a.y + a.h]].map(([x, y]) => {
      let t = Math.atan2(y - vy, x - vx) - base;
      while (t > Math.PI) t -= 2 * Math.PI;
      while (t <= -Math.PI) t += 2 * Math.PI;
      return t;
    });
    const lo = Math.min(...d), hi = Math.max(...d);
    // half a step of margin on each side: the extreme rays would only graze a corner
    return Array.from({ length: n }, (_, i) => base + lo + ((hi - lo) * (i + 0.5)) / n);
  }
  /** Ray primitives from a vanishing point. */
  function rays(vx, vy, n, a, spread, layer = 'major') {
    const out = [];
    for (const an of rayAngles(vx, vy, n, a, spread)) push(out, L(clipRay(vx, vy, Math.cos(an), Math.sin(an), a), layer));
    return out;
  }
  /** Project a point of the ground plane (X sideways, Z depth, eye height 1) seen from an eye looking at the
   *  horizon line y = H, centre of vision x = xc, viewing distance f. ceiling = mirror above the horizon. */
  const projectGround = (X, Z, H, xc, f, ceiling) => [xc + (f * X) / Z, ceiling ? H - f / Z : H + f / Z];

  /** Perspective-correct ground tiles (depth guides). d1, d2: unit ground directions [X,Z] of the two line
   *  families (1-point: [1,0] and [0,1]; 2-point: towards each vanishing point). Tiles measure ≈ `tile` mm at
   *  the front edge. Lines too close to the horizon (< 0.6 mm) are skipped to avoid an ink blot. */
  function groundGrid(a, H, xc, f, d1, d2, tile, ceiling) {
    const out = [], D = ceiling ? H - a.y : a.y + a.h - H;
    if (!(D > 0.5) || !(f > 0) || !(tile > 0.2)) return out;
    const Z0 = f / D, T = (tile * Z0) / f, zNear = Z0 * 0.999, R = T * 4000;
    // Walk outwards from the line through the front-centre point in both directions; stop a direction when the
    // near ends of consecutive lines get closer than minGap on paper (the lines are piling up towards the horizon).
    const minGap = Math.max(1.5, tile * 0.12);
    const line = (k, dA, dB) => {
      const px = k * T * dA[0], pz = Z0 + k * T * dA[1];
      let t0 = -R, t1 = R;
      if (Math.abs(dB[1]) < 1e-12) { if (pz < zNear) return null; } else {
        const tz = (zNear - pz) / dB[1];
        if (dB[1] > 0) t0 = Math.max(t0, tz); else t1 = Math.min(t1, tz);
        if (t1 <= t0) return null;
      }
      const [sx1, sy1] = projectGround(px + t0 * dB[0], pz + t0 * dB[1], H, xc, f, ceiling);
      const [sx2, sy2] = projectGround(px + t1 * dB[0], pz + t1 * dB[1], H, xc, f, ceiling);
      const seg = clipSegment(sx1, sy1, sx2, sy2, a);
      if (!seg || Math.max(Math.abs(seg[1] - H), Math.abs(seg[3] - H)) < 0.6) return null;
      return seg;
    };
    const fam = (dA, dB) => {
      for (const dir of [1, -1]) {
        let last = null, misses = 0, seen = false, kept = 0;
        for (let k = dir > 0 ? 0 : -1; Math.abs(k) <= 1500 && kept < 600; k += dir) {
          const seg = line(k, dA, dB);
          if (!seg) { if (seen && ++misses > 40) break; continue; }
          seen = true; misses = 0;
          const near = Math.abs(seg[1] - H) >= Math.abs(seg[3] - H) ? [seg[0], seg[1]] : [seg[2], seg[3]];
          if (last && Math.hypot(near[0] - last[0], near[1] - last[1]) < minGap) break;
          out.push(L(seg, 'minor')); last = near; kept++;
        }
      }
    };
    fam(d1, d2); fam(d2, d1);
    return out;
  }

  /** All perspective guides. s.type = persp1 | persp2 | persp3. Positions are fractions of the page. */
  function perspective(a, s, page) {
    const out = [], H = s.hz * page.h, n = s.pLines;
    const v1 = [s.v1x * page.w, H], v2 = [s.v2x * page.w, H], v3 = [s.v3x * page.w, s.v3y * page.h];
    const evenly = (count, from, size) => Array.from({ length: count }, (_, i) => from + (size * (i + 1)) / (count + 1));
    if (s.type === 'persp1') {
      out.push(...rays(v1[0], v1[1], n, a, s.pSpread));
      for (const x of evenly(Math.round(s.pVert), a.x, a.w)) push(out, L(clipSegment(x, a.y, x, a.y + a.h, a), 'minor'));
      for (const y of evenly(Math.round(s.pHoriz), a.y, a.h)) push(out, L(clipSegment(a.x, y, a.x + a.w, y, a), 'minor'));
      if (s.pDepth) {
        const f = s.pDist * Math.hypot(page.w, page.h);
        for (const c of [false, true]) out.push(...groundGrid(a, H, v1[0], f, [1, 0], [0, 1], s.pTile, c));
      }
    } else {
      out.push(...rays(v1[0], v1[1], n, a, s.pSpread), ...rays(v2[0], v2[1], n, a, s.pSpread));
      if (s.type === 'persp2') {
        for (const x of evenly(Math.round(s.pVert), a.x, a.w)) push(out, L(clipSegment(x, a.y, x, a.y + a.h, a), 'minor'));
        const lo = Math.min(v1[0], v2[0]), hi = Math.max(v1[0], v2[0]);
        if (s.pDepth && hi - lo > 1) {
          // centre of vision halfway between the vanishing points → viewing distance f = half their distance
          const xc = (lo + hi) / 2, f = (hi - lo) / 2, n1 = Math.hypot(lo - xc, f), n2 = Math.hypot(hi - xc, f);
          for (const c of [false, true]) out.push(...groundGrid(a, H, xc, f, [(lo - xc) / n1, f / n1], [(hi - xc) / n2, f / n2], s.pTile, c));
        }
      } else out.push(...rays(v3[0], v3[1], n, a, s.pSpread));
    }
    if (s.pMarks) {
      push(out, L(clipSegment(a.x, H, a.x + a.w, H, a), 'accent'));
      const pts = s.type === 'persp1' ? [v1] : s.type === 'persp2' ? [v1, v2] : [v1, v2, v3];
      for (const [x, y] of pts) if (inside(x, y, a)) out.push({ t: 'c', x, y, r: 1.6, L: 'accent' }, { t: 'd', x, y, r: 0.45, L: 'accent' });
    }
    return out;
  }

  /* ------------------------------------------------------------------ composition overlays */
  /** Golden spiral as a polyline inside a golden rectangle of size PHI × 1, then mapped to area a.
   *  rot (0–3) rotates the spiral by quarter turns, flip mirrors it horizontally. Also returns the square
   *  divisions (Fibonacci-like rectangles). */
  function goldenSpiral(a, rot = 0, flip = false, turns = 9) {
    let x = 0, y = 0, w = PHI, h = 1;
    const pts = [], divs = [];
    for (let i = 0; i < turns; i++) {
      const st = i % 4;
      let cx, cy, a0, sz;
      if (st === 0) { sz = h; cx = x + sz; cy = y + sz; a0 = 180; divs.push([x + sz, y, x + sz, y + h]); x += sz; w -= sz; }
      else if (st === 1) { sz = w; cx = x; cy = y + sz; a0 = 270; divs.push([x, y + sz, x + w, y + sz]); y += sz; h -= sz; }
      else if (st === 2) { sz = h; cx = x + w - sz; cy = y; a0 = 0; divs.push([x + w - sz, y, x + w - sz, y + h]); w -= sz; }
      else { sz = w; cx = x + sz; cy = y + h - sz; a0 = 90; divs.push([x, y + h - sz, x + w, y + h - sz]); h -= sz; }
      for (let k = i === 0 ? 0 : 1; k <= 16; k++) { const an = (a0 + (90 * k) / 16) * RAD; pts.push([cx + sz * Math.cos(an), cy + sz * Math.sin(an)]); }
    }
    // map unit golden rectangle (0..PHI, 0..1) → area, with rotation / mirror applied in normalised space
    const map = ([px, py]) => {
      let u = px / PHI, v = py; // 0..1
      if (flip) u = 1 - u;
      for (let r = 0; r < mod(rot, 4); r++) [u, v] = [1 - v, u]; // quarter turn of the unit square
      return [a.x + u * a.w, a.y + v * a.h];
    };
    const flat = [];
    for (const p of pts) flat.push(...map(p));
    return { pts: flat, divs: divs.map(([x1, y1, x2, y2]) => [...map([x1, y1]), ...map([x2, y2])]) };
  }

  /** Composition overlays on area a (accent layer): thirds, golden sections, golden spiral, diagonals,
   *  centre cross and layout columns/rows with gutter. */
  function overlays(a, s) {
    const out = [], X = (f) => a.x + a.w * f, Y = (f) => a.y + a.h * f;
    const v = (x, dash) => push(out, L(clipSegment(x, a.y, x, a.y + a.h, a), 'accent', dash));
    const hz = (y, dash) => push(out, L(clipSegment(a.x, y, a.x + a.w, y, a), 'accent', dash));
    if (s.oThirds) for (const f of [1 / 3, 2 / 3]) { v(X(f)); hz(Y(f)); }
    if (s.oPhi) for (const f of [1 - 1 / PHI, 1 / PHI]) { v(X(f), true); hz(Y(f), true); }
    if (s.oDiag) {
      const seg = (x1, y1, x2, y2) => push(out, L(clipSegment(x1, y1, x2, y2, a), 'accent'));
      seg(a.x, a.y, a.x + a.w, a.y + a.h); seg(a.x + a.w, a.y, a.x, a.y + a.h);
      // reciprocal diagonals: from the two other corners, perpendicular to each main diagonal
      const recip = (px, py, dx, dy) => { const len = Math.hypot(dx, dy); push(out, L(clipLine(px, py, -dy / len, dx / len, a), 'accent', true)); };
      recip(a.x + a.w, a.y, a.w, a.h); recip(a.x, a.y + a.h, a.w, a.h);
      recip(a.x, a.y, -a.w, a.h); recip(a.x + a.w, a.y + a.h, -a.w, a.h);
    }
    if (s.oCenter) {
      const cx = X(0.5), cy = Y(0.5), k = Math.min(a.w, a.h) * 0.04;
      out.push(L([cx - k, cy, cx + k, cy], 'accent'), L([cx, cy - k, cx, cy + k], 'accent'), { t: 'c', x: cx, y: cy, r: k * 0.6, L: 'accent' });
    }
    if (s.oSpiral) {
      const sp = goldenSpiral(a, s.oSpiralRot, s.oSpiralFlip);
      out.push({ t: 'p', pts: sp.pts, closed: false, L: 'accent' });
      for (const d of sp.divs) push(out, L(clipSegment(...d, a), 'accent', true));
    }
    const cols = Math.round(s.oCols), rows = Math.round(s.oRows), g = Math.max(0, s.oGut);
    if (cols > 1) { const cw = (a.w - g * (cols - 1)) / cols; if (cw > 0) for (let i = 1; i < cols; i++) { const x = a.x + i * cw + (i - 1) * g; v(x); if (g > 0) v(x + g); } }
    if (rows > 1) { const rh = (a.h - g * (rows - 1)) / rows; if (rh > 0) for (let i = 1; i < rows; i++) { const y = a.y + i * rh + (i - 1) * g; hz(y); if (g > 0) hz(y + g); } }
    return out;
  }

  /* ------------------------------------------------------------------ comics & storyboard */
  /** Parse a comic layout: rows separated by commas; each row is a panel count ("3") or width ratios ("2:1").
   *  Returns an array of rows, each an array of relative widths, or null if the text is invalid. */
  function parseRows(text) {
    const rows = String(text || '').split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
    if (!rows.length || rows.length > 12) return null;
    const out = [];
    for (const r of rows) {
      if (/^\d+$/.test(r)) { const n = +r; if (n < 1 || n > 8) return null; out.push(Array(n).fill(1)); continue; }
      const parts = r.split(':').map(Number);
      if (parts.length < 2 || parts.length > 8 || parts.some((p) => !(p > 0) || p > 20)) return null;
      out.push(parts);
    }
    return out;
  }
  /** Parse relative row heights ("1,1,2"); missing / invalid values become 1. */
  const parseRatios = (text, n) => Array.from({ length: n }, (_, i) => { const v = Number(String(text || '').split(/[,;:\s]+/)[i]); return v > 0 && v <= 20 ? v : 1; });

  /** Comic page panels as rectangles (major layer). */
  function comicPanels(a, s) {
    const rows = parseRows(s.rows) || [[1]], hs = parseRatios(s.heights, rows.length), out = [];
    const gv = Math.max(0, s.gutV), gh = Math.max(0, s.gutH), sumH = hs.reduce((p, c) => p + c, 0);
    const avail = a.h - gv * (rows.length - 1);
    if (avail <= 0) return out;
    let y = a.y;
    rows.forEach((ws, r) => {
      const rh = (avail * hs[r]) / sumH, sumW = ws.reduce((p, c) => p + c, 0), aw = a.w - gh * (ws.length - 1);
      let x = a.x;
      if (aw > 0) ws.forEach((wr) => { const pw = (aw * wr) / sumW; out.push({ t: 'r', x, y, w: pw, h: rh, rx: Math.min(s.panelR, pw / 2, rh / 2), L: 'major' }); x += pw + gh; });
      y += rh + gv;
    });
    return out;
  }

  const ASPECTS = { '16:9': 16 / 9, '2.39:1': 2.39, '1.85:1': 1.85, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16, '3:2': 1.5 };
  /** Storyboard sheet: sbCols × sbRows frames of a given aspect ratio, each with a number box and note lines. */
  function storyboard(a, s) {
    const out = [], c = Math.max(1, Math.round(s.sbCols)), r = Math.max(1, Math.round(s.sbRows)), g = Math.max(0, s.sbGutter);
    const cw = (a.w - g * (c - 1)) / c, ch = (a.h - g * (r - 1)) / r, ar = ASPECTS[s.sbAspect] || 16 / 9;
    const nl = Math.max(0, Math.round(s.sbLines)), lg = Math.max(2, s.sbLineGap), notes = nl * lg;
    if (cw <= 2 || ch <= 2) return out;
    let fw = cw, fh = cw / ar;
    if (fh > ch - notes - 2) { fh = Math.max(4, ch - notes - 2); fw = Math.min(cw, fh * ar); }
    for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) {
      const x = a.x + i * (cw + g), y = a.y + j * (ch + g), fx = x + (cw - fw) / 2;
      out.push({ t: 'r', x: fx, y, w: fw, h: fh, rx: 0, L: 'major' });
      const nb = Math.min(7, fh / 4, fw / 6);
      out.push({ t: 'r', x: fx, y, w: nb * 1.6, h: nb, rx: 0, L: 'minor' });
      for (let k = 1; k <= nl; k++) { const ly = y + fh + k * lg; if (ly <= a.y + a.h + 1e-6) push(out, L([fx, ly, fx + fw, ly], 'minor')); }
    }
    return out;
  }

  /* ------------------------------------------------------------------ calligraphy / handwriting */
  /** Calligraphy guide lines in nib widths: xh (x-height / body), ah (ascender line, from baseline),
   *  ch (cap line, 0 = off), dh (descender, below baseline), lg (gap between writing bands). Slant lines at
   *  `slant` degrees from horizontal (90 = none) every slantGap mm, optional mid line, x-band shading, square
   *  modules (Tifinagh) and a ladder of nib-width rhombi at the line start (right side when rtl). */
  function calligraphy(a, s) {
    const out = [], nib = Math.max(0.2, s.nib), up = Math.max(s.xh, s.ah, s.ch, 0.5) * nib, down = Math.max(0, s.dh) * nib;
    const pitch = up + down + Math.max(0, s.lg) * nib;
    if (pitch < 1 || a.h < up + down) return out;
    const hl = (y, layer, dash) => push(out, L(clipSegment(a.x, y, a.x + a.w, y, a), layer, dash));
    for (let base = a.y + up; base + down <= a.y + a.h + 1e-6 && out.length < 60000; base += pitch) {
      const top = base - up, bottom = base + down, xl = base - s.xh * nib;
      if (s.shade && s.xh > 0) out.push({ t: 'r', x: a.x, y: xl, w: a.w, h: s.xh * nib, rx: 0, fill: true, L: 'shade' });
      if (s.ah > 0 && s.ah !== s.xh) hl(base - s.ah * nib, 'minor');
      if (s.ch > 0 && s.ch !== s.ah) hl(base - s.ch * nib, 'minor', true);
      if (s.xh > 0) hl(xl, 'major');
      if (s.mid && s.xh > 0) hl(base - (s.xh * nib) / 2, 'minor', true);
      hl(base, 'major');
      if (s.dh > 0) hl(bottom, 'minor');
      if (s.slant > 0 && s.slant < 89.9 && s.slantGap > 0.5) {
        const band = { x: a.x, y: top, w: a.w, h: bottom - top }, run = (bottom - top) / Math.tan(s.slant * RAD);
        for (let x = a.x - run; x <= a.x + a.w; x += s.slantGap) push(out, L(clipSegment(x, bottom, x + run, top, band), 'minor'));
      }
      if (s.modules && s.xh > 0) {
        const step = (s.xh * nib) / 2, band = { x: a.x, y: xl, w: a.w, h: s.xh * nib };
        for (let x = a.x; x <= a.x + a.w + 1e-6; x += step) push(out, L(clipSegment(x, band.y, x, band.y + band.h, band), 'minor', true));
      }
      if (s.ladder) {
        const n = Math.round(Math.max(s.ah, s.xh)), m = Math.round(s.dh), hw = nib / 2;
        const x0 = s.rtl ? a.x + a.w - nib * 2 : a.x + nib * 2;
        const dia = (cx, cy) => out.push({ t: 'p', pts: [cx, cy - hw, cx + hw, cy, cx, cy + hw, cx - hw, cy], closed: true, fill: true, L: 'major' });
        for (let k = 0; k < n; k++) dia(x0 + (k % 2 ? hw : -hw), base - (k + 0.5) * nib);
        for (let k = 0; k < m; k++) dia(x0 + (k % 2 ? hw : -hw), base + (k + 0.5) * nib);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ scene */
  /** Build the complete scene for a settings object: document box (trim + bleed + slug for crop marks),
   *  drawing area, primitives and draggable handles (vanishing points, horizon, polar centre). */
  function buildScene(s) {
    const page = pageSize(s), b = Math.max(0, +s.bleed || 0), slug = s.cropMarks ? 9 : 0;
    const doc = { x: -b - slug, y: -b - slug, w: page.w + 2 * (b + slug), h: page.h + 2 * (b + slug) };
    const trim = { x: 0, y: 0, w: page.w, h: page.h };
    let area = { x: s.ml, y: s.mt, w: page.w - s.ml - s.mr, h: page.h - s.mt - s.mb };
    if (s.gridBleed) area = { x: -b, y: -b, w: page.w + 2 * b, h: page.h + 2 * b };
    const scene = { page, doc, trim, bleed: b, area, prims: [], handles: [], warning: '' };
    if (!(area.w > 1 && area.h > 1)) { scene.warning = 'noArea'; return scene; }
    let g = [];
    switch (s.type) {
      case 'square': g = squareGrid(area, s); break;
      case 'dot': g = dotGrid(area, s); break;
      case 'iso': g = axoGrid(area, s, 30); break;
      case 'dimetric': g = axoGrid(area, s, s.dimAngle); break;
      case 'isodot': g = isoDotGrid(area, s); break;
      case 'triangle': g = triangleGrid(area, s); break;
      case 'hex': g = hexGrid(area, s); break;
      case 'ruled': g = ruledGrid(area, s); break;
      case 'polar': g = polarGrid(area, s, s.pcx * page.w, s.pcy * page.h); scene.handles.push({ id: 'pc', x: s.pcx * page.w, y: s.pcy * page.h }); break;
      case 'persp1': case 'persp2': case 'persp3': {
        g = perspective(area, s, page);
        const H = s.hz * page.h;
        scene.handles.push({ id: 'hz', y: H, line: true }, { id: 'v1', x: s.v1x * page.w, y: H });
        if (s.type !== 'persp1') scene.handles.push({ id: 'v2', x: s.v2x * page.w, y: H });
        if (s.type === 'persp3') scene.handles.push({ id: 'v3', x: s.v3x * page.w, y: s.v3y * page.h });
        break;
      }
      case 'comic': g = comicPanels(area, s); break;
      case 'storyboard': g = storyboard(area, s); break;
      case 'calligraphy': g = calligraphy(area, s); break;
      default: g = []; // 'blank': only overlays / frame
    }
    if ((s.type === 'dot' || s.type === 'isodot') && !g.length) scene.warning = 'tooDense';
    scene.prims = g.concat(overlays(area, s));
    if (s.frame && s.type !== 'comic' && s.type !== 'storyboard') scene.prims.push({ t: 'r', x: area.x, y: area.y, w: area.w, h: area.h, rx: 0, L: 'major' });
    if (s.cropMarks) scene.prims.push(...cropMarks(page, b));
    return scene;
  }

  /** Crop marks at the four trim corners, starting 2 mm outside the bleed, 6 mm long. */
  function cropMarks(page, b) {
    const out = [], off = b + 2, len = 6;
    for (const x of [0, page.w]) for (const y of [0, page.h]) {
      const sx = x === 0 ? -1 : 1, sy = y === 0 ? -1 : 1;
      out.push(L([x + sx * off, y, x + sx * (off + len), y], 'marks'), L([x, y + sy * off, x, y + sy * (off + len)], 'marks'));
    }
    return out;
  }

  /** Bounding box used by the preview: the document plus the handles (vanishing points may sit off the page),
   *  limited to 4 page sizes around the page. */
  function previewBox(scene, pad = 12) {
    let { x, y, w, h } = scene.doc, x2 = x + w, y2 = y + h;
    const lim = 4 * Math.max(scene.page.w, scene.page.h);
    for (const hd of scene.handles) {
      if (hd.x != null) { x = Math.min(x, hd.x - pad); x2 = Math.max(x2, hd.x + pad); }
      if (hd.y != null) { y = Math.min(y, hd.y - pad); y2 = Math.max(y2, hd.y + pad); }
    }
    x = Math.max(x, -lim); y = Math.max(y, -lim); x2 = Math.min(x2, scene.page.w + lim); y2 = Math.min(y2, scene.page.h + lim);
    return { x, y, w: x2 - x, h: y2 - y };
  }

  return { MM_PER_IN, PX_PER_IN, PHI, FORMATS, ASPECTS, toMm, fromMm, mmToDots, round, pageSize, clipParam, clipSegment, clipLine, clipRay, inside,
    parallelFamily, squareGrid, dotGrid, axoGrid, isoDotGrid, triangleGrid, hexGrid, ruledGrid, polarGrid, rayAngles, rays, projectGround, groundGrid,
    perspective, goldenSpiral, overlays, parseRows, parseRatios, comicPanels, storyboard, calligraphy, buildScene, cropMarks, previewBox };
});
