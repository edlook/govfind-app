import { A, S } from '../ctx';
import { distanceKm, findPlace } from '../data';
import { t } from '../i18n';
import { getRoute, navigate } from '../router';
import type { Place } from '../types';
import { banner, distanceText, pageHeader, skeletonRows } from '../ui/components';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { appleDir, geoUri, googleDir, isAndroid, isApple, type TravelMode } from '../util';

let mode: TravelMode = ((): TravelMode => { try { const v = localStorage.getItem('gf.routemode'); return v === 'car' || v === 'transit' ? v : 'walk'; } catch { return 'walk'; } })();

export async function renderRoute(host: HTMLElement, id: string, hint: string | null, onLoaded: (p: Place | null) => void): Promise<void> {
  replace(host, h('div', { class: 'place' }, skeletonRows(3)));
  let p: Place | null = null;
  try { p = await findPlace(id, hint); } catch { p = null; }
  if (getRoute().name !== 'route' || getRoute().id !== id) return;
  onLoaded(p);
  const back = (): void => navigate(`/einrichtung/${id}${hint ? '?c=' + hint : ''}`);
  if (!p) { replace(host, h('div', { class: 'place' }, pageHeader(t('route.title'), back), banner('warn', t('place.removed.title')))); return; }
  const place = p;
  const body = h('div', { class: 'route' });
  const paint = (): void => {
    const user = S.userLoc;
    S.map?.setRoute(user, user ? { lat: place.la, lng: place.ln } : null);
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('route.mode.label') },
      (['walk', 'car', 'transit'] as TravelMode[]).map((m) => h('button', { class: 'seg', type: 'button', role: 'radio', 'aria-checked': String(m === mode), onclick: () => { mode = m; try { localStorage.setItem('gf.routemode', m); } catch { /* ignore */ } paint(); } },
        icon(m === 'walk' ? 'walk' : m === 'car' ? 'car' : 'bus', { size: 20 }), h('span', null, t(`route.mode.${m}`)))));
    const links: HTMLElement[] = [
      h('a', { class: 'btn btn-primary btn-block', href: googleDir(place, mode), target: '_blank', rel: 'noopener noreferrer' }, icon('navigate'), h('span', null, t('route.open_google')), icon('external', { size: 16 })),
    ];
    if (isApple()) links.push(h('a', { class: 'btn btn-block', href: appleDir(place, mode), target: '_blank', rel: 'noopener noreferrer' }, icon('map'), h('span', null, t('route.open_apple')), icon('external', { size: 16 })));
    if (isAndroid()) links.push(h('a', { class: 'btn btn-block', href: geoUri(place) }, icon('map'), h('span', null, t('route.open_other'))));
    replace(body,
      h('div', { class: 'ft' },
        h('div', null, h('span', { class: 'meta' }, t('route.from')), h('p', { class: 'strong' }, user ? t('route.from_my_location') : '–')),
        h('div', null, h('span', { class: 'meta' }, t('route.to')), h('p', { class: 'strong', lang: 'de' }, place.nm))),
      user ? null : h('div', null, h('p', { class: 'meta' }, t('route.error.no_location')),
        h('button', { class: 'btn', type: 'button', onclick: () => { void A.locate({ pan: false }).then(paint); } }, icon('locate'), h('span', null, t('map.control.locate')))),
      seg,
      user ? h('p', { class: 'beeline' }, t('route.beeline', { distance: distanceText(distanceKm(user, { lat: place.la, lng: place.ln })) })) : null,
      user ? h('p', { class: 'meta' }, t('route.beeline_note')) : null,
      mode === 'transit' ? h('p', { class: 'meta' }, t('route.transit.hint')) : null,
      h('div', { class: 'stack' }, links),
      !S.online ? banner('info', t('route.offline')) : null,
      h('p', { class: 'meta' }, t('route.external_notice')),
      h('p', { class: 'meta' }, t('route.disclaimer')));
  };
  paint();
  replace(host, h('div', { class: 'place' }, pageHeader(t('route.title'), back), body));
}
