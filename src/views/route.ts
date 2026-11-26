import { A, S, on } from '../ctx';
import { distanceKm, findPlace } from '../data';
import { getLang, t } from '../i18n';
import { ROUTE_PROVIDERS } from '../provider';
import { cachedRoute, fetchRoute, RouteError, routeEnabled, stepKey, type AnyRoute, type Coord, type Itinerary, type RoadRoute, type TransitRoute, type TravelMode } from '../routing';
import { getRoute } from '../router';
import type { LatLng, Place } from '../types';
import { backButton, banner, distanceText, skeletonRows } from '../ui/components';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { appleDir, geoUri, googleDir, isAndroid, isApple } from '../util';

const MODES: TravelMode[] = ['walk', 'car', 'transit'];
const savedMode = (): TravelMode => { try { const v = localStorage.getItem('gf.routemode'); return v === 'car' || v === 'transit' ? v : 'walk'; } catch { return 'walk'; } };
let mode: TravelMode = savedMode();

/** „Route“ wurde auf der Karte der Einrichtung getippt: nur dann rechnet die Route-Ansicht sofort (eine Anfrage an den Dienst).
 *  Beim Neuladen, Zurück/Vorwärts oder über einen Link bleibt es bei einer Schaltfläche „Route berechnen“ (keine Anfrage ohne Aktion). */
let armedFor: string | null = null;
export const armRoute = (id: string): void => { armedFor = id; setTimeout(() => { if (armedFor === id) armedFor = null; }, 4000); }; // verfällt, falls der Link in neuem Tab geöffnet wurde

export const fmtDuration = (s: number): string => {
  const min = Math.max(1, Math.round(s / 60));
  return min >= 60 ? t('route.dur.hm', { h: Math.floor(min / 60), m: min % 60 }) : t('route.dur.min', { m: min });
};
const fmtTime = (iso: string): string => new Intl.DateTimeFormat(getLang(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(iso));
/** "Text {tag} Text" -> [Text, Knoten, Text] */
function withNode(msg: string, tag: string, node: Node): Node[] {
  const parts = msg.split(`{${tag}}`);
  return parts.length === 2 ? [document.createTextNode(parts[0]!), node, document.createTextNode(parts[1]!)] : [document.createTextNode(msg)];
}
const ext = (href: string, label: string): HTMLAnchorElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);

