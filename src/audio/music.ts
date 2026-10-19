// 配乐：WebAudio 现场合成，不加载音频文件。
// 五声音阶（D 宫调：宫商角徵羽 = D E F♯ A B），琴音用快起慢衰的拨弦 + 泛音，箫用带颤音的长音，
// 底下垫一层宫、徵的持续低音；旋律按乐句随机游走，句尾落在宫或徵上，句间留白。

export type Mood = 'title' | 'world' | 'plan';

interface MoodDef {
  /** 一拍几秒 */
  beat: number;
  /** 琴、箫各自出声的概率（每个乐句抽一次） */
  qin: number;
  xiao: number;
  /** 一句几拍、句间空几拍 */
  phrase: [number, number];
  rest: [number, number];
  /** 音区（五声音阶下标，0 = D4） */
  range: [number, number];
  drone: number;
}

const MOODS: Record<Mood, MoodDef> = {
  title: { beat: 0.95, qin: 0.6, xiao: 0.85, phrase: [6, 9], rest: [3, 6], range: [-3, 6], drone: 0.05 },
  world: { beat: 0.7, qin: 1, xiao: 0.35, phrase: [8, 12], rest: [2, 5], range: [-2, 8], drone: 0.04 },
  plan: { beat: 0.8, qin: 0.9, xiao: 0.2, phrase: [5, 8], rest: [5, 9], range: [0, 7], drone: 0.03 },
};

const ROOT = 293.66; // D4
const SCALE = [0, 2, 4, 7, 9]; // 宫商角徵羽的半音数

/** 五声音阶第 i 级（可以为负、可以跨八度）的频率 */
function freqOf(i: number): number {
  const oct = Math.floor(i / 5);
  const deg = ((i % 5) + 5) % 5;
  return ROOT * 2 ** (oct + SCALE[deg] / 12);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

export class Music {
  private readonly out: GainNode;
  private readonly wet: GainNode;
  private timer = 0;
  private next = 0;
  private def: MoodDef | null = null;
  private pos = 0;
  private droneNodes: AudioScheduledSourceNode[] = [];
  private droneGains: GainNode[] = [];

  constructor(private readonly ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // 简易混响：衰减白噪声当脉冲响应
    const len = ctx.sampleRate * 3;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.45;
    this.wet.connect(verb).connect(this.out);
  }

  /** 音量（0–1），带淡入淡出 */
  level(v: number, fade = 1.5): void {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, fade / 3);
  }

  play(mood: Mood): void {
    this.stop();
    this.def = MOODS[mood];
    this.pos = randInt(0, 4);
    this.next = this.ctx.currentTime + 1.2;
    this.startDrone();
    this.timer = window.setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop(): void {
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    for (const g of this.droneGains) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.4);
    }
    for (const n of this.droneNodes) n.stop(t + 2.5);
    this.droneNodes = [];
    this.droneGains = [];
    this.def = null;
  }

  /** 往前排 2 秒内的乐句 */
  private schedule(): void {
    const def = this.def;
    if (!def) return;
    while (this.next < this.ctx.currentTime + 2) {
      this.next = this.phrase(def, this.next);
    }
  }

  /** 排一句，返回下一句开始的时间 */
  private phrase(def: MoodDef, t0: number): number {
    const useQin = Math.random() < def.qin;
    const useXiao = Math.random() < def.xiao || !useQin;
    const beats = randInt(...def.phrase);
    let t = t0;
    let b = 0;
    while (b < beats) {
      // 节奏：多为一拍，间有附点与两个半拍
      const r = Math.random();
      const durs = r < 0.55 ? [1] : r < 0.75 ? [0.5, 0.5] : r < 0.9 ? [1.5, 0.5] : [2];
      for (const d of durs) {
        const last = b + d >= beats;
        this.step(def, last);
        const f = freqOf(this.pos);
        const dur = d * def.beat;
        if (useQin) this.qin(t, f, last ? dur * 3 : dur * 2);
        if (useXiao && (d >= 1 || !useQin)) this.xiao(t, f * (useQin ? 2 : 1), dur * 0.98, useQin ? 0.35 : 0.6);
        t += dur;
        b += d;
      }
    }
    return t + randInt(...def.rest) * def.beat;
  }

  /** 旋律随机游走：多级进、少跳进，句尾收到宫（0）或徵（3）上 */
  private step(def: MoodDef, last: boolean): void {
    const [lo, hi] = def.range;
    if (last) {
      const targets = [-5, -2, 0, 3, 5, 8].filter((x) => x >= lo && x <= hi);
      this.pos = targets.reduce((a, x) => (Math.abs(x - this.pos) < Math.abs(a - this.pos) ? x : a), targets[0]);
      return;
    }
    const r = Math.random();
    const mv = r < 0.2 ? 0 : r < 0.75 ? (Math.random() < 0.5 ? -1 : 1) : r < 0.92 ? (Math.random() < 0.5 ? -2 : 2) : Math.random() < 0.5 ? -3 : 3;
    this.pos = Math.max(lo, Math.min(hi, this.pos + mv));
  }

  /** 琴：三角波 + 二倍、三倍泛音，快起慢衰，起音略高再落准（按弦的走音） */
  private qin(t: number, f: number, dur: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur * 0.6);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.wet);
    [
      [1, 'triangle', 1],
      [2, 'sine', 0.35],
      [3, 'sine', 0.12],
    ].forEach(([mul, type, vol]) => {
      const o = ctx.createOscillator();
      o.type = type as OscillatorType;
      o.frequency.setValueAtTime(f * (mul as number) * 1.012, t);
      o.frequency.exponentialRampToValueAtTime(f * (mul as number), t + 0.12);
      const og = ctx.createGain();
      og.gain.value = vol as number;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  /** 箫：正弦 + 少量气声噪，慢起慢收，延迟出现的颤音 */
  private xiao(t: number, f: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const peak = 0.06 * vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.25, dur * 0.3));
    g.gain.setValueAtTime(peak, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
    g.connect(this.out);
    g.connect(this.wet);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.006, t + dur * 0.6);
    vib.connect(vg).connect(o.frequency);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    o.connect(g);
    o2.connect(g2).connect(g);
    for (const n of [o, o2, vib]) {
      n.start(t);
      n.stop(t + dur + 0.3);
    }
  }

  /** 低音：宫、徵两个持续音，音量缓慢起伏 */
  private startDrone(): void {
    const ctx = this.ctx;
    const def = this.def!;
    const t = ctx.currentTime;
    for (const [f, ph] of [[ROOT / 4, 0], [freqOf(3) / 4, 0.5]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(def.drone, t + 4);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + ph * 0.03;
      const lg = ctx.createGain();
      lg.gain.value = def.drone * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.out);
      o.start(t);
      lfo.start(t);
      this.droneNodes.push(o, lfo);
      this.droneGains.push(g);
    }
  }
}
