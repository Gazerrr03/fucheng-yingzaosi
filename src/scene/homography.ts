// 单应性矩阵：把斜俯视底图上的像素坐标映射到地面世界坐标（米），以及反向映射。
// 矩阵按行主序存 9 个数，h[8] 固定为 1。

export type Vec2 = [number, number];
export type Mat3 = Float64Array;

/** 用 4 组以上对应点求解 src → dst 的单应性（最小二乘，DLT，h33 = 1）。 */
export function solveHomography(src: Vec2[], dst: Vec2[]): Mat3 {
  if (src.length < 4 || src.length !== dst.length) throw new Error('需要至少 4 组对应点');
  // 法方程 AᵀA h = Aᵀb，8 个未知数
  const ata = Array.from({ length: 8 }, () => new Float64Array(8));
  const atb = new Float64Array(8);
  const addRow = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < src.length; k++) {
    const [x, y] = src[k];
    const [u, v] = dst[k];
    addRow([x, y, 1, 0, 0, 0, -x * u, -y * u], u);
    addRow([0, 0, 0, x, y, 1, -x * v, -y * v], v);
  }
  const h = gaussSolve(ata, atb);
  return Float64Array.from([...h, 1]);
}

function gaussSolve(a: Float64Array[], b: Float64Array): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('对应点退化，无法求解单应性');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

export function applyH(h: Mat3, p: Vec2): Vec2 {
  const [x, y] = p;
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invertH(h: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i, B = -(d * j - f * g), C = d * i - e * g;
  const det = a * A + b * B + c * C;
  const inv = Float64Array.from([
    A, -(b * j - c * i), b * f - c * e,
    B, a * j - c * g, -(a * f - c * d),
    C, -(a * i - b * g), a * e - b * d,
  ]);
  const s = inv[8] / det;
  for (let k = 0; k < 9; k++) inv[k] /= det * s;
  return inv;
}

/** 转成 GLSL mat3（列主序）用的 Float32Array。 */
export function toGLMat3(h: Mat3): Float32Array {
  return Float32Array.from([h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]]);
}