export async function renderRoute(host: HTMLElement, id: string, hint: string | null, onLoaded: (p: Place | null) => void): Promise<void> {
  replace(host, h('div', { class: 'place' }, skeletonRows(3)));
  let p: Place | null = null;
  try { p = await findPlace(id, hint); } catch { p = null; }
  if (getRoute().name !== 'route' || getRoute().id !== id) return;
  onLoaded(p);
  const back = (): void => A.back(`/einrichtung/${id}${hint ? '?c=' + hint : ''}`);
  const head = (): HTMLElement => h('div', { class: 'page-head' }, backButton(back), h('h1', null, t('route.title')));
  if (!p) { replace(host, h('div', { class: 'place' }, head(), banner('warn', t('place.removed.title')))); return; }
  const place = p;
  const dest: LatLng = { lat: place.la, lng: place.ln };
  const armed = armedFor === id; armedFor = null;

  if (!routeEnabled(mode)) mode = MODES.find(routeEnabled) ?? 'walk';
  let result: AnyRoute | null = null;
  let error: RouteError | null = null;
  let loading = false;
  let started = armed;
  let selected = 0;
  let seq = 0;
  let showSteps = false;
  const times: Partial<Record<TravelMode, number>> = {};
  const here = (): boolean => getRoute().name === 'route' && getRoute().id === id;
  const body = h('div', { class: 'route' });
  // Kopfkarte über der Karte (Von / Nach) wie in gängigen Karten-Apps; wird beim Verlassen der Route-Ansicht in app.ts entfernt
  document.querySelector('.route-top')?.remove();
  const appEl = document.querySelector<HTMLElement>('.app');
  const topCard = h('div', { class: 'route-top' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.action.back'), onclick: back }, icon('back', { size: 22 })),
    h('div', { class: 'rt-lines' },
      h('div', { class: 'rt-row from' }, h('span', { class: 'rt-dot' }), h('span', { class: 'rt-from' }, '–')),
      h('div', { class: 'rt-row' }, icon('pin', { size: 18 }), h('span', { lang: 'de' }, place.nm))));
  if (appEl) { appEl.dataset.route = '1'; appEl.append(topCard); }
  const paintTop = (): void => { const f = topCard.querySelector('.rt-from'); if (f) f.textContent = S.userLoc ? t('route.from_my_location') : '–'; };
  paintTop();

  // ---- Karte ----
  const draw = (): void => {
    const user = S.userLoc;
    const m = S.map;
    if (!m) return;
    if (result?.kind === 'road') { m.setRouteLines([{ coords: result.coords, kind: 'road' }]); A.fitCoords(result.coords); return; }
    if (result?.kind === 'transit') {
      const it = result.itineraries[selected];
      if (it) {
        const lines = it.legs.filter((l) => l.coords.length > 1).map((l) => ({ coords: l.coords, kind: l.walk ? 'walk' as const : 'transit' as const, ...(l.color && !l.walk ? { color: l.color } : {}) }));
        m.setRouteLines(lines);
        const all = it.legs.flatMap((l) => l.coords);
        if (all.length) A.fitCoords(all);
        return;
      }
    }
    // noch keine berechnete Route: Luftlinie (auf dem Gerät berechnet)
    m.setRoute(user, user ? dest : null);
    if (user) A.fitCoords([[user.lng, user.lat], [dest.lng, dest.lat]]);
  };

  // ---- Berechnen ----
  const load = async (cursor?: string): Promise<void> => {
    const user = S.userLoc;
    if (!user) return;
    const my = ++seq;
    started = true; loading = true; error = null; paint();
    try {
      const r = await fetchRoute(mode, user, dest, { lang: getLang(), ...(cursor ? { cursor } : {}) });
      if (my !== seq || !here()) return;
      result = r; selected = 0; showSteps = false;
      times[mode] = r.kind === 'road' ? r.durationS : r.itineraries[0]?.durationS ?? NaN;
      if (!cursor) void prefetchOthers(user);
    } catch (e) {
      if (my !== seq || !here()) return;
      error = e instanceof RouteError ? e : new RouteError('network');
      result = null;
    }
    loading = false; paint(); draw();
  };
  // Dauer der übrigen Verkehrsmittel nacheinander im Hintergrund holen (Anzeige in den Reitern); Fehler bleiben still
  const prefetchOthers = async (user: LatLng): Promise<void> => {
    for (const m of MODES) {
      if (m === mode || !routeEnabled(m) || times[m] !== undefined) continue;
      try {
        const r = await fetchRoute(m, user, dest, { lang: getLang() });
        times[m] = r.kind === 'road' ? r.durationS : r.itineraries[0]?.durationS ?? NaN;
        if (here()) paint();
      } catch { /* Reiter zeigt dann nur den Namen */ }
      if (!here()) return;
    }
  };
  const useCacheOrIdle = (): void => {
    const user = S.userLoc;
    const hit = user ? cachedRoute(mode, user, dest) : null;
    if (hit) { result = hit; started = true; selected = 0; times[mode] = hit.kind === 'road' ? hit.durationS : hit.itineraries[0]?.durationS ?? NaN; }
  };

  // ---- Darstellung ----
  const external = (primary: boolean): HTMLElement => {
    const links: HTMLElement[] = [
      h('a', { class: ['btn', 'btn-block', primary ? 'btn-primary' : ''], href: googleDir(place, mode), target: '_blank', rel: 'noopener noreferrer' }, icon('navigate'), h('span', null, t('route.open_google')), icon('external', { size: 16 })),
    ];
    if (isApple()) links.push(h('a', { class: 'btn btn-block', href: appleDir(place, mode), target: '_blank', rel: 'noopener noreferrer' }, icon('map'), h('span', null, t('route.open_apple')), icon('external', { size: 16 })));
    if (isAndroid()) links.push(h('a', { class: 'btn btn-block', href: geoUri(place) }, icon('map'), h('span', null, t('route.open_other'))));
    return h('div', { class: 'stack' }, links, h('p', { class: 'meta' }, t('route.external_notice')));
  };
  const beeline = (): HTMLElement | null => S.userLoc ? h('p', { class: 'beeline' }, t('route.beeline', { distance: distanceText(distanceKm(S.userLoc, dest)) })) : null;

  const roadView = (r: RoadRoute): HTMLElement => {
    const steps = r.steps.filter((s, i) => s.distanceM > 0 || s.type === 'arrive' || i === 0);
    const arrive = fmtTime(new Date(Date.now() + r.durationS * 1000).toISOString());
    return h('div', null,
      h('p', { class: 'route-sum' }, h('strong', null, fmtDuration(r.durationS))),
      h('p', { class: 'route-sub2' }, t('route.arrival', { time: arrive }), ' · ', distanceText(r.distanceM / 1000)),
      steps.length ? h('button', { class: 'btn btn-primary btn-block', type: 'button', 'aria-expanded': String(showSteps),
        onclick: () => { showSteps = !showSteps; if (showSteps) A.setSheet('full'); paint(); } },
        icon('navigate'), h('span', null, showSteps ? t('route.steps.hide') : t('route.start'))) : null,
      showSteps ? h('ol', { class: 'step-list' }, steps.map((s) => {
        const k = stepKey(s);
        const text = t(k.key, k.params) + (k.onto && s.name ? ' ' + t('route.step.onto', { street: s.name }) : '');
        return h('li', null, h('span', { class: 'step-text' }, text), s.distanceM >= 10 ? h('span', { class: 'meta step-dist' }, distanceText(s.distanceM / 1000)) : null);
      })) : null,
      null);
  };

  const lineChip = (l: Itinerary['legs'][number]): HTMLElement => {
    const el = h('span', { class: 'line-chip' }, icon(l.mode === 'BUS' || l.mode === 'COACH' ? 'bus' : 'train', { size: 14 }), h('span', null, l.line ?? l.mode));
    if (l.chipBg) { el.style.background = l.chipBg; el.style.color = l.chipFg ?? '#fff'; el.style.borderColor = 'transparent'; }
    return el;
  };
  const itinView = (it: Itinerary, i: number): HTMLElement => {
    const sel = i === selected;
    const transitLegs = it.legs.filter((l) => !l.walk);
    const card = h('div', { class: ['itin', sel ? 'sel' : ''] });
    const top = h('button', { class: 'itin-top', type: 'button', 'aria-pressed': String(sel),
      'aria-label': t('route.transit.select_aria', { n: i + 1, from: fmtTime(it.start), to: fmtTime(it.end), dur: fmtDuration(it.durationS) }),
      onclick: () => { selected = i; paint(); draw(); } },
      h('span', { class: 'itin-times' }, `${fmtTime(it.start)} – ${fmtTime(it.end)}`),
      h('span', { class: 'itin-dur' }, fmtDuration(it.durationS), ' · ', t('route.transit.transfers', { count: it.transfers })),
      h('span', { class: 'itin-lines' }, transitLegs.length ? transitLegs.map(lineChip) : h('span', { class: 'meta' }, t('route.transit.walk', { dur: fmtDuration(it.durationS) }))));
    card.append(top);
    if (sel) {
      card.append(h('ol', { class: 'legs' }, it.legs.map((l) => l.walk
        ? h('li', { class: 'leg leg-walk' }, icon('walk', { size: 16 }), h('span', null, t('route.transit.walk', { dur: fmtDuration(l.durationS) }) + (l.distanceM ? ` (${distanceText(l.distanceM / 1000)})` : '')))
        : h('li', { class: 'leg' }, lineChip(l),
          h('span', { class: 'leg-text' },
            h('strong', null, `${fmtTime(l.fromTime)} ${l.from}`), l.track ? ` · ${t('route.transit.platform', { track: l.track })}` : '',
            l.headsign ? h('span', { class: 'meta block' }, t('route.transit.direction', { to: l.headsign })) : null,
            h('span', { class: 'block' }, `${fmtTime(l.toTime)} ${l.to}`),
            l.realtime ? h('span', { class: 'meta block' }, t('route.transit.realtime')) : null)))));
    }
    return card;
  };
  const transitView = (r: TransitRoute): HTMLElement => {
    const src = ext(ROUTE_PROVIDERS.transit.sourcesUrl, t('route.transit.sources'));
    if (!r.itineraries.length) return h('div', null, banner('info', t('route.transit.none')), r.later ? h('button', { class: 'btn btn-block', type: 'button', onclick: () => { void load(r.later); } }, t('route.transit.later')) : null);
    return h('div', null,
      h('h2', { class: 'route-sub' }, t('route.transit.title')),
      r.earlier ? h('button', { class: 'btn btn-block', type: 'button', onclick: () => { void load(r.earlier); } }, t('route.transit.earlier')) : null,
      h('div', { class: 'itins' }, r.itineraries.map(itinView)),
      r.later ? h('button', { class: 'btn btn-block', type: 'button', onclick: () => { void load(r.later); } }, t('route.transit.later')) : null,
      h('p', { class: 'meta' }, t('route.result_service', { service: r.provider }).replace(/ Ohne Verkehrslage\.| Without traffic conditions\./, '')),
      h('p', { class: 'meta' }, ...withNode(t('route.transit.data', { link: '{link}' }), 'link', src)));
  };

  function paint(): void {
    const user = S.userLoc; paintTop();
    const svc = ROUTE_PROVIDERS[mode === 'transit' ? 'transit' : mode];
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('route.mode.label') },
      MODES.filter(routeEnabled).map((m) => h('button', { class: 'seg', type: 'button', role: 'radio', 'aria-checked': String(m === mode), 'aria-label': t(`route.mode.${m}`),
        onclick: () => {
          if (m === mode) return;
          mode = m; try { localStorage.setItem('gf.routemode', m); } catch { /* ignore */ }
          seq++; result = null; error = null; loading = false; started = false; selected = 0; useCacheOrIdle();
          // Wechsel des Verkehrsmittels = Aktion der Nutzenden: sofort berechnen
          if (S.userLoc && !result) void load(); else { paint(); draw(); }
        } },
        icon(m === 'walk' ? 'walk' : m === 'car' ? 'car' : 'bus', { size: 20 }), h('span', null, times[m] !== undefined && Number.isFinite(times[m]) ? fmtDuration(times[m]!) : t(`route.mode.${m}`)))));
    let main: Node | null;
    if (!routeEnabled(mode)) main = h('div', null, banner('info', t('route.err.disabled')), beeline(), external(true));
    else if (!user && S.geo === 'loading') main = h('div', null, h('p', { role: 'status', class: 'meta' }, t('route.locating')), skeletonRows(2));
    else if (!user) main = h('div', null, h('p', { class: 'meta' }, t('route.no_location')),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { void A.locate({ pan: false }).then((l) => { if (l) { useCacheOrIdle(); if (!result) void load(); else { paint(); draw(); } } else paint(); }); } }, icon('locate'), h('span', null, t('map.control.locate'))),
      external(false));
    else if (loading) main = h('div', null, h('p', { class: 'visually-hidden', role: 'status' }, t('route.calculating')), skeletonRows(3), beeline());
    else if (error) {
      main = h('div', null, banner('warn', t(`route.err.${error.kind}`), null, error.kind === 'disabled' ? [] : [h('button', { class: 'btn', type: 'button', onclick: () => { void load(); } }, t('common.action.retry'))]),
        h('h2', { class: 'route-sub' }, t('route.fallback.title')), h('p', { class: 'beeline' }, t('route.beeline', { distance: distanceText(distanceKm(user, dest)) })), h('p', { class: 'meta' }, t('route.beeline_note')), external(true));
    } else if (!started) {
      main = h('div', null, beeline(),
        h('div', { class: 'card' }, h('p', { class: 'meta' }, t('route.send_notice', { service: svc.name })),
          h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { void load(); } }, icon('route'), h('span', null, t('route.calculate')))),
        external(false));
    } else if (result?.kind === 'road') main = h('div', null, roadView(result), h('p', { class: 'meta' }, t('route.computed_by', { service: svc.name })), external(false));
    else if (result?.kind === 'transit') main = h('div', null, transitView(result), external(false));
    else main = external(false);

    const road = mode !== 'transit' && result?.kind === 'road';
    replace(body,
      seg, main,
      road ? h('p', { class: 'meta' }, ...withNode(t('route.attribution', { osm: '{osm}', service: svc.name }), 'osm', ext('https://www.openstreetmap.org/copyright', t('route.attribution.osm'))), ' ', ext('https://www.openstreetmap.org/fixthemap', t('route.fixthemap'))) : null,
      !S.online ? banner('info', t('route.offline')) : null,
      h('p', { class: 'meta' }, t('route.disclaimer')));
  }

  // Standort kommt später (stille Abfrage nach dem Start / „Mein Standort“): Ansicht dann fortsetzen
  const off = on('loc', () => {
    if (!here()) { off(); return; }
    if (!S.userLoc) { paint(); return; }
    off(); useCacheOrIdle();
    if (armed && !result && !loading) void load(); else { paint(); draw(); }
  });
  A.setSheet('half');
  useCacheOrIdle();
  if (armed && S.userLoc && !result) void load(); else paint();
  // „Route“ wurde getippt, Standort noch unbekannt: Standort jetzt anfragen (die Nutzenden haben aktiv „Route“ gewählt); danach rechnet die Ansicht automatisch
  if (armed && !S.userLoc && S.geo !== 'loading') void A.locate({ pan: false });
  replace(host, h('div', { class: 'place' }, body));
  draw();
}
