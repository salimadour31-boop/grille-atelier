/* export.js — Grille Atelier: turn a scene into a true-vector SVG (millimetre units, one layer per line
 * weight), draw it on a canvas at any resolution (PNG export), and stamp the DPI into PNG files (pHYs chunk).
 * No DOM access except the canvas context it is given (browser: window.Export; Node: require).
 * Original code, MIT licence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Export = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const f = (n) => String(Math.round(n * 1000) / 1000 || 0); // compact number, 3 decimals (µm precision)
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Layer styles (drawing order) derived from the settings. */
  function layerStyles(s) {
    return [
      { id: 'shade', color: s.minC, opacity: Math.min(1, s.minO * 0.35), width: 0 },
      { id: 'minor', color: s.minC, opacity: s.minO, width: s.minW },
      { id: 'major', color: s.majC, opacity: s.majO, width: s.majW },
      { id: 'accent', color: s.accC, opacity: s.accO, width: s.accW },
      { id: 'marks', color: '#000000', opacity: 1, width: 0.25 },
    ];
  }

  /** SVG path data for a list of primitives (lines, polylines, rects, circles, dots) — one compound path. */
  function pathData(prims) {
    let d = '';
    for (const p of prims) {
      if (p.t === 'l') d += `M${f(p.x1)} ${f(p.y1)}L${f(p.x2)} ${f(p.y2)}`;
      else if (p.t === 'p') { d += 'M' + f(p.pts[0]) + ' ' + f(p.pts[1]); for (let i = 2; i < p.pts.length; i += 2) d += 'L' + f(p.pts[i]) + ' ' + f(p.pts[i + 1]); if (p.closed) d += 'Z'; }
      else if (p.t === 'r') {
        const r = p.rx || 0;
        if (r > 0) d += `M${f(p.x + r)} ${f(p.y)}H${f(p.x + p.w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(p.x + p.w)} ${f(p.y + r)}V${f(p.y + p.h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(p.x + p.w - r)} ${f(p.y + p.h)}H${f(p.x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(p.x)} ${f(p.y + p.h - r)}V${f(p.y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(p.x + r)} ${f(p.y)}Z`;
        else d += `M${f(p.x)} ${f(p.y)}h${f(p.w)}v${f(p.h)}h${f(-p.w)}Z`;
      } else if (p.t === 'c' || p.t === 'd') d += `M${f(p.x - p.r)} ${f(p.y)}a${f(p.r)} ${f(p.r)} 0 1 0 ${f(2 * p.r)} 0a${f(p.r)} ${f(p.r)} 0 1 0 ${f(-2 * p.r)} 0Z`;
    }
    return d;
  }

  /** Split a layer's primitives into stroked (solid / dashed) and filled groups. */
  function split(prims) {
    const g = { solid: [], dashed: [], fill: [] };
    for (const p of prims) (p.t === 'd' || p.fill ? g.fill : p.dash ? g.dashed : g.solid).push(p);
    return g;
  }

  /** Complete SVG document. opts: {metadata: settings JSON string, title, preview: {x,y,w,h} viewBox for the
   *  on-screen preview (adds a pasteboard), idPrefix}. Width/height are written in millimetres. */
  function toSVG(scene, s, opts = {}) {
    const { doc, area, trim, bleed } = scene, pre = opts.idPrefix || 'ga', vb = opts.preview || doc;
    const out = [];
    const sizeAttr = opts.preview ? '' : ` width="${f(doc.w)}mm" height="${f(doc.h)}mm"`;
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"${sizeAttr} viewBox="${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}"${opts.preview ? ' preserveAspectRatio="xMidYMid meet"' : ''}>`);
    out.push(`<title>${esc(opts.title || 'Grille Atelier')}</title>`);
    if (opts.metadata) out.push(`<metadata id="grille-atelier-settings"><![CDATA[${opts.metadata.replace(/]]>/g, ']]]]><![CDATA[>')}]]></metadata>`);
    const clip = s.cropMarks || s.gridBleed ? { x: -bleed, y: -bleed, w: trim.w + 2 * bleed, h: trim.h + 2 * bleed } : area;
    // the clip is slightly larger than the area so border lines keep their full width
    const pad = Math.max(s.majW, s.minW, s.accW);
    out.push(`<defs><clipPath id="${pre}-clip"><rect x="${f(clip.x - pad)}" y="${f(clip.y - pad)}" width="${f(Math.max(0, clip.w + 2 * pad))}" height="${f(Math.max(0, clip.h + 2 * pad))}"/></clipPath></defs>`);
    if (opts.preview) out.push(`<rect class="pasteboard" x="${f(vb.x)}" y="${f(vb.y)}" width="${f(vb.w)}" height="${f(vb.h)}" fill="none"/>`);
    if (!s.transparent || opts.preview) {
      const bgBox = { x: -bleed, y: -bleed, w: trim.w + 2 * bleed, h: trim.h + 2 * bleed };
      out.push(`<rect id="background" x="${f(bgBox.x)}" y="${f(bgBox.y)}" width="${f(bgBox.w)}" height="${f(bgBox.h)}" fill="${s.transparent ? 'none' : esc(s.bg)}"${opts.preview && s.transparent ? ' class="transparent"' : ''}/>`);
    }
    const byLayer = {};
    for (const p of scene.prims) (byLayer[p.L] = byLayer[p.L] || []).push(p);
    for (const st of layerStyles(s)) {
      const prims = byLayer[st.id];
      if (!prims || !prims.length) continue;
      const g = split(prims), clipAttr = st.id === 'marks' ? '' : ` clip-path="url(#${pre}-clip)"`;
      out.push(`<g id="${st.id}" inkscape:groupmode="layer" inkscape:label="${st.id}"${clipAttr}>`);
      if (g.fill.length) out.push(`<path fill="${esc(st.color)}" fill-opacity="${f(st.opacity)}" d="${pathData(g.fill)}"/>`);
      const stroke = `fill="none" stroke="${esc(st.color)}" stroke-opacity="${f(st.opacity)}" stroke-width="${f(st.width)}" stroke-linecap="butt" stroke-linejoin="miter"`;
      if (g.solid.length) out.push(`<path ${stroke} d="${pathData(g.solid)}"/>`);
      if (g.dashed.length) out.push(`<path ${stroke} stroke-dasharray="${f(s.dash)} ${f(s.dash)}" d="${pathData(g.dashed)}"/>`);
      out.push('</g>');
    }
    out.push('</svg>');
    return out.join('\n');
  }

  /** Read the settings JSON that toSVG stored in an SVG file (null if absent). */
  function settingsFromSVG(text) {
    const m = /<metadata id="grille-atelier-settings"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/.exec(String(text));
    if (!m) return null;
    try { return JSON.parse(m[1].replace(/]]]]><!\[CDATA\[>/g, ']]>')); } catch (e) { return null; }
  }

  /** Trace primitives onto a 2D context as one path (coordinates already in the context's mm space). */
  function tracePrims(ctx, prims) {
    ctx.beginPath();
    for (const p of prims) {
      if (p.t === 'l') { ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); }
      else if (p.t === 'p') { ctx.moveTo(p.pts[0], p.pts[1]); for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]); if (p.closed) ctx.closePath(); }
      else if (p.t === 'r') {
        const r = p.rx || 0;
        if (r > 0 && ctx.roundRect) { ctx.moveTo(p.x + r, p.y); ctx.roundRect(p.x, p.y, p.w, p.h, r); } else ctx.rect(p.x, p.y, p.w, p.h);
      } else if (p.t === 'c' || p.t === 'd') { ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); }
    }
  }

  /** Draw a scene on a 2D canvas context at `pxPerMm` pixels per millimetre (canvas must be doc-sized). */
  function drawScene(ctx, scene, s, pxPerMm) {
    const { doc, area, trim, bleed } = scene;
    ctx.save();
    ctx.setTransform(pxPerMm, 0, 0, pxPerMm, -doc.x * pxPerMm, -doc.y * pxPerMm);
    ctx.clearRect(doc.x, doc.y, doc.w, doc.h);
    if (!s.transparent) { ctx.fillStyle = s.bg; ctx.fillRect(-bleed, -bleed, trim.w + 2 * bleed, trim.h + 2 * bleed); }
    const clip = s.cropMarks || s.gridBleed ? { x: -bleed, y: -bleed, w: trim.w + 2 * bleed, h: trim.h + 2 * bleed } : area;
    const pad = Math.max(s.majW, s.minW, s.accW), byLayer = {};
    for (const p of scene.prims) (byLayer[p.L] = byLayer[p.L] || []).push(p);
    for (const st of layerStyles(s)) {
      const prims = byLayer[st.id];
      if (!prims || !prims.length) continue;
      ctx.save();
      if (st.id !== 'marks') { ctx.beginPath(); ctx.rect(clip.x - pad, clip.y - pad, clip.w + 2 * pad, clip.h + 2 * pad); ctx.clip(); }
      const g = split(prims);
      ctx.globalAlpha = st.opacity; ctx.fillStyle = st.color; ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.lineCap = 'butt';
      if (g.fill.length) { tracePrims(ctx, g.fill); ctx.fill(); }
      if (g.solid.length) { ctx.setLineDash([]); tracePrims(ctx, g.solid); ctx.stroke(); }
      if (g.dashed.length) { ctx.setLineDash([s.dash, s.dash]); tracePrims(ctx, g.dashed); ctx.stroke(); }
      ctx.restore();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ PNG resolution metadata */
  let CRC_TABLE = null;
  /** CRC-32 (PNG / zlib polynomial) of a byte array. */
  function crc32(bytes) {
    if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** Return a copy of PNG bytes with a pHYs chunk (pixels per metre) right after IHDR so that the image
   *  prints at its real size; an existing pHYs chunk is replaced. */
  function pngWithDpi(bytes, dpi) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (sig.some((b, i) => src[i] !== b)) throw new Error('not a PNG');
    const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const parts = [src.subarray(0, 8)];
    let off = 8, inserted = false;
    while (off < src.length) {
      const len = new DataView(src.buffer, src.byteOffset + off).getUint32(0), type = String.fromCharCode(...src.subarray(off + 4, off + 8)), end = off + 12 + len;
      if (type !== 'pHYs') parts.push(src.subarray(off, end));
      if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
      off = end;
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  /** Read the DPI stored in a PNG pHYs chunk (null if none). */
  function pngDpi(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let off = 8;
    while (off < src.length) {
      const dv = new DataView(src.buffer, src.byteOffset + off), len = dv.getUint32(0), type = String.fromCharCode(...src.subarray(off + 4, off + 8));
      if (type === 'pHYs') return src[off + 16] === 1 ? Math.round(dv.getUint32(8) * 0.0254) : null;
      off += 12 + len;
    }
    return null;
  }

  return { layerStyles, pathData, toSVG, settingsFromSVG, tracePrims, drawScene, crc32, pngWithDpi, pngDpi };
});
