// 修行の記録：段ごとの遊んだ回数と、遅さごとの最高点。ブラウザに保存する（読めなくても遊べる）
import { CONFIG } from './config';
import { DANS } from './stage';

export interface DanRecord {
  /** 最後まで遊んだ回数 */
  plays: number;
  /** 遅さ（何倍遅いか）ごとの最高点 */
  best: Record<number, number>;
}

export interface TrainingSave {
  /** 今修行している段（1〜） */
  dan: number;
  /** 開いている段のうち、いちばん先の段 */
  unlocked: number;
  dans: Record<number, DanRecord>;
}

/** 段の数。落ち葉のステージは1段だけ */
export const danCount = () => (CONFIG.stage === 'leaves' ? 1 : DANS.length);
export const danName = (d: number) => (CONFIG.stage === 'leaves' ? '落葉' : DANS[d - 1].name);

/** 記録の版。段を入れたときに3にして、前の記録を読まないようにした */
const VERSION = 3;
const key = (v: number) => `tatsujin-training-v${v}-${CONFIG.stage}`; // ステージごとに別の記録
export const emptyTraining = (): TrainingSave => ({ dan: 1, unlocked: 1, dans: {} });

export function loadTraining(): TrainingSave {
  try {
    const v = JSON.parse(localStorage.getItem(key(VERSION)) ?? 'null');
    if (v && typeof v.dan === 'number' && v.dans && typeof v.dans === 'object') return v;
  } catch { /* 保存が使えない環境でも遊べるようにする */ }
  // 段を入れる前の記録は引き継がず、ステージ1の一回目（現実の速さ）から始める
  return emptyTraining();
}

export function saveTraining(s: TrainingSave) {
  try { localStorage.setItem(key(VERSION), JSON.stringify(s)); } catch { /* 無視 */ }
}

export const danRecord = (s: TrainingSave, d = s.dan): DanRecord => s.dans[d] ?? { plays: 0, best: {} };

/** 次に遊ぶときの遅さ：1回目は現実の速さ（1）、2回目は2倍…最大 maxSlow 倍 */
export const slowFor = (plays: number) => Math.min(plays + 1, CONFIG.maxSlow);

/** 遊び終えた結果を記録する。満点（全部斬って当たり0）なら次の段を開く */
export function recordPlay(s: TrainingSave, d: number, slow: number, score: number, total: number): TrainingSave {
  const r = danRecord(s, d);
  const best = { ...r.best };
  if (best[slow] === undefined || score > best[slow]) best[slow] = score;
  const perfect = score >= total;
  const unlocked = perfect ? Math.max(s.unlocked, Math.min(danCount(), d + 1)) : s.unlocked;
  return { ...s, unlocked, dans: { ...s.dans, [d]: { plays: r.plays + 1, best } } };
}
