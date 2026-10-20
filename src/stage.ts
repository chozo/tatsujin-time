import type { ExtraId, FruitId, KindId, MissileId } from './objects';
import { makeRng } from './rng';
import { CONFIG } from './config';

/** 葉の舞い方。値は現実の時間のもの（現実の速さで見て自然な落ち葉にする） */
export interface Flutter {
  /** 落ちる速さの基準（m/s）。揺れの端では遅く、真ん中では速くなる */
  fall: number;
  /** 左右に揺れる速さの振れ幅（m/s）と回数（Hz）、揺れの始まりの位相 */
  sway: number;
  freq: number;
  phase: number;
  /** ゆっくり流される横の速さ（m/s） */
  drift: number;
  /** 横から吹き込む風の最初の速さ（m/s）と、弱まるまでの時間（秒） */
  gust: number;
  gustTime: number;
  /** 向き：手前への傾き、揺れに合わせた傾きと振り向き、葉の面内での回転 */
  pitch: number;
  roll: number;
  yaw: number;
  spin: number;
  spinRate: number;
}

/** 飛んでくるものの動き。重力で少し弧を描く */
export interface Flight {
  v: [number, number, number];
  /** 向き：dir = 進む向きに先を向ける（矢）、face = 面をこちらへ向けて回る（手裏剣）、tumble = 転がるように回る（礫） */
  align: 'dir' | 'face' | 'tumble';
  spinRate: number;
  w: [number, number, number];
  /** 重力（m/s²） */
  g: number;
  /** これより下へ落ちたら、斬れなかった（落とした）と数える。無ければ手前の被弾の面（hitZ）で数える */
  dropY?: number;
}

export interface Spawn {
  t: number; // 出現時刻（ゲーム内秒）
  kind: KindId;
  p: [number, number, number];
  /** 葉なら舞い方、飛んでくるものなら飛び方。どちらか一方 */
  fl?: Flutter;
  fly?: Flight;
}

/** 設定とURL（?stage=leaves など）から、遊ぶステージを選ぶ。dan は飛び道具の段（1〜DANS.length） */
export function makeStage(dan = 1): Spawn[] {
  return CONFIG.stage === 'leaves' ? stage1() : CONFIG.stage === 'missiles' ? stageMissiles(dan) : stageFruits(dan);
}

/** 段（果物と飛び道具で共通）。後の段ほど数が多く、速く、まとめて来る */
export interface Dan {
  name: string;
  seed: number;
  /** これより後は出さない（現実の秒） */
  spawnEnd: number;
  /** 出す間隔（現実の秒）：始めの間隔と、終わりまでに縮める量 */
  gap: [number, number];
  /** 2つまとめて出す割合（基準 + 終わりに向けた増え方）と、まとめ始める時点（0〜1） */
  pair: [number, number];
  pairFrom: number;
  /** 2つのときに、さらに3つ目を足す割合（null なら足さない） */
  triple: [number, number] | null;
  /** 届くまで（落ちきるまで）の時間の倍率（小さいほど速い） */
  speed: number;
  /** 一斉射：この時刻（現実の秒）に size 個をまとめて出す（果物は横一列に落とし、飛び道具は片側から矢を放つ） */
  volleys: number[];
  volleySize: number;
  /** 果物のステージで出す数（混ぜるものも含めた合計）。残りが果物になる */
  count: number;
  /** 果物のステージで混ぜるものの数。紙風船＝ゆっくり（ステージ2から）、栗＝速い（ステージ3から）、薪＝縦にしか斬れない（ステージ4から） */
  mix: Partial<Record<ExtraId, number>>;
  /** 果物のステージで、タイトルに出す一言（この段で新しく混ざるもの） */
  note: string;
  /** 果物のステージで、この段を初めて遊ぶ前に出す説明（pic は絵の種類） */
  intro?: { head: string; text: string; pic?: 'maki' };
}

