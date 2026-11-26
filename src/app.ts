import { GROUPS, isGastroSub } from '../shared/taxonomy.js';
import { setIndexForNotes } from './app-data';
import { A, S, emit, on, type SheetState } from './ctx';
import { MIN_ZOOM_FOR_DATA } from './config';
import { addressLine, cellCenter, cellsForBbox, distanceKm, gastroCellsForBbox, loadCells, loadIndex, loadMeta } from './data';
import { activeFilterCount, emptyFilters, matches, normalizeFilters, parseKat, RADIUS_OPTIONS, serializeKat, subsOfGroup, wantsGastro, type Filters } from './filters';
import { loadHours } from './hours';
import { fmtDate, getLang, has, onLangChange, t } from './i18n';
import type { Bounds, MapController as MapCtl } from './map'; // MapLibre wird erst in initApp per import('./map') nachgeladen (eigener Chunk)
import { fitDescription, fitTitle, pagePath, placePath } from '../shared/seo.js';
import { getRoute, goBack, href, navigate, onRoute, replaceQuery, setSnapProvider, startRouter, type Route, type Snap } from './router';
import { runSearch } from './search';
import { addHistory, getSettings, setSettings } from './storage';
import type { LatLng, Place } from './types';
import { banner, groupLabel } from './ui/components';
import { openDialog, closeTop, closeButton, hasDialog } from './ui/dialog';
import { h, replace } from './ui/dom';
import { icon } from './ui/icons';
import { debounce, prefersReducedMotion } from './util';
import { openFilterDialog } from './views/filter';
import { renderFavorites, renderHistory } from './views/favorites';
import { renderList } from './views/list';
import { renderEmergency, renderHelp, renderImprint, renderMore, renderNotFound, renderPrivacy, renderReport, renderSources } from './views/pages';
import { renderPlace } from './views/place';
import { renderRoute } from './views/route';
import { createSearchForm, type SearchForm } from './views/search-form';
import { renderSettings } from './views/settings';
import { slugify } from '../shared/taxonomy.js';

// ---------- Shell ----------
interface Refs { app: HTMLElement; panel: HTMLElement; body: HTMLElement; handle: HTMLButtonElement; chips: HTMLElement; mapEl: HTMLElement; tabs: HTMLElement; banners: HTMLElement; searchArea: HTMLButtonElement; inline: SearchForm }
let R!: Refs;
let overlayForm: SearchForm | null = null;

const isDesktop = (): boolean => window.matchMedia('(min-width: 768px)').matches;
const reduce = (): boolean => prefersReducedMotion() || getSettings().motion === 'on';

function logo(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', '28'); s.setAttribute('height', '28'); s.setAttribute('aria-hidden', 'true');
  const r = document.createElementNS(ns, 'rect'); r.setAttribute('width', '32'); r.setAttribute('height', '32'); r.setAttribute('rx', '8'); r.setAttribute('fill', 'var(--accent)');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M16 6 6 11v2h20v-2L16 6zM8 15h3v7H8zM14.500 15h3v7h-3zM21 15h3v7h-3zM6 24h20v2H6z'); p.setAttribute('fill', 'var(--on-accent)');
  s.append(r, p); return s;
}

function buildShell(): void {
  const shell = document.getElementById('shell')!;
  const inline = createSearchForm('inline', (w, o, n) => A.submitSearch(w, o, { nearby: n }));
  const topbar = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: href('/'), 'aria-label': t('nav.header.logo_alt') }, logo(), h('span', { class: 'brand-name' }, t('common.app.name'))),
    h('button', { class: 'searchpill', type: 'button', 'aria-label': t('map.search.aria'), onclick: () => A.openSearch() }, icon('search', { size: 22 }), h('span', null, t('map.search.placeholder'))),
    h('div', { class: 'inline-search' }, inline.el),
    h('button', { class: 'btn nearby-btn', type: 'button', onclick: () => A.nearby() }, icon('locate', { size: 20 }), h('span', null, t('nav.header.nearby'))),
    h('nav', { class: 'topnav', 'aria-label': t('nav.aria.main') },
      h('a', { class: 'btn btn-ghost', href: href('/favoriten') }, icon('heart', { size: 20 }), h('span', null, t('nav.header.favorites'))),
      h('a', { class: 'btn btn-ghost', href: href('/einstellungen'), 'aria-label': t('nav.header.language') }, icon('language', { size: 20 }), h('span', { class: 'lang-code' }, getLang().toUpperCase())),
      h('a', { class: 'btn btn-ghost', href: href('/mehr') }, icon('more', { size: 20 }), h('span', null, t('nav.tab.more')))),
    h('a', { class: 'icon-btn sos-btn', href: href('/notfall'), 'aria-label': t('map.emergency.aria') }, icon('emergency')));

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': t('map.chips.aria') });
  const mapEl = h('div', { id: 'map', class: 'map', 'aria-label': t('map.aria.map') });
  const ctl = h('div', { class: 'mapctl' },
    h('button', { class: 'map-btn', type: 'button', 'aria-label': t('map.control.locate'), onclick: () => { void A.locate({ pan: true }); } }, icon('locate')),
    h('button', { class: 'map-btn', type: 'button', 'aria-label': t('map.control.zoom_in'), onclick: () => S.map?.zoomBy(1) }, icon('plus')),
    h('button', { class: 'map-btn', type: 'button', 'aria-label': t('map.control.zoom_out'), onclick: () => S.map?.zoomBy(-1) }, icon('minus')));
  const searchArea = h('button', { class: 'btn search-area', type: 'button', hidden: true, onclick: () => { searchHere(); } }, t('map.control.search_area'));
  const handle = h('button', { class: 'sheet-handle', type: 'button', 'aria-label': t('map.sheet.handle_aria') }, h('span', { class: 'bar' }));
  const body = h('div', { class: 'panel-body', id: 'panel-content', tabindex: '-1' });
  const panel = h('aside', { class: 'panel', 'aria-label': t('list.title') }, handle, body);
  const tabItem = (id: string, path: string, ic: string, label: string): HTMLElement =>
    h('a', { class: 'tab', href: href(path), 'data-tab': id, onclick: () => { if (id === 'map') A.setSheet('peek'); else if (id === 'list') A.setSheet('half'); } }, icon(ic, { size: 26 }), h('span', null, label));
  const tabs = h('nav', { class: 'tabbar', 'aria-label': t('nav.aria.main') },
    tabItem('map', '/', 'map', t('nav.tab.map')), tabItem('list', '/suche', 'list', t('nav.tab.list')), tabItem('fav', '/favoriten', 'heart', t('nav.tab.favorites')), tabItem('more', '/mehr', 'more', t('nav.tab.more')));
  const banners = h('div', { class: 'banners' });
  const app = h('div', { class: 'app', 'data-sheet': 'peek' },
    h('a', { class: 'skip', href: '#panel-content', onclick: (e: Event) => { e.preventDefault(); body.focus(); } }, t('common.skip_link')),
    h('h1', { class: 'visually-hidden', id: 'app-h1' }, t('seo.home.h1')), // einzige H1 der Karten-/Listenansicht (andere Ansichten haben eigene H1)
    topbar, chips, mapEl, ctl, searchArea, banners, panel, tabs);
  replace(shell, app);
  // Rückfall für Browser ohne overflow: clip (iOS < 16): focus()/scrollIntoView() darf die App nie verschieben (dann wäre die Schublade nicht mehr erreichbar)
  const pin = (): void => { if (app.scrollTop || app.scrollLeft) { app.scrollTop = 0; app.scrollLeft = 0; } };
  app.addEventListener('scroll', pin, { passive: true });
  R = { app, panel, body, handle, chips, mapEl, tabs, banners, searchArea, inline };
  paintChips();
  initSheetDrag();
}

