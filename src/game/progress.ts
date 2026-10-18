// 收集进度：记录每座城看过的地点，存 localStorage。点亮的基因、拾遗由此推算，不单独存。

const KEY = 'sanfu.progress.v1';

interface Saved {
  [city: string]: { visited: string[] };
}

export class Progress {
  private data: Saved;

  constructor() {
    try {
      this.data = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
    } catch {
      this.data = {};
    }
  }

  visited(city: string): Set<string> {
    return new Set(this.data[city]?.visited ?? []);
  }

  /** 记录看过某地点；返回是否为首次。 */
  markVisited(city: string, siteId: string): boolean {
    const set = this.visited(city);
    if (set.has(siteId)) return false;
    set.add(siteId);
    this.data[city] = { visited: [...set] };
    this.save();
    return true;
  }

  reset(city?: string): void {
    if (city) delete this.data[city];
    else this.data = {};
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // 隐私模式等情况下存不了，进度只在本次会话有效
    }
  }
}

// ---------------------------------------------------------------- 营建模式读取的探索进度、议礼记录与声望

/** 某张卡（lore:xxx 等）是否已在探索模式点亮：挂着这张卡的地点看过即算。 */
export function cardUnlocked(sites: { id: string; cards: string[] }[], visited: Set<string>, card: string): boolean {
  return sites.some((s) => visited.has(s.id) && s.cards.includes(card));
}

/** 议礼记录：按营建场次（如 lesson:xiangyang）存。字段与 src/plan/yili.ts 的 YiliRecord 一致。 */
export interface SavedYili {
  id: string;
  choice: 'A' | 'C';
  hex?: string;
}

const YILI_KEY = 'sanfu.yili.v1';

function readJSON<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就只在本次会话有效
  }
}

export function loadYili(scope: string): SavedYili[] {
  return readJSON<Record<string, SavedYili[]>>(YILI_KEY, {})[scope] ?? [];
}

export function saveYili(scope: string, records: SavedYili[]): void {
  const all = readJSON<Record<string, SavedYili[]>>(YILI_KEY, {});
  all[scope] = records;
  writeJSON(YILI_KEY, all);
}

/** 声望：只记名目和来由，不做数值。 */
export interface Reputation {
  name: string;
  /** 来由，例如「议礼 · 社稷坛」 */
  source: string;
  city: string;
  at: string;
}

const REP_KEY = 'sanfu.reputation.v1';

export function loadReputation(): Reputation[] {
  return readJSON<Reputation[]>(REP_KEY, []);
}

/** 同一名目、同一来由只记一次；返回是否新得。 */
export function addReputation(r: Omit<Reputation, 'at'>): boolean {
  const list = loadReputation();
  if (list.some((x) => x.name === r.name && x.source === r.source && x.city === r.city)) return false;
  list.push({ ...r, at: new Date().toISOString() });
  writeJSON(REP_KEY, list);
  return true;
}