export const DANS: Dan[] = [
  { name: 'ステージ1', seed: 20261019, spawnEnd: 3.7, gap: [0.42, 0.2], pair: [0.25, 0.35], pairFrom: 0.3, triple: null, speed: 1, volleys: [], volleySize: 0, count: 20, mix: {}, note: '' },
  { name: 'ステージ2', seed: 20261020, spawnEnd: 3.8, gap: [0.34, 0.16], pair: [0.35, 0.35], pairFrom: 0.2, triple: [0, 0.25], speed: 0.94, volleys: [], volleySize: 0, count: 30, mix: { fusen: 3 }, note: '紙風船はゆっくり落ちる', intro: { head: '紙風船', text: 'ふわりとゆっくり落ちてくる紙風船が混ざる。<br>これもすべて斬れ。' } },
  { name: 'ステージ3', seed: 20261021, spawnEnd: 3.9, gap: [0.28, 0.13], pair: [0.45, 0.3], pairFrom: 0.1, triple: [0.1, 0.3], speed: 0.88, volleys: [2.4], volleySize: 4, count: 40, mix: { fusen: 3, kuri: 5 }, note: '栗は速く落ちる', intro: { head: '栗', text: '小さな栗が、勢いよく速く落ちてくる。<br>見逃さずに斬れ。' } },
  { name: 'ステージ4', seed: 20261022, spawnEnd: 4.0, gap: [0.24, 0.11], pair: [0.5, 0.3], pairFrom: 0.05, triple: [0.2, 0.3], speed: 0.82, volleys: [1.6, 3.1], volleySize: 5, count: 55, mix: { fusen: 3, kuri: 5, maki: 5 }, note: '薪は縦にしか斬れない', intro: { head: '薪は縦にしか斬れない', text: '木目に沿って縦に振れば、薪は割れる。<br>横に振ると刀が弾かれて、斬れない。', pic: 'maki' } },
  { name: 'ステージ5', seed: 20261023, spawnEnd: 4.05, gap: [0.2, 0.09], pair: [0.6, 0.3], pairFrom: 0, triple: [0.3, 0.3], speed: 0.76, volleys: [1.2, 2.3, 3.4], volleySize: 6, count: 75, mix: { fusen: 5, kuri: 10, maki: 10 }, note: 'これまでの経験のすべてをかけろ', intro: { head: '最後の試練', text: 'これまでのすべての経験を、<br>このステージにかけろ。' } },
];

/**
 * 飛び道具のステージ：奥から手裏剣・礫・矢がこちらへ飛んでくる。
 * どれも画面の中に見えたまま、手前（被弾の面 hitZ）の自分の体の前へ向かってくる。
 * 届く先は画面の上下左右の区画に散らし、画面全体で斬れるようにする。
 * ステージ1は現実の速さで約1.5〜1.1秒で届くので、常人の目ではほとんど斬れない。
 */
