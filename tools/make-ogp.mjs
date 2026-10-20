// OGP画像（1200×630）を書き出す: node tools/make-ogp.mjs
// 文言やレイアウトは tools/ogp/ogp.html、ゲーム画面は tools/ogp/before.png（ステージ5・斬る前）と after.png（同じ場面・斬った瞬間）。
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const html = fileURLToPath(new URL('./ogp/ogp.html', import.meta.url));
const out = fileURLToPath(new URL('../public/ogp.png', import.meta.url));
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto('file://' + html);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
await p.screenshot({ path: out });
await b.close();
console.log('書き出し', out);
