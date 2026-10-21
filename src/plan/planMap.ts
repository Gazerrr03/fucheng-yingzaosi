// 营建网格：地形 + 高程 + 可建范围 + 已放置的构件，以及由此推出的城内范围、城心、方位。
// 经典关卡由 v1 的关卡地形（data/{city}.json 的 terrain）转来；自定义地图读 data/plan/{id}.json。

import { hexKey, hexToWorld, neighbors, type Hex } from '../scene/hex';
import type { Vec2 } from '../scene/homography';
import type { TerrainJSON } from '../game/terrain';
import { BUILDING_BY_ID, type BuildingDef, type Dir } from './buildings';

/** 营建用的地形。R/W/M/I 为水；S 山、H 丘；T 田、G 村、B 城内地面。 */
export const PLAN_TERRAIN: Record<string, { name: string; color: string; water?: boolean }> = {
  R: { name: '大江', color: '#5d8ea0', water: true },
  W: { name: '湖塘', color: '#78a5ac', water: true },
  M: { name: '护城河', color: '#6c9ba3', water: true },
  /** 来水口：图外近处有江河，图边开一口，可从这里挖渠引水（城址生成时放在朝向那条河的图边） */
  I: { name: '来水口', color: '#6f9aa6', water: true },
  S: { name: '山', color: '#7f8a5a' },
  H: { name: '丘', color: '#a8a26a' },
  T: { name: '田野', color: '#cdb98a' },
  G: { name: '村落', color: '#c2a57a' },
  B: { name: '平地', color: '#d6c39b' },
};

export interface PlanMapJSON {
  id: string;
  name: string;
  subtitle?: string;
  /** real：真实地图；sketch：示意级 */
  kind: 'real' | 'sketch';
  /** 格子对边距离（米） */
  hexAcross: number;
  terrain: TerrainJSON;
  /** 高程：与 terrain 同形的字符行，每个字符 0-9a-z 表示第几档，乘 elevStep 得米 */
  elev?: { rows: string[]; step: number; base?: number };
  /** 可建范围（世界坐标多边形，米），例如绕城高速。不给则全图可建 */
  ring?: Vec2[];
  ringName?: string;
  labels?: { hex: [number, number]; name: string }[];
  /** 地形专名，例如 R → 汉江、S → 岘山 */
  terrainNames?: Record<string, string>;
  /** 预置构件，例如经典关卡里已有的城墙 */
  preset?: { hex: [number, number]; id: string; locked?: boolean }[];
  note?: string;
  source?: string;
}

export interface Cell extends Hex {
  terrain: string;
  elev: number;
  buildable: boolean;
}

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

