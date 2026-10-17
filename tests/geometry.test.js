// Unit tests (plain Node, no dependencies): node tests/geometry.test.js
// Geometry (units, clipping, every grid generator, perspective convergence, depth tiles, golden spiral, comics,
// storyboard, calligraphy), settings (validation, URL hash), SVG / canvas / PNG export helpers and i18n.
const assert = require('assert'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const G = require('../js/geometry.js'), S = require('../js/settings.js'), E = require('../js/export.js'), I = require('../js/i18n.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n    ')); } }
const near = (a, b, eps = 1e-6, msg) => assert(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);
const lines = (prims, L) => prims.filter((p) => p.t === 'l' && (!L || p.L === L));
const angle = (l) => { let a = (Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180) / Math.PI; a = ((a % 180) + 180) % 180; return Math.abs(a - 180) < 1e-6 ? 0 : a; };
/** Distance from point (px,py) to the infinite line through segment l. */
const distToLine = (l, px, py) => Math.abs((l.x2 - l.x1) * (l.y1 - py) - (l.x1 - px) * (l.y2 - l.y1)) / Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
const set = (o) => S.sanitize({ ...S.DEFAULTS, ...o });
const A = { x: 0, y: 0, w: 100, h: 100 };

console.log('units & formats');
test('mm / in / px conversions round-trip', () => {
  near(G.toMm(1, 'in'), 25.4); near(G.toMm(96, 'px'), 25.4); near(G.toMm(12, 'mm'), 12);
  for (const u of ['mm', 'in', 'px']) for (const v of [0, 1, 7.5, 297]) near(G.fromMm(G.toMm(v, u), u), v, 1e-9);
  assert.strictEqual(G.mmToDots(210, 300), 2480); assert.strictEqual(G.mmToDots(297, 300), 3508); assert.strictEqual(G.mmToDots(25.4, 600), 600);
});
test('page formats and orientation', () => {
  assert.deepStrictEqual(G.pageSize({ format: 'A4', orient: 'portrait' }), { w: 210, h: 297 });
  assert.deepStrictEqual(G.pageSize({ format: 'A4', orient: 'landscape' }), { w: 297, h: 210 });
  assert.deepStrictEqual(G.pageSize({ format: 'square', orient: 'landscape' }), { w: 200, h: 200 });
  assert.deepStrictEqual(G.pageSize({ format: 'custom', cusW: 100, cusH: 50 }), { w: 100, h: 50 });
  const hd = G.pageSize({ format: 'r169', orient: 'landscape' });
  near(G.fromMm(hd.w, 'px'), 1920, 1e-9); near(G.fromMm(hd.h, 'px'), 1080, 1e-9);
  near(G.pageSize({ format: 'letter', orient: 'portrait' }).w, 8.5 * 25.4, 1e-9);
});

console.log('clipping');
test('segment clipping (Liang–Barsky)', () => {
  assert.deepStrictEqual(G.clipSegment(10, 10, 90, 90, A), [10, 10, 90, 90]);
  assert.deepStrictEqual(G.clipSegment(-50, 50, 150, 50, A), [0, 50, 100, 50]);
  assert.strictEqual(G.clipSegment(-10, -10, -5, 120, A), null);
  assert.strictEqual(G.clipSegment(-10, 0, 0, -10, A), null, 'touching a corner only');
  const d = G.clipLine(50, 50, 1, 1, A); assert.deepStrictEqual(d.map((v) => G.round(v)), [0, 0, 100, 100]);
  assert.strictEqual(G.clipRay(-10, 50, -1, 0, A), null, 'ray pointing away');
  assert.deepStrictEqual(G.clipRay(-10, 50, 1, 0, A).map((v) => G.round(v)), [0, 50, 100, 50]);
});

