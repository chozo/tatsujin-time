import * as THREE from 'three';
import { makeRng } from './rng';

/** 背景の見た目。dusk = 夕暮れ（落ち葉のステージ）、day = 明るい秋晴れ（飛び道具のステージ） */
export type Look = 'dusk' | 'day';

const LOOKS = {
  dusk: {
    fog: 0x2a1830, fogNear: 14, fogFar: 60,
    top: '0.035,0.03,0.11', mid: '0.32,0.09,0.16', hor: '0.95,0.36,0.12', sun: 1.4,
    ridges: [0x4a1c34, 0x2e1228, 0x1c0b1c], ground: 0x1e1612, stone: 0x4a4440,
    bamboo: 0x3f6a2a, bambooFar: 0x223a18,
    hemi: [0xffc89a, 0x2a1a30, 1.3], key: [0xffe0bb, 2.2], rim: [0xff7a3a, 1.6],
    petals: true,
  },
  day: {
    fog: 0xd8dce0, fogNear: 18, fogFar: 85,
    top: '0.18,0.42,0.85', mid: '0.45,0.66,0.92', hor: '0.98,0.9,0.78', sun: 0.6,
    ridges: [0xa8b4c4, 0x8a9a88, 0x6a7a5a], ground: 0x8a7a62, stone: 0xb0a898,
    bamboo: 0x6a9a42, bambooFar: 0x4a7a38,
    hemi: [0xfff4e0, 0x7a7060, 2.0], key: [0xfff2dc, 2.6], rim: [0xffe0b0, 1.0],
    petals: false,
  },
};

/** 竹林と鳥居。背景の落ち葉は時刻 t（ゲーム内秒）から位置を決める */
export function buildEnvironment(scene: THREE.Scene, look: Look = 'dusk') {
  const L = LOOKS[look];
  const rng = makeRng(7);
  scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);

  // 空
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 top = vec3(${L.top});
          vec3 mid = vec3(${L.mid});
          vec3 hor = vec3(${L.hor});
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h));
          c = mix(c, top, smoothstep(0.18, 0.6, h));
          // 太陽
          vec3 sd = normalize(vec3(0.15, 0.06, -1.0));
          float d = dot(vP, sd);
          c += vec3(1.0,0.55,0.2) * smoothstep(0.9975, 0.999, d) * ${L.sun.toFixed(2)};
          c += vec3(0.9,0.35,0.1) * pow(max(d,0.0), 60.0) * 0.5;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  // 山並み
  const ridge = (z: number, color: number, amp: number, base: number, seed: number) => {
    const r = makeRng(seed);
    const shape = new THREE.Shape();
    const w = 140;
    shape.moveTo(-w / 2, -20);
    for (let i = 0; i <= 60; i++) {
      const x = -w / 2 + (w * i) / 60;
      const y = base + Math.sin(i * 0.37 + seed) * amp * 0.6 + Math.sin(i * 0.11 + seed * 2) * amp + r.range(-0.4, 0.4);
      shape.lineTo(x, y);
    }
    shape.lineTo(w / 2, -20);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, fog: false }));
    m.position.z = z;
    scene.add(m);
  };
  ridge(-75, L.ridges[0], 4, 4, 1);
  ridge(-60, L.ridges[1], 3, 1.5, 2);
  ridge(-45, L.ridges[2], 2, -0.5, 3);

  // 地面
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: L.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.7;
  scene.add(ground);
  // 石畳
  const stoneMat = new THREE.MeshStandardMaterial({ color: L.stone, roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.6 + rng.range(-0.2, 0.2), 0.08, 1.1), stoneMat);
    s.position.set(rng.range(-0.15, 0.15), -2.66, 1.5 - i * 1.4);
    s.rotation.y = rng.range(-0.08, 0.08);
    scene.add(s);
  }

  // 鳥居
  const red = new THREE.MeshStandardMaterial({ color: 0xb8241c, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.8 });
  const torii = new THREE.Group();
  for (const x of [-2.2, 2.2]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 7, 12), red);
    p.position.set(x, 0.8, 0);
    torii.add(p);
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.4, 0.55), black);
  kasagi.position.y = 4.35;
  torii.add(kasagi);
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.35, 0.5), red);
  shimaki.position.y = 3.95;
  torii.add(shimaki);
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.28, 0.3), red);
  nuki.position.y = 3.0;
  torii.add(nuki);
  torii.position.set(0, -0.6, -16);
  scene.add(torii);

  // 竹
  const bambooMat = new THREE.MeshStandardMaterial({ color: L.bamboo, roughness: 0.5 });
  const bambooDark = new THREE.MeshStandardMaterial({ color: L.bambooFar, roughness: 0.6 });
  for (let i = 0; i < 46; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = rng.range(-22, -1.5);
    const x = side * rng.range(2.4, 2.4 + (-z) * 0.55);
    const r = rng.range(0.07, 0.14);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 14, 8), z < -9 ? bambooDark : bambooMat);
    b.position.set(x, 4.3, z);
    b.rotation.z = rng.range(-0.05, 0.05);
    scene.add(b);
  }

  // 光
  scene.add(new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]));
  const key = new THREE.DirectionalLight(L.key[0], L.key[1]);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(L.rim[0], L.rim[1]);
  rim.position.set(2, 1, -8);
  scene.add(rim);

  // 背景の小さな落ち葉（紅・橙・黄）
  const PETALS = 140;
  const petalGeo = new THREE.PlaneGeometry(0.07, 0.055);
  const petalMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, PETALS);
  const leafColors = [0xc8281c, 0xe0601a, 0xf0a020, 0xe8c030, 0xa8201c];
  for (let i = 0; i < PETALS; i++) petals.setColorAt(i, new THREE.Color(leafColors[i % leafColors.length]));
  const seeds = Array.from({ length: PETALS }, () => ({
    x: rng.range(-3, 3), y: rng.range(-3, 4), z: rng.range(-3, 2.5),
    vy: rng.range(0.8, 1.4), vx: rng.range(0.2, 0.6),
    sw: rng.range(0.1, 0.3), sf: rng.range(2, 5), ph: rng.range(0, 6.28),
    rx: rng.range(2, 7), ry: rng.range(1, 5),
  }));
  // 明るい秋晴れでは、斬る対象が見づらくならないよう背景の落ち葉を出さない
  petals.visible = L.petals;
  scene.add(petals);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const updatePetals = (t: number) => {
    seeds.forEach((s, i) => {
      const span = 7;
      let y = s.y - s.vy * t;
      y = ((((y + 3) % span) + span) % span) - 3;
      let x = s.x + s.vx * t + Math.sin(t * s.sf + s.ph) * s.sw;
      x = ((((x + 3) % 6) + 6) % 6) - 3;
      pos.set(x, y, s.z);
      e.set(t * s.rx + s.ph, t * s.ry, s.ph);
      q.setFromEuler(e);
      m4.compose(pos, q, one);
      petals.setMatrixAt(i, m4);
    });
    petals.instanceMatrix.needsUpdate = true;
  };
  updatePetals(0);
  return { updatePetals };
}
