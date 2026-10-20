import { createAudio } from './audio';
import { createGame, type Phase } from './game';
import { CONFIG } from './config';
import { DANS, makeStage } from './stage';
import { danCount, danName, danRecord, emptyTraining, loadTraining, recordPlay, saveTraining, slowFor, type TrainingSave } from './training';

// 画面の秒数は設定から作る
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const realSec = CONFIG.worldDuration;
const feelSec = CONFIG.worldDuration / CONFIG.slowScale;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const msg = $('msg');
const speedEl = $('speed'), introP = $('intro');
const tFeel = $('t-feel'), tReal = $('t-real'), countN = $('count-n');
const titleP = $('title'), resultP = $('result'), interP = $('interlude'), tresultP = $('tresult');
const isTraining = CONFIG.flow === 'training';
const slowText = (slow: number) => (slow === 1 ? '現実の速さ' : `時が${slow}倍遅く見える`);
let training: TrainingSave = loadTraining();

function flash(html: string) {
  msg.innerHTML = html;
  msg.classList.remove('show');
  void msg.offsetWidth;
  msg.classList.add('show');
}

const audio = createAudio();
const confetti = createConfetti($<HTMLCanvasElement>('confetti'), () => audio.play('taiko'));
const game = createGame(app, $<HTMLCanvasElement>('gl'), $<HTMLCanvasElement>('fx'), {
  setTimes(feel, real) {
    tFeel.textContent = Math.max(0, feel).toFixed(1);
    tReal.textContent = real.toFixed(3);
  },
  setCount(n) { countN.textContent = String(n); },
  setPhase(p: Phase, info = {}) {
    titleP.classList.toggle('hidden', p !== 'title');
    resultP.classList.toggle('hidden', p !== 'result' || isTraining);
    tresultP.classList.toggle('hidden', p !== 'result' || !isTraining);
    if (p === 'title' && isTraining) updateTitle();
    interP.classList.toggle('hidden', p !== 'interlude');
    app.classList.toggle('slowview', p === 'replay' && info.mode === 'slow');
    if (p === 'focus' && info.mode === 'training') {
      const slow = Number(info.slow);
      const no = danRecord(training).plays + 1;
      flash(slow === 1 ? `${danName(training.dan)}<br>${no}回目<small>現実の速さ</small>` : `達人の時間<small>${danName(training.dan)}<br>${no}回目・時が${slow}倍遅く流れる</small>`);
    } else if (p === 'focus') flash(info.mode === 'normal' ? `常人の目<small>現実の${fmt(realSec)}秒</small>` : '達人の時間<small>時が、遅くなる</small>');
    if (p === 'end') flash('そこまで');
    if (p === 'end' && info.mode === 'training') {
      // 最後まで遊んだら記録する（リプレイを飛ばしても数える）
      training = recordPlay(training, Number(info.dan), Number(info.slow), Number(info.score), Number(info.total));
      saveTraining(training);
    }
    if (p === 'replayIntro') flash('リプレイ<small>（実際の時間）</small>');
    if (p === 'replay' && info.mode === 'slow') flash('達人の目<small>体感の速さで見る</small>');
    // 画面上部の時計の下に、いまの時間の速さを出し続ける
    if (p === 'focus') {
      const slow = Number(info.slow);
      const speed = slow <= 1 ? '現実の速さ' : `${slow}倍遅い`;
      // 修行では「ステージ1（四倍遅い）」のように、ステージも出す
      speedEl.textContent = info.mode === 'training' ? `${danName(training.dan)}（${speed}）` : speed;
    }
    if (p === 'replayIntro') speedEl.textContent = 'リプレイ（実際の時間）';
    if (p === 'replay') speedEl.textContent = info.mode === 'slow' ? 'リプレイ（体感の速さ）' : 'リプレイ（実際の時間）';
    if (p === 'interlude' || p === 'result') msg.classList.remove('show');
    if (p === 'interlude') {
      $('i-cuts').textContent = String(info.cuts);
      $('i-objects').textContent = String(info.objects);
      $('i-total').textContent = String(info.total);
      $('i-hits').textContent = isMissiles && !isFruits ? `・${missWord} ${info.hits}` : '';
    }
    if (p !== 'result') confetti.stop();
    if (p === 'result' && isTraining) showTrainingResult(info);
    if (p === 'result' && !isTraining) {
      $('r-cuts').textContent = String(info.cuts);
      $('r-objects').textContent = String(info.objects);
      $('r-total').textContent = String(info.total);
      $('r-hits').textContent = isMissiles && !isFruits ? `・${missWord} ${info.hits}` : '';
      $('r-rank').textContent = String(info.rank);
      $('r-master').textContent = String(info.cuts);
      $('r-normal').textContent = info.normal == null ? '—' : String(info.normal);
    }
  },
}, audio);

