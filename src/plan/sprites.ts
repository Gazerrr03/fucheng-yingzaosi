// 营建视图的构件精灵：把 glb 模型离屏用卡通着色渲染成固定斜俯视角的位图，planView 按格贴图。
// 视角与 planView 的投影一致：正南看向正北，俯角 asin(TILT)，地面南北方向压扁为 TILT。
// 每张精灵生成一次后缓存，并预先缩出一串 1/2、1/4… 的小图，缩放时取最接近的一张，免得每帧大比例缩小。

import { createProgram, type Program } from '../render/gl';
import { loadGLB, type Model } from '../render/gltf';
import { multiply, normalMatrix, placeMatrix, type Mat4, type V3 } from '../render/math';
import { OUTLINE_FS, OUTLINE_VS, TOON_FS, TOON_VS } from '../view/modelShaders';

/** 精灵分辨率：一格对边宽度对应的像素数（最大一级）。最近镜头一格约 120 CSS 像素 × DPR 2。 */
export const SPRITE_PX_PER_HEX = 256;
/** 描边宽度（精灵像素，最大一级） */
const OUTLINE_PX = 2.2;
/** 夕照：太阳在西南偏西、较低，西侧受光 */
const SUN = norm3([-0.72, 0.52, 0.46]);

export interface SpriteSpec {
  model: string;
  /** 模型水平最长边占一格对边宽度的比例 */
  fit: number;
  /** 绕竖轴旋转（弧度）；0 = 模型正面（+Z）朝南 */
  yaw?: number;
  /** 半段墙：沿模型 X 轴拉伸到 len（格宽比例），高、厚单独给；整体从格心沿 yaw 方向挪出半段。
   *  flip = 模型再转 180°（让带垛口的正面朝城外），位置不变。 */
  halfWall?: { len: number; height: number; thick: number; flip?: boolean };
  /** 是否烘一块接地阴影 */
  shadow?: boolean;
  /** 同一模型摆多份（格宽单位的 [东, 南] 偏移），比如两排街屋 */
  copies?: [number, number][];
}

export interface Sprite {
  /** levels[0] 是最大一级，往后每级宽高减半 */
  levels: HTMLCanvasElement[];
  /** 格心（模型原点、地面）在最大一级里的像素位置 */
  ax: number;
  ay: number;
  w: number;
  h: number;
}

export class PlanSprites {
  private gl: WebGL2RenderingContext | null = null;
  private canvas = document.createElement('canvas');
  private toon!: Program;
  private outline!: Program;
  private models = new Map<string, Promise<Model | null>>();
  private sprites = new Map<string, Sprite | null>();
  private pending = new Set<string>();
  private failed = false;
  private queue: Promise<void> = Promise.resolve();
  /** 有新精灵生成好时通知（视图据此重画） */
  readonly listeners = new Set<() => void>();

  /** 取精灵；还没生成就排队生成，生成好之后调用 onReady。返回 null 表示暂不可用（调用方用程序画法兜底）。 */
  get(spec: SpriteSpec): Sprite | null {
    const key = specKey(spec);
    const s = this.sprites.get(key);
    if (s !== undefined) return s;
    if (this.failed) return null;
    if (!this.pending.has(key)) {
      this.pending.add(key);
      // 串行生成：共用一个 WebGL 画布
      this.queue = this.queue.then(async () => {
        const sprite = await this.build(spec).catch((err) => {
          console.warn(`[营建精灵 ${key}] 生成失败，改用程序画法：`, err);
          return null;
        });
        this.sprites.set(key, sprite);
        this.pending.delete(key);
        if (sprite) for (const f of this.listeners) f();
      });
    }
    return null;
  }

  /** 预热：先把常用精灵排进队列 */
  warm(specs: SpriteSpec[]): void {
    for (const s of specs) this.get(s);
  }

