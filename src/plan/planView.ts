// 营建视图：Canvas2D 画的 2.5D 六边形地图。斜俯视，北在上；有高程的格子画成柱体。
// 构件贴 glb 模型离屏渲染出的精灵（见 sprites.ts）；精灵还没生成或没有对应模型时画程序小屋。
// 只在有变化时重画；按行从北到南画，保证前面的山能挡住后面的东西。

import { HEX_DIRS, hexKey, hexToWorld, worldToHex, type Hex } from '../scene/hex';
import type { Vec2 } from '../scene/homography';
import { BUILDINGS, DIR_GUA, DIR_NAME, type BuildingDef, type Dir } from './buildings';
import { PLAN_TERRAIN, type Cell, type PlanMap } from './planMap';
import { BUILDING_MODELS, SPRITE_PX_PER_HEX, WALL_HALF, WALL_MODEL, drawSprite, planSprites, type Sprite, type SpriteSpec } from './sprites';

const TILT = 0.62; //   y 方向压扁
const ZK = 0.85; //     高度在屏幕上的比例

export interface PlanViewEvents {
  onHover(hex: Hex | null, screen: Vec2): void;
  onClick(hex: Hex, button: number): void;
}

export interface Ghost {
  def: BuildingDef | null; // null = 拆除
  hex: Hex;
  ok: boolean;
}

export class PlanView {
  ghost: Ghost | null = null;
  showCompass = true;
  /** 关卡提示的目标格 */
  highlight = new Set<string>();
  private ctx: CanvasRenderingContext2D;
  private camX = 0;
  private camY = 0;
  private zoom = 0.2; // 像素 / 米
  private vex: number; // 高程夸张
  private baseElev: number;
  private dirty = true;
  private hover: Hex | null = null;
  /** 用户还没动过镜头时，窗口尺寸变化会重新铺满 */
  private touched = false;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private rows: Cell[][] = [];
  /** 当前投影用的视口尺寸（CSS 像素）；预渲染地形时临时改成离屏画布的尺寸 */
  private vw = innerWidth;
  private vh = innerHeight;
  /** 大地图缩小时用的地形位图 */
  private cache: { canvas: HTMLCanvasElement; z0: number; cx: number; cy: number; w: number; h: number } | null = null;
  private static readonly CACHE_HEX_PX = 9;
  private sprites = planSprites();
  /** 最近一次重画耗时（毫秒，调试用） */
  lastDrawMs = 0;

  constructor(private canvas: HTMLCanvasElement, private map: PlanMap, private events: PlanViewEvents) {
    this.ctx = canvas.getContext('2d')!;
    let lo = Infinity, hi = -Infinity;
    for (const c of map.cells.values()) {
      lo = Math.min(lo, c.elev);
      hi = Math.max(hi, c.elev);
    }
    this.baseElev = Math.max(0, lo);
    this.vex = Math.max(0.6, Math.min(2.4, (map.data.hexAcross * 1.4) / Math.max(1, hi - this.baseElev)));
    // 按 r 从大到小（北到南）分行
    const byR = new Map<number, Cell[]>();
    for (const c of map.cells.values()) {
      if (!byR.has(c.r)) byR.set(c.r, []);
      byR.get(c.r)!.push(c);
    }
    this.rows = [...byR.keys()].sort((a, b) => b - a).map((r) => byR.get(r)!.sort((a, b) => a.q - b.q));
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.fit();
    this.sprites.listeners.add(() => this.invalidate());
    // 预热不需要定向的构件精灵
    this.sprites.warm(BUILDINGS.flatMap((b) => {
      const m = BUILDING_MODELS[b.id];
      return m && !m.orient ? m.models.map((model) => this.spec(b, model)) : [];
    }));
    const tick = () => {
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

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.vw = w;
    this.vh = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.touched && w > 0 && h > 0) this.fit();
    this.invalidate();
  }

  /** 让整张图（或可建范围）放进画面 */
  fit(): void {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of this.map.cells.values()) {
      if (this.map.data.ring && !c.buildable) continue;
      const [x, y] = hexToWorld(c, this.map.hexSize);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    // 左右各留出面板的宽度
    const availW = Math.max(200, innerWidth - 2 * 250), availH = Math.max(200, innerHeight - 120);
    this.camX = (x0 + x1) / 2;
    this.camY = (y0 + y1) / 2;
    const z = Math.min(availW / (x1 - x0 + 1), availH / ((y1 - y0 + 1) * TILT)) * 0.95;
    if (z > 0 && isFinite(z)) this.zoom = z;
    this.invalidate();
  }

