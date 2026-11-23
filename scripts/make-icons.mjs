// Rendert public/icons/*.svg zu PNG (192, 512, maskable 512, apple-touch 180) mit playwright-core + installiertem Chrome.
// Aufruf: npm run icons   (einmalig nötig, PNGs sind eingecheckt)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const jobs = [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['icon-maskable.svg', 'icon-maskable-512.png', 512], ['icon-maskable.svg', 'apple-touch-icon.png', 180]];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [src, out, size] of jobs) {
  const svg = readFileSync(join(dir, src), 'utf8');
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</body>`);
  writeFileSync(join(dir, out), await page.screenshot({ type: 'png', omitBackground: true }));
  await page.close();
}
await browser.close();
console.log('Icons erzeugt');
