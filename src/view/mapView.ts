// 地图视图：底图 + 六边形网格 + 地点徽记，处理平移、缩放、悬停和点击。
// 游戏和标定工具共用：游戏模式下左键拖拽平移、点击选地点；
// 编辑模式下左键交给工具（刷地形、放地点），右键 / 中键 / 按住空格拖拽平移。

import { createDataTexture, createProgram, resizeCanvas, updateDataTexture, type Program, type Texture } from '../render/gl';
import { toGLMat3, type Vec2 } from '../scene/homography';
import { hexKey, type Hex } from '../scene/hex';
import { MapCamera } from '../scene/mapCamera';
import { hexAtImage, isCell, type Level, type Site } from '../game/level';
import { TERRAINS, terrainIndex } from '../game/terrain';
import { FULLSCREEN_VS, MAP_FS, MARKER_FS, MARKER_VS } from './shaders';

const FLAG_CELL = 1, FLAG_SITE = 2, FLAG_VISITED = 4;
const MARKER_CSS_PX = 44;

export interface HoverInfo {
  site: Site | null;
  hex: Hex;
  terrain: string | undefined;
  label: string | undefined;
  /** 指针位置（视口 CSS 像素） */
  screen: Vec2;
  /** 指针下的底图像素 */
  img: Vec2;
}

export interface MapViewEvents {
  onHover?(info: HoverInfo | null): void;
  onSelect?(site: Site): void;
  /** 编辑模式：左键按下 / 拖过某格 / 松开 */
  onEditDown?(info: HoverInfo, e: PointerEvent): void;
  onEditDrag?(info: HoverInfo, e: PointerEvent): void;
  onEditUp?(): void;
}

export interface MapViewOptions {
  editable?: boolean;
}

export class MapView {
  readonly camera: MapCamera;
  /** 地形叠加强度，0 = 关闭 */
  overlay = 0;
  /** 关闭时忽略所有指针输入（切到 3D 地块时） */
  inputEnabled = true;
  private mapProg: Program;
  private markerProg: Program;
  private vao: WebGLVertexArrayObject;
  private hexData!: Uint8Array;
  private hexTex!: Texture;
  private hover: Hex | null = null;
  private hoverSite: Site | null = null;
  private selected: Hex | null = null;
  private visited = new Set<string>();
  private time = 0;
  private dpr = 1;
  private spaceDown = false;
  private palette: Float32Array;

  constructor(
    private gl: WebGL2RenderingContext,
    private canvas: HTMLCanvasElement,
    private level: Level,
    private mapTex: Texture,
    private markerTex: Record<string, Texture>,
    private events: MapViewEvents,
    private opts: MapViewOptions = {},
  ) {
    this.camera = new MapCamera(level.imageSize[0], level.imageSize[1]);
    this.mapProg = createProgram(gl, FULLSCREEN_VS, MAP_FS);
    this.markerProg = createProgram(gl, MARKER_VS, MARKER_FS);
    this.vao = gl.createVertexArray()!;
    this.palette = new Float32Array(9 * 3);
    TERRAINS.forEach((t, i) => this.palette.set(t.color.map((c) => c / 255), (i + 1) * 3));
    this.setLevel(level);
    this.bindInput();
    this.resize();
    this.camera.zoom = this.camera.minZoom;
    this.camera.flyTo([level.imageSize[0] / 2, level.imageSize[1] / 2], this.camera.minZoom * (opts.editable ? 1 : 1.15));
  }

  /** 换关卡数据（标定工具改动后调用）；相机位置保留。 */
  setLevel(level: Level): void {
    const { gl } = this;
    const sizeChanged = !this.hexTex || this.hexTex.width !== level.cols || this.hexTex.height !== level.rows;
    this.level = level;
    if (sizeChanged) {
      if (this.hexTex) gl.deleteTexture(this.hexTex.handle);
      this.hexData = new Uint8Array(level.cols * level.rows * 4);
      this.hexTex = createDataTexture(gl, level.cols, level.rows, this.hexData);
    }
    this.rebuildHexData();
  }

  setVisited(siteIds: Iterable<string>): void {
    this.visited = new Set(siteIds);
    this.rebuildHexData();
  }

