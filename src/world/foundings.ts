// 自定义模式里玩家在天下舆图上建的府城（本地存档）。每座城的营建布局另存在 sanfu.plan.custom.<id>。

const KEY = 'sanfu.world.foundings.v1';

export interface Founding {
  /** 城址 id，也是营建存档的 key；真实地图（重庆、武昌…）直接用地图 id，生成的城址为 w<q>_<r> */
  id: string;
  /** 玩家起的府名 */
  name: string;
  /** 所在天下格 */
  hex: [number, number];
  /** 择址时的形胜评分 */
  site: number;
  /** 最近一次的风水总评 */
  grade?: string;
  total?: number;
  created: number;
}

export function loadFoundings(): Founding[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: Founding[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 存不了就只在本次有效
  }
}

export function getFounding(id: string): Founding | undefined {
  return loadFoundings().find((f) => f.id === id);
}

export function upsertFounding(f: Founding): void {
  save([...loadFoundings().filter((x) => x.id !== f.id), f]);
}

export function updateFounding(id: string, patch: Partial<Founding>): void {
  const list = loadFoundings();
  const f = list.find((x) => x.id === id);
  if (!f) return;
  Object.assign(f, patch);
  save(list);
}

export function removeFounding(id: string): void {
  save(loadFoundings().filter((x) => x.id !== id));
}