  focus(world: Vec2, zoomHexes?: number): void {
    this.camX = world[0];
    this.camY = world[1];
    if (zoomHexes && innerHeight > 0) this.zoom = innerHeight / (zoomHexes * this.map.data.hexAcross * TILT);
    this.touched = true;
    this.invalidate();
  }

  /** 世界坐标 + 高程 → 屏幕（CSS 像素） */
  project(x: number, y: number, z: number): Vec2 {
    return [
      this.vw / 2 + (x - this.camX) * this.zoom,
      this.vh / 2 - (y - this.camY) * this.zoom * TILT - (z - this.baseElev) * this.vex * this.zoom * ZK,
    ];
  }

  private z(c: Cell): number {
    return PLAN_TERRAIN[c.terrain]?.water ? this.baseElev : Math.max(this.baseElev, c.elev);
  }

  private corners(c: Hex, z: number, scale = 1): Vec2[] {
    const [x, y] = hexToWorld(c, this.map.hexSize);
    const s = this.map.hexSize * scale;
    const out: Vec2[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      out.push(this.project(x + s * Math.cos(a), y + s * Math.sin(a), z));
    }
    return out; // 0 东南偏东，1 东北…（逆时针，从右下开始：-30°）
  }

  // ---------- 绘制 ----------

  private draw(): void {
    const t0 = performance.now();
    const ctx = this.ctx;
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#e9d3a8');
    sky.addColorStop(1, '#d8bf93');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const map = this.map;
    const inside = map.inside();
    const hexPx = map.data.hexAcross * this.zoom;
    const detail = hexPx > 14;
    const pad = map.data.hexAcross * 2;
    const xMin = this.camX - W / 2 / this.zoom - pad, xMax = this.camX + W / 2 / this.zoom + pad;
    const yMin = this.camY - (H / 2) / (this.zoom * TILT) - pad;
    const yMax = this.camY + (H / 2) / (this.zoom * TILT) + pad + (600 * this.vex * ZK) / TILT;

    const useCache = map.cells.size > 3000 && hexPx < PlanView.CACHE_HEX_PX;
    if (useCache) this.blitCache();
    // 构件比旧的小屋占地大，会伸进南邻格的顶面：所以某行的构件等南边一行的地面画完再画；
    // 南邻格若比构件所在格高（山坡），再把它补画一遍，让山挡住后面的构件。
    const drawBuildings = (row: Cell[]) => {
      for (const c of row) {
        const x = hexToWorld(c, map.hexSize)[0];
        if (x < xMin || x > xMax) continue;
        const b = map.at(c);
        const isGhost = this.ghost && this.ghost.hex.q === c.q && this.ghost.hex.r === c.r;
        if (b && !b.waterish) this.drawBuilding(c, b, 1, detail);
        if (isGhost) this.drawGhost(c);
        if (useCache || !((b && !b.waterish) || isGhost)) continue;
        const z = this.z(c);
        for (const d of [HEX_DIRS[1], HEX_DIRS[2]]) {
          const n = map.cell({ q: c.q + d.q, r: c.r + d.r });
          // 南邻格自己的构件随它那一行稍后再画
          if (n && this.z(n) > z + 1) this.drawCell(n, inside.has(hexKey(n)), detail);
        }
      }
    };
    let prev: Cell[] | null = null;
    for (const row of this.rows) {
      const y = hexToWorld(row[0], map.hexSize)[1];
      if (y < yMin || y > yMax) continue;
      if (!useCache) {
        for (const c of row) {
          const x = hexToWorld(c, map.hexSize)[0];
          if (x < xMin || x > xMax) continue;
          this.drawCell(c, inside.has(hexKey(c)), detail);
        }
      }
      if (prev) drawBuildings(prev);
      prev = row;
    }
    if (prev) drawBuildings(prev);

    this.drawSunset();
    if (this.map.data.ring) this.drawRing();
    if (this.showCompass) this.drawCompass();
    this.drawLabels(detail);
    if (this.hover && !this.ghost) this.outline(this.hover, 'rgba(47,36,26,0.8)', 2);
    this.lastDrawMs = performance.now() - t0;
  }

