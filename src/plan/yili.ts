// 议礼：礼部书吏就「违制而有因」的方位当面诘问，玩家引方志为证、改建或强辩。
// 数据见 public/data/yili/{city}.json，规则见 docs/玩法需求_v3_议礼.md §1。本文件的判定都是纯函数，只读 PlanMap。

import { fetchJSON } from '../game/assets';
import { hexKey, neighbors, type Hex } from '../scene/hex';
import type { Dir } from './buildings';
import type { PlanMap } from './planMap';

export interface YiliEffect {
  /** 该构件的方位改判地形豁免 */
  exempt?: string;
  /** 获得的声望名目 */
  reputation?: string;
  /** 考成修正分 */
  modifier?: number;
  /** 在地图上标出的范围 */
  highlight?: 'ideal-outside';
  /** 书吏答完回到选项 */
  retry?: boolean;
}

export interface YiliOption {
  key: 'A' | 'B' | 'C';
  label: string;
  /** 玩家说的话 */
  say: string;
  /** 书吏的答复 */
  reply: string;
  /** 需已在探索模式点亮的拾遗卡（lore:xxx） */
  requires?: string;
  /** 未点亮时的提示 */
  locked?: string;
  effect: YiliEffect;
}

export type YiliTrigger =
  | { kind: 'place'; building: string; ideal: Dir; accept: Dir[]; outside?: boolean }
  /** 考成前判定。historicWalls：城墙有六成以上沿用旧城址（锁定的旧城墙，或照底图旧城墙走向所筑），即城形同于史实 */
  | { kind: 'finish'; check: 'historicWalls' };

export interface YiliEvent {
  id: string;
  title: string;
  trigger: YiliTrigger;
  clerk: string;
  options: YiliOption[];
  exemptNote?: string;
  quote?: { text: string; source: string };
  chronicle?: Partial<Record<'A' | 'C', string>>;
  flag?: string;
}

export interface YiliFile {
  city: string;
  events: YiliEvent[];
}

/** 一次营建里议礼的结果。hex 为触发时构件所在格，拆掉重放后要重新议。 */
export interface YiliRecord {
  id: string;
  choice: 'A' | 'C';
  hex?: string;
}

export async function fetchYili(city: string): Promise<YiliFile | null> {
  try {
    return await fetchJSON<YiliFile>(`data/yili/${city}.json`);
  } catch {
    return null;
  }
}

/** 近郊：城外、离城心 1.0～1.9 个城半径之间。 */
const SUBURB = [1.0, 1.9] as const;

/** 江河湖（不含护城河）：紧贴它们的滩地汛期可没，不宜设坛。 */
const BIG_WATER = new Set(['R', 'W']);
const onFloodBank = (map: PlanMap, h: Hex) => neighbors(h).some((n) => BIG_WATER.has(map.cell(n)?.terrain ?? ''));

/** 某个方位的城外近郊格，以及其中可建的陆地格（不含紧贴江河湖的滩地）。 */
export function suburb(map: PlanMap, dir: Dir): { all: Hex[]; land: Hex[] } {
  const inside = map.inside();
  const all: Hex[] = [];
  const land: Hex[] = [];
  for (const [key, c] of map.cells) {
    if (inside.has(key) || map.isWallish(c)) continue;
    const d = map.dirOf(c);
    if (d.dir !== dir || d.ratio <= SUBURB[0] || d.ratio > SUBURB[1]) continue;
    all.push(c);
    if (c.buildable && !map.isNaturalWater(c) && !onFloodBank(map, c)) land.push(c);
  }
  return { all, land };
}

/** 礼制方位的近郊是否被水「阻断」：几乎没有可建陆地。 */
export function idealBlocked(map: PlanMap, dir: Dir): boolean {
  const s = suburb(map, dir);
  return s.all.length > 0 && s.land.length < Math.max(2, s.all.length * 0.15);
}

/** 放下构件后，是否触发这条议礼。 */
export function placeTriggers(map: PlanMap, ev: YiliEvent, h: Hex, building: string): boolean {
  const t = ev.trigger;
  if (t.kind !== 'place' || t.building !== building || !map.walled) return false;
  const d = map.dirOf(h);
  if (d.dir === 'C' || !t.accept.includes(d.dir)) return false;
  if (t.outside && map.inside().has(hexKey(h))) return false;
  return idealBlocked(map, t.ideal);
}

/** 城墙沿用旧址的比例：锁定的旧城墙，或落在旧城墙走向上的。 */
export function historicWallShare(map: PlanMap, oldWalls: Set<string> = new Set()): number {
  let all = 0, old = 0;
  for (const b of map.buildings()) {
    if (!b.def.wallish) continue;
    all++;
    if (b.locked || oldWalls.has(b.key)) old++;
  }
  return all ? old / all : 0;
}

/** 考成前，是否触发这条议礼。oldWalls 为底图上的旧城墙走向（保定营建课）。 */
export function finishTriggers(map: PlanMap, ev: YiliEvent, oldWalls?: Set<string>): boolean {
  const t = ev.trigger;
  if (t.kind !== 'finish' || !map.walled) return false;
  if (t.check === 'historicWalls') return historicWallShare(map, oldWalls) >= 0.6;
  return false;
}

/** 已议过且坛仍在原处的，不再重复诘问。 */
export function alreadySettled(records: YiliRecord[], ev: YiliEvent, h?: Hex): boolean {
  return records.some((r) => r.id === ev.id && (!h || !r.hex || r.hex === hexKey(h)));
}

/** 议礼记录里仍然有效的（构件还在原格）。 */
export function liveRecords(map: PlanMap, records: YiliRecord[], events: YiliEvent[]): YiliRecord[] {
  return records.filter((r) => {
    const ev = events.find((e) => e.id === r.id);
    if (!ev || ev.trigger.kind !== 'place' || !r.hex) return !!ev;
    const [q, r2] = r.hex.split(',').map(Number);
    return map.at({ q, r: r2 })?.id === ev.trigger.building;
  });
}

/** 由有效记录推出：豁免的构件、声望、修正项。 */
export function yiliOutcome(records: YiliRecord[], events: YiliEvent[]): {
  exempt: Map<string, string>;
  reputation: string[];
  modifiers: { name: string; delta: number }[];
} {
  const exempt = new Map<string, string>();
  const reputation: string[] = [];
  const modifiers: { name: string; delta: number }[] = [];
  for (const r of records) {
    const ev = events.find((e) => e.id === r.id);
    const opt = ev?.options.find((o) => o.key === r.choice);
    if (!ev || !opt) continue;
    if (opt.effect.exempt) exempt.set(opt.effect.exempt, ev.exemptNote ?? '地形豁免');
    if (opt.effect.reputation) reputation.push(opt.effect.reputation);
    if (opt.effect.modifier) modifiers.push({ name: `${ev.title} · ${opt.label}`, delta: opt.effect.modifier });
  }
  return { exempt, reputation, modifiers };
}
