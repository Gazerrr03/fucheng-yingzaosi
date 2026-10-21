// 城址生成：由天下舆图上的一格（约 28 公里）推演出城级营建地图（一格 200 米，约 11 × 8 公里）。
// 江河、湖泊按天下舆图里的真实河道与湖岸投影过来（见 projectWaters），城压在河上就推到一岸；
// 邻格是海 → 在那一侧的图边画出海面；邻格是山、丘 → 那一侧起山。地形噪声按格子坐标定种子，同一格每次生成相同。

import { HEX_DIRS, type Hex } from '../scene/hex';
import type { PlanMapJSON } from '../plan/planMap';
import type { SiteVerdict } from './siteScore';
import { WorldMap, type WorldCell } from './worldMap';

const SQRT3 = Math.sqrt(3);
const HEX_M = 200;
/** 半宽、半高（米） */
const HALF_W = 5800, HALF_H = 4000;
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

type V2 = [number, number];

function hash(a: number, b: number, k: number): number {
  let h = (a * 374761393 + b * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number): number {
  return 0.55 * vnoise(x, y, seed) + 0.3 * vnoise(x * 2.1, y * 2.1, seed + 1) + 0.15 * vnoise(x * 4.3, y * 4.3, seed + 2);
}

function segDist(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function polyDist(p: V2, line: V2[]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segDist(p, line[i], line[i + 1]));
  return d;
}

const DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

const unit = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** 投影时考虑的最远距离（米）：再远的江河不画进城址，留给图边来水口 */
const REACH = 16000;
/** 来水口：REACH 以外、这个距离以内的江河湖泊，在图边朝它的方向开一个来水口，可以从那里挖渠引水 */
const INLET_REACH = 40000;
/** 明代一里约 576 米 */
const LI_M = 576;
const KM = 1000;
const RIVER_HALF: Record<number, number> = { 0: 70, 1: 420, 2: 240, 3: 130, 4: 80 };

export interface SiteWater {
  line: V2[];
  half: number;
  code: 'R' | 'W';
  name: string;
  rank: number;
  /** 城心到河的方向与真实距离（米） */
  u: V2;
  dist: number;
}

/** 城心沿方向 u 到图边的距离 */
function edgeDist([ux, uy]: V2): number {
  return Math.min(HALF_W / Math.max(1e-6, Math.abs(ux)), HALF_H / Math.max(1e-6, Math.abs(uy)));
}

/** 真实距离 g → 图上距离：太近推到 gMin（城坐一岸）；图内六成以内照实；更远的压缩到图边以内，次序不变 */
function placeGap(g: number, u: V2, gMin: number): number {
  const e = edgeDist(u);
  const keep = Math.max(gMin, e * 0.6);
  if (g < gMin) return gMin;
  if (g <= keep) return g;
  return keep + ((Math.min(g, REACH) - keep) / Math.max(1, REACH - keep)) * (e * 0.95 - keep);
}

/** 城址中心（米，天下舆图平面坐标）：府城真实位置，没有府城就取格心 */
export function siteCenter(world: WorldMap, h: Hex): V2 {
  const city = world.data.cities.find((ct) => ct.hex[0] === h.q && ct.hex[1] === h.r);
  const [x, y] = city?.xy ?? world.world(h);
  return [x * KM, y * KM];
}

/** 把天下舆图的真实河道、湖岸投影到城址局部坐标（米，城心为原点，y 向北） */
export interface SiteInlet {
  name: string;
  /** 城心朝来水的方向、真实距离（米） */
  u: V2;
  dist: number;
}

export function projectWaters(world: WorldMap, h: Hex, seed: number): { waters: SiteWater[]; lakes: { c: V2; r: V2; name: string }[]; inlets: SiteInlet[]; primaryU: V2 | null } {
  const P = siteCenter(world, h);
  const far: SiteInlet[] = [];
  const box = (p: V2) => Math.abs(p[0]) < HALF_W * 1.6 && Math.abs(p[1]) < HALF_H * 1.6;
  const waters: SiteWater[] = [];
  for (const rv of world.data.rivers) {
    if (!rv.line?.length) continue;
    const local: V2[] = rv.line.map(([x, y]) => [x * KM - P[0], y * KM - P[1]]);
    // 最近点与该处走向
    let g = Infinity, Q: V2 = local[0], tan: V2 = [1, 0];
    for (let i = 0; i < local.length - 1; i++) {
      const a = local[i], b = local[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / L)) : 0;
      const q: V2 = [a[0] + t * dx, a[1] + t * dy];
      const d = Math.hypot(q[0], q[1]);
      if (d < g) {
        g = d;
        Q = q;
        tan = unit([dx, dy]);
      }
    }
    if (g > REACH) {
      if (g <= INLET_REACH) far.push({ name: rv.name, u: [Q[0] / g, Q[1] / g], dist: g });
      continue;
    }
    const rank = rv.rank === 'canal' ? 0 : rv.rank;
    const half = RIVER_HALF[rank] ?? 100;
    // 城心几乎压在河上时不知道在哪岸，取南岸放河（城居北岸，向阳）
    let u: V2 = g > 200 ? [Q[0] / g, Q[1] / g] : [-tan[1], tan[0]];
    if (g <= 200 && u[1] > 0) u = [-u[0], -u[1]];
    const gMin = (rank >= 3 || rank === 0 ? 1100 : 1500) + half;
    const shift = placeGap(g, u, gMin) - g;
    // 加密、平移、按弧长加蜿蜒，只留图附近的几段
    let run: V2[] = [];
    const runs: V2[][] = [];
    let s = 0;
    for (let i = 0; i < local.length - 1; i++) {
      const a = local[i], b = local[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / 150));
      const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const w = (vnoise((s + len * t) / 2600, rank + 0.5, seed) - 0.5) * 600;
        const p: V2 = [a[0] + (b[0] - a[0]) * t + u[0] * shift + nx * w, a[1] + (b[1] - a[1]) * t + u[1] * shift + ny * w];
        if (box(p)) run.push(p);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      s += len;
    }
    const last = local[local.length - 1];
    const lp: V2 = [last[0] + u[0] * shift, last[1] + u[1] * shift];
    if (box(lp)) run.push(lp);
    if (run.length) runs.push(run);
    for (const line of runs) {
      if (line.length < 2) continue;
      waters.push({ line, half, code: rank === 1 || rank === 2 ? 'R' : 'W', name: rv.name, rank, u, dist: g });
    }
  }
  // 主次：大河在前，同级取近
  waters.sort((a, b) => (a.rank || 9) - (b.rank || 9) || a.dist - b.dist);

  const lakes: { c: V2; r: V2; name: string }[] = [];
  for (const lk of [...world.data.lakes, ...(world.data.pools ?? [])]) {
    if (!lk.xy) continue;
    const c: V2 = [lk.xy[0] * KM - P[0], lk.xy[1] * KM - P[1]];
    const r: V2 = [lk.r[0] * KM, lk.r[1] * KM];
    const dc = Math.hypot(c[0], c[1]);
    const k = Math.hypot(c[0] / r[0], c[1] / r[1]);
    const g = k <= 1 ? 0 : dc * (1 - 1 / k);
    const u: V2 = dc > 1 ? [c[0] / dc, c[1] / dc] : [0, -1];
    if (g > REACH) {
      if (g <= INLET_REACH) far.push({ name: lk.name, u, dist: g });
      continue;
    }
    const shift = placeGap(g, u, 900) - g;
    lakes.push({ c: [c[0] + u[0] * shift, c[1] + u[1] * shift], r, name: lk.name });
  }
  // 来水口：同名只留最近的一处，方向相近（45° 以内）的只留近的，最多三处
  far.sort((a, b) => a.dist - b.dist);
  const inlets: SiteInlet[] = [];
  for (const f of far) {
    if (inlets.length >= 3) break;
    if (inlets.some((x) => x.name === f.name || x.u[0] * f.u[0] + x.u[1] * f.u[1] > Math.SQRT1_2)) continue;
    inlets.push(f);
  }
  return { waters, lakes, inlets, primaryU: waters[0]?.u ?? null };
}