console.log('regular grids');
test('parallel family: count, spacing and major lines', () => {
  const v = G.parallelFamily(A, 90, 2, 0, 0, 5);
  assert.strictEqual(v.length, 51); assert.strictEqual(v.filter((l) => l.L === 'major').length, 11);
  const xs = v.map((l) => G.round(l.x1)).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) near(xs[i] - xs[i - 1], 2, 1e-9);
  v.forEach((l) => { near(l.y1 === 0 ? l.y1 : l.y2, 0, 1e-9); near(Math.abs(l.y2 - l.y1), 100, 1e-9); });
});
test('square grid on A4 (10 mm cells, 5 subdivisions) and centring', () => {
  const sc = G.buildScene(set({ type: 'square', cell: 10, sub: 5 }));
  assert.deepStrictEqual(sc.area, { x: 10, y: 10, w: 190, h: 277 });
  const ls = lines(sc.prims);
  assert.strictEqual(ls.filter((l) => angle(l) === 90).length, 96); assert.strictEqual(ls.filter((l) => angle(l) === 0).length, 139);
  const c = G.squareGrid({ x: 0, y: 0, w: 95, h: 95 }, { cell: 10, sub: 1, center: true });
  assert(c.some((l) => near0(l.x1 - 47.5) && near0(l.x2 - 47.5)), 'a line through the centre');
  function near0(v) { return Math.abs(v) < 1e-9; }
});
test('dot grid: count, major dots, density guard', () => {
  const d = G.dotGrid(A, { cell: 10, sub: 5, dotR: 0.4 });
  assert.strictEqual(d.length, 121); assert.strictEqual(d.filter((p) => p.L === 'major').length, 9);
  assert(d.every((p) => p.t === 'd' && G.inside(p.x, p.y, A)));
  assert.strictEqual(G.dotGrid({ x: 0, y: 0, w: 2000, h: 2000 }, { cell: 1, sub: 1, dotR: 0.1 }).length, 0);
  assert.strictEqual(G.buildScene(set({ type: 'dot', format: 'custom', cusW: 2000, cusH: 2000, cell: 0.6 })).warning, 'tooDense');
});
test('isometric lattice: 30° / 150° / 90° lines meet at common points', () => {
  const s = { cell: 10, sub: 1, center: false, isoVert: true }, out = G.axoGrid(A, s, 30);
  const angs = new Set(out.map((l) => Math.round(angle(l) * 1000) / 1000));
  assert.deepStrictEqual([...angs].sort((a, b) => a - b), [30, 90, 150]);
  near(out.u, 10 * Math.cos(Math.PI / 6), 1e-9); near(out.v, 10, 1e-9, 'lattice step = side');
  const p = out.filter((l) => Math.abs(angle(l) - 30) < 1e-6), q = out.filter((l) => Math.abs(angle(l) - 150) < 1e-6);
  let checked = 0;
  for (const a of p) for (const b of q) {
    const x = ((b.y1 - a.y1) + Math.tan(Math.PI / 6) * a.x1 + Math.tan(Math.PI / 6) * b.x1) / (2 * Math.tan(Math.PI / 6));
    const y = a.y1 + Math.tan(Math.PI / 6) * (x - a.x1);
    if (!G.inside(x, y, A)) continue;
    const i = x / out.u, j = y / (out.v / 2);
    near(i, Math.round(i), 1e-6, 'on a vertical'); near(j, Math.round(j), 1e-6, 'on a lattice row'); checked++;
  }
  assert(checked > 50, 'enough intersections checked');
});
test('dimetric 26.565° = 2:1 slopes; triangles 0/60/120°', () => {
  const d = G.axoGrid(A, { cell: 10, sub: 1, isoVert: false }, 26.565);
  d.forEach((l) => near(Math.abs((l.y2 - l.y1) / (l.x2 - l.x1)), 0.5, 1e-4));
  const t = G.triangleGrid(A, { cell: 10, sub: 1 });
  assert.deepStrictEqual([...new Set(t.map((l) => Math.round(angle(l))))].sort((a, b) => a - b), [0, 60, 120]);
  const hs = t.filter((l) => angle(l) === 0).map((l) => l.y1).sort((a, b) => a - b);
  near(hs[1] - hs[0], 5 * Math.sqrt(3), 1e-9);
});
test('hexagonal grid: unit edges, no duplicates, flat orientation', () => {
  for (const hexOrient of ['pointy', 'flat']) {
    const h = G.hexGrid({ x: -50, y: -50, w: 300, h: 300 }, { cell: 10, hexOrient, center: true, hexInner: false });
    const inner = h.filter((l) => Math.min(l.x1, l.x2) > -49 && Math.max(l.x1, l.x2) < 249 && Math.min(l.y1, l.y2) > -49 && Math.max(l.y1, l.y2) < 249);
    inner.forEach((l) => near(Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 10, 1e-6));
    const keys = h.map((l) => [Math.round((l.x1 + l.x2) * 50), Math.round((l.y1 + l.y2) * 50)].join());
    assert.strictEqual(new Set(keys).size, keys.length, 'each edge once');
    const angs = new Set(inner.map((l) => Math.round(angle(l))));
    assert.deepStrictEqual([...angs].sort((a, b) => a - b), hexOrient === 'pointy' ? [30, 90, 150] : [0, 60, 120]);
  }
});
test('ruled (Seyès) and polar grids', () => {
  const r = G.ruledGrid(A, { cell: 8, sub: 4, rVert: true, rMargin: 25 });
  assert.strictEqual(r.filter((l) => angle(l) === 0).length, 51); assert.strictEqual(r.filter((l) => l.L === 'accent').length, 1);
  const p = G.polarGrid(A, { ringGap: 10, sub: 1, spokes: 12, spokeSub: 2, polarPoly: false }, 50, 50);
  assert.strictEqual(p.filter((x) => x.t === 'c').length, 7); assert.strictEqual(lines(p).length, 24); assert.strictEqual(lines(p, 'major').length, 12);
  const poly = G.polarGrid(A, { ringGap: 10, sub: 1, spokes: 8, spokeSub: 1, polarPoly: true }, 50, 50).filter((x) => x.t === 'p');
  assert.strictEqual(poly[0].pts.length, 16); near(Math.hypot(poly[0].pts[0] - 50, poly[0].pts[1] - 50), 10, 1e-9);
});

