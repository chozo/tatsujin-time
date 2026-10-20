// 常人の目と達人の目で、飛んでくるもの（落ちてくる葉）がまったく同じかを確かめる: node tools/check-same.mjs [URL]
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(process.argv[2] ?? 'http://localhost:5173/');
await page.waitForFunction(() => window.__game);
// 斬らずに、常人の目と達人の目で同じゲーム内時刻の位置を記録する
const run = (mode) => page.evaluate((mode) => {
  const G = window.__game; G.manual(true); G.start(mode);
  const scale = mode === 'normal' ? 1 : 0.2;
  const snaps = {};
  let guard = 0;
  while (G.state().phase !== 'end' && guard++ < 100000) {
    G.step(mode === 'normal' ? 1 / 600 : 1 / 120);
    const s = G.state();
    if (s.phase !== 'play') continue;
    const k = s.step;
    if (!(k in snaps)) snaps[k] = s.targets.map((t) => [t.kind, t.x.toFixed(3), t.y.toFixed(3)].join(':')).join(' ');
  }
  return { snaps, hits: G.state().hits, step: G.state().step };
}, mode);
const a = await run('normal'), m = await run('master');
let same = 0, diff = 0;
for (const k of Object.keys(a.snaps)) { if (k in m.snaps) { a.snaps[k] === m.snaps[k] ? same++ : (diff++, console.log('差', k, '\n', a.snaps[k], '\n', m.snaps[k])); } }
console.log(`比べた時刻 ${same + diff} 個、一致 ${same}、不一致 ${diff}`);
console.log(`被弾（斬らない場合） 常人 ${a.hits} / 達人 ${m.hits}、ステップ数 ${a.step} / ${m.step}`);
await b.close();
