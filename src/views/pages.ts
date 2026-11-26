import { A } from '../ctx';
import { allRegionNames } from '../app-data';
import { CONTACT_EMAIL, TILE_PROVIDER } from '../config';
import { ROUTE_PROVIDERS } from '../provider';
import { getLang, fmtDate, has, t } from '../i18n';
import { loadMeta } from '../data';
import { canInstall, install, onInstallChange } from '../pwa';
import { getRoute, href, navigate } from '../router';
import type { Place } from '../types';
import { findPlace } from '../data';
import { banner, markdown, pageHeader, skeletonRows } from '../ui/components';
import { closeTop, openDialog, closeButton } from '../ui/dialog';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { isIOS, isNative, isStandalone, osmEdit, osmNote } from '../util';

const link = (path: string, label: string, ic: string): HTMLElement => h('li', null, h('a', { class: 'nav-row', href: href(path) }, icon(ic), h('span', null, label), icon('chevronRight', { size: 18 })));

export function renderMore(host: HTMLElement): void {
  const install$ = h('div', { class: 'install' });
  const paintInstall = (): void => {
    if (isStandalone() || isNative()) { replace(install$); return; }
    if (canInstall()) replace(install$, h('div', { class: 'card' }, h('h2', null, t('pwa.install.title')), h('p', { class: 'meta' }, t('pwa.install.body')), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { void install(); } }, icon('download'), h('span', null, t('pwa.install.action')))));
    else if (isIOS()) replace(install$, h('div', { class: 'card' }, h('h2', null, t('pwa.install.title')), h('p', { class: 'meta' }, t('pwa.install.ios_hint'))));
    else replace(install$);
  };
  paintInstall(); onInstallChange(paintInstall);
  replace(host, h('div', { class: 'list' }, pageHeader(t('nav.more.title')),
    h('ul', { class: 'plain-list nav-list' },
      link('/einstellungen', t('nav.more.settings'), 'settings'),
      link('/verlauf', t('history.title'), 'history'),
      link('/datenquellen', t('nav.more.sources'), 'info'),
      link('/hilfe', t('nav.more.help'), 'help'),
      link('/notfall', t('nav.more.emergency'), 'emergency'),
      h('li', null, h('button', { class: 'nav-row', type: 'button', onclick: rateDialog }, icon('star'), h('span', null, t('nav.more.rate_app')), icon('chevronRight', { size: 18 }))),
      link('/impressum', t('nav.more.imprint'), 'note'),
      link('/datenschutz', t('nav.more.privacy'), 'shield')),
    install$));
}

function rateDialog(): void {
  const native = isNative();
  const el = h('div', { class: 'modal' }, h('div', { class: 'modal-card' },
    h('h2', null, t('app_rating.title')), h('p', null, t('app_rating.body')), h('p', { class: 'meta' }, t('app_rating.public_note')),
    native ? h('p', { class: 'meta' }, t('app_rating.opens')) : h('p', { class: 'meta' }, t('app_rating.web_unavailable')),
    h('div', { class: 'row-actions' },
      native ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { const n = (window as unknown as { GOVfindNative?: { rateApp?: () => Promise<void> } }).GOVfindNative; if (!n?.rateApp) throw new Error('no plugin'); await n.rateApp(); closeTop(); } catch { A.toast(t('app_rating.error')); }
      } }, t('app_rating.action')) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => closeTop() }, native ? t('app_rating.later') : t('common.action.close')))));
  openDialog(el, { label: t('app_rating.title') });
}

export function renderEmergency(host: HTMLElement): void {
  const big = (n: '112' | '110' | '115', extra: (string | null)[]): HTMLElement =>
    h('a', { class: ['sos', 'sos-' + n], href: `tel:${n}`, 'aria-label': t(`emergency.${n}.aria`) },
      h('span', { class: 'sos-num' }, t(`emergency.${n}.number`)),
      h('span', { class: 'sos-text' }, h('strong', null, t(`emergency.${n}.label`)), ...extra.map((e) => (e ? h('span', null, e) : null))),
      icon('phone', { size: 28 }));
  replace(host, h('div', { class: 'list emergency' }, pageHeader(t('emergency.title')),
    h('p', { class: 'lead' }, t('emergency.intro')),
    h('div', { class: 'stack' }, big('112', []), big('110', []), big('115', [t('emergency.115.hours'), t('emergency.115.note'), t('emergency.115.region')])),
    h('p', { class: 'meta' }, t('emergency.free_note')), h('p', { class: 'meta' }, t('emergency.offline_note'))));
}

export function renderHelp(host: HTMLElement): void {
  const qs: HTMLElement[] = [];
  for (let i = 1; has(`help.q${i}.q`); i++) qs.push(h('details', { class: 'faq' }, h('summary', null, t(`help.q${i}.q`)), h('p', null, t(`help.q${i}.a`))));
  replace(host, h('div', { class: 'list' }, pageHeader(t('help.h1')), h('p', { class: 'meta' }, t('help.intro')), qs,
    h('section', { class: 'sec' }, h('h2', null, t('help.contact.title')), h('p', null, markdown(contactLine(t('help.contact.body')))))));
}
const contactLine = (s: string): string => (CONTACT_EMAIL ? s.replace('[E-Mail]', CONTACT_EMAIL) : s);

