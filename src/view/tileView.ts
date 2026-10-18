// 3D 地块视图：中心格 + 一圈邻格做成浮空的六棱柱地块，地面贴图直接从底图按单应性取色。
// 地点主体与周边点缀优先用 glb 模型（卡通着色 + 描边），缺模型时回退为概念图立牌。
// 整个场景先画进离屏多重采样缓冲，再做一次移轴模糊输出到屏幕。

import { createProgram, loadTexture, resizeCanvas, type Program, type Texture } from '../render/gl';
import { lookAt, multiply, ndcShift, normalMatrix, ortho, perspective, placeMatrix, type Mat4, type V3 } from '../render/math';
import { materialKind } from './surfaceShading';
import { loadGLB, type Model } from '../render/gltf';
import { SceneTarget } from '../render/postfx';
import modelSpecs from '../../data/models.json';
import { toGLMat3 } from '../scene/homography';
import { hexKey, hexToWorld, neighbors, type Hex } from '../scene/hex';
import { assetUrl, fetchJSON } from '../game/assets';
import type { Level, Site } from '../game/level';
import { FULLSCREEN_VS } from './shaders';
import { BILLBOARD_FS, BILLBOARD_VS, PRISM_FS, PRISM_VS, SHADOW_FS, SHADOW_VS, SKY_FS } from './tileShaders';
import { DEPTH_FS, DEPTH_VS, OUTLINE_FS, OUTLINE_VS, TILTSHIFT_FS, TOON_FS, TOON_VS } from './modelShaders';

const BOTTOM = -70;

/** 各地形的格面高度（米）。 */
const TOP_HEIGHT: Record<string, number> = { S: 36, C: 6, R: -5, W: -5, M: -5 };
const WATER = new Set(['R', 'W', 'M']);

/** 邻格的点缀立牌：按地形挑资产。 */
const PROPS: Record<string, string[]> = {
  T: ['K12c', 'K12a'],
  G: ['K07a', 'K12c'],
  B: ['K07a', 'K14'],
  S: ['K12b', 'K12b'],
  C: ['K01'],
  R: ['K13b'],
  M: ['K12a'],
  W: ['K12a'],
};

interface ModelSpec {
  name: string;
  width: number;
  heroWidth: number;
  rotY?: number;
  /** 本资产还没建模时临时借用的通用模型 */
  fallback?: string;
  /** 远景简模的资产 ID */
  far?: string;
  /** 精模节点变换后的包围盒 [min, max]（export_assets.py 写入）。只加载了简模时按它摆放，精模到了也不跳 */
  bounds?: [V3, V3];
}
const SPECS = modelSpecs as unknown as Record<string, ModelSpec>;

/** 资产在地块上的显示宽度（米），见 data/models.json。 */
function assetWidth(id: string, hero: boolean): number {
  const spec = SPECS[id];
  if (!spec) return hero ? 190 : 120;
  return hero ? spec.heroWidth : spec.width;
}

/** 描边宽度（CSS 像素） */
const OUTLINE_PX = 1.2;

interface Placed {
  model: Model;
  /** 每个图元的最终模型矩阵与法线矩阵 */
  parts: { matrix: Mat4; normal: Float32Array }[];
}

interface ModelInstance {
  /** lods[0] 精模（有简模时按需加载，加载前为 null）；lods[1]（如有）远景简模 */
  lods: (Placed | null)[];
  active: number;
  base: V3;
  w: number;
  /** 精模尚未开始加载时：开始加载（只调用一次） */
  loadNear?: () => void;
}

type Bounds = Pick<Model, 'min' | 'max'>;

/** 远近模型切换阈值（模型在屏幕上的宽度，CSS 像素），两个阈值之间不切换，避免来回闪 */
const LOD_TO_FAR = 300;
const LOD_TO_NEAR = 340;

interface Billboard {
  tex: Texture;
  base: V3;
  w: number;
  h: number;
  hero: boolean;
}

interface CloudSprite {
  tex: Texture;
  base: V3;
  w: number;
  h: number;
  drift: number;
}