console.log('perspective');
test('rays from an off-page vanishing point all cross the page', () => {
  for (const [vx, vy] of [[-150, 40], [300, 30], [50, -400], [50, 500]]) {
    const an = G.rayAngles(vx, vy, 20, A, 'area');
    assert.strictEqual(an.length, 20);
    assert.strictEqual(G.rays(vx, vy, 20, A, 'area').length, 20);
  }
  const inside = G.rayAngles(50, 50, 8, A, 'area');
  inside.forEach((a, i) => near(a, (i * Math.PI) / 4, 1e-12));
});
test('1-, 2- and 3-point lines converge on their vanishing points', () => {
  for (const type of ['persp1', 'persp2', 'persp3']) {
    const s = set({ type, hz: 0.4, v1x: type === 'persp1' ? 0.5 : -0.3, v2x: 1.3, v3x: 0.5, v3y: 1.8, pLines: 15, pVert: 0, pHoriz: 0, pDepth: false, pMarks: false });
    const sc = G.buildScene(s), pg = sc.page, H = 0.4 * pg.h;
    const vps = [[s.v1x * pg.w, H], [s.v2x * pg.w, H], [s.v3x * pg.w, s.v3y * pg.h]].slice(0, type === 'persp1' ? 1 : type === 'persp2' ? 2 : 3);
    const ls = lines(sc.prims).filter((l) => l.L !== 'major' || true).filter((l) => !(l.x1 === sc.area.x && l.y1 === sc.area.y && l.t === 'r'));
    const rays = ls.filter((l) => l.L === 'major');
    assert(rays.length >= 15 * vps.length * 0.9, `${type}: rays drawn (${rays.length})`);
    rays.forEach((l) => assert(vps.some(([x, y]) => distToLine(l, x, y) < 1e-6), `${type}: ray passes through a vanishing point`));
  }
});
test('2-point depth tiles converge on the two vanishing points; 1-point tiles are horizontal or converge', () => {
  const s2 = set({ type: 'persp2', hz: 0.4, v1x: -0.35, v2x: 1.35, pLines: 4, pVert: 0, pDepth: true, pTile: 15, pMarks: false });
  const sc2 = G.buildScene(s2), H = 0.4 * sc2.page.h, v1 = [-0.35 * 210, H], v2 = [1.35 * 210, H];
  const depth = lines(sc2.prims, 'minor');
  assert(depth.length > 30, 'depth lines drawn: ' + depth.length);
  depth.forEach((l) => assert(distToLine(l, ...v1) < 1e-6 || distToLine(l, ...v2) < 1e-6, 'tile edge converges'));
  const s1 = set({ type: 'persp1', hz: 0.42, v1x: 0.5, pLines: 4, pDepth: true, pTile: 20, pMarks: false });
  const sc1 = G.buildScene(s1), H1 = 0.42 * 297, d1 = lines(sc1.prims, 'minor');
  const hor = d1.filter((l) => Math.abs(l.y1 - l.y2) < 1e-9);
  assert(hor.length > 10 && d1.length - hor.length > 10);
  d1.filter((l) => Math.abs(l.y1 - l.y2) >= 1e-9).forEach((l) => assert(distToLine(l, 105, H1) < 1e-6));
  // floor horizontals get closer together towards the horizon (equal depth steps)
  const ys = [...new Set(hor.filter((l) => l.y1 > H1).map((l) => G.round(l.y1, 6)))].sort((a, b) => b - a);
  for (let i = 2; i < ys.length; i++) assert(ys[i - 1] - ys[i] < ys[i - 2] - ys[i - 1] + 1e-9, 'spacing shrinks');
  // exact projection: with eye height 1 the k-th line sits at H + f/(Z0 + k·T)
  const f = Math.hypot(210, 297), D = 287 - H1, Z0 = f / D, T = (20 * Z0) / f;
  for (let k = 0; k < 5; k++) near(ys[k], H1 + f / (Z0 + k * T), 1e-6, 'floor line ' + k);
});
test('ground projection: lines vanish where expected', () => {
  const [x, y] = G.projectGround(1e9 * 0.5, 1e9, 100, 50, 200, false);
  near(x, 150, 1e-6); near(y, 100, 1e-6);
  const [, yc] = G.projectGround(0, 2, 100, 50, 200, true); near(yc, 0);
});
test('perspective handles and preview box include off-page points', () => {
  const sc = G.buildScene(set({ type: 'persp3', v1x: -0.5, v2x: 1.5, v3y: 2 }));
  assert.deepStrictEqual(sc.handles.map((h) => h.id), ['hz', 'v1', 'v2', 'v3']);
  const b = G.previewBox(sc);
  assert(b.x <= -105 - 12 + 1e-9 && b.x + b.w >= 315 && b.y + b.h >= 594);
});

