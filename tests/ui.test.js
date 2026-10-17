// Headless UI test (Playwright + Chrome/Chromium): node tests/ui.test.js
// Serves the folder locally and runs the whole interface at 1366 px (desktop) and 390 px (mobile): three
// languages (+ Tifinagh), every grid type, presets, page / unit controls, dragging and keyboard-moving the
// vanishing points, zoom, SVG / PNG / JSON downloads (content checked), JSON and SVG import, URL-hash restore,
// print (PDF page size), reset, no console errors, no horizontal overflow on mobile. Writes screenshots.
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'))); }
const root = path.resolve(__dirname, '..'), shots = path.join(root, 'screenshots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
const GRID_TYPES = ['square', 'dot', 'iso', 'isodot', 'dimetric', 'triangle', 'hex', 'ruled', 'persp1', 'persp2', 'persp3', 'polar', 'comic', 'storyboard', 'calligraphy', 'blank'];
// wait for the preview, which is re-rendered on the next animation frame after an input
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const state = async (page) => { await settle(page); return page.evaluate(() => window.GrilleApp.state); };
const noOverflow = async (page, what) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  assert(o.sw <= o.w, `${what}: horizontal overflow ${o.sw} > ${o.w}`);
};
async function download(page, action) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(p) };
}

async function run(browser, base, vp, name) {
  const mobile = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(base, { waitUntil: 'load' });
  const ok = (m) => console.log(`  ✓ [${name}] ${m}`);

  // ---- first load
  assert.match(await page.title(), /Grille Atelier/);
  assert.strictEqual(await page.textContent('#typeTitle'), 'Type de grille');
  assert.strictEqual(await page.getAttribute('[data-type="square"]', 'aria-checked'), 'true');
  assert.strictEqual(await page.locator('#typeGrid .type').count(), 16);
  assert.match(await page.textContent('#info'), /210 × 297 mm · \d+ tracés/);
  assert(await page.locator('#stage svg path').count() >= 2);
  ok('loads in French: 16 grid types, A4 graph paper preview');
  if (mobile) await noOverflow(page, 'first load');

  // ---- languages
  await page.selectOption('#lang', 'en');
  assert.strictEqual(await page.textContent('#typeTitle'), 'Grid type');
  assert.strictEqual(await page.textContent('[data-type="persp2"] span'), '2-point perspective');
  assert.match(await page.textContent('#info'), /items/);
  await page.selectOption('#lang', 'kab');
  assert.strictEqual(await page.textContent('#typeTitle'), 'Anaw n uẓeṭṭa');
  assert(await page.isVisible('#tfngWrap'));
  await page.check('#tfng');
  assert.strictEqual(await page.textContent('#typeTitle'), 'ⴰⵏⴰⵡ ⵏ ⵓⵥⴻⵟⵟⴰ');
  assert(await page.evaluate(() => document.body.classList.contains('tfng')));
  if (mobile) await noOverflow(page, 'Tifinagh');
  await page.reload();
  assert.strictEqual(await page.inputValue('#lang'), 'kab', 'language remembered');
  await page.uncheck('#tfng');
  await page.selectOption('#lang', 'fr');
  assert.strictEqual(await page.textContent('#exp' + 'Title'), 'Exporter');
  assert(!(await page.isVisible('#tfngWrap')));
  ok('FR → EN → Taqbaylit → Tifinagh → FR, saved in localStorage');

  // ---- every grid type
  for (const t of GRID_TYPES) {
    await page.click(`[data-type="${t}"]`);
    const s = await state(page);
    assert.strictEqual(s.type, t);
    const n = await page.evaluate(() => window.GrilleApp.scene.prims.length);
    assert(n >= 1, `${t}: primitives`);
    assert(await page.locator('#stage svg path').count() >= 1, `${t}: drawn`);
    assert(!(await page.isVisible('#warn')), `${t}: no warning`);
    // only the relevant settings are visible
    const visibleTypes = await page.$$eval('#gridCard [data-types]', (els) => els.filter((e) => !e.hidden && e.offsetParent !== null).map((e) => e.dataset.types));
    visibleTypes.forEach((v) => assert(v.split(' ').includes(t), `${t}: unrelated field visible (${v})`));
    if (mobile) await noOverflow(page, t);
    if (!mobile && ['iso', 'persp2', 'calligraphy', 'comic', 'polar', 'hex'].includes(t)) await page.locator('.preview').screenshot({ path: path.join(shots, `type-${t}.png`) });
  }
  ok(`all ${GRID_TYPES.length} grid types render, with their own settings only`);

  // ---- keyboard navigation in the type radio group
  await page.focus('[data-type="blank"]');
  await page.keyboard.press('ArrowLeft');
  assert.strictEqual((await state(page)).type, 'calligraphy');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.strictEqual((await state(page)).type, 'square');
  ok('type picker works with the arrow keys');

  // ---- regular grid settings, units, page
  await page.fill('[data-k="cell"]', '8');
  assert.strictEqual((await state(page)).cell, 8);
  await page.selectOption('[data-k="unit"]', 'in');
  assert.strictEqual(await page.inputValue('#pageW'), '8.268');
  assert.strictEqual(await page.inputValue('[data-k="cell"]'), '0.315');
  await settle(page);
  assert.match(await page.textContent('#info'), /8\.268 × 11\.693 in/);
  await page.fill('[data-k="cell"]', '0.25');
  near((await state(page)).cell, 6.35, 1e-9);
  await page.selectOption('[data-k="unit"]', 'mm');
  await page.selectOption('[data-k="format"]', 'A3');
  await page.click('[data-orient="landscape"]'); await settle(page);
  assert.match(await page.textContent('#info'), /^420 × 297 mm/);
  await page.fill('#pageW', '300'); await page.fill('#pageH', '200');
  let s = await state(page);
  assert.strictEqual(s.format, 'custom'); assert.strictEqual(s.cusW, 300); assert.strictEqual(s.orient, 'landscape');
  await page.click('[data-orient="portrait"]'); await settle(page);
  assert.match(await page.textContent('#info'), /^200 × 300 mm/);
  await page.selectOption('[data-k="format"]', 'A4');
  await page.fill('[data-k="bleed"]', '3'); await page.check('[data-k="cropMarks"]'); await settle(page);
  assert.deepStrictEqual(await page.evaluate(() => window.GrilleApp.scene.doc), { x: -12, y: -12, w: 234, h: 321 });
  assert(await page.locator('#stage #marks').count() === 1 && await page.locator('#stage .pv-trim').count() === 1);
  await page.fill('[data-k="bleed"]', '0'); await page.uncheck('[data-k="cropMarks"]');
  await page.fill('[data-k="ml"]', '150'); await page.fill('[data-k="mr"]', '150'); await settle(page);
  assert(await page.isVisible('#warn'), 'no-area warning');
  await page.fill('[data-k="ml"]', '10'); await page.fill('[data-k="mr"]', '10'); await settle(page);
  assert(!(await page.isVisible('#warn')));
  ok('cell size, mm ⇄ in, formats, orientation, custom size, bleed + crop marks, margin warning');

  // ---- style & overlays
  await page.selectOption('#themeSel', 'sepia');
  s = await state(page);
  assert.strictEqual(s.bg, '#f6efe0'); assert.strictEqual(await page.getAttribute('#stage #background', 'fill'), '#f6efe0');
  await page.fill('[data-k="majC"]', '#112233');
  assert.strictEqual((await state(page)).theme, 'custom');
  await page.check('[data-k="oThirds"]'); await page.check('[data-k="oSpiral"]');
  assert(await page.isVisible('#spiralOpts'));
  await page.selectOption('[data-k="oSpiralRot"]', '2');
  assert.strictEqual((await state(page)).oSpiralRot, 2);
  assert(await page.locator('#stage #accent path').count() >= 1);
  await page.check('[data-k="transparent"]'); await settle(page);
  assert.strictEqual(await page.getAttribute('#stage #background', 'fill'), 'url(#pv-checker)');
  await page.uncheck('[data-k="transparent"]');
  ok('colour themes, custom colour, overlays (thirds + golden spiral), transparent preview');

  // ---- presets
  await page.selectOption('#preset', 'seyes');
  s = await state(page);
  assert.strictEqual(s.type, 'ruled'); assert.strictEqual(s.sub, 4); assert.strictEqual(s.rMargin, 25); assert.strictEqual(s.oThirds, false);
  await page.selectOption('#preset', 'naskh');
  s = await state(page);
  assert.strictEqual(s.type, 'calligraphy'); assert.strictEqual(s.rtl, true); assert.strictEqual(await page.inputValue('#cPreset'), 'naskh');
  if (!mobile) await page.locator('.preview').screenshot({ path: path.join(shots, 'calligraphy-naskh.png') });
  await page.selectOption('#cPreset', 'tifinagh');
  assert.strictEqual((await state(page)).modules, true);
  await page.fill('[data-k="xh"]', '7');
  assert.strictEqual(await page.inputValue('#cPreset'), 'custom');
  await page.selectOption('#preset', 'comic6');
  await page.selectOption('#comicLayout', 'manga');
  assert.strictEqual((await state(page)).rows, '1:2, 2:1:1, 1');
  assert.strictEqual(await page.evaluate(() => window.GrilleApp.scene.prims.filter((p) => p.t === 'r').length), 6);
  await page.fill('[data-k="rows"]', '2, oops');
  assert(await page.isVisible('#rowsErr'));
  assert.strictEqual((await state(page)).rows, '1:2, 2:1:1, 1', 'last valid layout kept');
  await page.fill('[data-k="rows"]', '3, 1, 2:1');
  assert(!(await page.isVisible('#rowsErr')));
  assert.strictEqual(await page.inputValue('#comicLayout'), 'custom');
  ok('presets (Seyès, Naskh, comic), calligraphy presets, comic layout syntax + error message');

  // ---- perspective: drag and keyboard
  await page.selectOption('#preset', 'persp2');
  await page.click('#zoomFit');
  s = await state(page);
  const h2 = page.locator('[data-h="v2"] .ring');
  const bb = await h2.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 - 30, bb.y + bb.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  let s2 = await state(page);
  assert(s2.v2x < s.v2x - 0.01, `v2 dragged left (${s.v2x} → ${s2.v2x})`);
  assert(s2.hz > s.hz + 0.01, 'dragging a horizon vanishing point moves the horizon');
  assert.strictEqual(await page.inputValue('[data-k="v2x"]'), String(+(s2.v2x * 100).toFixed(2)));
  await page.focus('[data-h="hz"]');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Shift+ArrowDown');
  const s3 = await state(page);
  near((s3.hz - s2.hz) * 297, 11, 0.02);
  assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.h), 'hz', 'handle keeps focus after re-render');
  await page.selectOption('#preset', 'persp3');
  assert.strictEqual(await page.locator('[data-h]').count(), 4);
  await page.focus('[data-h="v3"]');
  await page.keyboard.press('ArrowLeft');
  near(((await state(page)).v3x - 0.5) * 210, -1, 0.02);
  await page.selectOption('#preset', 'persp1');
  assert((await state(page)).pDepth);
  if (!mobile) await page.locator('.preview').screenshot({ path: path.join(shots, 'perspective-1pt-depth.png') });
  await page.selectOption('#preset', 'mandala');
  const pc = await page.locator('[data-h="pc"] .ring').boundingBox();
  await page.mouse.move(pc.x + pc.width / 2, pc.y + pc.height / 2); await page.mouse.down();
  await page.mouse.move(pc.x + pc.width / 2 + 25, pc.y + pc.height / 2, { steps: 3 }); await page.mouse.up();
  assert((await state(page)).pcx > 0.52, 'polar centre dragged');
  ok('vanishing points & horizon: mouse drag, arrow keys (Shift ×10), 3-point VP, polar centre drag');

  // ---- zoom
  const z0 = await page.textContent('#zoomVal');
  await page.click('#zoomIn');
  const z1 = await page.textContent('#zoomVal');
  assert(parseInt(z1, 10) > parseInt(z0, 10));
  await page.focus('#stage'); await page.keyboard.press('-'); await page.keyboard.press('0');
  assert.strictEqual(await page.textContent('#zoomVal'), z0);
  ok(`zoom buttons and keys (${z0} → ${z1} → fit)`);

  // ---- exports
  await page.selectOption('#preset', 'iso5');
  let d = await download(page, () => page.click('#svgBtn'));
  const svg = d.buf.toString('utf8');
  assert.match(d.name, /^grille-iso-A4-portrait\.svg$/);
  assert(svg.startsWith('<?xml') && svg.includes('width="210mm" height="297mm"') && svg.includes('inkscape:label="major"'));
  assert(!/NaN|undefined/.test(svg));
  const meta = /<metadata id="grille-atelier-settings"><!\[CDATA\[([\s\S]*?)\]\]>/.exec(svg);
  assert.strictEqual(JSON.parse(meta[1]).type, 'iso');
  // the exported SVG is valid XML for the browser
  assert(await page.evaluate((t) => !new DOMParser().parseFromString(t, 'image/svg+xml').querySelector('parsererror'), svg));
  await page.selectOption('[data-k="dpi"]', '150'); await settle(page);
  assert.strictEqual(await page.textContent('#pngSize'), '1240 × 1754 px');
  d = await download(page, () => page.click('#pngBtn'));
  assert.match(d.name, /150dpi\.png$/);
  assert.deepStrictEqual([...d.buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.strictEqual(d.buf.readUInt32BE(16), 1240); assert.strictEqual(d.buf.readUInt32BE(20), 1754);
  const phys = d.buf.indexOf('pHYs');
  assert(phys > 0 && phys < 60, 'pHYs right after IHDR'); assert.strictEqual(Math.round(d.buf.readUInt32BE(phys + 4) * 0.0254), 150);
  assert(d.buf.length > 5000, 'PNG has content');
  // the PNG really contains lines (not just the background)
  const inked = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 200) n++;
    return n / (px.length / 4);
  }, d.buf.toString('base64'));
  assert(inked > 0.02 && inked < 0.9, 'PNG ink coverage ' + inked);
  d = await download(page, () => page.click('#jsonBtn'));
  const json = JSON.parse(d.buf.toString('utf8'));
  assert.strictEqual(json.app, 'grille-atelier'); assert.strictEqual(json.settings.type, 'iso'); assert.strictEqual(json.settings.dpi, 150);
  ok(`SVG (${(svg.length / 1024).toFixed(0)} kB, mm, layers, metadata), PNG 150 dpi 1240×1754 with pHYs, JSON downloads`);

  // ---- import JSON and SVG
  const tmp = path.join(require('os').tmpdir(), `ga-${name}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ app: 'grille-atelier', version: 1, settings: { ...json.settings, type: 'hex', cell: 7, hexOrient: 'flat' } }));
  await page.setInputFiles('#fileIn', tmp);
  await page.waitForFunction(() => window.GrilleApp.state.type === 'hex');
  s = await state(page);
  assert.strictEqual(s.cell, 7); assert.strictEqual(s.hexOrient, 'flat'); assert.strictEqual(await page.inputValue('[data-k="hexOrient"]'), 'flat');
  assert.match(await page.textContent('#status'), /Réglages chargés/);
  const tmpSvg = path.join(require('os').tmpdir(), `ga-${name}.svg`);
  fs.writeFileSync(tmpSvg, svg);
  await page.setInputFiles('#fileIn', tmpSvg);
  await page.waitForFunction(() => window.GrilleApp.state.type === 'iso');
  const bad = path.join(require('os').tmpdir(), `ga-${name}-bad.json`);
  fs.writeFileSync(bad, '{"hello": 1}');
  await page.setInputFiles('#fileIn', bad);
  await page.waitForFunction(() => /non reconnu/.test(document.querySelector('#status').textContent));
  assert.strictEqual((await state(page)).type, 'iso', 'bad file ignored');
  ok('JSON import, SVG (embedded settings) import, invalid file rejected');

  // ---- URL hash: written on change, restored on load and on hashchange
  await page.selectOption('#preset', 'mandala');
  await page.waitForFunction(() => location.hash.includes('type=polar'));
  const url = page.url();
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(url);
  const r = await p2.evaluate(() => window.GrilleApp.state);
  assert.strictEqual(r.type, 'polar'); assert.strictEqual(r.spokes, 12); assert.strictEqual(r.theme, 'sanguine');
  await p2.goto(base + '#type=storyboard&sbCols=4&sbAspect=2.39%3A1&orient=landscape');
  const r2 = await p2.evaluate(() => window.GrilleApp.state);
  assert.strictEqual(r2.type, 'storyboard'); assert.strictEqual(r2.sbCols, 4); assert.strictEqual(r2.sbAspect, '2.39:1');
  await p2.evaluate(() => { location.hash = '#type=triangle&cell=12'; });
  await p2.waitForFunction(() => window.GrilleApp.state.type === 'triangle');
  assert.strictEqual(await p2.inputValue('[data-k="cell"]'), '12');
  await p2.close();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') }).catch(() => {});
  await page.click('#linkBtn');
  await page.waitForFunction(() => /Lien/.test(document.querySelector('#status').textContent));
  ok('URL hash sharing: link updated live, restored on load and on hashchange, copy link');

  // ---- print: exact page size
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.selectOption('#preset', 'graph');
  await page.click('#printBtn');
  assert(await page.evaluate(() => window.__printed));
  assert.strictEqual(await page.locator('#printArea svg').count(), 1);
  assert.match(await page.textContent('#pageRule'), /size: 210mm 297mm/);
  if (!mobile) {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)];
    assert.strictEqual(boxes.length, 1, 'one page');
    near(+boxes[0][1], 595.28, 1); near(+boxes[0][2], 841.89, 1);
    ok('print: @page 210×297 mm → a single A4 PDF page');
  } else ok('print: @page rule + print area ready');

  // ---- help, UI theme, reset
  await page.click('#helpBtn');
  assert(await page.isVisible('#helpDlg'));
  await page.keyboard.press('Escape');
  assert(!(await page.isVisible('#helpDlg')));
  const th = await page.getAttribute('html', 'data-theme');
  await page.click('#themeBtn');
  assert.notStrictEqual(await page.getAttribute('html', 'data-theme'), th);
  await page.click('#themeBtn');
  await page.click('#resetBtn');
  assert.strictEqual((await state(page)).type, 'square'); assert.strictEqual((await state(page)).format, 'A4');
  await page.waitForFunction(() => location.hash === '');
  ok('help dialog, light/dark interface, reset to defaults');
  if (mobile) await noOverflow(page, 'end');

  // ---- screenshots
  if (!mobile) {
    await page.selectOption('#preset', 'persp2');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, 'desktop.png') });
    await page.selectOption('#preset', 'golden');
    await page.locator('.preview').screenshot({ path: path.join(shots, 'composition-golden.png') });
    await page.click('#themeBtn');
    await page.selectOption('#preset', 'story169');
    await page.screenshot({ path: path.join(shots, 'desktop-light.png') });
    await page.click('#themeBtn');
  } else {
    await page.selectOption('#preset', 'iso5');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, 'mobile.png') });
    await noOverflow(page, 'screenshot');
  }
  await page.selectOption('#preset', 'graph'); await page.click('#resetBtn');

  assert.deepStrictEqual(errors, [], 'console errors: ' + errors.join('\n'));
  ok('no console errors');
  await ctx.close();
}
function near(a, b, eps, msg) { assert(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`); }

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let code = 0;
  try {
    console.log('desktop 1366 px');
    await run(browser, base, { width: 1366, height: 900 }, 'desktop');
    console.log('mobile 390 px');
    await run(browser, base, { width: 390, height: 844 }, 'mobile');
    console.log('\nUI test passed');
  } catch (e) { console.error('\nUI test FAILED\n', e); code = 1; }
  await browser.close(); server.close();
  process.exit(code);
})();
