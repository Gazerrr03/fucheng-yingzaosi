// 城池码：把一座城（地图 + 构件 + 作者）压成一串可复制的文字，别人导入后可以续修。
// 格式：SF1.<地图>.<base64url(JSON)>，JSON = { a: 作者, b: [[q, r, 构件], ...] }

import { BUILDING_BY_ID } from './buildings';

const PREFIX = 'SF1';

export interface SharedCity {
  mapId: string;
  author: string;
  layout: [number, number, string][];
}

function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeShare(mapId: string, layout: [number, number, string][], author: string): string {
  // 同一种构件连在一起写，压缩一点体积：{ wall: [q, r, q, r, ...] }
  const groups: Record<string, number[]> = {};
  for (const [q, r, id] of layout) (groups[id] ??= []).push(q, r);
  return `${PREFIX}.${mapId}.${toB64(JSON.stringify({ a: author, g: groups }))}`;
}

export function decodeShare(code: string): SharedCity {
  const m = code.trim().match(/^SF1\.([a-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('城池码格式不对');
  const data = JSON.parse(fromB64(m[2])) as { a?: string; g?: Record<string, number[]> };
  const layout: [number, number, string][] = [];
  for (const [id, xs] of Object.entries(data.g ?? {})) {
    if (!BUILDING_BY_ID.has(id)) continue;
    for (let i = 0; i + 1 < xs.length; i += 2) layout.push([xs[i], xs[i + 1], id]);
  }
  return { mapId: m[1], author: String(data.a ?? '佚名').slice(0, 24), layout };
}

// 续修来源：导入别人的城之后记下原作者，下一卷记载写「得某某所营之图，续而修之」
const originKey = (mapId: string) => `sanfu.plan.custom.${mapId}.origin`;

export function originOf(mapId: string): string | undefined {
  return localStorage.getItem(originKey(mapId)) ?? undefined;
}

export function setOrigin(mapId: string, author: string | null): void {
  try {
    if (author) localStorage.setItem(originKey(mapId), author);
    else localStorage.removeItem(originKey(mapId));
  } catch {
    // 忽略
  }
}