  private init(): WebGL2RenderingContext {
    if (this.gl) return this.gl;
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) {
      this.failed = true;
      throw new Error('WebGL2 不可用');
    }
    this.gl = gl;
    this.toon = createProgram(gl, TOON_VS, TOON_FS);
    this.outline = createProgram(gl, OUTLINE_VS, OUTLINE_FS);
    this.canvas.addEventListener('webglcontextlost', () => {
      this.failed = true;
    });
    return gl;
  }

  private model(id: string): Promise<Model | null> {
    let p = this.models.get(id);
    if (!p) {
      p = loadGLB(this.init(), `${import.meta.env.BASE_URL}assets/models/${id}.glb`).catch((err) => {
        console.warn(`[营建精灵] 模型 ${id} 加载失败：`, err);
        return null;
      });
      this.models.set(id, p);
    }
    return p;
  }

  private async build(spec: SpriteSpec): Promise<Sprite | null> {
    const gl = this.init();
    const model = await this.model(spec.model);
    if (!model) return null;
    const R = SPRITE_PX_PER_HEX;

    // ---- 摆放：单位为「格宽」，原点 = 格心地面 ----
    const ex = model.max[0] - model.min[0], ey = model.max[1] - model.min[1], ez = model.max[2] - model.min[2];
    const pivot: V3 = [(model.min[0] + model.max[0]) / 2, model.min[1], (model.min[2] + model.max[2]) / 2];
    const yaw = spec.yaw ?? 0;
    let place: Mat4;
    const copies = spec.copies ?? [[0, 0]];
    if (spec.halfWall) {
      // 沿模型 X 拉到 len，高度、厚度单独定
      const { len, height, thick, flip } = spec.halfWall;
      const sx = len / (ex || 1), sy = height / (ey || 1), sz = thick / (ez || 1);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      // 半段的中点在格心往 yaw 方向挪 len/2 处（世界 x 东，z 南：方向 (cos, -sin)）
      const base: V3 = [(c * len) / 2, 0, (-s * len) / 2];
      place = multiply(placeMatrix(base, yaw + (flip ? Math.PI : 0), 1, [0, 0, 0]), scaleAbout([sx, sy, sz], pivot));
    } else {
      const extent = Math.max(ex, ez) || 1;
      place = placeMatrix([0, 0, 0], yaw, spec.fit / extent, pivot);
    }
    const places = copies.map(([dx, dz]) => multiply(translate(dx, 0, dz), place));
    const parts = places.flatMap((pl) => model.primitives.map((prim) => {
      const m = multiply(pl, prim.matrix);
      return { prim, m, n: normalMatrix(m) };
    }));

    // ---- 相机：正交，从南往北看，俯角 asin(TILT) ----
    const pitch = Math.asin(0.62);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 视图基：右 = +X，上 = (0, cp, -sp)，朝向相机 = (0, sp, cp)
    const view = (p: V3): [number, number, number] => [p[0], p[1] * cp - p[2] * sp, p[1] * sp + p[2] * cp];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, d0 = Infinity, d1 = -Infinity;
    const corners = (m: Mat4, lmin: number[], lmax: number[]) => {
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? lmax[0] : lmin[0], y = i & 2 ? lmax[1] : lmin[1], z = i & 4 ? lmax[2] : lmin[2];
        const w: V3 = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        const [vx, vy, vd] = view(w);
        x0 = Math.min(x0, vx); x1 = Math.max(x1, vx);
        y0 = Math.min(y0, vy); y1 = Math.max(y1, vy);
        d0 = Math.min(d0, vd); d1 = Math.max(d1, vd);
      }
    };
    // 地面占地（世界 x、z 范围），阴影按它画
    let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
    for (const pl of places) {
      corners(pl, model.min, model.max);
      for (let i = 0; i < 4; i++) {
        const x = i & 1 ? model.max[0] : model.min[0], z = i & 2 ? model.max[2] : model.min[2];
        const wx = pl[0] * x + pl[8] * z + pl[12], wz = pl[2] * x + pl[10] * z + pl[14];
        fx0 = Math.min(fx0, wx); fx1 = Math.max(fx1, wx);
        fz0 = Math.min(fz0, wz); fz1 = Math.max(fz1, wz);
      }
    }
    // 阴影：占地外扩一圈、往东（背光一侧）挪一点的圆角块
    const pad = 0.06, shift = 0.04;
    const sh = { x0: fx0 - pad + shift, x1: fx1 + pad + shift, z0: fz0 - pad * 0.5, z1: fz1 + pad };
    if (spec.shadow) {
      x0 = Math.min(x0, sh.x0); x1 = Math.max(x1, sh.x1);
      y0 = Math.min(y0, -sh.z1 * sp); y1 = Math.max(y1, -sh.z0 * sp);
    }
    const margin = (OUTLINE_PX + 3) / R;
    x0 -= margin; x1 += margin; y0 -= margin; y1 += margin;
    const W = Math.ceil((x1 - x0) * R), H = Math.ceil((y1 - y0) * R);
    if (W < 2 || H < 2 || W > 4096 || H > 4096) return null;

    // 列主序正交 · 视图矩阵：把视图坐标 [x0,x1]×[y0,y1] 映射到 NDC
    const ax = 2 / (x1 - x0), bx = -(x1 + x0) / (x1 - x0);
    const ay = 2 / (y1 - y0), by = -(y1 + y0) / (y1 - y0);
    const dd = d1 - d0 + 2, az = -2 / dd, bz = 1 + (2 * (d0 - 1)) / dd;
    // NDC z = az * vd + bz（离相机越近 vd 越大，深度越小）
    const viewProj = Float32Array.from([
      ax, 0, 0, 0,
      0, ay * cp, az * sp, 0,
      0, -ay * sp, az * cp, 0,
      bx, by, bz, 1,
    ]);
    // 着色器按相机距离算描边宽度：把「眼睛」放在很远处，距离近似恒定
    const D = 1000;
    const eye: V3 = [(x0 + x1) / 2, sp * D, cp * D];
    const outlineK = OUTLINE_PX / R / D;

    this.canvas.width = W;
    this.canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    const t = this.toon;
    gl.useProgram(t.handle);
    gl.uniformMatrix4fv(t.u.uViewProj, false, viewProj);
    gl.uniform3f(t.u.uSun, ...SUN);
    gl.uniform3f(t.u.uEye, ...eye);
    gl.uniform3f(t.u.uFogColor, 0.9, 0.87, 0.8);
    gl.uniform2f(t.u.uFogRange, 1e6, 2e6);
    gl.uniform1i(t.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const { prim, m, n } of parts) {
      gl.uniformMatrix4fv(t.u.uModel, false, m);
      gl.uniformMatrix3fv(t.u.uNormalMat, false, n);
      gl.uniform4f(t.u.uColor, ...prim.color);
      gl.uniform1i(t.u.uHasTex, prim.texture ? 1 : 0);
      if (prim.texture) gl.bindTexture(gl.TEXTURE_2D, prim.texture);
      drawPrim(gl, prim);
    }
    const o = this.outline;
    gl.useProgram(o.handle);
    gl.uniformMatrix4fv(o.u.uViewProj, false, viewProj);
    gl.uniform3f(o.u.uEye, ...eye);
    gl.uniform1f(o.u.uOutlineK, outlineK);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    for (const { prim, m, n } of parts) {
      gl.uniformMatrix4fv(o.u.uModel, false, m);
      gl.uniformMatrix3fv(o.u.uNormalMat, false, n);
      drawPrim(gl, prim);
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);

    // ---- 拷到 2D 画布：先画阴影，再叠模型 ----
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;
    const ox = -x0 * R, oy = y1 * R; // 格心在画布里的像素位置
    if (spec.shadow) {
      // 地面 (x, z) → 画布 (ox + x·R, oy + z·sp·R)
      const rx = sh.x0 * R + ox, ry = oy + sh.z0 * sp * R;
      const rw = (sh.x1 - sh.x0) * R, rh = (sh.z1 - sh.z0) * sp * R;
      ctx.save();
      ctx.filter = `blur(${Math.round(R * 0.025)}px)`;
      ctx.fillStyle = 'rgba(70,58,66,0.30)';
      ctx.beginPath();
      ctx.roundRect(rx + R * 0.02, ry + R * 0.015, rw - R * 0.04, rh - R * 0.03, R * 0.05);
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(this.canvas, 0, 0);

    const levels = [out];
    while (levels[levels.length - 1].width > 8 && levels[levels.length - 1].height > 8) {
      const prev = levels[levels.length - 1];
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(prev.width / 2));
      c.height = Math.max(1, Math.round(prev.height / 2));
      const cx = c.getContext('2d')!;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(prev, 0, 0, c.width, c.height);
      levels.push(c);
    }
    return { levels, ax: ox, ay: oy, w: W, h: H };
  }
}

