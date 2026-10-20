import { describe, expect, it } from 'vitest';
import { danRecord, emptyTraining, recordPlay, slowFor } from '../src/training';
import { CONFIG } from '../src/config';
import { DANS, stageFruits, stageMissiles, type Spawn } from '../src/stage';

describe('修行の記録', () => {
  it('1回目は現実の速さ、遊ぶたびに1倍ずつ遅くなり、maxSlow で止まる', () => {
    expect([0, 1, 4, 5, 8, 9, 10, 20].map(slowFor)).toEqual([1, 2, 5, 6, 9, 10, 11, 21].map((x) => Math.min(x, CONFIG.maxSlow)));
  });
  it('段ごとに、遅さごとの最高点を残す。マイナスも記録する', () => {
    let s = emptyTraining();
    s = recordPlay(s, 1, 1, -4, 18);
    s = recordPlay(s, 1, 2, 3, 18);
    s = recordPlay(s, 1, 2, 1, 18);
    expect(danRecord(s, 1)).toEqual({ plays: 3, best: { 1: -4, 2: 3 } });
    expect(danRecord(s, 2).plays).toBe(0);
    expect(s.unlocked).toBe(1);
  });
  it('満点で次の段が開き、最後の段より先は開かない', () => {
    let s = recordPlay(emptyTraining(), 1, 5, 18, 18);
    expect(s.unlocked).toBe(2);
    s = recordPlay({ ...s, dan: DANS.length, unlocked: DANS.length }, DANS.length, 5, 999, 74);
    expect(s.unlocked).toBe(DANS.length);
  });
});

describe('飛び道具の段', () => {
  it('後の段ほど数が多く、どれも5秒のうちに届く', () => {
    const counts = DANS.map((_, i) => stageMissiles(i + 1).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    for (let d = 1; d <= DANS.length; d++) {
      for (const x of stageMissiles(d)) {
        const T = -x.p[2] / x.fly!.v[2];
        expect(x.t + T).toBeLessThan(CONFIG.worldDuration);
      }
    }
  });
  it('ステージ1は段を入れる前と同じ（18個）', () => {
    expect(stageMissiles(1).length).toBe(18);
  });
});

describe('果物の段', () => {
  const F = CONFIG.fruit, cam = CONFIG.camera;
  const tanH = Math.tan(((cam.fov / 2) * Math.PI) / 180), tanW = (tanH * 9) / 16;
  /** 画面の下へ抜ける時刻（出てからの秒） */
  const dropT = (x: Spawn) => {
    const v = x.fly!.v[1], g = x.fly!.g;
    return (v + Math.sqrt(v * v + 2 * g * (x.p[1] - F.dropY))) / g;
  };
  it('後の段ほど数が多く、どれも5秒のうちに画面の下へ抜ける', () => {
    const counts = DANS.map((_, i) => stageFruits(i + 1).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    for (let d = 1; d <= DANS.length; d++) for (const x of stageFruits(d)) expect(x.t + dropT(x)).toBeLessThan(CONFIG.worldDuration);
  });
  it('画面の上の外から出て、落ちる間は横にはみ出さない', () => {
    for (let d = 1; d <= DANS.length; d++) {
      for (const x of stageFruits(d)) {
        const z = x.p[2], top = cam.y + (cam.z - z) * tanH, half = (cam.z - z) * tanW;
        const v = x.fly!.v, g = x.fly!.g;
        // いちばん高いところでも、果物の下の端が画面の上端より上
        const peak = x.p[1] + Math.max(0, v[1]) ** 2 / (2 * g);
        expect(peak - 0.3).toBeGreaterThan(top);
        // 横の位置は、落ちる間ずっと画面の内側
        const T = dropT(x);
        for (const s of [0, T / 2, T]) expect(Math.abs(x.p[0] + v[0] * s)).toBeLessThan(half * 0.85);
      }
    }
  });
});

describe('段ごとに混ざるもの', () => {
  const has = (d: number) => new Set(stageFruits(d).map((s) => s.kind));
  it('ステージ1は果物だけ、ステージ2で紙風船、ステージ3で栗、ステージ4で薪、ステージ5はすべて', () => {
    const extras = ['kuri', 'fusen', 'maki'];
    expect(extras.filter((k) => has(1).has(k as never))).toEqual([]);
    expect(has(2).has('fusen')).toBe(true);
    expect(has(2).has('kuri') || has(2).has('maki')).toBe(false);
    expect(has(3).has('kuri') && !has(3).has('maki')).toBe(true);
    expect(has(3).has('daruma' as never)).toBe(false);
    expect(has(4).has('maki')).toBe(true);
    for (const k of extras) expect(has(5).has(k as never)).toBe(true);
  });
  it('ステージごとの数：果物・紙風船・栗・薪', () => {
    const want = [
      { fruit: 20, fusen: 0, kuri: 0, maki: 0 },
      { fruit: 27, fusen: 3, kuri: 0, maki: 0 },
      { fruit: 32, fusen: 3, kuri: 5, maki: 0 },
      { fruit: 42, fusen: 3, kuri: 5, maki: 5 },
      { fruit: 50, fusen: 5, kuri: 10, maki: 10 },
    ];
    want.forEach((w, i) => {
      const c = { fruit: 0, fusen: 0, kuri: 0, maki: 0 };
      for (const s of stageFruits(i + 1)) c[(s.kind in c ? s.kind : 'fruit') as keyof typeof c]++;
      expect(c).toEqual(w);
    });
  });
  it('薪は回らずに立ったまま落ちる', () => {
    for (const s of stageFruits(5).filter((s) => s.kind === 'maki')) expect(s.fly!.w).toEqual([0, 0, 0]);
  });
});
