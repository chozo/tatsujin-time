// ブラウザで通しプレイを確認する: node tools/e2e.mjs [URL]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

// 「常人の目→達人の目」の流れ（?flow=pair）を確かめる。修行の流れは tools/e2e-training.mjs
const URL = process.argv[2] ?? 'http://localhost:5173/?flow=pair';
const OUT = process.env.SHOTS ?? 'tools/shots';
// src/config.ts と合わせる
const WORLD = 5.0, SLOW = 0.2;
const FEEL = WORLD / SLOW;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});

const fails = [];
const check = (ok, label) => { console.log(`${ok ? 'OK ' : 'NG '} ${label}`); if (!ok) fails.push(label); };

async function run(name, viewport, shots) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => window.__game.manual(true));
  const box = await page.locator('#app').boundingBox();
  check(box.height <= viewport.height + 0.5 && box.width <= viewport.width + 0.5, `${name}: 画面に収まる ${Math.round(box.width)}x${Math.round(box.height)}`);
  if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}-title.png` }); }

  const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__game.step(dt); }, [n, dt]);
  const state = () => page.evaluate(() => window.__game.state());

  // 1回のプレイ：ボットが一番近い的を斜めに斬る。len は体感の長さ（秒）
  async function playRound(label, len) {
    await step(80);
    if (shots) await page.waitForTimeout(1300);
    let st = await state();
    check(st.phase === 'play', `${name}: ${label}のプレイ開始 (${st.phase})`);
    let frame = 0, shot = false, playReal = 0;
    while (st.phase === 'play' && frame < 60 * len * 2) {
      const t = st.targets.filter((t) => t.y > 30 && t.y < st.size.H - 30 && t.x > 0 && t.x < st.size.W);
      if (t.length && frame % 4 === 0) {
        const g = t.sort((a, b) => b.r - a.r)[0];
        const ang = (frame * 0.7) % Math.PI;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const L = g.r + 50;
        await page.evaluate(({ g, dx, dy, L }) => {
          const G = window.__game;
          G.touchDown(g.x - dx * L, g.y - dy * L);
          for (let i = 1; i <= 6; i++) {
            const k = i / 6;
            G.touchMove(g.x - dx * L + 2 * dx * L * k, g.y - dy * L + 2 * dy * L * k);
            G.step(1 / 60);
          }
          G.touchUp(g.x + dx * L, g.y + dy * L);
        }, { g, dx, dy, L });
        frame += 6;
      } else {
        await step(1);
        frame++;
      }
      st = await state();
      if (st.phase === 'play') playReal = st.phaseT;
      if (shots && !shot && st.worldTime > WORLD * 0.75) {
        shot = true;
        await page.screenshot({ path: `${OUT}/${name}-${st.playMode}.png` });
      }
    }
    check(st.phase === 'end', `${name}: ${label}が体感${len}秒で終了 (${st.phase}, frame ${frame})`);
    check(Math.abs(playReal - len) < 0.12, `${name}: ${label}の長さ ≒ ${len}秒 (${playReal.toFixed(2)}s)`);
    check(st.cuts >= 3, `${name}: ${label}で斬れた (${st.cuts}斬)`);
    return st.cuts;
  }

  // 常人の目（現実の速さ）
  await page.click('#btn-start');
  let st = await state();
  check(st.playMode === 'normal', `${name}: 最初は常人の目 (${st.playMode})`);
  const normalCuts = await playRound('常人の目', WORLD);
  await step(Math.round(60 * 1.3) + 2);
  st = await state();
  check(st.phase === 'interlude', `${name}: 常人の目のあと中間画面 (${st.phase})`);
  check(await page.locator('#i-cuts').textContent() === String(normalCuts), `${name}: 中間画面の斬数`);
  if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}-interlude.png` }); }

  // 達人の目（遅い時間）
  await page.click('#btn-master');
  st = await state();
  check(st.playMode === 'master', `${name}: 次は達人の目 (${st.playMode})`);
  const masterCuts = await playRound('達人の目', FEEL);

  await step(Math.round(60 * 1.3) + 2);
  st = await state();
  check(st.phase === 'replayIntro', `${name}: リプレイ前の見出し (${st.phase})`);
  await step(Math.round(60 * 1.1) + 2);
  st = await state();
  check(st.phase === 'replay' && st.replayMode === 'fast', `${name}: リプレイ開始`);
  let rf = 0;
  while (st.phase === 'replay' && st.worldTime < WORLD) { await step(1); rf++; st = await state();
    if (shots && rf === Math.round(60 * WORLD * 0.7)) await page.screenshot({ path: `${OUT}/${name}-replay.png` }); }
  check(Math.abs(st.phaseT - WORLD) < 0.03, `${name}: リプレイが現実の${WORLD}秒 (${st.phaseT.toFixed(3)}s)`);
  await step(70);
  st = await state();
  check(st.phase === 'result', `${name}: 2回目のリプレイなしで結果画面 (${st.phase})`);
  check(await page.locator('#r-normal').textContent() === String(normalCuts) && await page.locator('#r-master').textContent() === String(masterCuts),
    `${name}: 結果に両方の斬数 (${normalCuts} → ${masterCuts})`);
  if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}-result.png` }); }

  await page.click('#btn-fast');
  await step(Math.round(60 * (1.1 + WORLD + 1.0)) + 10);
  st = await state();
  check(st.phase === 'result', `${name}: もう一度見る（${WORLD}秒）のあと結果へ (${st.phase})`);

  await page.click('#btn-slow');
  await step(300);
  st = await state();
  check(st.phase === 'replay' && Math.abs(st.worldTime - 300 / 60 * SLOW) < 0.02, `${name}: 達人の目リプレイ (t=${st.worldTime.toFixed(3)})`);
  await step(Math.round(60 * FEEL) + 100 - 300);
  st = await state();
  check(st.phase === 'result', `${name}: 達人の目のあと結果へ`);

  await page.click('#btn-retry-master');
  await step(80);
  st = await state();
  check(st.phase === 'play' && st.playMode === 'master' && st.cuts === 0, `${name}: 達人の目でもう一度`);
  await page.evaluate(() => window.__game.toTitle());
  await page.click('#btn-start');
  await step(80);
  st = await state();
  check(st.phase === 'play' && st.playMode === 'normal', `${name}: 最初から（常人の目）`);
  check(errors.length === 0, `${name}: エラーなし ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}

await run('phone', { width: 390, height: 844 }, true);
await run('small', { width: 360, height: 640 }, false);
await run('pc', { width: 1280, height: 800 }, true);
await browser.close();
console.log(fails.length ? `\n失敗 ${fails.length} 件` : '\nすべて成功');
process.exit(fails.length ? 1 : 0);