let shared: PlanSprites | null = null;
/** 全局共用一份：换关卡、重来时不必重新生成 */
export function planSprites(): PlanSprites {
  return (shared ??= new PlanSprites());
}

/** 构件 → 模型。没列出的构件（敌台、护城河）没有合适的资产，沿用程序画法。
 *  orient：wall = 顺着城墙摆、正面朝城外；gate = 正面背向相邻的城门（瓮城）。 */
export interface BuildingModel {
  models: string[]; // 多个时按格子哈希轮换，避免连片一模一样
  fit: number;
  orient?: 'wall' | 'gate';
  copies?: [number, number][];
}
export const BUILDING_MODELS: Record<string, BuildingModel> = {
  gate: { models: ['K04a'], fit: 0.98, orient: 'wall' },
  jiaolou: { models: ['K04b'], fit: 0.84, orient: 'wall' },
  shuimen: { models: ['J03'], fit: 0.96, orient: 'wall' },
  wengcheng: { models: ['K05a'], fit: 0.92, orient: 'gate' },
  fushu: { models: ['K08'], fit: 0.92 },
  xianshu: { models: ['K08'], fit: 0.76 },
  chenghuang: { models: ['B01'], fit: 0.88 },
  gulou: { models: ['X01'], fit: 0.72 },
  xuegong: { models: ['X06'], fit: 0.9 },
  shuyuan: { models: ['X06'], fit: 0.72 },
  kuixing: { models: ['J02'], fit: 0.66 },
  louge: { models: ['X04'], fit: 0.86 },
  sheji: { models: ['K09'], fit: 0.8 },
  shanchuan: { models: ['K09'], fit: 0.8 },
  litan: { models: ['K09'], fit: 0.66 },
  // 街屋是一长排，单放像一道栅栏：前后摆两排，中间留出街
  shisi: { models: ['K14'], fit: 0.86, copies: [[0, -0.17], [0, 0.17]] },
  minju: { models: ['K07a', 'K07b'], fit: 0.86 },
  matou: { models: ['K13b'], fit: 0.6 },
};
/** 城墙：K01 拉成半段，从格心连向每一个相邻的墙格 */
export const WALL_MODEL = 'K01';
export const WALL_HALF = { len: 0.54, height: 0.2, thick: 0.17 };

