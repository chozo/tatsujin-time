import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FleshColors, MeshData } from './slicer';

export type LeafId = 'momiji' | 'kaede' | 'ichou';
export type MissileId = 'shuriken' | 'tsubute' | 'ya';
export type FruitId = 'ringo' | 'mikan' | 'nashi' | 'kaki' | 'momo';
/** 果物のステージに混ぜるもの：栗（速い）・紙風船（ゆっくり）・薪（縦にしか斬れない） */
export type ExtraId = 'kuri' | 'fusen' | 'maki';
export type KindId = LeafId | MissileId | FruitId | ExtraId;

export interface Kind {
  id: KindId;
  name: string;
  flesh: FleshColors;
  juice: number; // 切ったときに散る葉くず・火花の色
  juiceCount: number;
  /** 散るものの動き：葉くずはゆっくり舞い、火花は速く飛んで落ちる */
  chip: 'leaf' | 'spark';
  material: THREE.MeshStandardMaterial;
  build: () => MeshData;
  /** 切れたときの音の高さ */
  pitch: number;
  /** 特別な決まり：grain = 縦（形の y 軸に沿った向き）にしか斬れない */
  rule?: 'grain';
}

type RGB = [number, number, number];
type P2 = [number, number];

const lin = (hex: number): RGB => {
  const c = new THREE.Color(hex); // sRGB → リニア（THREE.Color は自動で変換）
  return [c.r, c.g, c.b];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const deg = Math.PI / 180;

/**
 * 薄い葉の立体を作る。outline は原点から見て角度順（反時計回り）に並んだ輪郭。
 * 原点から輪郭へ同心の輪で三角形を張るので、付け根から縁へ色を変えられる。
 * color(s, i) の s は付け根0〜縁1、i は輪郭の点の番号。cup は葉の反り。
 */
function leafMesh(outline: P2[], thick: number, cup: number, color: (s: number, i: number) => RGB): MeshData {
  const d: MeshData = { pos: [], nrm: [], col: [] };
  const rings = [0, 0.45, 0.8, 1];
  const n = outline.length;
  const z = (x: number, y: number, top: boolean) => (top ? thick / 2 : -thick / 2) + cup * (x * x + y * y);
  const pt = (k: number, i: number): P2 => {
    const s = rings[k], o = outline[i % n];
    return [o[0] * s, o[1] * s];
  };
  const tri = (a: number[], b: number[], e: number[], ca: RGB, cb: RGB, ce: RGB) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    d.pos.push(...a, ...b, ...e);
    d.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    d.col.push(...ca, ...cb, ...ce);
  };
  // 表と裏
  for (const top of [true, false]) {
    const V = (k: number, i: number) => { const q = pt(k, i); return [q[0], q[1], z(q[0], q[1], top)]; };
    const C = (k: number, i: number) => color(rings[k], i % n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k + 1 < rings.length; k++) {
        const a = V(k, i), b = V(k + 1, i), e = V(k + 1, i + 1), f = V(k, i + 1);
        const ca = C(k, i), cb = C(k + 1, i), ce = C(k + 1, i + 1), cf = C(k, i + 1);
        if (top) {
          tri(a, b, e, ca, cb, ce);
          if (k > 0) tri(a, e, f, ca, ce, cf);
        } else {
          tri(a, e, b, ca, ce, cb);
          if (k > 0) tri(a, f, e, ca, cf, ce);
        }
      }
    }
  }
  // 縁
  const K = rings.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pt(K, i), b = pt(K, i + 1);
    const ab = [a[0], a[1], z(a[0], a[1], false)], bb = [b[0], b[1], z(b[0], b[1], false)];
    const at = [a[0], a[1], z(a[0], a[1], true)], bt = [b[0], b[1], z(b[0], b[1], true)];
    const ca = color(1, i), cb = color(1, (i + 1) % n);
    tri(ab, bb, bt, ca, cb, cb);
    tri(ab, bt, at, ca, cb, ca);
  }
  // 形の中心を原点にする（回転の中心と当たり判定の中心）
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < d.pos.length; i += 3) {
    x0 = Math.min(x0, d.pos[i]); x1 = Math.max(x1, d.pos[i]);
    y0 = Math.min(y0, d.pos[i + 1]); y1 = Math.max(y1, d.pos[i + 1]);
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (let i = 0; i < d.pos.length; i += 3) { d.pos[i] -= mx; d.pos[i + 1] -= my; }
  return d;
}

