import * as THREE from 'three';
import { CONFIG } from './config';
import { makeKinds, toGeometry, type Kind, type KindId } from './objects';
import { sliceMesh, type MeshData } from './slicer';
import { buildEnvironment } from './scene';
import { makeStage, type Flight, type Flutter, type Spawn } from './stage';
import { makeRng } from './rng';
import type { Audio } from './audio';

export type Phase = 'title' | 'focus' | 'play' | 'end' | 'interlude' | 'replayIntro' | 'replay' | 'result';
export type ReplayMode = 'fast' | 'slow';
/**
 * normal = 常人の目（現実の速さ）、master = 達人の目（slowScale 倍の遅さ）。この2つは「常人→達人」の流れで使う。
 * training = 修行の流れ。遅さ（何倍遅いか）は start に渡す。
 */
export type PlayMode = 'normal' | 'master' | 'training';

interface Piece {
  id: number;
  kind: Kind;
  root: number; // 元の落下物の番号
  mesh: THREE.Mesh;
  data: MeshData;
  radius: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  w: THREE.Vector3;
  birth: number; // 出現したステップ
  end: number; // 消えたステップ（切られた・落ちた）
  track: number[]; // ステップごとの位置と向き（7要素ずつ）
  stroke: number; // この破片を生んだ剣筋（同じ剣筋では切れない）
  fl?: Flutter; // 葉の舞い方
  fly?: Flight; // 飛んでくるものの飛び方
  t0: number; // 舞い始めた時刻（ゲーム内秒）
  blocked?: number; // 薪：横に振って弾かれた剣筋（同じ剣筋では何度も弾かない）
  cutAt?: number; // 飛び道具の破片なら、元の対象物を斬った時刻（ゲーム内秒）。消える時刻を決める
}

interface CutEvent { tw: number; pos: THREE.Vector3; n: THREE.Vector3; kind: Kind; seed: number; first: boolean }
interface TrailPt { x: number; y: number; tw: number; stroke: number; fast: boolean }
interface SwingEvent { tw: number }

export interface GameHud {
  setTimes(feel: number, real: number): void;
  setCount(n: number): void;
  setPhase(p: Phase, info?: Record<string, unknown>): void;
}

const STEPS = Math.round(CONFIG.worldDuration / CONFIG.dt);