export function stageMissiles(dan = 1): Spawn[] {
  const D = DANS[Math.min(DANS.length, Math.max(1, dan)) - 1];
  const r = makeRng(D.seed);
  const out: Spawn[] = [];
  const G = CONFIG.missile.gravity;
  const { hitZ, startZ: z0 } = CONFIG.missile;
  const cam = CONFIG.camera;
  // 被弾の面で、画面に映る範囲の半分の高さと幅
  const halfH = (cam.z - hitZ) * Math.tan(((cam.fov / 2) * Math.PI) / 180);
  const halfW = (halfH * 9) / 16;
  // 届く先の区画（画面の割合 -1〜1）。画面の縁から少し内側に収める
  const zones: [number, number, number, number][] = [];
  for (const [y0, y1] of [[-0.65, -0.2], [-0.2, 0.25], [0.25, 0.65]]) for (const [x0, x1] of [[-0.7, -0.1], [0.1, 0.7]]) zones.push([x0, x1, y0, y1]);
  let bag: number[] = [];
  const nextZone = () => {
    if (!bag.length) {
      bag = zones.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return zones[bag.pop()!];
  };
  /** 1つ出す。side を渡すと、その側から矢を放つ（一斉射） */
  const launch = (tt: number, kind: MissileId, k: number, side?: -1 | 1) => {
    const [x0, x1, y0, y1] = nextZone();
    const target = [r.range(x0, x1) * halfW, cam.y + r.range(y0, y1) * halfH, hitZ];
    // 出てくる位置も画面の中（地平線＝カメラの高さより上）にして、端の外から飛び込ませない
    const start = kind === 'ya'
      ? [(side ?? (r.next() < 0.5 ? -1 : 1)) * r.range(3.5, 5.2), r.range(2, 4), z0]
      : [r.range(-4.5, 4.5), r.range(0.5, 3.5), z0];
    // 届くまでの時間（現実の秒）。奥行き0の面までの時間で決めていたころと同じ速さにする
    const T = (r.range(1.15, 1.35) - 0.3 * k) * D.speed * ((hitZ - z0) / -z0);
    const v: [number, number, number] = [(target[0] - start[0]) / T, (target[1] - start[1]) / T + 0.5 * G * T, (target[2] - start[2]) / T];
    const fly: Flight = {
      v,
      align: kind === 'ya' ? 'dir' : kind === 'shuriken' ? 'face' : 'tumble',
      spinRate: kind === 'shuriken' ? (r.next() < 0.5 ? -1 : 1) * r.range(14, 22) : r.range(-3, 3),
      w: [r.range(-8, 8), r.range(-8, 8), r.range(-8, 8)],
      g: G,
    };
    out.push({ t: tt, kind, p: [start[0], start[1], start[2]], fly });
  };

  const kinds: MissileId[] = ['shuriken', 'shuriken', 'tsubute', 'ya', 'shuriken', 'tsubute', 'ya'];
  const END = D.spawnEnd;
  let t = 0.05, n = 0;
  while (t <= END) {
    const k = t / END;
    let group = k < D.pairFrom ? 1 : r.next() < D.pair[0] + D.pair[1] * k ? 2 : 1;
    if (group === 2 && D.triple && r.next() < D.triple[0] + D.triple[1] * k) group = 3;
    for (let g = 0; g < group; g++) {
      const tt = t + g * 0.08;
      if (tt > END) break;
      launch(tt, kinds[n % kinds.length === 0 ? 0 : Math.floor(r.next() * kinds.length)], k);
      n++;
    }
    t += D.gap[0] - D.gap[1] * k;
  }
  // 一斉射：片側から矢をまとめて放ち、届く先は区画に散らす
  for (const vt of D.volleys) {
    const side: -1 | 1 = r.next() < 0.5 ? -1 : 1;
    for (let i = 0; i < D.volleySize; i++) launch(vt + i * 0.035, 'ya', vt / END, side);
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * 果物のステージ：りんご・みかん・梨・柿・桃が、画面の上の外から落ちてくる。
 * 落ちる列を袋から取り出して左右に散らし、画面の上から下まで落ちる間に斬る。
 * ステージ1は現実の速さで約1.2〜1.35秒で画面の下へ抜けるので、常人の目ではほとんど斬れない。
 * 後の段ほど、勢いをつけて投げ落とすので速く抜ける。
 */
/** 果物のステージの乱数の種のずらし */
const FRUIT_SEED = 1009;
export function stageFruits(dan = 1): Spawn[] {
  const D = DANS[Math.min(DANS.length, Math.max(1, dan)) - 1];
  // 出す数を D.count ちょうどにするため、出る間隔の倍率を1から少しずつずらして、数が合うものを探す
  for (let i = 0; i <= 400; i++) {
    const m = 1 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.002;
    const out = fruitsWith(D, m);
    if (out && out.length === D.count) return out;
  }
  throw new Error(`${D.name}: ${D.count}個にできない`);
}

function fruitsWith(D: Dan, gapScale: number): Spawn[] | null {
  const r = makeRng(D.seed + FRUIT_SEED);
  const out: Spawn[] = [];
  const F = CONFIG.fruit;
  const G = F.gravity;
  const COLS = 5;
  const colX = (c: number) => -F.halfX + (2 * F.halfX * (c + 0.5)) / COLS;
  let bag: number[] = [];
  const nextCol = () => {
    if (!bag.length) {
      bag = [...Array(COLS).keys()];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.pop()!;
  };
  const kinds: FruitId[] = ['ringo', 'mikan', 'nashi', 'kaki', 'momo'];
  const fruit = () => kinds[Math.floor(r.next() * kinds.length)];
  // 種類ごとの落ち方：落ちきるまでの時間の倍率と重力。栗は投げ落とすように速く、紙風船は軽くゆっくり
  const spec = (kind: KindId) => (kind === 'kuri' ? { tk: 0.6, g: G } : kind === 'fusen' ? { tk: 1.9, g: 2.2 } : { tk: 1, g: G });
  /** 1つ落とす。x を渡すとその位置から（まとめて落とすとき） */
  const drop = (tt: number, kind: KindId, k: number, x?: number) => {
    const { tk, g } = spec(kind);
    const x0 = x ?? colX(nextCol()) + r.range(-0.15, 0.15);
    const x1 = Math.max(-F.halfX - 0.1, Math.min(F.halfX + 0.1, x0 + r.range(-0.35, 0.35)));
    // 画面の下へ抜けるまでの時間（現実の秒）。速い段ほど下向きの勢いをつけて落とす
    const T = (r.range(1.15, 1.35) - 0.3 * k) * D.speed * tk;
    // 回り方：薪は立てたまま（縦の向きが分かるように）
    const w: [number, number, number] = kind === 'maki' ? [0, 0, 0]
      : kind === 'fusen' ? [r.range(-0.8, 0.8), r.range(-0.8, 0.8), r.range(-0.8, 0.8)]
      : kind === 'kuri' ? [r.range(-6, 6), r.range(-6, 6), r.range(-6, 6)]
      : [r.range(-2.5, 2.5), r.range(-2.5, 2.5), r.range(-2.5, 2.5)];
    const fly: Flight = {
      v: [(x1 - x0) / T, (F.dropY - F.startY + 0.5 * g * T * T) / T, 0],
      align: 'tumble',
      spinRate: 0,
      w,
      g,
      dropY: F.dropY,
    };
    out.push({ t: tt, kind, p: [x0, F.startY, r.range(-0.35, 0.3)], fly });
  };

  // まず出す時刻と位置だけを決める
  const END = D.spawnEnd;
  const slots: { tt: number; k: number; x?: number }[] = [];
  let t = 0.05;
  while (t <= END) {
    const k = t / END;
    let group = k < D.pairFrom ? 1 : r.next() < D.pair[0] + D.pair[1] * k ? 2 : 1;
    if (group === 2 && D.triple && r.next() < D.triple[0] + D.triple[1] * k) group = 3;
    for (let g = 0; g < group; g++) {
      const tt = t + g * 0.08;
      if (tt > END) break;
      slots.push({ tt, k });
    }
    t += (D.gap[0] - D.gap[1] * k) * gapScale;
  }
  // まとめて落とす：横一列に並べ、落ちる速さを少しずつ変えて縦にばらけさせる
  for (const vt of D.volleys) {
    const N = D.volleySize;
    for (let i = 0; i < N; i++) slots.push({ tt: vt + i * 0.05, k: vt / END, x: -F.halfX + (2 * F.halfX * (i + 0.5)) / N + r.range(-0.06, 0.06) });
  }
  // 混ぜるものを決まった数だけ、ばらばらの時刻に割り当てる（最初の1つは必ずりんご）。
  // 紙風船は落ちきるまで長いので、終わりまでに画面の下へ抜けられる時刻だけに置く
  const kindOf: KindId[] = slots.map((_, i) => (i === 0 ? 'ringo' : fruit()));
  const order = slots.map((_, i) => i).slice(1);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const used = new Set<number>();
  for (const [id, cnt] of Object.entries(D.mix) as [ExtraId, number][]) {
    let left = cnt;
    for (const i of order) {
      if (!left) break;
      if (used.has(i)) continue;
      if (id === 'fusen' && slots[i].tt + 1.35 * D.speed * spec(id).tk > CONFIG.worldDuration - 0.15) continue;
      kindOf[i] = id;
      used.add(i);
      left--;
    }
  }
  slots.forEach((sl, i) => drop(sl.tt, kindOf[i], sl.k, sl.x));
  return out.sort((a, b) => a.t - b.t);
}

/**
 * ステージ1：舞い落ちる葉と、横から吹き込む葉。毎回同じ配置にして練習できるようにする。
 * 葉は現実の速さで見て自然になるよう、秒速1.5〜2mほどで落ち、1往復1〜1.6秒で左右に揺れる。
 */
export function stage1(): Spawn[] {
  const r = makeRng(20261018);
  const out: Spawn[] = [];
  const flutter = (x: number, k: number, gust: number): Flutter => {
    const freq = r.range(0.6, 0.95);
    const width = r.range(0.28, 0.45); // 左右に揺れる幅（m）
    return {
      fall: r.range(2.1, 2.7) + k * 0.5, // 平均の落ちる速さはこの約0.73倍
      sway: width * 2 * Math.PI * freq,
      freq,
      phase: r.range(0, Math.PI * 2),
      drift: r.range(-0.2, 0.2) - x * 0.15,
      gust,
      gustTime: 0.9,
      pitch: r.range(-0.55, -0.15),
      roll: r.range(0.35, 0.6),
      yaw: r.range(0.4, 0.75),
      spin: r.range(-Math.PI, Math.PI),
      spinRate: r.range(-1.2, 1.2),
    };
  };
  const drop = (t: number, kind: KindId, x: number, k: number) =>
    out.push({ t, kind, p: [x, 3.5, r.range(-0.3, 0.3)], fl: flutter(x, k, 0) });
  // 画面の上のほうの横から風で吹き込み、舞い落ちる（下から上がってこない）
  const toss = (t: number, kind: KindId, side: -1 | 1, y: number, k: number) =>
    out.push({ t, kind, p: [side * 2.1, y, r.range(-0.2, 0.2)], fl: flutter(0, k, -side * r.range(2.2, 2.7)) });

  // 最初はまばらに1枚ずつ、だんだん間隔を詰めて、まとめて落ちる数も増やす。
  // spawnEnd より後は出さない。
  const END = CONFIG.spawnEnd;
  const kinds: KindId[] = ['momiji', 'momiji', 'kaede', 'ichou', 'ichou', 'kaede', 'momiji'];
  let t = 0;
  let n = 0;
  while (t <= END) {
    const k = t / END; // 0 → 1
    const group = k < 0.35 ? 1 : k < 0.7 ? (r.next() < 0.3 ? 2 : 1) : r.next() < 0.5 ? 2 : 1;
    // 同時に出すものは左右に散らす
    const lanes = [-0.95, -0.32, 0.32, 0.95];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    for (let g = 0; g < group; g++) {
      const tt = t + g * 0.06;
      if (tt > END) break;
      const kind = kinds[Math.floor(r.next() * kinds.length)];
      if (n % 6 === 5) toss(tt, kind, r.next() < 0.5 ? -1 : 1, r.range(1.8, 2.3), k);
      else drop(tt, kind, lanes[g] + r.range(-0.12, 0.12), k);
      n++;
    }
    t += 0.42 - 0.2 * k; // 間隔：0.42 → 0.22（現実の秒）
  }
  return out.sort((a, b) => a.t - b.t);
}