console.log('composition, comics, storyboard, calligraphy');
test('thirds, golden sections, diagonals, columns', () => {
  const o = G.overlays(A, { oThirds: true, oCols: 0, oRows: 0 });
  assert.deepStrictEqual(o.filter((l) => angle(l) === 90).map((l) => G.round(l.x1)).sort((a, b) => a - b), [33.333, 66.667]);
  const g = G.overlays(A, { oPhi: true }).filter((l) => angle(l) === 90).map((l) => G.round(l.x1, 4));
  assert.deepStrictEqual(g.sort((a, b) => a - b), [38.1966, 61.8034]);
  assert(G.overlays(A, { oPhi: true }).every((l) => l.dash));
  assert.strictEqual(G.overlays(A, { oDiag: true }).length, 6);
  const c = G.overlays(A, { oCols: 4, oGut: 4 }).map((l) => G.round(l.x1)).sort((a, b) => a - b);
  assert.deepStrictEqual(c, [22, 26, 48, 52, 74, 78]);
});
test('golden spiral stays in the frame and starts at a corner', () => {
  for (let rot = 0; rot < 4; rot++) for (const flip of [false, true]) {
    const { pts, divs } = G.goldenSpiral(A, rot, flip);
    for (let i = 0; i < pts.length; i += 2) assert(G.inside(pts[i], pts[i + 1], A, 1e-6));
    for (let i = 2; i < pts.length; i += 2) assert(Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]) < 11, 'continuous');
    assert([0, 100].includes(G.round(pts[0])) && [0, 100].includes(G.round(pts[1])), 'starts at a corner');
    assert.strictEqual(divs.length, 9);
  }
  const { pts } = G.goldenSpiral({ x: 0, y: 0, w: G.PHI * 100, h: 100 }); near(pts[0], 0, 1e-9); near(pts[1], 100, 1e-9);
});
test('comic layout parsing and panels', () => {
  assert.deepStrictEqual(G.parseRows('2, 3'), [[1, 1], [1, 1, 1]]);
  assert.deepStrictEqual(G.parseRows('1, 2:1'), [[1], [2, 1]]);
  for (const bad of ['', 'a', '0', '9', '2:x', '<script>']) assert.strictEqual(G.parseRows(bad), null, bad);
  assert.deepStrictEqual(G.parseRatios('1, 2', 3), [1, 2, 1]);
  const p = G.comicPanels(A, { rows: '2,1:3', heights: '1,3', gutH: 4, gutV: 4, panelR: 0 });
  assert.strictEqual(p.length, 4);
  near(p[0].w, 48); near(p[0].h, 24); near(p[2].y, 28); near(p[2].h, 72); near(p[2].w, 24); near(p[3].x + p[3].w, 100);
});
test('storyboard frames keep their aspect ratio', () => {
  const sb = G.storyboard({ x: 0, y: 0, w: 277, h: 190 }, { sbCols: 3, sbRows: 2, sbAspect: '16:9', sbLines: 3, sbLineGap: 6, sbGutter: 10 });
  const frames = sb.filter((p) => p.t === 'r' && p.L === 'major');
  assert.strictEqual(frames.length, 6);
  frames.forEach((f) => near(f.w / f.h, 16 / 9, 1e-9));
  assert.strictEqual(lines(sb).length, 18);
});
test('calligraphy guide lines: heights in nib widths, slant angle, ladder side', () => {
  const s = { nib: 2, xh: 5, ah: 9, ch: 0, dh: 4, lg: 2, slant: 83, slantGap: 8, mid: false, shade: true, ladder: true, rtl: false, modules: false };
  const c = G.calligraphy({ x: 0, y: 0, w: 100, h: 60 }, s);
  const hs = [...new Set(lines(c).filter((l) => angle(l) === 0).map((l) => G.round(l.y1)))].sort((a, b) => a - b);
  assert.deepStrictEqual(hs.slice(0, 4), [0, 8, 18, 26], 'ascender, x-line, baseline, descender of line 1');
  near(hs[4] - hs[0], 30, 1e-9, 'line pitch = (9 + 4 + 2) nib widths');
  lines(c).filter((l) => angle(l) !== 0).forEach((l) => near(angle(l), 180 - 83, 1e-6));
  const dia = c.filter((p) => p.t === 'p' && p.fill);
  assert.strictEqual(dia.length, (9 + 4) * 2); assert(dia.every((d) => d.pts[0] < 10));
  const rtl = G.calligraphy({ x: 0, y: 0, w: 100, h: 60 }, { ...s, rtl: true }).filter((p) => p.t === 'p');
  assert(rtl.every((d) => d.pts[0] > 90), 'ladder on the right for Arabic');
  const tf = G.calligraphy({ x: 0, y: 0, w: 100, h: 60 }, { ...S.CALLI.tifinagh });
  assert(lines(tf).some((l) => angle(l) === 90 && l.dash), 'square modules');
});
test('bleed, crop marks and grid-into-bleed', () => {
  const sc = G.buildScene(set({ bleed: 3, cropMarks: true }));
  assert.deepStrictEqual(sc.doc, { x: -12, y: -12, w: 234, h: 321 });
  assert.strictEqual(sc.prims.filter((p) => p.L === 'marks').length, 8);
  assert.deepStrictEqual(G.buildScene(set({ bleed: 3, gridBleed: true })).area, { x: -3, y: -3, w: 216, h: 303 });
  assert.strictEqual(G.buildScene(set({ ml: 120, mr: 120 })).warning, 'noArea');
});
test('every grid type and every preset builds a non-empty scene', () => {
  for (const type of S.TYPES) assert(G.buildScene(set({ type, oThirds: type === 'blank' })).prims.length > 0, type);
  for (const [k, p] of Object.entries(S.PRESETS)) {
    const sc = G.buildScene(set(p));
    assert(sc.prims.length > 2 && !sc.warning, k);
    sc.prims.forEach((q) => Object.values(q).forEach((v) => typeof v === 'number' && assert(isFinite(v), k + ' finite')));
  }
});