export function renderSources(host: HTMLElement): void {
  const dyn = h('div', null, skeletonRows(2));
  void loadMeta().then((m) => {
    replace(dyn,
      h('section', { class: 'sec' }, h('h2', null, t('sources.stand.title')),
        h('p', null, t('sources.stand.last_update', { datetime: fmtDate(m.built_at, true) })),
        h('p', null, t('sources.stand.osm_extract', { date: fmtDate(m.stand) })),
        h('p', { class: 'meta' }, t('sources.stand.note')),
        h('p', { class: 'meta' }, t('coverage.note', { regions: m.regions.map((r) => `${r.name} (${r.count})`).join(', ') || allRegionNames() }))));
  }).catch(() => replace(dyn, banner('warn', t('errors.generic.title'))));
  const row = (a: (string | Node)[]): HTMLElement => h('tr', null, a.map((c) => h('td', null, c)));
  replace(host, h('div', { class: 'list' }, pageHeader(t('sources.h1')), h('p', null, t('sources.intro')),
    h('section', { class: 'sec' }, h('h2', null, t('sources.table.title')),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, t('sources.table.col_source')), h('th', null, t('sources.table.col_content')), h('th', null, t('sources.table.col_license')))),
        h('tbody', null,
          row([h('span', null, t('sources.table.osm.name'), h('br'), h('span', { class: 'meta' }, t('sources.table.osm.attribution'))), t('sources.table.osm.content'),
            h('span', null, t('sources.table.osm.license'), h('br'), h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, t('sources.table.osm.link')))]),
          row([TILE_PROVIDER.name, t('sources.table.tiles.content'),
            h('span', null, `© OpenMapTiles, © OpenStreetMap contributors. `, h('a', { href: 'https://openfreemap.org/tos/', target: '_blank', rel: 'noopener noreferrer' }, 'openfreemap.org/tos'))]),
          ...(ROUTE_PROVIDERS.walk.enabled ? [row([t('sources.table.route_road.name'), t('sources.table.route_road.content'),
            h('span', null, t('sources.table.route_road.license'), ' ', h('a', { href: ROUTE_PROVIDERS.walk.termsUrl, target: '_blank', rel: 'noopener noreferrer' }, 'fossgis.de'))])] : []),
          ...(ROUTE_PROVIDERS.transit.enabled ? [row([t('sources.table.route_transit.name'), t('sources.table.route_transit.content'),
            h('span', null, t('sources.table.route_transit.license'), ' ', h('a', { href: ROUTE_PROVIDERS.transit.sourcesUrl, target: '_blank', rel: 'noopener noreferrer' }, 'transitous.org/sources'))])] : []))))),
    h('section', { class: 'sec' }, h('h2', null, t('sources.build.title')), h('p', null, t('sources.build.body'))),
    dyn,
    h('section', { class: 'sec' }, h('h2', null, t('sources.how.title')),
      ['no_data', 'hours', 'address', 'names'].map((k) => h('div', null, h('h3', null, t(`sources.how.${k}_title`)), h('p', null, t(`sources.how.${k}_body`))))),
    h('section', { class: 'sec' }, h('h2', null, t('sources.improve.title')), h('p', null, t('sources.improve.body'))),
    h('section', { class: 'sec' }, h('h2', null, t('sources.license.title')), h('p', null, t('sources.license.body').replace(/\s*\[(juristisch prüfen|legal review needed)\]/, ''))),
    h('section', { class: 'sec' }, h('h2', null, t('sources.liability.title')), h('p', null, t('sources.liability.body'))),
    h('section', { class: 'sec' }, h('h2', null, t('sources.contact.title')), h('p', null, markdown(contactLine(t('sources.contact.body'))))),
  ));
}

export function renderImprint(host: HTMLElement): void {
  const keys = ['name', 'address', 'email', 'phone', 'represented', 'register', 'responsible', 'dispute'];
  replace(host, h('div', { class: 'list legal' }, pageHeader(t('legal.imprint.title')),
    h('p', { class: 'banner banner-warn' }, icon('warning', { size: 20 }), h('span', null, t('legal.imprint.draft_marker'))),
    h('h2', null, t('legal.imprint.section_legal')),
    keys.slice(0, 2).map((k) => h('p', null, markdown(t(`legal.imprint.${k}`)))),
    h('h2', null, t('legal.imprint.contact_title')),
    keys.slice(2, 4).map((k) => h('p', null, markdown(t(`legal.imprint.${k}`)))),
    keys.slice(4).map((k) => h('p', null, markdown(t(`legal.imprint.${k}`)))),
    h('p', { class: 'meta' }, t('legal.imprint.sources_note'))));
}

