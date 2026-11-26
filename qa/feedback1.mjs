// QA-Lauf zu den Feedback-Punkten 1–8 (Playwright): Chromium 375/1440 mit echter Touch-Eingabe per CDP, WebKit mit iPhone-Profil.
// Aufruf: node qa/feedback1.mjs <baseUrl> [--engine chromium|webkit] [--shots <ordner>] [--only s3]
// Voraussetzung: `npm run build && npx vite preview --port 4173` läuft; WebKit: PLAYWRIGHT_BROWSERS_PATH=<Ordner mit webkit-*> (npx playwright-core install webkit).
import { chromium, webkit, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args[0] ?? 'http://localhost:4173').replace(/\/$/, '');
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const engine = opt('--engine', 'chromium');
const shots = opt('--shots', '../texts/screens/qa2');
const only = opt('--only', '');
mkdirSync(shots, { recursive: true });

const HEILBRONN = { latitude: 49.1427, longitude: 9.2187, accuracy: 20 };
const results = [];
const rec = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ::  ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  if (engine === 'webkit') return webkit.launch();
  return chromium.launch({ channel: 'chrome', headless: true });
}
const ctxOpts = (kind, extra = {}) => {
  if (engine === 'webkit') return { ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin', ...extra };
  if (kind === 'm') return { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin', ...extra };
  return { viewport: { width: 1440, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', ...extra };
};
const withGeo = { geolocation: HEILBRONN, permissions: ['geolocation'] };
const tag = (kind) => (engine === 'webkit' ? 'webkit-iphone' : kind === 'm' ? '375' : '1440');

async function newPage(browser, kind, extra = {}) {
  const ctx = await browser.newContext(ctxOpts(kind, extra));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tiles|net::|openfreemap|Refused to apply a stylesheet/i.test(m.text())) errors.push(m.text().slice(0, 140) + ' @' + (m.location().url || '').slice(-60)); });
  page.__errors = errors;
  return { ctx, page };
}
const shot = async (page, name) => { await page.screenshot({ path: join(shots, `${name}.png`) }); };
const rows = (page) => page.locator('.panel .row').count();
async function waitRows(page, min = 1, ms = 20000) { await page.waitForFunction((m) => document.querySelectorAll('.panel .row').length >= m, min, { timeout: ms }); }
async function mapView(page) { return page.evaluate(() => { const c = document.querySelector('canvas.maplibregl-canvas'); return c ? 'canvas' : null; }); }
async function full(page) { for (let i = 0; i < 3 && (await sheetState(page)) !== 'full'; i++) { await page.locator('.sheet-handle').click({ force: true }); await sleep(450); } }
const sheetState = (page) => page.evaluate(() => document.querySelector('.app')?.dataset.sheet);
const panelInline = (page) => page.evaluate(() => { const p = document.querySelector('.panel'); return { t: p.style.transform, tr: p.style.transition, dragging: p.classList.contains('dragging') }; });
async function skipOnboarding(page) { // „Nicht jetzt“, falls die Standort-Frage erscheint
  const ob = page.locator('.onboarding'); if (await ob.count()) { await ob.locator('.btn:not(.btn-primary)').click(); await sleep(300); const ov = page.locator('.search-overlay'); if (await ov.count()) await page.keyboard.press('Escape'); }
}

// ---- Echte Touch-Gesten über CDP (nur Chromium) ----
async function cdpSwipe(page, x, y0, y1, o = {}) {
  const c = page.__cdp ?? (page.__cdp = await page.context().newCDPSession(page));
  const steps = o.steps ?? 8; const dt = o.dt ?? 12;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps, id: 1 }] }); await sleep(dt); }
  if (o.end === 'cancel') await c.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  else if (o.end !== 'none') await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// ---- Synthetische Pointer-Ereignisse (WebKit hat keine Touch-Eingabe per Skript) ----
async function synthSwipe(page, y0, y1, o = {}) {
  await page.evaluate(async ({ y0, y1, o }) => {
    const el = document.elementFromPoint(150, y0) ?? document.querySelector('.panel');
    const base = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: 150 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientY: y0 }));
    const n = o.steps ?? 8;
    for (let i = 1; i <= n; i++) { document.querySelector('.panel').dispatchEvent(new PointerEvent('pointermove', { ...base, clientY: y0 + ((y1 - y0) * i) / n })); await new Promise((r) => setTimeout(r, 12)); }
    if (o.end === 'cancel') document.querySelector('.panel').dispatchEvent(new PointerEvent('pointercancel', { ...base, clientY: y1 }));
    else if (o.end !== 'none') document.querySelector('.panel').dispatchEvent(new PointerEvent('pointerup', { ...base, clientY: y1 }));
  }, { y0, y1, o });
}
const swipe = (page, x, y0, y1, o) => (engine === 'webkit' ? synthSwipe(page, y0, y1, o) : cdpSwipe(page, x, y0, y1, o));

