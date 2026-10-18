// 地图视角相机：在底图的图像空间里平移和缩放。
// 底图本身是斜俯视画面，所以相机保持原画的倾角，只做 2D 平移和缩放。
// center：视口中心对应的图像像素；zoom：每个图像像素对应的画布像素。

import type { Vec2 } from './homography';

export class MapCamera {
  center: Vec2;
  zoom = 1;
  private target: { center: Vec2; zoom: number };
  minZoom = 1;
  maxZoom = 4;

  constructor(private imageW: number, private imageH: number) {
    this.center = [imageW / 2, imageH / 2];
    this.target = { center: [...this.center], zoom: 1 };
  }

  /** 视口变化时重算缩放范围：最小值保证底图铺满视口。 */
  setViewport(canvasW: number, canvasH: number): void {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.minZoom = Math.max(canvasW / this.imageW, canvasH / this.imageH);
    this.maxZoom = Math.max(this.minZoom * 3.5, 2.5);
    this.target.zoom = clamp(this.target.zoom, this.minZoom, this.maxZoom);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clampCenter(this.target.center, this.target.zoom);
    this.clampCenter(this.center, this.zoom);
  }
  private canvasW = 1;
  private canvasH = 1;

  screenToImage([sx, sy]: Vec2): Vec2 {
    return [this.center[0] + (sx - this.canvasW / 2) / this.zoom, this.center[1] + (sy - this.canvasH / 2) / this.zoom];
  }

  imageToScreen([ix, iy]: Vec2): Vec2 {
    return [(ix - this.center[0]) * this.zoom + this.canvasW / 2, (iy - this.center[1]) * this.zoom + this.canvasH / 2];
  }

  /** 拖拽平移（画布像素增量），立即生效。 */
  panBy(dx: number, dy: number): void {
    this.target.center[0] -= dx / this.target.zoom;
    this.target.center[1] -= dy / this.target.zoom;
    this.clampCenter(this.target.center, this.target.zoom);
    this.center = [...this.target.center];
  }

  /** 以屏幕上某点为锚缩放，带平滑过渡。 */
  zoomAt(screen: Vec2, factor: number): void {
    const z0 = this.target.zoom;
    const z1 = clamp(z0 * factor, this.minZoom, this.maxZoom);
    const ax = screen[0] - this.canvasW / 2, ay = screen[1] - this.canvasH / 2;
    const c = this.target.center;
    c[0] += ax / z0 - ax / z1;
    c[1] += ay / z0 - ay / z1;
    this.target.zoom = z1;
    this.clampCenter(c, z1);
  }

  /** 平滑飞到某个图像点。 */
  flyTo(image: Vec2, zoom = this.target.zoom): void {
    this.target.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.target.center = [...image];
    this.clampCenter(this.target.center, this.target.zoom);
  }

  /** 每帧调用；返回是否仍在运动。 */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-dt * 12);
    const dz = this.target.zoom - this.zoom;
    const dx = this.target.center[0] - this.center[0];
    const dy = this.target.center[1] - this.center[1];
    this.zoom += dz * k;
    this.center[0] += dx * k;
    this.center[1] += dy * k;
    return Math.abs(dz) > 1e-4 || Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
  }

  private clampCenter(c: Vec2, zoom: number): void {
    const hw = this.canvasW / 2 / zoom, hh = this.canvasH / 2 / zoom;
    c[0] = this.imageW <= hw * 2 ? this.imageW / 2 : clamp(c[0], hw, this.imageW - hw);
    c[1] = this.imageH <= hh * 2 ? this.imageH / 2 : clamp(c[1], hh, this.imageH - hh);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
