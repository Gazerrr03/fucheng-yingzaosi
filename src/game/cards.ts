// 卡片文案与基因点亮规则。

import { fetchJSON } from './assets';
import type { Level } from './level';

export interface Card {
  title: string;
  body: string;
  era?: string;
  quote?: { text: string; source: string };
  /** 「后世」小注 */
  later?: string;
  /** 对应 docs/资料问题报告.md 的编号：此处为占位值 */
  flag?: string;
  sources?: string[];
}

/** 键为 gene:xxx / lore:xxx / site:xxx */
export type CardMap = Record<string, Card>;

export async function fetchCards(city: string): Promise<CardMap> {
  const raw = await fetchJSON<Record<string, Card | string>>(`data/cards/${city}.json`);
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_'))) as CardMap;
}

/** 根据已看过的地点，算出点亮了哪些基因。 */
export function litGenes(level: Level, visited: Set<string>): string[] {
  const out: string[] = [];
  for (const [gene, r] of Object.entries(level.data.genes ?? {})) {
    const seen = r.sites.filter((s) => visited.has(s)).length;
    const ok = r.rule === 'all' ? seen === r.sites.length : r.rule === 'atLeast' ? seen >= (r.n ?? 1) : seen > 0;
    if (ok) out.push(gene);
  }
  return out;
}

/** 某个基因的进度文字，例如「城门 2 / 6」。 */
export function geneProgress(level: Level, gene: string, visited: Set<string>): { seen: number; need: number } | null {
  const r = level.data.genes?.[gene];
  if (!r) return null;
  const need = r.rule === 'all' ? r.sites.length : r.rule === 'atLeast' ? r.n ?? 1 : 1;
  return { seen: Math.min(need, r.sites.filter((s) => visited.has(s)).length), need };
}