const polar = (R: number) => (a: number, r: number): P2 => [Math.cos(a * deg) * r * R, Math.sin(a * deg) * r * R];

/** 紅葉（いろは紅葉）の輪郭。7つの裂片と、下向きの葉柄。STEM は葉柄の点の数、tips は裂片の先の点の番号 */
const MOMIJI_STEM = 6;
function momijiOutline(R: number) {
  const P = polar(R);
  const lobes = [
    { a: -28, l: 0.5 }, { a: 12, l: 0.78 }, { a: 52, l: 0.94 }, { a: 90, l: 1 },
    { a: 128, l: 0.94 }, { a: 168, l: 0.78 }, { a: 208, l: 0.5 },
  ];
  const rv = 0.27; // 切れ込みの深さ（付け根からの距離の比）
  const out: P2[] = [];
  const tips: number[] = [];
  out.push(P(-110, 0.2), P(-93, 0.15), P(-91.8, 0.66), P(-88.2, 0.66), P(-87, 0.15), P(-70, 0.2));
  const S = 11;
  for (let j = 0; j < lobes.length; j++) {
    const L = lobes[j];
    const hl = j === 0 ? 34 : (L.a - lobes[j - 1].a) / 2;
    const hr = j === lobes.length - 1 ? 34 : (lobes[j + 1].a - L.a) / 2;
    // 切れ込み（x=0）から先（x→1）へ
    const side = (h: number, dir: number) => {
      const pts: P2[] = [];
      for (let k = 0; k < S; k++) {
        const x = k / S;
        let r = rv + (L.l - rv) * x;
        if (x > 0.35) r += 0.022 * L.l * (1 - Math.abs(((x * 9) % 1) * 2 - 1)); // 鋸歯
        pts.push(P(L.a + dir * h * (1 - Math.pow(x, 1.6)), r));
      }
      return pts;
    };
    out.push(...side(hl, -1));
    tips.push(out.length);
    out.push(P(L.a, L.l));
    // 右側の切れ込みの点は、次の裂片の左側の始点と同じ角度なので入れない
    out.push(...side(hr, 1).reverse().slice(0, -1));
  }
  return { out, tips };
}

/** 銀杏の輪郭。扇形で、上の縁の中央に切れ込みがある。ICHOU_STEM は葉柄の点の数 */
const ICHOU_STEM = 4;
function ichouOutline(R: number) {
  const P = polar(R);
  const half = 64;
  const out: P2[] = [P(-93, 0.06), P(-91.5, 0.6), P(-88.5, 0.6), P(-87, 0.06)];
  out.push(P(90 - half - 26, 0.05), P(90 - half - 8, 0.3), P(90 - half - 2, 0.65));
  const N = 44;
  for (let k = 0; k <= N; k++) {
    const a = 90 - half + (2 * half * k) / N;
    const m = (a - 90) / 7;
    const r = 0.9 + 0.1 * Math.cos((a - 90) * deg * 1.2) - 0.22 * Math.exp(-m * m) + 0.018 * Math.sin(k * 2.3);
    out.push(P(a, r));
  }
  out.push(P(90 + half + 2, 0.65), P(90 + half + 8, 0.3), P(90 + half + 26, 0.05));
  return out;
}

