// 城址生成：由天下舆图上的一格（约 28 公里）推演出城级营建地图（一格 200 米，约 11 × 8 公里）。
// 本格有江河穿过 → 江从入口方向流向出口方向，偏开城心，让城坐在一岸（多取北岸，向阳）；
// 邻格是江河、湖、海 → 在那一侧的图边画出水面；邻格是山、丘 → 那一侧起山。地形噪声按格子坐标定种子，同一格每次生成相同。

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

/** 方向单位向量 → 图边上的点（矩形 HALF_W × HALF_H，略出界） */
function edgePoint([dx, dy]: V2): V2 {
  const k = Math.min(HALF_W / Math.max(1e-6, Math.abs(dx)), HALF_H / Math.max(1e-6, Math.abs(dy))) * 1.08;
  return [dx * k, dy * k];
}

/** 一条过图的河：入口 → 偏开城心的中段 → 出口，二次贝塞尔采样，带一点蜿蜒 */
function riverLine(inDir: V2, outDir: V2, offset: V2, seed: number): V2[] {
  const a = edgePoint(inDir), b = edgePoint(outDir);
  const mid: V2 = [offset[0], offset[1]];
  // 贝塞尔控制点：让曲线经过 mid
  const ctrl: V2 = [2 * mid[0] - (a[0] + b[0]) / 2, 2 * mid[1] - (a[1] + b[1]) / 2];
  const pts: V2[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * ctrl[0] + t * t * b[0];
    const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * ctrl[1] + t * t * b[1];
    // 法向蜿蜒
    const tx = 2 * (1 - t) * (ctrl[0] - a[0]) + 2 * t * (b[0] - ctrl[0]);
    const ty = 2 * (1 - t) * (ctrl[1] - a[1]) + 2 * t * (b[1] - ctrl[1]);
    const l = Math.hypot(tx, ty) || 1;
    const w = (vnoise(t * 5, 0.5, seed) - 0.5) * 900 * Math.sin(Math.PI * t);
    pts.push([x - (ty / l) * w, y + (tx / l) * w]);
  }
  return pts;
}

const unit = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

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

  // ---- 水：穿境的河 ----
  type Water = { line: V2[]; half: number; code: 'R' | 'W'; name: string };
  const waters: Water[] = [];
  let bankSide: V2 = [0, -1]; // 城在河的哪一岸：默认北岸（河在城南）
  for (const rv of world.data.rivers) {
    const i = rv.path.findIndex(([q, r]) => q === h.q && r === h.r);
    if (i < 0) continue;
    const prev = rv.path[i - 1], next = rv.path[i + 1];
    const inDir: V2 = prev ? dirOf({ q: prev[0], r: prev[1] }) : next ? (dirOf({ q: next[0], r: next[1] }).map((v) => -v) as V2) : [-1, 0];
    const outDir: V2 = next ? dirOf({ q: next[0], r: next[1] }) : ([-inDir[0], -inDir[1]] as V2);
    // 河道方向的法线，取偏南的一侧放河，城在北岸
    const flow = unit([outDir[0] - inDir[0], outDir[1] - inDir[1]]);
    let nrm: V2 = [-flow[1], flow[0]];
    if (nrm[1] > 0) nrm = [-nrm[0], -nrm[1]];
    const rank = rv.rank === 'canal' ? 0 : rv.rank;
    const half = rank === 1 ? 420 : rank === 2 ? 240 : 130;
    const off = waters.length === 0 ? 1500 + half : 600;
    const line = riverLine(inDir, outDir, [nrm[0] * off, nrm[1] * off], seed + waters.length * 17);
    if (!waters.length) bankSide = nrm;
    waters.push({ line, half, code: rank === 1 || rank === 2 ? 'R' : 'W', name: rv.name });
  }
  // 邻格的河（本格没有）：贴着那一侧图边走
  if (!waters.length) {
    const rvN = nbrs.filter((n) => n.cell.river !== undefined).sort((a, b) => (a.cell.river || 9) - (b.cell.river || 9))[0];
    if (rvN) {
      const d = rvN.dir;
      const side: V2 = [-d[1], d[0]];
      const base: V2 = [d[0] * HALF_W * 0.62, d[1] * HALF_H * 0.62];
      const a: V2 = [base[0] + side[0] * HALF_W * 1.4, base[1] + side[1] * HALF_W * 1.4];
      const b: V2 = [base[0] - side[0] * HALF_W * 1.4, base[1] - side[1] * HALF_W * 1.4];
      const line: V2[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const w = (vnoise(t * 4, 2.5, seed) - 0.5) * 700;
        line.push([a[0] + (b[0] - a[0]) * t + d[0] * w, a[1] + (b[1] - a[1]) * t + d[1] * w]);
      }
      const rank = rvN.cell.river!;
      waters.push({ line, half: rank === 1 ? 380 : 200, code: rank === 1 || rank === 2 ? 'R' : 'W', name: rvN.cell.riverNames[0] });
      bankSide = [-d[0], -d[1]];
    }
  }

  // 湖、海：邻格方向的图边
  const lakes = nbrs.filter((n) => n.cell.t === 'W').map((n) => n.dir);
  const seas = nbrs.filter((n) => n.cell.t === 'Q' || n.cell.t === 'O').map((n) => n.dir);
  // 山、丘：邻格方向起山；本格是丘陵时城中也有冈阜
  const mts = nbrs.filter((n) => n.cell.t === 'S' || n.cell.t === 'X').map((n) => n.dir);
  const hills = nbrs.filter((n) => n.cell.t === 'H').map((n) => n.dir);
  const selfHilly = c.t === 'H';

  // ---- 栅格 ----
  const size = HEX_M / SQRT3;
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
      for (const d of lakes) {
        const cx = d[0] * HALF_W * 0.95, cy = d[1] * HALF_H * 0.95;
        const k = Math.hypot((p.x - cx) / (HALF_W * 0.55), (p.y - cy) / (HALF_H * 0.6));
        if (k < 0.9 + (fbm(p.x / 1500, p.y / 1500, seed + 83) - 0.5) * 0.4) code = 'W';
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
  const labels: PlanMapJSON['labels'] = [];
  const toHex = ([x, y]: V2): [number, number] => {
    const fq = ((SQRT3 / 3) * x - y / 3) / size, fr = ((2 / 3) * y) / size;
    return [Math.round(fq), Math.round(fr)];
  };
  waters.forEach((w, i) => {
    const p = w.line[Math.floor(w.line.length * (0.3 + i * 0.25))];
    if (Math.abs(p[0]) < HALF_W && Math.abs(p[1]) < HALF_H) labels.push({ hex: toHex(p), name: w.name });
  });
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
    note: `城址地形由天下舆图所在格（${c.q}, ${c.r}）及六个邻格推演生成，示意级。${bankSide[1] < 0 ? '江河在城南，城居北岸。' : ''}`,
  };
}
