import { A, S } from '../ctx';
import { addressLine, findPlace, loadMeta } from '../data';
import { deviceInOtherZone, hoursReady, loadHours, statusOf, weekTable } from '../hours';
import { fmtDate, t } from '../i18n';
import { getRoute, href, navigate } from '../router';
import { addFavorite, getFavorites, getNote, isFavorite, removeFavorite, setNote } from '../storage';
import { STATES } from '../../shared/states.js';
import type { Place } from '../types';
import { banner, distanceText, field, groupBadge, placeHref, skeletonRows, subLabel } from '../ui/components';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { googleReviews, osmObject, telHref } from '../util';
import { distanceKm } from '../data';

const section = (title: string, ...children: (Node | null | false)[]): HTMLElement => h('section', { class: 'sec' }, h('h2', null, title), ...children);

export function backTarget(): { label: string; run: () => void } {
  if (S.mode === 'results' && S.res) return { label: t('nav.back_to_list'), run: () => navigate(A.searchHref()) };
  return { label: t('nav.back_to_map'), run: () => navigate('/') };
}

export async function renderPlace(host: HTMLElement, id: string, hint: string | null, onLoaded: (p: Place | null) => void): Promise<void> {
  replace(host, h('div', { class: 'place', 'aria-busy': 'true' }, h('p', { class: 'visually-hidden', role: 'status' }, t('place.loading_aria')), skeletonRows(3)));
  let p: Place | null = null; let offline = false;
  try { p = await findPlace(id, hint); } catch { offline = true; }
  if (getRoute().name !== 'place' || getRoute().id !== id) return;
  if (!p && offline) {
    const f = getFavorites().find((x) => x.id === id);
    if (f) { p = f.place; }
  }
  if (!p) {
    onLoaded(null);
    replace(host, h('div', { class: 'place' }, topBar(null),
      offline ? banner('error', t('errors.generic.title'), null, [h('button', { class: 'btn', type: 'button', onclick: () => A.refreshAll() }, t('errors.generic.retry'))])
        : banner('warn', t('place.removed.title'), null, [h('button', { class: 'btn', type: 'button', onclick: () => navigate('/suche') }, t('place.removed.similar'))])));
    return;
  }
  onLoaded(p);
  const place = p;
  const bt = backTarget();
  const name = place.nm;
  const addr = addressLine(place);

  // Aktionen
  const tel = place.ph?.map(telHref).find(Boolean) ?? null;
  const favBtn = h('button', { class: 'btn action', type: 'button', 'aria-pressed': String(isFavorite(place.id)) });
  const paintFav = (): void => {
    const on = isFavorite(place.id);
    favBtn.setAttribute('aria-pressed', String(on));
    favBtn.setAttribute('aria-label', on ? t('place.action.saved_aria', { name }) : `${t('place.action.save')}: ${name}`);
    replace(favBtn, icon(on ? 'heartFill' : 'heart'), h('span', null, on ? t('place.action.saved') : t('place.action.save')));
  };
  paintFav();
  favBtn.addEventListener('click', () => {
    if (isFavorite(place.id)) {
      const rem = removeFavorite(place.id);
      A.announce(t('a11y.favorite_removed', { name }));
      A.toast(t('favorites.toast.removed'), { action: rem ? { label: t('favorites.toast.undo'), run: () => { addFavorite(rem.place, rem.data_stand); paintFav(); } } : undefined });
    } else {
      void loadMeta().catch(() => null).then((m) => {
        if (!addFavorite(place, m?.stand ?? null)) A.toast(t('favorites.error.storage_full'));
        else { A.announce(t('a11y.favorite_added', { name })); A.toast(t('favorites.toast.added')); }
        paintFav();
      });
    }
    paintFav();
  });
  const actions = h('div', { class: 'actionbar' },
    h('a', { class: 'btn btn-primary action', href: href(`/einrichtung/${place.id}/route?c=${hint ?? ''}`) }, icon('route'), h('span', null, t('place.action.route'))),
    tel ? h('a', { class: 'btn action', href: tel, 'aria-label': t('place.action.call_aria', { name }) }, icon('phone'), h('span', null, t('place.action.call'))) : null,
    place.web ? h('a', { class: 'btn action', href: place.web, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('place.action.website_aria', { name }) }, icon('globe'), h('span', null, t('place.action.website'))) : null,
    favBtn);

  // Öffnungszeiten
  const hoursBox = h('div', { class: 'hours' });
  const paintHours = (): void => {
    const st = statusOf(place);
    const parts: (Node | null)[] = [];
    if (!place.oh) parts.push(h('p', { class: 'nodata' }, t('hours.missing')));
    else {
      const rows = (place.ohs !== 'failed' && hoursReady()) ? weekTable(place) : null;
      if (rows) {
        parts.push(h('dl', { class: 'week' }, rows.map((r) => h('div', { class: ['wd', r.today ? 'today' : ''] }, h('dt', null, r.label, r.today ? h('span', { class: 'today-tag' }, ` (${t('hours.today')})`) : null), h('dd', null, r.value)))));
        if (st.holidays && place.lnd) parts.push(h('p', { class: 'meta' }, t('hours.holidays_considered', { land: STATES[place.lnd as keyof typeof STATES] ?? place.lnd })));
        if (st.check) parts.push(h('p', { class: 'meta' }, t('hours.status.check')));
      } else if (place.ohs === 'failed' || (hoursReady() && !rows)) parts.push(h('p', { class: 'meta' }, t('hours.parse_failed')));
      else parts.push(h('p', { class: 'meta' }, t('errors.loading.label')));
      const raw = h('p', { class: 'raw', hidden: true }, h('span', { class: 'meta' }, t('hours.raw.label')), h('code', { lang: 'en' }, place.oh));
      const rawBtn = h('button', { class: 'link-btn', type: 'button', 'aria-expanded': 'false' }, t('hours.raw.show'));
      rawBtn.addEventListener('click', () => { const o = raw.hidden; raw.hidden = !o; rawBtn.setAttribute('aria-expanded', String(o)); rawBtn.textContent = o ? t('hours.raw.hide') : t('hours.raw.show'); });
      if (place.ohs === 'failed') raw.hidden = false;
      else parts.push(rawBtn);
      parts.push(raw);
      if (deviceInOtherZone()) parts.push(h('p', { class: 'meta' }, t('hours.german_time')));
    }
    if (place.ap) parts.push(h('p', { class: 'appt' }, place.ap === 'required' ? t('hours.appointment_required') : t('hours.appointment_recommended')));
    replace(hoursBox, parts);
  };
  paintHours();
  void loadHours().then(() => { paintHours(); paintStatus(); }).catch(() => undefined);

  const statusBox = h('p', { class: 'status-big' });
  const paintStatus = (): void => {
    const st = statusOf(place);
    statusBox.className = 'status-big status-' + st.kind;
    statusBox.textContent = '';
    if (st.kind === 'open' || st.kind === 'closed' || st.kind === 'appt') statusBox.append(icon('clock', { size: 18 }), document.createTextNode(' ' + (st.text ?? '')));
    else if (st.kind === 'absent') statusBox.append(icon('clock', { size: 18 }), document.createTextNode(' ' + t('hours.status.unknown')));
    else if (st.kind === 'raw') statusBox.append(icon('clock', { size: 18 }), document.createTextNode(' ' + t('hours.status.unknown')));
  };
  paintStatus();

  // Notiz
  const ta = h('textarea', { rows: '3', maxlength: '1000', placeholder: t('place.note.placeholder'), 'aria-label': t('place.note.title') });
  ta.value = getNote(place.id);
  const noteMsg = h('p', { class: 'meta', role: 'status' });
  const note = section(t('place.note.title'), h('p', { class: 'meta' }, t('place.note.local') + ' ' + t('place.note.hint')), ta,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => { noteMsg.textContent = setNote(place.id, ta.value) ? t('place.note.saved') : t('favorites.error.storage_unavailable'); } }, t('place.note.save')),
      h('button', { class: 'btn', type: 'button', onclick: () => { ta.value = ''; setNote(place.id, ''); noteMsg.textContent = t('settings.data.done'); } }, t('place.note.delete'))), noteMsg);

  // Quelle
  const srcBox = h('dl', { class: 'fields' });
  void loadMeta().then((m) => {
    replace(srcBox,
      field(t('place.source.source', { source: '' }).replace(/:\s*$/, ''), 'OpenStreetMap', { href: osmObject(place) }),
      field(t('place.source.stand', { date: '' }).replace(/:\s*$/, ''), fmtDate(m.stand)),
      field(t('place.source.last_edit', { date: '' }).replace(/:\s*$/, ''), place.ts ? fmtDate(place.ts) : null),
      field(t('place.source.last_checked', { date: '' }).replace(/:\s*$/, ''), place.cd ? fmtDate(place.cd) : null),
      field(t('place.source.license', { license: '' }).replace(/:\s*$/, ''), 'ODbL 1.0', { href: m.license_url }));
  }).catch(() => replace(srcBox, field(t('place.source.source', { source: '' }).replace(/:\s*$/, ''), 'OpenStreetMap', { href: osmObject(place) })));

  const fromUser = S.userLoc ? distanceKm(S.userLoc, { lat: place.la, lng: place.ln }) : null;
  const group = h('div', { class: 'place-head' }, groupBadge(place.s, 48), h('div', null, h('p', { class: 'row-sub' }, subLabel(place.s)), h('h1', { lang: 'de' }, name)));
  const email = place.em && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(place.em) ? place.em : null;

  const el = h('article', { class: 'place' },
    topBar(place),
    group,
    fromUser !== null ? h('p', { class: 'meta' }, t('place.distance', { distance: distanceText(fromUser) })) : null,
    place.fl?.includes('not_public_authority') ? h('p', { class: 'badge-note' }, t('place.badge.not_public')) : null,
    statusBox,
    actions,
    section(t('place.address.title'),
      addr ? h('p', { class: 'addr', lang: 'de' }, addr) : h('p', { class: 'nodata' }, t('place.field.no_data')),
      addr ? h('button', { class: 'link-btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(addr); A.toast(t('place.address.copied')); } catch { A.toast(t('errors.generic.title')); } } }, icon('copy', { size: 16 }), ' ', t('place.address.copy')) : null),
    section(t('hours.title'), hoursBox),
    section(t('place.contact.title'), h('dl', { class: 'fields' },
      phoneFields(place),
      field(t('place.contact.email'), email, email ? { href: 'mailto:' + email } : {}),
      field(t('place.contact.website'), place.web ? place.web.replace(/^https?:\/\//, '').replace(/\/$/, '') : null, place.web ? { href: place.web } : {}))),
    section(t('place.access.title'), h('dl', { class: 'fields' },
      field(t('place.access.title'), place.wc ? t(`place.access.wheelchair_${place.wc}`) : null)), place.wc ? h('p', { class: 'meta' }, t('place.access.source_note')) : null),
    note,
    section(t('place.google_reviews.title'),
      h('a', { class: 'btn btn-block', href: googleReviews(place), target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('place.google_reviews.aria', { name }) }, icon('star'), h('span', null, t('place.google_reviews.cta')), icon('external', { size: 16 })),
      h('p', { class: 'meta' }, t('place.google_reviews.note') + ' ' + t('reviews.info.not_checked'))),
    section(t('place.source.title'), srcBox, h('p', { class: 'meta' }, t('place.source.disclaimer')),
      h('a', { class: 'link', href: osmObject(place), target: '_blank', rel: 'noopener noreferrer' }, t('place.source.view_osm'), ' ', icon('external', { size: 14 }))),
    h('p', null, h('a', { class: 'link', href: href(`/einrichtung/${place.id}/fehler-melden?c=${hint ?? ''}`) }, icon('warning', { size: 16 }), ' ', t('place.report'))),
    ['behoerden', 'fachaemter'].includes(placeGroup(place)) ? h('p', { class: 'meta' }, t('place.hint_115')) : null,
    h('p', { class: 'meta' }, h('span', { class: 'visually-hidden' }, bt.label)));
  replace(host, el);
}

import { GROUP_OF } from '../../shared/taxonomy.js';
const placeGroup = (p: Place): string => GROUP_OF[p.s] ?? '';

function phoneFields(p: Place): HTMLElement {
  if (!p.ph?.length) return field(t('place.contact.phone'), null);
  const wrap = h('div', { class: 'field' }, h('dt', null, t('place.contact.phone')), h('dd', null, p.ph.map((n, i) => {
    const th = telHref(n);
    return h('span', { class: 'phone' }, i ? ', ' : '', th ? h('a', { href: th }, n) : n);
  })));
  return wrap;
}

function topBar(p: Place | null): HTMLElement {
  const bt = backTarget();
  return h('div', { class: 'page-head place-top' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': bt.label, onclick: bt.run }, icon('back')),
    h('span', { class: 'spacer' }),
    p ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('place.share'), onclick: async () => {
      const url = location.origin + placeHref(p);
      try {
        if (navigator.share) await navigator.share({ title: t('place.share_title', { name: p.nm }), url });
        else { await navigator.clipboard.writeText(url); A.toast(t('place.link_copied')); }
      } catch { /* abgebrochen */ }
    } }, icon('share')) : null,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('place.close_aria'), onclick: bt.run }, icon('close')));
}