// =========================================================================================================
async function s1_back(browser, kind) {
  const { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/suche?was=Bibliothek&wo=Heilbronn`); await waitRows(page, 1);
  const n0 = await rows(page);
  const url0 = page.url();
  const firstName = await page.locator('.panel .row .row-name').first().textContent();
  if (kind === 'm') { await page.evaluate(() => document.querySelector('.app').dataset.sheet); }
  // zweite Zeile öffnen (Liste leicht gescrollt)
  await page.locator('.panel .panel-body').evaluate((el) => { el.scrollTop = 120; });
  const link = page.locator('.panel .row .row-main').nth(Math.min(2, n0 - 1));
  await link.scrollIntoViewIfNeeded();
  const scrollBefore = await page.locator('.panel .panel-body').evaluate((el) => el.scrollTop);
  const nm = await link.locator('.row-name').textContent();
  const scrollBefore2 = await link.evaluate((el) => { const st = document.querySelector('.panel .panel-body').scrollTop; el.click(); return st; });
  await page.waitForSelector('.place h1', { timeout: 15000 });
  rec(`S1 ${tag(kind)} Karte öffnet`, (await page.locator('.place h1').textContent()) === nm, nm);
  await shot(page, `s1-${tag(kind)}-1-karte`);
  const hasBackBtn = await page.locator('.place .back-btn').count();
  rec(`S1 ${tag(kind)} sichtbarer „Zurück“-Knopf in der Karte`, hasBackBtn === 1 && /Zurück/.test(await page.locator('.place .back-btn').textContent()));
  await page.locator('.place .back-btn').click();
  await page.waitForSelector('.panel .row', { timeout: 15000 }); await sleep(600);
  const n1 = await rows(page);
  rec(`S1 ${tag(kind)} Zurück: gleiche Liste (Treffer ${n0}→${n1}) und URL`, n1 === n0 && page.url() === url0, page.url());
  const scrolled = await page.locator('.panel .panel-body').evaluate((el) => el.scrollTop);
  rec(`S1 ${tag(kind)} Scrollposition der Liste wiederhergestellt`, Math.abs(scrolled - scrollBefore2) <= 4, `beim Klick=${scrollBefore2} nachher=${scrolled}`);
  await shot(page, `s1-${tag(kind)}-2-zurueck`);
  // Browser-Zurück/Vorwärts
  await link.click(); await page.waitForSelector('.place h1'); await page.goBack(); await page.waitForSelector('.panel .row'); await sleep(400);
  rec(`S1 ${tag(kind)} Browser-Zurück stellt Liste wieder her`, (await rows(page)) === n0);
  await page.goForward(); await page.waitForSelector('.place h1'); rec(`S1 ${tag(kind)} Browser-Vorwärts öffnet Karte wieder`, (await page.locator('.place h1').textContent()) === nm);
  // Zurück-Knopf in der Ergebnisliste -> Karte
  await page.locator('.place .back-btn').click(); await page.waitForSelector('.panel .row');
  const listBack = page.locator('.list-head .back-btn');
  rec(`S1 ${tag(kind)} „Zurück“ in der Ergebnisliste`, (await listBack.count()) === 1);
  if (await listBack.count()) { await listBack.click(); await sleep(500); rec(`S1 ${tag(kind)} Zurück aus der Liste führt zur vorherigen Ansicht`, !page.url().includes('was=Bibliothek'), page.url()); }
  // Filter bleiben erhalten
  await page.goto(`${base}/suche?was=Bibliothek&wo=Heilbronn&kat=kultur.bibliothek`); await waitRows(page, 1);
  const nf = await rows(page);
  await page.locator('.panel .row .row-main').first().click(); await page.waitForSelector('.place h1');
  await page.locator('.place .back-btn').click(); await page.waitForSelector('.panel .row'); await sleep(300);
  rec(`S1 ${tag(kind)} Filter (kat) nach Zurück unverändert`, page.url().includes('kat=kultur.bibliothek') && (await rows(page)) === nf, page.url());
  // Karten-Ausschnitt (Browse-Modus): Zoom/Mitte vor und nach dem Besuch einer Karte
  rec(`S1 ${tag(kind)} keine Skriptfehler`, page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function s1_mapview(browser, kind) {
  // Karte (Browse): hineinzoomen, Marker/Liste -> Karte -> Zurück: Zoom und Mitte bleiben
  const { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/suche?nearby=1`); await waitRows(page, 3);
  await page.locator('.list-head .back-btn').click(); await sleep(1200);
  // jetzt in der Karte: Browse-Liste
  await waitRows(page, 1, 20000);
  const before = await page.evaluate(() => document.querySelector('.panel .count')?.textContent);
  const nBefore = await rows(page);
  await page.locator('.panel .row .row-main').first().click(); await page.waitForSelector('.place h1');
  await sleep(1500); // Karte fliegt zur Einrichtung
  await page.locator('.place .back-btn').click(); await page.waitForSelector('.panel .row', { timeout: 20000 }); await sleep(1500);
  const nAfter = await rows(page);
  rec(`S1 ${tag(kind)} Browse: nach Zurück wieder Liste des Kartenausschnitts (${nBefore}→${nAfter})`, nAfter > 1 && Math.abs(nAfter - nBefore) <= Math.max(3, nBefore * 0.25), before);
  await shot(page, `s1-${tag(kind)}-3-browse-zurueck`);
  await ctx.close();
}

