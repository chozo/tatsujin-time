// 斬る音の聞き比べ用 WAV を書き出す: node tools/render-sfx.mjs <出力フォルダ> [URL]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] ?? 'tools/sfx';
const URL = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage();
await page.goto(URL);
await page.waitForFunction(() => window.__game);
// [ファイル名, 長さ(秒), 時間の速さ, 斬る時刻の列（ゲーム内秒）]
const cutTimes = [0.02, 0.09, 0.15, 0.24, 0.3, 0.36, 0.45, 0.52, 0.6, 0.64, 0.7, 0.75, 0.8, 0.86, 0.92];
const jobs = [
  ['1-single-1sec.wav', 1.0, 1, [0]],
  ['2-single-5x.wav', 3.0, 0.2, [0]],
  ['3-replay-realtime.wav', 2.0, 1, cutTimes],
];
for (const [name, dur, speed, times] of jobs) {
  const b64 = await page.evaluate(async ({ dur, speed, times }) => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    const g = ctx.createGain(); g.gain.value = 0.8;
    comp.connect(g).connect(ctx.destination);
    const pitches = [0.94, 1.03, 1.07, 0.98, 0.97, 0.91];
    times.forEach((t, i) => {
      const when = 0.05 + t / speed;
      window.__game.audio.render(ctx, 'swing', { speed }, Math.max(0, when - 0.03 / speed ** 0.6), comp);
      window.__game.audio.render(ctx, 'cut', { speed, pitch: pitches[i % pitches.length] }, when, comp);
    });
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    const ab = new ArrayBuffer(44 + d.length * 2);
    const v = new DataView(ab);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, d.length * 2, true);
    for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    let s = ''; const u = new Uint8Array(ab);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  }, { dur, speed, times });
  writeFileSync(`${OUT}/${name}`, Buffer.from(b64, 'base64'));
  console.log(`${OUT}/${name}`);
}
await browser.close();