function updateTitle() {
  const rec = danRecord(training);
  const slow = slowFor(rec.plays);
  // 段の選択（開いている段だけ押せる）
  const sel = $('dan-select');
  sel.innerHTML = '';
  if (danCount() > 1) {
    for (let d = 1; d <= danCount(); d++) {
      const b = document.createElement('button');
      // 「ステージ」を小さく上に、番号を大きく下に出す（5つが1行に収まるように）
      b.innerHTML = d <= training.unlocked ? `<small>ステージ</small>${d}` : '<small>ステージ</small>？';
      b.disabled = d > training.unlocked;
      b.classList.toggle('on', d === training.dan);
      b.addEventListener('click', () => { training = { ...training, dan: d }; saveTraining(training); updateTitle(); });
      sel.appendChild(b);
    }
  }
  const total = isMissiles ? `（${spawnCount(training.dan)}個）` : '';
  $('t-progress').innerHTML = `${danName(training.dan)}${total} 挑戦 <b>${rec.plays + 1}</b>回目<br>${slowText(slow)}${isFruits ? '' : `<br>斬れば＋1点${isMissiles ? '、当たれば−1点' : ''}`}${isFruits && DANS[training.dan - 1].note ? `<br><span class="note">${DANS[training.dan - 1].note}</span>` : ''}`;
  const any = Object.values(training.dans).some((r) => r.plays > 0);
  $('btn-reset-title').classList.toggle('hidden-btn', !any);
}

function showTrainingResult(info: Record<string, unknown>) {
  const slow = Number(info.slow), d = Number(info.dan), score = Number(info.score), total = Number(info.total);
  const rec = danRecord(training, d);
  const perfect = score >= total;
  const last = d >= danCount();
  $('tr-kicker').textContent = `${danName(d)} ${rec.plays}回目・${slow === 1 ? '現実の速さ' : `${slow}倍遅く`}${perfect && !isFruits ? '・満点' : ''}`;
  $('tr-score').textContent = String(score);
  $('tr-objects').textContent = String(info.objects);
  $('tr-total').textContent = String(total);
  $('tr-hits').textContent = String(info.hits);
  $('tr-hits-wrap').classList.toggle('hidden-btn', !isMissiles || isFruits);
  // 遅さごとの最高点
  const rows: string[] = [];
  for (let k = 1; k <= CONFIG.maxSlow; k++) {
    const b = rec.best[k];
    if (b === undefined) continue;
    rows.push(`<span class="nw">${k === 1 ? '現実' : `${k}倍`}<b>${b}</b></span>`);
  }
  $('tr-best').innerHTML = rows.length ? `${isFruits ? '最高記録' : '最高点'}　${rows.join('　')}` : '';
  const next = slowFor(rec.plays);
  const canAdvance = !last && training.unlocked > d;
  $('tr-next').classList.toggle('celebrate', perfect && last);
  if (perfect && last) {
    $('tr-next').innerHTML = '<b>すべてのステージクリア、<br>おめでとう！</b>あなたは達人の時間の流れを<br>体得しました。';
    confetti.start();
  }
  else if (perfect) $('tr-next').innerHTML = `${danName(d)}を極めた。<br>次は${danName(d + 1)}（${spawnCount(d + 1)}個）。<br>また現実の速さから。`;
  else $('tr-next').innerHTML = next > slow ? `この挑戦が力になった。<br>次は、${slowText(next)}。` : 'これ以上は遅くならない。腕を磨け。';
  $('btn-dan-next').textContent = `${canAdvance ? danName(d + 1) : ''}へ進む`;
  $('btn-dan-next').classList.toggle('hidden-btn', !canAdvance);
  $('btn-next').textContent = next > slow ? `再挑戦（${next}倍遅く見える）` : '再挑戦';
}

const counts = new Map<number, number>();
function spawnCount(d: number) {
  if (!counts.has(d)) counts.set(d, makeStage(d).length);
  return counts.get(d)!;
}

