// 尖顶六边形网格（同文明 6），轴坐标 (q, r)。世界坐标 x 向东、y 向北，单位米。
// size 为外接圆半径；对边距离 = size * √3。

import type { Vec2 } from './homography';

export const SQRT3 = Math.sqrt(3);

export interface Hex {
  q: number;
  r: number;
}

export const hexKey = (h: Hex) => `${h.q},${h.r}`;

export function hexToWorld(h: Hex, size: number): Vec2 {
  return [size * SQRT3 * (h.q + h.r / 2), size * 1.5 * h.r];
}

export function worldToHex([x, y]: Vec2, size: number): Hex {
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

function hexRound(fq: number, fr: number): Hex {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

export const HEX_DIRS: Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function neighbors(h: Hex): Hex[] {
  return HEX_DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}
