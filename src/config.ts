// 調整値はここにまとめる

/**
 * 遊ぶステージ。fruits = 頭上から落ちてくる果物、missiles = 飛んでくる手裏剣・礫・矢、leaves = 舞い落ちる葉。
 * URL に ?stage=missiles や ?stage=leaves を付けると、設定を変えずに前のステージで遊べる。
 * 戻すときは DEFAULT_STAGE を書き換える。
 */
export type StageId = 'fruits' | 'missiles' | 'leaves';
const DEFAULT_STAGE: StageId = 'fruits';
const stageFromUrl = (): StageId | null => {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('stage');
    return v === 'fruits' || v === 'leaves' || v === 'missiles' ? v : null;
  } catch { return null; }
};

/**
 * 遊ぶ流れ。training = 修行（遊ぶたびに遅くなる。1回目は現実の速さ、2回目は2倍…最大 maxSlow 倍）、
 * pair = 常人の目（現実の速さ）→ 達人の目（slowScale 倍遅い）の2回で1組。
 * URL に ?flow=pair を付けると、設定を変えずに前の流れで遊べる。
 */
export type FlowId = 'training' | 'pair';
const DEFAULT_FLOW: FlowId = 'training';
const flowFromUrl = (): FlowId | null => {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('flow');
    return v === 'training' || v === 'pair' ? v : null;
  } catch { return null; }
};

export const CONFIG = {
  stage: stageFromUrl() ?? DEFAULT_STAGE,
  flow: flowFromUrl() ?? DEFAULT_FLOW,
  /** 修行の流れで、いちばん遅くなったときの遅さ（何倍遅いか） */
  maxSlow: 10,
  /** 果物のステージの値 */
  fruit: {
    /** 重力（m/s²）。現実の速さで見て自然な落ち方にする */
    gravity: 9.8,
    /** 出てくる高さ（画面の上の外）と、斬れずに落としたと数える高さ（画面の下の外） */
    startY: 3.7,
    dropY: -2.9,
    /** 落ちる範囲の横幅の半分（m）。画面の横幅の半分は奥行き0で約1.57 */
    halfX: 1.15,
  },
  /** 飛び道具のステージの値 */
  missile: {
    /** 出てくる奥行き（m）。カメラは z=6 */
    startZ: -18,
    /** これより手前に来たら、斬れなかったもの（被弾）として消す */
    hitZ: 3.6,
    gravity: 6,
    /** これより後は出さない（現実の秒）。届くまで約1秒かかる */
    spawnEnd: 3.7,
  },
  /** プレイ中の時間の速さ（0.2 = 5倍遅い） */
  slowScale: 0.2,
  /** ステージのゲーム内時間（秒）。体感では slowScale で割った長さ（5.0 → 体感25秒）。
   *  葉の動きはこの現実の時間で自然に見えるように決める */
  worldDuration: 5.0,
  /** これより後は葉を出さない（ゲーム内秒。4.5 → 体感22.5秒）。
   *  遅い時間では葉が画面に入るまで体感1〜2秒かかるので、最後の葉が見えるよう早めに止める */
  spawnEnd: 4.5,
  /** 物理の固定刻み（ゲーム内秒） */
  dt: 1 / 600,

  camera: { fov: 50, z: 6, y: 0.3 },
  /** 画面外に落ちたと判断する高さ */
  killY: -3.6,

  /** 剣筋として扱う最低の指の速さ（CSS px / 実秒） */
  minSwipeSpeed: 220,
  /** 当たり判定の円を投影半径の何倍にするか */
  hitRadiusScale: 0.95,
  /** これより小さい破片は切れない（m） */
  minPieceSize: 0.055,
  /** 同時に画面にある破片の上限と、記録する破片の総数の上限 */
  maxLivePieces: 260,
  maxTotalPieces: 1600,
  /** 破片の位置と向きを何ステップごとに記録するか（リプレイは補間する） */
  trackEvery: 4,
  /** 切った破片が離れる速さ（m/s） */
  separateSpeed: 0.8,
  /** 切れた葉が舞い方の速さへ戻る強さと、回転が弱まる強さ（1/ゲーム内秒） */
  leafDrag: 3,
  leafSpinDrag: 1.2,
  /** 切ったときに散る葉くずが見えている長さ（ゲーム内秒） */
  chipLife: 1.0,
  /** 斬った飛び道具の破片：斬ってから delay 秒後に、fade 秒かけて消す（体感の秒。遅い時間ほどゲーム内では短い） */
  cutFade: { delay: 1.0, fade: 1.0 },

  /** 剣筋の残像の長さ（ゲーム内秒） */
  trailLife: { play: 0.06, replayFast: 0.12, replaySlow: 0.06 },

  /** 演出の長さ（実秒） */
  focusTime: 1.1,
  endTime: 1.3,
  replayIntroTime: 1.1,
  replayHold: 1.0,

  maxDpr: 2,

  /** 段位（斬数のしきい値） */
  ranks: [
    { min: 0, name: '見習い' },
    { min: 6, name: '門弟' },
    { min: 14, name: '剣士' },
    { min: 24, name: '剣豪' },
    { min: 36, name: '達人' },
    { min: 50, name: '剣聖' },
  ],
};