function startTraining() {
  const intro = isFruits ? DANS[training.dan - 1].intro : undefined;
  // 新しいものが混ざるステージを初めて遊ぶときは、先に説明を出す
  if (intro && danRecord(training).plays === 0 && introP.classList.contains('hidden')) {
    $('intro-kicker').textContent = danName(training.dan);
    $('intro-head').textContent = intro.head;
    $('intro-text').innerHTML = intro.text;
    $('intro-pic').classList.toggle('hidden-btn', intro.pic !== 'maki');
    titleP.classList.add('hidden');
    tresultP.classList.add('hidden');
    introP.classList.remove('hidden');
    return;
  }
  introP.classList.add('hidden');
  game.start('training', slowFor(danRecord(training).plays), training.dan);
}
function advanceDan() {
  training = { ...training, dan: Math.min(training.unlocked, training.dan + 1) };
  saveTraining(training);
  startTraining();
}
function resetTraining() {
  training = emptyTraining();
  saveTraining(training);
  game.toTitle();
}

app.dataset.flow = CONFIG.flow;
const slowBy = Math.round(1 / CONFIG.slowScale);
$('t-kicker').textContent = `剣の達人には、時が${slowBy}倍遅く流れる`;
// ステージごとの文言（飛び道具 / 落ち葉）
const isMissiles = CONFIG.stage !== 'leaves'; // 果物・飛び道具（斬れなかったら減点するのは飛び道具だけ）
const isFruits = CONFIG.stage === 'fruits';
const missWord = isFruits ? '落とした' : '被弾';
const whatText = isFruits ? '頭上から落ちてくる物体をすべて斬れ。' : isMissiles ? '飛んでくる手裏剣・礫・矢を斬れ。' : '舞い落ちる葉を斬れ。';
app.dataset.stage = CONFIG.stage;
$('how-what').textContent = isMissiles ? whatText : '指でなぞって、舞い落ちる葉を斬れ。';
if (isMissiles) $('tr-hits-label').textContent = isFruits ? '落とした' : '当たった';
document.querySelectorAll('.unit').forEach((e) => { e.textContent = isMissiles ? '個' : '枚'; });
$('how-feel').textContent = `${fmt(feelSec)}秒`;
$('how-real').textContent = `${fmt(realSec)}秒`;
$('r-kicker').textContent = `現実の${fmt(realSec)}秒で`;
$('btn-fast').textContent = `もう一度見る（${fmt(realSec)}秒）`;
$('i-real').textContent = `${fmt(realSec)}秒`;
$('i-slow').textContent = String(slowBy);
$('btn-slow').textContent = `達人の目で見る（${fmt(feelSec)}秒）`;
$('t-feel').textContent = feelSec.toFixed(1);
if (isTraining) {
  $('t-kicker').textContent = '挑戦を重ねるほど、時が遅く見える';
  $('how-what').textContent = whatText;
  document.querySelector('#count .u')!.textContent = isFruits ? '個' : '点';
  $('tr-unit').textContent = isFruits ? '個' : '点';
  $('t-feel').textContent = realSec.toFixed(1);
  updateTitle();
}

$('btn-start').addEventListener('click', () => (isTraining ? startTraining() : game.start('normal')));
$('btn-next').addEventListener('click', startTraining);
$('btn-intro-start').addEventListener('click', startTraining);
$('btn-dan-next').addEventListener('click', advanceDan);
$('btn-reset').addEventListener('click', resetTraining);
$('btn-reset-title').addEventListener('click', () => { resetTraining(); updateTitle(); });
$('btn-master').addEventListener('click', () => game.start('master'));
$('btn-retry').addEventListener('click', () => game.start('normal'));
$('btn-retry-master').addEventListener('click', () => game.start('master'));
$('btn-fast').addEventListener('click', () => game.replay('fast'));
$('btn-slow').addEventListener('click', () => game.replay('slow'));

