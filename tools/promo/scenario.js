// 「達人の時間」の告知動画の台本。
// 流れ：ステージ1の1回目（現実の速さ）は空振りばかりで1個だけ → 結果画面「すべて斬れなければ再挑戦」
// → 2回目は2倍遅く見えて、さっきより斬れる → 5回目は5倍遅く、全部斬れる → 本来の速さのリプレイ
// → ステージが上がるごとに難しくなる（ステージ2〜5のプレイ画面）→ ゲームの紹介（エンドカード）。
// 斬る気持ちよさはゲームの中の斬る場面だけで伝える（効果文字・フラッシュ・ズームなどの演出は入れない）。
// 使える操作はスキルの references/scenario-api.md。

export const config = {
  slug: 'tatsujin-time',
  url: 'https://game.chozo.net/tatsujin-time/',
  orientation: 'portrait',
  game: { width: 390, height: 693 }, // ゲーム画面は 9:16
  serveDir: 'dist',
  gamePath: '/tatsujin-time/',
  // 上の字幕と下の字幕の場所を空けるため、ゲーム画面を少し小さく、少し上に置く
  layout: { centerX: 0.47, centerY: 0.44, maxW: 0.72, maxH: 0.52 },
  duration: [28, 33],
  // 静かなBGM（tools/promo/make-bgm.mjs でコードから作った、打楽器のないやわらかい和音。音源ファイルは使わない）
  music: { file: 'tools/promo/bgm.wav', volume: 0.6 },
  // 落ち着いた音量にする（既定の -14 より静かに）
  loudness: -17,
};

/** 字幕の場所（画面に対する割合）。上はアプリの表示（上8%）、下は説明文（下20%）を避ける */
const TOP = 0.125;
const BOTTOM = 0.75;

/** 挑戦の記録を「dan のステージを play 回目に遊ぶところ」にして始める（ゲームの表示と合わせる） */
async function begin(p, dan, play, slow, unlocked = 5) {
  await p.eval(([dan, play, unlocked]) => {
    window.__game.training.set({ dan, unlocked, dans: { [dan]: { plays: play - 1, best: {} } } });
  }, [dan, play, unlocked]);
  await p.call('start', 'training', slow, dan);
}

/**
 * 画面の中の、まだ斬っていないものを、下にあるものから斬っていく（撮影しながら）。
 * gap は一振りごとの間（人の反応の遅さ）。薪は縦に振る。
 */
async function slash(p, sec, { gap = 0, dur = 0.12, minY = 0.16, maxY = 0.84, horizontalMaki = false } = {}) {
  const end = p.time + sec;
  let k = 0;
  while (p.time < end - 1e-6) {
    const left = end - p.time;
    const s = await p.state();
    if (!s || s.phase !== 'play') { await p.wait(Math.min(0.1, left)); continue; }
    const { W, H } = s.size;
    const c = s.targets.filter((t) => t.whole && t.y > H * minY && t.y < H * maxY && t.x > 8 && t.x < W - 8);
    if (!c.length) { await p.wait(Math.min(0.1, left)); continue; }
    const t = c.sort((a, b) => b.y - a.y)[0];
    const d = Math.min(dur, left);
    if (t.kind === 'maki' && !horizontalMaki) await p.drag([[t.x + 3, t.y - 80], [t.x - 3, t.y + 80]], d);
    else if (t.kind === 'maki') await p.drag([[t.x - 85, t.y + 2], [t.x + 85, t.y - 2]], d);
    else { const dx = (k++ % 2 ? 1 : -1) * 66; await p.drag([[t.x - dx, t.y - 48], [t.x + dx, t.y + 48]], d); }
    if (gap) await p.wait(Math.min(gap, Math.max(0, end - p.time)));
  }
}

/**
 * 撮らずに、プレイの終わりまで全部斬りながら進める（見せない区間）。音と出来事は捨てる。
 * リプレイで斬る瞬間がよく見えるよう、画面の中ほど（上から30〜62%）まで落ちてきてから斬る。
 */
async function cutAllUntilEnd(p, until = Infinity) {
  await p.eval((until) => {
    const G = window.__game;
    const q = 1 / 600;
    const line = (x0, y0, x1, y1) => { G.touchDown(x0, y0); for (let i = 1; i <= 6; i++) { G.touchMove(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6); G.step(q); } G.touchUp(x1, y1); };
    for (let f = 0; f < 8000; f++) {
      const s = G.state();
      if (s.phase !== 'play' || s.worldTime >= until) break;
      for (const t of s.targets.filter((t) => t.whole && t.y > s.size.H * 0.3 && t.y < s.size.H * 0.62 && t.x > 4 && t.x < s.size.W - 4)) {
        if (t.kind === 'maki') line(t.x + 2, t.y - 70, t.x - 2, t.y + 70);
        else line(t.x - 50, t.y - 40, t.x + 50, t.y + 40);
      }
      G.step(1 / 60);
    }
    G.audio.drain();
    G.drainEvents();
  }, until);
}

/**
 * 空振り：落ちてくるものの少し上（もう通り過ぎた場所）を振る。
 * 振る線の近くにほかの果物があるときは振らない（間違って斬らないように）
 */
async function whiff(p, sec, gap = 0.35) {
  const end = p.time + sec;
  let k = 0;
  while (p.time < end - 1e-6) {
    const s = await p.state();
    const all = (s?.targets ?? []).filter((t) => t.whole);
    const c = all.filter((t) => t.y > s.size.H * 0.3 && t.y < s.size.H * 0.75);
    if (s?.phase === 'play' && c.length) {
      const t = c[0];
      const dx = (k++ % 2 ? 1 : -1) * 55;
      const y0 = t.y - 165, y1 = t.y - 110;
      // 線が通る範囲（落ちる分も見込んで下に広め）に果物がなければ振る
      const clear = all.every((o) => o.x < t.x - Math.abs(dx) - 60 || o.x > t.x + Math.abs(dx) + 60 || o.y < y0 - 70 || o.y > y1 + 90);
      if (clear) await p.drag([[t.x - dx, y0], [t.x + dx, y1]], Math.min(0.12, end - p.time));
    }
    await p.wait(Math.min(gap, Math.max(0, end - p.time)));
  }
}

