import { A, S } from '../ctx';
import { APP_VERSION } from '../config';
import { loadMeta } from '../data';
import { LANGS, LANG_META, detectLang, fmtDate, getLang, isMachine, setLang, t } from '../i18n';
import { getRoute, replaceQuery } from '../router';
import { clearAllLocal, clearHistory, getSettings, setSettings, type Settings } from '../storage';
import { pageHeader } from '../ui/components';
import { confirmDialog } from '../ui/dialog';
import { h, replace } from '../ui/dom';

function radios<T extends string>(name: string, legend: string, opts: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  return h('fieldset', { class: 'fs' }, h('legend', null, legend),
    opts.map(([v, label]) => {
      const id = `${name}-${v}`;
      const input = h('input', { type: 'radio', name, id, value: v, onchange: () => onChange(v) });
      input.checked = v === value;
      return h('label', { class: 'radio', for: id }, input, h('span', null, label));
    }));
}

export async function changeLanguage(setting: string): Promise<void> {
  setSettings({ lang: setting });
  await setLang(detectLang(setting));
  const r = getRoute();
  replaceQuery(r.path + (r.q.toString() ? '?' + r.q.toString() : ''));
  A.refreshAll();
}

export function renderSettings(host: HTMLElement): void {
  const st = getSettings();
  const paint = (): void => renderSettings(host);
  const langFilter = h('input', { type: 'search', class: 'input', 'aria-label': t('settings.language.search_placeholder'), placeholder: t('settings.language.search_placeholder'), autocomplete: 'off', enterkeyhint: 'search' });
  const langList = h('div', { class: 'langs' });
  const paintLangs = (): void => {
    const q = langFilter.value.trim().toLowerCase();
    const items: [string, string][] = [['system', t('settings.language.system')], ...LANGS.map((c) => [c, LANG_META[c]!.name] as [string, string])];
    replace(langList, items.filter(([c, n]) => !q || n.toLowerCase().includes(q) || c === q).map(([c, n]) => {
      const id = 'lang-' + c;
      const input = h('input', { type: 'radio', name: 'lang', id, value: c, onchange: () => { void changeLanguage(c).then(paint); } });
      input.checked = c === getSettings().lang;
      return h('label', { class: 'radio', for: id }, input, h('span', { lang: c === 'system' ? undefined : c }, n), c !== 'system' && isMachine(c) ? h('small', { class: 'meta' }, ` · ${t('settings.language.machine_note')}`) : null);
    }));
  };
  langFilter.addEventListener('input', paintLangs);
  paintLangs();

  const locBox = h('p', { class: 'meta', role: 'status' });
  const locText = (s: string): string => (s === 'granted' ? t('settings.location.granted') : s === 'denied' ? t('settings.location.denied') : t('settings.location.not_asked'));
  locBox.textContent = locText(S.geo === 'granted' ? 'granted' : S.geo === 'denied' ? 'denied' : 'prompt');
  void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((r) => { locBox.textContent = locText(r.state); }).catch(() => undefined);

  const done = h('p', { class: 'meta', role: 'status' });
  const dataMeta = h('p', { class: 'meta' });
  void loadMeta().then((m) => { dataMeta.textContent = t('settings.about.data_stand', { date: fmtDate(m.stand) }); }).catch(() => undefined);

  replace(host, h('div', { class: 'list settings' },
    pageHeader(t('settings.title')),
    h('section', { class: 'sec' }, h('h2', null, t('settings.language.title')), langFilter, langList),
    h('section', { class: 'sec' }, h('h2', null, t('settings.theme.title')),
      radios<Settings['theme']>('theme', t('settings.theme.title'), [['system', t('settings.theme.system')], ['light', t('settings.theme.light')], ['dark', t('settings.theme.dark')]], st.theme, (v) => { setSettings({ theme: v }); A.applyTheme(); })),
    h('section', { class: 'sec' }, h('h2', null, t('settings.units.title')),
      radios<Settings['units']>('units', t('settings.units.title'), [['km', t('settings.units.km')], ['mi', t('settings.units.mi')]], st.units, (v) => { setSettings({ units: v }); A.refreshAll(); })),
    h('section', { class: 'sec' }, h('h2', null, t('settings.text_size.title')), h('p', { class: 'meta' }, t('settings.text_size.note'))),
    h('section', { class: 'sec' }, h('h2', null, t('settings.location.title')), locBox, h('p', { class: 'meta' }, t('settings.location.note')),
      h('details', null, h('summary', null, t('settings.location.change')), h('p', { class: 'meta' }, t('errors.geo.help.ios')), h('p', { class: 'meta' }, t('errors.geo.help.android')), h('p', { class: 'meta' }, t('errors.geo.help.browser')))),
    h('section', { class: 'sec' }, h('h2', null, t('settings.motion.title')),
      radios<Settings['motion']>('motion', t('settings.motion.title'), [['system', t('settings.motion.system')], ['on', t('settings.motion.on')]], st.motion, (v) => { setSettings({ motion: v }); A.applyTheme(); })),
    h('section', { class: 'sec' }, h('h2', null, t('settings.data.title')), h('p', { class: 'meta' }, t('settings.data.note')),
      h('div', { class: 'stack' },
        h('button', { class: 'btn', type: 'button', onclick: () => { clearHistory(); done.textContent = t('settings.data.done'); } }, t('settings.data.clear_history')),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* kein Cache */ } done.textContent = t('settings.data.done'); } }, t('settings.data.clear_cache')),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => confirmDialog(t('settings.data.clear_all_confirm'), t('settings.data.clear_all'), () => { clearAllLocal(); void setLang(detectLang('system')).then(() => { A.applyTheme(); A.refreshAll(); A.toast(t('settings.data.done')); }); }) }, t('settings.data.clear_all'))),
      done),
    h('section', { class: 'sec' }, h('p', { class: 'meta' }, t('settings.about.version', { version: APP_VERSION })), dataMeta)));
  void getLang;
}
