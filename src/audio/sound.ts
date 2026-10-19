// 音效：全部用 WebAudio 现场合成，不加载音频文件。
// 浏览器要求用户先有一次交互才能出声，所以 AudioContext 在第一次点击 / 按键时才创建。

import { Music, type Mood } from './music';

const MUTE_KEY = 'sanfu.muted';
const MUSIC_KEY = 'sanfu.music';
const MUSIC_LEVEL = 0.9;

type Ambient = 'wind' | 'river';

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambientGain: GainNode | null = null;
  private noise!: AudioBuffer;
  private wantAmbient: Ambient[] = [];
  private lastTick = 0;
  private musicPlayer: Music | null = null;
  private wantMood: Mood | null = null;
  private ducked = 0;
  muted = localStorage.getItem(MUTE_KEY) === '1';
  musicOn = localStorage.getItem(MUSIC_KEY) !== '0';

  constructor() {
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    // 2 秒白噪声，所有噪声类声音共用
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.wantAmbient.length) this.startAmbient(this.wantAmbient);
    this.musicPlayer = new Music(ctx, this.master);
    if (this.wantMood && this.musicOn) this.startMusic();
    return ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  /** 配乐：每个页面按情绪选一种；浏览器解锁声音后才真正开始 */
  music(mood: Mood): void {
    this.wantMood = mood;
    if (this.musicPlayer && this.musicOn) this.startMusic();
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
    if (!this.musicPlayer) return;
    if (on && this.wantMood) this.startMusic();
    else {
      this.musicPlayer.level(0, 0.6);
      this.musicPlayer.stop();
    }
  }

  /** 史书展开等需要安静的时候压低配乐；可以嵌套（卷宗里再展开一卷），按次数计 */
  duck(on: boolean): void {
    this.ducked = Math.max(0, this.ducked + (on ? 1 : -1));
    this.musicPlayer?.level(this.ducked ? MUSIC_LEVEL * 0.25 : MUSIC_LEVEL, 0.8);
  }

  private startMusic(): void {
    this.musicPlayer!.play(this.wantMood!);
    this.musicPlayer!.level(this.ducked ? MUSIC_LEVEL * 0.25 : MUSIC_LEVEL, 4);
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  /** 环境声：风（低通噪声 + 慢速起伏），水边城市再叠一层流水（带通噪声）。 */
  ambient(layers: Ambient[]): void {
    this.wantAmbient = layers;
    if (this.ctx) this.startAmbient(layers);
  }

  private startAmbient(layers: Ambient[]): void {
    const ctx = this.ctx!;
    this.ambientGain?.disconnect();
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 2);
    out.connect(this.master);
    this.ambientGain = out;
    for (const layer of layers) {
      const src = this.noiseSource(true);
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      if (layer === 'wind') {
        filt.type = 'lowpass';
        filt.frequency.value = 420;
        g.gain.value = 0.05;
        lfo.frequency.value = 0.07;
        lfoGain.gain.value = 0.035;
      } else {
        filt.type = 'bandpass';
        filt.frequency.value = 900;
        filt.Q.value = 0.6;
        g.gain.value = 0.022;
        lfo.frequency.value = 0.31;
        lfoGain.gain.value = 0.01;
      }
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(filt).connect(g).connect(out);
      src.start(ctx.currentTime + Math.random());
      lfo.start();
    }
  }

  /** 悬停到新地点：极轻的木质「嗒」。 */
  tick(): void {
    const ctx = this.ensure();
    if (!ctx || performance.now() - this.lastTick < 60) return;
    this.lastTick = performance.now();
    this.tone(1600, 0.03, 0.025, 'triangle');
  }

  /** 点击 / 选中：木鱼式的短促敲击。 */
  click(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(680, 0.12, 0.16, 'sine', 420);
    this.burst(0.02, 0.08, 2400, 'bandpass');
  }

  /** 云雾合拢 / 散开：一阵风声，open = 散开（音高上扬）。 */
  whoosh(open = false): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(open ? 300 : 1400, t);
    f.frequency.exponentialRampToValueAtTime(open ? 1600 : 260, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.3);
  }

  /** 盖章：低沉的「咚」加一点纸面摩擦。 */
  stamp(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(110, 0.25, 0.5, 'sine', 70);
    this.burst(0.04, 0.12, 900, 'lowpass');
  }

  /** 一城通关：编钟式的钟声（几个不协和泛音的衰减正弦）。 */
  bell(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const base = 392;
    [1, 2.4, 2.98, 4.1, 5.4].forEach((r, i) => this.tone(base * r, 2.6 - i * 0.35, 0.18 / (i + 1), 'sine'));
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType, endFreq?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }
}

export const sound = new Sound();

/** 右下角的配乐、声音开关（所有页面共用）。「声」管全部声音，「乐」只管配乐。 */
export function mountMuteButton(): void {
  const box = document.createElement('div');
  box.className = 'mute-toggle';
  const music = document.createElement('button');
  const all = document.createElement('button');
  const render = () => {
    music.textContent = sound.musicOn ? '乐 · 开' : '乐 · 关';
    music.title = sound.musicOn ? '关闭配乐' : '打开配乐';
    all.textContent = sound.muted ? '声 · 关' : '声 · 开';
    all.title = sound.muted ? '打开声音' : '关闭声音';
  };
  render();
  music.addEventListener('click', () => {
    sound.setMusicOn(!sound.musicOn);
    render();
  });
  all.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    render();
  });
  box.append(music, all);
  document.body.appendChild(box);
}