async function s2_route(browser, kind) {
  const { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/suche?was=Bibliothek&wo=Heilbronn`); await waitRows(page, 1);
  await page.locator('.panel .row .row-main').first().click(); await page.waitForSelector('.place h1');
  if (kind === 'm') await full(page);
  await page.locator('.actionbar a.btn-primary').click();
  await page.waitForSelector('.route', { timeout: 15000 });
  await page.waitForSelector('.route-sum, .route .banner-warn', { timeout: 30000 });
  const sum = await page.locator('.route-sum').count() ? await page.locator('.route-sum').textContent() : '';
  rec(`S2 ${tag(kind)} Zu Fuß: Zeit und Entfernung im Ergebnis`, /\d+ (Min|Std)/.test(sum) && /(\d|,)+\s?(m|km)/.test(sum), sum);
  const stepCount = await page.locator('.step-list li').count(); const stepsSummary = await page.locator('.steps summary').count();
  rec(`S2 ${tag(kind)} Zu Fuß: Wegbeschreibung vorhanden`, stepsSummary === 1, `${await page.locator('.steps summary').textContent().catch(() => '')}`);
  rec(`S2 ${tag(kind)} Dienstangabe und Quellenhinweis`, /routing\.openstreetmap\.de/.test(await page.locator('.route').textContent()), '');
  await shot(page, `s2-${tag(kind)}-1-zufuss`);
  await page.locator('.seg', { hasText: 'Auto' }).click();
  await page.waitForSelector('.route-sum, .banner-warn', { timeout: 30000 });
  const car = await page.locator('.route-sum').count() ? await page.locator('.route-sum').textContent() : await page.locator('.banner-warn').textContent();
  rec(`S2 ${tag(kind)} Auto`, /\d+ (Min|Std)/.test(car), car);
  await shot(page, `s2-${tag(kind)}-2-auto`);
  await page.locator('.seg', { hasText: 'ÖPNV' }).click();
  await page.waitForSelector('.itin, .banner-warn, .banner-info', { timeout: 40000 });
  const itins = await page.locator('.itin').count();
  const tx = itins ? await page.locator('.itin').first().textContent() : await page.locator('.route .banner').first().textContent();
  rec(`S2 ${tag(kind)} ÖPNV: Verbindungen mit Zeiten (${itins})`, itins > 0 || /Keine Verbindung|nicht|Fehler/i.test(tx), tx.slice(0, 120));
  if (itins) rec(`S2 ${tag(kind)} ÖPNV: Linie, Abfahrt/Ankunft sichtbar`, /\d{2}:\d{2}/.test(tx), tx.slice(0, 100));
  await shot(page, `s2-${tag(kind)}-3-oepnv`);
  rec(`S2 ${tag(kind)} Google-Rückfall bleibt`, (await page.locator('.route a[href*="google.com/maps/dir"]').count()) === 1);
  rec(`S2 ${tag(kind)} keine Skriptfehler`, page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function s2_route_fallback(browser, kind) {
  if (engine === 'webkit') return; // page.route fängt in WebKit Cross-Origin-fetch nicht ab: Fehlerpfad dort nicht prüfbar
  // Dienste nicht erreichbar / Limit: verständliche Meldung + Luftlinie + Google/Apple
  const { ctx, page } = await newPage(browser, kind, withGeo);
  let hits = 0;
  await page.route('**/routing.openstreetmap.de/**', (r) => { hits++; return r.fulfill({ status: 429, body: 'rate', headers: { 'access-control-allow-origin': '*' } }); });
  await page.route('**/api.transitous.org/**', (r) => r.abort('failed'));
  await page.goto(`${base}/suche?was=Bibliothek&wo=Heilbronn`); await waitRows(page, 1);
  await page.locator('.panel .row .row-main').first().click(); await page.waitForSelector('.place h1');
  if (kind === 'm') await full(page);
  await page.locator('.actionbar a.btn-primary').click();
  await page.waitForSelector('.route .banner-warn', { timeout: 30000 });
  const txt = await page.locator('.route').textContent();
  rec(`S2 ${tag(kind)} Limit (429): Meldung, Luftlinie, Karten-App`, /überlastet|Limit/i.test(txt) && /Luftlinie/.test(txt) && (await page.locator('.route a[href*="google.com/maps/dir"]').count()) === 1, txt.slice(0, 160));
  await shot(page, `s2-${tag(kind)}-4-fehler-limit`);
  await page.locator('.seg', { hasText: 'ÖPNV' }).click();
  await page.waitForSelector('.route .banner-warn', { timeout: 30000 });
  rec(`S2 ${tag(kind)} ÖPNV nicht erreichbar: Meldung + Rückfall`, /Verbindung|antwortet/i.test(await page.locator('.route .banner-warn').first().textContent()) && (await page.locator('.route a[href*="google.com/maps/dir"]').count()) === 1);
  // Keine Anfrage ohne Aktion: Neuladen der Route-Adresse zeigt „Route berechnen“ statt zu rechnen
  hits = 0;
  await page.reload(); await page.waitForSelector('.route');
  await sleep(1500);
  rec(`S2 ${tag(kind)} Neuladen: keine Anfrage ohne Aktion (Schaltfläche „Route berechnen“)`, hits === 0 && (await page.locator('.route button', { hasText: 'Route berechnen' }).count()) === 1, `Anfragen=${hits}`);
  await ctx.close();
}

async function s3_sheet(browser, kind) {
  if (kind !== 'm') return;
  const { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/suche?nearby=1`); await waitRows(page, 3);
  // in „peek“ starten (Tab Karte)
  await page.locator('.tab[data-tab="map"]').click(); await sleep(800);
  const vs = page.viewportSize(); const H = vs.height; const x = Math.round(vs.width / 2);
  let st = await sheetState(page);
  rec(`S3 ${tag(kind)} Start in peek`, st === 'peek' || st === 'half', st);
  const y = (f) => Math.round(H * f);
  // 1) Wischen auf dem LISTENINHALT (nicht nur am Griff) nach oben
  await page.locator('.tab[data-tab="map"]').click(); await sleep(600);
  const top = () => page.evaluate(() => Math.round(document.querySelector('.panel').getBoundingClientRect().top));
  await swipe(page, x, y(0.84), y(0.30)); await sleep(500);
  const afterUp = await sheetState(page);
  rec(`S3 ${tag(kind)} Wischen auf der Liste zieht die Schublade hoch`, afterUp !== 'peek', afterUp);
  await shot(page, `s3-${tag(kind)}-1-hoch`);
  const t1 = await top();
  await swipe(page, x, t1 + (afterUp === 'full' ? 14 : 120), y(0.97)); await sleep(500);
  const afterDown = await sheetState(page);
  rec(`S3 ${tag(kind)} Wischen nach unten (auf der Schublade) zieht sie wieder herunter`, afterDown === 'peek' || (afterUp === 'full' && afterDown === 'half'), `${afterUp}→${afterDown}`);
  // 2) Serie schneller Gesten, auch abgebrochene und nie beendete
  const seq = [[0.85, 0.4], [0.4, 0.85], [0.8, 0.78], [0.5, 0.2, 'cancel'], [0.3, 0.9], [0.85, 0.5], [0.5, 0.45], [0.2, 0.7, 'cancel'], [0.9, 0.2], [0.25, 0.95], [0.6, 0.55], [0.85, 0.3, 'none']];
  for (const [a, b, end] of seq) { await swipe(page, x, y(a), y(b), { steps: 4, dt: 4, ...(end ? { end } : {}) }); await sleep(30); }
  await sleep(3200); // Zeitwächter räumt die nie beendete Geste auf
  const inl = await panelInline(page);
  rec(`S3 ${tag(kind)} nach 12 schnellen/abgebrochenen Gesten: kein hängender Zustand`, inl.t === '' && inl.tr === '' && !inl.dragging, JSON.stringify(inl));
  const before = await sheetState(page);
  await swipe(page, x, before === 'peek' ? y(0.84) : y(0.9), before === 'peek' ? y(0.3) : y(0.1)); await sleep(500);
  const after = await sheetState(page);
  rec(`S3 ${tag(kind)} danach reagiert die Schublade (${before}→${after})`, after !== before || before === 'full');
  // 3) Tippen auf den Griff
  await page.locator('.sheet-handle').tap().catch(() => page.locator('.sheet-handle').click());
  await sleep(500);
  const afterTap = await sheetState(page);
  rec(`S3 ${tag(kind)} Tippen auf Griff wechselt den Zustand`, afterTap !== after, `${after}→${afterTap}`);
  // 3b) Ursache A: pointerup geht verloren (Systemgeste, App-Wechsel): bleibt ein Inline-transform stehen?
  await page.locator('.tab[data-tab="map"]').click(); await sleep(700);
  await page.evaluate(async () => {
    const h = document.querySelector('.sheet-handle'); const r = h.getBoundingClientRect();
    const base = { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: r.left + 100 };
    h.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientY: r.top + 10 }));
    for (let i = 1; i <= 6; i++) { h.dispatchEvent(new PointerEvent('pointermove', { ...base, clientY: r.top + 10 - i * 25 })); await new Promise((q) => setTimeout(q, 10)); }
  }); // …und nie ein pointerup
  await sleep(3500);
  const lost = await panelInline(page);
  rec(`S3b ${tag(kind)} verlorenes pointerup: kein dauerhaft hängendes Inline-transform (${lost.t || 'leer'})`, lost.t === '' && !lost.dragging, JSON.stringify(lost));
  // 3c) Ursache B: die App-Fläche wird per focus()/scrollIntoView() verschoben (iOS bei Tastatur/Fokus): Schublade und Griff wandern aus dem Bild
  const shift = await page.evaluate(async () => { const a = document.querySelector('.app'); a.scrollTop = 150; await new Promise((q) => setTimeout(q, 250)); return a.scrollTop; });
  rec(`S3c ${tag(kind)} .app lässt sich nicht verschieben (scrollTop nach Versuch: ${shift})`, shift === 0, `scrollTop=${shift}`);
  await page.evaluate(() => { document.querySelector('.app').scrollTop = 0; });
  await page.locator('.tab[data-tab="map"]').click(); await sleep(500);
  // 4) Antippen einer Listenzeile funktioniert weiterhin (kein verschluckter Klick)
  await page.locator('.tab[data-tab="list"]').click(); await sleep(600);
  await page.locator('.panel .row .row-main').first().click();
  await page.waitForSelector('.place h1', { timeout: 10000 }).then(() => rec(`S3 ${tag(kind)} Tippen auf Zeile öffnet Karte`, true), () => rec(`S3 ${tag(kind)} Tippen auf Zeile öffnet Karte`, false));
  await shot(page, `s3-${tag(kind)}-2-nach-serie`);
  await ctx.close();
}

