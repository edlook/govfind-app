import { A, S } from '../ctx';
import { addressLine, loadMeta } from '../data';
import { activeFilterCount, emptyFilters, RADIUS_OPTIONS, subsOfGroup } from '../filters';
import { GROUPS } from '../../shared/taxonomy.js';
import { fmtDate, fmtNumber, t } from '../i18n';
import type { ResultItem } from '../search';
import { canGoBack, getRoute, href } from '../router';
import type { Place } from '../types';
import { PAGE_SIZE } from '../config';
import { backButton, banner, distanceText, groupBadge, groupLabel, placeCellOf, placeHref, skeletonRows, statusLine, subLabel } from '../ui/components';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { telHref } from '../util';
import { armRoute } from './route';
import { allRegionNames } from '../app-data';

export function rowEl(item: ResultItem, idx: number): HTMLElement {
  const p = item.p;
  const addr = addressLine(p);
  const tel = p.ph?.map(telHref).find(Boolean) ?? null;
  const li = h('li', { class: 'row', 'data-id': p.id });
  li.addEventListener('pointerenter', () => { if (matchMedia('(hover: hover)').matches) S.map?.setHover(p); });
  li.addEventListener('pointerleave', () => S.map?.setHover(null));
  li.append(
    h('a', { class: 'row-main', href: placeHref(p), 'aria-label': t('list.row.open_aria', { name: p.nm }) },
      groupBadge(p.s),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-sub' }, subLabel(p.s)),
        h('span', { class: 'row-name', lang: 'de' }, p.nm),
        h('span', { class: ['row-addr', addr ? '' : 'nodata'], lang: 'de' }, addr ?? t('list.row.address_none')),
        statusLine(p),
        item.d !== null ? h('span', { class: 'row-dist' }, distanceText(item.d)) : null)),
    h('span', { class: 'row-actions' },
      tel ? h('a', { class: 'icon-btn', href: tel, 'aria-label': t('place.action.call_aria', { name: p.nm }) }, icon('phone')) : null,
      // Route in der App (Google/Apple bleiben als Rückfall in der Route-Ansicht)
      h('a', { class: 'icon-btn', href: href(`/einrichtung/${p.id}/route?c=${placeCellOf(p)}`), onclick: () => armRoute(p.id), 'aria-label': `${t('list.row.route')}: ${p.nm}` }, icon('route'))),
  );
  void idx;
  return li;
}

async function sourceFooter(): Promise<HTMLElement> {
  const el = h('p', { class: 'meta list-foot' });
  try { const m = await loadMeta(); el.textContent = t('list.footer.source', { date: fmtDate(m.stand) }); } catch { el.textContent = t('list.footer.source', { date: t('place.field.no_data') }); }
  return el;
}

function filterChips(): HTMLElement | null {
  const f = S.filters; const chips: HTMLElement[] = [];
  if (f.subs.size) chips.push(chip(categoryChipLabel(f.subs), () => { A.setFilters({ ...f, subs: new Set() }); }));
  if (f.withHours) chips.push(chip(t('filter.extra.with_hours'), () => A.setFilters({ ...f, withHours: false })));
  if (f.openNow) chips.push(chip(t('filter.extra.open_now'), () => A.setFilters({ ...f, openNow: false })));
  if (f.wheelchair) chips.push(chip(t('filter.extra.wheelchair'), () => A.setFilters({ ...f, wheelchair: false })));
  if (f.radius !== 'auto') chips.push(chip(t('filter.radius.option', { km: f.radius }), () => A.setFilters({ ...f, radius: 'auto' })));
  if (!chips.length) return null;
  return h('div', { class: 'active-chips' }, chips, chips.length > 1 ? h('button', { class: 'link-btn', type: 'button', onclick: () => A.setFilters(emptyFilters()) }, t('list.filters.clear_all')) : null);
}
/** Beschriftung der Kategorien-Auswahl: eine Unterkategorie, eine ganze Gruppe oder „Kategorien (n)“ */
function categoryChipLabel(subs: Set<string>): string {
  if (subs.size === 1) return subLabel([...subs][0]!);
  for (const g of GROUPS) { const gs = subsOfGroup(g.slug); if (gs.length === subs.size && gs.every((s) => subs.has(s))) return groupLabel(g.slug); }
  return t('list.filters.categories', { count: subs.size });
}
function chip(label: string, remove: () => void): HTMLElement {
  return h('button', { class: 'chip chip-removable', type: 'button', 'aria-label': t('list.filters.remove_aria', { name: label }), onclick: remove }, label, icon('close', { size: 14 }));
}