function paintChips(): void {
  const n = activeFilterCount(S.filters);
  replace(R.chips,
    h('button', { class: ['chip', 'chip-filter', n ? 'on' : ''], type: 'button', onclick: () => A.openFilter() }, icon('filter', { size: 18 }), n ? t('map.chips.filter_count', { count: n }) : t('map.chips.filter')),
    h('button', { class: 'chip chip-nearby', type: 'button', onclick: () => A.nearby() }, icon('locate', { size: 18 }), t('map.chips.nearby')),
    h('button', { class: ['chip', S.filters.subs.size ? '' : 'on'], type: 'button', 'aria-pressed': String(!S.filters.subs.size), onclick: () => A.setFilters({ ...S.filters, subs: new Set() }) }, t('filter.all')),
    GROUPS.map((g) => {
      const subs = subsOfGroup(g.slug); const sel = subs.filter((s) => S.filters.subs.has(s)).length;
      const b = h('button', { class: ['chip', sel ? 'on' : ''], type: 'button', 'aria-pressed': sel === subs.length ? 'true' : sel ? 'mixed' : 'false', onclick: () => A.toggleGroup(g.slug) },
        h('span', { class: 'dot' }), groupLabel(g.slug));
      (b.firstChild as HTMLElement).style.background = g.color;
      return b;
    }));
}

// ---------- Bottom Sheet ----------
function setSheet(s: SheetState): void {
  resetPanelInline(); // übrig gebliebene Inline-Transformation einer abgebrochenen Geste darf den Zustand nie festhalten
  S.sheet = s; R.app.dataset.sheet = s;
  R.handle.setAttribute('aria-expanded', String(s !== 'peek'));
  requestAnimationFrame(updateAttrOffset);
  A.announce(s === 'peek' ? t('a11y.sheet_collapsed') : s === 'full' ? t('a11y.sheet_expanded') : '');
}
function resetPanelInline(): void {
  if (!R?.panel) return;
  R.panel.style.transition = ''; R.panel.style.transform = ''; R.panel.classList.remove('dragging');
}
function updateAttrOffset(): void {
  if (isDesktop()) { R.app.style.setProperty('--attr-bottom', '0px'); return; }
  const r = R.panel.getBoundingClientRect();
  R.app.style.setProperty('--attr-bottom', `${Math.max(0, Math.round(window.innerHeight - r.top))}px`);
}
/** Unterer Rand (px), den die Schublade vom Kartenausschnitt verdeckt (aus dem Zustand berechnet, nicht aus einer laufenden Animation gemessen) */
function sheetPad(): number {
  if (isDesktop()) return 0;
  const vh = window.innerHeight;
  if (R.app.dataset.route && S.sheet !== 'full') return Math.round(vh * 0.58); // Route-Ansicht: Schublade + Tab-Leiste verdecken ≈ 55 %
  const visible = S.sheet === 'peek' ? 132 : vh * (S.sheet === 'half' ? 0.46 : 0.45);
  return Math.round(Math.min(visible + 12, vh * 0.45));
}

/** Schublade ziehen (Mobil). Ursachen des „Hängens“ auf iOS und was dagegen getan ist:
 *  1) Gezogen werden konnte nur an der 28 px hohen Griffleiste; in „peek“/„half“ ist der Inhalt nicht scrollbar, Wischen auf der Liste tat nichts.
 *     -> in „peek“ und „half“ ist die ganze Schublade die Ziehfläche (CSS touch-action: none), in „full“ der Griff.
 *  2) Der Zustand „dragging“ blieb stehen, wenn pointerup/-cancel nie ankam (Systemgeste, App-Wechsel, Fokusverlust), und das Inline-transform
 *     überschrieb danach alle Zustände. -> jede Geste endet über pointerup/-cancel/lostpointercapture/touchend/-cancel/blur/visibilitychange/Zeitwächter;
 *     setSheet() und jeder neue pointerdown räumen Reste auf.
 *  3) Pointer-Capture erst nach echter Bewegung, damit Tippen auf Zeilen/Links nicht verschluckt wird. */
