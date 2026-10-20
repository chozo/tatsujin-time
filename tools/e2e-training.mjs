// 修行の流れ（遊ぶたびに遅くなる）をブラウザで確かめる: node tools/e2e-training.mjs [URL]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.env.SHOTS ?? 'tools/shots';
const WORLD = 5.0, MAX_SLOW = 10; // src/config.ts と合わせる
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const fails = [];
const check = (ok, label) => { console.log(`${ok ? 'OK ' : 'NG '} ${label}`); if (!ok) fails.push(label); };

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__game);
await page.evaluate(() => window.__game.manual(true));
const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__game.step(dt); }, [n, dt]);
const state = () => page.evaluate(() => window.__game.state());
const text = (sel) => page.locator(sel).textContent();
const visible = (sel) => page.locator(sel).isVisible();
// 画面（.panel）は透明にして隠すので、hidden の有無で見る
const shown = (sel) => page.evaluate((sel) => !document.querySelector(sel).classList.contains('hidden'), sel);

check((await text('#t-progress')).includes('1回目') && (await text('#t-progress')).includes('現実の速さ'), `タイトル：挑戦 1回目・現実の速さ (${await text('#t-progress')})`);
check(!(await visible('#btn-reset-title')), '1回目はタイトルにやり直しボタンを出さない');

// ボットは画面にある一番大きい的を斜めに斬る（破片も狙うので、斬った回数と得点は一致しない）
async function play(no, slow) {
  await page.click(no === 1 ? '#btn-start' : '#btn-next');
  await step(80);
  let st = await state();
  check(st.phase === 'play' && st.slow === slow, `${no}回目：${slow}倍遅い時間で開始 (${st.phase}, ${st.slow})`);
  const feel = WORLD * slow;
  let frame = 0, playReal = 0;
  while (st.phase === 'play' && frame < 60 * feel * 2) {
    const t = st.targets.filter((t) => t.y > 30 && t.y < st.size.H - 30 && t.x > 0 && t.x < st.size.W);
    // 遅いほど狙いやすい人を真似て、斬る頻度を遅さに合わせて上げる
    if (t.length && frame % Math.max(4, Math.round(24 / slow)) === 0) {
      const g = t.sort((a, b) => b.r - a.r)[0];
      const ang = (frame * 0.7) % Math.PI, dx = Math.cos(ang), dy = Math.sin(ang), L = g.r + 50;
      await page.evaluate(({ g, dx, dy, L }) => {
        const G = window.__game;
        G.touchDown(g.x - dx * L, g.y - dy * L);
        for (let i = 1; i <= 6; i++) { const k = i / 6; G.touchMove(g.x - dx * L + 2 * dx * L * k, g.y - dy * L + 2 * dy * L * k); G.step(1 / 60); }
        G.touchUp(g.x + dx * L, g.y + dy * L);
      }, { g, dx, dy, L });
      frame += 6;
    } else { await step(1); frame++; }
    st = await state();
    if (st.phase === 'play') playReal = st.phaseT;
    if (no === 3 && frame === Math.round(60 * feel * 0.6)) await page.screenshot({ path: `${OUT}/training-play.png` });
  }
  check(st.phase === 'end', `${no}回目：体感${feel}秒で終了 (${playReal.toFixed(2)}s)`);
  const sp = await text('#speed');
  check(sp === `ステージ1（${slow === 1 ? '現実の速さ' : `${slow}倍遅い`}）`, `${no}回目：プレイ中の速さの表示 (${sp})`);
  check(Math.abs(playReal - feel) < 0.15, `${no}回目：体感の長さ ≒ ${feel}秒`);
  // 得点は、斬った対象物（破片は数えない）− 当たった数
  const score = st.score;
  check(Number(await text('#count-n')) === score, `${no}回目：画面の得点 = ${score}`);
  await step(Math.round(60 * 1.3) + 2);
  await step(Math.round(60 * 1.1) + 2);
  st = await state();
  check(st.phase === 'replay' && st.replayMode === 'fast', `${no}回目：実際の速さのリプレイ`);
  check((await text('#speed')) === 'リプレイ（実際の時間）', `${no}回目：リプレイの表示 (${await text('#speed')})`);
  let rf = 0;
  while (st.phase === 'replay' && st.worldTime < WORLD) { await step(1); rf++; st = await state(); }
  check(Math.abs(st.phaseT - WORLD) < 0.03, `${no}回目：リプレイが現実の${WORLD}秒 (${st.phaseT.toFixed(3)}s)`);
  check(Number(await text('#count-n')) === score, `${no}回目：リプレイの終わりの得点も ${score}`);
  await step(70);
  st = await state();
  check(st.phase === 'result' && await shown('#tresult') && !(await shown('#result')), `${no}回目：挑戦の結果画面`);
  const objs = Number(await text('#tr-objects')), hits = Number(await text('#tr-hits'));
  check(Number(await text('#tr-score')) === score && score === objs - hits, `${no}回目：得点 ${score} = 斬った ${objs} − 当たった ${hits}`);
  check(st.cuts >= objs, `${no}回目：破片を斬っても得点は増えない（斬った回数 ${st.cuts}、得点になった数 ${objs}）`);
  check((await text('#tr-kicker')).includes(`回目`), `${no}回目：見出し (${await text('#tr-kicker')})`);
  check(!(await page.locator('#tresult button', { hasText: '見る' }).count()), `${no}回目：結果画面にリプレイを見直すボタンはない`);
  const saved = (await page.evaluate(() => window.__game.training.get())).dans[1];
  check(saved.plays === no && saved.best[slow] !== undefined, `${no}回目：記録 (回数 ${saved.plays}, ${slow}倍の最高 ${saved.best[slow]})`);
  if (no === 2 || no === MAX_SLOW + 1) await page.screenshot({ path: `${OUT}/training-result-${no}.png` });
  return score;
}