function fillProvider(key: string, s: string): string {
  if (key !== 'legal.privacy.s02.body' && key !== 'legal.privacy.s06.body') return s;
  const p = `${TILE_PROVIDER.name} (Hyperknot Software Kft., Petofi Sandor utca 48., 2724 Ujlengyel, ${getLang() === 'de' ? 'Ungarn' : 'Hungary'})`;
  let o = s.replace(/\[Platzhalter: Anbieter, Anschrift\]/g, p).replace(/\[provider, address\]/g, p)
    .replace(/\[Platzhalter: Anbieter\]/g, `(${TILE_PROVIDER.name})`).replace(/\[Platzhalter: Abschnitt anpassen, sobald der Anbieter feststeht\.\]/g, '');
  if (key === 'legal.privacy.s06.body') o += getLang() === 'de' ? '\nDer Anbieter kann ein Content-Delivery-Network (Cloudflare) einsetzen. [prüfen: aktuelle Datenschutzerklärung des Anbieters]' : '\nThe provider may use a content delivery network (Cloudflare). [check the provider\'s current privacy policy]';
  return o;
}

export function renderPrivacy(host: HTMLElement): void {
  const secs: HTMLElement[] = [];
  for (let i = 1; i <= 20; i++) {
    const k = `legal.privacy.s${String(i).padStart(2, '0')}`;
    if (!has(`${k}.title`)) break;
    secs.push(h('section', { class: 'sec', id: `s${i}` }, h('h2', null, t(`${k}.title`)), markdown(fillProvider(`${k}.body`, t(`${k}.body`)))));
  }
  replace(host, h('div', { class: 'list legal' }, pageHeader(t('legal.privacy.title')),
    h('p', { class: 'banner banner-warn' }, icon('warning', { size: 20 }), h('span', null, t('legal.privacy.draft_marker'))),
    h('p', { class: 'meta' }, markdown(t('legal.privacy.stand'))),
    getLang() !== 'de' ? h('p', { class: 'meta' }, t('legal.privacy.authoritative')) : null, secs));
}

export function renderNotFound(host: HTMLElement): void {
  replace(host, h('div', { class: 'list empty' }, h('h1', null, t('errors.page.404.title')), h('p', null, t('errors.page.404.body')),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('/') }, t('errors.page.404.cta')),
      h('button', { class: 'btn', type: 'button', onclick: () => A.openSearch() }, icon('search'), h('span', null, t('common.action.search'))))));
}

export function renderOfflineFallback(host: HTMLElement): void {
  replace(host, h('div', { class: 'list empty' }, h('h1', null, t('errors.page.offline.title')),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => navigate('/favoriten') }, t('errors.page.offline.favorites')),
      h('button', { class: 'btn', type: 'button', onclick: () => navigate('/notfall') }, t('errors.page.offline.emergency')))));
}

export async function renderReport(host: HTMLElement, id: string, hint: string | null, onLoaded: (p: Place | null) => void): Promise<void> {
  replace(host, h('div', { class: 'place' }, skeletonRows(2)));
  let p: Place | null = null;
  try { p = await findPlace(id, hint); } catch { p = null; }
  if (getRoute().name !== 'report' || getRoute().id !== id) return;
  onLoaded(p);
  const back = (): void => navigate(`/einrichtung/${id}${hint ? '?c=' + hint : ''}`);
  if (!p) { replace(host, h('div', { class: 'place' }, pageHeader(t('report.title'), back), banner('warn', t('place.removed.title')))); return; }
  const place = p;
  let kind = 'address';
  const mail = h('div', { class: 'card', hidden: true });
  if (CONTACT_EMAIL) replace(mail, h('h2', null, t('report.mail.title')), h('p', { class: 'meta' }, t('report.mail.hint')),
    h('a', { class: 'btn', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('report.mail.subject', { name: place.nm }))}` }, icon('mail'), h('span', null, t('report.mail.cta'))), h('p', { class: 'meta' }, t('report.mail.notice')));
  const opts = ['address', 'hours', 'contact', 'gone', 'category', 'other'];
  const fs = h('fieldset', { class: 'fs' }, h('legend', null, t('report.question')), opts.map((o) => {
    const id2 = 'rep-' + o; const inp = h('input', { type: 'radio', name: 'rep', id: id2, value: o, onchange: () => { kind = o; mail.hidden = !(CONTACT_EMAIL && o === 'category'); } });
    inp.checked = o === kind;
    return h('label', { class: 'radio', for: id2 }, inp, h('span', null, t(`report.option.${o}`)));
  }));
  replace(host, h('div', { class: 'place' }, pageHeader(t('report.title'), back), h('p', { class: 'strong', lang: 'de' }, place.nm), fs, h('p', null, t('report.explain')), mail,
    h('div', { class: 'stack' },
      h('a', { class: 'btn btn-primary btn-block', href: osmEdit(place), target: '_blank', rel: 'noopener noreferrer' }, icon('edit'), h('span', null, t('report.cta.edit_osm')), icon('external', { size: 16 })),
      h('a', { class: 'btn btn-block', href: osmNote(place), target: '_blank', rel: 'noopener noreferrer' }, icon('note'), h('span', null, t('report.cta.note_osm')), icon('external', { size: 16 }))),
    h('p', { class: 'meta' }, t('report.leaving_notice'))));
  void closeButton;
}