function initSheetDrag(): void {
  const panel = R.panel;
  interface Drag { id: number; x0: number; y0: number; startT: number; maxT: number; moved: boolean; handle: boolean; lastY: number; lastT: number; vy: number }
  let d: Drag | null = null;
  let watchdog = 0;
  const ty = (): number => { try { return new DOMMatrix(getComputedStyle(panel).transform).m42; } catch { return 0; } };
  const snaps = (): Record<SheetState, number> => {
    const hgt = panel.getBoundingClientRect().height; const vh = window.innerHeight;
    // Translation je Zustand wie im CSS (--y): full 0, half = 100% - 46dvh, peek = 100% - 132px
    return { full: 0, half: Math.max(0, hgt - vh * 0.46), peek: Math.max(0, hgt - 132) };
  };
  const arm = (): void => { clearTimeout(watchdog); watchdog = window.setTimeout(() => finish(true), 2500); };
  function finish(cancelled: boolean): void {
    clearTimeout(watchdog);
    const cur = d; d = null;
    if (!cur) { if (panel.style.transform || panel.classList.contains('dragging')) resetPanelInline(); return; }
    try { if (panel.hasPointerCapture(cur.id)) panel.releasePointerCapture(cur.id); } catch { /* schon freigegeben */ }
    const pos = ty();
    resetPanelInline();
    const order: SheetState[] = ['peek', 'half', 'full'];
    if (!cur.moved) { if (cur.handle && !cancelled) A.setSheet(order[(order.indexOf(S.sheet) + 1) % 3]!); return; }
    if (cancelled) { A.setSheet(S.sheet); return; }
    // Ziel = nächster Rastpunkt der (mit der Wischgeschwindigkeit) fortgeschriebenen Position
    const sn = snaps(); const proj = pos + cur.vy * 140;
    let best: SheetState = S.sheet; let bd = Infinity;
    for (const k of order) { const dd = Math.abs(sn[k] - proj); if (dd < bd) { bd = dd; best = k; } }
    A.setSheet(best);
  }
  panel.addEventListener('pointerdown', (e) => {
    if (isDesktop() || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as Element;
    const onHandle = R.handle.contains(target);
    if (d) finish(true); else if (panel.style.transform) resetPanelInline();
    if (!onHandle && (S.sheet === 'full' || (S.sheet === 'half' && R.body.contains(target)) || target.closest('textarea,input,select'))) return; // in „full“ scrollt der Inhalt
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, startT: ty(), maxT: snaps().peek, moved: false, handle: onHandle, lastY: e.clientY, lastT: e.timeStamp, vy: 0 };
    arm();
  });
  panel.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0; const dx = e.clientX - d.x0;
    if (!d.moved) {
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return; // erst bei klar senkrechter Bewegung ziehen
      d.moved = true;
      try { panel.setPointerCapture(e.pointerId); } catch { /* Gerät erlaubt kein Capture: Dokument-Listener unten fangen das Ende ab */ }
      panel.classList.add('dragging'); panel.style.transition = 'none';
    }
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vy = 0.8 * d.vy + 0.2 * ((e.clientY - d.lastY) / dt) * 1; // px/ms, geglättet
    d.lastY = e.clientY; d.lastT = e.timeStamp;
    panel.style.transform = `translateY(${Math.max(0, Math.min(d.maxT, d.startT + dy))}px)`;
    if (e.cancelable) e.preventDefault();
    arm();
  });
  // „half“: Inhalt ist scrollbar; sobald gescrollt wird, Schublade auf „full“ fahren
  R.body.addEventListener('scroll', () => { if (!isDesktop() && S.sheet === 'half' && R.body.scrollTop > 6) A.setSheet('full'); }, { passive: true });
  // „half“: Wischen nach unten auf dem Inhalt (ganz oben) zieht die Schublade. iOS kennt touch-action „pan-up“ nicht, daher per Touch-Ereignissen
  // (touchmove nicht passiv: preventDefault verhindert das Scrollen, solange die Geste die Schublade zieht).
  {
    let tr: { x0: number; y0: number; startT: number; lastY: number; lastT: number; vy: number; drag: boolean } | null = null;
    R.body.addEventListener('touchstart', (e) => {
      if (isDesktop() || S.sheet === 'peek' || e.touches.length !== 1) { tr = null; return; }
      const tc = e.touches[0]!;
      tr = { x0: tc.clientX, y0: tc.clientY, startT: ty(), lastY: tc.clientY, lastT: e.timeStamp, vy: 0, drag: false };
    }, { passive: true });
    R.body.addEventListener('touchmove', (e) => {
      if (!tr || e.touches.length !== 1) return;
      const tc = e.touches[0]!; const dy = tc.clientY - tr.y0; const dx = tc.clientX - tr.x0;
      if (!tr.drag) {
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
        if (dy > 0 && R.body.scrollTop <= 0) { tr.drag = true; panel.classList.add('dragging'); panel.style.transition = 'none'; }
        else { tr = null; return; } // Scrollen des Inhalts
      }
      const dt = e.timeStamp - tr.lastT;
      if (dt > 0) tr.vy = 0.8 * tr.vy + 0.2 * ((tc.clientY - tr.lastY) / dt);
      tr.lastY = tc.clientY; tr.lastT = e.timeStamp;
      panel.style.transform = `translateY(${Math.max(0, Math.min(snaps().peek, tr.startT + dy))}px)`;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const endTouch = (cancelled: boolean): void => {
      const cur = tr; tr = null;
      if (!cur || !cur.drag) return;
      d = { id: -1, x0: cur.x0, y0: cur.y0, startT: cur.startT, maxT: snaps().peek, moved: true, handle: false, lastY: cur.lastY, lastT: cur.lastT, vy: cur.vy };
      finish(cancelled);
    };
    R.body.addEventListener('touchend', () => endTouch(false), { passive: true });
    R.body.addEventListener('touchcancel', () => endTouch(true), { passive: true });
  }
  panel.addEventListener('pointerup', () => finish(false));
  panel.addEventListener('pointercancel', () => finish(true));
  panel.addEventListener('lostpointercapture', () => { if (d?.moved) finish(false); });
  // Rückfallebene: Ende der Geste außerhalb der Schublade bzw. App im Hintergrund
  document.addEventListener('pointerup', () => { if (d) finish(false); }, true);
  document.addEventListener('pointercancel', () => { if (d) finish(true); }, true);
  document.addEventListener('touchend', () => { if (d) finish(false); }, { capture: true, passive: true });
  document.addEventListener('touchcancel', () => { if (d) finish(true); }, { capture: true, passive: true });
  window.addEventListener('blur', () => { if (d) finish(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && d) finish(true); });
  window.addEventListener('pagehide', () => { if (d) finish(true); });
  R.handle.addEventListener('keydown', (e) => {
    const order: SheetState[] = ['peek', 'half', 'full']; const i = order.indexOf(S.sheet);
    if (e.key === 'ArrowUp') { A.setSheet(order[Math.min(2, i + 1)]!); e.preventDefault(); }
    if (e.key === 'ArrowDown') { A.setSheet(order[Math.max(0, i - 1)]!); e.preventDefault(); }
  });
  // Tipp auf den Griff per Maus/Tastatur-Klick ohne Pointer-Ereignisse (z. B. Screenreader-Aktivierung)
  R.handle.addEventListener('click', (e) => { if (e.detail === 0) A.setSheet(['peek', 'half', 'full'][(['peek', 'half', 'full'].indexOf(S.sheet) + 1) % 3] as SheetState); });
}

// ---------- Toast / Live ----------
let toastTimer = 0;
function toast(text: string, o: { action?: { label: string; run: () => void }; ms?: number } = {}): void {
  const root = document.getElementById('toast-root')!;
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast' }, h('span', null, text), o.action ? h('button', { class: 'link-btn', type: 'button', onclick: () => { o.action!.run(); el.remove(); } }, o.action.label) : null);
  replace(root, el);
  toastTimer = window.setTimeout(() => el.remove(), o.ms ?? 5000);
}
function announce(text: string): void { const l = document.getElementById('live'); if (l && text) { l.textContent = ''; window.setTimeout(() => { l.textContent = text; }, 30); } }

// ---------- Theme ----------
function effectiveTheme(): 'light' | 'dark' {
  const s = getSettings().theme;
  return s === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s;
}
function applyTheme(): void {
  const s = getSettings();
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', s.theme);
  if (s.motion === 'on') root.setAttribute('data-motion', 'reduce'); else root.removeAttribute('data-motion');
  const eff = effectiveTheme();
  const bg = eff === 'dark' ? '#0f1117' : '#f4f6fb';
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { if (s.theme !== 'system') m.removeAttribute('media'); m.content = s.theme === 'system' ? m.content : bg; });
  S.map?.setTheme(eff); S.map?.setReduceMotion(reduce());
}

