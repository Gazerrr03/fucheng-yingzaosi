// 最小的 4×4 矩阵工具，列主序（与 WebGL 一致）。

export type Mat4 = Float32Array;
export type V3 = [number, number, number];

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return Float32Array.from([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): Mat4 {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return Float32Array.from([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

/** NDC 平移（用于把画面主体挪到浮窗左侧的空间里）。 */
export function ndcShift(dx: number, dy = 0): Mat4 {
  return Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, 0, 1]);
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** T(base) · Ry(rotY) · S(s) · T(-pivot)：把模型从自身坐标摆到场景里。 */
export function placeMatrix(base: V3, rotY: number, s: number, pivot: V3): Mat4 {
  const c = Math.cos(rotY) * s, n = Math.sin(rotY) * s;
  const [px, py, pz] = pivot;
  return Float32Array.from([
    c, 0, -n, 0,
    0, s, 0, 0,
    n, 0, c, 0,
    base[0] - (c * px + n * pz), base[1] - s * py, base[2] - (-n * px + c * pz), 1,
  ]);
}

/** 模型矩阵左上 3×3 的逆转置（法线矩阵）。 */
export function normalMatrix(m: Mat4): Float32Array {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // 逆矩阵的转置 = 余子式矩阵 / det（列主序存放）
  return Float32Array.from([
    A / det, B / det, C / det,
    -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det,
  ]);
}

/** 正交投影（列主序），用于方向光阴影。 */
export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  return Float32Array.from([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ]);
}
