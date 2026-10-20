// 効果音は Web Audio で合成する。render は普段の再生と動画の書き出しで共用する。

export type SfxName = 'cut' | 'swing' | 'beat' | 'focus' | 'sheath' | 'taiko' | 'clang';
export interface SfxArgs { pitch?: number; speed?: number; gain?: number }

/**
 * 時間の速さ（1 = 実際、0.2 = 5倍遅い）から、音の伸ばし方と高さを決める。
 * そのまま伸ばすと低すぎるので控えめにする（5倍遅いとき、長さ約2.6倍・高さ約0.6倍）。
 */
export function stretch(speed: number) {
  const slow = 1 / Math.max(0.01, speed);
  return { st: Math.pow(slow, 0.6), pt: Math.pow(slow, -0.3) };
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

function env(ctx: BaseAudioContext, out: AudioNode, when: number, peak: number, attack: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  g.connect(out);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, when: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine', attack = 0.004) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
  o.connect(env(ctx, out, when, peak, attack, dur));
  o.start(when);
  o.stop(when + attack + dur + 0.05);
}

function hiss(ctx: BaseAudioContext, out: AudioNode, when: number, f0: number, f1: number, q: number, dur: number, peak: number, attack = 0.005) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, when);
  bp.frequency.exponentialRampToValueAtTime(f1, when + attack + dur);
  src.connect(bp).connect(env(ctx, out, when, peak, attack, dur));
  src.start(when, (f0 * 7.13) % 1.5);
  src.stop(when + attack + dur + 0.05);
}

export function renderSfx(ctx: BaseAudioContext, name: SfxName, args: SfxArgs, when: number, out: AudioNode = ctx.destination) {
  const p = args.pitch ?? 1;
  const k = args.gain ?? 1;
  switch (name) {
    case 'cut': {
      // 刀で斬る音。実際の速さ（speed=1）の音を元に、遅いほど低く長くする
      const { st, pt } = stretch(args.speed ?? 1);
      const q = p * pt;
      // 振り抜く風切り「ヒュ」
      hiss(ctx, out, when, 700 * q, 1900 * q, 1.1, 0.07 * st, 0.22 * k, 0.012 * st);
      // 刃が入る「シャッ」
      hiss(ctx, out, when, 3600 * q, 1500 * q, 0.9, 0.11 * st, 0.42 * k, 0.003 * st);
      // 手応え「ズッ」
      hiss(ctx, out, when, 420 * q, 180 * q, 1.4, 0.09 * st, 0.4 * k, 0.003 * st);
      tone(ctx, out, when, 170 * q, 70 * q, 0.07 * st, 0.28 * k, 'sine', 0.002 * st);
      // 刃の鳴り（控えめ）
      tone(ctx, out, when, 1900 * q, 1850 * q, 0.22 * st, 0.03 * k, 'sine', 0.003 * st);
      if (st > 2) hiss(ctx, out, when, 900 * q, 300 * q, 0.7, 0.5 * st, 0.06 * k, 0.05 * st); // 遅い世界の余韻
      break;
    }
    case 'swing': {
      const { st, pt } = stretch(args.speed ?? 1);
      hiss(ctx, out, when, 600 * pt, 2200 * pt, 1.6, 0.1 * st, 0.2 * k, 0.03 * st);
      break;
    }
    case 'beat':
      tone(ctx, out, when, 70, 40, 0.18, 0.6 * k, 'sine', 0.01);
      tone(ctx, out, when + 0.22, 62, 38, 0.22, 0.45 * k, 'sine', 0.01);
      break;
    case 'focus':
      tone(ctx, out, when, 1400, 70, 1.1, 0.18 * k, 'sawtooth', 0.02);
      hiss(ctx, out, when, 6000, 200, 0.8, 1.2, 0.35 * k, 0.05);
      tone(ctx, out, when, 55, 40, 2.4, 0.5 * k, 'sine', 0.4);
      break;
    case 'sheath':
      hiss(ctx, out, when, 3000, 1500, 3, 0.25, 0.25 * k, 0.15);
      tone(ctx, out, when + 0.42, 2600, 2500, 0.9, 0.18 * k, 'triangle', 0.001);
      hiss(ctx, out, when + 0.42, 5000, 3000, 4, 0.05, 0.6 * k, 0.001);
      break;
    case 'clang': {
      // 刀が薪に弾かれる「カン」。遅いほど低く長くする
      const { st, pt } = stretch(args.speed ?? 1);
      tone(ctx, out, when, 1250 * pt, 1180 * pt, 0.16 * st, 0.3 * k, 'triangle', 0.001 * st);
      tone(ctx, out, when, 2900 * pt, 2800 * pt, 0.08 * st, 0.08 * k, 'sine', 0.001 * st);
      hiss(ctx, out, when, 2400 * pt, 900 * pt, 1.2, 0.05 * st, 0.3 * k, 0.001 * st);
      break;
    }
    case 'taiko':
      tone(ctx, out, when, 110, 45, 0.7, 0.9 * k, 'sine', 0.003);
      hiss(ctx, out, when, 400, 120, 1, 0.25, 0.5 * k, 0.002);
      break;
  }
}

/** ブラウザでの再生と、撮影用の記録 */
export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: AudioNode | null = null;
  let bus: GainNode | null = null;
  let capture = false;
  let queue: { name: SfxName; args: SfxArgs; delay: number }[] = [];
  let muted = false;

  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      const g = ctx.createGain();
      g.gain.value = 0.8;
      comp.connect(g).connect(ctx.destination);
      master = comp;
      bus = ctx.createGain();
      bus.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };

  return {
    unlock: () => { try { ensure(); } catch { /* 音が使えなくても続ける */ } },
    /** delay 秒後に鳴らす */
    play(name: SfxName, args: SfxArgs = {}, delay = 0) {
      if (capture) { queue.push({ name, args, delay }); return; }
      if (muted) return;
      try {
        const c = ensure();
        renderSfx(c, name, args, c.currentTime + 0.01 + delay, bus!);
      } catch { /* 無視 */ }
    },
    /** 予約済みの音を止める（リプレイのやり直し時） */
    reset() {
      if (!ctx || !bus || !master) return;
      bus.disconnect();
      bus = ctx.createGain();
      bus.connect(master);
    },
    setMuted(m: boolean) { muted = m; },
    capture(on: boolean) { capture = on; },
    drain() { const q = queue; queue = []; return q; },
    render: renderSfx,
  };
}
export type Audio = ReturnType<typeof createAudio>;