// ---------- Geolocation ----------
async function locate(o: { pan?: boolean; quiet?: boolean } = {}): Promise<LatLng | null> {
  if (!('geolocation' in navigator)) { S.geo = 'error'; toast(t('errors.geo.title') + ' ' + t('errors.geo.failed')); return null; }
  S.geo = 'loading';
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      S.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; S.geo = 'granted'; setSettings({ geo: 'yes' });
      S.map?.setUser(S.userLoc);
      if (o.pan !== false) S.map?.flyTo(S.userLoc, 14, sheetPad());
      if (pos.coords.accuracy > 1500) toast(t('errors.geo.inaccurate', { meters: Math.round(pos.coords.accuracy) }));
      emit('loc'); resolve(S.userLoc);
    }, (err) => {
      S.geo = err.code === 1 ? 'denied' : 'error';
      if (err.code === 1) { setSettings({ geo: 'no' }); if (!o.quiet) geoHelp(); } else if (!o.quiet) toast(t('errors.geo.failed'), { action: { label: t('common.action.retry'), run: () => { void locate(o); } } });
      emit('loc'); resolve(null);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
}
function geoHelp(): void {
  const el = h('div', { class: 'modal' }, h('div', { class: 'modal-card' },
    h('h2', null, t('errors.geo.help.title')), h('p', null, t('errors.geo.title') + ' ' + t('errors.geo.denied')),
    h('p', null, t('errors.geo.help.ios')), h('p', null, t('errors.geo.help.android')), h('p', null, t('errors.geo.help.browser')),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { closeTop(); A.openSearch('wo'); } }, t('errors.geo.alternative')), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => closeTop() }, t('common.action.close')))));
  openDialog(el, { label: t('errors.geo.help.title') });
}
async function nearby(): Promise<void> {
  const loc = S.userLoc ?? (await locate({ pan: false }));
  if (loc) navigate(`/suche?nearby=1${katQuery()}`);
}

// ---------- Filter / URL ----------
function filterQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.subs.size) p.set('kat', serializeKat(f.subs));
  if (f.withHours) p.set('hours', '1'); if (f.openNow) p.set('open', '1'); if (f.wheelchair) p.set('wc', '1');
  if (f.radius !== 'auto') p.set('r', String(f.radius));
  return p.toString();
}
/** „Alle ausgewählt“ = „Alle“ (leere Auswahl): in URL, Zähler, Karte und Liste einheitlich */
const normFilters = normalizeFilters;
const katQuery = (): string => { const q = filterQuery(S.filters); return q ? '&' + q : ''; };
function filtersFromQuery(q: URLSearchParams): Filters {
  const r = Number(q.get('r'));
  return normFilters({ subs: parseKat(q.get('kat')), withHours: q.get('hours') === '1', openNow: q.get('open') === '1', wheelchair: q.get('wc') === '1', radius: (RADIUS_OPTIONS as readonly number[]).includes(r) ? r : 'auto' });
}
function searchHref(): string {
  const p = new URLSearchParams();
  if (S.was) p.set('was', S.was); if (S.wo) p.set('wo', S.wo); if (S.nearby) p.set('nearby', '1');
  const f = new URLSearchParams(filterQuery(S.filters)); f.forEach((v, k) => p.set(k, v));
  const s = p.toString(); return '/suche' + (s ? '?' + s : '');
}
function setFilters(f0: Filters): void {
  const f = normFilters(f0);
  S.filters = f; paintChips(); emit('filters');
  const r = getRoute();
  if (r.name === 'map' || r.name === 'search') {
    const q = new URLSearchParams(r.q);
    for (const k of ['kat', 'hours', 'open', 'wc', 'r']) q.delete(k);
    new URLSearchParams(filterQuery(f)).forEach((v, k) => q.set(k, v));
    replaceQuery(r.path + (q.toString() ? '?' + q.toString() : ''));
    if (S.mode === 'results' && r.name === 'search') void doSearch(); else { void refreshBrowse(); renderPanel(); }
  } else { void refreshBrowse(); }
}
function toggleGroup(g: string): void {
  const subs = subsOfGroup(g); const all = subs.every((s) => S.filters.subs.has(s));
  const n = new Set(S.filters.subs); subs.forEach((s) => (all ? n.delete(s) : n.add(s)));
  setFilters({ ...S.filters, subs: n });
}
function toggleSub(s: string): void { const n = new Set(S.filters.subs); if (n.has(s)) n.delete(s); else n.add(s); setFilters({ ...S.filters, subs: n }); }

// ---------- Suche ----------
function submitSearch(was: string, wo: string, o: { nearby?: boolean } = {}): void {
  addHistory(was, o.nearby ? '' : wo);
  S.was = was; S.wo = o.nearby ? '' : wo; S.nearby = !!o.nearby;
  closeOverlayIfOpen();
  const p = new URLSearchParams();
  if (was) p.set('was', was); if (S.wo) p.set('wo', S.wo); if (o.nearby) p.set('nearby', '1');
  new URLSearchParams(filterQuery(S.filters)).forEach((v, k) => p.set(k, v));
  navigate('/suche?' + p.toString());
  if (!isDesktop()) A.setSheet('half');
}
function closeOverlayIfOpen(): void { while (hasDialog()) closeTop(); }
function openSearch(focus: 'was' | 'wo' = 'was'): void {
  if (isDesktop()) { R.inline.setValues(S.was, S.wo, S.nearby); R.inline.focus(focus); return; }
  const form = createSearchForm('overlay', (w, o, n) => A.submitSearch(w, o, { nearby: n }));
  overlayForm = form; form.setValues(S.was, S.wo, S.nearby);
  const el = h('div', { class: 'overlay search-overlay' }, h('div', { class: 'overlay-head' }, closeButton(() => closeTop(), t('search.close')), h('h2', null, t('search.title'))), h('div', { class: 'overlay-body' }, form.el));
  openDialog(el, { label: t('search.title'), initialFocus: null });
  requestAnimationFrame(() => form.focus(focus));
}

