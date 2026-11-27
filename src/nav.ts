// Live-Navigation (Zu Fuß / Auto): folgt der Position, zeigt das nächste Manöver, sagt es an und rechnet bei Abweichung neu.
// Ohne eigenen Server: Position kommt vom Gerät (watchPosition), Neuberechnung über denselben Routing-Dienst wie die Routenansicht.
import { S, A } from './ctx';
import { getLang, t } from './i18n';
import { fetchRoute, stepKey, type Coord, type RoadRoute, type RouteStep } from './routing';
import type { LatLng } from './types';
import { distanceText } from './ui/components';
import { h } from './ui/dom';
import { icon } from './ui/icons';

export interface NavOptions { route: RoadRoute; dest: LatLng; destName: string; mode: 'walk' | 'car'; onEnd: () => void; onRoute: (r: RoadRoute) => void }

const M_LAT = 110540;
const mPerLng = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);
const distM = (a: LatLng, b: LatLng): number => Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * mPerLng(a.lat));

interface Proj { i: number; along: number; off: number }
/** Position auf den Linienzug projizieren (Näherung in lokalen Metern) */
function project(coords: Coord[], cum: number[], me: LatLng, from: number): Proj {
  const box: { best: Proj | null } = { best: null };
  const n = coords.length;
  const scan = (lo: number, hi: number): void => {
    for (let i = lo; i < hi; i++) {
      const a = coords[i]!; const b = coords[i + 1]!;
      const kx = mPerLng(me.lat);
      const ax = (a[0] - me.lng) * kx, ay = (a[1] - me.lat) * M_LAT, bx = (b[0] - me.lng) * kx, by = (b[1] - me.lat) * M_LAT;
      const dx = bx - ax, dy = by - ay; const len2 = dx * dx + dy * dy;
      const tt = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + tt * dx, py = ay + tt * dy;
      const off = Math.hypot(px, py);
      if (!box.best || off < box.best.off) box.best = { i, along: cum[i]! + tt * Math.sqrt(len2), off };
    }
  };
  scan(Math.max(0, from - 2), Math.min(n - 1, from + 80));
  if (!box.best || box.best.off > 80) scan(0, n - 1); // weit entfernt: ganze Strecke prüfen (z. B. nach Abkürzung)
  return box.best ?? { i: 0, along: 0, off: Infinity };
}

