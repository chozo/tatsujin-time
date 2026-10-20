// 告知動画の静かなBGM（約31秒）をコードで作り、tools/promo/bgm.wav に書き出す: node tools/promo/make-bgm.mjs
// 音源ファイルは使わず、数式で作る（著作権の心配がない）。打楽器は入れない。
// ゆっくり膨らんで消えるやわらかい和音（パッド）と、ときどき鳴る小さな鈴のような高い音だけ。
// 和音は Dmaj7 → Bm7 → Gmaj7 → A6 をくり返し、最後は Dmaj9 で静かに終わる。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const DUR = 31;
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// MIDI の音の番号（60 = 真ん中のド）
const CHORDS = [
  [50, 57, 61, 66, 69], // Dmaj7（D A C# F# A）
  [47, 54, 57, 62, 66], // Bm7（B F# A D F#）
  [43, 50, 54, 59, 62], // Gmaj7（G D F# B D）
  [45, 52, 57, 61, 66], // A6（A E A C# F#）
];
const FINAL = [50, 57, 61, 64, 66, 69]; // Dmaj9

/** やわらかい和音の1音。基音と少しの倍音を、左右でわずかにずらして重ねる（広がりを出す） */
function pad(t, len, midi, vel) {
  const f = hz(midi);
  const start = Math.round(t * SR);
  const n = Math.round(len * SR);
  const atk = 1.6, rel = 2.2;
  for (let k = 0; k < n; k++) {
    const s = k / SR;
    const env = Math.min(1, s / atk) * Math.min(1, Math.max(0, (len - s) / rel));
    const e = env * env * (3 - 2 * env); // なめらかに
    const w = 2 * Math.PI * s;
    const l = Math.sin(w * f * 0.998) + 0.25 * Math.sin(w * f * 2 * 0.999) + 0.08 * Math.sin(w * f * 3);
    const r = Math.sin(w * f * 1.002) + 0.25 * Math.sin(w * f * 2 * 1.001) + 0.08 * Math.sin(w * f * 3);
    const i = start + k;
    if (i >= N) break;
    L[i] += l * e * vel;
    R[i] += r * e * vel;
  }
}

/** 小さな鈴のような高い音（ゆっくり減衰する） */
function bell(t, midi, vel, pan) {
  const f = hz(midi);
  const start = Math.round(t * SR);
  const n = Math.round(3.5 * SR);
  for (let k = 0; k < n; k++) {
    const s = k / SR;
    const e = Math.min(1, s / 0.01) * Math.exp(-s * 1.4);
    const v = (Math.sin(2 * Math.PI * f * s) + 0.3 * Math.sin(2 * Math.PI * f * 2.76 * s) * Math.exp(-s * 3)) * e * vel;
    const i = start + k;
    if (i >= N) break;
    L[i] += v * (1 - Math.max(0, pan));
    R[i] += v * (1 + Math.min(0, pan));
  }
}

// 和音：1つ 3.6 秒、少し重ねてつなぐ
const STEP = 3.6;
let c = 0;
for (let t = 0; t < 25.2; t += STEP, c++) {
  for (const m of CHORDS[c % CHORDS.length]) pad(t, STEP + 1.6, m, 0.05);
}
for (const m of FINAL) pad(25.2, 5.8, m, 0.05);

// 鈴：和音の音から選んで、まばらに鳴らす
const bells = [[1.8, 81, -0.3], [5.4, 78, 0.3], [9.1, 83, -0.2], [12.6, 81, 0.25], [16.3, 76, -0.3], [19.9, 78, 0.2], [23.4, 81, -0.25], [26.5, 85, 0.2], [27.6, 81, -0.1]];
for (const [t, m, pan] of bells) bell(t, m, 0.035, pan);

// 仕上げ：簡単な残響、頭打ちで -6dBFS にそろえ、最初と最後をフェード
function reverb(x) {
  const out = Float32Array.from(x);
  for (const [d, g] of [[0.043, 0.25], [0.067, 0.2], [0.101, 0.16], [0.149, 0.12], [0.223, 0.08]]) {
    const o = Math.round(d * SR);
    for (let i = o; i < N; i++) out[i] += x[i - o] * g;
  }
  return out;
}
const outL = reverb(L), outR = reverb(R);
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
const scale = 0.5 / peak;
const fadeIn = SR * 0.8;
const fadeFrom = Math.round(28.0 * SR);
const data = Buffer.alloc(44 + N * 4);
data.write('RIFF', 0); data.writeUInt32LE(36 + N * 4, 4); data.write('WAVE', 8);
data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const f = Math.min(1, i / fadeIn) * (i > fadeFrom ? Math.max(0, 1 - (i - fadeFrom) / (SR * 2.6)) : 1);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outL[i] * scale * f)) * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outR[i] * scale * f)) * 32767), 46 + i * 4);
}
const out = fileURLToPath(new URL('./bgm.wav', import.meta.url));
fs.writeFileSync(out, data);
console.log('書き出し', out, `${DUR}秒`);
