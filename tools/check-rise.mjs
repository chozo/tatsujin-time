// 画面の下半分で上へ動くもの（跳ね返って見えるもの）がないかを測る: node tools/check-rise.mjs [URL]
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL);
await page.waitForFunction(() => window.__game);
const rises = await page.evaluate(() => {
  const G = window.__game;
  G.manual(true);
  G.start('master');
  for (let i = 0; i < 80; i++) G.step(1 / 60);
  const last = new Map();
  const out = [];
  let f = 0;
  while (G.state().phase === 'play' && f < 2000) {
    const st = G.state();
    // 4コマごとに一番大きな的を横に斬る（破片の動きも見る）
    if (f % 20 === 0 && st.targets.length) {
      const g = st.targets.sort((a, b) => b.r - a.r)[0];
      G.touchDown(g.x - g.r - 40, g.y);
      for (let i = 1; i <= 4; i++) { G.touchMove(g.x - g.r - 40 + (2 * (g.r + 40) * i) / 4, g.y - i * 6); G.step(1 / 60); f++; }
      G.touchUp(g.x + g.r + 40, g.y - 24);
    }
    G.step(1 / 60); f++;
    for (const t of G.state().targets) {
      const p = last.get(t.id);
      if (p !== undefined && t.y > st.size.H * 0.5 && p - t.y > 1.5) out.push({ id: t.id, kind: t.kind, y: Math.round(t.y), dy: +(p - t.y).toFixed(1) });
      last.set(t.id, t.y);
    }
  }
  return out;
});
const ids = [...new Set(rises.map((r) => `${r.kind}#${r.id}`))];
console.log(`下半分で上へ動いたもの: ${ids.length} 個 ${ids.join(', ')}`);
await browser.close();
process.exit(ids.length ? 1 : 0);
