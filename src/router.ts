// History-API-Router mit Base-Pfad (GitHub Pages: /repo/) und optionalem Sprachpräfix (/en/…).
import { LANGS, getLang } from './i18n';

export type RouteName = 'map' | 'search' | 'place' | 'route' | 'report' | 'favorites' | 'history' | 'settings' | 'more' | 'sources' | 'help' | 'emergency' | 'imprint' | 'privacy' | 'notfound';
export interface Route { name: RouteName; id?: string; q: URLSearchParams; path: string; langPrefix: string | null }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const STATIC: Record<string, RouteName> = {
  '': 'map', karte: 'map', suche: 'search', favoriten: 'favorites', verlauf: 'history', einstellungen: 'settings', mehr: 'more',
  datenquellen: 'sources', hilfe: 'help', notfall: 'emergency', impressum: 'imprint', datenschutz: 'privacy',
};

export function parseLocation(loc: Location = location): Route {
  let p = loc.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
  const segs = p.split('/').filter(Boolean);
  let langPrefix: string | null = null;
  if (segs[0] && LANGS.includes(segs[0]) && segs[0].length === 2) langPrefix = segs.shift()!;
  const q = new URLSearchParams(loc.search);
  const path = '/' + segs.join('/');
  const first = segs[0] ?? '';
  if (first === 'einrichtung' && segs[1]) {
    const id = decodeURIComponent(segs[1]).split('-')[0]!;
    if (segs[2] === 'route') return { name: 'route', id, q, path, langPrefix };
    if (segs[2] === 'fehler-melden') return { name: 'report', id, q, path, langPrefix };
    if (!segs[2]) return { name: 'place', id, q, path, langPrefix };
  }
  if (segs.length <= 1 && first in STATIC) return { name: STATIC[first]!, q, path, langPrefix };
  return { name: 'notfound', q, path, langPrefix };
}

/** Pfad (z. B. "/suche?was=x") -> vollständige href mit Base und Sprachpräfix */
export function href(path: string): string {
  const lang = getLang();
  const pre = lang === 'de' ? '' : `/${lang}`;
  return `${BASE}${pre}${path === '/' ? '/' : path}`;
}

const listeners = new Set<(r: Route) => void>();
export const onRoute = (f: (r: Route) => void): (() => void) => { listeners.add(f); return () => listeners.delete(f); };
let current = parseLocation();
export const getRoute = (): Route => current;

function emit(): void { current = parseLocation(); listeners.forEach((f) => f(current)); }

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const url = href(path);
  if (url === location.pathname + location.search) { emit(); return; }
  if (opts.replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  emit();
}
/** URL anpassen ohne neue Route auszulösen (z. B. Filter-Query) */
export function replaceQuery(path: string): void {
  history.replaceState({}, '', href(path));
  current = parseLocation();
}
export function startRouter(): void {
  window.addEventListener('popstate', emit);
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest('a');
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
    if (BASE && !a.pathname.startsWith(BASE)) return;
    e.preventDefault();
    const pathname = BASE ? a.pathname.slice(BASE.length) : a.pathname;
    const stripped = pathname.replace(/^\/(?:[a-z]{2})(?=\/|$)/, (m) => (LANGS.includes(m.slice(1)) ? '' : m)) || '/';
    navigate(stripped + a.search);
  });
  emit();
}
export const slugOf = (idSeg: string): string => idSeg.split('-')[0]!;