export function makeKinds(): Record<KindId, Kind> {
  const leaf = (id: KindId, name: string, pitch: number, build: () => MeshData, juice: number, fleshC: number, fleshR: number): Kind => ({
    id, name, pitch, juice, juiceCount: 10, chip: 'leaf', build,
    flesh: { center: lin(fleshC), rim: lin(fleshR) },
    material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
  });

  // 紅葉：付け根は橙、縁へ深い紅。葉脈は明るく
  const momiji = (inner: number, outer: number, vein: number) => () => {
    const { out, tips } = momijiOutline(0.4);
    const ci = lin(inner), co = lin(outer), cv = lin(vein);
    const veinAt = new Set(tips);
    return leafMesh(out, 0.016, 0.12, (s, i) => {
      if (i < MOMIJI_STEM) return mix(cv, co, 0.5);
      const base = mix(ci, co, Math.min(1, s * 1.15));
      return veinAt.has(i) && s > 0 ? mix(base, cv, 0.55) : base;
    });
  };

  // 銀杏：黄色。付け根は少し濃く、縁は明るい。細い筋を入れる
  const ichou = () => {
    const ci = lin(0xc89a12), co = lin(0xf4cc2a), stem = lin(0x9a7a18);
    return leafMesh(ichouOutline(0.42), 0.016, 0.1, (s, i) => {
      if (i < ICHOU_STEM) return stem;
      const c = mix(ci, co, s);
      return i % 2 === 0 ? mix(c, ci, 0.25 * s) : c;
    });
  };

  return {
    ...makeMissiles(),
    ...makeFruits(),
    ...makeExtras(),
    momiji: leaf('momiji', '紅葉', 1.0, momiji(0xe0601a, 0xb3101c, 0xf0a040), 0xc81c1c, 0xe88a5a, 0xa8141c),
    kaede: leaf('kaede', '楓', 1.04, momiji(0xf0b020, 0xe2501a, 0xf8d070), 0xe86a1a, 0xf6c070, 0xd0501a),
    ichou: leaf('ichou', '銀杏', 1.08, ichou, 0xf0c428, 0xf8e080, 0xd8a818),
  };
}

/** three.js の形を MeshData にする（頂点の色は位置から決める） */
function geoData(geo: THREE.BufferGeometry, color: (x: number, y: number, z: number) => RGB): MeshData {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pa = g.getAttribute('position'), na = g.getAttribute('normal');
  const d: MeshData = { pos: [], nrm: [], col: [] };
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    d.pos.push(x, y, z);
    d.nrm.push(na.getX(i), na.getY(i), na.getZ(i));
    d.col.push(...color(x, y, z));
  }
  return d;
}
const join = (...ds: MeshData[]): MeshData => ({
  pos: ds.flatMap((d) => d.pos), nrm: ds.flatMap((d) => d.nrm), col: ds.flatMap((d) => d.col),
});

/** 飛んでくるもの：手裏剣・礫・矢。矢は +z の向きに先がある */
function makeMissiles(): Record<MissileId, Kind> {
  const steel = lin(0x23272e), edge = lin(0xe8ecf2);
  const stone = lin(0x5a5248), stoneDark = lin(0x3a342e);
  const wood = lin(0x8a5a2a), feather = lin(0xe8e2d4), featherDark = lin(0x2a2420), iron = lin(0x50545a);
  return {
    shuriken: {
      id: 'shuriken', name: '手裏剣', pitch: 1.12, juice: 0xffd27a, juiceCount: 16, chip: 'spark',
      flesh: { center: lin(0x8a9098), rim: lin(0xe8ecf0) },
      material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 }),
      build: () => {
        // 四方手裏剣：4つの尖った刃
        const P = polar(0.38);
        const out: P2[] = [];
        for (let k = 0; k < 4; k++) {
          const a = k * 90;
          out.push(P(a - 45, 0.24), P(a - 12, 0.3), P(a, 1), P(a + 12, 0.3));
        }
        return leafMesh(out, 0.03, 0, (s) => mix(steel, edge, Math.pow(s, 2.5)));
      },
    },
    tsubute: {
      id: 'tsubute', name: '礫', pitch: 0.92, juice: 0xb8ab98, juiceCount: 14, chip: 'spark',
      flesh: { center: lin(0x8c8478), rim: lin(0x6a6258) },
      material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
      build: () => {
        const g = new THREE.IcosahedronGeometry(0.17, 1);
        const pa = g.getAttribute('position');
        for (let i = 0; i < pa.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pa, i).normalize();
          const r = 0.17 * (1 + 0.16 * Math.sin(v.x * 7) * Math.sin(v.y * 5 + 1) * Math.sin(v.z * 6 + 2)) * (v.y > 0 ? 0.85 : 1);
          pa.setXYZ(i, v.x * r * 1.15, v.y * r, v.z * r);
        }
        return geoData(g, (x, y, z) => (Math.sin(x * 40 + z * 30) > 0.3 ? stoneDark : stone));
      },
    },
    ya: {
      id: 'ya', name: '矢', pitch: 1.04, juice: 0xd8b878, juiceCount: 12, chip: 'spark',
      flesh: { center: lin(0xe0c890), rim: lin(0xb08850) },
      material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }),
      build: () => {
        const shaft = new THREE.CylinderGeometry(0.022, 0.022, 1.1, 8);
        shaft.rotateX(Math.PI / 2);
        const head = new THREE.ConeGeometry(0.05, 0.16, 8);
        head.rotateX(Math.PI / 2);
        head.translate(0, 0, 0.62);
        const fl = [0, 1, 2].map((k) => {
          const b = new THREE.BoxGeometry(0.008, 0.07, 0.24);
          b.translate(0, 0.055, -0.42);
          b.rotateZ((k * 2 * Math.PI) / 3);
          return geoData(b, (x, y, z) => (Math.sin(z * 60) > 0.2 ? featherDark : feather));
        });
        return join(geoData(shaft, () => wood), geoData(head, () => iron), ...fl);
      },
    },
  };
}

