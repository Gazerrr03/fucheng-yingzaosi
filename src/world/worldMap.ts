// 天下舆图的数据：public/data/world/ming.json（由 tools/build_world_map.py 生成）。
// 网格与营建网格相同（尖顶六边形，轴坐标 q、r，y 向北），单位公里。

import { fetchJSON } from '../game/assets';
import { HEX_DIRS, hexKey, type Hex } from '../scene/hex';

export interface WorldJSON {
  id: string;
  name: string;
  subtitle: string;
  hexKm: number;
  terrain: { qMin: number; rMin: number; rows: string[] };
  elev: { step: number; rows: string[] };
  feature: string[];
  domain: string[];
  /** path：河道经过的格；line：真实河道折线（公里，与格子同一平面坐标）。rank 4 为名城附近的小河 */
  rivers: { name: string; rank: number | 'canal'; path: [number, number][]; line: [number, number][] }[];
  /** xy：府城真实位置（公里） */
  cities: { name: string; hex: [number, number]; prov: string; xy: [number, number]; capital?: boolean; known?: string }[];
  provinces: { name: string; hex: [number, number] }[];
  /** xy、r：湖心与东西、南北半轴（公里） */
  lakes: { name: string; hex: [number, number]; xy: [number, number]; r: [number, number] }[];
  /** 城边小湖：比一格小得多，不进栅格，放大时与城址生成时才画 */
  pools: { name: string; xy: [number, number]; r: [number, number] }[];
  ranges: { name: string; hex: [number, number] }[];
  note?: string;
}

export type WorldTerrain = 'O' | 'Q' | 'W' | 'F' | 'H' | 'S' | 'X' | 'P' | 'D' | 'C';

export const WORLD_TERRAIN: Record<WorldTerrain, { name: string; color: string; water?: boolean; rough?: boolean }> = {
  O: { name: '深海', color: '#5f8796', water: true },
  Q: { name: '近海', color: '#82a7ac', water: true },
  W: { name: '湖泽', color: '#8ab2b3', water: true },
  F: { name: '平原', color: '#d9c48f' },
  H: { name: '丘陵', color: '#bfae76' },
  S: { name: '山地', color: '#8f8c69', rough: true },
  X: { name: '雪山', color: '#e4e2da', rough: true },
  P: { name: '高原', color: '#b4ab82' },
  D: { name: '荒漠', color: '#e2cb98' },
  C: { name: '草原', color: '#b8bf86' },
};

export interface WorldCell extends Hex {
  t: WorldTerrain;
  /** 米 */
  elev: number;
  /** f 林、m 泽 */
  feature: string;
  /** 是否在明朝疆域内 */
  domain: boolean;
  /** 穿过本格的最大河流：1 大江大河、2 主要支流、3 一般河流、4 名城小河、0 运河 */
  river?: number;
  riverNames: string[];
  prov?: string;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const SQRT3 = Math.sqrt(3);

export class WorldMap {
  readonly cells = new Map<string, WorldCell>();
  readonly size: number;
  readonly cityAt = new Map<string, WorldJSON['cities'][number]>();
  readonly bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };

  constructor(readonly data: WorldJSON) {
    this.size = data.hexKm / SQRT3;
    const { qMin, rMin, rows } = data.terrain;
    rows.forEach((row, ri) => {
      for (let qi = 0; qi < row.length; qi++) {
        const t = row[qi];
        if (t === '.') continue;
        const q = qMin + qi, r = rMin + ri;
        const cell: WorldCell = {
          q, r, t: t as WorldTerrain,
          elev: DIGITS.indexOf(data.elev.rows[ri][qi]) * data.elev.step,
          feature: data.feature[ri][qi],
          domain: data.domain[ri][qi] === '1',
          riverNames: [],
        };
        this.cells.set(hexKey(cell), cell);
        const [x, y] = this.world(cell);
        this.bounds.x0 = Math.min(this.bounds.x0, x); this.bounds.x1 = Math.max(this.bounds.x1, x);
        this.bounds.y0 = Math.min(this.bounds.y0, y); this.bounds.y1 = Math.max(this.bounds.y1, y);
      }
    });
    for (const rv of data.rivers) {
      const rank = rv.rank === 'canal' ? 0 : rv.rank;
      for (const [q, r] of rv.path) {
        const c = this.cells.get(`${q},${r}`);
        if (!c) continue;
        if (!c.riverNames.includes(rv.name)) c.riverNames.push(rv.name);
        if (c.river === undefined || (rank && (c.river === 0 || rank < c.river))) c.river = rank;
      }
    }
    for (const ct of data.cities) this.cityAt.set(`${ct.hex[0]},${ct.hex[1]}`, ct);
    this.assignProvinces();
  }

  static async load(id = 'ming'): Promise<WorldMap> {
    return new WorldMap(await fetchJSON<WorldJSON>(`data/world/${id}.json`));
  }

  cell(h: Hex): WorldCell | undefined {
    return this.cells.get(hexKey(h));
  }

  world(h: Hex): [number, number] {
    return [this.size * SQRT3 * (h.q + h.r / 2), this.size * 1.5 * h.r];
  }

  neighbors(h: Hex): WorldCell[] {
    const out: WorldCell[] = [];
    for (const d of HEX_DIRS) {
      const c = this.cells.get(`${h.q + d.q},${h.r + d.r}`);
      if (c) out.push(c);
    }
    return out;
  }

  /** 半径 n 以内（不含自身）的格 */
  ring(h: Hex, n: number): WorldCell[] {
    const out: WorldCell[] = [];
    for (let dq = -n; dq <= n; dq++) {
      for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
        if (!dq && !dr) continue;
        const c = this.cells.get(`${h.q + dq},${h.r + dr}`);
        if (c) out.push(c);
      }
    }
    return out;
  }

  isWater(c: WorldCell | undefined): boolean {
    return !!c && !!WORLD_TERRAIN[c.t].water;
  }

  static dist(a: Hex, b: Hex): number {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  }

  /** 每格归到最近的省份标签（只算疆域内的陆地），用于地块信息 */
  private assignProvinces(): void {
    const provs = this.data.provinces;
    const cities = this.data.cities;
    for (const c of this.cells.values()) {
      if (!c.domain || this.isWater(c)) continue;
      // 先看最近的府城所属省份，再退到省份标签
      let best = Infinity, prov: string | undefined;
      for (const ct of cities) {
        const d = WorldMap.dist(c, { q: ct.hex[0], r: ct.hex[1] });
        if (d < best) {
          best = d;
          prov = ct.prov;
        }
      }
      if (best > 6) {
        for (const p of provs) {
          const d = WorldMap.dist(c, { q: p.hex[0], r: p.hex[1] });
          if (d < best) {
            best = d;
            prov = p.name;
          }
        }
      }
      c.prov = prov;
    }
  }

  /** 离某格最近的明代府城 */
  nearestCity(h: Hex): { city: WorldJSON['cities'][number]; dist: number } | null {
    let best: { city: WorldJSON['cities'][number]; dist: number } | null = null;
    for (const ct of this.data.cities) {
      const d = WorldMap.dist(h, { q: ct.hex[0], r: ct.hex[1] });
      if (!best || d < best.dist) best = { city: ct, dist: d };
    }
    return best;
  }
}