export default async function scenario(p) {
  await p.seed(7);
  // 効果音はゲームの音をそのまま使う

  // ---- 1回目：現実の速さ。空振りばかりで1個だけ ----
  await begin(p, 1, 1, 1, 1); // まだステージ1しか開いていない
  await p.skip(1.1 + 0.15);
  p.caption('頭上から落ちてくる果物を\nすべて斬れ！', { y: TOP, dur: 3.0, size: 38 });
  await whiff(p, 1.6);
  // 1個だけ斬る：現実の速さでは振る間にも果物が落ちるので、落ちる向きに合わせて斜め下へ振る。斬れるまで振り直す
  for (let i = 0; i < 6 && (await p.state()).score < 1; i++) {
    const s = await p.state();
    const t = s.targets.filter((t) => t.whole && t.y > s.size.H * 0.3 && t.y < s.size.H * 0.6).sort((a, b) => b.y - a.y)[0];
    if (t) await p.drag([[t.x - 75, t.y + 5], [t.x + 75, t.y + 85]], 0.1);
    else await p.wait(0.1);
  }
  await whiff(p, 1.0);
  p.caption('1個しか斬れない…', { y: BOTTOM, dur: 1.6, size: 44, color: '#ffb0a0' });
  await whiff(p, 1.5);
  console.log(`  1回目に斬った数: ${(await p.state()).score}`);
  // 結果画面まで進める（リプレイは見せない）
  await p.skip(10);
  await p.until((s) => s?.phase === 'result', { max: 1 });
  p.caption('すべて斬れなければ\n再挑戦！', { y: TOP, dur: 2.0, size: 40 });
  await p.wait(2.0);

  // ---- 2回目：2倍遅く見える。さっきより斬れる ----
  await begin(p, 1, 2, 2, 1);
  await p.skip(1.1 + 0.45);
  p.caption('さっきの挑戦で腕が上がり\nゆっくり見える！', { y: TOP, dur: 2.2, size: 38 });
  await slash(p, 2.2, { gap: 0.2, dur: 0.12 });
  p.caption('2回目は2倍遅く\nさっきより斬れる！', { y: BOTTOM, dur: 2.0, size: 38 });
  await slash(p, 2.0, { gap: 0.2, dur: 0.12 });

  // ---- 5回目：5倍遅く見える。全部斬れる ----
  await begin(p, 1, 5, 5, 1);
  await p.skip(1.1);
  // 果物がたくさん重なる時刻（ゲーム内2.9秒）まで、撮らずに全部斬って進める
  await cutAllUntilEnd(p, 2.9);
  p.caption('挑戦を重ねるごとに\nゆっくり見える！', { y: TOP, dur: 2.3, size: 40 });
  await slash(p, 2.3, { gap: 0.04, dur: 0.12, minY: 0.25 });
  p.caption('5回目は5倍遅く\nこれなら全部斬れる！', { y: BOTTOM, dur: 2.3, size: 38, color: '#ffe9b0' });
  await slash(p, 2.3, { gap: 0.04, dur: 0.12, minY: 0.25 });
  await cutAllUntilEnd(p); // 残りも全部斬る（撮らない）
  await p.skip(1.3 + 1.1 + 0.35); // 「そこまで」「リプレイ（実際の時間）」と、最初の果物が画面に入るまで

  // ---- 本来の速さで見ると… ----
  p.caption('本来の速さで見ると…', { y: TOP, dur: 3.6, size: 42 });
  await p.wait(3.6);
  await p.skip(2.5);
  await p.until((s) => s?.phase === 'result', { max: 1 });
  p.caption('すべて斬った！', { y: TOP, dur: 1.3, size: 46, color: '#ffe9b0' });
  await p.wait(1.3);

  // ---- ステージが上がるごとに難しくなる ----
  const stages = [
    [2, 'ステージ2\nゆっくり落ちる紙風船', 4.0 + 1.2],
    [3, 'ステージ3\n速く落ちる栗', 3.4 + 1.6],
    [4, 'ステージ4\n薪は縦にしか斬れない', 3.0 + 1.0],
    [5, 'ステージ5\nすべての経験をかけろ', 3.6 + 0.6],
  ];
  for (const [dan, text, skip] of stages) {
    await begin(p, dan, 5, 5);
    await p.skip(1.1 + skip);
    if (dan === 2) p.caption('ステージが上がるごとに\n難しくなる', { y: TOP, dur: 2.0, size: 40 });
    p.caption(text, { y: BOTTOM, dur: 2.0, size: 38 });
    if (dan === 4) {
      // 薪を横に振ると弾かれ、縦に振ると割れる
      await slash(p, 0.8, { gap: 0.08, dur: 0.12, minY: 0.25, horizontalMaki: true });
      await slash(p, 1.2, { gap: 0.08, dur: 0.12, minY: 0.25 });
    } else await slash(p, 2.0, { gap: 0.08, dur: 0.12, minY: 0.25 });
  }

  // ---- ゲームの紹介 ----
  p.endCard({ title: '達人の時間', sub: '挑戦を重ねるほど\n時がゆっくり見えてくる\nスマホでもPCでも遊べる', cta: '今すぐ遊べる！', dur: 3.2 });
  await p.wait(3.2);
}