/** Liste: Ergebnisse (S.res) oder Kartenausschnitt (S.browse) */
export function renderList(host: HTMLElement): void {
  const results = S.mode === 'results';
  const head = h('div', { class: 'list-head' });
  const body = h('div', { class: 'list-body' });
  let items: ResultItem[] = [];
  let state: 'loading' | 'ok' | 'error' | 'zoom' | 'empty' | 'wo_not_found' | 'need_where' = 'ok';
  if (results) {
    if (S.resState === 'loading') state = 'loading';
    else if (S.resState === 'error') state = 'error';
    else if (S.res?.kind === 'wo_not_found') state = 'wo_not_found';
    else if (S.res?.kind === 'need_where') state = 'need_where';
    else { items = S.res?.items ?? []; state = items.length ? 'ok' : S.res?.failedCells ? 'error' : 'empty'; } // leer wegen Ladefehler (offline, Chunk fehlt) ist kein "keine Treffer"
  } else {
    if (S.browseState === 'loading' || S.browseState === 'idle') state = 'loading';
    else if (S.browseState === 'zoom') state = 'zoom';
    else if (S.browseState === 'error') state = 'error';
    else if (!S.browse.length) state = 'empty';
    else {
      const c = S.mapView?.center;
      items = S.browse.map((p) => ({ p, d: S.userLoc ? dist(S.userLoc, p) : null }));
      items.sort((a, b) => (a.d !== null && b.d !== null ? a.d - b.d : c ? dist(c, a.p) - dist(c, b.p) : a.p.nm.localeCompare(b.p.nm, 'de')));
      items = items.slice(0, 300);
    }
  }

  // Titelzeile
  const title = results
    ? h('button', { class: 'summary', type: 'button', 'aria-label': t('list.summary_edit_aria'), onclick: () => A.openSearch() },
        h('span', { class: 'summary-text' }, [S.was, S.nearby ? t('nav.header.nearby') : S.wo].filter(Boolean).join(' · ') || t('list.title')), icon('edit', { size: 18 }))
    : h('h2', { class: 'list-title' }, t('list.title'));
  const countN = state === 'ok' ? (results ? S.res!.total : items.length) : null;
  const count = h('p', { class: 'count', 'aria-live': 'polite' },
    countN !== null ? (results ? t('list.results_count', { count: countN }) : t('map.sheet.peek_area', { count: countN })) : !results && state === 'zoom' ? t('map.sheet.peek_idle') : '');
  // Sichtbares „Zurück“: bei Suchergebnissen immer (Ersatz: Karte), sonst nur, wenn davor ein App-Eintrag liegt
  const showBack = getRoute().name === 'search' && (results || canGoBack());
  if (showBack) head.prepend(backButton(() => A.back('/')));
  head.append(title, count);
  if (state === 'ok' && items.some((i) => i.d !== null)) {
    const sel = h('select', { class: 'sort', 'aria-label': t('list.sort.label'), onchange: (e: Event) => { S.sort = (e.target as HTMLSelectElement).value as 'auto' | 'name'; renderList(host); } },
      h('option', { value: 'auto' }, t('list.sort.distance')), h('option', { value: 'name' }, t('list.sort.name')));
    sel.value = S.sort;
    head.append(sel);
  }
  const fc = filterChips();
  const wrap = h('div', { class: 'list' }, head, fc);
  // Gleichnamige Orte (z. B. 27x "Neustadt"): Auswahl anbieten
  if (results && (state === 'ok' || state === 'empty') && S.res?.woAlts?.length) {
    const place = S.res.woText.split(',')[0]!.trim();
    wrap.append(h('div', { class: 'ambiguous' }, h('p', { class: 'meta' }, t('search.where.ambiguous', { place })),
      h('div', { class: 'row-actions' }, S.res.woAlts.slice(0, 6).map((a) => h('button', { class: 'btn', type: 'button', onclick: () => A.submitSearch(S.was, a.value) }, `${a.label} · ${t('search.where.near', { place: a.qual })}`)))));
  }

  if (state === 'loading') body.append(h('p', { class: 'visually-hidden', role: 'status' }, t('errors.loading.label')), skeletonRows(6));
  else if (state === 'error') body.append(banner('error', t('errors.generic.title'), S.online ? null : t('errors.offline.banner_no_date'), [h('button', { class: 'btn', type: 'button', onclick: () => A.retry() }, t('errors.generic.retry'))]));
  else if (state === 'zoom') body.append(h('p', { class: 'hint' }, t('list.zoom_cta')),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => A.nearby() }, icon('locate'), h('span', null, t('map.sheet.locate_cta'))),
      h('button', { class: 'btn', type: 'button', onclick: () => A.openSearch('wo') }, icon('search'), h('span', null, t('errors.geo.alternative')))),
    coverageNote());
  else if (state === 'need_where') {
    body.append(banner('info', t('search.need_where.title'), t('search.need_where.body', { what: S.was }), [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => A.nearby() }, icon('locate'), h('span', null, t('map.chips.nearby'))),
      h('button', { class: 'btn', type: 'button', onclick: () => A.openSearch('wo') }, icon('pin'), h('span', null, t('errors.geo.alternative')))]));
  }
  else if (state === 'wo_not_found') {
    const r = S.res!;
    body.append(banner('warn', t('search.error.place_not_found', { term: r.woText }), r.suggestion ? t('search.error.place_suggest', { suggestion: r.suggestion }) : t('search.where.hint'),
      r.suggestion ? [h('button', { class: 'btn', type: 'button', onclick: () => A.submitSearch(S.was, r.suggestion!) }, r.suggestion)] : []));
  } else if (state === 'empty') {
    const r = S.res;
    const msg = results && r?.woNoData ? [banner('info', t('coverage.no_data_place', { place: r.label ?? r.woText, regions: allRegionNames() }))] : [];
    // Nichts gefunden: nie stillschweigend in eine andere Stadt springen. Meldung mit Umkreis; „Nächste anzeigen“ nur auf Wunsch.
    const near = results && r?.searchedKm && r.refSrc ? t('search.error.none_nearby', { what: S.was || t('list.title'), km: fmtNumber(r.searchedKm), ref: t(`search.ref.${r.refSrc}`) }) : null;
    const emptyTitle = near ?? (results && S.was && (S.wo || r?.label) ? t('search.error.none_in_place', { what: S.was, place: r?.label ?? S.wo }) : t('errors.empty.title'));
    const nearest = results ? r?.nearest : null;
    if (nearest) {
      const step = RADIUS_OPTIONS.find((k) => k >= Math.ceil(nearest.d)) ?? 200;
      const place = nearest.p.a?.c ? `, ${nearest.p.a.c}` : '';
      const km = fmtNumber(Math.max(1, Math.round(nearest.d)));
      body.append(banner('info', emptyTitle, t('search.nearest.info', { km, place: nearest.p.a?.c ? ` (${nearest.p.a.c})` : '' }),
        [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => A.setFilters({ ...S.filters, radius: step }) }, t('search.nearest.cta', { km, place }))]));
    }
    body.append(...msg, h('div', { class: 'empty' },
      nearest ? null : h('h3', null, emptyTitle),
      h('ul', { class: 'hints' },
        h('li', null, h('button', { class: 'link-btn', type: 'button', onclick: () => A.setFilters({ ...S.filters, radius: 25 }) }, t('errors.empty.hint_area'))),
        activeFilterCount(S.filters) ? h('li', null, h('button', { class: 'link-btn', type: 'button', onclick: () => A.setFilters(emptyFilters()) }, t('errors.empty.hint_filters'))) : null,
        h('li', null, t('errors.empty.hint_spelling'))),
      !results ? coverageNote() : null));
  } else {
    if (results && S.res) {
      const r = S.res;
      const sim = r.similar.filter((x) => r.items.some((i) => i.p.s === x)); // Hinweis nur für ähnliche Arten, die tatsächlich in der Liste vorkommen
      if (sim.length && r.wasSubs.length) wrap.append(h('p', { class: 'meta' }, t('search.synonym_notice', { term: sim.map(subLabel).join(', ') })));
      if (r.radiusKm) wrap.append(h('p', { class: 'meta' }, t('map.radius.info', { km: fmtNumber(r.radiusKm) })));
      if (r.truncated) wrap.append(banner('warn', t('errors.partial.title'), t('errors.partial.limit', { shown: r.items.length, total: r.total }), [h('button', { class: 'btn', type: 'button', onclick: () => A.setSheet('peek') }, t('errors.partial.zoom'))]));
      else if (r.failedCells) wrap.append(banner('warn', t('errors.partial.title'), t('errors.partial.region')));
    }
    let list = items;
    if (S.sort === 'name') list = [...items].sort((a, b) => a.p.nm.localeCompare(b.p.nm, 'de'));
    const ul = h('ul', { class: 'rows' });
    let shown = 0;
    const more = h('button', { class: 'btn btn-block', type: 'button' }, t('list.load_more'));
    const end = h('p', { class: 'meta end' }, t('list.end'));
    const fill = (): void => {
      const next = list.slice(shown, shown + PAGE_SIZE);
      next.forEach((it, i) => ul.append(rowEl(it, shown + i)));
      shown += next.length;
      more.hidden = shown >= list.length; end.hidden = shown < list.length;
    };
    more.addEventListener('click', fill);
    fill();
    body.append(ul, more, end);
  }
  wrap.append(body);
  const foot = h('div', { class: 'list-foot-wrap' });
  wrap.append(foot);
  void sourceFooter().then((el) => foot.append(el));
  replace(host, wrap);
}

function coverageNote(): HTMLElement { return h('p', { class: 'meta' }, t('coverage.note', { regions: allRegionNames() })); }
function dist(a: { lat: number; lng: number }, p: Place): number { const dx = (a.lng - p.ln) * Math.cos((a.lat * Math.PI) / 180); const dy = a.lat - p.la; return Math.hypot(dx, dy) * 111.32; }