console.log('settings');
test('sanitize: types, ranges, enumerations, colours, unknown keys', () => {
  const s = S.sanitize({ type: 'nope', cell: '-4', sub: 99, majC: 'red', bg: '#ABCDEF', center: 'true', evil: 1, rows: '<img onerror=x>', format: 'A3' });
  assert.strictEqual(s.type, 'square'); assert.strictEqual(s.cell, 0.5); assert.strictEqual(s.sub, 20); assert.strictEqual(s.majC, S.DEFAULTS.majC);
  assert.strictEqual(s.bg, '#abcdef'); assert.strictEqual(s.center, true); assert(!('evil' in s)); assert.strictEqual(s.rows, S.DEFAULTS.rows); assert.strictEqual(s.format, 'A3');
  assert.deepStrictEqual(S.sanitize(null), S.DEFAULTS);
  assert.strictEqual(Object.keys(S.DEFAULTS).length, new Set(Object.keys(S.DEFAULTS)).size);
});
test('URL hash: only changed settings, lossless round-trip', () => {
  assert.strictEqual(S.toHash(S.DEFAULTS), '');
  const s = set({ type: 'persp2', v1x: -0.25, center: true, rows: '1, 2:1', majC: '#123456', format: 'A3', orient: 'landscape' });
  const h = S.toHash(s);
  assert(h.startsWith('#') && h.includes('type=persp2') && !h.includes('cell='));
  assert.deepStrictEqual(S.fromHash(h), s);
  assert.strictEqual(S.fromHash('#foo=bar'), null); assert.strictEqual(S.fromHash(''), null);
  assert.strictEqual(S.fromHash('#cell=abc').cell, S.DEFAULTS.cell);
});
test('themes and calligraphy presets only use valid keys', () => {
  for (const t of Object.values(S.THEMES)) for (const k of Object.keys(t)) assert(k in S.DEFAULTS, k);
  for (const c of Object.values(S.CALLI)) for (const k of Object.keys(c)) assert(k in S.DEFAULTS, k);
  for (const p of Object.values(S.PRESETS)) for (const k of Object.keys(p)) assert(k in S.DEFAULTS, k);
});