let searchSeq = 0;
/** Gespeicherter Zustand der Liste/Karte, der nach „Zurück“ wiederhergestellt wird (kommt aus dem History-Eintrag) */
let pending: Snap | null = null;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const resKey = (): string => JSON.stringify([S.was, S.wo, S.nearby, filterQuery(S.filters), S.nearby && S.userLoc ? [round3(S.userLoc.lat), round3(S.userLoc.lng)] : null]);
function fitResults(places: Place[]): void {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of places.slice(0, 120)) { w = Math.min(w, p.ln); e = Math.max(e, p.ln); s = Math.min(s, p.la); n = Math.max(n, p.la); }
  if (e - w < 0.002 && n - s < 0.002) S.map?.flyTo({ lat: s, lng: w }, 15, sheetPad()); else S.map?.fitBounds([w, s, e, n] as Bounds, sheetPad());
}
/** Gespeicherten Kartenausschnitt sofort setzen (Zurück aus Einrichtung/Route) */
function restoreView(snap: Snap | null): void {
  if (!snap?.view) return;
  if (!S.map) { viewToRestore = snap.view; return; }
  S.map.jumpTo({ lat: snap.view.lat, lng: snap.view.lng }, snap.view.zoom);
  const v = S.map.view(); S.mapView = { center: v.center, zoom: v.zoom, bounds: v.bounds };
}
let viewToRestore: Snap['view'] | null = null;
async function doSearch(o: { restore?: boolean } = {}): Promise<void> {
  const seq = ++searchSeq;
  const key = resKey();
  const snap = o.restore ? pending : null;
  S.mode = 'results';
  if (o.restore && S.resCache?.key === key) {
    // Zurück aus der Einrichtung: dieselbe Suche, gleiche Treffer, gleicher Ausschnitt, keine neue Berechnung
    S.res = S.resCache.res; S.resState = 'ok';
    S.map?.setData(S.res.items.map((i) => i.p));
    restoreView(snap);
    renderPanel(); emit('res');
    return;
  }
  S.resState = 'loading'; S.res = null; renderPanel(); emit('res');
  try {
    // „Was?“ ohne Ort braucht einen Bezugspunkt: ist der Standort freigegeben, aber noch nicht da, kurz darauf warten (statt zu raten)
    if (!S.wo && !S.nearby && !S.userLoc && S.geo !== 'denied') await Promise.race([geoReady, new Promise((r) => setTimeout(r, 6000))]);
    if (seq !== searchSeq) return;
    const out = await runSearch({ was: S.was, wo: S.wo, nearby: S.nearby, filters: S.filters, userLoc: S.userLoc, mapView: S.mapView ? { center: S.mapView.center, zoom: S.mapView.zoom } : null });
    if (seq !== searchSeq) return;
    S.res = out; S.resState = 'ok'; S.resCache = { key, res: out };
    const places = out.items.map((i) => i.p);
    S.map?.setData(places);
    if (snap?.view) restoreView(snap);
    else if (places.length) fitResults(places);
    else if (out.center && out.kind === 'ok' && out.label) S.map?.flyTo(out.center, 11, sheetPad());
    announce(t('a11y.results_updated', { count: out.total }));
  } catch { if (seq !== searchSeq) return; S.resState = 'error'; }
  renderPanel(); emit('res');
}
function searchHere(): void {
  R.searchArea.hidden = true;
  S.mode = 'browse'; S.res = null; S.was = ''; S.wo = ''; S.nearby = false;
  navigate('/' + (filterQuery(S.filters) ? '?' + filterQuery(S.filters) : ''), { replace: true });
}

// ---------- Browse: Objekte im Kartenausschnitt ----------
let browseSeq = 0;
async function refreshBrowse(): Promise<void> {
  if (S.mode === 'results' || !S.mapView) return;
  const seq = ++browseSeq;
  if (S.mapView.zoom < MIN_ZOOM_FOR_DATA) { S.browseState = 'zoom'; S.browse = []; S.map?.setData([]); renderBrowseOnly(); return; }
  S.browseState = 'loading';
  try {
    const idx = await loadIndex();
    const mc = { lat: (S.mapView.bounds[1] + S.mapView.bounds[3]) / 2, lng: (S.mapView.bounds[0] + S.mapView.bounds[2]) / 2 };
    // höchstens 12 Zellen, die zur Kartenmitte nächsten zuerst (bundesweit sind Ausschnitte bei Zoom 8 groß)
    const bb = S.mapView.bounds;
    const onlyGastro = S.filters.subs.size > 0 && [...S.filters.subs].every(isGastroSub);
    const all = [...(onlyGastro ? [] : cellsForBbox(idx, bb)), ...(wantsGastro(S.filters.subs) ? await gastroCellsForBbox(bb) : [])];
    const keys = all.map((k) => ({ k, d: distanceKm(mc, cellCenter(k.replace(/^g:/, ''))) })).sort((a, b) => a.d - b.d).slice(0, 12).map((x) => x.k);
    if (S.filters.openNow) await loadHours().catch(() => undefined);
    const r = await loadCells(keys);
    if (seq !== browseSeq) return;
    const now = new Date();
    const b = S.mapView.bounds;
    S.browse = r.places.filter((p) => p.ln >= b[0] && p.ln <= b[2] && p.la >= b[1] && p.la <= b[3] && matches(p, S.filters, now));
    S.browseState = r.failed && !r.places.length ? 'error' : S.browse.length ? 'ok' : 'empty';
    S.map?.setData(S.browse);
  } catch { if (seq !== browseSeq) return; S.browseState = 'error'; }
  renderBrowseOnly();
}
const renderBrowseOnly = debounce(() => { const r = getRoute(); if (r.name === 'map' || (r.name === 'search' && S.mode === 'browse')) renderPanel(); updatePeek(); }, 120);
function updatePeek(): void { /* Peek-Zeile ist Teil der Liste (erster Inhalt); nichts weiter */ }

// ---------- Panel-Rendering ----------
let currentPlace: Place | null = null;
function renderPanel(): void {
  const r = getRoute();
  const b = R.body;
  const top = b.scrollTop;
  switch (r.name) {
    case 'map': case 'search': {
      renderList(b);
      if (S.mode === 'browse' && !S.userLoc && S.geo !== 'denied') b.querySelector('.list-head')?.after(nearbyCta());
      break;
    }
    case 'place': void renderPlace(b, r.id!, cellHint(r.id, r.q.get('c')), onPlaceLoaded); return;
    case 'route': void renderRoute(b, r.id!, cellHint(r.id, r.q.get('c')), onPlaceLoaded); return;
    case 'report': void renderReport(b, r.id!, cellHint(r.id, r.q.get('c')), onPlaceLoaded); return;
    case 'favorites': renderFavorites(b); break;
    case 'history': renderHistory(b); break;
    case 'settings': renderSettings(b); break;
    case 'more': renderMore(b); break;
    case 'sources': renderSources(b); break;
    case 'help': renderHelp(b); break;
    case 'emergency': renderEmergency(b); break;
    case 'imprint': renderImprint(b); break;
    case 'privacy': renderPrivacy(b); break;
    default: renderNotFound(b);
  }
  b.scrollTop = r.name === 'map' || r.name === 'search' ? top : 0;
  if (pending && (r.name === 'map' || r.name === 'search')) {
    const ready = S.mode === 'results' ? S.resState === 'ok' || S.resState === 'error' : S.browseState === 'ok' || S.browseState === 'empty' || S.browseState === 'zoom' || S.browseState === 'error';
    if (ready) { b.scrollTop = pending.scroll; pending = null; }
  }
}
function nearbyCta(): HTMLElement {
  return h('div', { class: 'card nearby-cta' },
    h('p', { class: 'meta' }, t('map.sheet.locate_explain')),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => A.nearby() }, icon('locate'), h('span', null, t('map.sheet.locate_cta'))));
}
function onPlaceLoaded(p: Place | null): void {
  currentPlace = p;
  if (!p) { S.map?.setSelected(null); return; }
  S.map?.setSelected(p);
  setPlaceMeta(p);
  if (getRoute().name === 'place') syncLinks(placePath(p));
  if (getRoute().name === 'route') return; // die Route-Ansicht passt die Karte selbst auf die Strecke ein
  const z = Math.max(S.mapView?.zoom ?? 0, 15);
  S.map?.flyTo({ lat: p.la, lng: p.ln }, z, sheetPad());
  S.map?.setRoute(null, null);
}

