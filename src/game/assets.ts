// 运行时资源路径与加载。关卡数据在 public/data/，图片在 public/assets/（由 tools/export_assets.py 生成）。

import { loadTexture, type Texture } from '../render/gl';
import type { LevelJSON, SiteKind } from './level';

const BASE = import.meta.env.BASE_URL;

export const assetUrl = (name: string) => `${BASE}assets/${name}.webp`;

export const MARKER_KINDS: SiteKind[] = ['gate', 'landmark', 'temple', 'office', 'water', 'mountain'];

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`读取 ${path} 失败：${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchLevel = (city: string) => fetchJSON<LevelJSON>(`data/${city}.json`);

export async function loadMarkerTextures(gl: WebGL2RenderingContext): Promise<Record<SiteKind, Texture>> {
  const list = await Promise.all(MARKER_KINDS.map((k) => loadTexture(gl, assetUrl(`ui/icon_marker_${k}`))));
  return Object.fromEntries(MARKER_KINDS.map((k, i) => [k, list[i]])) as Record<SiteKind, Texture>;
}