export class TileView {
  active = false;
  /** 右侧浮窗占用的宽度（CSS 像素），画面主体会让开它 */
  rightInset = 0;
  private prism: Program;
  private bill: Program;
  private shadow: Program;
  private sky: Program;
  private toon: Program;
  private outline: Program;
  private tilt: Program;
  private sceneTarget: SceneTarget;
  // 方向光阴影
  private depth: Program;
  private shadowFbo: WebGLFramebuffer;
  private shadowTex: WebGLTexture;
  private shadowSize: number;
  private lightVP: Mat4 = new Float32Array(16);
  private shadowKey = '';
  /** 关闭实时投影（调试 / 低端设备） */
  shadowsEnabled = true;
  /** 关闭程序化纹理（调试 / 低端设备） */
  texturesEnabled = true;
  private modelCache = new Map<string, Promise<Model | null>>();
  private available: Promise<Set<string>> | null = null;
  private instances: ModelInstance[] = [];
  /** 当前地块用到的模型（调试用） */
  modelReport: { id: string; source: 'glb' | 'fallback' | 'billboard'; triangles?: number }[] = [];
  /** 当前每个模型实例用的是精模（0）还是简模（1），调试用。精模在要切过去时才下载，下载期间仍是 1 */
  get lodState(): number[] {
    return this.instances.map((i) => i.active);
  }
  private vao: WebGLVertexArrayObject;
  private emptyVao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private vertexCount = 0;
  private texCache = new Map<string, Promise<Texture>>();
  private billboards: Billboard[] = [];
  private clouds: CloudSprite[] = [];
  private level!: Level;
  private site!: Site;
  private time = 0;
  private dpr = 1;

  // 相机
  private yaw = -0.7;
  private pitch = 0.6;
  private dist = 1450;
  private target = { yaw: -0.7, pitch: 0.6, dist: 1450 };
  private idle = 0;

  constructor(private gl: WebGL2RenderingContext, private canvas: HTMLCanvasElement, private mapTex: Texture) {
    this.prism = createProgram(gl, PRISM_VS, PRISM_FS);
    this.bill = createProgram(gl, BILLBOARD_VS, BILLBOARD_FS);
    this.shadow = createProgram(gl, SHADOW_VS, SHADOW_FS);
    this.sky = createProgram(gl, FULLSCREEN_VS, SKY_FS);
    this.toon = createProgram(gl, TOON_VS, TOON_FS);
    this.outline = createProgram(gl, OUTLINE_VS, OUTLINE_FS);
    this.tilt = createProgram(gl, FULLSCREEN_VS, TILTSHIFT_FS);
    this.sceneTarget = new SceneTarget(gl);
    this.depth = createProgram(gl, DEPTH_VS, DEPTH_FS);
    this.shadowSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.vao = gl.createVertexArray()!;
    this.emptyVao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
    gl.bindVertexArray(null);
    this.bindInput();
  }

  private texture(name: string): Promise<Texture> {
    let p = this.texCache.get(name);
    if (!p) {
      p = loadTexture(this.gl, assetUrl(name));
      this.texCache.set(name, p);
    }
    return p;
  }

