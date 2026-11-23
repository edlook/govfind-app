import { A, S } from '../ctx';
import { distanceKm, loadCell, loadIndex, placeCell } from '../data';
import { fmtDate, t } from '../i18n';
import { navigate } from '../router';
import { addHistory, clearHistory, getFavorites, getHistory, removeFavorite, removeHistory, restoreFavorite, saveFavorites, type Favorite, storageAvailable } from '../storage';
import { banner, distanceText, pageHeader } from '../ui/components';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { rowEl } from './list';

export function renderFavorites(host: HTMLElement): void {
  let sort: 'recent' | 'name' | 'distance' = 'recent';
  const status = new Map<string, 'updated' | 'gone'>();
  const paint = (): void => {
    const favs = getFavorites();
    const sorted = [...favs];
    if (sort === 'name') sorted.sort((a, b) => a.place.nm.localeCompare(b.place.nm, 'de'));
    else if (sort === 'distance' && S.userLoc) sorted.sort((a, b) => distanceKm(S.userLoc!, { lat: a.place.la, lng: a.place.ln }) - distanceKm(S.userLoc!, { lat: b.place.la, lng: b.place.ln }));
    const ul = h('ul', { class: 'rows' });
    for (const f of sorted) {
      const li = rowEl({ p: f.place, d: S.userLoc ? distanceKm(S.userLoc, { lat: f.place.la, lng: f.place.ln }) : null }, 0);
      const info = h('span', { class: 'meta fav-meta' }, t('favorites.row.saved_on', { date: fmtDate(f.saved_at) }),
        status.get(f.id) === 'updated' ? ` · ${t('favorites.status.updated')}` : status.get(f.id) === 'gone' ? ` · ${t('favorites.status.unavailable')}` : '');
      li.querySelector('.row-text')?.append(info);
      li.querySelector('.row-actions')?.append(h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${t('favorites.row.remove')}: ${f.place.nm}`, onclick: () => {
        const rem = removeFavorite(f.id); paint();
        A.announce(t('a11y.favorite_removed', { name: f.place.nm }));
        A.toast(t('favorites.toast.removed'), { action: rem ? { label: t('favorites.toast.undo'), run: () => { restoreFavorite(rem); paint(); } } : undefined });
      } }, icon('trash')));
      ul.append(li);
    }
    replace(host, h('div', { class: 'list' },
      pageHeader(t('favorites.title')),
      h('p', { class: 'meta' }, t('favorites.local_note') + ' ' + t('favorites.local_note_loss')),
      !storageAvailable() ? banner('warn', t('errors.storage.unavailable')) : null,
      !S.online && favs.length ? banner('info', t('favorites.offline', { date: fmtDate(favs[0]?.saved_at ?? null) })) : null,
      favs.length > 1 ? h('label', { class: 'sort-label' }, h('span', { class: 'visually-hidden' }, t('favorites.sort.label')),
        (() => { const s = h('select', { class: 'sort', onchange: (e: Event) => { sort = (e.target as HTMLSelectElement).value as typeof sort; paint(); } },
          h('option', { value: 'recent' }, t('favorites.sort.recent')), h('option', { value: 'name' }, t('favorites.sort.name')), S.userLoc ? h('option', { value: 'distance' }, t('favorites.sort.distance')) : null); s.value = sort; return s; })()) : null,
      favs.length ? ul : h('div', { class: 'empty' }, h('h2', null, t('favorites.empty.title')), h('p', null, t('favorites.empty.body')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('/') }, t('favorites.empty.cta')))));
  };
  paint();
  void verify(status, paint);
}

// Abgleich mit dem aktuellen Datenstand: geändert / nicht mehr verfügbar (offline: Schnappschuss bleibt)
async function verify(status: Map<string, 'updated' | 'gone'>, paint: () => void): Promise<void> {
  const favs = getFavorites(); let changed = false; const next: Favorite[] = [];
  try { await loadIndex(); } catch { return; } // ohne Index keine Zellenauflösung (offline: Schnappschuss bleibt)
  for (const f of favs) {
    try {
      const list = await loadCell(placeCell(f.place));
      const cur = list.find((p) => p.id === f.id);
      if (!cur) { status.set(f.id, 'gone'); next.push(f); changed = true; }
      else if (JSON.stringify(cur) !== JSON.stringify(f.place)) { status.set(f.id, 'updated'); next.push({ ...f, place: cur }); changed = true; }
      else next.push(f);
    } catch { next.push(f); }
  }
  if (changed) { saveFavorites(next); paint(); }
}

export function renderHistory(host: HTMLElement): void {
  const paint = (): void => {
    const hist = getHistory();
    replace(host, h('div', { class: 'list' },
      pageHeader(t('history.title'), () => history.back()),
      h('p', { class: 'meta' }, t('search.recent.local_note')),
      hist.length ? h('ul', { class: 'plain-list' }, hist.map((e, i) => h('li', { class: 'hist-row' },
        h('button', { class: 'row-main', type: 'button', onclick: () => { addHistory(e.was, e.wo); A.submitSearch(e.was, e.wo); } }, icon('history'), h('span', null, [e.was, e.wo].filter(Boolean).join(' · '))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('search.recent.remove_aria', { term: [e.was, e.wo].filter(Boolean).join(' · ') }), onclick: () => { removeHistory(i); paint(); } }, icon('close'))))) : h('p', { class: 'nodata' }, t('search.recent.empty')),
      hist.length ? h('button', { class: 'btn', type: 'button', onclick: () => { clearHistory(); A.announce(t('search.recent.cleared')); paint(); } }, icon('trash'), h('span', null, t('search.recent.clear'))) : null));
  };
  paint();
}
