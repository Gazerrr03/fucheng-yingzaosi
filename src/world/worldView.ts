// 天下舆图视图：Canvas2D 画六边形大地图（2.5D 斜俯视，北在上）。
// 远景用一张预先画好的整图位图（含地形装饰、河流、海岸线、疆界）；拉近后只画画面里的格子，细节更足。
// 山峰、树木等装饰直立画出、按从北到南的顺序叠放，前面的山挡住后面的。

import { HEX_DIRS, type Hex } from '../scene/hex';
import { lensColor, type SiteVerdict } from './siteScore';
import { WORLD_TERRAIN, WorldMap, type WorldCell } from './worldMap';

const TILT = 0.8;
const SQRT3 = Math.sqrt(3);
/** 远景位图：一格对边宽度的像素 */
const CACHE_HEX_PX = 34;
/** 超过这个格宽（屏幕像素）改为逐格实时绘制 */
const LIVE_HEX_PX = 40;

export interface Marker {
  hex: Hex;
  name: string;
  grade?: string;
  /** 玩家的府城（大印）或明代旧治（小印） */
  kind: 'mine' | 'ming' | 'capital';
}

export interface WorldViewEvents {
  onHover(h: Hex | null, screen: [number, number]): void;
  onSelect(h: Hex | null): void;
  onCamera?(): void;
}

type Proj = (x: number, y: number) => [number, number];

