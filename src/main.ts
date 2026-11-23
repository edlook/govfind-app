import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/800.css';
import './style.css';
import { initApp, notifyUpdate } from './app';
import { detectLang, setLang } from './i18n';
import { parseLocation } from './router';
import { getSettings } from './storage';

async function boot(): Promise<void> {
  const prefix = parseLocation().langPrefix;
  await setLang(prefix ?? detectLang(getSettings().lang));
  registerSW();
  try { await initApp(); }
  catch (e) {
    console.error(e);
    const el = document.getElementById('shell');
    if (el) { el.textContent = ''; const p = document.createElement('p'); p.className = 'fatal'; p.textContent = 'Etwas ist schiefgelaufen. / Something went wrong.'; const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Neu laden / Reload'; b.addEventListener('click', () => location.reload()); el.append(p, b); }
  }
}

function registerSW(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then((reg) => {
    const offer = (w: ServiceWorker): void => notifyUpdate(() => { w.postMessage('skip-waiting'); });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => undefined);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
}

void boot();