// ---------- Titel/SEO ----------
function setMeta(name: string, content: string, attr = 'name'): void {
  let m = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!m) { m = document.createElement('meta'); m.setAttribute(attr, name); document.head.appendChild(m); }
  m.content = content;
}
function applyMeta(title: string, desc: string): void {
  document.title = title;
  setMeta('description', desc); setMeta('og:title', title, 'property'); setMeta('og:description', desc, 'property');
  setMeta('twitter:title', title); setMeta('twitter:description', desc);
  setMeta('og:locale', getLang() === 'de' ? 'de_DE' : 'en_US', 'property');
}
function setTitle(kind: string, p: Record<string, string> = {}): void {
  const title = fitTitle(t(`seo.${kind}.title`, p), has(`seo.${kind}.title_short`) ? t(`seo.${kind}.title_short`, p) : '');
  const desc = fitDescription(has(`seo.${kind}.description`) ? t(`seo.${kind}.description`, p) : t('seo.home.description'));
  applyMeta(title, desc);
}
/** Titel/Description einer Einrichtung (gleiche Vorlagen wie das Vorab-Rendering in scripts/prerender.mjs) */
function setPlaceMeta(p: Place): void {
  const city = p.a?.c ?? ''; const addr = addressLine(p);
  const fill = (date: string): void => {
    const params = { name: p.nm, city, subcategory: t(`categories.sub.${p.s}`), address: addr ?? '', date };
    const title = city ? fitTitle(t('seo.place.title', params), t('seo.place.title_short', params)) : fitTitle(`${p.nm} | ${t('common.app.name')}`, p.nm);
    const key = !city ? 'seo.place.description_nocity' : addr ? 'seo.place.description' : 'seo.place.description_noaddr';
    applyMeta(title, fitDescription(t(key, params)));
  };
  void loadMeta().then((m) => fill(fmtDate(m.stand))).catch(() => fill(''));
}
const SEO_KIND: Partial<Record<Route['name'], string>> = { map: 'home', search: 'home', sources: 'sources', help: 'help', emergency: 'emergency', imprint: 'imprint', privacy: 'privacy' };
// Impressum/Datenschutz sind Entwürfe mit Platzhaltern: nicht indexieren, bis sie final sind (shared/seo.js NOINDEX_STATIC beachten)
const NOINDEX = new Set(['search', 'route', 'report', 'favorites', 'history', 'settings', 'more', 'notfound', 'imprint', 'privacy']);
// Titel für Ansichten ohne SEO-Vorlage (Tab-Titel/Screenreader); nur wenn der Schlüssel existiert
const PLAIN_TITLE: Partial<Record<Route['name'], string>> = { favorites: 'nav.header.favorites', history: 'history.title', settings: 'nav.more.settings', more: 'nav.more.title' };
const CANONICAL_PATH: Partial<Record<Route['name'], string>> = { map: '/', sources: '/datenquellen', help: '/hilfe', emergency: '/notfall' };

/** canonical, hreflang und og:url der aktuellen Ansicht (Client-Seite; das Vorab-Rendering setzt sie für direkt aufgerufene Seiten). */
function syncLinks(path: string | null): void {
  document.head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang]').forEach((n) => n.remove());
  document.head.querySelector('meta[property="og:url"]')?.remove();
  if (!__SITE_ORIGIN__ || !path) return;
  const url = (l: string): string => __SITE_ORIGIN__ + pagePath(l, path, __TRAILING_SLASH__);
  const add = (rel: string, href: string, hreflang?: string): void => {
    const l = document.createElement('link'); l.rel = rel; l.href = href; if (hreflang) l.hreflang = hreflang; document.head.appendChild(l);
  };
  add('canonical', url(getLang()));
  for (const l of ['de', 'en']) add('alternate', url(l), l);
  add('alternate', url('de'), 'x-default');
  setMeta('og:url', url(getLang()), 'property');
}
function syncLinksFor(r: Route): void {
  if (r.name === 'place') return; // setzt onPlaceLoaded (kanonischer Pfad mit Namens-Slug)
  syncLinks(NOINDEX.has(r.name) ? null : CANONICAL_PATH[r.name] ?? null);
}
/** Zelle der vorab gerenderten Detailseite (<meta name="govfind:place" content="n123 24_203">): Deep-Link ohne ?c= */
const PRE_PLACE = (document.querySelector<HTMLMetaElement>('meta[name="govfind:place"]')?.content ?? '').split(' ');
const cellHint = (id: string | undefined, q: string | null): string | null => {
  if (q) return q;
  const [preId, preCell] = PRE_PLACE;
  return id && preId === id && preCell ? preCell : null;
};

/** Seiten ohne SEO-Titel (noindex): Titel aus Überschrift bzw. Suchbegriffen, damit Tab/Verlauf/Screenreader die Seite unterscheiden. */
function setPageTitle(r: Route): void {
  const key: Partial<Record<Route['name'], string>> = { notfound: 'errors.page.404.title' }; // Favoriten/Verlauf/Einstellungen/Mehr: PLAIN_TITLE (SEO)
  const k = key[r.name];
  if (k) { document.title = `${t(k)} | ${t('common.app.name')}`; return; }
  if (r.name === 'search') {
    const w = r.q.get('was'); const o = r.q.get('wo');
    const what = [w, r.q.get('nearby') === '1' ? t('nav.header.nearby') : o].filter(Boolean).join(' · ');
    if (what) document.title = `${what} | ${t('common.app.name')}`;
    else document.title = `${t('list.title')} | ${t('common.app.name')}`;
  }
}