console.log('export');
test('SVG: millimetre size, layers, metadata round-trip', () => {
  const s = set({ type: 'calligraphy', bleed: 3, cropMarks: true, oThirds: true });
  const svg = E.toSVG(G.buildScene(s), s, { metadata: JSON.stringify({ ...s, heights: 'x]]>y' }) });
  assert(svg.includes('width="234mm" height="321mm"') && svg.includes('viewBox="-12 -12 234 321"'));
  for (const id of ['background', 'shade', 'minor', 'major', 'accent', 'marks']) assert(svg.includes(`<g id="${id}"`) || id === 'background', id);
  assert.strictEqual((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
  assert(!/NaN|undefined|Infinity/.test(svg));
  assert.strictEqual(E.settingsFromSVG(svg).heights, 'x]]>y');
  assert.strictEqual(E.settingsFromSVG('<svg/>'), null);
  const t = E.toSVG(G.buildScene(set({ transparent: true })), set({ transparent: true }));
  assert(!t.includes('id="background"'));
});
test('SVG path data for rectangles, rounded panels and dots', () => {
  assert.strictEqual(E.pathData([{ t: 'r', x: 1, y: 2, w: 3, h: 4 }]), 'M1 2h3v4h-3Z');
  assert(E.pathData([{ t: 'r', x: 0, y: 0, w: 10, h: 10, rx: 2 }]).includes('A2 2 0 0 1'));
  assert.strictEqual(E.pathData([{ t: 'd', x: 5, y: 5, r: 1 }]), 'M4 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0Z');
});
test('canvas renderer draws every layer with the right scale', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, a])), set: (o, k, v) => { o[k] = v; calls.push(['=' + String(k), v]); return true; } });
  const s = set({ type: 'calligraphy', oThirds: true, cropMarks: true, bleed: 2 }), sc = G.buildScene(s);
  E.drawScene(ctx, sc, s, 300 / 25.4);
  const tf = calls.find((c) => c[0] === 'setTransform');
  near(tf[1][0], 300 / 25.4); near(tf[1][4], 11 * (300 / 25.4));
  assert(calls.filter((c) => c[0] === 'stroke').length >= 4 && calls.some((c) => c[0] === 'fill'));
  assert(calls.some((c) => c[0] === 'setLineDash' && c[1][0].length === 2));
});
test('CRC-32 and PNG pHYs (DPI) chunk', () => {
  assert.strictEqual(E.crc32(Buffer.from('IEND')), 0xae426082);
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(E.crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
  assert.strictEqual(E.pngDpi(png), null);
  const p300 = E.pngWithDpi(png, 300); assert.strictEqual(E.pngDpi(p300), 300);
  const p600 = E.pngWithDpi(p300, 600); assert.strictEqual(E.pngDpi(p600), 600); assert.strictEqual(p600.length, png.length + 21);
  // every chunk keeps a valid CRC
  for (let off = 8; off < p600.length;) {
    const len = Buffer.from(p600.subarray(off, off + 4)).readUInt32BE(0), crc = Buffer.from(p600.subarray(off + 8 + len, off + 12 + len)).readUInt32BE(0);
    assert.strictEqual(E.crc32(p600.subarray(off + 4, off + 8 + len)), crc); off += 12 + len;
  }
  assert.throws(() => E.pngWithDpi(Buffer.from('nope'), 300));
});

console.log('i18n');
test('every text exists in FR, EN and Taqbaylit; every key used in the HTML is defined', () => {
  for (const [k, v] of Object.entries(I.S)) assert(Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'string' && x.length), k);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]).concat([...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(';').map((p) => p.split(':')[1])));
  keys.forEach((k) => assert(k in I.S, 'missing ' + k));
  for (const t of S.TYPES) assert('t_' + t in I.S); for (const p of Object.keys(S.PRESETS)) assert('p_' + p in I.S, p);
  for (const c of Object.keys(S.CALLI)) assert('cp_' + c in I.S); for (const c of Object.keys(S.COMIC)) assert('cl_' + c in I.S); for (const t of Object.keys(S.THEMES)) assert('th_' + t in I.S);
});
test('Tifinagh rendering keeps placeholders, units and acronyms', () => {
  assert.strictEqual(I.toTifinagh('Anaw n uẓeṭṭa'), 'ⴰⵏⴰⵡ ⵏ ⵓⵥⴻⵟⵟⴰ');
  assert.strictEqual(I.t('info', 'kab', { w: 210, h: 297, u: 'mm', n: 5 }, true), '210 × 297 mm · 5 ⵏ ⵢⵉⵣⵉⵔⵉⴳⴻⵏ');
  assert.strictEqual(I.t('svg', 'kab', null, true), 'SVG');
  assert.strictEqual(I.t('gridType', 'en'), 'Grid type');
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