async function s4_filter(browser, kind) {
  const { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/suche?was=Bibliothek&wo=Heilbronn`); await waitRows(page, 1);
  await page.waitForSelector('.panel .count');
  const base1 = await page.locator('.panel .count').textContent();
  // Filterdialog: alle Gruppen anhaken (außer Gastronomie)
  const filterBtn = page.locator('.chips .chip-filter');
  await filterBtn.click(); await page.waitForSelector('.filter-overlay');
  const groups = await page.$$eval('.filter-overlay input[id^="fg-"]', (els) => els.map((e) => e.id.slice(3)));
  for (const g of groups) { if (g === 'gastronomie') continue; await page.locator(`.filter-overlay #fg-${g}`).check(); }
  const filterApplyTxt = await page.locator('.overlay-foot .btn-primary').textContent();
  await shot(page, `s4-${tag(kind)}-1-dialog-alle`);
  await page.locator('.overlay-foot .btn-primary').click(); await sleep(1500);
  const chipTxt = (await page.locator('.chips .chip-filter').textContent()).trim();
  const allOn = await page.locator('.chips .chip', { hasText: /^Alle$/ }).getAttribute('aria-pressed');
  const after = await page.locator('.panel .count').textContent();
  const url = page.url();
  rec(`S4 ${tag(kind)} alle ${groups.filter((g) => g !== 'gastronomie').length} Gruppen gewählt = „Alle“: Filter-Chip ohne Zähler`, chipTxt === 'Filter' && allOn === 'true', `chip="${chipTxt}" alle=${allOn}`);
  rec(`S4 ${tag(kind)} Ergebnisse wie ohne Filter (${base1.trim()} / ${after.trim()}), kein kat= in der URL`, after === base1 && !/kat=/.test(url), url);
  rec(`S4 ${tag(kind)} keine „Filter (49)“-Chips in der Liste`, (await page.locator('.active-chips').count()) === 0);
  await shot(page, `s4-${tag(kind)}-2-alle`);
  // Einzelne Gruppe -> Zähler, dann Zurücksetzen
  await page.locator('.chips .chip', { hasText: 'Kultur' }).click(); await sleep(1200);
  rec(`S4 ${tag(kind)} Gruppe „Kultur“ zeigt Filter (1)`, /Filter \(1\)/.test(await page.locator('.chips .chip-filter').textContent()));
  await page.locator('.chips .chip', { hasText: /^Alle$/ }).click(); await sleep(1200);
  rec(`S4 ${tag(kind)} „Alle“ setzt zurück`, (await page.locator('.chips .chip-filter').textContent()).trim() === 'Filter' && (await page.locator('.panel .count').textContent()) === base1);
  // Karte ohne Suche: Deutschlandansicht + „Alle“ -> verständlicher Hinweis statt leerer Fläche
  await ctx.close();
  const n2 = await newPage(browser, kind, {});
  await n2.page.goto(`${base}/?kat=${groups.filter((g) => g !== 'gastronomie').join(',')}`); await sleep(2000);
  await skipOnboarding(n2.page);
  const hint = await n2.page.locator('.panel').textContent();
  rec(`S4 ${tag(kind)} „alle Gruppen“ in der URL = „Alle“ (Chip „Filter“), Deutschlandansicht mit Hinweis statt leerer Liste`, (await n2.page.locator('.chips .chip-filter').textContent()).trim() === 'Filter' && /Zoomen Sie/.test(hint) && (await n2.page.locator('.panel .btn-primary').count()) >= 1, hint.slice(0, 100));
  await shot(n2.page, `s4-${tag(kind)}-3-deutschland`);
  await n2.ctx.close();
}

async function s5_onboarding(browser, kind) {
  // a) frisch, Berechtigung „prompt“: eigene Frage zuerst, keine Systemabfrage vorher
  let { ctx, page } = await newPage(browser, kind, {});
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    const g = navigator.geolocation; const orig = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (...a) => { window.__geoCalls++; return orig(...a); };
  });
  await page.goto(`${base}/`);
  await page.waitForSelector('.onboarding', { timeout: 15000 });
  const calls0 = await page.evaluate(() => window.__geoCalls);
  rec(`S5 ${tag(kind)} Startfrage „Standort verwenden?“ erscheint, bisher keine Standort-Abfrage`, /Standort verwenden\?/.test(await page.locator('.onboarding').textContent()) && calls0 === 0, `Abfragen=${calls0}`);
  await shot(page, `s5-${tag(kind)}-1-frage`);
  // „Nicht jetzt“
  await page.locator('.onboarding .btn:not(.btn-primary)').click(); await sleep(600);
  const calls1 = await page.evaluate(() => window.__geoCalls);
  rec(`S5 ${tag(kind)} „Nicht jetzt“: keine Standort-Abfrage, Suche/Karte Deutschland`, calls1 === 0 && (await page.locator('.onboarding').count()) === 0);
  await shot(page, `s5-${tag(kind)}-2-abgelehnt`);
  await page.reload(); await sleep(2500);
  rec(`S5 ${tag(kind)} Wahl gemerkt: keine erneute Frage nach Neuladen`, (await page.locator('.onboarding').count()) === 0);
  await ctx.close();
  // b) Zustimmung: Standort + sofort Umgebung
  ({ ctx, page } = await newPage(browser, kind, { geolocation: HEILBRONN }));
  await page.goto(`${base}/`); await page.waitForSelector('.onboarding', { timeout: 15000 });
  await ctx.grantPermissions(['geolocation']); // entspricht „Erlauben“ im Systemdialog nach dem Tippen
  await page.locator('.onboarding .btn-primary').click();
  await page.waitForURL(/suche\?nearby=1/, { timeout: 20000 }); await waitRows(page, 3, 25000);
  rec(`S5 ${tag(kind)} Zustimmung: Karte + Liste „In meiner Nähe“ (${await rows(page)} Einträge)`, (await rows(page)) >= 3);
  await shot(page, `s5-${tag(kind)}-3-naehe`);
  await page.reload(); await sleep(3000);
  rec(`S5 ${tag(kind)} bei erteilter Berechtigung: ohne Frage sofort Umgebung`, (await page.locator('.onboarding').count()) === 0 && /nearby=1/.test(page.url()));
  await ctx.close();
}