// ---------- Routing ----------
function tabFor(r: Route): string {
  if (r.name === 'search') return 'list';
  if (r.name === 'favorites' || r.name === 'history') return 'fav';
  if (['more', 'settings', 'sources', 'help', 'emergency', 'imprint', 'privacy'].includes(r.name)) return 'more';
  return 'map';
}
let first = true;
function handleRoute(r: Route): void {
  const prevMode = S.mode;
  if (r.name !== 'map' && r.name !== 'search') pending = null;
  document.querySelectorAll('.tab').forEach((a) => { if ((a as HTMLElement).dataset.tab === tabFor(r)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  setMeta('robots', NOINDEX.has(r.name) ? 'noindex,follow' : 'index,follow');
  const kind = SEO_KIND[r.name]; if (kind) setTitle(kind);
  else if (PLAIN_TITLE[r.name] && has(PLAIN_TITLE[r.name]!)) applyMeta(`${t(PLAIN_TITLE[r.name]!)} | ${t('common.app.name')}`, t('seo.home.description'));
  syncLinksFor(r);
  syncH1(r);
  // JSON-LD aus dem Vorab-Rendering gehört nur zur zuerst geladenen Seite: bei App-Navigation entfernen (sonst falsche Daten)
  if (!first) document.head.querySelectorAll('script[data-prerender-ld]').forEach((n) => n.remove());
  if (r.name !== 'route') { S.map?.setRoute(null, null); document.querySelector('.route-top')?.remove(); R.app.removeAttribute('data-route'); }
  if (r.name !== 'place' && r.name !== 'route' && r.name !== 'report') S.map?.setSelected(null);
  if (r.name === 'map' || r.name === 'search') {
    S.filters = filtersFromQuery(r.q); paintChips();
    // Zurück/Vorwärts: Kartenausschnitt, Scrollposition und Schubladenstellung aus dem History-Eintrag wiederherstellen
    pending = r.state?.snap ?? null;
    if (pending) { restoreView(pending); if (S.mode === 'browse' || r.name === 'map') S.browseState = 'loading'; }
  }
  R.searchArea.hidden = true;
  R.app.dataset.view = r.name;
  switch (r.name) {
    case 'map':
      S.mode = 'browse'; S.res = null; S.was = ''; S.wo = ''; S.nearby = false; searchSeq++;
      if (!isDesktop()) setSheet(pending ? (pending.sheet as SheetState) : 'peek');
      renderPanel(); void refreshBrowse(); break;
    case 'search': {
      const was = r.q.get('was') ?? ''; const wo = r.q.get('wo') ?? ''; const nb = r.q.get('nearby') === '1';
      if (was || wo || nb) {
        S.was = was; S.wo = wo; S.nearby = nb;
        if (nb && !S.userLoc) { S.nearby = false; void locate({ pan: false }).then((l) => { if (l) { S.nearby = true; void doSearch(); } else { navigate('/', { replace: true }); } }); S.mode = 'results'; S.resState = 'loading'; renderPanel(); }
        else void doSearch({ restore: !!pending });
        if (!isDesktop()) { if (pending) setSheet(pending.sheet as SheetState); else if (S.sheet === 'peek') setSheet('half'); }
      } else {
        S.mode = 'browse'; S.res = null; S.was = ''; S.wo = ''; S.nearby = false; searchSeq++;
        if (!isDesktop()) setSheet(pending ? (pending.sheet as SheetState) : 'half');
        renderPanel(); void refreshBrowse();
      }
      break;
    }
    case 'place': case 'route': case 'report':
      // Route: „half“, damit die Linie auf der Karte sichtbar bleibt
      if (!isDesktop()) setSheet(r.name === 'report' ? 'full' : 'half'); renderPanel(); void refreshBrowseKeep(); break;
    default:
      if (!isDesktop()) setSheet('full'); renderPanel();
  }
  void prevMode;
  setPageTitle(r);
  if (!first && !['map', 'search'].includes(r.name)) requestAnimationFrame(() => { const hd = R.body.querySelector<HTMLElement>('h1,h2'); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); } });
  first = false;
}
async function refreshBrowseKeep(): Promise<void> { if (S.mode === 'browse') await refreshBrowse(); }
/** Versteckte H1 nur in Karten-/Listenansicht (alle anderen Ansichten bringen ihre eigene H1 mit) */
function syncH1(r: Route): void { const el = document.getElementById('app-h1'); if (el) el.hidden = !(r.name === 'map' || r.name === 'search'); }

// ---------- Banner (offline, update, veraltet) ----------
function paintBanners(): void {
  const items: HTMLElement[] = [];
  if (!S.online) items.push(banner('info', t('errors.offline.banner_no_date')));
  if (updateReady) items.push(banner('info', t('pwa.update.available'), null, [h('button', { class: 'btn', type: 'button', onclick: () => { updateReady?.(); } }, t('pwa.update.action'))]));
  if (staleDate) items.push(banner('warn', t('errors.stale.banner', { date: staleDate })));
  replace(R.banners, items);
}
let updateReady: (() => void) | null = null;
let staleDate: string | null = null;
export function notifyUpdate(apply: () => void): void { updateReady = apply; if (R) paintBanners(); }

/** Zustand nachtragen, der entstand, bevor der Karten-Chunk geladen war (Treffer, Standort, gewählte Einrichtung) */
function syncMapState(m: MapCtl): void {
  if (S.userLoc) m.setUser(S.userLoc);
  const list = S.mode === 'results' && S.res ? S.res.items.map((i) => i.p) : S.browse;
  if (list.length) m.setData(list);
  const r = getRoute();
  if (currentPlace && (r.name === 'place' || r.name === 'route' || r.name === 'report')) {
    m.setSelected(currentPlace); m.flyTo({ lat: currentPlace.la, lng: currentPlace.ln }, 15, sheetPad());
  } else if (S.mode === 'results' && list.length) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of list.slice(0, 120)) { w = Math.min(w, p.ln); e = Math.max(e, p.ln); s = Math.min(s, p.la); n = Math.max(n, p.la); }
    if (e - w < 0.002 && n - s < 0.002) m.flyTo({ lat: s, lng: w }, 15, sheetPad()); else m.fitBounds([w, s, e, n] as Bounds, sheetPad());
  }
}

