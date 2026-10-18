// 关卡数据：读入 data/{city}.json，求单应性，把地点吸附到六边形格上，生成网格范围。

import { applyH, invertH, solveHomography, type Mat3, type Vec2 } from '../scene/homography';
import { hexKey, hexToWorld, SQRT3, worldToHex, type Hex } from '../scene/hex';
import { decodeTerrain, TERRAIN_BY_CODE, type TerrainJSON } from './terrain';

export type SiteKind = 'gate' | 'landmark' | 'temple' | 'office' | 'water' | 'mountain';

export const SITE_KIND_LABEL: Record<SiteKind, string> = {
  gate: '城门',
  landmark: '地标',
  temple: '坛庙',
  office: '衙署',
  water: '水系',
  mountain: '山',
};

export interface LevelJSON {
  id: string;
  name: string;
  subtitle: string;
  map: string;
  /** imageSize：标定时底图的像素尺寸。所有 img 坐标都在这个尺寸下；换更高分辨率的底图时按比例自动换算 */
  calibration: { imageSize?: Vec2; points: { img: Vec2; world: Vec2; label?: string }[] };
  /** bounds：可选的世界坐标范围 [xmin, ymin, xmax, ymax]，透视强的底图用来截掉远处 */
  grid: { hexAcross: number; bounds?: [number, number, number, number] };
  lore: { id: string; name: string }[];
  sites: SiteJSON[];
  terrain?: TerrainJSON;
  /** 本关对邻格点缀的覆盖：地形代码 → 资产 ID 列表（例如北方城市用北方民居） */
  props?: Record<string, string[]>;
  /** 本关对地形的专名，例如襄阳的大江 = 汉江 */
  terrainNames?: Record<string, string>;
  labels?: { hex: Vec2; name: string }[];
  /** 基因点亮规则：看完哪些地点后点亮。 */
  genes?: Record<string, GeneRule>;
}

export interface SiteJSON {
  id: string;
  name: string;
  kind: SiteKind;
  /** 地点在底图上的像素位置（对着画面里的建筑点选） */
  img: Vec2;
  /** 3D 地块里的主体资产 ID（对应 3D建模指南 的编号）；P4 前用概念图立牌顶替 */
  model?: string;
  /** 主体绕竖轴的朝向（度）。给出时优先于「顺着城墙」的自动朝向，用于城角这类特殊构件 */
  rotY?: number;
  cards: string[];
}

export interface GeneRule {
  /** any：看完任一；all：全部看完；atLeast：至少看完 n 个 */
  rule: 'any' | 'all' | 'atLeast';
  n?: number;
  sites: string[];
}

export interface Site {
  id: string;
  name: string;
  kind: SiteKind;
  model?: string;
  rotY?: number;
  cards: string[];
  hex: Hex;
  /** 格中心在底图上的像素位置（图标锚点）。 */
  img: Vec2;
}

export interface Level {
  data: LevelJSON;
  imageSize: Vec2;
  imgToWorld: Mat3;
  worldToImg: Mat3;
  hexSize: number;
  /** 网格范围（轴坐标包围盒）。 */
  qMin: number;
  rMin: number;
  cols: number;
  rows: number;
  /** 中心落在底图内的格。 */
  cells: Set<string>;
  sites: Site[];
  siteByHex: Map<string, Site>;
  terrain: Map<string, string>;
  labels: Map<string, string>;
  /** 数据问题（地点重叠、落在底图外等），标定工具会显示出来 */
  issues: string[];
}

/** 数据里的 img 坐标 → 当前底图像素的缩放比。 */
export function imageScale(data: LevelJSON, imageSize: Vec2): number {
  const base = data.calibration.imageSize;
  return base ? imageSize[0] / base[0] : 1;
}

export function buildLevel(data: LevelJSON, imageSize: Vec2): Level {
  const k = imageScale(data, imageSize);
  const sc = ([x, y]: Vec2): Vec2 => [x * k, y * k];
  const pts = data.calibration.points;
  const imgToWorld = solveHomography(pts.map((p) => sc(p.img)), pts.map((p) => p.world));
  const worldToImg = invertH(imgToWorld);
  const hexSize = data.grid.hexAcross / SQRT3;
  const [W, H] = imageSize;

  const insideImage = ([x, y]: Vec2) => x >= 0 && y >= 0 && x <= W && y <= H;
  // 在底图边缘采样，得到世界坐标包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const N = 16;
  for (let i = 0; i <= N; i++) {
    for (const p of [[(W * i) / N, 0], [(W * i) / N, H], [0, (H * i) / N], [W, (H * i) / N]] as Vec2[]) {
      const [x, y] = applyH(imgToWorld, p);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const bd = data.grid.bounds;
  if (bd) {
    minX = Math.max(minX, bd[0]); minY = Math.max(minY, bd[1]);
    maxX = Math.min(maxX, bd[2]); maxY = Math.min(maxY, bd[3]);
  }
  const corners = [worldToHex([minX, minY], hexSize), worldToHex([maxX, minY], hexSize),
    worldToHex([minX, maxY], hexSize), worldToHex([maxX, maxY], hexSize)];
  const qMin = Math.min(...corners.map((h) => h.q)) - 2, qMax = Math.max(...corners.map((h) => h.q)) + 2;
  const rMin = Math.min(...corners.map((h) => h.r)) - 1, rMax = Math.max(...corners.map((h) => h.r)) + 1;

  // 中心离底图边缘至少留出一点余量的格才算有效
  const margin = 0.02 * Math.min(W, H);
  const cells = new Set<string>();
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      const wc = hexToWorld({ q, r }, hexSize);
      const bd = data.grid.bounds;
      if (bd && (wc[0] < bd[0] || wc[1] < bd[1] || wc[0] > bd[2] || wc[1] > bd[3])) continue;
      const [x, y] = applyH(worldToImg, wc);
      if (insideImage([x, y]) && x > margin && y > margin && x < W - margin && y < H - margin) cells.add(hexKey({ q, r }));
    }
  }

  const issues: string[] = [];
  const sites: Site[] = [];
  const siteByHex = new Map<string, Site>();
  for (const s of data.sites) {
    const hex = worldToHex(applyH(imgToWorld, sc(s.img)), hexSize);
    const key = hexKey(hex);
    if (siteByHex.has(key)) {
      issues.push(`地点「${s.name}」与「${siteByHex.get(key)!.name}」落在同一格 ${key}，已忽略「${s.name}」`);
      continue;
    }
    if (!cells.has(key)) issues.push(`地点「${s.name}」所在格 ${key} 不在底图有效范围内`);
    const site: Site = { ...s, hex, img: applyH(worldToImg, hexToWorld(hex, hexSize)) };
    sites.push(site);
    siteByHex.set(key, site);
  }

  return {
    data, imageSize, imgToWorld, worldToImg, hexSize,
    qMin, rMin, cols: qMax - qMin + 1, rows: rMax - rMin + 1,
    cells, sites, siteByHex,
    terrain: decodeTerrain(data.terrain),
    labels: new Map((data.labels ?? []).map((l) => [hexKey({ q: l.hex[0], r: l.hex[1] }), l.name])),
    issues,
  };
}

export function hexAtImage(level: Level, img: Vec2): Hex {
  return worldToHex(applyH(level.imgToWorld, img), level.hexSize);
}

export function isCell(level: Level, h: Hex): boolean {
  return level.cells.has(hexKey(h));
}

export function terrainName(level: Level, code: string | undefined): string | undefined {
  if (!code) return undefined;
  return level.data.terrainNames?.[code] ?? TERRAIN_BY_CODE.get(code)?.name;
}
