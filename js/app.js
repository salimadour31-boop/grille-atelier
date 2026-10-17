/* app.js — Grille Atelier user interface: binds the form to the settings, renders the live SVG preview with
 * draggable vanishing points / horizon / polar centre, zoom, exports (SVG, PNG with DPI, print, JSON), import,
 * URL-hash sharing, languages (FR / EN / Taqbaylit + Tifinagh) and keyboard shortcuts. Original code, MIT. */
(function () {
  'use strict';
  const G = window.Geo, S = window.Settings, E = window.Export, I = window.I18N;
  const $ = (q, el = document) => el.querySelector(q), $$ = (q, el = document) => Array.from(el.querySelectorAll(q));
  const UI_KEY = 'grille-atelier-ui', ST_KEY = 'grille-atelier-settings';
  const CSS_PX_PER_MM = 96 / 25.4;

  /* ------------------------------------------------------------------ state */
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: ignore */ } };
  const ui = Object.assign({ lang: 'fr', tfng: false, theme: 'dark' }, load(UI_KEY) || {});
  if (!I.LANGS.includes(ui.lang)) ui.lang = 'fr';
  let st = S.fromHash(location.hash) || S.sanitize(load(ST_KEY) || S.DEFAULTS);
  let scene = null, zoom = 1, fitScale = 1, frozenBox = null, drag = null, rafId = 0, hashTimer = 0, lastPreset = '';

  const tr = (key, vars) => I.t(key, ui.lang, vars, ui.tfng);
  const unitDigits = { mm: 2, in: 3, px: 1 };
  const fmtLen = (mm) => +G.fromMm(mm, st.unit).toFixed(unitDigits[st.unit]);
  const status = (msg) => { $('#status').textContent = msg; };

  /* ------------------------------------------------------------------ static option lists */
  const TYPE_THUMB = { // overrides used for the small type thumbnails (60 × 60 mm page)
    square: { cell: 12, sub: 3 }, dot: { cell: 6, sub: 1, dotR: 0.9 }, iso: { cell: 12, sub: 1, center: true }, isodot: { cell: 7, dotR: 0.9, center: true },
    dimetric: { cell: 12, sub: 1, center: true }, triangle: { cell: 13, sub: 1, center: true }, hex: { cell: 8, center: true }, ruled: { cell: 12, sub: 4, rMargin: 12 },
    persp1: { pLines: 14, hz: 0.45, v1x: 0.5 }, persp2: { v1x: -0.1, v2x: 1.1, hz: 0.45, pLines: 9, pVert: 4 }, persp3: { v1x: -0.1, v2x: 1.1, hz: 0.18, v3x: 0.5, v3y: 1.5, pLines: 8 },
    polar: { ringGap: 7, sub: 1, spokes: 12, spokeSub: 1 }, comic: { rows: '2,1,2', gutH: 3, gutV: 3 }, storyboard: { sbCols: 2, sbRows: 3, sbLines: 1, sbLineGap: 2.5, sbGutter: 4 },
    calligraphy: { ...S.CALLI.italic, nib: 1.3, slantGap: 5, ladder: false }, blank: { oThirds: true, oSpiral: true },
  };
  function thumbSVG(type) {
    const s = { ...S.DEFAULTS, ...TYPE_THUMB[type], type, format: 'custom', cusW: 60, cusH: 60, mt: 4, mr: 4, mb: 4, ml: 4, frame: type === 'blank', pMarks: true,
      transparent: true, majC: 'currentColor', minC: 'currentColor', accC: 'currentColor', majO: 0.95, minO: 0.5, accO: 1, majW: 1.1, minW: 0.7, accW: 1.3, dash: 2.5 };
    if (type === 'comic' || type === 'storyboard') s.majW = 1.6;
    return E.toSVG(G.buildScene(s), s, { idPrefix: 'th-' + type, title: '' }).replace(/ width="60mm" height="60mm"/, ' aria-hidden="true" focusable="false"');
  }
  function buildTypeTiles() {
    $('#typeGrid').innerHTML = S.TYPES.map((t) => `<button type="button" role="radio" class="type" data-type="${t}">${thumbSVG(t)}<span data-i18n="t_${t}"></span></button>`).join('');
  }
  function fillSelect(sel, entries, current) {
    sel.innerHTML = entries.map(([v, k]) => `<option value="${v}">${tr(k)}</option>`).join('');
    if (current !== undefined) sel.value = current;
  }
  function buildSelects() {
    fillSelect($('#preset'), [['', 'presetNone'], ...Object.keys(S.PRESETS).map((k) => [k, 'p_' + k])], lastPreset);
    fillSelect($('#comicLayout'), [...Object.keys(S.COMIC).map((k) => [k, 'cl_' + k]), ['custom', 'cl_custom']], comicKey());
    fillSelect($('#cPreset'), [...Object.keys(S.CALLI).map((k) => [k, 'cp_' + k]), ['custom', 'cp_custom']], st.cPreset);
    fillSelect($('#themeSel'), [...Object.keys(S.THEMES).map((k) => [k, 'th_' + k]), ['custom', 'th_custom']], st.theme);
  }
  const comicKey = () => Object.keys(S.COMIC).find((k) => S.COMIC[k][0] === st.rows && S.COMIC[k][1] === st.heights) || 'custom';

  /* ------------------------------------------------------------------ i18n */
  function applyI18n() {
    document.documentElement.lang = ui.lang;
    document.body.classList.toggle('tfng', ui.lang === 'kab' && ui.tfng);
    $$('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach((el) => { el.innerHTML = tr(el.dataset.i18nHtml); });
    $$('[data-i18n-attr]').forEach((el) => el.dataset.i18nAttr.split(';').forEach((p) => { const [a, k] = p.split(':'); el.setAttribute(a, tr(k)); }));
    $('#lang').value = ui.lang; $('#tfngWrap').hidden = ui.lang !== 'kab'; $('#tfng').checked = ui.tfng;
    buildSelects();
  }

  /* ------------------------------------------------------------------ form ⇄ settings */
  const CELL_LABEL = { square: 'cell_square', dot: 'cell_dot', iso: 'cell_tri', isodot: 'cell_tri', dimetric: 'cell_tri', triangle: 'cell_tri', hex: 'cell_hex', ruled: 'cell_ruled' };
  const SUB_LABEL = { dot: 'sub_dots', isodot: 'sub_dots', ruled: 'sub_ruled' };
  /** Write the current setting into one form control. */
  function setField(el) {
    const k = el.dataset.k, v = st[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.hasAttribute('data-len')) el.value = fmtLen(v);
    else if (el.hasAttribute('data-pct')) el.value = +(v * 100).toFixed(2);
    else el.value = String(v);
    if (el.type === 'range') el.title = Math.round(v * 100) + ' %';
  }
  /** Write all settings into the form. `typing` = the field the user is typing in (left untouched). */
  function syncForm(typing) {
    $$('[data-k]').forEach((el) => { if (el !== typing) setField(el); });
    const pg = G.pageSize(st);
    if (typing !== $('#pageW')) $('#pageW').value = fmtLen(pg.w);
    if (typing !== $('#pageH')) $('#pageH').value = fmtLen(pg.h);
    $$('.u').forEach((u) => { u.textContent = `(${st.unit})`; });
    $$('[data-types]').forEach((el) => { el.hidden = !el.dataset.types.split(' ').includes(st.type); });
    $$('#typeGrid .type').forEach((b) => { const on = b.dataset.type === st.type; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
    $$('#orientSeg button').forEach((b) => b.setAttribute('aria-checked', b.dataset.orient === st.orient));
    $('#cellLabel').textContent = tr(CELL_LABEL[st.type] || 'cell_square');
    $('#subLabel').textContent = tr(SUB_LABEL[st.type] || 'sub_lines');
    $('#spiralOpts').hidden = !st.oSpiral;
    if (typing !== $('[data-k="rows"]')) $('#rowsErr').hidden = true;
    $('#comicLayout').value = comicKey(); $('#cPreset').value = st.cPreset; $('#themeSel').value = st.theme;
  }

  const CALLI_KEYS = ['nib', 'xh', 'ah', 'ch', 'dh', 'lg', 'slant', 'slantGap', 'mid', 'shade', 'ladder', 'rtl', 'modules'];
  const COLOR_KEYS = ['bg', 'majC', 'minC', 'accC', 'majO', 'minO'];
  /** Read one form control into the settings. Returns false when the value is not usable yet (e.g. empty). */
  function readControl(el) {
    const k = el.dataset.k;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number' || el.type === 'range') {
      if (el.value === '' || !isFinite(+el.value)) return false;
      v = +el.value;
      if (el.hasAttribute('data-len')) v = G.toMm(v, st.unit);
      if (el.hasAttribute('data-pct')) v /= 100;
    } else v = el.value;
    if (k === 'rows') { $('#rowsErr').hidden = !!G.parseRows(v); if (!G.parseRows(v)) return false; } // keep the last valid layout
    if (typeof S.DEFAULTS[k] === 'number') v = +v;
    const before = st[k];
    st[k] = v;
    if (k === 'theme' && S.THEMES[v]) Object.assign(st, S.THEMES[v]);
    else if (COLOR_KEYS.includes(k)) st.theme = 'custom';
    if (k === 'cPreset' && S.CALLI[v]) Object.assign(st, S.CALLI[v]);
    else if (CALLI_KEYS.includes(k)) st.cPreset = 'custom';
    if (k === 'format' && v === 'r169' && before !== 'r169') Object.assign(st, { orient: 'landscape', unit: 'px', dpi: 96, mt: 0, mr: 0, mb: 0, ml: 0 });
    if (k === 'format' && v === 'custom' && before !== 'custom') { const pg = G.pageSize({ ...st, format: before }); st.cusW = pg.w; st.cusH = pg.h; }
    st = S.sanitize(st);
    return true;
  }

  /* ------------------------------------------------------------------ rendering */
  function schedule() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }
  function render() {
    scene = G.buildScene(st);
    const box = frozenBox || G.previewBox(scene);
    const stage = $('#stage'), focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.h : null;
    stage.innerHTML = E.toSVG(scene, st, { preview: box, idPrefix: 'pv' });
    const svg = $('svg', stage);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tr('t_' + st.type));
    decoratePreview(svg);
    sizePreview(box);
    if (focusId) { const h = $(`[data-h="${focusId}"]`, stage); if (h) h.focus({ preventScroll: true }); }
    // page info, warnings, PNG size, print size
    const pg = scene.page;
    $('#info').textContent = tr('info', { w: fmtLen(pg.w), h: fmtLen(pg.h), u: st.unit, n: scene.prims.length });
    const warn = scene.warning ? tr(scene.warning === 'noArea' ? 'w_noArea' : 'w_tooDense') : '';
    $('#warn').hidden = !warn; $('#warn').textContent = warn;
    $('#pngSize').textContent = tr('pngSize', { w: G.mmToDots(scene.doc.w, st.dpi), h: G.mmToDots(scene.doc.h, st.dpi) });
    $('#pageRule').textContent = `@page { size: ${G.round(scene.doc.w)}mm ${G.round(scene.doc.h)}mm; margin: 0; }`;
    save(ST_KEY, st);
    clearTimeout(hashTimer);
    hashTimer = setTimeout(updateHash, drag ? 400 : 120);
  }
  function updateHash() {
    const h = S.toHash(st);
    if (h !== location.hash && !(h === '' && location.hash === '')) history.replaceState(null, '', location.pathname + location.search + h);
  }

  /** Add preview-only elements: trim / bleed outlines, transparency checkerboard, draggable handles. */
  function decoratePreview(svg) {
    const NS = 'http://www.w3.org/2000/svg', mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    const { trim, bleed } = scene, bg = $('#background', svg);
    if (st.transparent && bg) {
      const defs = $('defs', svg), pat = mk('pattern', { id: 'pv-checker', width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
      pat.append(mk('rect', { width: 8, height: 8, fill: '#ffffff' }), mk('rect', { width: 4, height: 4, fill: '#d9d9e0' }), mk('rect', { x: 4, y: 4, width: 4, height: 4, fill: '#d9d9e0' }));
      defs.append(pat); bg.setAttribute('fill', 'url(#pv-checker)');
    }
    if (st.cropMarks) { // white paper under the slug so the crop marks are visible on the dark pasteboard
      const paper = mk('rect', { class: 'pv-paper', x: scene.doc.x, y: scene.doc.y, width: scene.doc.w, height: scene.doc.h, fill: '#ffffff' });
      svg.insertBefore(paper, bg || $('g', svg));
    }
    const after = bg ? bg.nextSibling : null;
    if (bleed > 0) svg.insertBefore(mk('rect', { class: 'pv-trim', x: 0, y: 0, width: trim.w, height: trim.h, 'vector-effect': 'non-scaling-stroke' }), after);
    svg.append(mk('rect', { class: 'pv-edge', x: -bleed, y: -bleed, width: trim.w + 2 * bleed, height: trim.h + 2 * bleed, 'vector-effect': 'non-scaling-stroke' }));
    const g = mk('g', { class: 'handles' });
    for (const h of scene.handles) {
      const label = tr({ v1: 'h_vp1', v2: 'h_vp2', v3: 'h_vp3', hz: 'h_hz', pc: 'h_pc' }[h.id]);
      const el = mk('g', { class: 'handle' + (h.line ? ' hline' : ''), 'data-h': h.id, tabindex: 0, role: 'button', 'aria-label': label });
      const t = mk('title', {}); t.textContent = label; el.append(t);
      if (h.line) {
        const vb = svg.viewBox.baseVal;
        el.append(mk('line', { class: 'hit', x1: vb.x, x2: vb.x + vb.width, y1: h.y, y2: h.y }), mk('line', { class: 'vis', x1: vb.x, x2: vb.x + vb.width, y1: h.y, y2: h.y, 'vector-effect': 'non-scaling-stroke' }));
      } else el.append(mk('circle', { class: 'ring', cx: h.x, cy: h.y, r: 1 }), mk('circle', { class: 'dot', cx: h.x, cy: h.y, r: 1 }));
      g.append(el);
    }
    svg.append(g);
  }
  /** Size the preview SVG in CSS pixels for the current zoom and scale the handles to constant screen size. */
  function sizePreview(box) {
    const stage = $('#stage'), svg = $('svg', stage);
    if (!svg) return;
    const cw = Math.max(120, stage.clientWidth - 24), ch = Math.max(120, stage.clientHeight - 24);
    fitScale = Math.min(cw / box.w, ch / box.h);
    const k = fitScale * zoom;
    svg.style.width = box.w * k + 'px'; svg.style.height = box.h * k + 'px';
    $$('.handle .ring', svg).forEach((c) => c.setAttribute('r', 9 / k));
    $$('.handle .dot', svg).forEach((c) => c.setAttribute('r', 3.5 / k));
    $$('.handle .hit', svg).forEach((l) => l.setAttribute('stroke-width', 14 / k));
    $('#zoomVal').textContent = Math.round((k / CSS_PX_PER_MM) * 100) + ' %';
  }
  function setZoom(z, keepCenter = true) {
    const stage = $('#stage'), cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth), cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight);
    zoom = Math.min(16, Math.max(0.25, z));
    sizePreview(frozenBox || G.previewBox(scene));
    if (keepCenter) { stage.scrollLeft = cx * stage.scrollWidth - stage.clientWidth / 2; stage.scrollTop = cy * stage.scrollHeight - stage.clientHeight / 2; }
  }

  /* ------------------------------------------------------------------ handles: drag + keyboard */
  function moveHandle(id, x, y) {
    const pg = G.pageSize(st), r4 = (v) => Math.round(v * 1e5) / 1e5;
    if (id === 'hz') st.hz = r4(y / pg.h);
    else if (id === 'v1' || id === 'v2') { st[id + 'x'] = r4(x / pg.w); st.hz = r4(y / pg.h); }
    else if (id === 'v3') { st.v3x = r4(x / pg.w); st.v3y = r4(y / pg.h); }
    else if (id === 'pc') { st.pcx = r4(x / pg.w); st.pcy = r4(y / pg.h); }
    st = S.sanitize(st);
    syncForm(); schedule();
  }
  /** Current position (mm) of a handle, computed from the settings (the scene may be one frame behind). */
  function handlePos(id) {
    const pg = G.pageSize(st), H = st.hz * pg.h;
    return { hz: { x: 0, y: H }, v1: { x: st.v1x * pg.w, y: H }, v2: { x: st.v2x * pg.w, y: H }, v3: { x: st.v3x * pg.w, y: st.v3y * pg.h }, pc: { x: st.pcx * pg.w, y: st.pcy * pg.h } }[id];
  }
  function svgPoint(e) {
    const svg = $('#stage svg'), m = svg.getScreenCTM();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function bindHandles() {
    const stage = $('#stage');
    stage.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('[data-h]');
      if (!h) return;
      e.preventDefault();
      const p = svgPoint(e), hp = handlePos(h.dataset.h);
      drag = { id: h.dataset.h, dx: hp.x - p.x, dy: hp.y - p.y };
      frozenBox = G.previewBox(scene);
      stage.classList.add('dragging');
    });
    window.addEventListener('pointermove', (e) => { if (!drag) return; const p = svgPoint(e); moveHandle(drag.id, p.x + drag.dx, p.y + drag.dy); });
    const end = () => { if (!drag) return; drag = null; frozenBox = null; stage.classList.remove('dragging'); render(); };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    stage.addEventListener('keydown', (e) => {
      const h = e.target.closest && e.target.closest('[data-h]');
      if (!h) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1, p = handlePos(h.dataset.h);
      moveHandle(h.dataset.h, p.x + d[0] * step, p.y + d[1] * step);
    });
    stage.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  }

  /* ------------------------------------------------------------------ exports */
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status(tr('m_saved', { f: name }));
  }
  const baseName = () => `grille-${st.type}-${st.format === 'custom' ? `${Math.round(scene.page.w)}x${Math.round(scene.page.h)}mm` : st.format}${st.format !== 'square' && st.format !== 'custom' ? '-' + st.orient : ''}`;
  function exportSVG() {
    const svg = E.toSVG(scene, st, { metadata: JSON.stringify(st), title: 'Grille Atelier — ' + I.t('t_' + st.type, ui.lang) });
    download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg + '\n'], { type: 'image/svg+xml' }), baseName() + '.svg');
  }
  function exportPNG() {
    const w = G.mmToDots(scene.doc.w, st.dpi), h = G.mmToDots(scene.doc.h, st.dpi);
    if (w * h > 180e6 || Math.max(w, h) > 32000) { status(tr('m_tooBig', { w, h })); return Promise.resolve(false); }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { status(tr('m_pngErr')); return Promise.resolve(false); }
    E.drawScene(ctx, scene, st, w / scene.doc.w);
    return new Promise((res) => canvas.toBlob(async (blob) => {
      if (!blob) { status(tr('m_pngErr')); return res(false); }
      try {
        const bytes = E.pngWithDpi(new Uint8Array(await blob.arrayBuffer()), st.dpi);
        download(new Blob([bytes], { type: 'image/png' }), `${baseName()}-${st.dpi}dpi.png`);
        res(true);
      } catch (e) { status(tr('m_pngErr')); res(false); }
      canvas.width = canvas.height = 0; // free memory
    }, 'image/png'));
  }
  function preparePrint() {
    const area = $('#printArea');
    area.innerHTML = E.toSVG(scene, st, { idPrefix: 'pr' });
    area.style.width = G.round(scene.doc.w) + 'mm'; area.style.height = G.round(scene.doc.h) + 'mm';
  }
  function exportJSON() {
    download(new Blob([JSON.stringify({ app: 'grille-atelier', version: 1, settings: st }, null, 2) + '\n'], { type: 'application/json' }), baseName() + '.json');
  }
  async function importFile(file) {
    try {
      const text = await file.text();
      let obj = /^\s*</.test(text) ? E.settingsFromSVG(text) : JSON.parse(text);
      if (obj && obj.settings) obj = obj.settings;
      if (!obj || typeof obj !== 'object' || !S.TYPES.includes(obj.type)) throw new Error('bad file');
      st = S.sanitize(obj); lastPreset = '';
      refresh(); status(tr('m_imported'));
    } catch (e) { status(tr('m_importErr')); }
  }
  async function copyLink() {
    updateHash();
    try { await navigator.clipboard.writeText(location.href); status(tr('m_copied')); } catch (e) { status(tr('m_linkReady')); }
  }

  // Sensible vanishing-point positions when switching between perspective types (1 point: centred; 2 and 3
  // points: outside the page, where they give natural-looking guides).
  const TYPE_START = {
    persp1: { v1x: 0.5, hz: 0.42 }, persp2: { v1x: -0.35, v2x: 1.35, hz: 0.4 }, persp3: { v1x: -0.4, v2x: 1.4, hz: 0.25, v3x: 0.5, v3y: 1.9 },
  };
  function setType(t) {
    if (t !== st.type && TYPE_START[t]) Object.assign(st, TYPE_START[t]);
    st.type = t; lastPreset = ''; $('#preset').value = '';
    st = S.sanitize(st); syncForm(); render();
  }

  /* ------------------------------------------------------------------ events */
  function refresh() { applyI18n(); syncForm(); render(); }
  function bind() {
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-k]');
      if (!el || el.tagName === 'SELECT') return;
      if (readControl(el)) { lastPreset = ''; syncForm(el.type === 'range' ? null : el); schedule(); }
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-k]');
      if (!el) return;
      readControl(el); lastPreset = ''; $('#preset').value = '';
      syncForm(); // also shows the clamped value in the field that was just edited
      if (el.dataset.k === 'unit' || el.dataset.k === 'format') render(); else schedule();
    });
    $('#typeGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (b) setType(b.dataset.type); });
    $('#typeGrid').addEventListener('keydown', (e) => { // radio-group arrow navigation
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const i = (S.TYPES.indexOf(st.type) + d + S.TYPES.length) % S.TYPES.length;
      setType(S.TYPES[i]); $(`#typeGrid [data-type="${st.type}"]`).focus();
    });
    $('#preset').addEventListener('change', (e) => {
      const p = S.PRESETS[e.target.value];
      if (!p) return;
      lastPreset = e.target.value;
      const keep = { format: st.format, orient: st.orient, unit: st.unit, cusW: st.cusW, cusH: st.cusH, dpi: st.dpi };
      st = S.sanitize({ ...S.DEFAULTS, ...keep, ...p });
      syncForm(); render();
    });
    $('#comicLayout').addEventListener('change', (e) => { const c = S.COMIC[e.target.value]; if (c) { st.rows = c[0]; st.heights = c[1]; syncForm(); render(); } });
    $$('#orientSeg button').forEach((b) => b.addEventListener('click', () => {
      if (st.format === 'custom') { if ((b.dataset.orient === 'landscape') !== (st.cusW > st.cusH)) [st.cusW, st.cusH] = [st.cusH, st.cusW]; }
      st.orient = b.dataset.orient; syncForm(); render();
    }));
    const pageInput = (e) => {
      const v = +e.target.value;
      if (!(v > 0)) return;
      const pg = G.pageSize(st);
      st = S.sanitize({ ...st, format: 'custom', cusW: e.target.id === 'pageW' ? G.toMm(v, st.unit) : pg.w, cusH: e.target.id === 'pageH' ? G.toMm(v, st.unit) : pg.h, orient: 'portrait' });
      st.orient = st.cusW > st.cusH ? 'landscape' : 'portrait';
      syncForm(e.target); schedule();
    };
    $('#pageW').addEventListener('input', pageInput); $('#pageH').addEventListener('input', pageInput);
    $('#lang').addEventListener('change', (e) => { ui.lang = e.target.value; save(UI_KEY, ui); refresh(); });
    $('#tfng').addEventListener('change', (e) => { ui.tfng = e.target.checked; save(UI_KEY, ui); refresh(); });
    $('#themeBtn').addEventListener('click', () => { ui.theme = ui.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = ui.theme; save(UI_KEY, ui); });
    $('#helpBtn').addEventListener('click', () => $('#helpDlg').showModal());
    $('#zoomIn').addEventListener('click', () => setZoom(zoom * 1.25));
    $('#zoomOut').addEventListener('click', () => setZoom(zoom / 1.25));
    $('#zoomFit').addEventListener('click', () => setZoom(1, false));
    $('#svgBtn').addEventListener('click', exportSVG);
    $('#pngBtn').addEventListener('click', exportPNG);
    $('#printBtn').addEventListener('click', () => { preparePrint(); window.print(); });
    window.addEventListener('beforeprint', preparePrint);
    $('#jsonBtn').addEventListener('click', exportJSON);
    $('#fileIn').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('#linkBtn').addEventListener('click', copyLink);
    $('#resetBtn').addEventListener('click', () => { if (!confirm(tr('resetConfirm'))) return; st = S.sanitize(S.DEFAULTS); lastPreset = ''; zoom = 1; refresh(); status(tr('m_reset')); });
    window.addEventListener('hashchange', () => { const s = S.fromHash(location.hash); if (s) { st = s; refresh(); } });
    window.addEventListener('resize', () => sizePreview(frozenBox || G.previewBox(scene)));
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); exportSVG(); return; }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || $('#helpDlg').open) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.25); }
      else if (e.key === '0') { e.preventDefault(); setZoom(1, false); }
    });
    bindHandles();
  }

  /* ------------------------------------------------------------------ start */
  document.documentElement.dataset.theme = ui.theme;
  buildTypeTiles();
  bind();
  refresh();
  // read-only hooks for the automated UI test
  window.GrilleApp = { get state() { return { ...st }; }, get scene() { return scene; }, render, exportPNG };
})();