/**
 * 丸い果物の形。球の向き（d：単位ベクトル、y が上）から半径を決め、なめらかな法線をつける。
 * radius(d) は半径、color(d) は皮の色。頂点を共有させてから法線を求め、切れるよう三角形ごとに戻す。
 */
function fruitBody(radius: (d: THREE.Vector3) => number, color: (d: THREE.Vector3) => RGB, detail = 3): MeshData {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pa = g.getAttribute('position');
  const d = new THREE.Vector3();
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < pa.count; i++) {
    d.fromBufferAttribute(pa, i).normalize();
    dirs.push(d.clone());
    const r = radius(d);
    pa.setXYZ(i, d.x * r, d.y * r, d.z * r);
  }
  g.computeVertexNormals();
  const idx = g.getIndex()!;
  const na = g.getAttribute('normal');
  const out: MeshData = { pos: [], nrm: [], col: [] };
  for (let k = 0; k < idx.count; k++) {
    const i = idx.getX(k);
    out.pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
    out.nrm.push(na.getX(i), na.getY(i), na.getZ(i));
    out.col.push(...color(dirs[i]));
  }
  return out;
}

/** 小さな値の揺らぎ（向きから決まるので、毎回同じ模様になる） */
const wob = (d: THREE.Vector3, a: number, b: number, c: number) => Math.sin(d.x * a + 1.3) * Math.sin(d.y * b + 0.7) * Math.sin(d.z * c + 2.1);
/** 上の極（へた・軸のあるところ）からの近さ 0〜1 */
const nearTop = (d: THREE.Vector3, w: number) => Math.exp(-((1 - d.y) / w));