async function s6_bibliothek(browser, kind) {
  // Heilbronn mit Standort: „Bibliothek“ ohne Ort
  let { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/`); await sleep(3000);
  await page.goto(`${base}/suche?was=Bibliothek`); await sleep(500);
  await page.waitForFunction(() => document.querySelectorAll('.panel .row').length > 0 || document.querySelector('.panel .banner, .panel .empty'), null, { timeout: 30000 });
  const dists = await page.$$eval('.panel .row .row-dist', (els) => els.map((e) => e.textContent));
  const towns = await page.$$eval('.panel .row .row-addr', (els) => els.slice(0, 5).map((e) => e.textContent));
  const maxKm = Math.max(0, ...dists.map((d) => { const m = /([\d.,]+)\s?(km|m)/.exec(d.replace(/ /g, ' ')); return m ? parseFloat(m[1].replace(',', '.')) * (m[2] === 'm' ? 0.001 : 1) : 0; }));
  const panelTxt = await page.locator('.panel').textContent();
  rec(`S6 ${tag(kind)} Heilbronn: „Bibliothek“ ohne Ort liefert Treffer ≤ 25 km (${dists.length}, max ${maxKm} km) oder klare Meldung`, (dists.length > 0 && maxKm <= 26) || /Keine Treffer für/.test(panelTxt), `${towns.slice(0, 3).join(' | ')}`);
  rec(`S6 ${tag(kind)} Heilbronn: nicht in Greußen/Thüringen`, !/Greußen/.test(panelTxt));
  await shot(page, `s6-${tag(kind)}-1-heilbronn`);
  await ctx.close();
  // Ohne Standort, Deutschlandansicht: Frage nach Ort statt Sprung
  ({ ctx, page } = await newPage(browser, kind, {}));
  await page.goto(`${base}/suche?was=Bibliothek`); await sleep(500);
  await page.waitForSelector('.panel .banner, .panel .row', { timeout: 30000 });
  const t2 = await page.locator('.panel').textContent();
  rec(`S6 ${tag(kind)} ohne Standort/Ort: Frage „Wo soll gesucht werden?“, kein stiller Sprung`, /Wo soll gesucht werden/.test(t2) && (await rows(page)) === 0, t2.slice(0, 120));
  await shot(page, `s6-${tag(kind)}-2-ohne-ort`);
  await ctx.close();
  // Heilbronn: seltene Einrichtung (Verwaltungsgericht) nicht im Umkreis von 25 km -> Meldung + „Nächste anzeigen“, kein stiller Sprung
  ({ ctx, page } = await newPage(browser, kind, withGeo));
  await page.goto(`${base}/suche?was=Verwaltungsgericht`); await sleep(500);
  await page.waitForSelector('.panel .banner, .panel .row', { timeout: 60000 });
  const t3 = await page.locator('.panel').textContent();
  const hasNearest = await page.locator('.panel button', { hasText: /Nächste anzeigen/ }).count();
  const rowsNow = await rows(page);
  rec(`S6 ${tag(kind)} Heilbronn „Verwaltungsgericht“: „Keine Treffer … Umkreis von 25 km“ + „Nächste anzeigen (X km, Ort)“, keine Liste`, /Keine Treffer für „Verwaltungsgericht“ im Umkreis von 25 km um Ihren Standort/.test(t3) && hasNearest === 1 && rowsNow === 0, (await page.locator('.panel button', { hasText: /Nächste anzeigen/ }).textContent().catch(() => '')) + ' | ' + t3.slice(0, 160));
  await shot(page, `s6-${tag(kind)}-3-naechste`);
  if (hasNearest) {
    await page.locator('.panel button', { hasText: /Nächste anzeigen/ }).click(); await sleep(3000);
    rec(`S6 ${tag(kind)} „Nächste anzeigen“ zeigt den Treffer mit Entfernung`, (await rows(page)) > 0 && (await page.locator('.panel .row-dist').count()) > 0, (await page.locator('.panel .row').first().textContent())?.slice(0, 120));
    await shot(page, `s6-${tag(kind)}-4-naechste-treffer`);
  }
  await ctx.close();
}

async function s78_card(browser, kind) {
  const { ctx, page } = await newPage(browser, kind, withGeo);
  await page.goto(`${base}/suche?was=Bürgeramt&wo=Heilbronn`); await waitRows(page, 1);
  await page.locator('.panel .row .row-main').first().click(); await page.waitForSelector('.place h1');
  if (kind === 'm') await full(page);
  const txt = await page.locator('.place').innerText();
  const bad = ['Datenquelle', 'Quelle:', 'Stand der Daten', 'Zuletzt bearbeitet', 'Zuletzt geprüft', 'Lizenz', 'nicht einzeln geprüft', 'OSM-Objekt ansehen'].filter((w) => txt.includes(w));
  rec(`S7 ${tag(kind)} Block „Datenquelle“ ist von der Karte entfernt`, bad.length === 0, bad.join(','));
  await page.locator('.menu-wrap button').click();
  const items = await page.locator('.menu-list a').allTextContents();
  rec(`S7 ${tag(kind)} Menü „⋯“: Fehler melden + Datenquellen`, items.length === 2 && /Fehler melden/.test(items[0]) && /Datenquellen/.test(items[1]), items.join(' | '));
  await shot(page, `s7-${tag(kind)}-1-menue`);
  await page.keyboard.press('Escape');
  const sec = page.locator('.sec', { has: page.locator('h2', { hasText: 'Bewertungen' }) });
  const secTxt = (await sec.textContent()) ?? '';
  rec(`S8 ${tag(kind)} Bewertungen: nur Google-Maps-Knopf, kurze Zeile, kein Langtext`, (await sec.locator('a.btn').count()) === 1 && secTxt.length < 80 && !/prüft diese Bewertungen|speichert und zeigt/.test(secTxt), secTxt);
  rec(`S8 ${tag(kind)} Platz „rating-slot“ vorhanden und versteckt`, (await page.locator('.rating-slot[hidden]').count()) === 1);
  await page.locator('.panel-body').evaluate((el) => { el.scrollTop = 99999; });
  await shot(page, `s7-${tag(kind)}-2-karte-unten`);
  // Datenquellen-Seite bleibt, mit Routing-Diensten
  await page.goto(`${base}/datenquellen`); await page.waitForSelector('table');
  const src = await page.locator('table').textContent();
  rec(`S7 ${tag(kind)} Seite „Datenquellen“ nennt Routing-Dienste und Transitous`, /routing\.openstreetmap\.de/.test(src) && /Transitous/.test(src));
  // Attribution auf der Karte bleibt
  await page.goto(`${base}/`); await sleep(1500);
  rec(`S7 ${tag(kind)} Kartenattribution (OpenStreetMap contributors) sichtbar`, (await page.locator('.maplibregl-ctrl-attrib').count()) >= 1 && /OpenStreetMap contributors/.test((await page.locator('.maplibregl-ctrl-attrib').first().textContent()) ?? ''));
  await ctx.close();
}

const all = { s1: s1_back, s1m: s1_mapview, s2: s2_route, s2f: s2_route_fallback, s3: s3_sheet, s4: s4_filter, s5: s5_onboarding, s6: s6_bibliothek, s78: s78_card };
const browser = await launch();
const kinds = engine === 'webkit' ? ['m'] : ['m', 'd'];
for (const [id, fn] of Object.entries(all)) {
  if (only && !only.split(',').includes(id)) continue;
  for (const k of kinds) {
    try { await fn(browser, k); } catch (e) { rec(`${id} ${tag(k)} Ausnahme`, false, String(e).split('\n')[0].slice(0, 200)); }
  }
}
await browser.close();
const fail = results.filter((r) => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} bestanden`);
process.exit(fail.length ? 1 : 0);
