import { describe, expect, it } from 'vitest';
import { makeKinds } from '../src/objects';
import { meshVolume, sliceMesh, type MeshData } from '../src/slicer';
import { makeRng } from '../src/rng';

const kinds = makeKinds();
const shift = (d: MeshData, c: number[]) => {
  const pos = d.pos.slice();
  for (let i = 0; i < pos.length; i += 3) { pos[i] += c[0]; pos[i + 1] += c[1]; pos[i + 2] += c[2]; }
  return { ...d, pos };
};

describe('sliceMesh', () => {
  for (const k of Object.values(kinds)) {
    it(`${k.name}を切っても体積が変わらない`, () => {
      const d = k.build();
      const v = meshVolume(d);
      expect(v).toBeGreaterThan(0);
      const r = sliceMesh(d, [0.3, 1, 0.2], [0.01, 0.02, 0], k.flesh)!;
      expect(r).not.toBeNull();
      const vf = meshVolume(shift(r.front.data, r.front.center));
      const vb = meshVolume(shift(r.back.data, r.back.center));
      expect(vf).toBeGreaterThan(0);
      expect(vb).toBeGreaterThan(0);
      // 凹んだ葉でも、切り口を部分ごとに塞ぐので体積が保たれる
      expect(Math.abs(vf + vb - v) / v).toBeLessThan(2e-3);
    });
  }

  it('何度切っても閉じた形のまま', () => {
    const k = kinds.momiji;
    const rng = makeRng(1);
    let parts: MeshData[] = [k.build()];
    const v0 = meshVolume(parts[0]);
    for (let round = 0; round < 4; round++) {
      const next: MeshData[] = [];
      for (const p of parts) {
        // 遊びでは葉の面をまたぐ向きに切るので、面に近い向きの平面は避ける
        const n = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-0.3, 0.3)];
        const r = sliceMesh(p, n, [rng.range(-0.02, 0.02), 0, 0], k.flesh);
        if (!r) { next.push(p); continue; }
        next.push(shift(r.front.data, r.front.center), shift(r.back.data, r.back.center));
      }
      parts = next;
    }
    const total = parts.reduce((s, p) => s + meshVolume(p), 0);
    expect(parts.length).toBeGreaterThan(8);
    expect(Math.abs(total - v0) / v0).toBeLessThan(5e-3);
    for (const p of parts) expect(meshVolume(p)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('形の外の平面では切れない', () => {
    const k = kinds.ichou;
    expect(sliceMesh(k.build(), [0, 1, 0], [0, 5, 0], k.flesh)).toBeNull();
  });
});

import { stage1 } from '../src/stage';
import { CONFIG } from '../src/config';
describe('stage1', () => {
  it('spawnEnd より後には出さず、後半ほど多い', () => {
    const s = stage1();
    expect(Math.max(...s.map((x) => x.t))).toBeLessThanOrEqual(CONFIG.spawnEnd);
    const half = CONFIG.spawnEnd / 2;
    expect(s.filter((x) => x.t >= half).length).toBeGreaterThan(s.filter((x) => x.t < half).length * 1.5);
  });
});

import { stageMissiles } from '../src/stage';
describe('stageMissiles', () => {
  it('spawnEnd より後には出さず、どれも画面の中で手前へ届き、届く先が上下左右に散っている', () => {
    const s = stageMissiles();
    expect(Math.max(...s.map((x) => x.t))).toBeLessThanOrEqual(CONFIG.missile.spawnEnd);
    const cam = CONFIG.camera;
    const tanH = Math.tan(((cam.fov / 2) * Math.PI) / 180), tanW = (tanH * 9) / 16;
    // 画面の割合（-1〜1）に直す
    const ndc = (x: number, y: number, z: number) => [x / ((cam.z - z) * tanW), (y - cam.y) / ((cam.z - z) * tanH)];
    const all = [1, 2, 3, 4, 5].flatMap((d) => stageMissiles(d));
    const at = all.map((x) => {
      const v = x.fly!.v, T = (CONFIG.missile.hitZ - x.p[2]) / v[2];
      // 出てくる位置と届く位置が、どちらも画面の中
      const [sx, sy] = ndc(x.p[0], x.p[1], x.p[2]);
      expect(Math.abs(sx)).toBeLessThan(0.9);
      expect(Math.abs(sy)).toBeLessThan(0.9);
      const e = ndc(x.p[0] + v[0] * T, x.p[1] + v[1] * T - 0.5 * CONFIG.missile.gravity * T * T, CONFIG.missile.hitZ);
      expect(Math.abs(e[0])).toBeLessThan(0.75);
      expect(Math.abs(e[1])).toBeLessThan(0.7);
      return e;
    });
    expect(at.filter((p) => p[1] < -0.2).length).toBeGreaterThan(2);
    expect(at.filter((p) => p[1] > 0.25).length).toBeGreaterThan(2);
    expect(at.filter((p) => p[0] < 0).length).toBeGreaterThan(3);
    expect(at.filter((p) => p[0] > 0).length).toBeGreaterThan(3);
  });
});