/** 頭上から落ちてくる果物：りんご・みかん・梨・柿・桃。大きさはゲームとして斬りやすいよう実物より大きい */
function makeFruits(): Record<FruitId, Kind> {
  const stemOf = (len: number, r: number, col: number, top: number, bend = 0.15) => {
    const g = new THREE.CylinderGeometry(r * 0.8, r, len, 6);
    g.translate(0, len / 2, 0);
    g.rotateZ(bend);
    g.translate(0, top - len * 0.25, 0);
    return geoData(g, () => lin(col));
  };
  /** へたの葉（柿・みかん）：4枚の葉を上の極に平らに置く */
  const calyx = (R: number, top: number, col: number, lobes = 4) => {
    const P = polar(R);
    const out: P2[] = [];
    for (let k = 0; k < lobes; k++) {
      const a = (k * 360) / lobes;
      out.push(P(a - 180 / lobes, 0.35), P(a - 10, 0.85), P(a, 1), P(a + 10, 0.85));
    }
    const d = leafMesh(out, 0.02, -0.25, () => lin(col));
    // 葉は xy 面に作られるので、上向きの面にする
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, top, 0);
    const v = new THREE.Vector3();
    for (let i = 0; i < d.pos.length; i += 3) {
      v.set(d.pos[i], d.pos[i + 1], d.pos[i + 2]).applyMatrix4(m);
      d.pos[i] = v.x; d.pos[i + 1] = v.y; d.pos[i + 2] = v.z;
      v.set(d.nrm[i], d.nrm[i + 1], d.nrm[i + 2]).transformDirection(m);
      d.nrm[i] = v.x; d.nrm[i + 1] = v.y; d.nrm[i + 2] = v.z;
    }
    return d;
  };
  const fruit = (id: FruitId, name: string, pitch: number, juice: number, fleshC: number, fleshR: number, rough: number, build: () => MeshData): Kind => ({
    id, name, pitch, juice, juiceCount: 18, chip: 'spark', build,
    flesh: { center: lin(fleshC), rim: lin(fleshR) },
    material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 }),
  });

  return {
    // りんご：赤に黄色の筋。上と下が少しくぼむ
    ringo: fruit('ringo', 'りんご', 1.0, 0xf6e6b8, 0xfbf0cc, 0xf2e0a8, 0.38, () => {
      const R = 0.27, red = lin(0xb8121e), deep = lin(0x7e0c18), yel = lin(0xe8b838);
      const body = fruitBody(
        (d) => R * (1 + 0.04 * d.y - 0.22 * nearTop(d, 0.06) - 0.12 * Math.exp(-((1 + d.y) / 0.06))) * (1 - 0.06 * d.y * d.y),
        (d) => {
          const streak = 0.5 + 0.5 * Math.sin(Math.atan2(d.z, d.x) * 9 + d.y * 3);
          const c = mix(red, deep, 0.35 * streak + 0.25 * Math.max(0, d.z));
          return mix(c, yel, Math.max(0, 0.55 * nearTop(d, 0.25) - 0.1 + 0.15 * wob(d, 7, 5, 6)));
        });
      return join(body, stemOf(0.13, 0.014, 0x5a3a1a, R * 0.8));
    }),
    // みかん：つぶつぶの橙。上下につぶれた形で、緑の小さなへた
    mikan: fruit('mikan', 'みかん', 1.12, 0xffb030, 0xf8b848, 0xf09a28, 0.7, () => {
      const R = 0.24, o1 = lin(0xf28a0c), o2 = lin(0xe06a06);
      const body = fruitBody(
        (d) => R * (1 - 0.14 * d.y * d.y - 0.08 * nearTop(d, 0.08)) * (1 + 0.012 * wob(d, 40, 37, 43)),
        (d) => mix(o1, o2, 0.5 + 0.5 * wob(d, 40, 37, 43)));
      return join(body, calyx(0.05, R * 0.84, 0x4a6a1a, 5));
    }),
    // 梨：淡い黄土色に細かい点。丸く大きい
    nashi: fruit('nashi', '梨', 0.94, 0xf4f0d8, 0xfbf8e6, 0xf0e8c8, 0.85, () => {
      const R = 0.29, base = lin(0xc8a058), light = lin(0xdcbc70), dot = lin(0x8a6a30);
      const body = fruitBody(
        (d) => R * (1 - 0.08 * d.y * d.y - 0.14 * nearTop(d, 0.05) - 0.08 * Math.exp(-((1 + d.y) / 0.05))),
        (d) => {
          const c = mix(base, light, 0.5 + 0.5 * d.y * 0.6 + 0.2 * wob(d, 5, 4, 6));
          return wob(d, 61, 57, 67) > 0.55 ? mix(c, dot, 0.6) : c;
        });
      return join(body, stemOf(0.12, 0.012, 0x5a4020, R * 0.86, 0.05));
    }),
    // 柿：濃い橙で、四角っぽく上下につぶれた形。大きな4枚のへた
    kaki: fruit('kaki', '柿', 1.06, 0xff8a20, 0xf8a040, 0xf07a18, 0.32, () => {
      const R = 0.27, o1 = lin(0xf06808), o2 = lin(0xd04a04);
      const body = fruitBody(
        (d) => {
          const a = Math.atan2(d.z, d.x);
          return R * (1 - 0.3 * Math.max(0, d.y) ** 2 - 0.2 * Math.min(0, d.y) ** 2) * (1 + 0.05 * Math.cos(4 * a) * (1 - d.y * d.y));
        },
        (d) => mix(o1, o2, Math.max(0, -d.y) * 0.6 + 0.15 * wob(d, 6, 5, 7) + 0.15));
      return join(body, calyx(0.12, R * 0.68, 0x5a5a1c, 4), stemOf(0.05, 0.012, 0x4a3818, R * 0.72, 0));
    }),
    // 桃：薄黄から紅の頬。上が少しとがり、片側に縦の筋
    momo: fruit('momo', '桃', 1.02, 0xfbd8c0, 0xfbe8c8, 0xf4b4a0, 0.8, () => {
      const R = 0.27, cream = lin(0xf6d4a0), pink = lin(0xf08a8a), blush = lin(0xd8384a);
      const body = fruitBody(
        (d) => R * (1 + 0.1 * Math.max(0, d.y) ** 4 - 0.05 * Math.exp(-(d.x * d.x) / 0.004) * Math.max(0, d.z)) * (1 - 0.04 * d.y * d.y),
        (d) => {
          const cheek = Math.max(0, 0.6 * d.z + 0.4 * d.y + 0.15 * wob(d, 5, 6, 4));
          return mix(mix(cream, pink, Math.min(1, cheek * 1.2)), blush, Math.max(0, cheek - 0.55));
        });
      return body;
    }),
  };
}