const ROT: Record<string, number> = { straight: 0, right: 90, 'slight right': 45, 'sharp right': 135, left: -90, 'slight left': -45, 'sharp left': -135, uturn: 180 };
const stepText = (s: RouteStep): string => { const k = stepKey(s); return t(k.key, k.params) + (k.onto && s.name ? ' ' + t('route.step.onto', { street: s.name }) : ''); };
const fmtClock = (ms: number): string => new Intl.DateTimeFormat(getLang(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(ms));
const fmtMin = (s: number): string => { const m = Math.max(1, Math.round(s / 60)); return m >= 60 ? t('route.dur.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('route.dur.min', { m }); };

let active: { stop: () => void } | null = null;
export const navActive = (): boolean => !!active;
export function stopNavigation(): void { active?.stop(); }

export function startNavigation(o: NavOptions): void {
  stopNavigation();
  const app = document.querySelector<HTMLElement>('.app');
  if (!app || !('geolocation' in navigator)) { A.toast(t('nav.no_gps')); return; }
  let route = o.route;
  let cum: number[] = []; let stepStart: number[] = []; let total = 0; let stepsTotal = 0;
  const prep = (): void => {
    cum = [0];
    for (let i = 1; i < route.coords.length; i++) cum.push(cum[i - 1]! + distM({ lat: route.coords[i - 1]![1], lng: route.coords[i - 1]![0] }, { lat: route.coords[i]![1], lng: route.coords[i]![0] }));
    total = cum[cum.length - 1] ?? 0;
    stepStart = []; let a = 0; for (const s of route.steps) { stepStart.push(a); a += s.distanceM; }
    stepsTotal = a || total;
  };
  prep();

  let voice = true; try { voice = localStorage.getItem('gf.navvoice') !== '0'; } catch { /* ignore */ }
  let follow = true; let idx = 0; let off = 0; let along = 0; let me: LatLng | null = null; let lastFix = 0;
  let rerouting = false; let lastReroute = 0; let arrived = false; let heading: number | null = null; let lastSpoken = '';
  const said = new Set<string>();
  let watchId = -1; let wake: { release: () => Promise<void> } | null = null;

  // ---- Oberfläche ----
  const arrow = h('span', { class: 'nav-arrow' }, icon('navigate', { size: 44 }));
  const distEl = h('div', { class: 'nav-dist' }, '–');
  const textEl = h('div', { class: 'nav-text' }, t('nav.searching'));
  const top = h('div', { class: 'nav-top', role: 'status', 'aria-live': 'off' }, arrow, h('div', { class: 'nav-main' }, distEl, textEl));
  const remEl = h('div', { class: 'nav-rem' }, '–');
  const etaEl = h('div', { class: 'nav-eta' }, '');
  const voiceBtn = h('button', { class: 'btn nav-btn', type: 'button', onclick: () => { voice = !voice; try { localStorage.setItem('gf.navvoice', voice ? '1' : '0'); } catch { /* ignore */ } if (!voice) window.speechSynthesis?.cancel(); paintVoice(); } });
  const paintVoice = (): void => { voiceBtn.replaceChildren(icon(voice ? 'volume' : 'volume-off', { size: 22 })); voiceBtn.setAttribute('aria-label', voice ? t('nav.voice_on') : t('nav.voice_off')); voiceBtn.setAttribute('aria-pressed', String(voice)); };
  const recenter = h('button', { class: 'btn nav-recenter', type: 'button', hidden: true, onclick: () => { follow = true; recenter.hidden = true; if (me) S.map?.follow(me, heading, zoomFor()); } }, icon('locate', { size: 20 }), h('span', null, t('nav.recenter')));
  const endBtn = h('button', { class: 'btn btn-primary nav-end', type: 'button', onclick: () => stopNavigation() }, t('nav.end'));
  const bottom = h('div', { class: 'nav-bottom' }, h('div', { class: 'nav-sum' }, remEl, etaEl), voiceBtn, endBtn);
  paintVoice();
  app.dataset.nav = '1';
  app.append(top, recenter, bottom);
  const offDrag = S.map?.onUserDrag(() => { follow = false; recenter.hidden = false; });

  const zoomFor = (): number => (o.mode === 'car' ? 16.2 : 17.4);
  const speak = (text: string): void => {
    if (!voice || !('speechSynthesis' in window) || text === lastSpoken) return;
    lastSpoken = text;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = getLang() === 'de' ? 'de-DE' : 'en-GB'; u.rate = 1; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { /* ignore */ }
  };
  // Sprachausgabe auf iOS braucht eine Nutzeraktion: die Starttaste hat sie ausgelöst, stille Äußerung schaltet frei
  try { if (voice && 'speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch { /* ignore */ }

  const draw = (): void => { S.map?.setRouteLines([{ coords: route.coords, kind: 'road' }]); };
  draw();

  const finish = (): void => {
    arrived = true;
    arrow.replaceChildren(icon('pin', { size: 44 })); arrow.style.transform = '';
    distEl.textContent = t('route.step.arrive'); textEl.textContent = o.destName;
    remEl.textContent = ''; etaEl.textContent = '';
    endBtn.textContent = t('nav.done');
    speak(t('nav.arrived'));
    S.map?.follow(o.dest, 0, 17.8);
  };

  const update = (): void => {
    if (!me || arrived) return;
    const p = project(route.coords, cum, me, idx);
    const thr = Math.max(o.mode === 'car' ? 55 : 35, 0);
    if (p.off > thr) off++; else { off = 0; idx = p.i; along = p.along; }
    if (off >= 3 && !rerouting && Date.now() - lastReroute > 12000) void reroute();
    const remaining = Math.max(0, total - along);
    if (distM(me, o.dest) < (o.mode === 'car' ? 30 : 20) || remaining < (o.mode === 'car' ? 25 : 15)) { finish(); return; }
    // nächstes Manöver: erster Schritt (ab 1), der hinter der aktuellen Position beginnt
    const scale = total > 0 ? stepsTotal / total : 1;
    const aS = along * scale;
    let k = 1; while (k < route.steps.length - 1 && stepStart[k]! <= aS + 2) k++;
    const st = route.steps[Math.min(k, route.steps.length - 1)];
    if (st) {
      const dTo = Math.max(0, (stepStart[Math.min(k, route.steps.length - 1)]! - aS) / scale);
      const rot = (ROT[st.modifier ?? 'straight'] ?? 0) - 45;
      const isArrive = st.type === 'arrive';
      arrow.replaceChildren(icon(isArrive ? 'pin' : 'navigate', { size: 44 })); arrow.style.transform = isArrive ? '' : `rotate(${rot}deg)`;
      distEl.textContent = distanceText(dTo / 1000);
      textEl.textContent = stepText(st);
      // Ansagen: Auto früher als zu Fuß
      const ths = o.mode === 'car' ? [600, 250, 60] : [120, 40];
      for (const th of ths) {
        const key = `${k}:${th}`;
        if (dTo <= th && !said.has(key)) {
          ths.filter((x) => x >= th).forEach((x) => said.add(`${k}:${x}`));
          speak(dTo > 70 ? t('nav.in', { dist: distanceText(Math.round(dTo / 10) * 10 / 1000), text: stepText(st) }) : stepText(st));
          break;
        }
      }
    }
    const frac = total > 0 ? remaining / total : 0;
    const remS = route.durationS * frac;
    remEl.textContent = t('nav.remaining', { time: fmtMin(remS), dist: distanceText(remaining / 1000) });
    etaEl.textContent = t('route.arrival', { time: fmtClock(Date.now() + remS * 1000) });
    if (follow) S.map?.follow(me, heading, zoomFor());
  };

  const reroute = async (): Promise<void> => {
    if (!me) return;
    rerouting = true; lastReroute = Date.now();
    textEl.textContent = t('nav.rerouting');
    try {
      const r = await fetchRoute(o.mode, me, o.dest, { lang: getLang() });
      if (!active || r.kind !== 'road') return;
      route = r; prep(); idx = 0; along = 0; off = 0; said.clear(); draw(); o.onRoute(r);
      A.announce(t('nav.rerouted')); speak(t('nav.rerouted'));
    } catch { textEl.textContent = t('nav.reroute_failed'); }
    finally { rerouting = false; }
    update();
  };

  const onPos = (pos: GeolocationPosition): void => {
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude }; S.userLoc = me; S.map?.setUser(me); S.geo = 'granted'; lastFix = Date.now();
    const sp = pos.coords.speed;
    heading = typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading) && (sp === null || sp > 0.8) ? pos.coords.heading : heading;
    update();
  };
  const onErr = (e: GeolocationPositionError): void => { if (e.code === 1) { textEl.textContent = t('nav.no_gps'); } };
  watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  const stale = window.setInterval(() => { if (!arrived && Date.now() - lastFix > 20000 && me) textEl.textContent = t('nav.searching'); }, 5000);

  // Bildschirm anlassen (soweit das Gerät es erlaubt)
  const getWake = async (): Promise<void> => { try { const nv = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }; wake = (await nv.wakeLock?.request('screen')) ?? null; } catch { wake = null; } };
  void getWake();
  const onVis = (): void => { if (document.visibilityState === 'visible') void getWake(); };
  document.addEventListener('visibilitychange', onVis);

  active = {
    stop: () => {
      active = null;
      navigator.geolocation.clearWatch(watchId); clearInterval(stale); document.removeEventListener('visibilitychange', onVis);
      void wake?.release().catch(() => undefined); window.speechSynthesis?.cancel(); offDrag?.();
      top.remove(); bottom.remove(); recenter.remove(); delete app.dataset.nav;
      S.map?.endFollow();
      o.onEnd();
    },
  };
}