/** 确定性的格子哈希 → [0, 1) */
function rnd(q: number, r: number, k = 0): number {
  let h = (q * 374761393 + r * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export class WorldView {
  camX = 0;
  camY = 0;
  /** 像素 / 公里 */
  zoom = 0.2;
  hover: Hex | null = null;
  selected: Hex | null = null;
  markers: Marker[] = [];
  /** 形胜透镜：每格评分（null = 关） */
  lens: Map<string, SiteVerdict> | null = null;
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private vw = innerWidth;
  private vh = innerHeight;
  private dirty = true;
  private cache: { canvas: HTMLCanvasElement; k: number; x0: number; y1: number } | null = null;
  private rows: WorldCell[][];
  private keys = new Set<string>();
  private anim: { from: [number, number, number]; to: [number, number, number]; t0: number; dur: number } | null = null;
  private minZoom = 0.05;
  private maxZoom = 6;
  private t = 0;

  constructor(private canvas: HTMLCanvasElement, readonly map: WorldMap, private events: WorldViewEvents) {
    this.ctx = canvas.getContext('2d')!;
    const byR = new Map<number, WorldCell[]>();
    for (const c of map.cells.values()) {
      if (!byR.has(c.r)) byR.set(c.r, []);
      byR.get(c.r)!.push(c);
    }
    this.rows = [...byR.keys()].sort((a, b) => b - a).map((r) => byR.get(r)!.sort((a, b) => a.q - b.q));
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.fit();
    this.bindInput();
    const tick = (now: number) => {
      this.t = now;
      this.step(now);
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  invalidate(): void {
    this.dirty = true;
  }

  get hexPx(): number {
    return this.map.data.hexKm * this.zoom;
  }

  resize(): void {
    this.vw = innerWidth;
    this.vh = innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
    const b = this.map.bounds;
    this.minZoom = Math.min(this.vw / (b.x1 - b.x0), this.vh / ((b.y1 - b.y0) * TILT)) * 0.9;
    this.maxZoom = 170 / this.map.data.hexKm;
    this.zoom = Math.max(this.minZoom, this.zoom);
    this.invalidate();
  }

  fit(): void {
    const b = this.map.bounds;
    this.camX = (b.x0 + b.x1) / 2;
    this.camY = (b.y0 + b.y1) / 2;
    this.zoom = this.minZoom;
    this.invalidate();
  }

  /** 平滑飞到某格；hexPx 为目标格宽（屏幕像素） */
  flyTo(h: Hex, hexPx?: number, dur = 650): void {
    const [x, y] = this.map.world(h);
    const z = hexPx ? Math.max(this.minZoom, Math.min(this.maxZoom, hexPx / this.map.data.hexKm)) : this.zoom;
    this.anim = { from: [this.camX, this.camY, this.zoom], to: [x, y, z], t0: performance.now(), dur };
  }

  jumpTo(h: Hex, hexPx?: number): void {
    const [x, y] = this.map.world(h);
    this.camX = x;
    this.camY = y;
    if (hexPx) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, hexPx / this.map.data.hexKm));
    this.invalidate();
    this.events.onCamera?.();
  }

  private step(now: number): void {
    if (this.anim) {
      const { from, to, t0, dur } = this.anim;
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // 缩放按对数插值，镜头不会忽快忽慢
      this.camX = from[0] + (to[0] - from[0]) * e;
      this.camY = from[1] + (to[1] - from[1]) * e;
      this.zoom = Math.exp(Math.log(from[2]) + (Math.log(to[2]) - Math.log(from[2])) * e);
      if (k >= 1) this.anim = null;
      this.invalidate();
      this.events.onCamera?.();
    }
    if (this.keys.size) {
      const v = 9 / this.zoom; // 每帧约 9 像素
      let dx = 0, dy = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= v;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += v;
      if (this.keys.has('w') || this.keys.has('arrowup')) dy += v / TILT;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= v / TILT;
      if (dx || dy) {
        this.camX += dx;
        this.camY += dy;
        this.clamp();
        this.invalidate();
        this.events.onCamera?.();
      }
    }
    // 选中格的呼吸框
    if (this.selected) this.invalidate();
  }

  private clamp(): void {
    const b = this.map.bounds;
    this.camX = Math.max(b.x0, Math.min(b.x1, this.camX));
    this.camY = Math.max(b.y0, Math.min(b.y1, this.camY));
  }

  project: Proj = (x, y) => [this.vw / 2 + (x - this.camX) * this.zoom, this.vh / 2 - (y - this.camY) * this.zoom * TILT];

  pick(sx: number, sy: number): Hex | null {
    const x = this.camX + (sx - this.vw / 2) / this.zoom;
    const y = this.camY - (sy - this.vh / 2) / (this.zoom * TILT);
    const s = this.map.size;
    const fq = ((SQRT3 / 3) * x - y / 3) / s, fr = ((2 / 3) * y) / s, fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const rs = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(rs - fs);
    if (dq > dr && dq > ds) q = -r - rs;
    else if (dr > ds) r = -q - rs;
    return this.map.cell({ q, r }) ? { q, r } : null;
  }

  /** 当前画面在世界坐标里的范围（迷你地图画取景框用） */
  viewRect(): { x0: number; x1: number; y0: number; y1: number } {
    const hw = this.vw / 2 / this.zoom, hh = this.vh / 2 / (this.zoom * TILT);
    return { x0: this.camX - hw, x1: this.camX + hw, y0: this.camY - hh, y1: this.camY + hh };
  }

  // ------------------------------------------------------------ 绘制

  private draw(): void {
    const ctx = this.ctx;
    const W = this.vw, H = this.vh;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#5c8393';
    ctx.fillRect(0, 0, W, H);
    const hexPx = this.hexPx;
    if (hexPx < LIVE_HEX_PX) {
      this.blitCache();
    } else {
      const vis = this.visibleRows();
      paintTerrain(ctx, this.map, vis, this.project, hexPx, true);
    }
    if (this.lens) this.drawLens(hexPx);
    this.drawLabels(hexPx);
    this.drawMarkers(hexPx);
    if (this.hover) this.outline(this.hover, 'rgba(47,36,26,0.85)', 2);
    if (this.selected) {
      const a = 0.65 + 0.35 * Math.sin(this.t / 260);
      this.outline(this.selected, `rgba(184,50,42,${a})`, 3.5);
    }
    // 四角压暗，像旧纸
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(60,40,20,0)');
    g.addColorStop(1, 'rgba(60,40,20,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  private visibleRows(): WorldCell[][] {
    const v = this.viewRect();
    const pad = this.map.data.hexKm * 2;
    const out: WorldCell[][] = [];
    for (const row of this.rows) {
      const y = this.map.world(row[0])[1];
      if (y < v.y0 - pad || y > v.y1 + pad * 1.5) continue;
      out.push(row.filter((c) => {
        const x = this.map.world(c)[0];
        return x > v.x0 - pad && x < v.x1 + pad;
      }));
    }
    return out;
  }

  private buildCache(): void {
    const b = this.map.bounds;
    const k = CACHE_HEX_PX / this.map.data.hexKm;
    const pad = this.map.data.hexKm;
    const x0 = b.x0 - pad, y1 = b.y1 + pad * 1.5;
    const w = Math.ceil((b.x1 - b.x0 + 2 * pad) * k), h = Math.ceil((b.y1 - b.y0 + 3 * pad) * k * TILT);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#5c8393';
    ctx.fillRect(0, 0, w, h);
    const proj: Proj = (x, y) => [(x - x0) * k, (y1 - y) * k * TILT];
    paintTerrain(ctx, this.map, this.rows, proj, CACHE_HEX_PX, false);
    this.cache = { canvas, k, x0, y1 };
  }

  /** 迷你地图用的整图位图 */
  overviewCanvas(): HTMLCanvasElement {
    if (!this.cache) this.buildCache();
    return this.cache!.canvas;
  }

  cacheToWorld(px: number, py: number): [number, number] {
    const c = this.cache!;
    return [c.x0 + px / c.k, c.y1 - py / (c.k * TILT)];
  }

  worldToCache(x: number, y: number): [number, number] {
    const c = this.cache!;
    return [(x - c.x0) * c.k, (c.y1 - y) * c.k * TILT];
  }

  private blitCache(): void {
    if (!this.cache) this.buildCache();
    const { canvas, k, x0, y1 } = this.cache!;
    const s = this.zoom / k;
    const [dx, dy] = this.project(x0, y1);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(canvas, dx, dy, canvas.width * s, canvas.height * s);
  }

  private hexPath(h: Hex, scale = 1): void {
    const [x, y] = this.map.world(h);
    const s = this.map.size * scale;
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const [px, py] = this.project(x + s * Math.cos(a), y + s * Math.sin(a));
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  private outline(h: Hex, color: string, width: number): void {
    this.hexPath(h);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.stroke();
  }

  private drawLens(hexPx: number): void {
    const ctx = this.ctx;
    const v = this.viewRect();
    const pad = this.map.data.hexKm;
    const showNum = hexPx > 30;
    ctx.font = `bold ${Math.min(16, hexPx * 0.3)}px ${fontFamily()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [key, s] of this.lens!) {
      const c = this.map.cells.get(key)!;
      const [x, y] = this.map.world(c);
      if (x < v.x0 - pad || x > v.x1 + pad || y < v.y0 - pad || y > v.y1 + pad) continue;
      this.hexPath(c, 0.96);
      if (!s.ok) {
        ctx.fillStyle = 'rgba(40,30,20,0.32)';
        ctx.fill();
        continue;
      }
      ctx.fillStyle = lensColor(s.total, 0.5);
      ctx.fill();
      if (showNum) {
        const [sx, sy] = this.project(x, y);
        ctx.fillStyle = 'rgba(255,250,235,0.95)';
        ctx.strokeStyle = 'rgba(40,30,20,0.7)';
        ctx.lineWidth = 3;
        ctx.strokeText(String(s.total), sx, sy);
        ctx.fillText(String(s.total), sx, sy);
      }
    }
  }

  private drawLabels(hexPx: number): void {
    const ctx = this.ctx;
    const ff = fontFamily();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 省名：远景显示，大字疏排
    if (hexPx < 36) {
      const fs = Math.max(13, Math.min(30, hexPx * 1.1));
      ctx.font = `${fs}px ${ff}`;
      for (const p of this.map.data.provinces) {
        const [sx, sy] = this.project(...this.map.world({ q: p.hex[0], r: p.hex[1] }));
        const text = p.name.split('').join(' ');
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(236,226,202,0.7)';
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = 'rgba(120,40,30,0.75)';
        ctx.fillText(text, sx, sy);
      }
    }
    // 名城小河、城边小湖：近景
    if (hexPx >= 70) {
      ctx.font = `${Math.min(13, 8 + hexPx * 0.04)}px ${ff}`;
      const water = [
        ...this.map.data.rivers.filter((rv) => rv.rank === 4).map((rv) => ({ name: rv.name, xy: rv.line[Math.floor((rv.line.length - 1) / 2)] })),
        ...this.map.data.pools.map((p) => ({ name: p.name, xy: [p.xy[0], p.xy[1] - p.r[1] - 1] as [number, number] })),
      ];
      for (const w of water) {
        const [sx, sy] = this.project(w.xy[0], w.xy[1]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(220,235,235,0.75)';
        ctx.strokeText(w.name, sx, sy + 8);
        ctx.fillStyle = 'rgba(30,70,90,0.9)';
        ctx.fillText(w.name, sx, sy + 8);
      }
    }
    // 山名、湖名：中景
    if (hexPx >= 16 && hexPx < 90) {
      ctx.font = `${Math.min(15, 9 + hexPx * 0.12)}px ${ff}`;
      for (const l of [...this.map.data.ranges, ...this.map.data.lakes]) {
        const [sx, sy] = this.project(...this.map.world({ q: l.hex[0], r: l.hex[1] }));
        const isLake = this.map.data.lakes.includes(l as never);
        ctx.lineWidth = 3;
        ctx.strokeStyle = isLake ? 'rgba(220,235,235,0.75)' : 'rgba(236,226,202,0.75)';
        ctx.strokeText(l.name, sx, sy + hexPx * 0.15);
        ctx.fillStyle = isLake ? 'rgba(30,70,90,0.9)' : 'rgba(60,50,30,0.85)';
        ctx.fillText(l.name, sx, sy + hexPx * 0.15);
      }
    }
  }

  private drawMarkers(hexPx: number): void {
    const ctx = this.ctx;
    const ff = fontFamily();
    const mine = this.markers.filter((m) => m.kind === 'mine');
    const mineKeys = new Set(mine.map((m) => `${m.hex.q},${m.hex.r}`));
    // 明代旧治：小朱点 + 名字
    if (hexPx >= 9) {
      for (const m of this.markers) {
        if (m.kind === 'mine' || mineKeys.has(`${m.hex.q},${m.hex.r}`)) continue;
        const [sx, sy] = this.project(...this.map.world(m.hex));
        const cap = m.kind === 'capital';
        const s = Math.max(4, Math.min(cap ? 12 : 9, hexPx * (cap ? 0.22 : 0.15)));
        ctx.fillStyle = cap ? '#b8322a' : 'rgba(150,40,32,0.92)';
        ctx.strokeStyle = '#f3ead6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(sx - s / 2, sy - s / 2, s, s);
        ctx.fill();
        ctx.stroke();
        if (hexPx >= 20 || cap) {
          const fs = Math.max(11, Math.min(cap ? 18 : 15, hexPx * 0.24));
          ctx.font = `${cap ? 'bold ' : ''}${fs}px ${ff}`;
          ctx.textAlign = 'left';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(236,226,202,0.85)';
          ctx.strokeText(m.name, sx + s * 0.8, sy);
          ctx.fillStyle = 'rgba(47,36,26,0.95)';
          ctx.fillText(m.name, sx + s * 0.8, sy);
          ctx.textAlign = 'center';
        }
      }
    }
    // 玩家的府城：大印 + 名号 + 评级
    for (const m of mine) {
      const [sx, sy] = this.project(...this.map.world(m.hex));
      const s = Math.max(18, Math.min(42, hexPx * 0.62));
      ctx.save();
      ctx.translate(sx, sy - s * 0.35);
      ctx.fillStyle = '#b8322a';
      ctx.shadowColor = 'rgba(40,20,10,0.45)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#f3ead6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-s / 2 + 3, -s / 2 + 3, s - 6, s - 6);
      ctx.fillStyle = '#f3ead6';
      ctx.font = `bold ${s * 0.5}px ${ff}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.name.slice(0, 1), 0, 1);
      ctx.restore();
      const fs = Math.max(12, Math.min(17, hexPx * 0.26));
      ctx.font = `bold ${fs}px ${ff}`;
      const label = m.grade ? `${m.name} · ${m.grade}` : m.name;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(236,226,202,0.94)';
      ctx.fillRect(sx - w / 2, sy + s * 0.25, w, fs + 8);
      ctx.fillStyle = '#b8322a';
      ctx.fillRect(sx - w / 2, sy + s * 0.25, 3, fs + 8);
      ctx.fillStyle = '#2f241a';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx + 1, sy + s * 0.25 + (fs + 8) / 2);
    }
  }

  // ------------------------------------------------------------ 输入

  private bindInput(): void {
    const cv = this.canvas;
    let down: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      this.anim = null;
      down = { x: e.clientX, y: e.clientY, cx: this.camX, cy: this.camY, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 5) down.moved = true;
        if (down.moved) {
          this.camX = down.cx - dx / this.zoom;
          this.camY = down.cy + dy / (this.zoom * TILT);
          this.clamp();
          cv.classList.add('dragging');
          this.invalidate();
          this.events.onCamera?.();
          return;
        }
      }
      const h = this.pick(e.clientX, e.clientY);
      if (h?.q !== this.hover?.q || h?.r !== this.hover?.r) {
        this.hover = h;
        this.invalidate();
      }
      this.events.onHover(h, [e.clientX, e.clientY]);
    });
    cv.addEventListener('pointerup', (e) => {
      cv.classList.remove('dragging');
      if (down && !down.moved && e.button === 0) {
        const h = this.pick(e.clientX, e.clientY);
        this.selected = h;
        this.invalidate();
        this.events.onSelect(h);
      }
      down = null;
    });
    cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.invalidate();
      this.events.onHover(null, [0, 0]);
    });
    cv.addEventListener('dblclick', (e) => {
      const h = this.pick(e.clientX, e.clientY);
      if (h) this.flyTo(h, Math.max(this.hexPx * 1.8, 70));
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.anim = null;
      const k = Math.exp(-e.deltaY * 0.0015);
      const nz = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * k));
      const wx = this.camX + (e.clientX - this.vw / 2) / this.zoom;
      const wy = this.camY - (e.clientY - this.vh / 2) / (this.zoom * TILT);
      this.zoom = nz;
      this.camX = wx - (e.clientX - this.vw / 2) / nz;
      this.camY = wy + (e.clientY - this.vh / 2) / (nz * TILT);
      this.clamp();
      this.invalidate();
      this.events.onCamera?.();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        this.anim = null;
        e.preventDefault();
      }
      if (k === '=' || k === '+') this.zoomBy(1.4);
      if (k === '-') this.zoomBy(1 / 1.4);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  zoomBy(k: number): void {
    this.anim = { from: [this.camX, this.camY, this.zoom], to: [this.camX, this.camY, Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * k))], t0: performance.now(), dur: 260 };
  }
}