const ELEV_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export class PlanMap {
  readonly cells = new Map<string, Cell>();
  readonly placed = new Map<string, string>();
  readonly locked = new Set<string>();
  /** 道路另成一层：与水渠、护城河同格即为桥 */
  readonly roads = new Set<string>();
  /** 预置构件（锁定的城墙可以升级成城门、角楼、水门，拆除时退回城墙） */
  private readonly preset = new Map<string, string>();
  readonly labels = new Map<string, string>();
  readonly hexSize: number;
  readonly bounds: { qMin: number; qMax: number; rMin: number; rMax: number };
  private cache: { inside: Set<string>; center: Vec2; radius: number } | null = null;
  private wetCache: Set<string> | null = null;
  private pondCache: Set<string> | null = null;

  constructor(readonly data: PlanMapJSON) {
    this.hexSize = data.hexAcross / Math.sqrt(3);
    const t = data.terrain;
    let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    t.rows.forEach((row, ri) => {
      const er = data.elev?.rows[ri];
      for (let qi = 0; qi < row.length; qi++) {
        let code = row[qi];
        if (code === '.') continue;
        const q = t.qMin + qi, r = t.rMin + ri;
        const elevIdx = er ? Math.max(0, ELEV_DIGITS.indexOf(er[qi] ?? '0')) : -1;
        let elev = elevIdx >= 0 ? (data.elev!.base ?? 0) + elevIdx * data.elev!.step : defaultElev(code, q, r);
        // v1 关卡里的城墙格：地面当平地，城墙作为预置构件
        if (code === 'C') {
          code = 'B';
          elev = 0;
        }
        const cell: Cell = { q, r, terrain: code, elev, buildable: true };
        if (data.ring) cell.buildable = pointInPolygon(hexToWorld(cell, this.hexSize), data.ring);
        this.cells.set(hexKey(cell), cell);
        qMin = Math.min(qMin, q); qMax = Math.max(qMax, q);
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      }
    });
    this.bounds = { qMin, qMax, rMin, rMax };
    for (const l of data.labels ?? []) this.labels.set(hexKey({ q: l.hex[0], r: l.hex[1] }), l.name);
    for (const p of data.preset ?? []) {
      const key = hexKey({ q: p.hex[0], r: p.hex[1] });
      if (!this.cells.has(key)) continue;
      this.placed.set(key, p.id);
      this.preset.set(key, p.id);
      if (p.locked) this.locked.add(key);
    }
  }

  /** 由 v1 关卡数据生成营建地图：城墙格 C 变成预置（锁定）的城墙构件。 */
  static fromLevel(id: string, name: string, terrain: TerrainJSON, opts: { hexAcross: number; keepWalls: boolean; lockWalls?: boolean; labels?: PlanMapJSON['labels']; terrainNames?: Record<string, string> }): PlanMapJSON {
    const preset: NonNullable<PlanMapJSON['preset']> = [];
    if (opts.keepWalls) {
      terrain.rows.forEach((row, ri) => {
        for (let qi = 0; qi < row.length; qi++) {
          if (row[qi] === 'C') preset.push({ hex: [terrain.qMin + qi, terrain.rMin + ri], id: 'wall', locked: opts.lockWalls });
        }
      });
    }
    return { id, name, kind: 'sketch', hexAcross: opts.hexAcross, terrain, preset, labels: opts.labels, terrainNames: opts.terrainNames };
  }

  cell(h: Hex): Cell | undefined {
    return this.cells.get(hexKey(h));
  }

  at(h: Hex): BuildingDef | undefined {
    const id = this.placed.get(hexKey(h));
    return id ? BUILDING_BY_ID.get(id) : undefined;
  }

  terrainName(code: string): string {
    return this.data.terrainNames?.[code] ?? PLAN_TERRAIN[code]?.name ?? code;
  }

  /** 两格之间的格数 */
  static dist(a: Hex, b: Hex): number {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  }

  /** 是否水面：天然水，或接上水源的人工水面（干濠、干渠不算） */
  isWater(h: Hex): boolean {
    const c = this.cell(h);
    if (!c) return false;
    if (PLAN_TERRAIN[c.terrain]?.water) return true;
    const b = this.at(h);
    return !!b?.waterish && this.wet().has(hexKey(h));
  }

  /** 池：三格水渠两两相邻（六边形最小三角）即汇成池，这三格都算池；拆掉一格就退回水渠 */
  isPond(h: Hex): boolean {
    return this.ponds().has(hexKey(h));
  }

  ponds(): Set<string> {
    if (this.pondCache) return this.pondCache;
    const ponds = new Set<string>();
    const isQu = (h: Hex) => this.at(h)?.id === 'qu';
    for (const [k, id] of this.placed) {
      if (id !== 'qu') continue;
      const [q, r] = k.split(',').map(Number);
      const nb = neighbors({ q, r });
      // neighbors 按环序排列，相邻两个方向的邻格彼此也相邻
      for (let i = 0; i < 6; i++) {
        const a = nb[i], b = nb[(i + 1) % 6];
        if (isQu(a) && isQu(b)) {
          ponds.add(k).add(hexKey(a)).add(hexKey(b));
        }
      }
    }
    this.pondCache = ponds;
    return ponds;
  }

  /**
   * 水门（或拟建水门的城墙格）两侧的水：outside 城外一侧临水；inner 城内一侧接着有水的内河。
   * 城墙不过水，城内的渠只能经水门从城外得水。
   */
  sluice(h: Hex): { outside: boolean; inner: boolean } {
    const inside = this.inside();
    let outside = false, inner = false;
    for (const n of neighbors(h)) {
      if (this.isWallish(n) || !this.isWater(n)) continue;
      if (inside.has(hexKey(n))) inner = true;
      else outside = true;
    }
    return { outside, inner };
  }

  /** 人工水面格（护城河、水渠）是否已接上水源 */
  isWet(h: Hex): boolean {
    return this.wet().has(hexKey(h));
  }

  /**
   * 水网：从天然水（江河湖塘）出发，沿相邻的护城河、水渠、水门洪水填充，填到的人工水面格就「有水」。
   * 城墙本身不过水，水只能经水门穿墙。
   */
  wet(): Set<string> {
    if (this.wetCache) return this.wetCache;
    const wet = new Set<string>();
    const seen = new Set<string>();
    const stack: Hex[] = [];
    const conduit = (b: BuildingDef | undefined) => !!b && (b.waterish || b.id === 'shuimen');
    for (const c of this.cells.values()) {
      if (PLAN_TERRAIN[c.terrain]?.water) {
        seen.add(hexKey(c));
        stack.push(c);
      }
    }
    while (stack.length) {
      const h = stack.pop()!;
      for (const n of neighbors(h)) {
        const k = hexKey(n);
        if (seen.has(k)) continue;
        const b = this.at(n);
        if (!conduit(b)) continue;
        seen.add(k);
        if (b!.waterish) wet.add(k);
        stack.push(n);
      }
    }
    this.wetCache = wet;
    return wet;
  }

  isNaturalWater(h: Hex): boolean {
    const c = this.cell(h);
    return !!c && !!PLAN_TERRAIN[c.terrain]?.water;
  }

  isWallish(h: Hex): boolean {
    return !!this.at(h)?.wallish;
  }

  isMountain(h: Hex): boolean {
    const c = this.cell(h);
    return !!c && (c.terrain === 'S' || c.terrain === 'H');
  }

  hasRoad(h: Hex): boolean {
    return this.roads.has(hexKey(h));
  }

  /** 道路与水渠、护城河同格：桥 */
  isBridge(h: Hex): boolean {
    return this.hasRoad(h) && !!this.at(h)?.waterish;
  }

  count(id: string): number {
    if (id === 'road') return this.roads.size;
    let n = 0;
    for (const b of this.placed.values()) if (b === id) n++;
    return n;
  }

  /** 某构件能否放在这一格。 */
  canPlace(def: BuildingDef, h: Hex): PlaceCheck {
    const key = hexKey(h);
    const c = this.cells.get(key);
    if (!c) return { ok: false, reason: '图外' };
    if (!c.buildable) return { ok: false, reason: `在${this.data.ringName ?? '可建范围'}以外` };
    if (this.locked.has(key) && !(def.placement === 'onWall' && this.placed.get(key) === 'wall')) return { ok: false, reason: '此处为既有建筑，不能改动' };
    if (def.max && this.count(def.id) >= def.max && this.placed.get(key) !== def.id) return { ok: false, reason: `${def.name}最多 ${def.max} 座` };
    const cur = this.at(h);
    const nb = neighbors(h);
    if (def.placement === 'road') {
      if (this.roads.has(key)) return { ok: false, reason: '此处已有道路' };
      if (PLAN_TERRAIN[c.terrain]?.water) return { ok: false, reason: '江河湖塘上不能铺路' };
      if (cur && !cur.waterish) return { ok: false, reason: `此处已有${cur.name}` };
      return { ok: true };
    }
    if (this.roads.has(key) && !def.waterish) return { ok: false, reason: '此处有道路，先拆除道路' };
    if (def.placement === 'onWall') {
      if (!cur || cur.id !== 'wall') return { ok: false, reason: `${def.name}要建在城墙上` };
      if (def.id === 'shuimen' && !this.sluice(h).outside) return { ok: false, reason: '水门要一侧临城外的水（江河、湖塘或有水的护城河）' };
      return { ok: true };
    }
    if (PLAN_TERRAIN[c.terrain]?.water) return { ok: false, reason: '不能建在水里' };
    if (cur) return { ok: false, reason: `此处已有${cur.name}` };
    if (def.placement === 'nearGate' && !nb.some((n) => this.at(n)?.id === 'gate')) return { ok: false, reason: '瓮城要紧贴城门' };
    if (def.placement === 'nearWall' && !nb.some((n) => this.isWallish(n))) return { ok: false, reason: `${def.name}要紧贴城墙` };
    if (def.placement === 'shore' && !nb.some((n) => this.isNaturalWater(n) && this.cell(n)!.terrain !== 'I')) return { ok: false, reason: '码头要临江河湖塘' };
    if (def.placement === 'nearGate' || def.placement === 'nearWall') {
      // 瓮城、敌台、护城河在城外
      if (this.inside().has(key)) return { ok: false, reason: `${def.name}要在城外` };
    }
    return { ok: true };
  }

  place(def: BuildingDef, h: Hex): PlaceCheck {
    const chk = this.canPlace(def, h);
    if (!chk.ok) return chk;
    if (def.placement === 'road') {
      this.roads.add(hexKey(h));
      return chk;
    }
    this.placed.set(hexKey(h), def.id);
    this.cache = null;
    this.wetCache = null;
    this.pondCache = null;
    return chk;
  }

  /** 拆除：有道路先拆道路（桥拆了渠还在）；城门、角楼、水门拆了退回城墙。 */
  remove(h: Hex): boolean {
    const key = hexKey(h);
    if (this.roads.delete(key)) return true;
    const cur = this.at(h);
    if (!cur || (this.locked.has(key) && cur.id === this.preset.get(key))) return false;
    if (cur.placement === 'onWall') this.placed.set(key, 'wall');
    else this.placed.delete(key);
    this.cache = null;
    this.wetCache = null;
    this.pondCache = null;
    return true;
  }

  /** 城墙围合的城内格：从地图边缘洪水填充，碰到城墙就停，没被填到的就是城内。 */
  inside(): Set<string> {
    return this.compute().inside;
  }

  /** 城心（世界坐标）。有城时取城内格的中心，否则取所有构件的中心，再否则取地图中心。 */
  center(): Vec2 {
    return this.compute().center;
  }

  /** 城的半径（米）：城内格到城心的最远距离。 */
  radius(): number {
    return this.compute().radius;
  }

  get walled(): boolean {
    return this.inside().size > 0;
  }

  /** 某格相对城心的方位。距离小于城半径的 30% 算「城中」。 */
  dirOf(h: Hex): { dir: Dir | 'C'; dist: number; ratio: number } {
    const [cx, cy] = this.center();
    const [x, y] = hexToWorld(h, this.hexSize);
    const dx = x - cx, dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const ratio = dist / Math.max(this.radius(), this.hexSize * 2);
    if (ratio < 0.3) return { dir: 'C', dist, ratio };
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = 北，顺时针
    const dirs: Dir[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return { dir: dirs[Math.round(((deg + 360) % 360) / 45) % 8], dist, ratio };
  }

  /** 所有已放置构件 */
  *buildings(): Generator<{ hex: Hex; key: string; def: BuildingDef; locked: boolean }> {
    for (const [key, id] of this.placed) {
      const def = BUILDING_BY_ID.get(id);
      if (!def) continue;
      const [q, r] = key.split(',').map(Number);
      yield { hex: { q, r }, key, def, locked: this.locked.has(key) };
    }
  }

  /** 城墙转角：两格以内的城墙格，其重心明显偏到一侧（直墙、锯齿墙两侧对称，重心几乎不动）。 */
  isCorner(h: Hex): boolean {
    const [x0, y0] = hexToWorld(h, this.hexSize);
    let sx = 0, sy = 0, n = 0;
    for (let dq = -2; dq <= 2; dq++) {
      for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
        if (!dq && !dr) continue;
        const c = { q: h.q + dq, r: h.r + dr };
        if (!this.isWallish(c)) continue;
        const [x, y] = hexToWorld(c, this.hexSize);
        sx += x - x0; sy += y - y0; n++;
      }
    }
    if (n < 2) return false;
    return Math.hypot(sx / n, sy / n) / this.data.hexAcross > 0.45;
  }

  /** 修改记录用：当前构件的紧凑列表 */
  snapshot(): [number, number, string][] {
    const out: [number, number, string][] = [...this.buildings()].filter((b) => this.preset.get(b.key) !== b.def.id).map((b) => [b.hex.q, b.hex.r, b.def.id]);
    for (const k of this.roads) {
      const [q, r] = k.split(',').map(Number);
      out.push([q, r, 'road']);
    }
    return out;
  }

  restore(list: [number, number, string][]): void {
    this.placed.clear();
    this.roads.clear();
    for (const [k, id] of this.preset) this.placed.set(k, id);
    for (const [q, r, id] of list) {
      const key = hexKey({ q, r });
      if (!this.cells.has(key) || !BUILDING_BY_ID.has(id)) continue;
      if (id === 'road') {
        this.roads.add(key);
        continue;
      }
      if (this.locked.has(key) && BUILDING_BY_ID.get(id)!.placement !== 'onWall') continue;
      this.placed.set(key, id);
    }
    this.cache = null;
    this.wetCache = null;
    this.pondCache = null;
  }

  private compute() {
    if (this.cache) return this.cache;
    const outside = new Set<string>();
    const stack: Cell[] = [];
    for (const c of this.cells.values()) {
      if (neighbors(c).some((n) => !this.cells.has(hexKey(n))) && !this.isWallish(c)) {
        outside.add(hexKey(c));
        stack.push(c);
      }
    }
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of neighbors(c)) {
        const k = hexKey(n);
        if (outside.has(k) || !this.cells.has(k) || this.isWallish(n)) continue;
        outside.add(k);
        stack.push(this.cells.get(k)!);
      }
    }
    const inside = new Set<string>();
    for (const [k, c] of this.cells) if (!outside.has(k) && !this.isWallish(c)) inside.add(k);

    let pts: Hex[] = [...inside].map((k) => this.cells.get(k)!);
    if (!pts.length) pts = [...this.buildings()].map((b) => b.hex);
    let center: Vec2;
    if (pts.length) {
      let sx = 0, sy = 0;
      for (const p of pts) {
        const [x, y] = hexToWorld(p, this.hexSize);
        sx += x; sy += y;
      }
      center = [sx / pts.length, sy / pts.length];
    } else {
      const { qMin, qMax, rMin, rMax } = this.bounds;
      center = hexToWorld({ q: (qMin + qMax) / 2, r: (rMin + rMax) / 2 }, this.hexSize);
    }
    let radius = 0;
    for (const p of pts) {
      const [x, y] = hexToWorld(p, this.hexSize);
      radius = Math.max(radius, Math.hypot(x - center[0], y - center[1]));
    }
    this.cache = { inside, center, radius: Math.max(radius, this.hexSize * 3) };
    return this.cache;
  }
}

/** v1 关卡没有高程：山给一个起伏的高度，其余平地。 */
function defaultElev(code: string, q: number, r: number): number {
  const n = Math.sin(q * 1.7 + r * 0.9) * 0.5 + Math.sin(q * 0.6 - r * 1.3) * 0.5;
  if (code === 'S') return 60 + n * 25;
  if (code === 'H') return 25 + n * 10;
  if (code === 'R' || code === 'W' || code === 'M') return -2;
  return 2 + n;
}

export function pointInPolygon([x, y]: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