  /** 把整张地形按固定比例画到离屏画布上（只画一次） */
  private buildCache(): void {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zMax = this.baseElev;
    for (const c of this.map.cells.values()) {
      const [x, y] = hexToWorld(c, this.map.hexSize);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      zMax = Math.max(zMax, this.z(c));
    }
    const z0 = PlanView.CACHE_HEX_PX / this.map.data.hexAcross;
    const pad = this.map.hexSize * 2;
    const w = Math.ceil((x1 - x0 + 2 * pad) * z0);
    const h = Math.ceil(((y1 - y0 + 2 * pad) * TILT + (zMax - this.baseElev) * this.vex * ZK) * z0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * this.dpr);
    canvas.height = Math.ceil(h * this.dpr);
    const saved = { ctx: this.ctx, camX: this.camX, camY: this.camY, zoom: this.zoom, vw: this.vw, vh: this.vh };
    const cx = (x0 + x1) / 2;
    // 让最高的山顶也落在画布里：中心往下挪半个高差
    const cy = (y0 + y1) / 2 + ((zMax - this.baseElev) * this.vex * ZK) / TILT / 2;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    Object.assign(this, { camX: cx, camY: cy, zoom: z0, vw: w, vh: h });
    const inside = this.map.inside();
    for (const row of this.rows) for (const c of row) this.drawCell(c, inside.has(hexKey(c)), false);
    Object.assign(this, saved);
    this.cache = { canvas, z0, cx, cy, w, h };
  }

  private blitCache(): void {
    if (!this.cache) this.buildCache();
    const { canvas, z0, cx, cy, w, h } = this.cache!;
    const k = this.zoom / z0;
    const dx = this.vw / 2 + (cx - this.camX) * this.zoom - (w / 2) * k;
    const dy = this.vh / 2 - (cy - this.camY) * this.zoom * TILT - (h / 2) * k;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(canvas, dx, dy, w * k, h * k);
  }