  private rebuildHexData(): void {
    const { level } = this;
    this.hexData.fill(0);
    for (let r = 0; r < level.rows; r++) {
      for (let q = 0; q < level.cols; q++) {
        const key = hexKey({ q: q + level.qMin, r: r + level.rMin });
        let f = level.cells.has(key) ? FLAG_CELL : 0;
        const site = level.siteByHex.get(key);
        if (site) f |= FLAG_SITE | (this.visited.has(site.id) ? FLAG_VISITED : 0);
        const i = (r * level.cols + q) * 4;
        this.hexData[i] = f;
        this.hexData[i + 1] = terrainIndex(level.terrain.get(key));
      }
    }
    updateDataTexture(this.gl, this.hexTex, this.hexData);
  }

  resize(): void {
    resizeCanvas(this.canvas);
    this.dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    this.camera.setViewport(this.canvas.width, this.canvas.height);
  }

  /** 底图像素 → 画布元素内的 CSS 像素（标定工具放 DOM 手柄用）。 */
  imageToCss(img: Vec2): Vec2 {
    const [x, y] = this.camera.imageToScreen(img);
    return [x / this.dpr, y / this.dpr];
  }

  frame(dt: number): void {
    this.time += dt;
    if (this.canvas.width !== Math.round(this.canvas.clientWidth * this.dpr)) this.resize();
    this.camera.update(dt);
    this.draw();
  }

  private draw(): void {
    const { gl, level, camera } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);

    const p = this.mapProg;
    gl.useProgram(p.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex.handle);
    gl.uniform1i(p.u.uMap, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hexTex.handle);
    gl.uniform1i(p.u.uHexData, 1);
    gl.uniform2f(p.u.uImageSize, level.imageSize[0], level.imageSize[1]);
    gl.uniform2f(p.u.uCenter, camera.center[0], camera.center[1]);
    gl.uniform1f(p.u.uZoom, camera.zoom);
    gl.uniform2f(p.u.uCanvas, this.canvas.width, this.canvas.height);
    gl.uniformMatrix3fv(p.u.uImgToWorld, false, toGLMat3(level.imgToWorld));
    gl.uniform1f(p.u.uHexSize, level.hexSize);
    gl.uniform2i(p.u.uHexMin, level.qMin, level.rMin);
    gl.uniform2i(p.u.uHexDim, level.cols, level.rows);
    const none = 1 << 20;
    gl.uniform2i(p.u.uHover, this.hover?.q ?? none, this.hover?.r ?? none);
    gl.uniform2i(p.u.uSelected, this.selected?.q ?? none, this.selected?.r ?? none);
    gl.uniform1f(p.u.uTime, this.time);
    // 缩小时网格更淡，放大时更清楚；编辑模式下始终清楚
    const t = (camera.zoom - camera.minZoom) / (camera.maxZoom - camera.minZoom);
    gl.uniform1f(p.u.uGridAlpha, this.opts.editable ? 0.45 : 0.16 + 0.14 * Math.min(1, t * 2));
    gl.uniform1f(p.u.uPx, this.dpr);
    gl.uniform1f(p.u.uOverlay, this.overlay);
    gl.uniform3fv(p.u.uPalette, this.palette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.drawMarkers();
  }