let font: string | null = null;
function fontFamily(): string {
  return (font ??= getComputedStyle(document.body).fontFamily);
}

// ------------------------------------------------------------------ 地形绘制（远景位图与近景共用）

function paintTerrain(ctx: CanvasRenderingContext2D, map: WorldMap, rows: WorldCell[][], proj: Proj, hexPx: number, live: boolean): void {
  const s = map.size;
  const corner = (c: Hex, i: number, k = 1): [number, number] => {
    const [x, y] = map.world(c);
    const a = (Math.PI / 180) * (60 * i - 30);
    return proj(x + s * k * Math.cos(a), y + s * k * Math.sin(a));
  };
  const center = (c: Hex) => proj(...map.world(c));

  // 1. 底色
  for (const row of rows) {
    for (const c of row) {
      const def = WORLD_TERRAIN[c.t];
      const j = 0.95 + rnd(c.q, c.r) * 0.08;
      let color = def.color;
      if (c.t === 'F' && c.elev > 600) color = '#cfbb86';
      ctx.fillStyle = shade(color, j * (def.water ? 1 : 1 - Math.min(0.12, c.elev / 30000)));
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const [px, py] = corner(c, i, 1.02);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      if (live && hexPx > 60 && !def.water) {
        ctx.strokeStyle = 'rgba(70,50,30,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // 2. 海岸线、湖岸、疆界（沿格边）
  const edge = (c: Hex, d: number): [[number, number], [number, number]] => {
    // HEX_DIRS[d] 方向的那条边：角点 (d 对应) —— 方向 0 东，对应角 0（-30°）与 1（30°）
    const idx = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]][d];
    return [corner(c, idx[0]), corner(c, idx[1])];
  };
  ctx.lineCap = 'round';
  for (const row of rows) {
    for (const c of row) {
      const water = WORLD_TERRAIN[c.t].water;
      HEX_DIRS.forEach((dv, d) => {
        const n = map.cell({ q: c.q + dv.q, r: c.r + dv.r });
        if (!n) return;
        const nWater = WORLD_TERRAIN[n.t].water;
        if (!water && nWater) {
          const [a, b] = edge(c, d);
          // 浅色浪花 + 墨线
          ctx.strokeStyle = n.t === 'W' ? 'rgba(235,245,240,0.6)' : 'rgba(240,248,245,0.55)';
          ctx.lineWidth = Math.max(2, hexPx * 0.12);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(60,55,45,0.7)';
          ctx.lineWidth = Math.max(1, hexPx * 0.035);
          ctx.stroke();
        }
        if (!water && !nWater && c.domain && !n.domain) {
          const [a, b] = edge(c, d);
          ctx.strokeStyle = 'rgba(184,50,42,0.75)';
          ctx.lineWidth = Math.max(1.5, hexPx * 0.07);
          ctx.setLineDash([hexPx * 0.18, hexPx * 0.12]);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }
  }

  // 3. 塞外：压暗
  for (const row of rows) {
    for (const c of row) {
      if (c.domain || WORLD_TERRAIN[c.t].water) continue;
      ctx.fillStyle = 'rgba(70,55,40,0.16)';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const [px, py] = corner(c, i, 1.02);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.fill();
    }
  }

  // 4. 水面纹
  if (hexPx > 18) {
    ctx.lineWidth = Math.max(1, hexPx * 0.03);
    for (const row of rows) {
      for (const c of row) {
        if (c.t !== 'O' && c.t !== 'W') continue;
        if (rnd(c.q, c.r, 5) > 0.45) continue;
        const [cx, cy] = center(c);
        const w = hexPx * 0.22;
        ctx.strokeStyle = 'rgba(235,245,245,0.35)';
        ctx.beginPath();
        ctx.arc(cx - w * 0.5, cy, w * 0.5, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(cx + w * 0.5, cy, w * 0.5, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    }
  }

  // 5. 河流：过格心的平滑曲线；名城小河（rank 4）只在近景画，沿真实河道走，城边小湖同时画出
  const fine = live && hexPx >= LIVE_HEX_PX;
  if (fine) {
    for (const p of map.data.pools) {
      const [cx, cy] = proj(p.xy[0], p.xy[1]);
      const [ex] = proj(p.xy[0] + p.r[0], p.xy[1]);
      const [, ey] = proj(p.xy[0], p.xy[1] + p.r[1]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(2, Math.abs(ex - cx)), Math.max(1.5, Math.abs(ey - cy)), 0, 0, Math.PI * 2);
      ctx.fillStyle = WORLD_TERRAIN.W.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,55,45,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  const rivers = [...map.data.rivers].filter((rv) => rv.rank !== 4 || fine).sort((a, b) => rankOrder(b.rank) - rankOrder(a.rank));
  for (const rv of rivers) {
    const real = rv.rank === 4 || rv.path.length < 2;
    if (real && !fine) continue;
    const pts = real ? rv.line.map(([x, y]) => proj(x, y)) : rv.path.map(([q, r]) => center({ q, r }));
    const w = rv.rank === 1 ? 0.2 : rv.rank === 2 ? 0.13 : rv.rank === 'canal' ? 0.07 : rv.rank === 4 ? 0.045 : 0.09;
    const width = Math.max(rv.rank === 1 ? 2.4 : 1.2, hexPx * w);
    ctx.lineJoin = 'round';
    if (rv.rank === 'canal') {
      ctx.strokeStyle = 'rgba(90,70,50,0.8)';
      ctx.lineWidth = width + 2;
      smooth(ctx, pts);
      ctx.stroke();
      ctx.strokeStyle = '#8fb0b4';
      ctx.lineWidth = width;
      ctx.stroke();
      continue;
    }
    ctx.strokeStyle = 'rgba(55,80,90,0.55)';
    ctx.lineWidth = width + Math.max(1.2, hexPx * 0.03);
    smooth(ctx, pts);
    ctx.stroke();
    ctx.strokeStyle = '#6f9cad';
    ctx.lineWidth = width;
    ctx.stroke();
    if (width > 4) {
      ctx.strokeStyle = 'rgba(220,238,240,0.35)';
      ctx.lineWidth = width * 0.3;
      ctx.stroke();
    }
  }

  // 6. 地形装饰：从北到南，直立
  for (const row of rows) {
    for (const c of row) decorate(ctx, c, center(c), hexPx);
  }
}

function rankOrder(r: number | 'canal'): number {
  return r === 'canal' ? 5 : r;
}

/** Catmull-Rom → 贝塞尔 */
function smooth(ctx: CanvasRenderingContext2D, p: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    );
  }
}

function decorate(ctx: CanvasRenderingContext2D, c: WorldCell, [cx, cy]: [number, number], hexPx: number): void {
  const u = hexPx;
  const R = (k: number) => rnd(c.q, c.r, k);
  switch (c.t) {
    case 'S':
    case 'X': {
      const n = u > 26 ? 2 + (R(1) > 0.5 ? 1 : 0) : 1;
      const peaks: [number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const ox = (n === 1 ? 0 : (i / (n - 1) - 0.5) * 0.6) * u + (R(10 + i) - 0.5) * u * 0.12;
        const h = u * (0.5 + R(20 + i) * 0.35) * (c.t === 'X' ? 1.15 : 1) * (i === Math.floor(n / 2) ? 1.15 : 0.85);
        peaks.push([cx + ox, cy + u * 0.22 - (i % 2) * u * 0.06, h]);
      }
      peaks.sort((a, b) => a[1] - b[1]);
      for (const [px, py, h] of peaks) mountain(ctx, px, py, h, u * 0.36, c.t === 'X', c.feature === 'f');
      break;
    }
    case 'H': {
      const n = u > 24 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const ox = (n === 1 ? 0 : i ? 0.18 : -0.16) * u;
        hill(ctx, cx + ox, cy + u * (0.15 + i * 0.08), u * (0.3 + R(30 + i) * 0.1), u * (0.17 + R(40 + i) * 0.06));
      }
      if (c.feature === 'f') trees(ctx, c, cx, cy + u * 0.05, u, 3);
      break;
    }
    case 'F':
      if (c.feature === 'f') trees(ctx, c, cx, cy, u, 5);
      else if (c.feature === 'm') marsh(ctx, cx, cy, u);
      else if (u > 22) fields(ctx, c, cx, cy, u);
      break;
    case 'P':
    case 'C':
      if (u > 14) tufts(ctx, c, cx, cy, u, c.t === 'C' ? 'rgba(80,110,50,0.55)' : 'rgba(110,100,70,0.5)');
      break;
    case 'D':
      if (u > 14) dunes(ctx, cx, cy, u);
      break;
  }
}

function mountain(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, snow: boolean, forest: boolean): void {
  const top: [number, number] = [x + w * 0.08, y - h];
  // 背光面（东）
  ctx.fillStyle = snow ? '#9a9c9a' : forest ? '#5f6b48' : '#77715a';
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w * 0.05, y);
  ctx.closePath();
  ctx.fill();
  // 受光面（西，夕照）
  ctx.fillStyle = snow ? '#d4d2ca' : forest ? '#8a9364' : '#a89d78';
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(x + w * 0.05, y);
  ctx.lineTo(x - w, y);
  ctx.closePath();
  ctx.fill();
  if (snow) {
    ctx.fillStyle = '#f6f4ee';
    ctx.beginPath();
    ctx.moveTo(top[0], top[1]);
    ctx.lineTo(top[0] + w * 0.32, top[1] + h * 0.34);
    ctx.lineTo(top[0] + w * 0.08, top[1] + h * 0.28);
    ctx.lineTo(top[0] - w * 0.12, top[1] + h * 0.38);
    ctx.lineTo(top[0] - w * 0.38, top[1] + h * 0.36);
    ctx.closePath();
    ctx.fill();
  }
  // 皴笔：两道斜线
  ctx.strokeStyle = 'rgba(50,40,28,0.35)';
  ctx.lineWidth = Math.max(0.6, w * 0.04);
  ctx.beginPath();
  ctx.moveTo(top[0] - w * 0.1, top[1] + h * 0.3);
  ctx.lineTo(x - w * 0.35, y - h * 0.08);
  ctx.moveTo(top[0] + w * 0.15, top[1] + h * 0.4);
  ctx.lineTo(x + w * 0.4, y - h * 0.1);
  ctx.stroke();
  // 墨线轮廓
  ctx.strokeStyle = 'rgba(40,32,22,0.75)';
  ctx.lineWidth = Math.max(0.8, w * 0.06);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.lineTo(top[0], top[1]);
  ctx.lineTo(x + w, y);
  ctx.stroke();
}

function hill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(150,135,85,0.85)';
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 0.2, y - h * 2, x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(120,105,65,0.7)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.05, y - h * 0.95);
  ctx.quadraticCurveTo(x + w * 0.6, y - h * 0.7, x + w, y);
  ctx.lineTo(x + w * 0.1, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,48,30,0.6)';
  ctx.lineWidth = Math.max(0.7, w * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 0.2, y - h * 2, x + w, y);
  ctx.stroke();
}

function trees(ctx: CanvasRenderingContext2D, c: Hex, x: number, y: number, u: number, n: number): void {
  const count = u > 30 ? n : Math.max(2, Math.round(n / 2));
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    pts.push([x + (rnd(c.q, c.r, 50 + i) - 0.5) * u * 0.62, y + (rnd(c.q, c.r, 70 + i) - 0.5) * u * 0.42]);
  }
  pts.sort((a, b) => a[1] - b[1]);
  for (const [px, py] of pts) {
    const r = u * 0.085;
    ctx.strokeStyle = 'rgba(60,45,30,0.7)';
    ctx.lineWidth = Math.max(0.6, r * 0.25);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - r * 1.2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(62,92,58,0.88)';
    ctx.beginPath();
    ctx.ellipse(px, py - r * 1.6, r, r * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,150,90,0.55)';
    ctx.beginPath();
    ctx.ellipse(px - r * 0.3, py - r * 1.9, r * 0.45, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fields(ctx: CanvasRenderingContext2D, c: Hex, x: number, y: number, u: number): void {
  // 田垄：两三块斜置的田，偶有村落
  const ang = rnd(c.q, c.r, 3) * 0.6 - 0.3;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.strokeStyle = 'rgba(140,120,70,0.38)';
  ctx.lineWidth = Math.max(0.6, u * 0.02);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-u * 0.3, i * u * 0.07);
    ctx.lineTo(u * 0.3, i * u * 0.07);
    ctx.stroke();
  }
  ctx.restore();
  if (rnd(c.q, c.r, 9) > 0.88 && u > 30) {
    // 小村：两间屋
    for (const [ox, oy] of [[-0.08, 0.02], [0.1, 0.08]]) {
      const px = x + ox * u, py = y + oy * u, w = u * 0.07;
      ctx.fillStyle = '#efe5cf';
      ctx.fillRect(px - w, py - w * 0.9, w * 2, w * 0.9);
      ctx.fillStyle = '#5a5850';
      ctx.beginPath();
      ctx.moveTo(px - w * 1.25, py - w * 0.85);
      ctx.lineTo(px, py - w * 1.6);
      ctx.lineTo(px + w * 1.25, py - w * 0.85);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function marsh(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  ctx.fillStyle = 'rgba(130,170,170,0.45)';
  ctx.beginPath();
  ctx.ellipse(x, y + u * 0.05, u * 0.25, u * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,100,60,0.7)';
  ctx.lineWidth = Math.max(0.6, u * 0.02);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * u * 0.08, y + u * 0.02);
    ctx.lineTo(x + i * u * 0.08 + u * 0.02, y - u * 0.12);
    ctx.stroke();
  }
}

function tufts(ctx: CanvasRenderingContext2D, c: Hex, x: number, y: number, u: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, u * 0.022);
  for (let i = 0; i < 3; i++) {
    const px = x + (rnd(c.q, c.r, 80 + i) - 0.5) * u * 0.6, py = y + (rnd(c.q, c.r, 90 + i) - 0.5) * u * 0.4;
    ctx.beginPath();
    ctx.moveTo(px - u * 0.04, py - u * 0.06);
    ctx.lineTo(px, py);
    ctx.lineTo(px + u * 0.04, py - u * 0.06);
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - u * 0.08);
    ctx.stroke();
  }
}

function dunes(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  ctx.strokeStyle = 'rgba(160,120,70,0.5)';
  ctx.lineWidth = Math.max(0.7, u * 0.025);
  for (const [ox, oy] of [[-0.12, -0.05], [0.12, 0.1]]) {
    ctx.beginPath();
    ctx.arc(x + ox * u, y + oy * u + u * 0.1, u * 0.16, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
}

export { CACHE_HEX_PX, LIVE_HEX_PX, TILT };