// ポインタ
const local = (e: PointerEvent): [number, number] => {
  const r = app.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
const gl = $('gl');
gl.addEventListener('pointerdown', (e) => { gl.setPointerCapture(e.pointerId); game.touchDown(...local(e)); });
gl.addEventListener('pointermove', (e) => {
  const evs = e.getCoalescedEvents?.() ?? [e];
  for (const c of evs.length ? evs : [e]) game.touchMove(...local(c));
});
gl.addEventListener('pointerup', (e) => game.touchUp(...local(e)));
gl.addEventListener('pointercancel', (e) => game.touchUp(...local(e)));

new ResizeObserver(() => game.resize()).observe(app);

let manual = false;
let speed = 1;
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * speed;
  last = now;
  if (!manual) { game.update(dt); game.draw(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 確認・撮影用の入口
/** 撮影時に予約された効果音（残りの秒数つき） */
let pendingSfx: { name: string; args: unknown; delay: number }[] = [];
let sfxTune: { gain: number; skip: string[] } = { gain: 1, skip: [] };
(window as unknown as { __game: unknown }).__game = {
  manual(on: boolean) { manual = on; },
  step(dt: number) {
    game.update(dt); game.draw();
    for (const s of pendingSfx) s.delay -= dt;
  },
  setSpeed(s: number) { speed = s; },
  state: () => game.state(),
  start: (m: 'normal' | 'master' | 'training' = 'normal', slow = 1, dan = 1) => game.start(m, slow, dan),
  training: {
    load: loadTraining, get: () => training,
    reset: () => { training = emptyTraining(); saveTraining(training); updateTitle(); },
    set: (t: TrainingSave) => { training = t; saveTraining(training); updateTitle(); },
  },
  replay: (m: 'fast' | 'slow') => game.replay(m),
  toTitle: () => game.toTitle(),
  touchDown: game.touchDown, touchMove: game.touchMove, touchUp: game.touchUp,
  drainEvents: () => game.drainEvents(),
  audio: {
    capture: audio.capture,
    // 予約した音（リプレイの斬る音など）は、ゲーム内の時間がその時刻に来てから渡す
    drain: () => {
      for (const s of audio.drain()) pendingSfx.push({ ...s, delay: s.delay ?? 0 });
      const due = pendingSfx.filter((s) => s.delay <= 1e-6);
      pendingSfx = pendingSfx.filter((s) => s.delay > 1e-6);
      // 撮影用の音の調整（tune で指定したときだけ）：外す音と音量。指定しなければゲームの音そのまま
      return due
        .filter(({ name }) => !sfxTune.skip.includes(name))
        .map(({ name, args }) => ({ name, args: sfxTune.gain === 1 ? args : { ...(args as object), gain: (((args as { gain?: number })?.gain) ?? 1) * sfxTune.gain } }));
    },
    /** 撮影用：効果音の音量（倍率）と、鳴らさない音の名前 */
    tune: (t: { gain?: number; skip?: string[] }) => { sfxTune = { gain: t.gain ?? 1, skip: t.skip ?? [] }; },
    clearPending: () => { pendingSfx = []; },
    render: audio.render,
  },
};

/**
 * 紙吹雪（すべてのステージを極めたときのお祝い）。画面の上から降らせ、左右の下からも打ち上げる。
 * 結果画面を出している間だけ動かす。
 */
function createConfetti(cv: HTMLCanvasElement, onBurst: () => void) {
  const COLORS = ['#e8c26a', '#c8302a', '#f6efe2', '#2a8a3a', '#2a5ab8', '#f0a0b8', '#ffd84a'];
  type P = { x: number; y: number; vx: number; vy: number; w: number; h: number; a: number; va: number; f: number; vf: number; c: string };
  let ps: P[] = [];
  let raf = 0, last = 0, t = 0, W = 0, H = 0, dpr = 1;
  const ctx = cv.getContext('2d')!;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const piece = (x: number, y: number, vx: number, vy: number): P => ({
    x, y, vx, vy, w: rnd(5, 9), h: rnd(9, 15), a: rnd(0, Math.PI * 2), va: rnd(-6, 6), f: rnd(0, Math.PI * 2), vf: rnd(6, 14), c: COLORS[Math.floor(Math.random() * COLORS.length)],
  });
  const rain = (n: number) => { for (let i = 0; i < n; i++) ps.push(piece(rnd(0, W), rnd(-H * 0.4, -10), rnd(-30, 30), rnd(60, 160))); };
  const cannon = (left: boolean) => {
    // 左下からは右上へ、右下からは左上へ打ち上げる（真上から 0.15〜0.6 ラジアン傾ける）
    for (let i = 0; i < 70; i++) {
      const tilt = rnd(0.15, 0.6), sp = rnd(H * 0.9, H * 1.5);
      ps.push(piece(left ? -5 : W + 5, H * 0.92, (left ? 1 : -1) * Math.sin(tilt) * sp, -Math.cos(tilt) * sp));
    }
  };
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    if (t < 3 && Math.floor((t - dt) * 8) !== Math.floor(t * 8)) rain(10);
    for (const p of ps) {
      p.vy += 420 * dt; // 重力
      p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt; // 空気の抵抗で、ひらひら落ちる
      p.x += (p.vx + Math.sin(p.f) * 40) * dt; p.y += p.vy * dt;
      p.a += p.va * dt; p.f += p.vf * dt;
    }
    ps = ps.filter((p) => p.y < H + 30);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, Math.cos(p.f)); // 裏返りながら舞う
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (ps.length || t < 3) raf = requestAnimationFrame(frame);
    else stop();
  }
  function start() {
    stop();
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ps = []; t = 0;
    cannon(true); cannon(false); rain(60);
    onBurst();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; ps = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  }
  return { start, stop };
}