  private drawMarkers(): void {
    const { gl, camera } = this;
    const m = this.markerProg;
    gl.useProgram(m.handle);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(m.u.uCenter, camera.center[0], camera.center[1]);
    gl.uniform1f(m.u.uZoom, camera.zoom);
    gl.uniform2f(m.u.uCanvas, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(m.u.uTex, 0);

    // 远处（画面上方）的徽记先画，近处的后画，保证遮挡关系
    const sites = [...this.level.sites].sort((a, b) => a.img[1] - b.img[1]);
    const base = this.markerSize();
    for (const s of sites) {
      const tex = this.markerTex[s.kind];
      if (!tex) continue;
      const hot = s === this.hoverSite || (this.selected && hexKey(this.selected) === hexKey(s.hex));
      const visited = this.visited.has(s.id);
      const bob = this.opts.editable ? 0 : Math.sin(this.time * 2 + s.img[0] * 0.05) * 2.5 * this.dpr;
      gl.bindTexture(gl.TEXTURE_2D, tex.handle);
      gl.uniform2f(m.u.uPos, s.img[0], s.img[1]);
      gl.uniform1f(m.u.uSize, base * (hot ? 1.18 : 1));
      gl.uniform1f(m.u.uLift, base * 0.18 + bob + (hot ? 4 * this.dpr : 0));
      gl.uniform1f(m.u.uAlpha, this.opts.editable && this.overlay > 0.5 ? 0.7 : 1);
      gl.uniform1f(m.u.uDim, visited && !hot ? 0.55 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }

  private markerSize(): number {
    const c = this.camera;
    const scale = this.opts.editable ? 0.75 : 1;
    return MARKER_CSS_PX * scale * this.dpr * Math.min(1.35, Math.sqrt(c.zoom / c.minZoom));
  }

  /** 视口 CSS 坐标处的信息：先测徽记，再测格子。 */
  private pick(clientX: number, clientY: number): HoverInfo | null {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) * this.dpr, sy = (clientY - rect.top) * this.dpr;
    const img = this.camera.screenToImage([sx, sy]);
    let site: Site | null = null;
    // 编辑模式下按格操作，不让徽记挡住下面的格
    if (!this.opts.editable) {
      const size = this.markerSize();
      let bestY = -Infinity;
      for (const s of this.level.sites) {
        const [x, y] = this.camera.imageToScreen(s.img);
        const cy = y - size * 0.18 - size * 0.5;
        if (Math.hypot(sx - x, sy - cy) < size * 0.48 && y > bestY) {
          site = s;
          bestY = y;
        }
      }
    }
    let hex = site?.hex ?? hexAtImage(this.level, img);
    if (!site) {
      if (!this.opts.editable && !isCell(this.level, hex)) return null;
      site = this.level.siteByHex.get(hexKey(hex)) ?? null;
    }
    hex = { q: hex.q, r: hex.r };
    const key = hexKey(hex);
    return { site, hex, terrain: this.level.terrain.get(key), label: this.level.labels.get(key), screen: [clientX, clientY], img };
  }

  private bindInput(): void {
    const el = this.canvas;
    const editable = !!this.opts.editable;
    let drag: { x: number; y: number; moved: boolean; id: number; pan: boolean; edit: boolean } | null = null;

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        this.spaceDown = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });

    el.addEventListener('pointerdown', (e) => {
      if (!this.inputEnabled) return;
      const panButton = e.button === 1 || e.button === 2 || this.spaceDown;
      const edit = editable && e.button === 0 && !this.spaceDown;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, pan: !editable || panButton, edit };
      el.setPointerCapture(e.pointerId);
      if (edit) {
        const info = this.pick(e.clientX, e.clientY);
        if (info) this.events.onEditDown?.(info, e);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.inputEnabled) return;
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.pan && (drag.moved || Math.hypot(dx, dy) > 4)) {
          drag.moved = true;
          el.classList.add('dragging');
          this.camera.panBy(dx * this.dpr, dy * this.dpr);
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
      }
      if (drag?.moved) {
        this.setHover(null, null);
        this.events.onHover?.(null);
        return;
      }
      const info = this.pick(e.clientX, e.clientY);
      this.setHover(info?.hex ?? null, info?.site ?? null);
      this.events.onHover?.(info);
      if (info && drag?.edit) this.events.onEditDrag?.(info, e);
    });
    const end = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!this.inputEnabled) {
        drag = null;
        return;
      }
      const { moved, edit } = drag;
      drag = null;
      el.classList.remove('dragging');
      if (edit) {
        this.events.onEditUp?.();
        return;
      }
      if (moved || editable) return;
      const info = this.pick(e.clientX, e.clientY);
      if (info?.site) {
        this.selected = info.site.hex;
        this.camera.flyTo(info.site.img, Math.max(this.camera.zoom, this.camera.minZoom * 1.8));
        this.events.onSelect?.(info.site);
      } else {
        this.selected = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => {
      if (drag || !this.inputEnabled) return;
      this.setHover(null, null);
      this.events.onHover?.(null);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.inputEnabled) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const scale = e.deltaMode === 1 ? 16 : 1;
        this.camera.zoomAt([(e.clientX - rect.left) * this.dpr, (e.clientY - rect.top) * this.dpr], Math.exp(-e.deltaY * scale * 0.0015));
      },
      { passive: false },
    );
    window.addEventListener('resize', () => this.resize());
  }

  private setHover(hex: Hex | null, site: Site | null): void {
    this.hover = hex;
    this.hoverSite = site;
    if (!this.opts.editable) this.canvas.style.cursor = site ? 'pointer' : '';
  }

  select(hex: Hex | null): void {
    this.selected = hex;
  }

  clearSelection(): void {
    this.selected = null;
  }
}