// ---------- Init ----------
export async function initApp(): Promise<void> {
  Object.assign(A, { openSearch, closeOverlay: closeOverlayIfOpen, submitSearch, nearby: () => { void nearby(); }, locate, openFilter: () => openFilterDialog(), toggleSub, toggleGroup, setFilters, setSheet, toast, announce, refreshAll, retry: () => { if (S.mode === 'results' && getRoute().name === 'search') void doSearch(); else void refreshBrowse(); }, searchHref, applyTheme,
    back: (fallback: string) => goBack(fallback), fitCoords: (coords: [number, number][]) => { S.map?.fitCoords(coords, sheetPad()); } });
  // Beim Verlassen von Liste/Karte (z. B. Einrichtung öffnen) Ausschnitt, Scrollposition und Schublade im History-Eintrag merken
  setSnapProvider(() => {
    const rn = getRoute().name;
    if (rn !== 'map' && rn !== 'search') return null;
    const v = S.mapView;
    return { ...(v ? { view: { lat: v.center.lat, lng: v.center.lng, zoom: v.zoom } } : {}), scroll: R.body.scrollTop, sheet: S.sheet };
  });
  buildShell();
  const debouncedBrowse = debounce(() => { void refreshBrowse(); }, 250);
  // MapLibre (~344 KB gzip) kommt in einen eigenen Chunk und wird erst nach dem Aufbau der Shell geladen: Shell, Liste und
  // Vorab-Text blockieren nicht auf die Karte. Bis dahin ist S.map null (alle Zugriffe sind optional: S.map?.…).
  void import('./map').then(({ MapController }) => {
    const m = new MapController(document.getElementById('map') ?? R.mapEl, effectiveTheme(), reduce(), {
      onSelect: (id, cell) => {
        const known = S.res?.items.find((i) => i.p.id === id)?.p ?? S.browse.find((p) => p.id === id);
        navigate(`/einrichtung/${id}${known ? '-' + slugify(known.nm) : ''}?c=${cell}`);
      },
      onMoved: ({ center, zoom, bounds, user }) => {
        S.mapView = { center, zoom, bounds };
        const r = getRoute();
        if (S.mode === 'results' && user && (r.name === 'search' || r.name === 'map') && zoom >= MIN_ZOOM_FOR_DATA) R.searchArea.hidden = false;
        if (S.mode === 'browse') debouncedBrowse();
      },
      onError: () => { if (S.mapOk) { S.mapOk = false; toast(t('errors.tiles.unavailable'), { ms: 7000 }); } },
    });
    S.map = m;
    applyTheme();
    syncMapState(m);
    void m.ready.then(() => {
      if (viewToRestore) { m.jumpTo({ lat: viewToRestore.lat, lng: viewToRestore.lng }, viewToRestore.zoom); viewToRestore = null; }
      const v = m.view(); S.mapView = { center: v.center, zoom: v.zoom, bounds: v.bounds }; void refreshBrowse();
    });
  }).catch(() => { S.mapOk = false; toast(t('errors.tiles.unavailable'), { ms: 7000 }); });
  applyTheme();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (getSettings().theme === 'system') applyTheme(); });
  window.addEventListener('online', () => { S.online = true; paintBanners(); announce(t('errors.offline.back_online')); });
  window.addEventListener('offline', () => { S.online = false; paintBanners(); });
  window.addEventListener('resize', debounce(() => { updateAttrOffset(); S.map?.resize(); }, 120));
  R.panel.addEventListener('transitionend', updateAttrOffset);
  on('filters', paintChips);
  onLangChange(() => { /* Neuaufbau über refreshAll */ });
  paintBanners();

  try {
    const idx = await loadIndex(); setIndexForNotes(idx);
    void loadMeta().then((m) => { const age = (Date.now() - new Date(m.built_at).getTime()) / 864e5; if (age > 45) { staleDate = new Date(m.built_at).toLocaleDateString(getLang()); paintBanners(); } }).catch(() => undefined);
  } catch { toast(t('search.error.index_failed'), { action: { label: t('common.action.retry'), run: () => location.reload() } }); }

  // Standort-Freigabe früh klären (Abfrage ohne Dialog): „Was?“ ohne Ort wartet kurz darauf, statt in Deutschland zu raten
  const permP = queryGeoPermission();
  geoReady = permP.then(async (perm) => {
    if (perm === 'granted') { S.geo = 'granted'; await locate({ pan: false, quiet: true }); }
    else if (perm === 'denied') S.geo = 'denied'; else S.geo = 'prompt';
  });
  onRoute(handleRoute);
  startRouter();
  const pre = getRoute().langPrefix;
  if (getLang() !== 'de' && !pre) { const r = getRoute(); replaceQuery(r.path + (r.q.toString() ? '?' + r.q.toString() : '')); }
  // Erster Start: erst die eigene Frage „Standort verwenden?“, die Systemabfrage folgt erst nach dem Tippen auf „Standort verwenden“.
  // Ist der Standort schon freigegeben, wird er ohne Frage genutzt und die Umgebung sofort gezeigt.
  const perm = await permP; await geoReady;
  const onMap = (): boolean => getRoute().name === 'map' && !hasDialog();
  if (perm === 'granted') {
    if (S.userLoc && getRoute().name === 'map') { S.map?.flyTo(S.userLoc, 14, sheetPad()); navigate(`/suche?nearby=1${katQuery()}`, { replace: true }); }
  } else if (perm === 'denied') { if (getSettings().geo !== 'no') setSettings({ geo: 'no' }); }
  else if (getSettings().geo !== 'no' && onMap()) offerLocation();
}
let geoReady: Promise<void> = Promise.resolve();
async function queryGeoPermission(): Promise<PermissionState | undefined> {
  try { return (await Promise.race([navigator.permissions?.query({ name: 'geolocation' as PermissionName }), new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]))?.state; } catch { return undefined; }
}

/** Eigener Hinweis vor der Systemabfrage. Ohne Tippen auf „Standort verwenden“ wird nie nach dem Standort gefragt. */
function offerLocation(): void {
  const done = (): void => closeTop();
  const el = h('div', { class: 'modal onboarding' }, h('div', { class: 'modal-card' },
    h('div', { class: 'ob-icon', 'aria-hidden': 'true' }, icon('locate', { size: 32 })),
    h('h2', null, t('onboarding.geo.title')),
    h('p', null, t('onboarding.geo.body')),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => {
        done(); setSettings({ geo: 'yes' });
        const l = await locate({ pan: true, quiet: true });
        if (l) navigate(`/suche?nearby=1${katQuery()}`);
        else { toast(t('onboarding.geo.denied'), { ms: 7000 }); openSearch('wo'); }
      } }, icon('locate'), h('span', null, t('onboarding.geo.yes'))),
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => { done(); setSettings({ geo: 'no' }); openSearch('wo'); } }, t('onboarding.geo.no')))));
  openDialog(el, { label: t('onboarding.geo.title') });
}

function refreshAll(): void {
  // Sprache/Einheiten geändert: Shell neu aufbauen (Karte bleibt erhalten)
  const map = S.map; const mapEl = R.mapEl;
  buildShell();
  R.mapEl.replaceWith(mapEl);
  S.map = map; map?.resize();
  paintBanners(); handleRouteAgain();
}
function handleRouteAgain(): void {
  const r = getRoute();
  document.querySelectorAll('.tab').forEach((a) => { if ((a as HTMLElement).dataset.tab === tabFor(r)) a.setAttribute('aria-current', 'page'); });
  R.app.dataset.view = r.name; R.app.dataset.sheet = S.sheet;
  const kind = SEO_KIND[r.name]; if (kind) setTitle(kind);
  syncLinksFor(r); syncH1(r); document.documentElement.lang = getLang();
  if (currentPlace && r.name === 'place') { setPlaceMeta(currentPlace); syncLinks(placePath(currentPlace)); }
  if (S.resState === 'loading' && (r.name === 'search')) { void doSearch(); return; }
  renderPanel();
}
void slugify;