/** 把精灵贴到 ctx：格心落在 (sx, sy)，hexPx = 一格对边宽度的屏幕像素（CSS），dpr 用来挑合适的缩小级。 */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, sx: number, sy: number, hexPx: number, dpr: number): void {
  const k = hexPx / SPRITE_PX_PER_HEX;
  const need = s.w * k * dpr;
  let lv = 0;
  while (lv + 1 < s.levels.length && s.levels[lv + 1].width >= need) lv++;
  ctx.drawImage(s.levels[lv], sx - s.ax * k, sy - s.ay * k, s.w * k, s.h * k);
}

function drawPrim(gl: WebGL2RenderingContext, prim: Model['primitives'][number]): void {
  gl.bindVertexArray(prim.vao);
  if (prim.indexType !== null) gl.drawElements(gl.TRIANGLES, prim.count, prim.indexType, 0);
  else gl.drawArrays(gl.TRIANGLES, 0, prim.count);
}

const translate = (x: number, y: number, z: number): Mat4 => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

/** 以 pivot 为中心按 s 缩放，并把 pivot 移到原点 */
function scaleAbout([sx, sy, sz]: V3, [px, py, pz]: V3): Mat4 {
  return Float32Array.from([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, -sx * px, -sy * py, -sz * pz, 1]);
}

function specKey(s: SpriteSpec): string {
  const hw = s.halfWall ? `|hw${s.halfWall.len},${s.halfWall.height},${s.halfWall.thick},${s.halfWall.flip ? 1 : 0}` : '';
  const cp = s.copies ? `|c${s.copies.join(';')}` : '';
  return `${s.model}|${s.fit}|${(s.yaw ?? 0).toFixed(3)}${hw}${cp}${s.shadow ? '|s' : ''}`;
}

function norm3(v: V3): V3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