  private shade(hex: string, k: number): string {
    const n = parseInt(hex.slice(1), 16);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  private drawCell(c: Cell, inside: boolean, detail: boolean): void {
    const ctx = this.ctx;
    const map = this.map;
    const def = PLAN_TERRAIN[c.terrain] ?? PLAN_TERRAIN.B;
    const z = this.z(c);
    const top = this.corners(c, z);
    const jitter = 0.96 + (((c.q * 73856093) ^ (c.r * 19349663)) & 15) / 200;
    const lift = 1 + Math.min(0.12, (z - this.baseElev) / 3000);
    const moat = map.at(c)?.waterish;
    const color = moat ? PLAN_TERRAIN.M.color : inside && c.terrain === 'T' ? PLAN_TERRAIN.B.color : def.color;

    // 侧面：南侧三条边下拉到地面
    if (z > this.baseElev + 0.5) {
      const bot = this.corners(c, this.baseElev);
      ctx.fillStyle = this.shade(color, 0.62);
      ctx.beginPath();
      // 角点按 -30°、30°、90°、150°、210°、270° 排列；从南面看得到的是 0-5、5-4 两条边
      const idx = [0, 5, 4];
      ctx.moveTo(top[idx[0]][0], top[idx[0]][1]);
      for (const i of idx.slice(1)) ctx.lineTo(top[i][0], top[i][1]);
      for (const i of [...idx].reverse()) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      ctx.fill();
      // 西侧（夕照）一面亮一点
      ctx.fillStyle = this.shade(color, 0.78);
      ctx.beginPath();
      ctx.moveTo(top[5][0], top[5][1]);
      ctx.lineTo(top[4][0], top[4][1]);
      ctx.lineTo(bot[4][0], bot[4][1]);
      ctx.lineTo(bot[5][0], bot[5][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = this.shade(color, jitter * lift * (c.buildable ? 1 : 0.72));
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(top[i][0], top[i][1]);
    ctx.closePath();
    ctx.fill();
    if (detail) {
      ctx.strokeStyle = 'rgba(70,50,30,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.highlight.has(hexKey(c))) {
      ctx.fillStyle = 'rgba(184,50,42,0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(184,50,42,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // 水面高光
    if ((def.water || moat) && detail) {
      const [cx, cy] = this.center(c, z);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      const s = this.map.data.hexAcross * this.zoom * 0.18;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy);
      ctx.lineTo(cx + s * 0.4, cy);
      ctx.stroke();
    }
  }

  private center(c: Hex, z: number): Vec2 {
    const [x, y] = hexToWorld(c, this.map.hexSize);
    return this.project(x, y, z);
  }

  // ---------- 构件精灵 ----------

  private spec(b: BuildingDef, model: string, yaw = 0): SpriteSpec {
    const m = BUILDING_MODELS[b.id];
    return { model, fit: m.fit, yaw, shadow: b.placement !== 'onWall', copies: m.copies };
  }

  /** 城外方向：+Z（模型正面）在世界里的朝向 (sin yaw, -cos yaw)，跟「城心 → 本格」同向为正 */
  private facesOut(c: Hex, yaw: number): boolean {
    const [cx, cy] = this.map.center();
    const [x, y] = hexToWorld(c, this.map.hexSize);
    return Math.sin(yaw) * (x - cx) - Math.cos(yaw) * (y - cy) >= 0;
  }

  /** 方向 d（HEX_DIRS 下标）在世界里的角度：0 东，逆时针 */
  private static dirAngle(i: number): number {
    return [0, -60, -120, 180, 120, 60][i] * (Math.PI / 180);
  }

  /** 相邻的墙格（含城门、角楼、水门）方向，按从北到南排好（先画后面的） */
  private wallDirs(c: Hex): number[] {
    const out: number[] = [];
    HEX_DIRS.forEach((d, i) => {
      if (this.map.isWallish({ q: c.q + d.q, r: c.r + d.r })) out.push(i);
    });
    return out.sort((a, b) => Math.sin(PlanView.dirAngle(b)) - Math.sin(PlanView.dirAngle(a)));
  }

  /** 画半段墙；全部精灵已就绪才画并返回 true */
  private drawWallHalves(c: Hex, z: number, dirs: number[]): boolean {
    const ss: Sprite[] = [];
    for (const i of dirs) {
      const yaw = PlanView.dirAngle(i);
      const s = this.sprites.get({ model: WALL_MODEL, fit: 1, yaw, halfWall: { ...WALL_HALF, flip: !this.facesOut(c, yaw) } });
      if (!s) return false;
      ss.push(s);
    }
    const [sx, sy] = this.center(c, z);
    const hexPx = this.map.data.hexAcross * this.zoom;
    for (const s of ss) drawSprite(this.ctx, s, sx, sy, hexPx, this.dpr);
    return true;
  }

  /** 用模型精灵画构件；精灵没准备好返回 false，由调用方画程序小屋 */
  private drawModel(c: Cell, b: BuildingDef, detail: boolean): boolean {
    const z = this.z(c);
    if (b.id === 'wall') {
      const dirs = this.wallDirs(c);
      return this.drawWallHalves(c, z, dirs.length ? dirs : [0, 3]);
    }
    const m = BUILDING_MODELS[b.id];
    if (!m) return false;
    const model = m.models[m.models.length > 1 ? (((c.q * 73856093) ^ (c.r * 19349663)) >>> 0) % m.models.length : 0];
    let yaw = 0;
    let halves: number[] = [];
    if (m.orient === 'wall') {
      // 顺着一条相邻墙格连线摆；没在这条线上的墙段另画半段
      const dirs = this.wallDirs(c);
      const has = (i: number) => dirs.includes(i);
      const axis = [0, 1, 2].find((i) => has(i) && has(i + 3)) ?? (dirs.length ? dirs[0] % 3 : 0);
      yaw = PlanView.dirAngle(axis);
      if (!this.facesOut(c, yaw)) yaw += Math.PI;
      halves = dirs.filter((i) => i % 3 !== axis);
    } else if (m.orient === 'gate') {
      const gi = HEX_DIRS.findIndex((d) => this.map.at({ q: c.q + d.q, r: c.r + d.r })?.id === 'gate');
      // 正面朝向背离城门的一侧
      if (gi >= 0) yaw = PlanView.dirAngle(gi) - Math.PI / 2;
    }
    const s = this.sprites.get(this.spec(b, model, yaw));
    if (!s) return false;
    if (halves.length && !this.drawWallHalves(c, z, halves)) return false;
    const hexPx = this.map.data.hexAcross * this.zoom;
    let base = z;
    if (b.id === 'matou') {
      // 码头：木栈台 + 一条船
      const h = (this.map.data.hexAcross * 0.32 * b.height * 0.35) / this.vex;
      this.prism(c, z, h, 0.6, '#7a5f45', '#9a7a58');
      base = z + h;
    }
    const [sx, sy] = this.center(c, base);
    drawSprite(this.ctx, s, sx, sy, hexPx, this.dpr);
    // 朱印钉在格子右上，不跟精灵外框走（转了向的城门外框很宽，印会漂到邻格上）
    if (detail && hexPx > 40) this.seal(sx + hexPx * 0.3, sy - Math.min(s.ay * (hexPx / SPRITE_PX_PER_HEX) * 0.8, hexPx * 0.42), b);
    return true;
  }

  /** 精灵右上角的小朱印（构件名首字），方便辨认 */
  private seal(x: number, y: number, b: BuildingDef): void {
    const ctx = this.ctx;
    const s = Math.max(9, Math.min(15, this.map.data.hexAcross * this.zoom * 0.16));
    ctx.font = `bold ${s}px ${this.fontFamily()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(184,50,42,0.9)';
    ctx.fillRect(x - s * 0.62, y - s * 0.62, s * 1.24, s * 1.24);
    ctx.fillStyle = '#f3ead6';
    ctx.fillText(b.glyph, x, y + s * 0.04);
  }

  private font: string | null = null;
  private fontFamily(): string {
    return (this.font ??= getComputedStyle(document.body).fontFamily);
  }

  /** 构件：优先贴模型精灵；没有模型时城墙类画成灰色石台，其余画成白墙 + 坡顶小屋，屋顶上写单字。 */
  private drawBuilding(c: Cell, b: BuildingDef, alpha: number, detail: boolean): void {
    const ctx = this.ctx;
    const z = this.z(c);
    const unit = this.map.data.hexAcross; // 米
    ctx.globalAlpha = alpha;
    if (this.drawModel(c, b, detail)) {
      ctx.globalAlpha = 1;
      return;
    }
    if (b.id === 'wall' || b.id === 'wengcheng' || b.id === 'ditai') {
      const h = unit * (b.id === 'wall' ? 0.2 : 0.24) / this.vex;
      const scale = b.id === 'wall' ? 0.97 : b.id === 'wengcheng' ? 0.85 : 0.6;
      this.prism(c, z, h, scale, '#8f877a', '#b3aa98');
      if (b.id !== 'wall' && detail) this.glyph(c, z + h, b);
      ctx.globalAlpha = 1;
      return;
    }
    const isWallTop = b.wallish; // 城门、角楼、水门：先画一段城墙
    let base = z;
    if (isWallTop) {
      const h = (unit * 0.2) / this.vex;
      this.prism(c, z, h, 0.97, '#8f877a', '#b3aa98');
      base = z + h;
    }
    const bodyH = (unit * 0.32 * b.height) / this.vex;
    const fp = b.id === 'sheji' || b.id === 'shanchuan' || b.id === 'litan' ? 0.72 : b.id === 'matou' ? 0.6 : 0.62;
    if (b.id === 'sheji' || b.id === 'shanchuan' || b.id === 'litan' || b.id === 'matou') {
      // 坛台、码头：低平台
      this.prism(c, base, bodyH * 0.35, fp, b.id === 'matou' ? '#7a5f45' : '#b9ab88', b.id === 'matou' ? '#9a7a58' : '#d8cba6');
      if (detail) this.glyph(c, base + bodyH * 0.35, b);
      ctx.globalAlpha = 1;
      return;
    }
    const roofH = (unit * 0.22) / this.vex;
    this.prism(c, base, bodyH, fp, '#c9b998', '#efe4cb');
    this.roof(c, base + bodyH, fp * 1.22, roofH, b.roof);
    if (detail) this.glyph(c, base + bodyH + roofH, b);
    ctx.globalAlpha = 1;
  }

  private prism(c: Hex, z: number, h: number, scale: number, side: string, top: string): void {
    const ctx = this.ctx;
    const t = this.corners(c, z + h, scale), bt = this.corners(c, z, scale);
    // 朝东南的一面偏暗，朝西南（夕照）的一面偏亮
    for (const [a, b, color] of [[0, 5, side], [5, 4, this.mix(side, top)]] as [number, number, string][]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(t[a][0], t[a][1]);
      ctx.lineTo(t[b][0], t[b][1]);
      ctx.lineTo(bt[b][0], bt[b][1]);
      ctx.lineTo(bt[a][0], bt[a][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = top;
    ctx.beginPath();
    for (const p of t) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,20,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  private mix(a: string, b: string): string {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const m = (s: number) => Math.round((((pa >> s) & 255) + ((pb >> s) & 255)) / 2);
    return `rgb(${m(16)},${m(8)},${m(0)})`;
  }

  /** 攒尖式屋顶：六个檐角收到一个顶点 */
  private roof(c: Hex, z: number, scale: number, h: number, color: string): void {
    const ctx = this.ctx;
    const eave = this.corners(c, z, scale);
    const apex = this.center(c, z + h);
    const faces: [number, number, number][] = [[3, 4, 0.7], [4, 5, 0.85], [5, 0, 0.75], [0, 1, 1.05], [2, 3, 1.15], [1, 2, 1.1]];
    for (const [i, j, k] of faces) {
      ctx.fillStyle = this.shade(color, k);
      ctx.beginPath();
      ctx.moveTo(eave[i][0], eave[i][1]);
      ctx.lineTo(eave[j][0], eave[j][1]);
      ctx.lineTo(apex[0], apex[1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  private glyph(c: Hex, z: number, b: BuildingDef): void {
    const ctx = this.ctx;
    const [x, y] = this.center(c, z);
    const s = Math.max(10, Math.min(20, this.map.data.hexAcross * this.zoom * 0.26));
    ctx.font = `bold ${s}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(184,50,42,0.92)';
    ctx.fillRect(x - s * 0.6, y - s * 1.55, s * 1.2, s * 1.2);
    ctx.fillStyle = '#f3ead6';
    ctx.fillText(b.glyph, x, y - s * 0.93);
  }

  private drawGhost(c: Cell): void {
    const g = this.ghost!;
    const color = g.ok ? 'rgba(60,140,80,0.9)' : 'rgba(184,50,42,0.95)';
    if (g.def && g.ok && !g.def.waterish) this.drawBuilding(c, g.def, 0.6, true);
    this.outline(c, color, 2.5);
  }

  private outline(h: Hex, color: string, width: number): void {
    const c = this.map.cell(h);
    if (!c) return;
    const p = this.corners(c, this.z(c));
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const q of p) ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    ctx.stroke();
  }

  private drawRing(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(184,50,42,0.75)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [x, y] of this.map.data.ring!) {
      const [sx, sy] = this.project(x, y, this.baseElev);
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** 夕照：左上方金色斜阳，右下角压一点蓝灰（美术方向见 docs/玩法需求_v2.md 第 6 节） */
  private drawSunset(): void {
    const ctx = this.ctx;
    const W = this.vw, H = this.vh;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    const sun = ctx.createRadialGradient(W * 0.15, -H * 0.1, 0, W * 0.15, -H * 0.1, Math.hypot(W, H));
    sun.addColorStop(0, 'rgba(255,196,110,0.75)');
    sun.addColorStop(0.55, 'rgba(242,195,122,0.25)');
    sun.addColorStop(1, 'rgba(70,80,105,0.55)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** 八方罗盘：以城心为圆心，八个扇区，标卦名 */
  private drawCompass(): void {
    const ctx = this.ctx;
    const [cx, cy] = this.map.center();
    const R = this.map.radius() * 1.35;
    const dirs: Dir[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(184,50,42,0.45)';
    // 外圈
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const [sx, sy] = this.project(cx + R * Math.sin(a), cy + R * Math.cos(a), this.baseElev);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    // 中宫
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const [sx, sy] = this.project(cx + R * 0.22 * Math.sin(a), cy + R * 0.22 * Math.cos(a), this.baseElev);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([4, 5]);
    for (let i = 0; i < 8; i++) {
      const a = ((i * 45 + 22.5) * Math.PI) / 180;
      const p0 = this.project(cx + R * 0.22 * Math.sin(a), cy + R * 0.22 * Math.cos(a), this.baseElev);
      const p1 = this.project(cx + R * Math.sin(a), cy + R * Math.cos(a), this.baseElev);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const fs = Math.max(12, Math.min(22, R * this.zoom * 0.09));
    ctx.font = `bold ${fs}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    dirs.forEach((d, i) => {
      const a = (i * 45 * Math.PI) / 180;
      const [sx, sy] = this.project(cx + R * 1.1 * Math.sin(a), cy + R * 1.1 * Math.cos(a), this.baseElev);
      ctx.fillStyle = 'rgba(236,226,202,0.85)';
      ctx.fillRect(sx - fs * 1.1, sy - fs * 0.75, fs * 2.2, fs * 1.5);
      ctx.fillStyle = 'rgba(184,50,42,0.95)';
      ctx.fillText(DIR_GUA[d], sx, sy - fs * 0.12);
      ctx.font = `${fs * 0.5}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillStyle = 'rgba(47,36,26,0.8)';
      ctx.fillText(DIR_NAME[d], sx, sy + fs * 0.52);
      ctx.font = `bold ${fs}px ${getComputedStyle(document.body).fontFamily}`;
    });
    const [sx, sy] = this.project(cx, cy, this.baseElev);
    ctx.fillStyle = 'rgba(184,50,42,0.9)';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawLabels(detail: boolean): void {
    if (!this.map.labels.size) return;
    const ctx = this.ctx;
    const fs = detail ? 15 : 12;
    ctx.font = `${fs}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [k, name] of this.map.labels) {
      const [q, r] = k.split(',').map(Number);
      const c = this.map.cell({ q, r });
      if (!c) continue;
      const [x, y] = this.center(c, this.z(c));
      const w = ctx.measureText(name).width + 12;
      ctx.fillStyle = 'rgba(47,36,26,0.62)';
      ctx.fillRect(x - w / 2, y - fs * 0.8, w, fs * 1.6);
      ctx.fillStyle = '#f3ead6';
      ctx.fillText(name, x, y);
    }
  }

  // ---------- 拾取与输入 ----------

  pick(sx: number, sy: number): Hex | null {
    // 先按高程为 0 反投影，再向南（画面靠前）找顶面包含该点的格子，取最靠前的
    const x = this.camX + (sx - this.vw / 2) / this.zoom;
    const y0 = this.camY - (sy - this.vh / 2) / (this.zoom * TILT);
    const guess = worldToHex([x, y0], this.map.hexSize);
    let best: Cell | null = null;
    for (let dr = 2; dr >= -14; dr--) {
      for (let dq = -8; dq <= 8; dq++) {
        const c = this.map.cell({ q: guess.q + dq, r: guess.r + dr });
        if (!c) continue;
        if (pointInPoly([sx, sy], this.corners(c, this.z(c))) && (!best || c.r < best.r)) best = c;
      }
    }
    return best ? { q: best.q, r: best.r } : null;
  }

  setHover(h: Hex | null): void {
    if (h?.q === this.hover?.q && h?.r === this.hover?.r) return;
    this.hover = h;
    this.invalidate();
  }

  private bindInput(): void {
    const cv = this.canvas;
    let down: { x: number; y: number; cx: number; cy: number; button: number; moved: boolean } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, cx: this.camX, cy: this.camY, button: e.button, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 5) down.moved = true;
        if (down.moved) {
          this.touched = true;
          this.camX = down.cx - dx / this.zoom;
          this.camY = down.cy + dy / (this.zoom * TILT);
          cv.classList.add('dragging');
          this.invalidate();
          return;
        }
      }
      const h = this.pick(e.clientX, e.clientY);
      this.setHover(h);
      this.events.onHover(h, [e.clientX, e.clientY]);
    });
    cv.addEventListener('pointerup', (e) => {
      cv.classList.remove('dragging');
      if (down && !down.moved) {
        const h = this.pick(e.clientX, e.clientY);
        if (h) this.events.onClick(h, down.button);
      }
      down = null;
    });
    cv.addEventListener('pointerleave', () => {
      this.setHover(null);
      this.events.onHover(null, [0, 0]);
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015);
      const minZ = 3 / this.map.data.hexAcross, maxZ = 120 / this.map.data.hexAcross;
      const nz = Math.max(minZ, Math.min(maxZ, this.zoom * k));
      // 以鼠标位置为中心缩放
      const wx = this.camX + (e.clientX - innerWidth / 2) / this.zoom;
      const wy = this.camY - (e.clientY - innerHeight / 2) / (this.zoom * TILT);
      this.zoom = nz;
      this.touched = true;
      this.camX = wx - (e.clientX - innerWidth / 2) / nz;
      this.camY = wy + (e.clientY - innerHeight / 2) / (nz * TILT);
      this.invalidate();
    }, { passive: false });
  }

  /** 截图（史书卷首用） */
  snapshot(width = 640): string {
    const out = document.createElement('canvas');
    const k = width / this.canvas.width;
    out.width = width;
    out.height = Math.round(this.canvas.height * k);
    this.draw();
    out.getContext('2d')!.drawImage(this.canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.85);
  }
}

function pointInPoly([x, y]: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
