// 閉じたメッシュを平面で2つに分け、切り口を塞ぐ。
// 切り口はつながった部分ごとに塞ぐので、紅葉のような凹んだ形でも離れた部分の間を埋めない。
// 形式: 頂点を共有しない三角形の列（位置・法線・色が3要素ずつ）。

export interface MeshData {
  pos: number[];
  nrm: number[];
  col: number[];
}

export interface FleshColors {
  center: [number, number, number];
  rim: [number, number, number];
}

export interface SliceHalf {
  data: MeshData;
  /** 元の座標系での新しい原点（形の中心） */
  center: [number, number, number];
  /** 中心からの最大距離 */
  radius: number;
}

type V = { p: number[]; n: number[]; c: number[] };

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerp = (a: number[], b: number[], t: number) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const normalize = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function vert(d: MeshData, i: number): V {
  return {
    p: [d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]],
    n: [d.nrm[i * 3], d.nrm[i * 3 + 1], d.nrm[i * 3 + 2]],
    c: [d.col[i * 3], d.col[i * 3 + 1], d.col[i * 3 + 2]],
  };
}

function push(d: MeshData, v: V) {
  d.pos.push(v.p[0], v.p[1], v.p[2]);
  d.nrm.push(v.n[0], v.n[1], v.n[2]);
  d.col.push(v.c[0], v.c[1], v.c[2]);
}

/** 三角形を半空間（s >= 0）で切り抜く。切り口の点を cut に足す */
function clip(tri: V[], s: number[], out: MeshData, cut: number[][] | null) {
  const poly: V[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const a = tri[i], b = tri[j];
    const sa = s[i], sb = s[j];
    if (sa >= 0) poly.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      const v = { p: lerp(a.p, b.p, t), n: normalize(lerp(a.n, b.n, t)), c: lerp(a.c, b.c, t) };
      poly.push(v);
      cut?.push(v.p);
    } else if (sa === 0) {
      cut?.push(a.p);
    }
  }
  for (let k = 1; k + 1 < poly.length; k++) {
    push(out, poly[0]);
    push(out, poly[k]);
    push(out, poly[k + 1]);
  }
}

/** 切り口の点を、三角形ごとの線分でつながった組に分ける */
function groupCut(segs: number[][][]): number[][][] {
  const key = (p: number[]) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
  const parent = new Map<string, string>();
  const pts = new Map<string, number[]>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const seg of segs) {
    for (const p of seg) {
      const k = key(p);
      if (!parent.has(k)) { parent.set(k, k); pts.set(k, p); }
    }
    for (let i = 1; i < seg.length; i++) {
      const a = find(key(seg[0])), b = find(key(seg[i]));
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map<string, number[][]>();
  for (const [k, p] of pts) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(p);
  }
  return [...groups.values()];
}

/** 切り口（つながった1組。凸多角形として塞ぐ）を作る。faceN は切り口の面が向く方向 */
function cap(out: MeshData, pts: number[][], faceN: number[], flesh: FleshColors) {
  if (pts.length < 3) return;
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
  const ref = Math.abs(faceN[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(faceN, ref));
  const w = cross(faceN, u);
  const sorted = pts
    .map((p) => { const d = sub(p, c); return { p, a: Math.atan2(dot(d, w), dot(d, u)) }; })
    .sort((x, y) => x.a - y.a);
  const ring: number[][] = [];
  for (const s of sorted) {
    const last = ring[ring.length - 1];
    if (!last || Math.hypot(...sub(s.p, last)) > 1e-5) ring.push(s.p);
  }
  if (ring.length > 2 && Math.hypot(...sub(ring[0], ring[ring.length - 1])) < 1e-5) ring.pop();
  if (ring.length < 3) return;
  const inner = ring.map((p) => lerp(c, p, 0.86));
  const tri = (a: number[], b: number[], d: number[], ca: number[], cb: number[], cd: number[]) => {
    // 面の向きを faceN にそろえる
    if (dot(cross(sub(b, a), sub(d, a)), faceN) < 0) { [b, d] = [d, b]; [cb, cd] = [cd, cb]; }
    push(out, { p: a, n: faceN, c: ca });
    push(out, { p: b, n: faceN, c: cb });
    push(out, { p: d, n: faceN, c: cd });
  };
  const cc = flesh.center, rc = flesh.rim;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    tri(c, inner[i], inner[j], cc, cc, cc);
    tri(inner[i], ring[i], ring[j], cc, rc, rc);
    tri(inner[i], ring[j], inner[j], cc, rc, cc);
  }
}

function recenter(d: MeshData): SliceHalf {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], d.pos[i + k]);
      max[k] = Math.max(max[k], d.pos[i + k]);
    }
  }
  const c: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let r = 0;
  for (let i = 0; i < d.pos.length; i += 3) {
    d.pos[i] -= c[0]; d.pos[i + 1] -= c[1]; d.pos[i + 2] -= c[2];
    r = Math.max(r, Math.hypot(d.pos[i], d.pos[i + 1], d.pos[i + 2]));
  }
  return { data: d, center: c, radius: r };
}

/**
 * 平面 dot(n, p - point) = 0 で切る。
 * front は n の向き側。どちらかが空なら null を返す。
 */
export function sliceMesh(
  d: MeshData,
  n: number[],
  point: number[],
  flesh: FleshColors,
): { front: SliceHalf; back: SliceHalf } | null {
  n = normalize(n);
  const front: MeshData = { pos: [], nrm: [], col: [] };
  const back: MeshData = { pos: [], nrm: [], col: [] };
  const segs: number[][][] = [];
  const triCount = d.pos.length / 9;
  const eps = 1e-7;
  for (let t = 0; t < triCount; t++) {
    const tri = [vert(d, t * 3), vert(d, t * 3 + 1), vert(d, t * 3 + 2)];
    const s = tri.map((v) => {
      const x = dot(n, sub(v.p, point));
      return Math.abs(x) < eps ? 0 : x;
    });
    const seg: number[][] = [];
    clip(tri, s, front, seg);
    if (seg.length) segs.push(seg);
    clip(tri, s.map((x) => (x === 0 ? 0 : -x)), back, null);
  }
  if (front.pos.length < 9 || back.pos.length < 9 || segs.length < 3) return null;
  for (const g of groupCut(segs)) {
    cap(front, g, [-n[0], -n[1], -n[2]], flesh);
    cap(back, g, n, flesh);
  }
  return { front: recenter(front), back: recenter(back) };
}

/** 閉じたメッシュの体積（確認用） */
export function meshVolume(d: MeshData): number {
  let v = 0;
  for (let i = 0; i < d.pos.length; i += 9) {
    const a = d.pos.slice(i, i + 3), b = d.pos.slice(i + 3, i + 6), c = d.pos.slice(i + 6, i + 9);
    v += dot(a, cross(b, c)) / 6;
  }
  return v;
}