/** 果物に混ぜるもの */
function makeExtras(): Record<ExtraId, Kind> {
  const kind = (id: ExtraId, name: string, pitch: number, juice: number, chip: 'leaf' | 'spark', fleshC: number, fleshR: number, rough: number, build: () => MeshData, rule?: 'grain'): Kind => ({
    id, name, pitch, juice, juiceCount: 14, chip, build, rule,
    flesh: { center: lin(fleshC), rim: lin(fleshR) },
    material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 }),
  });
  return {
    // 栗：小さく、つやのある焦げ茶。下の座は明るい
    kuri: kind('kuri', '栗', 1.2, 0xe8d090, 'spark', 0xf2dc98, 0xe0c070, 0.35, () => {
      const R = 0.17, dark = lin(0x5a2a10), mid = lin(0x7a3e18), seat = lin(0xc8a878);
      return fruitBody(
        (d) => R * (1 - 0.32 * Math.abs(d.z) ** 1.5) * (1 + 0.25 * Math.max(0, d.y) ** 3) * (1 - 0.1 * Math.max(0, -d.y)),
        (d) => (d.y < -0.55 ? mix(seat, mid, (d.y + 1) * 0.6) : mix(mid, dark, 0.5 + 0.5 * Math.sin(Math.atan2(d.z, d.x) * 14 + d.y * 4) * 0.6)),
        2);
    }),
    // 紙風船：赤・白・黄・緑・青の縦の帯。軽く、ゆっくり落ちる
    fusen: kind('fusen', '紙風船', 1.3, 0xf4f0e0, 'leaf', 0xf8f4e8, 0xe8e0c8, 0.95, () => {
      const R = 0.27, cols = [0xd02a2a, 0xf4f0e0, 0xf0c020, 0x2a8a3a, 0x2a5ab8, 0xf4f0e0].map(lin);
      return fruitBody(
        (d) => {
          const a = Math.atan2(d.z, d.x);
          return R * (1 - 0.04 * Math.abs(Math.cos(6 * a)) * (1 - d.y * d.y));
        },
        (d) => {
          if (Math.abs(d.y) > 0.93) return cols[1];
          const a = Math.atan2(d.z, d.x) + Math.PI;
          return cols[Math.floor((a / (2 * Math.PI)) * 12) % cols.length];
        }, 4);
    }),
    // 薪：立てた丸太。樹皮は縦の筋、切り口は年輪。縦にしか割れない
    maki: kind('maki', '薪', 0.8, 0xd8b078, 'spark', 0xe8c890, 0xb88850, 0.95, () => {
      const g = new THREE.CylinderGeometry(0.12, 0.13, 0.62, 14, 1);
      const bark = lin(0x5a3e24), barkDark = lin(0x3a2614), wood = lin(0xd8b078), ring = lin(0xa87a48);
      return geoData(g, (x, y, z) => {
        const r = Math.hypot(x, z);
        if (Math.abs(y) > 0.3 && r < 0.115) return Math.sin(r * 120) > 0.3 ? ring : wood; // 切り口の年輪
        return Math.sin(Math.atan2(z, x) * 7) > 0.2 ? barkDark : bark;
      });
    }, 'grain'),
  };
}

export function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  g.computeBoundingSphere();
  return g;
}