export interface SiteInfo {
  name: string;
  verdict: SiteVerdict;
}

export function generateSite(world: WorldMap, h: Hex, id: string, info: SiteInfo): PlanMapJSON {
  const c = world.cell(h)!;
  const seed = ((h.q * 92821) ^ (h.r * 68917)) & 0xffff;
  const [wx, wy] = world.world(c);
  const dirOf = (n: Hex): V2 => {
    const [nx, ny] = world.world(n);
    return unit([nx - wx, ny - wy]);
  };
  const nbrs: { cell: WorldCell; dir: V2 }[] = HEX_DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }))
    .map((n) => world.cell(n))
    .filter((n): n is WorldCell => !!n)
    .map((n) => ({ cell: n, dir: dirOf(n) }));

  // ---- 水：按真实河道、湖岸投影到城址 ----
  // 城址中心取府城真实位置（无府城则取格心）；江河的方位、走向、远近都照实，只有两处收放：
  // 城压在河上时把河推到岸边（城坐一岸），远在图外（REACH 以内）的河压缩到图边，好让城有水可引。
  const { waters, lakes: waterLakes, inlets, primaryU } = projectWaters(world, h, seed);
  const bankSide: V2 = primaryU ?? [0, -1];

  // 海：邻格方向的图边（海岸线只到格子精度）
  const seas = nbrs.filter((n) => n.cell.t === 'Q' || n.cell.t === 'O').map((n) => n.dir);
  // 山、丘：邻格方向起山；本格是丘陵时城中也有冈阜
  const mts = nbrs.filter((n) => n.cell.t === 'S' || n.cell.t === 'X').map((n) => n.dir);
  const hills = nbrs.filter((n) => n.cell.t === 'H').map((n) => n.dir);
  const selfHilly = c.t === 'H';

  // ---- 栅格 ----
  const size = HEX_M / SQRT3;
  /** 平面坐标（米）→ 所在格（立方坐标取整） */
  const toHexXY = ([x, y]: V2): [number, number] => {
    const fq = ((SQRT3 / 3) * x - y / 3) / size, fr = ((2 / 3) * y) / size, fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return [q, r];
  };
  const rMax = Math.floor(HALF_H / (1.5 * size));
  const rows: string[] = [], elevRows: string[] = [];
  let qMin = Infinity;
  const cells: { q: number; r: number; x: number; y: number }[][] = [];
  for (let r = -rMax; r <= rMax; r++) {
    const row: { q: number; r: number; x: number; y: number }[] = [];
    const q0 = Math.ceil(-HALF_W / (SQRT3 * size) - r / 2), q1 = Math.floor(HALF_W / (SQRT3 * size) - r / 2);
    for (let q = q0; q <= q1; q++) row.push({ q, r, x: SQRT3 * size * (q + r / 2), y: 1.5 * size * r });
    qMin = Math.min(qMin, q0);
    cells.push(row);
  }
  const terrain = new Map<string, string>();
  const elev = new Map<string, number>();
  for (const row of cells) {
    for (const p of row) {
      const pt: V2 = [p.x, p.y];
      const nx = p.x / HALF_W, ny = p.y / HALF_H;
      let code = 'T';
      let e = 3 + fbm(p.x / 2500, p.y / 2500, seed) * 6;
      // 山
      let rise = 0;
      for (const d of mts) {
        const along = nx * d[0] + ny * d[1];
        const n = fbm(p.x / 1600, p.y / 1600, seed + 31);
        rise = Math.max(rise, (along - 0.28 - (n - 0.5) * 0.5) * 260);
      }
      for (const d of hills) {
        const along = nx * d[0] + ny * d[1];
        const n = fbm(p.x / 1400, p.y / 1400, seed + 47);
        rise = Math.max(rise, (along - 0.42 - (n - 0.5) * 0.55) * 120);
      }
      if (selfHilly) {
        const n = fbm(p.x / 1300, p.y / 1300, seed + 59);
        rise = Math.max(rise, (n - 0.6) * 260);
      }
      if (rise > 0) e += rise;
      if (rise > 70) code = 'S';
      else if (rise > 18) code = 'H';
      // 水
      for (const d of seas) {
        const along = nx * d[0] + ny * d[1];
        if (along > 0.55 + (fbm(p.x / 1800, p.y / 1800, seed + 71) - 0.5) * 0.35) code = 'W';
      }
      for (const lk of waterLakes) {
        const k = Math.hypot((p.x - lk.c[0]) / lk.r[0], (p.y - lk.c[1]) / lk.r[1]);
        if (k < 1 + (fbm(p.x / 1500, p.y / 1500, seed + 83) - 0.5) * 0.25) code = 'W';
      }
      for (const w of waters) {
        if (polyDist(pt, w.line) < w.half) code = w.code;
      }
      if (code === 'T' && hash(p.q, p.r, seed + 5) > 0.965) code = 'G';
      if (code === 'R' || code === 'W') e = 0;
      if (code === 'S' && e < 60) e = 60;
      terrain.set(`${p.q},${p.r}`, code);
      elev.set(`${p.q},${p.r}`, e);
    }
  }

  // 山间小溪：从最高处流向主水面（若有山又有水）
  if (mts.length && waters.length) {
    let top: { q: number; r: number; x: number; y: number } | null = null, best = -1;
    for (const row of cells) for (const p of row) {
      const e = elev.get(`${p.q},${p.r}`)!;
      if (e > best && Math.abs(p.x) < HALF_W * 0.8 && Math.abs(p.y) < HALF_H * 0.8) {
        best = e;
        top = p;
      }
    }
    if (top) {
      const target = waters[0].line.reduce((m, q) => (Math.hypot(q[0] - top!.x, q[1] - top!.y) < Math.hypot(m[0] - top!.x, m[1] - top!.y) ? q : m));
      const line: V2[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const w = (vnoise(t * 3, 7.5, seed) - 0.5) * 900 * Math.sin(Math.PI * t);
        const dx = target[0] - top.x, dy = target[1] - top.y, l = Math.hypot(dx, dy) || 1;
        line.push([top.x + dx * t - (dy / l) * w, top.y + dy * t + (dx / l) * w]);
      }
      for (const row of cells) for (const p of row) {
        const k = `${p.q},${p.r}`;
        if (terrain.get(k) !== 'R' && polyDist([p.x, p.y], line) < 70) {
          terrain.set(k, 'W');
          elev.set(k, 0);
        }
      }
    }
  }

  // 来水口：沿方向 u 从城心走到图边，取最外一格（不是水面才开），地形记作 I（天然水源，见 PLAN_TERRAIN）
  const inletLabels: { hex: [number, number]; name: string }[] = [];
  for (const inl of inlets) {
    const e = edgeDist(inl.u);
    let hit: { q: number; r: number } | null = null;
    for (let t = e * 0.6; t <= e * 1.1; t += size * 0.5) {
      const [q, r] = toHexXY([inl.u[0] * t, inl.u[1] * t]);
      if (terrain.has(`${q},${r}`)) hit = { q, r };
      else if (hit) break;
    }
    if (!hit) continue;
    const k = `${hit.q},${hit.r}`;
    if (terrain.get(k) === 'R' || terrain.get(k) === 'W') continue;
    terrain.set(k, 'I');
    elev.set(k, 0);
    inletLabels.push({ hex: [hit.q, hit.r], name: `${inl.name}来水 · ${Math.round(inl.dist / LI_M)} 里` });
  }

  const eMax = Math.max(...elev.values());
  const step = Math.max(2, Math.ceil(eMax / 35));
  for (const row of cells) {
    let s = '', es = '';
    const first = row[0].q;
    for (let q = qMin; q < first; q++) {
      s += '.';
      es += '0';
    }
    for (const p of row) {
      const k = `${p.q},${p.r}`;
      s += terrain.get(k);
      es += DIGITS[Math.min(35, Math.round(elev.get(k)! / step))];
    }
    rows.push(s);
    elevRows.push(es);
  }
  const width = Math.max(...rows.map((r) => r.length));
  for (let i = 0; i < rows.length; i++) {
    rows[i] = rows[i].padEnd(width, '.');
    elevRows[i] = elevRows[i].padEnd(width, '0');
  }

  // 地名：河名标在河道中段；山标在山最高处
  const labels: PlanMapJSON['labels'] = [...inletLabels];
  const toHex = ([x, y]: V2): [number, number] => {
    const fq = ((SQRT3 / 3) * x - y / 3) / size, fr = ((2 / 3) * y) / size;
    return [Math.round(fq), Math.round(fr)];
  };
  // 每条河标一次，标在图内那段的中间；城边小湖标在湖心
  const named = new Set<string>();
  waters.forEach((w, i) => {
    if (named.has(w.name)) return;
    const inside = w.line.filter((p) => Math.abs(p[0]) < HALF_W * 0.9 && Math.abs(p[1]) < HALF_H * 0.9);
    if (!inside.length) return;
    named.add(w.name);
    labels.push({ hex: toHex(inside[Math.floor(inside.length * (0.35 + (i % 3) * 0.15))]), name: w.name });
  });
  for (const lk of waterLakes) {
    if (Math.abs(lk.c[0]) < HALF_W * 0.9 && Math.abs(lk.c[1]) < HALF_H * 0.9) labels.push({ hex: toHex(lk.c), name: lk.name });
  }
  if (mts.length || hills.length) {
    let best: [number, number] | null = null, be = -1;
    for (const [k, e] of elev) if (e > be) {
      be = e;
      best = k.split(',').map(Number) as [number, number];
    }
    const near = world.data.ranges.map((rg) => ({ rg, d: WorldMap.dist(c, { q: rg.hex[0], r: rg.hex[1] }) })).sort((a, b) => a.d - b.d)[0];
    if (best) labels.push({ hex: best, name: near && near.d <= 3 ? near.rg.name : mts.length ? '后山' : '冈阜' });
  }

  const v = info.verdict;
  return {
    id,
    name: info.name,
    subtitle: `${c.prov ?? ''} · 形胜 ${v.total}（${v.grade}）${waters[0] ? ` · 临${waters[0].name}` : ''}`,
    kind: 'sketch',
    hexAcross: HEX_M,
    terrain: { qMin, rMin: -rMax, rows },
    elev: { rows: elevRows, step },
    labels,
    terrainNames: waters[0] ? { R: waters[0].name } : undefined,
    note: `城址地形由天下舆图所在格（${c.q}, ${c.r}）推演：江河湖泊按真实河道投影，山海按邻格方位，示意级。${waters[0] ? `${waters[0].name}在城${DIR8[Math.round(((Math.atan2(bankSide[0], bankSide[1]) * 180) / Math.PI + 360) / 45) % 8]}。` : ''}`,
  };
}
