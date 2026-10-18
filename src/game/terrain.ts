// 地形代码。与 tools/prefill_terrain.py 保持一致。

import { hexKey } from '../scene/hex';

export interface TerrainDef {
  code: string;
  name: string;
  /** 标定工具叠加色 */
  color: [number, number, number];
}

export const TERRAINS: TerrainDef[] = [
  { code: 'R', name: '大江', color: [40, 90, 200] },
  { code: 'W', name: '河塘', color: [90, 160, 230] },
  { code: 'M', name: '护城河', color: [0, 190, 210] },
  { code: 'S', name: '山', color: [30, 110, 40] },
  { code: 'T', name: '田野', color: [220, 200, 60] },
  { code: 'G', name: '村落', color: [170, 100, 60] },
  { code: 'B', name: '城内坊巷', color: [200, 60, 60] },
  { code: 'C', name: '城墙', color: [40, 40, 40] },
];

export const TERRAIN_BY_CODE = new Map(TERRAINS.map((t) => [t.code, t]));
/** 数据贴图里的地形索引：0 = 未标注，1.. = TERRAINS 下标 + 1 */
export const terrainIndex = (code: string | undefined) => (code ? TERRAINS.findIndex((t) => t.code === code) + 1 : 0);

export interface TerrainJSON {
  qMin: number;
  rMin: number;
  rows: string[];
  note?: string;
}

export function decodeTerrain(t: TerrainJSON | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!t) return map;
  t.rows.forEach((row, ri) => {
    for (let qi = 0; qi < row.length; qi++) {
      const c = row[qi];
      if (c !== '.') map.set(hexKey({ q: t.qMin + qi, r: t.rMin + ri }), c);
    }
  });
  return map;
}

export function encodeTerrain(map: Map<string, string>, note?: string): TerrainJSON {
  let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
  for (const key of map.keys()) {
    const [q, r] = key.split(',').map(Number);
    qMin = Math.min(qMin, q); qMax = Math.max(qMax, q);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
  }
  if (!isFinite(qMin)) return { qMin: 0, rMin: 0, rows: [], note };
  const rows: string[] = [];
  for (let r = rMin; r <= rMax; r++) {
    let row = '';
    for (let q = qMin; q <= qMax; q++) row += map.get(hexKey({ q, r })) ?? '.';
    rows.push(row);
  }
  return note ? { qMin, rMin, rows, note } : { qMin, rMin, rows };
}