const scores = [];
for (let no = 1; no <= MAX_SLOW + 1; no++) scores.push(await play(no, Math.min(no, MAX_SLOW)));
console.log('得点', scores.join(' → '));
const totalD1 = Number(await text('#tr-total'));
const lastPerfect = scores[scores.length - 1] === totalD1;
check((await text('#btn-next')).includes('再挑戦') && !(await text('#btn-next')).includes('倍遅く'), `10倍のあとは、それ以上遅くならない (${await text('#btn-next')})`);
check((await text('#tr-next')).includes(lastPerfect ? '極めた' : 'これ以上'), `10倍のあとの案内 (${await text('#tr-next')})`);

let st;

// 再読み込みしても修行の回数が残る
await page.reload();
await page.waitForFunction(() => window.__game);
await page.evaluate(() => window.__game.manual(true));
check((await text('#t-progress')).includes('12回目') && (await visible('#btn-reset-title')), `再読み込み後も記録が残る (${await text('#t-progress')})`);
await page.screenshot({ path: `${OUT}/training-title.png` });
await page.click('#btn-reset-title');
check((await text('#t-progress')).includes('ステージ1') && (await text('#t-progress')).includes('1回目'), 'やり直しでステージ1の1回目に戻る');

// 満点で次の段が開く：ステージ1を4回遊んだことにして、5倍で満点を取る
check((await page.locator('#dan-select button').count()) === 5 && (await page.locator('#dan-select button:disabled').count()) === 4, 'タイトルに段の選択（ステージ1だけ開いている）');
await page.evaluate(() => window.__game.training.set({ dan: 1, unlocked: 1, dans: { 1: { plays: 4, best: {} } } }));
await page.click('#btn-start');
await step(80);
st = await state();
check(st.slow === 5 && st.dan === 1, `ステージ1 五回目は5倍 (${st.slow}倍, 段 ${st.dan})`);
// 斬らずに当たらない的はないので、全部斬れるように一つずつ狙う
while (st.phase === 'play') {
  const t = st.targets.filter((t) => t.y > 10 && t.y < st.size.H - 10 && t.x > 0 && t.x < st.size.W && t.r > 12);
  if (t.length) {
    const g = t.sort((a, b) => b.r - a.r)[0];
    await page.evaluate((g) => { const G = window.__game; G.touchDown(g.x - 60, g.y - 45); for (let i = 1; i <= 6; i++) { G.touchMove(g.x - 60 + 20 * i, g.y - 45 + 15 * i); G.step(1 / 60); } G.touchUp(g.x + 60, g.y + 45); }, g);
  } else await step(1);
  st = await state();
}
const perfect = st.score === st.total;
console.log('ステージ1 五回目の得点', st.score);
await step(60 * (1.3 + 1.1 + WORLD + 1.2));
st = await state();
if (perfect) {
  check(await visible('#btn-dan-next') && (await text('#btn-dan-next')).includes('ステージ2'), `満点で「ステージ2へ進む」が出る (${await text('#tr-next')})`);
  await page.screenshot({ path: `${OUT}/training-perfect.png` });
  await page.click('#btn-dan-next');
  if (!URL.includes('stage=')) { // 説明の画面は果物のステージだけ
    check(await shown('#intro') && (await text('#intro-head')).includes('紙風船'), `ステージ2を初めて遊ぶ前に説明が出る (${await text('#intro-head')})`);
    await page.click('#btn-intro-start');
    check(!(await shown('#intro')), '開始で説明が消える');
  }
  await step(80);
  st = await state();
  check(st.phase === 'play' && st.dan === 2 && st.slow === 1 && st.targets.length >= 0, `ステージ2は現実の速さの一回目から (段 ${st.dan}, ${st.slow}倍)`);
  const saved = await page.evaluate(() => window.__game.training.get());
  check(saved.unlocked === 2 && saved.dan === 2, `ステージ2が開いて記録される (開いた段 ${saved.unlocked})`);
  await page.evaluate(() => window.__game.toTitle());
  check((await page.locator('#dan-select button:disabled').count()) === 3 && (await text('#t-progress')).includes('ステージ2（'), `タイトルでステージ2を選べる (${await text('#t-progress')})`);
} else {
  check(!(await visible('#btn-dan-next')), '満点でなければ次の段へ進めない');
}

// 小さい画面で結果画面が収まるか
const small = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
await small.goto(URL);
await small.waitForFunction(() => window.__game);
await small.evaluate(() => { const G = window.__game; G.manual(true); G.start('training', 3, 2); for (let i = 0; i < 60 * 30; i++) G.step(1 / 60); });
const box = await small.locator('#btn-reset').boundingBox();
check((await small.evaluate(() => window.__game.state().phase)) === 'result' && box && box.y + box.height <= 640, `360×640 で結果画面のボタンが収まる (下端 ${box && Math.round(box.y + box.height)})`);
await small.screenshot({ path: `${OUT}/training-result-small.png` });

check(errors.length === 0, `エラーなし ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(fails.length ? `\n失敗 ${fails.length} 件` : '\nすべて成功');
process.exit(fails.length ? 1 : 0);