export function createGame(root: HTMLElement, glCanvas: HTMLCanvasElement, fxCanvas: HTMLCanvasElement, hud: GameHud, audio: Audio) {
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.stage === 'leaves' ? 1.05 : 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 9 / 16, 0.1, 200);
  const camBase = new THREE.Vector3(0, CONFIG.camera.y, CONFIG.camera.z);
  camera.position.copy(camBase);
  camera.lookAt(0, CONFIG.camera.y, 0);
  const env = buildEnvironment(scene, CONFIG.stage === 'leaves' ? 'dusk' : 'day');
  const kinds = makeKinds();
  const fx = fxCanvas.getContext('2d')!;

  // 汁・破片
  const MAX_DROPS = 9000;
  const dropGeo = new THREE.BufferGeometry();
  const dropPos = new Float32Array(MAX_DROPS * 3);
  const dropCol = new Float32Array(MAX_DROPS * 3);
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  dropGeo.setAttribute('color', new THREE.BufferAttribute(dropCol, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dctx = dot.getContext('2d')!;
  const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, 32, 32);
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({
    size: 0.05, vertexColors: true, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false,
  }));
  drops.frustumCulled = false;
  scene.add(drops);

  // 状態
  let phase: Phase = 'title';
  let phaseT = 0; // 実秒
  let ambient = 0; // 背景の落ち葉の時計（ゲーム内秒）
  let ambientStart = 0;
  let step = 0;
  let acc = 0;
  let spawns: Spawn[] = [];
  let spawnIdx = 0;
  let pieces: Piece[] = [];
  let cuts: CutEvent[] = [];
  let hits: number[] = []; // 減点した時刻（ゲーム内秒）：被弾（果物は落としても減点しない）
  let blocks: CutEvent[] = []; // 薪を横に振って弾かれた（火花と音だけ出す）
  let trail: TrailPt[] = [];
  let swings: SwingEvent[] = [];
  let strokeId = 0;
  let nextId = 0;
  let beatT = 0;
  let replayMode: ReplayMode = 'fast';
  const speedOf = (m: ReplayMode) => (m === 'fast' ? 1 : timeScale);
  let playMode: PlayMode = 'normal';
  /** プレイ中の時間の速さ（常人の目は1、達人の目は slowScale） */
  let timeScale = 1;
  let normalResult: { cuts: number; objects: number } | null = null;
  /** 修行の流れの得点：斬った対象物（破片は数えない）− 被弾。tw までの分を数える */
  const scoreAt = (tw: number) => cuts.filter((c) => c.first && c.tw <= tw).length - hits.filter((h) => h <= tw).length;
  /** 満点の数：出てくるものすべて */
  const targetTotal = () => spawns.length;
  /** 画面上の数：修行の流れは得点、それ以外は斬った回数 */
  const hudCount = (tw = Infinity) => (playMode === 'training' ? scoreAt(tw) : cuts.filter((c) => c.tw <= tw).length);
  let replayT = 0; // ゲーム内秒
  let events: Record<string, unknown>[] = [];
  const emit = (type: string, data: Record<string, unknown> = {}) => events.push({ type, ...data });

  // 入力
  let pointerDown = false;
  let pending: { x: number; y: number }[] = [];
  let lastPt: { x: number; y: number } | null = null;
  let strokeFast = false;
  let W = 360, H = 640;

  const worldTime = () => Math.min(CONFIG.worldDuration, step * CONFIG.dt + acc);

  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    const dpr = Math.min(CONFIG.maxDpr, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    fxCanvas.width = Math.round(W * dpr);
    fxCanvas.height = Math.round(H * dpr);
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  function clearPieces() {
    for (const p of pieces) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      if (p.cutAt !== undefined) (p.mesh.material as THREE.Material).dispose();
    }
    pieces = [];
  }

  function record(p: Piece, force = false) {
    if (!force && (step - p.birth) % CONFIG.trackEvery !== 0) return;
    p.track.push(p.pos.x, p.pos.y, p.pos.z, p.quat.x, p.quat.y, p.quat.z, p.quat.w);
  }

  function addPiece(kind: Kind, rootIdx: number, data: MeshData, radius: number, pos: THREE.Vector3, vel: THREE.Vector3, quat: THREE.Quaternion, w: THREE.Vector3, stroke: number, fl?: Flutter, fly?: Flight, cutAt?: number) {
    // 消えていく破片は透明にできるよう、材質を自分用に複製する
    const mat = cutAt === undefined ? kind.material : Object.assign(kind.material.clone(), { transparent: true });
    const mesh = new THREE.Mesh(toGeometry(data), mat);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    scene.add(mesh);
    const p: Piece = { id: nextId++, kind, root: rootIdx, mesh, data, radius, pos, vel, quat, w, birth: step, end: Infinity, track: [], stroke, fl, fly, t0: step * CONFIG.dt, cutAt };
    record(p);
    pieces.push(p);
    return p;
  }

  const baseData = new Map<KindId, { data: MeshData; radius: number }>();
  function base(kind: Kind) {
    let b = baseData.get(kind.id);
    if (!b) {
      const data = kind.build();
      let r = 0;
      for (let i = 0; i < data.pos.length; i += 3) r = Math.max(r, Math.hypot(data.pos[i], data.pos[i + 1], data.pos[i + 2]));
      b = { data, radius: r };
      baseData.set(kind.id, b);
    }
    return b;
  }

  function spawnDue() {
    const t = step * CONFIG.dt;
    while (spawnIdx < spawns.length && spawns[spawnIdx].t <= t + 1e-9) {
      const s = spawns[spawnIdx];
      const kind = kinds[s.kind];
      const b = base(kind);
      const p = addPiece(kind, spawnIdx, b.data, b.radius, new THREE.Vector3(...s.p), new THREE.Vector3(...(s.fly?.v ?? [0, 0, 0])),
        new THREE.Quaternion(), new THREE.Vector3(...(s.fly?.w ?? [0, 0, 0])), -1, s.fl, s.fly);
      if (p.fl) leafPose(p, 0);
      else flyPose(p, 0);
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.copy(p.quat);
      p.track.length = 0;
      record(p, true);
      spawnIdx++;
    }
  }

  const dq = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');
  /**
   * 葉の舞い方から、その時刻に目指す速さを求める。
   * 左右に振り子のように揺れ、揺れの端では落ちる速さがゆるむ。
   * 切られていない葉は向きもここで決める。
   */
  function leafPose(p: Piece, tau: number) {
    const f = p.fl!;
    const ph = f.phase + 2 * Math.PI * f.freq * tau;
    const c = Math.cos(ph), s = Math.sin(ph);
    const vx = f.sway * c + f.drift + f.gust * Math.exp(-tau / f.gustTime);
    const vy = -f.fall * (0.45 + 0.55 * c * c);
    if (p.stroke === -1) {
      p.vel.set(vx, vy, 0);
      euler.set(f.pitch + 0.25 * Math.sin(ph * 0.5 + f.phase), f.yaw * c, f.roll * s);
      p.quat.setFromEuler(euler).multiply(dq.setFromAxisAngle(zAxis, f.spin + f.spinRate * tau));
    }
    return { vx, vy };
  }

  /** 飛んでくるものの向き。切られていないものだけ、飛び方から決める */
  const fwd = new THREE.Vector3(), zf = new THREE.Vector3(0, 0, 1), tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0.25, 0));
  function flyPose(p: Piece, tau: number) {
    const f = p.fly!;
    if (p.stroke !== -1 || f.align === 'tumble') return;
    fwd.copy(p.vel).normalize();
    if (f.align === 'dir') {
      p.quat.setFromUnitVectors(zf, fwd).multiply(dq.setFromAxisAngle(zf, f.spinRate * tau));
    } else {
      // 面をこちらへ向け、少し傾けて回す
      p.quat.setFromUnitVectors(zf, fwd.negate()).multiply(tilt).multiply(dq.setFromAxisAngle(zf, f.spinRate * tau));
    }
  }
  function spinFree(p: Piece, dt: number) {
    const wl = p.w.length();
    if (wl > 1e-6) {
      axis.copy(p.w).divideScalar(wl);
      dq.setFromAxisAngle(axis, wl * dt);
      p.quat.premultiply(dq).normalize();
    }
  }

  // 斬った破片の消え方（体感の秒をゲーム内の秒に直す）
  const fadeEnd = () => (CONFIG.cutFade.delay + CONFIG.cutFade.fade) * timeScale;
  const fading = (p: Piece) => p.cutAt !== undefined && step * CONFIG.dt - p.cutAt > CONFIG.cutFade.delay * timeScale;
  function setFade(p: Piece, tw: number) {
    if (p.cutAt === undefined) return;
    const age = tw - p.cutAt - CONFIG.cutFade.delay * timeScale;
    (p.mesh.material as THREE.Material).opacity = THREE.MathUtils.clamp(1 - age / (CONFIG.cutFade.fade * timeScale), 0, 1);
  }

  function simStep() {
    spawnDue();
    const dt = CONFIG.dt;
    const now = step * CONFIG.dt;
    for (const p of pieces) {
      if (p.end !== Infinity) continue;
      if (p.fly) {
        p.vel.y -= p.fly.g * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.stroke === -1 && p.fly.align !== 'tumble') flyPose(p, now + dt - p.t0);
        else spinFree(p, dt);
        continue;
      }
      const target = leafPose(p, now + dt - p.t0);
      if (p.stroke !== -1) {
        // 切られた葉は空気に押し戻されながら、目指す速さへ近づく
        const k = Math.min(1, CONFIG.leafDrag * dt);
        p.vel.x += (target.vx - p.vel.x) * k;
        p.vel.y += (target.vy - p.vel.y) * k;
        p.vel.z -= p.vel.z * k;
        p.w.multiplyScalar(1 - Math.min(1, CONFIG.leafSpinDrag * dt));
        const wl = p.w.length();
        if (wl > 1e-6) {
          axis.copy(p.w).divideScalar(wl);
          dq.setFromAxisAngle(axis, wl * dt);
          p.quat.premultiply(dq).normalize();
        }
      }
      p.pos.addScaledVector(p.vel, dt);
    }
    step++;
    for (const p of pieces) {
      if (p.end !== Infinity) continue;
      record(p);
      if (p.pos.y < CONFIG.killY) p.end = step + 1;
      else if (p.cutAt !== undefined && step * CONFIG.dt - p.cutAt >= fadeEnd()) p.end = step + 1;
      else if (p.fly && (p.fly.dropY !== undefined ? p.pos.y < p.fly.dropY : p.pos.z > CONFIG.missile.hitZ)) {
        p.end = step + 1;
        // 斬れずに手前まで来た（被弾）なら減点する。果物は落としても減点しない
        if (p.stroke === -1 && p.fly.dropY === undefined) { hits.push(step * CONFIG.dt); emit('hit', { kind: p.kind.id }); hud.setCount(hudCount()); }
      }
    }
  }

  // 画面座標への投影
  const tmp = new THREE.Vector3();
  const focalPx = () => H / 2 / Math.tan(THREE.MathUtils.degToRad(CONFIG.camera.fov / 2));
  function project(v: THREE.Vector3) {
    tmp.copy(v).project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H };
  }
  function rayDir(x: number, y: number) {
    return new THREE.Vector3((x / W) * 2 - 1, 1 - (y / H) * 2, 0.5).unproject(camera).sub(camera.position).normalize();
  }
  function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function tryCut(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
    const camPos = camera.position;
    const da = rayDir(a.x, a.y), db = rayDir(b.x, b.y);
    const n = new THREE.Vector3().crossVectors(da, db);
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    // 振った方向（画面上の向きを奥行き0の面へ）
    const swingDir = db.clone().sub(da).normalize();
    const f = focalPx();
    const live = pieces.filter((p) => p.end === Infinity && p.stroke !== strokeId && p.radius >= CONFIG.minPieceSize && !fading(p));
    let liveCount = pieces.filter((p) => p.end === Infinity).length;
    for (const p of live) {
      if (liveCount >= CONFIG.maxLivePieces || pieces.length >= CONFIG.maxTotalPieces) break;
      const sp = project(p.pos);
      const dist = camPos.distanceTo(p.pos);
      const rpx = (p.radius * f) / dist;
      if (segDist(sp.x, sp.y, a.x, a.y, b.x, b.y) > rpx * CONFIG.hitRadiusScale) continue;
      // 薪：形の縦（y 軸）に沿って振ったときだけ割れる。縦から約30°より横向きなら弾かれる
      if (p.stroke === -1 && p.kind.rule === 'grain' && Math.abs(n.dot(tmp.set(0, 1, 0).applyQuaternion(p.quat))) > 0.5) {
        if (p.blocked !== strokeId) {
          p.blocked = strokeId;
          blocks.push({ tw: step * CONFIG.dt, pos: p.pos.clone(), n: n.clone(), kind: p.kind, seed: p.id * 37 + step, first: false });
          audio.play('clang', { speed: timeScale });
          emit('block', { kind: p.kind.id });
        }
        continue;
      }
      const s = n.dot(tmp.copy(p.pos).sub(camPos));
      const sc = THREE.MathUtils.clamp(s, -0.5 * p.radius, 0.5 * p.radius);
      const pW = p.pos.clone().addScaledVector(n, -sc);
      const inv = p.quat.clone().invert();
      const nL = n.clone().applyQuaternion(inv);
      const pL = pW.clone().sub(p.pos).applyQuaternion(inv);
      const res = sliceMesh(p.data, nL.toArray(), pL.toArray(), p.kind.flesh);
      if (!res) continue;
      p.end = step;
      p.mesh.visible = false;
      liveCount++;
      const rng = makeRng(p.id * 7919 + step);
      const sep = CONFIG.separateSpeed;
      for (const [half, sign] of [[res.front, 1], [res.back, -1]] as const) {
        const off = new THREE.Vector3(...half.center).applyQuaternion(p.quat);
        const vel = p.vel.clone().addScaledVector(n, sign * sep * rng.range(0.8, 1.2)).addScaledVector(swingDir, 0.8);
        // 斬った勢いで上へ跳ね返らないよう、元より上向きにはしない
        vel.y = Math.min(vel.y, p.vel.y);
        const w = p.w.clone().add(new THREE.Vector3(rng.range(-7, 7), rng.range(-7, 7), rng.range(-3, 3)));
        // 切れた葉は小さく速く揺れ、少し速く落ちる
        const fl: Flutter | undefined = p.fl && {
          ...p.fl,
          fall: p.fl.fall * rng.range(1.15, 1.35),
          sway: p.fl.sway * rng.range(0.4, 0.6),
          freq: p.fl.freq * rng.range(1.2, 1.5),
          phase: rng.range(0, Math.PI * 2),
          gust: 0,
        };
        // 切れた飛び道具は、勢いのまま回りながら落ちる
        if (p.fly) w.multiplyScalar(2);
        const fly: Flight | undefined = p.fly && { ...p.fly, align: 'tumble' };
        addPiece(p.kind, p.root, half.data, half.radius, p.pos.clone().add(off), vel, p.quat.clone(), w, strokeId, fl, fly, p.fly ? p.cutAt ?? step * CONFIG.dt : undefined);
      }
      const ev: CutEvent = { tw: step * CONFIG.dt, pos: pW.clone(), n: n.clone(), kind: p.kind, seed: p.id * 31 + step, first: p.stroke === -1 };
      cuts.push(ev);
      audio.play('cut', { pitch: p.kind.pitch * rng.range(0.96, 1.04), speed: timeScale });
      emit('cut', { kind: p.kind.id, count: cuts.length });
      hud.setCount(hudCount());
    }
  }

  function processInput(dt: number) {
    if (!lastPt || pending.length === 0) { pending = []; return; }
    let len = 0;
    let prev = lastPt;
    for (const p of pending) { len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
    const fast = len / Math.max(dt, 1e-4) >= CONFIG.minSwipeSpeed;
    if (fast && !strokeFast) {
      strokeFast = true;
      swings.push({ tw: worldTime() });
      audio.play('swing', { speed: timeScale });
    }
    prev = lastPt;
    for (const p of pending) {
      if (fast) tryCut(prev, p);
      trail.push({ x: p.x / W, y: p.y / H, tw: worldTime(), stroke: strokeId, fast });
      prev = p;
    }
    lastPt = prev;
    pending = [];
  }

  // 入力（ポインタと撮影で同じ関数を通す）
  function touchDown(x: number, y: number) {
    audio.unlock();
    if (phase !== 'play') return;
    pointerDown = true;
    strokeId++;
    strokeFast = false;
    lastPt = { x, y };
    pending = [];
    trail.push({ x: x / W, y: y / H, tw: worldTime(), stroke: strokeId, fast: false });
  }
  function touchMove(x: number, y: number) {
    if (!pointerDown || phase !== 'play') return;
    pending.push({ x, y });
  }
  function touchUp(x: number, y: number) {
    if (!pointerDown) return;
    touchMove(x, y);
    pointerDown = false;
  }

  // 汁の位置はカットの時刻から計算する（リプレイでも同じになる）
  const col = new THREE.Color();
  function updateDrops(tw: number) {
    let k = 0;
    for (const c of [...cuts, ...blocks]) {
      const age = tw - c.tw;
      const block = !c.first && blocks.includes(c);
      const spark = block || c.kind.chip === 'spark';
      const life = spark ? 0.45 : CONFIG.chipLife;
      if (age < 0 || age > life) continue;
      const r = makeRng(c.seed);
      // 弾かれたときは刃と薪の当たった火花
      col.setHex(block ? 0xffe6a0 : c.kind.juice);
      const count = block ? 12 : c.kind.juiceCount;
      for (let i = 0; i < count && k < MAX_DROPS; i++) {
        const dir = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize();
        const side = r.next() < 0.5 ? 1 : -1;
        dir.addScaledVector(c.n, side * 0.8);
        // 葉くずは空気に止められて、ゆっくり揺れながら落ちる
        const sp = spark ? r.range(3, 8) : r.range(1, 2.5);
        const tau = spark ? 0.25 : 0.15;
        const reach = sp * tau * (1 - Math.exp(-age / tau));
        const ph = r.range(0, 6.28), fq = r.range(1.5, 3);
        // 火花は速く飛び散って落ちる。葉くずはゆっくり揺れながら落ちる
        const x = c.pos.x + dir.x * reach + (spark ? 0 : Math.sin(ph + age * fq * 6.28) * 0.06);
        const y = c.pos.y + dir.y * reach - (spark ? 3 * age * age : r.range(0.6, 1.1) * age);
        const z = c.pos.z + dir.z * reach;
        dropPos.set([x, y, z], k * 3);
        const fade = Math.max(0, 1 - age / life);
        dropCol.set([col.r * fade, col.g * fade, col.b * fade], k * 3);
        k++;
      }
    }
    dropGeo.setDrawRange(0, k);
    dropGeo.attributes.position.needsUpdate = true;
    dropGeo.attributes.color.needsUpdate = true;
  }

  function shake(tw: number) {
    camera.position.copy(camBase);
    for (const c of cuts) {
      const age = tw - c.tw;
      if (age < 0 || age > 0.08) continue;
      const a = 0.018 * Math.exp(-age / 0.018);
      const r = makeRng(c.seed + 1);
      camera.position.x += r.range(-a, a);
      camera.position.y += r.range(-a, a);
    }
  }

  // リプレイ：記録した位置を時刻で補間する
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function applyReplay(tw: number) {
    const f = tw / CONFIG.dt;
    for (const p of pieces) {
      const vis = f >= p.birth && f < p.end && p.track.length > 0;
      p.mesh.visible = vis;
      if (!vis) continue;
      const n = p.track.length / 7;
      const lf = Math.min(n - 1, Math.max(0, (f - p.birth) / CONFIG.trackEvery));
      const i0 = Math.floor(lf), i1 = Math.min(n - 1, i0 + 1), t = lf - i0;
      const A = i0 * 7, B = i1 * 7, tr = p.track;
      p.mesh.position.set(tr[A] + (tr[B] - tr[A]) * t, tr[A + 1] + (tr[B + 1] - tr[A + 1]) * t, tr[A + 2] + (tr[B + 2] - tr[A + 2]) * t);
      qa.set(tr[A + 3], tr[A + 4], tr[A + 5], tr[A + 6]);
      qb.set(tr[B + 3], tr[B + 4], tr[B + 5], tr[B + 6]);
      p.mesh.quaternion.slerpQuaternions(qa, qb, t);
      setFade(p, tw);
    }
  }
  function applyLive() {
    for (const p of pieces) {
      p.mesh.visible = p.end === Infinity;
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.copy(p.quat);
      setFade(p, step * CONFIG.dt);
    }
  }

  /** 被弾したら画面の縁を赤く光らせる（時刻から決めるのでリプレイでも同じ） */
  function drawHits(tw: number) {
    let a = 0;
    for (const h of hits) {
      const age = tw - h;
      if (age >= 0 && age < 0.25) a = Math.max(a, 1 - age / 0.25);
    }
    if (a <= 0) return;
    const g = fx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(200,0,0,0)');
    g.addColorStop(1, `rgba(220,20,20,${0.55 * a})`);
    fx.fillStyle = g;
    fx.fillRect(0, 0, W, H);
  }

  function drawTrails(tw: number, life: number, ghost: boolean) {
    fx.clearRect(0, 0, W, H);
    drawHits(tw);
    if (trail.length < 2) return;
    fx.lineCap = 'round';
    fx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      if (a.stroke !== b.stroke || !b.fast) continue;
      if (b.tw > tw + 1e-9) break;
      const age = tw - b.tw;
      let alpha = 1 - age / life;
      if (alpha <= 0) {
        if (!ghost) continue;
        alpha = 0;
      }
      const ax = a.x * W, ay = a.y * H, bx = b.x * W, by = b.y * H;
      if (ghost) {
        fx.strokeStyle = 'rgba(190,220,255,0.16)';
        fx.lineWidth = 1.5;
        fx.beginPath(); fx.moveTo(ax, ay); fx.lineTo(bx, by); fx.stroke();
      }
      if (alpha > 0) {
        fx.strokeStyle = `rgba(150,200,255,${0.35 * alpha})`;
        fx.lineWidth = 14 * alpha + 2;
        fx.beginPath(); fx.moveTo(ax, ay); fx.lineTo(bx, by); fx.stroke();
        fx.strokeStyle = `rgba(255,255,255,${alpha})`;
        fx.lineWidth = 4 * alpha + 1;
        fx.beginPath(); fx.moveTo(ax, ay); fx.lineTo(bx, by); fx.stroke();
      }
    }
  }

  function setPhase(p: Phase, info: Record<string, unknown> = {}) {
    phase = p;
    phaseT = 0;
    root.dataset.phase = p;
    hud.setPhase(p, info);
    emit('phase', { phase: p });
  }

  let dan = 1;
  /** slow は修行の流れで使う遅さ（何倍遅いか）、d は飛び道具の段 */
  function start(mode: PlayMode = 'normal', slow = 1, d = 1) {
    audio.unlock();
    clearPieces();
    cuts = []; trail = []; swings = []; hits = []; blocks = [];
    nextId = 0; // 番号を振り直し、2回のプレイで同じ斬り方なら破片の散り方も同じにする
    step = 0; acc = 0; spawnIdx = 0; strokeId = 0; beatT = 0;
    dan = d;
    spawns = makeStage(dan);
    pointerDown = false; lastPt = null; pending = [];
    playMode = mode;
    timeScale = mode === 'normal' ? 1 : mode === 'master' ? CONFIG.slowScale : 1 / Math.max(1, slow);
    if (mode === 'normal') normalResult = null;
    hud.setCount(0);
    hud.setTimes(CONFIG.worldDuration / timeScale, 0);
    fx.clearRect(0, 0, W, H);
    updateDrops(-1);
    audio.play(timeScale === 1 ? 'taiko' : 'focus');
    setPhase('focus', { mode, slow: Math.round(1 / timeScale) });
  }

  function beginPlay() {
    ambientStart = ambient;
    spawnDue();
    setPhase('play');
  }

  function replay(mode: ReplayMode) {
    audio.reset();
    replayMode = mode;
    replayT = 0;
    applyReplay(0);
    updateDrops(0);
    hud.setCount(0);
    hud.setTimes(CONFIG.worldDuration / CONFIG.slowScale, 0);
    fx.clearRect(0, 0, W, H);
    if (mode === 'fast') {
      audio.play('taiko');
      setPhase('replayIntro', { mode });
    } else {
      beginReplay();
    }
  }

  function beginReplay() {
    const speed = speedOf(replayMode);
    const lead = 0.02;
    for (const s of swings) audio.play('swing', { speed }, lead + s.tw / speed);
    for (const c of cuts) audio.play('cut', { pitch: c.kind.pitch, speed, gain: replayMode === 'fast' ? 0.8 : 1 }, lead + c.tw / speed);
    for (const c of blocks) audio.play('clang', { speed, gain: replayMode === 'fast' ? 0.8 : 1 }, lead + c.tw / speed);
    if (replayMode === 'fast') audio.play('sheath', {}, lead + CONFIG.worldDuration / speed + 0.05);
    setPhase('replay', { mode: replayMode });
  }

  function summary() {
    return {
      mode: playMode, slow: Math.round(1 / timeScale), dan, cuts: cuts.length, objects: cutObjects(), total: targetTotal(),
      hits: hits.length, score: scoreAt(Infinity), stage: CONFIG.stage,
    };
  }

  function cutObjects() {
    const roots = new Set<number>();
    for (const p of pieces) if (p.stroke !== -1) roots.add(p.root);
    return roots.size;
  }

  function result() {
    const n = cuts.length;
    const rank = [...CONFIG.ranks].reverse().find((r) => n >= r.min)!.name;
    setPhase('result', { ...summary(), rank, normal: normalResult?.cuts ?? null });
  }

  function toTitle() {
    audio.reset();
    clearPieces();
    cuts = []; trail = []; blocks = [];
    updateDrops(-1);
    fx.clearRect(0, 0, W, H);
    setPhase('title');
  }

  function update(dt: number) {
    phaseT += dt;
    switch (phase) {
      case 'title':
        ambient += dt;
        env.updatePetals(ambient);
        break;
      case 'focus': {
        const k = Math.min(1, phaseT / CONFIG.focusTime);
        const scale = 1 + (timeScale - 1) * (1 - (1 - k) * (1 - k));
        ambient += dt * scale;
        env.updatePetals(ambient);
        if (k >= 1) beginPlay();
        break;
      }
      case 'play': {
        processInput(dt);
        acc += dt * timeScale;
        while (acc >= CONFIG.dt && step < STEPS) { acc -= CONFIG.dt; simStep(); }
        if (step >= STEPS) acc = 0;
        const tw = worldTime();
        env.updatePetals(ambientStart + tw);
        applyLive();
        updateDrops(tw);
        shake(tw);
        hud.setTimes((CONFIG.worldDuration - tw) / timeScale, tw);
        beatT += dt;
        if (beatT >= 1.25) { beatT -= 1.25; audio.play('beat'); }
        if (step >= STEPS) {
          pointerDown = false;
          audio.play('sheath', { gain: 0.8 });
          setPhase('end', summary());
        }
        break;
      }
      case 'end':
        if (phaseT >= CONFIG.endTime) {
          if (playMode === 'normal') {
            // 常人の目の結果を残して、達人の目へ
            normalResult = { cuts: cuts.length, objects: cutObjects() };
            setPhase('interlude', { ...normalResult, total: targetTotal(), hits: hits.length, stage: CONFIG.stage });
          } else replay('fast');
        }
        break;
      case 'interlude':
        break;
      case 'replayIntro':
        if (phaseT >= CONFIG.replayIntroTime) beginReplay();
        break;
      case 'replay': {
        const speed = speedOf(replayMode);
        replayT = Math.min(CONFIG.worldDuration, replayT + dt * speed);
        applyReplay(replayT);
        updateDrops(replayT);
        shake(replayT);
        env.updatePetals(ambientStart + replayT);
        hud.setTimes((CONFIG.worldDuration - replayT) / CONFIG.slowScale, replayT);
        hud.setCount(hudCount(replayT));
        if (replayT >= CONFIG.worldDuration && phaseT >= CONFIG.worldDuration / speed + CONFIG.replayHold) result();
        break;
      }
      case 'result':
        break;
    }
  }

  function draw() {
    renderer.render(scene, camera);
    // 剣筋の残像は体感で同じ長さにする（遅い時間ほどゲーム内では短い）
    const playLife = CONFIG.trailLife.replayFast * Math.min(1, timeScale / CONFIG.slowScale * (CONFIG.trailLife.play / CONFIG.trailLife.replayFast));
    if (phase === 'play' || phase === 'end') drawTrails(worldTime(), playLife, false);
    else if (phase === 'replay' || phase === 'result') {
      const fast = replayMode !== 'slow';
      drawTrails(replayT, fast ? CONFIG.trailLife.replayFast : CONFIG.trailLife.replaySlow, fast);
    }
  }

  function state() {
    return {
      phase,
      phaseT,
      step,
      worldTime: phase === 'replay' || phase === 'result' ? replayT : worldTime(),
      cuts: cuts.length,
      hits: hits.length,
      total: targetTotal(),
      score: scoreAt(Infinity),
      slow: Math.round(1 / timeScale),
      dan,
      stage: CONFIG.stage,
      pieces: pieces.filter((p) => p.end === Infinity).length,
      /** 斬った飛び道具の破片のうち、まだ残っているものと、その不透明度 */
      cutPieces: pieces.filter((p) => p.end === Infinity && p.cutAt !== undefined).map((p) => +(p.mesh.material as THREE.Material).opacity.toFixed(2)),
      replayMode,
      playMode,
      targets: pieces
        .filter((p) => p.end === Infinity && p.radius >= CONFIG.minPieceSize)
        .map((p) => ({ id: p.id, kind: p.kind.id, whole: p.stroke === -1, r: (p.radius * focalPx()) / camera.position.distanceTo(p.pos), ...project(p.pos) })),
      size: { W, H },
    };
  }

  resize();
  return {
    update, draw, resize, start, replay, toTitle, state,
    touchDown, touchMove, touchUp,
    drainEvents() { const e = events; events = []; return e; },
    get phase() { return phase; },
  };
}
export type Game = ReturnType<typeof createGame>;