  /** 为某地点搭建地块；完成后即可显示。 */
  async load(level: Level, site: Site): Promise<void> {
    this.level = level;
    this.site = site;
    const cells: { hex: Hex; focus: boolean }[] = [{ hex: site.hex, focus: true }, ...neighbors(site.hex).map((hex) => ({ hex, focus: false }))];
    const origin = hexToWorld(site.hex, level.hexSize);
    const local = (h: Hex): [number, number] => {
      const [x, y] = hexToWorld(h, level.hexSize);
      return [x - origin[0], -(y - origin[1])];
    };
    const terrainOf = (h: Hex) => level.terrain.get(hexKey(h)) ?? 'T';

    // ---- 六棱柱网格 ----
    const verts: number[] = [];
    const R = level.hexSize * 0.985;
    const push = (p: V3, n: V3, kind: number, focus: number) => verts.push(...p, ...n, kind, focus);
    for (const { hex, focus } of cells) {
      const t = terrainOf(hex);
      const top = TOP_HEIGHT[t] ?? 0;
      const kind = WATER.has(t) ? 1 : 0;
      const [cx, cz] = local(hex);
      const f = focus ? 1 : 0;
      const corner = (k: number): V3 => {
        const a = ((60 * k + 30) * Math.PI) / 180;
        return [cx + R * Math.cos(a), top, cz - R * Math.sin(a)];
      };
      for (let k = 0; k < 6; k++) {
        const a = corner(k), b = corner(k + 1);
        push([cx, top, cz], [0, 1, 0], kind, f);
        push(a, [0, 1, 0], kind, f);
        push(b, [0, 1, 0], kind, f);
        // 侧面
        const mid = ((60 * k + 60) * Math.PI) / 180;
        const n: V3 = [Math.cos(mid), 0, -Math.sin(mid)];
        const a0: V3 = [a[0], BOTTOM, a[2]], b0: V3 = [b[0], BOTTOM, b[2]];
        push(a, n, 2, f); push(a0, n, 2, f); push(b, n, 2, f);
        push(b, n, 2, f); push(a0, n, 2, f); push(b0, n, 2, f);
      }
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.vertexCount = verts.length / 8;

    // ---- 主体与点缀：有 glb 用模型，没有就用立牌 ----
    const jobs: Promise<ModelInstance | Billboard | null>[] = [];
    const report: TileView['modelReport'] = [];
    const heroId = site.model ?? 'K10';
    const heroTop = TOP_HEIGHT[terrainOf(site.hex)] ?? 0;
    const isWall = (h: Hex) => terrainOf(h) === 'C';
    const isCity = (h: Hex) => terrainOf(h) === 'B';
    // 城墙上的地点和城门：主体顺着城墙方向摆，正面朝城外
    const heroYaw = site.rotY !== undefined
      ? (site.rotY * Math.PI) / 180
      : isWall(site.hex) || site.kind === 'gate' ? wallYaw(site.hex, isWall, isCity, local) ?? 0 : 0;
    jobs.push(this.place(heroId, [0, Math.max(heroTop, 0), 0], true, heroYaw, report));
    for (const { hex } of cells.slice(1)) {
      const t = terrainOf(hex);
      const list = level.data.props?.[t] ?? PROPS[t] ?? [];
      const [cx, cz] = local(hex);
      const top = Math.max(TOP_HEIGHT[t] ?? 0, 0);
      const seed = hashHex(hex);
      const n = WATER.has(t) ? Math.min(1, list.length) : list.length;
      for (let i = 0; i < n; i++) {
        const a = seed * 6.283 + i * 2.4;
        const r = level.hexSize * (n === 1 ? 0.15 : 0.42);
        // 水格的点缀放在格边（岸上）；城墙格的墙段放在格中心
        let off = WATER.has(t) && list[i] !== 'K13b' ? level.hexSize * 0.75 : r;
        // 点缀随机转向，避免整齐划一；城墙段则顺着相邻城墙格的连线摆放，连成一道墙
        let yaw = Math.round(seed * 6 + i) * (Math.PI / 3);
        if (t === 'C') {
          off = 0;
          yaw = wallYaw(hex, isWall, isCity, local) ?? yaw;
        }
        jobs.push(this.place(list[i], [cx + Math.cos(a) * off, top, cz + Math.sin(a) * off], false, yaw, report));
      }
    }
    const placed = (await Promise.all(jobs)).filter((b): b is ModelInstance | Billboard => !!b);
    this.instances = placed.filter((b): b is ModelInstance => 'lods' in b);
    this.billboards = placed.filter((b): b is Billboard => 'tex' in b);
    this.modelReport = report;
    this.shadowKey = '';

    // ---- 云海 ----
    const cloudTex = await Promise.all([this.texture('clouds/cloud_03'), this.texture('clouds/cloud_04'), this.texture('clouds/cloud_02')]);
    this.clouds = Array.from({ length: 9 }, (_, i) => {
      const tex = cloudTex[i % 3];
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const r = 520 + (i % 3) * 120;
      const w = 520 + (i % 4) * 90;
      return { tex, base: [Math.cos(a) * r, BOTTOM - 90 - (i % 3) * 30, Math.sin(a) * r] as V3, w, h: (w * tex.height) / tex.width, drift: (i % 2 ? 1 : -1) * (4 + i) };
    });

    // 进入时从远处推近
    this.yaw = this.target.yaw = -0.7;
    this.pitch = 0.95;
    this.target.pitch = 0.6;
    this.dist = 2600;
    this.target.dist = 1450;
    this.idle = 0;
    this.time = 0;
  }

  /** 已导出到 public/assets/models 的模型 ID（来自 export_assets.py 写的 manifest）。 */
  private availableModels(): Promise<Set<string>> {
    if (!this.available) {
      this.available = fetchJSON<{ models?: string[] }>('assets/manifest.json')
        .then((m) => new Set(m.models ?? []))
        .catch(() => new Set<string>());
    }
    return this.available;
  }

  private loadModel(id: string): Promise<Model | null> {
    let p = this.modelCache.get(id);
    if (!p) {
      p = loadGLB(this.gl, `${import.meta.env.BASE_URL}assets/models/${id}.glb`).catch((err) => {
        console.warn(`[模型 ${id}] 加载失败，改用立牌：`, err);
        return null;
      });
      this.modelCache.set(id, p);
    }
    return p;
  }

  /** 摆放一个资产：有模型就按规格归一化（缩放到显示宽度、底面落地、水平居中、修正朝向），否则回退立牌。
   *  有远景简模和精模包围盒时只先加载简模，精模等 chooseLods 要切近景时再下载。 */
  private async place(id: string, base: V3, hero: boolean, yaw: number, report: TileView['modelReport']): Promise<ModelInstance | Billboard | null> {
    const available = await this.availableModels();
    // 自己没有模型时，借用 fallback 指定的通用模型（尺寸仍按本资产的规格）
    const modelId = available.has(id) ? id : SPECS[id]?.fallback && available.has(SPECS[id].fallback!) ? SPECS[id].fallback! : null;
    const source = modelId === id ? 'glb' : 'fallback';
    const w = assetWidth(id, hero);
    const spec = modelId ? SPECS[modelId] : undefined;
    const rot = yaw + ((spec?.rotY ?? 0) * Math.PI) / 180;
    const farId = spec?.far && available.has(spec.far) ? spec.far : null;
    const bounds: Bounds | null = spec?.bounds ? { min: spec.bounds[0], max: spec.bounds[1] } : null;
    if (modelId && farId && bounds) {
      const far = await this.loadModel(farId);
      if (far) {
        const inst: ModelInstance = { lods: [null, this.placeModel(far, base, rot, w, bounds)], active: 1, base, w };
        inst.loadNear = () => {
          inst.loadNear = undefined;
          void this.loadModel(modelId).then((near) => {
            if (near) inst.lods[0] = this.placeModel(near, base, rot, w, bounds);
          });
        };
        report.push({ id, source, triangles: far.triangles });
        return inst;
      }
    }
    const model = modelId ? await this.loadModel(modelId) : null;
    if (!model) {
      report.push({ id, source: 'billboard' });
      return this.makeBillboard(id, base, hero);
    }
    const ref = bounds ?? model;
    const lods = [this.placeModel(model, base, rot, w, ref)];
    if (farId) {
      const far = await this.loadModel(farId);
      if (far) lods.push(this.placeModel(far, base, rot, w, ref));
    }
    report.push({ id, source, triangles: model.triangles });
    return { lods, active: 0, base, w };
  }

  /** 归一化摆放：水平最长边缩放到显示宽度 w，底面落地、水平居中。精模与简模用同一套规则，切换时位置一致。 */
  /** ref：按哪个包围盒归一化。远景简模用精模的包围盒，两者共用同一套缩放与轴心，切换时不跳。 */
  private placeModel(model: Model, base: V3, rot: number, w: number, ref: Bounds = model): Placed {
    const extent = Math.max(ref.max[0] - ref.min[0], ref.max[2] - ref.min[2]) || 1;
    const pivot: V3 = [(ref.min[0] + ref.max[0]) / 2, ref.min[1], (ref.min[2] + ref.max[2]) / 2];
    const place = placeMatrix(base, rot, w / extent, pivot);
    const parts = model.primitives.map((prim) => {
      const matrix = multiply(place, prim.matrix);
      return { matrix, normal: normalMatrix(matrix) };
    });
    return { model, parts };
  }

  private async makeBillboard(id: string, base: V3, hero: boolean): Promise<Billboard | null> {
    try {
      const tex = await this.texture(`concepts/${id}_main`);
      const w = assetWidth(id, hero);
      return { tex, base, w, h: (w * tex.height) / tex.width, hero };
    } catch {
      return null;
    }
  }

  resize(): void {
    resizeCanvas(this.canvas);
    this.dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
  }

  frame(dt: number): void {
    this.time += dt;
    if (this.canvas.width !== Math.round(this.canvas.clientWidth * this.dpr)) this.resize();
    // 空闲时缓慢环绕
    this.idle += dt;
    if (this.idle > 3) this.target.yaw += dt * 0.08;
    const k = 1 - Math.exp(-dt * 3.2);
    this.yaw += (this.target.yaw - this.yaw) * k;
    this.pitch += (this.target.pitch - this.pitch) * k;
    this.dist += (this.target.dist - this.dist) * k;
    this.draw();
  }

  private draw(): void {
    const { gl, level } = this;
    const W = this.canvas.width, H = this.canvas.height;
    const fov = (34 * Math.PI) / 180;
    const target: V3 = [0, 30, 0];
    const eye: V3 = [
      target[0] + Math.cos(this.pitch) * Math.sin(this.yaw) * this.dist,
      target[1] + Math.sin(this.pitch) * this.dist,
      target[2] + Math.cos(this.pitch) * Math.cos(this.yaw) * this.dist,
    ];
    this.chooseLods(eye, H / (2 * Math.tan(fov / 2)) / this.dpr);
    const key = `${this.vertexCount}|${this.instances.map((i) => i.active).join('')}`;
    if (this.shadowsEnabled && key !== this.shadowKey) {
      this.renderShadowMap();
      this.shadowKey = key;
    }
    this.sceneTarget.ensure(W, H);
    this.sceneTarget.begin();
    gl.viewport(0, 0, W, H);

    // 背景
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao);
    gl.useProgram(this.sky.handle);
    gl.uniform2f(this.sky.u.uCanvas, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 相机
    const shift = -(this.rightInset * this.dpr) / W;
    const proj = multiply(ndcShift(shift), perspective(fov, W / H, 10, 6000));
    const viewProj: Mat4 = multiply(proj, lookAt(eye, target));
    const right: V3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const fogColor = [0.9, 0.87, 0.8];

    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 地块
    const p = this.prism;
    gl.useProgram(p.handle);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex.handle);
    gl.uniform1i(p.u.uMap, 0);
    gl.uniformMatrix4fv(p.u.uViewProj, false, viewProj);
    gl.uniform2f(p.u.uImageSize, level.imageSize[0], level.imageSize[1]);
    gl.uniformMatrix3fv(p.u.uWorldToImg, false, toGLMat3(level.worldToImg));
    const c = hexToWorld(this.site.hex, level.hexSize);
    gl.uniform2f(p.u.uCenterWorld, c[0], c[1]);
    gl.uniform3f(p.u.uEye, ...eye);
    gl.uniform3f(p.u.uSun, -0.42, 0.78, 0.46);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform1f(p.u.uBottom, BOTTOM);
    gl.uniform3f(p.u.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
    gl.uniform2f(p.u.uFogRange, this.dist * 1.1, this.dist * 2.0);
    this.bindShadow(p);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    gl.bindVertexArray(this.emptyVao);

    // 接地阴影
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(this.shadow.handle);
    gl.uniformMatrix4fv(this.shadow.u.uViewProj, false, viewProj);
    for (const b of this.billboards) {
      gl.uniform3f(this.shadow.u.uBase, ...b.base);
      gl.uniform2f(this.shadow.u.uRadius, b.w * 0.5, b.w * 0.32);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // glb 模型：卡通着色（含程序化纹理与投影），再用背面外扩画描边
    if (this.instances.length) {
      const t = this.toon;
      gl.useProgram(t.handle);
      gl.uniformMatrix4fv(t.u.uViewProj, false, viewProj);
      gl.uniform3f(t.u.uSun, -0.42, 0.78, 0.46);
      gl.uniform3f(t.u.uEye, ...eye);
      gl.uniform3f(t.u.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
      gl.uniform2f(t.u.uFogRange, this.dist * 1.1, this.dist * 2.0);
      gl.uniform1i(t.u.uTex, 0);
      this.bindShadow(t);
      this.drawInstances((prim, part) => {
        gl.uniform1i(t.u.uMatKind, this.texturesEnabled ? materialKind(prim.material) : 0);
        gl.uniformMatrix4fv(t.u.uModel, false, part.matrix);
        gl.uniformMatrix3fv(t.u.uNormalMat, false, part.normal);
        gl.uniform4f(t.u.uColor, ...prim.color);
        gl.uniform1i(t.u.uHasTex, prim.texture ? 1 : 0);
        if (prim.texture) gl.bindTexture(gl.TEXTURE_2D, prim.texture);
      });
      const o = this.outline;
      gl.useProgram(o.handle);
      gl.uniformMatrix4fv(o.u.uViewProj, false, viewProj);
      gl.uniform3f(o.u.uEye, ...eye);
      gl.uniform1f(o.u.uOutlineK, (OUTLINE_PX * this.dpr * 2 * Math.tan(fov / 2)) / H);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      this.drawInstances((_, part) => {
        gl.uniformMatrix4fv(o.u.uModel, false, part.matrix);
        gl.uniformMatrix3fv(o.u.uNormalMat, false, part.normal);
      });
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.emptyVao);
    }

    // 立牌（alpha-to-coverage 让边缘平滑，同时保留深度写入）
    const bp = this.bill;
    gl.useProgram(bp.handle);
    gl.uniformMatrix4fv(bp.u.uViewProj, false, viewProj);
    gl.uniform3f(bp.u.uRight, ...right);
    gl.uniform3f(bp.u.uEye, ...eye);
    gl.uniform3f(bp.u.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
    gl.uniform2f(bp.u.uFogRange, this.dist * 1.1, this.dist * 2.0);
    gl.uniform1i(bp.u.uTex, 0);
    gl.disable(gl.BLEND);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.uniform1f(bp.u.uPremul, 0);
    for (const b of this.billboards) {
      gl.bindTexture(gl.TEXTURE_2D, b.tex.handle);
      gl.uniform3f(bp.u.uBase, ...b.base);
      gl.uniform2f(bp.u.uSize, b.w, b.h);
      gl.uniform1f(bp.u.uLift, 0);
      gl.uniform1f(bp.u.uOpacity, 1);
      gl.uniform1f(bp.u.uShade, b.hero ? 1 : 0.95);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);

    // 云海：半透明，从远到近
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.uniform1f(bp.u.uPremul, 1);
    const sorted = [...this.clouds].sort((a, b) => dist2(b.base, eye) - dist2(a.base, eye));
    for (const cl of sorted) {
      const ang = Math.atan2(cl.base[2], cl.base[0]) + this.time * cl.drift * 0.002;
      const r = Math.hypot(cl.base[0], cl.base[2]);
      gl.bindTexture(gl.TEXTURE_2D, cl.tex.handle);
      gl.uniform3f(bp.u.uBase, Math.cos(ang) * r, cl.base[1], Math.sin(ang) * r);
      gl.uniform2f(bp.u.uSize, cl.w, cl.h);
      gl.uniform1f(bp.u.uLift, 0);
      gl.uniform1f(bp.u.uOpacity, 0.75);
      gl.uniform1f(bp.u.uShade, 1.05);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // 移轴：解析离屏缓冲，按上下距离焦带模糊后输出
    this.sceneTarget.resolve();
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.emptyVao);
    gl.useProgram(this.tilt.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(this.tilt.u.uScene, 0);
    gl.uniform2f(this.tilt.u.uCanvas, W, H);
    gl.uniform1f(this.tilt.u.uFocusY, 0.5);
    gl.uniform1f(this.tilt.u.uFocusHalf, 0.16);
    gl.uniform1f(this.tilt.u.uMaxBlur, 7 * this.dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 太阳方向（与着色器的 uSun 一致） */
  private static readonly SUN: V3 = (() => {
    const v: V3 = [-0.42, 0.78, 0.46];
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  })();

  /** 从太阳方向渲染地块与模型的深度，作为阴影贴图。场景不变时不重画。 */
  private renderShadowMap(): void {
    const gl = this.gl;
    const R = this.level.hexSize * 3.4;
    const s = TileView.SUN;
    const lightEye: V3 = [s[0] * 1000, s[1] * 1000, s[2] * 1000];
    this.lightVP = multiply(ortho(-R, R, -R, R, 200, 2000), lookAt(lightEye, [0, 0, 0], [0, 1, 0]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3.0);
    const d = this.depth;
    gl.useProgram(d.handle);
    gl.uniformMatrix4fv(d.u.uLightVP, false, this.lightVP);
    gl.uniformMatrix4fv(d.u.uModel, false, Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    this.drawInstances((_, part) => gl.uniformMatrix4fv(d.u.uModel, false, part.matrix));
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private bindShadow(p: Program): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(p.u.uShadow, 3);
    gl.uniformMatrix4fv(p.u.uLightVP, false, this.lightVP);
    gl.uniform1f(p.u.uShadowOn, this.shadowsEnabled && this.shadowKey ? 1 : 0);
    gl.uniform1f(p.u.uShadowTexel, 1 / this.shadowSize);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** 按模型在屏幕上的宽度选精模或简模。pxPerMeterAt1 = 距离 1 米处每米对应的 CSS 像素。 */
  private chooseLods(eye: V3, pxPerMeterAt1: number): void {
    for (const inst of this.instances) {
      if (inst.lods.length < 2) continue;
      const d = Math.hypot(inst.base[0] - eye[0], inst.base[1] - eye[1], inst.base[2] - eye[2]) || 1;
      const px = (inst.w / d) * pxPerMeterAt1;
      if (inst.active === 0 && px < LOD_TO_FAR) inst.active = 1;
      else if (inst.active === 1 && px > LOD_TO_NEAR) {
        // 精模还没下载：先开始下载，到了之后下一帧再切
        if (inst.lods[0]) inst.active = 0;
        else inst.loadNear?.();
      }
    }
  }

  private drawInstances(setup: (prim: Model['primitives'][number], part: Placed['parts'][number]) => void): void {
    const gl = this.gl;
    for (const inst of this.instances) {
      const lod = inst.lods[inst.active]!;
      lod.model.primitives.forEach((prim, i) => {
        setup(prim, lod.parts[i]);
        gl.bindVertexArray(prim.vao);
        if (prim.indexType !== null) gl.drawElements(gl.TRIANGLES, prim.count, prim.indexType, 0);
        else gl.drawArrays(gl.TRIANGLES, 0, prim.count);
      });
    }
  }

  private bindInput(): void {
    const el = this.canvas;
    let drag: { x: number; y: number; id: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.active || !drag || drag.id !== e.pointerId) return;
      this.target.yaw -= (e.clientX - drag.x) * 0.006;
      this.target.pitch = Math.min(1.15, Math.max(0.28, this.target.pitch + (e.clientY - drag.y) * 0.004));
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.idle = 0;
    });
    const end = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.target.dist = Math.min(2400, Math.max(750, this.target.dist * Math.exp(e.deltaY * 0.001)));
        this.idle = 0;
      },
      { passive: false },
    );
  }
}

/** 城墙格上墙段的朝向：长轴（模型 X）顺着相邻城墙格的连线，外侧（模型正面 +Z，带垛口）背向城内。
 *  没有相邻城墙格时返回 null。 */
function wallYaw(hex: Hex, isWall: (h: Hex) => boolean, isCity: (h: Hex) => boolean, local: (h: Hex) => [number, number]): number | null {
  const nb = neighbors(hex).filter(isWall);
  if (!nb.length) return null;
  const [x0, z0] = nb.length >= 2 ? local(nb[0]) : local(hex);
  const [x1, z1] = local(nb.length >= 2 ? nb[nb.length - 1] : nb[0]);
  // placeMatrix 的 Ry(rot) 把模型 X 轴转到 (cos rot, 0, -sin rot)，正面 +Z 转到 (sin rot, 0, cos rot)
  let rot = Math.atan2(-(z1 - z0), x1 - x0);
  const city = neighbors(hex).filter(isCity);
  if (city.length) {
    const [hx, hz] = local(hex);
    let ix = 0, iz = 0;
    for (const c of city) {
      const [cx, cz] = local(c);
      ix += cx - hx;
      iz += cz - hz;
    }
    if (Math.sin(rot) * ix + Math.cos(rot) * iz > 0) rot += Math.PI;
  }
  return rot;
}

function hashHex(h: Hex): number {
  const s = Math.sin(h.q * 127.1 + h.r * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const dist2 = (a: V3, b: V3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
