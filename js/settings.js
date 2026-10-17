/* settings.js — Grille Atelier: default settings, validation, URL-hash sharing, presets, colour themes,
 * comic layouts and calligraphy presets. Pure data + functions (browser: window.Settings; Node: require).
 * Settings are a flat object of numbers, booleans and short strings; lengths are stored in millimetres and
 * perspective / polar positions as fractions of the page so they survive a change of format.
 * Original code, MIT licence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Settings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TYPES = ['square', 'dot', 'iso', 'isodot', 'dimetric', 'triangle', 'hex', 'ruled', 'persp1', 'persp2', 'persp3', 'polar', 'comic', 'storyboard', 'calligraphy', 'blank'];

  const DEFAULTS = {
    v: 1, type: 'square',
    // page
    format: 'A4', orient: 'portrait', unit: 'mm', cusW: 210, cusH: 297, mt: 10, mr: 10, mb: 10, ml: 10, bleed: 0, gridBleed: false, cropMarks: false, frame: true,
    // regular grids
    cell: 10, sub: 5, center: false, dotR: 0.35, isoVert: true, dimAngle: 26.565, hexOrient: 'pointy', hexInner: false, rVert: false, rMargin: 0,
    // perspective (fractions of page width / height)
    hz: 0.42, v1x: 0.5, v2x: -0.35, v3x: 0.5, v3y: 1.9, pLines: 24, pSpread: 'area', pVert: 0, pHoriz: 0, pDepth: false, pTile: 20, pDist: 1, pMarks: true,
    // polar
    pcx: 0.5, pcy: 0.5, ringGap: 10, spokes: 12, spokeSub: 2, polarPoly: false,
    // comics & storyboard
    rows: '2,2,2', heights: '', gutH: 4, gutV: 5, panelR: 0, sbCols: 2, sbRows: 3, sbAspect: '16:9', sbLines: 3, sbLineGap: 6, sbGutter: 8,
    // calligraphy (heights in nib widths)
    cPreset: 'italic', nib: 2.5, xh: 5, ah: 9, ch: 7, dh: 4, lg: 2, slant: 83, slantGap: 8, mid: false, shade: true, ladder: true, rtl: false, modules: false,
    // overlays
    oThirds: false, oPhi: false, oSpiral: false, oSpiralRot: 0, oSpiralFlip: false, oDiag: false, oCenter: false, oCols: 0, oRows: 0, oGut: 5,
    // style
    theme: 'blue', bg: '#ffffff', transparent: false, majC: '#3d7fc1', majO: 0.75, majW: 0.25, minC: '#3d7fc1', minO: 0.4, minW: 0.1,
    accC: '#e0533d', accO: 0.9, accW: 0.35, dash: 1.5,
    // export
    dpi: 300,
  };

  // [min, max] for numbers; arrays of allowed values for enumerations
  const SPEC = {
    v: [1, 1], type: TYPES, format: ['A3', 'A4', 'A5', 'A6', 'B5', 'letter', 'legal', 'tabloid', 'comicUS', 'square', 'r169', 'custom'], orient: ['portrait', 'landscape'],
    unit: ['mm', 'in', 'px'], cusW: [10, 2000], cusH: [10, 2000], mt: [0, 500], mr: [0, 500], mb: [0, 500], ml: [0, 500], bleed: [0, 20],
    cell: [0.5, 500], sub: [1, 20], dotR: [0.05, 5], dimAngle: [5, 60], hexOrient: ['pointy', 'flat'], rMargin: [0, 500],
    hz: [-3, 4], v1x: [-4, 5], v2x: [-4, 5], v3x: [-4, 5], v3y: [-4, 5], pLines: [2, 180], pSpread: ['area', 'full'], pVert: [0, 200], pHoriz: [0, 200],
    pTile: [1, 200], pDist: [0.2, 5], pcx: [-1, 2], pcy: [-1, 2], ringGap: [0.5, 500], spokes: [1, 360], spokeSub: [1, 12],
    gutH: [0, 50], gutV: [0, 50], panelR: [0, 30], sbCols: [1, 8], sbRows: [1, 10], sbAspect: ['16:9', '2.39:1', '1.85:1', '4:3', '1:1', '9:16', '3:2'],
    sbLines: [0, 12], sbLineGap: [2, 20], sbGutter: [0, 50],
    cPreset: ['foundational', 'italic', 'gothic', 'copperplate', 'school', 'naskh', 'thuluth', 'ruqaa', 'tifinagh', 'custom'],
    nib: [0.2, 20], xh: [0, 20], ah: [0, 30], ch: [0, 30], dh: [0, 20], lg: [0, 30], slant: [30, 90], slantGap: [1, 100],
    oSpiralRot: [0, 3], oCols: [0, 24], oRows: [0, 24], oGut: [0, 100],
    theme: ['blue', 'nonphoto', 'graphite', 'sepia', 'green', 'sanguine', 'night', 'blueprint', 'custom'],
    majO: [0, 1], majW: [0.01, 5], minO: [0, 1], minW: [0.01, 5], accO: [0, 1], accW: [0.01, 5], dash: [0.2, 20], dpi: [72, 1200],
  };
  const COLOR = /^#[0-9a-f]{6}$/i;

  /** Return a complete, valid settings object from any (possibly hostile) input: unknown keys are dropped,
   *  values are coerced to the default's type and clamped / checked against SPEC. */
  function sanitize(input) {
    const src = input && typeof input === 'object' ? input : {}, out = {};
    for (const [k, def] of Object.entries(DEFAULTS)) {
      let v = src[k], spec = SPEC[k];
      if (v === undefined || v === null || v === '') { out[k] = def; continue; }
      if (typeof def === 'number') {
        v = Number(v);
        if (!isFinite(v)) v = def;
        if (spec) v = Math.min(spec[1], Math.max(spec[0], v));
      } else if (typeof def === 'boolean') v = v === true || v === 'true' || v === '1' || v === 1;
      else {
        v = String(v).slice(0, 80);
        if (Array.isArray(spec) && typeof spec[0] === 'string' && !spec.includes(v)) v = def;
        if (k.endsWith('C') || k === 'bg') v = COLOR.test(v) ? v.toLowerCase() : def;
        if ((k === 'rows' || k === 'heights') && !/^[\d\s.,:;]*$/.test(v)) v = def;
      }
      out[k] = v;
    }
    return out;
  }

  /** Encode only the settings that differ from the defaults into a URL hash (#k=v&…). */
  function toHash(s) {
    const p = new URLSearchParams();
    for (const [k, def] of Object.entries(DEFAULTS)) if (s[k] !== undefined && s[k] !== def) p.set(k, typeof s[k] === 'boolean' ? (s[k] ? '1' : '0') : String(s[k]));
    const q = p.toString();
    return q ? '#' + q : '';
  }
  /** Decode a URL hash back to a complete settings object (null when the hash holds no known setting). */
  function fromHash(hash) {
    const p = new URLSearchParams(String(hash || '').replace(/^#/, '')), o = {};
    let n = 0;
    for (const [k, v] of p) if (k in DEFAULTS) { o[k] = typeof DEFAULTS[k] === 'boolean' ? v === '1' || v === 'true' : v; n++; }
    return n ? sanitize(o) : null;
  }

  /* ------------------------------------------------------------------ colour themes */
  const THEMES = {
    blue: { bg: '#ffffff', majC: '#3d7fc1', minC: '#3d7fc1', accC: '#e0533d', majO: 0.75, minO: 0.4 },
    nonphoto: { bg: '#ffffff', majC: '#6fc3e0', minC: '#8fd3ea', accC: '#55b4d6', majO: 0.9, minO: 0.6 },
    graphite: { bg: '#ffffff', majC: '#5b5b66', minC: '#8c8c96', accC: '#222228', majO: 0.7, minO: 0.45 },
    sepia: { bg: '#f6efe0', majC: '#9a7448', minC: '#b89a74', accC: '#a8432a', majO: 0.7, minO: 0.45 },
    green: { bg: '#fbfdf8', majC: '#3f8f62', minC: '#6db18a', accC: '#c2572c', majO: 0.7, minO: 0.4 },
    sanguine: { bg: '#fffaf5', majC: '#c0583c', minC: '#d98d73', accC: '#4d6aa8', majO: 0.7, minO: 0.4 },
    night: { bg: '#15151f', majC: '#8fb4ff', minC: '#6e7ab8', accC: '#ffb454', majO: 0.7, minO: 0.4 },
    blueprint: { bg: '#123a6b', majC: '#d6e8ff', minC: '#9ec3f0', accC: '#ffd166', majO: 0.75, minO: 0.35 },
  };

  /* ------------------------------------------------------------------ comic layouts (rows syntax, heights) */
  const COMIC = {
    six: ['2,2,2', ''], nine: ['3,3,3', ''], four: ['2,2', ''], tiers3: ['1,1,1', ''], splash: ['1', ''], tiers4: ['1,1,1,1', ''],
    manga: ['1:2, 2:1:1, 1', '1.3,1,1.5'], hero: ['1, 3, 2', '2,1,1'], strip: ['3', ''], strip4: ['4', ''],
  };

  /* ------------------------------------------------------------------ calligraphy presets (nib-width units)
   * Proportions are common teaching values; calligraphers and schools vary — adjust freely. */
  const CALLI = {
    foundational: { nib: 3, xh: 4, ah: 7, ch: 6, dh: 3, lg: 2, slant: 90, mid: false, shade: true, ladder: true, rtl: false, modules: false },
    italic: { nib: 2.5, xh: 5, ah: 9, ch: 7, dh: 4, lg: 2, slant: 83, slantGap: 8, mid: false, shade: true, ladder: true, rtl: false, modules: false },
    gothic: { nib: 3, xh: 5, ah: 7, ch: 6.5, dh: 2, lg: 2, slant: 90, mid: false, shade: true, ladder: true, rtl: false, modules: false },
    copperplate: { nib: 2.5, xh: 2, ah: 5, ch: 4, dh: 3, lg: 1, slant: 55, slantGap: 5, mid: false, shade: true, ladder: false, rtl: false, modules: false },
    school: { nib: 1.5, xh: 2, ah: 4, ch: 4, dh: 2, lg: 1.5, slant: 90, mid: true, shade: false, ladder: false, rtl: false, modules: false },
    naskh: { nib: 3, xh: 2.5, ah: 5, ch: 0, dh: 4, lg: 2, slant: 90, mid: false, shade: true, ladder: true, rtl: true, modules: false },
    thuluth: { nib: 4, xh: 4, ah: 8, ch: 0, dh: 5, lg: 2, slant: 90, mid: false, shade: true, ladder: true, rtl: true, modules: false },
    ruqaa: { nib: 2.5, xh: 1.5, ah: 3, ch: 0, dh: 3, lg: 2, slant: 90, mid: false, shade: true, ladder: true, rtl: true, modules: false },
    tifinagh: { nib: 1.5, xh: 6, ah: 0, ch: 0, dh: 0, lg: 4, slant: 90, mid: true, shade: true, ladder: false, rtl: false, modules: true },
  };

  /* ------------------------------------------------------------------ complete presets (partial settings) */
  const PRESETS = {
    graph: { type: 'square', cell: 10, sub: 10, center: false, majW: 0.2, minW: 0.08, theme: 'blue', ...THEMES.blue },
    square5: { type: 'square', cell: 5, sub: 1, majW: 0.12 },
    quarterInch: { type: 'square', cell: 25.4, sub: 4, majW: 0.2, minW: 0.1 },
    seyes: { type: 'ruled', cell: 8, sub: 4, rVert: true, rMargin: 25, ml: 0, mr: 0, mt: 20, mb: 10, frame: false, theme: 'custom', bg: '#ffffff', majC: '#7a6fc0', minC: '#8fb4e0', accC: '#e0533d', majO: 0.7, minO: 0.6, majW: 0.15, minW: 0.1 },
    college: { type: 'ruled', cell: 7.1, sub: 1, rVert: false, rMargin: 32, ml: 0, mr: 0, mt: 25, mb: 10, frame: false, majW: 0.15 },
    dots5: { type: 'dot', cell: 5, sub: 1, dotR: 0.35, theme: 'graphite', ...THEMES.graphite },
    iso5: { type: 'iso', cell: 5, sub: 1, isoVert: true, center: true, majW: 0.12 },
    isodots: { type: 'isodot', cell: 5, sub: 1, dotR: 0.35, center: true },
    pixel21: { type: 'dimetric', dimAngle: 26.565, cell: 8, sub: 1, isoVert: true, center: true },
    hex: { type: 'hex', cell: 6, hexOrient: 'pointy', hexInner: false, center: true, majW: 0.15 },
    comic6: { type: 'comic', rows: '2,2,2', heights: '', gutH: 4, gutV: 5, majW: 0.6, frame: false, theme: 'nonphoto', ...THEMES.nonphoto, majC: '#222228', majO: 1 },
    manga: { type: 'comic', format: 'B5', rows: '1:2, 2:1:1, 1', heights: '1.3,1,1.5', gutH: 3, gutV: 6, majW: 0.6, frame: false, bleed: 3, cropMarks: true },
    story169: { type: 'storyboard', orient: 'landscape', sbCols: 3, sbRows: 2, sbAspect: '16:9', sbLines: 6, sbGutter: 10, majW: 0.35, frame: false, theme: 'graphite', ...THEMES.graphite },
    persp1: { type: 'persp1', hz: 0.42, v1x: 0.5, pLines: 28, pDepth: true, pTile: 20, pVert: 0, pHoriz: 0, pMarks: true },
    persp2: { type: 'persp2', hz: 0.4, v1x: -0.35, v2x: 1.35, pLines: 22, pVert: 9, pDepth: false, pMarks: true },
    persp3: { type: 'persp3', hz: 0.25, v1x: -0.4, v2x: 1.4, v3x: 0.5, v3y: 1.9, pLines: 20, pMarks: true },
    mandala: { type: 'polar', pcx: 0.5, pcy: 0.5, ringGap: 10, sub: 2, spokes: 12, spokeSub: 2, polarPoly: false, frame: false, theme: 'sanguine', ...THEMES.sanguine },
    italic: { type: 'calligraphy', cPreset: 'italic', ...CALLI.italic },
    naskh: { type: 'calligraphy', cPreset: 'naskh', ...CALLI.naskh },
    tifinagh: { type: 'calligraphy', cPreset: 'tifinagh', ...CALLI.tifinagh },
    thirds: { type: 'blank', oThirds: true, oPhi: false, oDiag: true, oSpiral: false, frame: true, orient: 'landscape' },
    golden: { type: 'blank', oThirds: false, oPhi: true, oSpiral: true, frame: true, orient: 'landscape' },
  };

  return { TYPES, DEFAULTS, SPEC, sanitize, toHash, fromHash, THEMES, COMIC, CALLI, PRESETS };
});
