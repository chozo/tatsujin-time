// 果物のステージの決まりを確かめる: node tools/check-rules.mjs [URL]
// 薪は横に振ると弾かれ、縦に振ると割れる。落としても減点しない。
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);
await page.waitForFunction(() => window.__game);
const fails = [];
const check = (ok, label) => { console.log(`${ok ? 'OK ' : 'NG '} ${label}`); if (!ok) fails.push(label); };

const r = await page.evaluate(() => {
  const G = window.__game;
  G.manual(true);
  /** 画面の真ん中あたりに来るまで進めて、その種類の的を返す */
  const waitFor = (kind, used) => {
    for (let f = 0; f < 600; f++) {
      const st = G.state();
      if (st.phase !== 'play' && st.phase !== 'focus') return null;
      const t = st.targets.find((t) => t.kind === kind && !used.has(t.id) && t.y > st.size.H * 0.3 && t.y < st.size.H * 0.7);
      if (t) return t;
      G.step(1 / 60);
    }
    return null;
  };
  const swipe = (x0, y0, x1, y1) => {
    G.touchDown(x0, y0);
    for (let i = 1; i <= 6; i++) { G.touchMove(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6); G.step(1 / 60); }
    G.touchUp(x1, y1);
  };
  const out = {};
  // ステージ5を5倍遅くして、薪を探す
  G.start('training', 5, 5);
  G.drainEvents();
  const used = new Set();
  const maki = waitFor('maki', used);
  out.makiFound = !!maki;
  if (maki) {
    used.add(maki.id);
    const s0 = G.state();
    swipe(maki.x - 90, maki.y, maki.x + 90, maki.y + 4); // 横
    const s1 = G.state();
    const ev = G.drainEvents();
    // 近くの果物を一緒に斬ることがあるので、薪について弾かれたか・斬れていないかを出来事で見る
    out.makiBlocked = ev.some((e) => e.type === 'block' && e.kind === 'maki') && !ev.some((e) => e.type === 'cut' && e.kind === 'maki');
    out.makiEvents = ev.map((e) => `${e.type}:${e.kind}`).join(',');
    const m2 = s1.targets.find((t) => t.id === maki.id);
    out.makiStill = !!m2;
    if (m2) swipe(m2.x + 3, m2.y - 90, m2.x - 3, m2.y + 90); // 縦
    const s2 = G.state();
    out.makiCut = s2.cuts > s1.cuts && s2.score === s1.score + 1;
  }
  // 斬らずに最後まで：落としても減点しない
  G.start('training', 1, 5);
  while (G.state().phase !== 'end') G.step(1 / 60);
  const st = G.state();
  out.dropHits = st.hits;
  out.dropScore = st.score;
  out.total = st.total;
  return out;
});
console.log(r);
check(r.makiFound && r.makiBlocked && r.makiStill, '薪を横に振ると弾かれて、割れない');
check(r.makiCut, '薪を縦に振ると割れて＋1点');
check(r.dropHits === 0 && r.dropScore === 0, `斬らずに終えても減点しない（減点 ${r.dropHits}、得点 ${r.dropScore}、出てきた数 ${r.total}）`);
check(errors.length === 0, `エラーなし ${errors.join(' | ')}`);
await browser.close();
console.log(fails.length ? `\n失敗 ${fails.length} 件` : '\nすべて成功');
process.exit(fails.length ? 1 : 0);
